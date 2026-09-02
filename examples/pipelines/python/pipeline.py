"""The fan-out-and-gate pipeline in Python, with no pipeline API at all.

Every remote operation is awaitable, so the pipeline is the language: `asyncio.gather` fans out, a
comprehension gates, `await` sequences. Nothing here schedules, persists, replays, or supervises,
which is why the same file runs from cron, CI, a Lambda, or another Deepnote notebook.

    DEEPNOTE_TOKEN=... NA_NOTEBOOK_ID=... EU_NOTEBOOK_ID=... APAC_NOTEBOOK_ID=... \
      python3 examples/pipelines/python/pipeline.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

from deepnote import Deepnote, DeepnoteRunError, RunResult, outputs

QUALITY_THRESHOLD = 0.95

REGIONS = [
    (name, os.environ.get(env))
    for name, env in (
        ("North America", "NA_NOTEBOOK_ID"),
        ("Europe", "EU_NOTEBOOK_ID"),
        ("Asia Pacific", "APAC_NOTEBOOK_ID"),
    )
]


async def main() -> int:
    regions = [(name, notebook_id) for name, notebook_id in REGIONS if notebook_id]
    if not regions:
        print("Set NA_NOTEBOOK_ID / EU_NOTEBOOK_ID / APAC_NOTEBOOK_ID to the notebooks to run.")
        return 1

    started = time.monotonic()

    async with Deepnote.from_env() as deepnote:
        # A notebook plus the names of the values it publishes. `last_json` survives Deepnote
        # reassigning block ids when it creates a notebook from a file.
        def analysis(notebook_id: str):
            return deepnote.notebooks.define(notebook_id, outputs={"reading": outputs.last_json()})

        # Fan out. Independent work is concurrent because `gather` is, not because a framework said
        # so. `return_exceptions=True` keeps one failed region from cancelling the others: every
        # notebook runs to its own conclusion and the failures are handled together below.
        outcomes = await asyncio.gather(
            *(
                analysis(notebook_id).run_and_wait(
                    inputs={"region": name, "trailing_months": 6},
                    on_status=lambda status, name=name: print(f"  {name}: {status}"),
                )
                for name, notebook_id in regions
            ),
            return_exceptions=True,
        )

    results: dict[str, RunResult] = {}
    failed = False
    for (name, _), outcome in zip(regions, outcomes, strict=True):
        if isinstance(outcome, DeepnoteRunError):
            # A failed notebook is a real outcome, not an SDK error: the result carries the snapshot,
            # which is where the failing block's own message is.
            print(f"  failed: run {outcome.run_id} — {outcome.result.error}")
            failed = True
        elif isinstance(outcome, BaseException):
            raise outcome
        else:
            results[name] = outcome
    if failed:
        return 1

    # Gate. An ordinary comprehension over values that are already named.
    below = [name for name, result in results.items() if result.values["reading"]["qualityScore"] < QUALITY_THRESHOLD]

    print(f"\n  {len(results)} regions in {time.monotonic() - started:.1f}s")
    print(f"  below threshold: {', '.join(below) or 'none'}")
    print(f"  runs: {', '.join(result.run_id for result in results.values())}\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
