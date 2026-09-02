"""
Deepnote SDK for Python.

    import asyncio
    from deepnote import Deepnote, outputs

    async def main() -> None:
        async with Deepnote.from_env() as deepnote:
            extract = deepnote.notebooks.define(
                "nb_extract",
                outputs={"dataset_uri": outputs.text("uri-block")},
            )
            result = await extract.run_and_wait(inputs={"region": "eu"})
            print(result.values["dataset_uri"])

    asyncio.run(main())

A pipeline is a Python function. `await` sequences it, `asyncio.gather` fans it out, `if`
branches it, `try/except` handles failure. Python executes the pipeline; this package only makes
each remote operation awaitable, typed, and named.
"""

from deepnote import outputs
from deepnote._client import API_URL_ENV, TOKEN_ENV, Deepnote
from deepnote._http import DEFAULT_BASE_URL
from deepnote._snapshot import BlockOutput, parse_snapshot_blocks
from deepnote.errors import DeepnoteAPIError, DeepnoteError, DeepnoteRunError, DeepnoteRunTimeout
from deepnote.notebooks import NotebookRef, NotebooksResource
from deepnote.outputs import OutputBinding
from deepnote.runs import Run, RunResult, RunsResource, to_run_inputs
from deepnote.workflow import StepCompleted, StepFailed, StepStarted, Workflow

__all__ = [
    "API_URL_ENV",
    "BlockOutput",
    "DEFAULT_BASE_URL",
    "Deepnote",
    "DeepnoteAPIError",
    "DeepnoteError",
    "DeepnoteRunError",
    "DeepnoteRunTimeout",
    "NotebookRef",
    "NotebooksResource",
    "OutputBinding",
    "Run",
    "RunResult",
    "RunsResource",
    "StepCompleted",
    "StepFailed",
    "StepStarted",
    "TOKEN_ENV",
    "Workflow",
    "outputs",
    "parse_snapshot_blocks",
    "to_run_inputs",
]
