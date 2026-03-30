# Benchmarks: deepnote-runtime vs Jupyter

> Measured on Apple Silicon (M-series), Python 3.13.5, 2026-03-28

## Methodology

We benchmark **deepnote-runtime** against **Jupyter's real execution stack** at two levels:

1. **Headless execution** (`run_headless.py`) — the real-world comparison. Jupyter side uses `nbclient` (the library behind `jupyter execute` and `nbconvert --execute`), which spawns a real kernel subprocess, connects via ZMQ, sends `execute_request` messages per cell, and collects outputs via the IOPub channel. This is what CI/CD pipelines, papermill, and batch runners actually use.

2. **In-process microbenchmarks** (`run_benchmarks.py`) — isolates per-cell overhead by testing against IPython's `InteractiveShell` directly, bypassing ZMQ/Tornado. This gives ipykernel every advantage and shows where the overhead comes from.

Each headless benchmark runs 2 warmup iterations followed by 5 timed iterations. In-process benchmarks use 10 timed iterations. We report the **median**.

## Results

### Headless Notebook Execution (the real-world scenario)

This is the comparison that matters. Both sides execute the same notebook content end-to-end:

- **deepnote-runtime**: `ReactiveEngine().execute_notebook()` — single process, direct `compile()` + `exec()`
- **Jupyter (nbclient)**: spawns kernel subprocess → ZMQ handshake → execute_request per cell → collect IOPub outputs → shutdown kernel

| Notebook | Blocks | deepnote-runtime | Jupyter (nbclient) | Speedup |
|----------|--------|-------------------|---------------------|---------|
| 01_startup (pass) | 1 | 0.017ms | 666ms | **39,000x** |
| 02_hello_world | 1 | 0.038ms | 621ms | **16,000x** |
| 03_sequential_10 | 10 | 0.29ms | 687ms | **2,400x** |
| 04_sequential_50 | 50 | 1.6ms | 802ms | **500x** |
| 05_computation | 5 | 1.1ms | 697ms | **630x** |
| 06_output_heavy (200 prints) | 2 | 0.20ms | 687ms | **3,400x** |
| 07_imports (15 imports) | 3 | 0.25ms | 668ms | **2,700x** |
| 08_rich_output (20 display calls) | 2 | 0.52ms | 666ms | **1,300x** |

Jupyter's ~650ms baseline is dominated by kernel startup + ZMQ connection establishment. The actual Python execution is negligible — the entire overhead is infrastructure.

### Subprocess Cold-Start (wall-clock, end-to-end)

Time from process start to completion, including Python interpreter startup:

- **deepnote-runtime**: `python -m deepnote_runtime.cli run <file.deepnote>`
- **Jupyter**: `jupyter execute <file.ipynb>`

| Notebook | deepnote-runtime | Jupyter | Speedup |
|----------|-------------------|---------|---------|
| 01_startup | 56ms | 1,366ms | **24x** |
| 02_hello_world | 56ms | 1,398ms | **25x** |
| 03_sequential_10 | 57ms | 1,399ms | **25x** |
| 04_sequential_50 | 56ms | 1,472ms | **26x** |
| 05_computation | 57ms | 1,396ms | **25x** |
| 06_output_heavy | 58ms | 1,553ms | **27x** |
| 07_imports | 56ms | 1,350ms | **24x** |
| 08_rich_output | 56ms | 1,383ms | **25x** |

deepnote-runtime completes any notebook in ~56ms (mostly Python interpreter startup). Jupyter takes 1.3-1.5 seconds — it needs to start the orchestrator process, spawn a kernel subprocess, establish ZMQ connections, exchange messages, and shut down.

### Memory

| Runtime | Peak RSS |
|---------|----------|
| **deepnote-runtime** | **28 MB** |
| Jupyter (kernel + client) | 92 MB |
| **Ratio** | **3.3x less memory** |

Jupyter needs two Python processes (nbclient orchestrator + kernel subprocess), each with their own import trees. deepnote-runtime is a single process with minimal imports.

### In-Process Microbenchmarks (per-cell overhead)

To isolate execution engine overhead from kernel startup, we also benchmark against IPython's `InteractiveShell` directly (no ZMQ, no kernel subprocess — gives ipykernel every advantage):

| Cell Content | deepnote-runtime | ipykernel (in-process) | Speedup |
|-------------|-------------------|------------------------|---------|
| `pass` (noop) | 0.006ms | 11.4ms | **2,066x** |
| `x = 42` | 0.009ms | 12.3ms | **1,364x** |
| `print('hello')` | 0.016ms | 11.6ms | **721x** |
| `[x**2 for x in range(100)]` | 0.038ms | 12.7ms | **335x** |
| `def f(n): return sum(range(n)); f(1000)` | 0.051ms | 16.0ms | **314x** |
| `import json` | 0.007ms | 12.0ms | **1,714x** |

