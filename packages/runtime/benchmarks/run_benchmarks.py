#!/usr/bin/env python3
"""Benchmark runner: compares deepnote-runtime vs ipykernel.

Measures:
1. Startup time (import + initialization)
2. Per-cell execution overhead
3. End-to-end notebook execution
4. Output capture overhead

For ipykernel, we measure the kernel-side overhead by using it in-process
(no ZMQ, no Jupyter server) to isolate the execution engine from the
transport layer. This gives ipykernel every advantage.
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Benchmark infrastructure
# ---------------------------------------------------------------------------

WARMUP_RUNS = 2
BENCH_RUNS = 10
NOTEBOOKS_DIR = Path(__file__).parent / "notebooks"


@dataclass
class BenchResult:
    name: str
    times_ms: list[float] = field(default_factory=list)

    @property
    def mean_ms(self) -> float:
        return statistics.mean(self.times_ms) if self.times_ms else 0

    @property
    def median_ms(self) -> float:
        return statistics.median(self.times_ms) if self.times_ms else 0

    @property
    def stdev_ms(self) -> float:
        return statistics.stdev(self.times_ms) if len(self.times_ms) > 1 else 0

    @property
    def min_ms(self) -> float:
        return min(self.times_ms) if self.times_ms else 0

    def __repr__(self) -> str:
        return f"{self.name}: {self.median_ms:.2f}ms median ({self.min_ms:.2f}ms min, {self.stdev_ms:.2f}ms stdev, n={len(self.times_ms)})"


def timed(fn, warmup=WARMUP_RUNS, runs=BENCH_RUNS) -> BenchResult:
    """Time a function with warmup and multiple runs."""
    name = getattr(fn, "__name__", str(fn))
    result = BenchResult(name=name)

    for _ in range(warmup):
        fn()

    for _ in range(runs):
        start = time.perf_counter()
        fn()
        elapsed = (time.perf_counter() - start) * 1000
        result.times_ms.append(elapsed)

    return result


# ---------------------------------------------------------------------------
# 1. Startup / Import benchmark
# ---------------------------------------------------------------------------

def bench_import_deepnote_runtime() -> BenchResult:
    """Measure time to import deepnote_runtime from scratch."""
    import importlib

    def run():
        # Remove all cached modules
        mods_to_remove = [k for k in sys.modules if k.startswith("deepnote_runtime")]
        for m in mods_to_remove:
            del sys.modules[m]
        importlib.import_module("deepnote_runtime")

    return timed(run, warmup=1, runs=BENCH_RUNS)


def bench_import_ipykernel() -> BenchResult:
    """Measure time to import ipykernel from scratch."""
    import importlib

    def run():
        mods_to_remove = [k for k in sys.modules if k.startswith(("ipykernel", "IPython", "traitlets", "jupyter", "comm", "debugpy", "zmq", "tornado"))]
        for m in mods_to_remove:
            del sys.modules[m]
        importlib.import_module("ipykernel")

    return timed(run, warmup=1, runs=BENCH_RUNS)


# ---------------------------------------------------------------------------
# 2. Initialization benchmark
# ---------------------------------------------------------------------------

def bench_init_deepnote_runtime() -> BenchResult:
    """Measure time to create a ready-to-execute engine."""
    from deepnote_runtime.reactive import ReactiveEngine
    from deepnote_runtime.shim import install_shim

    def run():
        install_shim()
        engine = ReactiveEngine()

    return timed(run)


def bench_init_ipykernel() -> BenchResult:
    """Measure time to create an IPython InteractiveShell."""
    from IPython.core.interactiveshell import InteractiveShell

    def run():
        shell = InteractiveShell.instance()
        shell.reset()

    # Need to create once to set up singleton
    InteractiveShell.clear_instance()
    shell = InteractiveShell.instance()
    result = timed(run)
    return result


# ---------------------------------------------------------------------------
# 3. Single cell execution benchmarks
# ---------------------------------------------------------------------------

def bench_exec_single_cell_deepnote(code: str) -> BenchResult:
    """Measure single cell execution in deepnote-runtime."""
    from deepnote_runtime.compiler import CodeCache, execute
    from deepnote_runtime.namespace import create_namespace
    from deepnote_runtime.output import OutputCapture, capture_output

    cache = CodeCache()

    def run():
        ns = create_namespace()
        capture = OutputCapture()
        with capture_output(capture):
            ns["display"] = capture.display_fn
            result = execute(code, ns, code_cache=cache)
            capture.set_result(result)
        capture.collect_outputs()

    return timed(run)


def bench_exec_single_cell_ipython(code: str) -> BenchResult:
    """Measure single cell execution in IPython."""
    from IPython.core.interactiveshell import InteractiveShell

    InteractiveShell.clear_instance()
    shell = InteractiveShell.instance()

    def run():
        shell.reset()
        shell.run_cell(code, silent=True)

    return timed(run)


# ---------------------------------------------------------------------------
# 4. Full notebook execution benchmarks
# ---------------------------------------------------------------------------

def bench_notebook_deepnote(notebook_path: Path) -> BenchResult:
    """Execute a full .deepnote notebook with our runtime."""
    from deepnote_runtime.parser import parse_file
    from deepnote_runtime.reactive import ReactiveEngine
    from deepnote_runtime.shim import install_shim

    install_shim()
    df = parse_file(notebook_path)
    nb = df.project.notebooks[0]

    def run():
        engine = ReactiveEngine()
        engine.execute_notebook(nb)

    return timed(run)


def bench_notebook_ipython(notebook_path: Path) -> BenchResult:
    """Execute the equivalent cells with IPython's shell."""
    import yaml
    from IPython.core.interactiveshell import InteractiveShell

    # Parse the .deepnote to get code cells
    with open(notebook_path) as f:
        data = yaml.safe_load(f)

    code_cells = []
    for nb in data["project"]["notebooks"]:
        for block in sorted(nb.get("blocks", []), key=lambda b: b.get("sortingKey", "")):
            if block.get("type") == "code":
                code_cells.append(block.get("content", ""))

    InteractiveShell.clear_instance()
    shell = InteractiveShell.instance()

    def run():
        shell.reset()
        for code in code_cells:
            shell.run_cell(code, silent=True)

    return timed(run)


