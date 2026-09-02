# deepnote (Python)

Run Deepnote notebooks from Python: start a run, wait for it, pass its outputs to the next one.

```bash
pip install deepnote-sdk
```

```python
import asyncio
from datetime import date

from deepnote import Deepnote, outputs


async def main() -> None:
    async with Deepnote.from_env() as deepnote:  # DEEPNOTE_TOKEN, optionally DEEPNOTE_API_URL
        extract = deepnote.notebooks.define(
            "nb_extract",
            outputs={
                "dataset_uri": outputs.text("uri-block"),
                "row_count": outputs.json("stats-block", "row_count"),
            },
        )

        # Starting and waiting are separate, because they are separate in the API.
        run = await extract.run(inputs={"run_date": date.today(), "region": "eu"})
        print(run.id)  # the run continues in Deepnote whether or not this process does

        result = await run.wait(on_status=print)
        print(result.values["dataset_uri"], result.values["row_count"])


asyncio.run(main())
```

`run_and_wait()` is those two steps when you want them together.

## A pipeline is just Python

There is no workflow API to learn for the common case. `await` sequences, `asyncio.gather` fans
out, `if` branches, `try/except` handles failure:

```python
customers, products = await asyncio.gather(
    deepnote.notebooks["nb_customers"].run_and_wait(inputs={"date": run_date}),
    deepnote.notebooks["nb_products"].run_and_wait(inputs={"date": run_date}),
)

joined = await deepnote.notebooks["nb_join"].run_and_wait(
    inputs={
        "customers_uri": customers.values["uri"],
        "products_uri": products.values["uri"],
    }
)
```

Deepnote does not interpret that function; Python does. That is the distinction from Airflow,
Prefect and Dagster, and it is the reason the same code runs from cron, GitHub Actions, a Lambda, a
FastAPI route, a CLI, Temporal, or another Deepnote notebook — with Deepnote competing with none of
them. What the SDK adds is the remote operation being awaitable, typed, and named.

## From a notebook, or anywhere else that cannot `await`

A notebook kernel already has an event loop running, so `asyncio.run(...)` raises inside a cell.
`deepnote.sync` is the same client with the `await` removed: it drives the async client on a
background thread with a loop of its own and blocks the cell until each call settles.

```python
from deepnote.sync import Deepnote
from deepnote import outputs

deepnote = Deepnote.from_env()

extract = deepnote.notebooks.define("nb_extract", outputs={"rows": outputs.json("stats-block", "row_count")})
run = extract.run(inputs={"region": "eu"})
print(run.id)

result = run.wait(on_status=print)
result.values["rows"]
```

The surface is the same — `from_env()`, `notebooks[...]`, `notebooks.define(...)`, `run()`,
`run.wait()`, `runs.get()`, `run_and_wait()` — and so are the errors and the `RunResult`. The
background thread starts on the first call and stops on `close()` or when a `with` block exits.
Fan-out in the sync form is `concurrent.futures.ThreadPoolExecutor`, or simply several `run()`
calls followed by several `wait()` calls: a run is detached, so starting three and waiting for
three is already concurrent.

## Named outputs are a client-side contract

Inputs are symmetrical already: `POST /v2/runs` takes values keyed by the notebook's input-block
names. Outputs are not — a finished run is a snapshot of blocks, and only the author knows which
block holds the answer. So the mapping is declared on the client:

| Binding                                 | Reads                                        |
| --------------------------------------- | -------------------------------------------- |
| `outputs.text("block-id")`              | that block's textual output                  |
| `outputs.json("block-id", "totals.eu")` | that block's JSON, at a dotted path          |
| `outputs.last_json("row_count")`        | the run's last JSON output, at a dotted path |
| `outputs.all_text()`                    | every block's text, in notebook order        |
| `outputs.derived(fn)`                   | whatever you compute from the blocks         |

Errors name your binding rather than a block id you never typed:

```
Output 'eu_share' could not be read from totals.eu of block 'stats-block' of run run-42: …
```

`outputs.last_json()` is the one to prefer for a notebook Deepnote created from a file, since
Deepnote reassigns block ids on creation. Paths are dotted with numeric indexes and nothing more:
a binding that needs filters or wildcards is a computation, and computations belong in the notebook
or in the code that consumes the value.

For a typed result, pass a dataclass whose fields match the binding names:

```python
@dataclass
class ExtractOutput:
    dataset_uri: str
    row_count: int


extract = deepnote.notebooks.define("nb_extract", outputs={...}, output_type=ExtractOutput)
result = await extract.run_and_wait()
result.output.row_count  # int
```

## Failure

A failed run raises `DeepnoteRunError` carrying the whole result, because the snapshot is usually the
only place the failing block's own error is recorded:

```python
try:
    result = await notebook.run_and_wait(inputs=inputs)
except DeepnoteRunError as error:
    logger.error("run %s failed: %s", error.run_id, error.result.text)
    raise
```

`allow_failure=True` returns it instead. Waiting too long raises `DeepnoteRunTimeout`, which carries
the run id — the run is unaffected, so `await (await deepnote.runs.get(run_id)).wait()` picks it up.

There is no retry policy and no default retry. A notebook can write files, move data, or spend model
budget; repeating that implicitly is not a safe default. Wrap a call in your own retry once you have
made the notebook idempotent.

Polling is a different matter: `wait()` retries a poll that meets a 429, a 5xx, or a network error
(up to five times, backing off exponentially to a 30s ceiling), and re-fetches a finished run whose
snapshot has not been attached yet. Neither repeats the notebook — they repeat a `GET`.

## An optional workflow context

For observability, not orchestration. It names steps and emits an event when each one starts and
settles, so a multi-notebook script can be logged, traced, or drawn:

```python
async with deepnote.workflow("daily-revenue", on_event=log_event) as workflow:
    raw = await workflow.run("extract", notebook="nb_extract", inputs={"date": run_date})
    await workflow.run("publish", notebook="nb_publish", inputs={"source": raw.values["uri"]})
```

No scheduler, no daemon, no worker pool, no recovery database, no graph interpreter. Sequencing is
still `await`, concurrency is still `asyncio`, branching is still `if`.

## The boundary

**Deepnote pipelines are local Python composition, not durable orchestration.** This SDK does not
schedule work, persist workflow state, replay steps, or run workers. Each Deepnote run is
independently addressable and continues according to Deepnote's own execution semantics.

Concretely: if this process dies mid-pipeline, the notebook runs it started carry on — they are
detached — but nothing aggregates them and no gate fires. `deepnote.runs.get(run_id)` is how you pick
one back up. For durability you own less of, put the pipeline somewhere durable: a scheduled Deepnote
notebook, or Workflow SDK via [`@deepnote/pipelines/workflows`](../README.md).

## Development

```bash
cd packages/pipelines/python
python -m pip install -e '.[dev]'
python -m pytest
ruff check deepnote tests && ruff format --check deepnote tests
```

Every test is hermetic: `httpx.MockTransport` answers the requests, so nothing reaches the network
and no token is needed.

## License

Apache-2.0