Even when we strip away Jupyter's kernel/ZMQ overhead and give IPython a direct in-process call, there's still 300-2000x overhead from IPython's `run_cell()` pipeline: input transformation, AST transforms, magic detection, history recording, display hooks.

## Where the Time Goes

### Jupyter headless (~1.4 seconds for a trivial notebook)

```
jupyter execute <file.ipynb>:
  Python interpreter startup:                      ~30ms
  nbclient imports (nbformat, jupyter_client):     ~200ms
  Kernel provisioning:
    → spawn python subprocess:                     ~100ms
    → kernel loads ipykernel + IPython + zmq:      ~300ms
    → ZMQ socket setup + connection file:          ~50ms
    → handshake (kernel_info_request/reply):        ~50ms
  Per-cell execution:
    → execute_request via ZMQ:                     ~0.5ms
    → IPython run_cell() overhead:                 ~11ms
    → execute_reply + iopub messages via ZMQ:      ~1ms
  Kernel shutdown (shutdown_request + process):    ~200ms
  Output collection + notebook write:              ~50ms
  ─────────────────────────────────────────────────────
  Total:                                           ~1,400ms
  Time spent on actual Python code:                ~0.01ms
```

### deepnote-runtime (~56ms for a trivial notebook)

```
deepnote run <file.deepnote>:
  Python interpreter startup:                      ~30ms
  deepnote_runtime imports (yaml, ast, sys):       ~20ms
  YAML parse:                                      ~1ms
  Engine creation (dataclass):                     ~0.001ms
  Per-cell execution:
    → compile() + exec():                          ~0.005ms
    → output capture (StringIO swap):              ~0.001ms
  ─────────────────────────────────────────────────────
  Total:                                           ~56ms
  Time spent on actual Python code:                ~0.01ms
```

The 25x subprocess speedup is conservative — both sides pay ~30ms for Python interpreter startup. If you subtract that constant, the actual execution overhead is ~26ms (deepnote) vs ~1,370ms (Jupyter), which is **53x**.

## What This Means

### CI/CD: running 100 notebooks

| Runtime | Time | Memory |
|---------|------|--------|
| **deepnote-runtime** | **~6 seconds** | **28 MB** |
| Jupyter (nbclient) | ~2.5 minutes | 92 MB per run |

Each Jupyter invocation pays the 1.4s kernel startup tax. For batch execution of many notebooks, the overhead compounds linearly.

### Single notebook (typical 10-20 blocks)

| Metric | deepnote-runtime | Jupyter (headless) |
|--------|-------------------|--------------------|
| Execution time | 56-58ms | 1,350-1,550ms |
| Peak memory | 28 MB | 92 MB |
| Dependencies | 1 (pyyaml) | 15+ packages |

### Interactive development (in-process, per keystroke)

| Metric | deepnote-runtime | Jupyter |
|--------|-------------------|---------|
| Per-cell overhead | 0.006ms | 650ms+ (kernel) or 11ms (IPython direct) |
| Reactive re-execution | sub-millisecond | N/A |

## Why Is It So Fast?

The speedup comes from **what we don't do**, not from clever optimization:

| Jupyter does this | We don't |
|-------------------|----------|
| Spawn kernel subprocess | Single process |
| ZMQ socket setup + HMAC signing | No IPC needed |
| Import IPython (50+ submodules, jedi, pygments) | Import only `ast`, `sys`, `hashlib` |
| Initialize traitlets configuration system | Plain dataclass instantiation |
| Set up magic system + input transformers | No magic support |
| Create SQLite history database | No history |
| Initialize debugpy DAP server | No debugger |
| Route messages through ZMQ PUB/SUB/DEALER/ROUTER | Direct function calls |
| Buffer output with 200ms flush interval | `sys.stdout = StringIO()` |
| Serialize/deserialize every message as JSON + HMAC | No serialization |

## Reproducing

```bash
# From the runtime/ directory
python -m venv .venv
.venv/bin/pip install -e ".[dev]" ipykernel jupyter_client nbclient nbformat

# Headless benchmark (real-world comparison)
.venv/bin/python benchmarks/run_headless.py

# In-process microbenchmarks (per-cell overhead)
.venv/bin/python benchmarks/run_benchmarks.py
```

Raw results are saved to `benchmarks/headless_results.json` and `benchmarks/results.json`.

## Benchmark Notebooks

| File | Description | Blocks |
|------|-------------|--------|
| `01_startup.deepnote` | Single `pass` statement | 1 |
| `02_hello_world.deepnote` | Single print | 1 |
| `03_sequential_10.deepnote` | 10 chained assignments (a=1, b=a+1, ...) | 10 |
| `04_sequential_50.deepnote` | 50 chained assignments | 50 |
| `05_computation.deepnote` | List comprehension + statistics | 5 |
| `06_output_heavy.deepnote` | 200 lines of printed output | 2 |
| `07_imports.deepnote` | 15 stdlib imports | 3 |
| `08_rich_output.deepnote` | 20 display() calls with _repr_html_ | 2 |