# ---------------------------------------------------------------------------
# 5. Output overhead benchmark
# ---------------------------------------------------------------------------

def bench_output_overhead_deepnote() -> BenchResult:
    """Measure output capture overhead with many print statements."""
    from deepnote_runtime.compiler import execute
    from deepnote_runtime.namespace import create_namespace
    from deepnote_runtime.output import OutputCapture, capture_output

    code = "for i in range(1000): print(f'line {i}')"

    def run():
        ns = create_namespace()
        capture = OutputCapture()
        with capture_output(capture):
            execute(code, ns)
        capture.collect_outputs()

    return timed(run)


def bench_output_overhead_ipython() -> BenchResult:
    """Measure output capture overhead with IPython."""
    from IPython.core.interactiveshell import InteractiveShell

    InteractiveShell.clear_instance()
    shell = InteractiveShell.instance()
    code = "for i in range(1000): print(f'line {i}')"

    def run():
        shell.run_cell(code, silent=True)

    return timed(run)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def format_comparison(ours: BenchResult, theirs: BenchResult) -> str:
    """Format a side-by-side comparison."""
    speedup = theirs.median_ms / ours.median_ms if ours.median_ms > 0 else float("inf")
    return (
        f"  deepnote-runtime: {ours.median_ms:8.2f}ms median (min: {ours.min_ms:.2f}ms)\n"
        f"  ipykernel/IPython: {theirs.median_ms:8.2f}ms median (min: {theirs.min_ms:.2f}ms)\n"
        f"  speedup: {speedup:.1f}x"
    )


def main():
    print("=" * 70)
    print("DEEPNOTE RUNTIME vs IPYKERNEL BENCHMARK")
    print(f"Python {sys.version}")
    print(f"Warmup: {WARMUP_RUNS} runs, Benchmark: {BENCH_RUNS} runs")
    print("=" * 70)
    print()

    results: list[dict[str, Any]] = []

    # --- 1. Import time ---
    print("1. IMPORT TIME")
    print("-" * 40)
    ours = bench_import_deepnote_runtime()
    theirs = bench_import_ipykernel()
    print(format_comparison(ours, theirs))
    results.append({"bench": "Import", "ours_median": ours.median_ms, "ours_min": ours.min_ms,
                     "theirs_median": theirs.median_ms, "theirs_min": theirs.min_ms})
    print()

    # --- 2. Initialization ---
    print("2. ENGINE INITIALIZATION")
    print("-" * 40)
    ours = bench_init_deepnote_runtime()
    theirs = bench_init_ipykernel()
    print(format_comparison(ours, theirs))
    results.append({"bench": "Init", "ours_median": ours.median_ms, "ours_min": ours.min_ms,
                     "theirs_median": theirs.median_ms, "theirs_min": theirs.min_ms})
    print()

    # --- 3. Single cell execution ---
    print("3. SINGLE CELL EXECUTION")
    print("-" * 40)

    cells = {
        "pass (noop)": "pass",
        "assignment": "x = 42",
        "print": "print('hello')",
        "list comprehension": "[x**2 for x in range(100)]",
        "function def + call": "def f(n):\n    return sum(range(n))\nf(1000)",
        "import": "import json",
    }

    for label, code in cells.items():
        print(f"  [{label}]")
        ours = bench_exec_single_cell_deepnote(code)
        theirs = bench_exec_single_cell_ipython(code)
        speedup = theirs.median_ms / ours.median_ms if ours.median_ms > 0 else float("inf")
        print(f"    ours: {ours.median_ms:.3f}ms  theirs: {theirs.median_ms:.3f}ms  ({speedup:.1f}x)")
        results.append({"bench": f"Cell: {label}", "ours_median": ours.median_ms, "ours_min": ours.min_ms,
                         "theirs_median": theirs.median_ms, "theirs_min": theirs.min_ms})
    print()

    # --- 4. Full notebook execution ---
    print("4. FULL NOTEBOOK EXECUTION")
    print("-" * 40)

    notebooks = sorted(NOTEBOOKS_DIR.glob("*.deepnote"))
    for nb_path in notebooks:
        label = nb_path.stem
        print(f"  [{label}]")
        try:
            ours = bench_notebook_deepnote(nb_path)
            theirs = bench_notebook_ipython(nb_path)
            speedup = theirs.median_ms / ours.median_ms if ours.median_ms > 0 else float("inf")
            print(f"    ours: {ours.median_ms:.3f}ms  theirs: {theirs.median_ms:.3f}ms  ({speedup:.1f}x)")
            results.append({"bench": f"Notebook: {label}", "ours_median": ours.median_ms, "ours_min": ours.min_ms,
                             "theirs_median": theirs.median_ms, "theirs_min": theirs.min_ms})
        except Exception as e:
            print(f"    ERROR: {e}")
    print()

    # --- 5. Output overhead ---
    print("5. OUTPUT OVERHEAD (1000 print statements)")
    print("-" * 40)
    ours = bench_output_overhead_deepnote()
    theirs = bench_output_overhead_ipython()
    print(format_comparison(ours, theirs))
    results.append({"bench": "Output 1000 prints", "ours_median": ours.median_ms, "ours_min": ours.min_ms,
                     "theirs_median": theirs.median_ms, "theirs_min": theirs.min_ms})
    print()

    # --- Summary ---
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"{'Benchmark':<35} {'Ours (ms)':>10} {'Theirs (ms)':>12} {'Speedup':>8}")
    print("-" * 70)
    for r in results:
        speedup = r["theirs_median"] / r["ours_median"] if r["ours_median"] > 0 else float("inf")
        print(f"{r['bench']:<35} {r['ours_median']:>10.2f} {r['theirs_median']:>12.2f} {speedup:>7.1f}x")
    print()

    # Save raw results
    raw_path = Path(__file__).parent / "results.json"
    with open(raw_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Raw results saved to: {raw_path}")


if __name__ == "__main__":
    main()
