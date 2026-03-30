#!/usr/bin/env python3
"""Headless benchmark: deepnote-runtime vs Jupyter (nbclient).

This is the real-world comparison. For Jupyter, we use nbclient which is what
`jupyter execute` and `nbconvert --execute` use under the hood:
  - Spawns a real kernel subprocess
  - Connects via ZMQ sockets
  - Sends execute_request messages per cell
  - Collects outputs via iopub channel
  - Shuts down kernel via control channel

For deepnote-runtime, we use the Python API (in-process) and the CLI
(subprocess cold-start).
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import nbformat
import yaml
from nbclient import NotebookClient

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WARMUP_RUNS = 2
BENCH_RUNS = 5  # Fewer runs since headless Jupyter is slow
NOTEBOOKS_DIR = Path(__file__).parent / "notebooks"
IPYNB_DIR = Path(__file__).parent / "notebooks_ipynb"
PYTHON = sys.executable


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@dataclass
class BenchResult:
    name: str
    times_ms: list[float] = field(default_factory=list)

    @property
    def median_ms(self) -> float:
        return statistics.median(self.times_ms) if self.times_ms else 0

    @property
    def min_ms(self) -> float:
        return min(self.times_ms) if self.times_ms else 0

    @property
    def stdev_ms(self) -> float:
        return statistics.stdev(self.times_ms) if len(self.times_ms) > 1 else 0

    def __repr__(self) -> str:
        return f"{self.name}: {self.median_ms:.1f}ms median ({self.min_ms:.1f}ms min, n={len(self.times_ms)})"


def deepnote_to_ipynb(deepnote_path: Path) -> Path:
    """Convert a .deepnote file to .ipynb for Jupyter execution."""
    with open(deepnote_path) as f:
        data = yaml.safe_load(f)

    code_cells = []
    for nb in data["project"]["notebooks"]:
        for block in sorted(nb.get("blocks", []), key=lambda b: b.get("sortingKey", "")):
            if block.get("type") == "code":
                source = block.get("content", "")
                # Strip trailing newline from YAML block scalar
                source = source.rstrip("\n")
                code_cells.append(source)

    # Build nbformat notebook
    notebook = nbformat.v4.new_notebook()
    notebook.cells = [nbformat.v4.new_code_cell(source=src) for src in code_cells]
    notebook.metadata["kernelspec"] = {
        "display_name": "Python 3",
        "language": "python",
        "name": "python3",
    }

    IPYNB_DIR.mkdir(exist_ok=True)
    out_path = IPYNB_DIR / f"{deepnote_path.stem}.ipynb"
    with open(out_path, "w") as f:
        nbformat.write(notebook, f)

    return out_path


# ---------------------------------------------------------------------------
# Benchmark: Jupyter headless via nbclient
# ---------------------------------------------------------------------------

def bench_nbclient(ipynb_path: Path, warmup: int = WARMUP_RUNS, runs: int = BENCH_RUNS) -> BenchResult:
    """Execute a notebook via nbclient (real kernel, ZMQ, full stack)."""
    result = BenchResult(name=f"nbclient: {ipynb_path.stem}")

    for _ in range(warmup):
        nb = nbformat.read(str(ipynb_path), as_version=4)
        client = NotebookClient(nb, timeout=60, kernel_name="python3")
        client.execute()

    for _ in range(runs):
        nb = nbformat.read(str(ipynb_path), as_version=4)
        client = NotebookClient(nb, timeout=60, kernel_name="python3")

        start = time.perf_counter()
        client.execute()
        elapsed = (time.perf_counter() - start) * 1000

        result.times_ms.append(elapsed)

    return result


# ---------------------------------------------------------------------------
# Benchmark: deepnote-runtime in-process
# ---------------------------------------------------------------------------

def bench_deepnote_inprocess(deepnote_path: Path, warmup: int = WARMUP_RUNS, runs: int = BENCH_RUNS) -> BenchResult:
    """Execute a .deepnote notebook in-process with our runtime."""
    from deepnote_runtime.parser import parse_file
    from deepnote_runtime.reactive import ReactiveEngine
    from deepnote_runtime.shim import install_shim

    install_shim()
    df = parse_file(deepnote_path)
    nb = df.project.notebooks[0]

    result = BenchResult(name=f"deepnote (in-process): {deepnote_path.stem}")

    for _ in range(warmup):
        engine = ReactiveEngine()
        engine.execute_notebook(nb)

    for _ in range(runs):
        engine = ReactiveEngine()
        start = time.perf_counter()
        engine.execute_notebook(nb)
        elapsed = (time.perf_counter() - start) * 1000
        result.times_ms.append(elapsed)

    return result


# ---------------------------------------------------------------------------
# Benchmark: subprocess cold-start
# ---------------------------------------------------------------------------

def bench_subprocess_deepnote(deepnote_path: Path, runs: int = BENCH_RUNS) -> BenchResult:
    """Measure cold-start: `python -m deepnote_runtime.cli run <file>`."""
    result = BenchResult(name=f"deepnote (subprocess): {deepnote_path.stem}")

    # Warmup (1 run)
    subprocess.run(
        [PYTHON, "-m", "deepnote_runtime.cli", "run", str(deepnote_path)],
        capture_output=True,
    )

    for _ in range(runs):
        start = time.perf_counter()
        subprocess.run(
            [PYTHON, "-m", "deepnote_runtime.cli", "run", str(deepnote_path)],
            capture_output=True,
        )
        elapsed = (time.perf_counter() - start) * 1000
        result.times_ms.append(elapsed)

    return result


def bench_subprocess_jupyter(ipynb_path: Path, runs: int = BENCH_RUNS) -> BenchResult:
    """Measure cold-start: `jupyter execute <file.ipynb>`."""
    result = BenchResult(name=f"jupyter execute (subprocess): {ipynb_path.stem}")

    # Warmup (1 run)
    subprocess.run(
        [PYTHON, "-m", "jupyter", "execute", str(ipynb_path)],
        capture_output=True,
    )

    for _ in range(runs):
        start = time.perf_counter()
        subprocess.run(
            [PYTHON, "-m", "jupyter", "execute", str(ipynb_path)],
            capture_output=True,
        )
        elapsed = (time.perf_counter() - start) * 1000
        result.times_ms.append(elapsed)

    return result


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def format_row(notebook: str, ours_ms: float, theirs_ms: float) -> str:
    speedup = theirs_ms / ours_ms if ours_ms > 0 else float("inf")
    return f"  {notebook:<25} {ours_ms:>10.1f}ms  {theirs_ms:>10.1f}ms  {speedup:>7.1f}x"


def main():
    print("=" * 75)
    print("HEADLESS BENCHMARK: deepnote-runtime vs Jupyter (nbclient)")
    print(f"Python {sys.version}")
    print(f"Warmup: {WARMUP_RUNS}, Bench runs: {BENCH_RUNS}")
    print("=" * 75)
    print()

    # Step 1: Convert all .deepnote notebooks to .ipynb
    print("Converting .deepnote → .ipynb ...")
    notebooks = sorted(NOTEBOOKS_DIR.glob("*.deepnote"))
    ipynb_map: dict[str, Path] = {}
    for nb_path in notebooks:
        ipynb_path = deepnote_to_ipynb(nb_path)
        ipynb_map[nb_path.stem] = ipynb_path
        print(f"  {nb_path.name} → {ipynb_path.name}")
    print()

    results: list[dict[str, Any]] = []

    # -----------------------------------------------------------------------
    # Section 1: In-process — deepnote-runtime API vs nbclient
    # -----------------------------------------------------------------------
    print("=" * 75)
    print("SECTION 1: IN-PROCESS EXECUTION")
    print("  deepnote-runtime: ReactiveEngine().execute_notebook()")
    print("  Jupyter: nbclient (starts kernel subprocess + ZMQ per run)")
    print("=" * 75)
    print()
    print(f"  {'Notebook':<25} {'deepnote':>12}  {'nbclient':>12}  {'Speedup':>8}")
    print("  " + "-" * 63)

    for nb_path in notebooks:
        label = nb_path.stem
        ipynb_path = ipynb_map[label]
        try:
            ours = bench_deepnote_inprocess(nb_path)
            theirs = bench_nbclient(ipynb_path)
            print(format_row(label, ours.median_ms, theirs.median_ms))
            results.append({
                "section": "in-process",
                "notebook": label,
                "deepnote_median_ms": round(ours.median_ms, 3),
                "deepnote_min_ms": round(ours.min_ms, 3),
                "jupyter_median_ms": round(theirs.median_ms, 3),
                "jupyter_min_ms": round(theirs.min_ms, 3),
            })
        except Exception as e:
            print(f"  {label:<25} ERROR: {e}")

    print()

    # -----------------------------------------------------------------------
    # Section 2: Subprocess cold-start — deepnote CLI vs jupyter execute
    # -----------------------------------------------------------------------
    print("=" * 75)
    print("SECTION 2: SUBPROCESS COLD-START (wall-clock)")
    print("  deepnote-runtime: python -m deepnote_runtime.cli run <file>")
    print("  Jupyter: jupyter execute <file.ipynb>")
    print("=" * 75)
    print()
    print(f"  {'Notebook':<25} {'deepnote':>12}  {'jupyter':>12}  {'Speedup':>8}")
    print("  " + "-" * 63)

    for nb_path in notebooks:
        label = nb_path.stem
        ipynb_path = ipynb_map[label]
        try:
            ours = bench_subprocess_deepnote(nb_path)
            theirs = bench_subprocess_jupyter(ipynb_path)
            print(format_row(label, ours.median_ms, theirs.median_ms))
            results.append({
                "section": "subprocess",
                "notebook": label,
                "deepnote_median_ms": round(ours.median_ms, 1),
                "deepnote_min_ms": round(ours.min_ms, 1),
                "jupyter_median_ms": round(theirs.median_ms, 1),
                "jupyter_min_ms": round(theirs.min_ms, 1),
            })
        except Exception as e:
            print(f"  {label:<25} ERROR: {e}")

    print()

    # -----------------------------------------------------------------------
    # Section 3: Memory comparison (subprocess peak RSS)
    # -----------------------------------------------------------------------
    print("=" * 75)
    print("SECTION 3: PEAK MEMORY (subprocess)")
    print("=" * 75)
    print()

    # Use /usr/bin/time -l on macOS for peak RSS
    mem_results = {}
    for label_name, cmd in [
        ("deepnote", [PYTHON, "-m", "deepnote_runtime.cli", "run", str(notebooks[0])]),
        ("jupyter", [PYTHON, "-m", "jupyter", "execute", str(ipynb_map[notebooks[0].stem])]),
    ]:
        # macOS: /usr/bin/time -l reports max RSS in bytes
        # Linux: /usr/bin/time -v reports max RSS in KB
        try:
            proc = subprocess.run(
                ["/usr/bin/time", "-l"] + cmd,
                capture_output=True,
                text=True,
            )
            stderr = proc.stderr
            # Look for "maximum resident set size" on macOS
            for line in stderr.split("\n"):
                if "maximum resident set size" in line:
                    # macOS format: "   12345678  maximum resident set size"
                    rss_bytes = int(line.strip().split()[0])
                    mem_results[label_name] = rss_bytes
                    break
        except Exception as e:
            print(f"  Could not measure memory for {label_name}: {e}")

    if mem_results:
        for name, rss in mem_results.items():
            mb = rss / (1024 * 1024)
            print(f"  {name}: {mb:.1f} MB peak RSS")
        if "deepnote" in mem_results and "jupyter" in mem_results:
            ratio = mem_results["jupyter"] / mem_results["deepnote"]
            print(f"  Jupyter uses {ratio:.1f}x more memory")
        results.append({
            "section": "memory",
            "deepnote_peak_mb": round(mem_results.get("deepnote", 0) / (1024 * 1024), 1),
            "jupyter_peak_mb": round(mem_results.get("jupyter", 0) / (1024 * 1024), 1),
        })
    print()

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    print("=" * 75)
    print("SUMMARY")
    print("=" * 75)

    in_process = [r for r in results if r.get("section") == "in-process"]
    subprocess_results = [r for r in results if r.get("section") == "subprocess"]

    if in_process:
        print()
        print("In-process execution (deepnote API vs nbclient):")
        print(f"  {'Notebook':<25} {'deepnote':>10} {'jupyter':>10} {'Speedup':>8}")
        print("  " + "-" * 55)
        for r in in_process:
            speedup = r["jupyter_median_ms"] / r["deepnote_median_ms"] if r["deepnote_median_ms"] > 0 else float("inf")
            print(f"  {r['notebook']:<25} {r['deepnote_median_ms']:>9.2f}ms {r['jupyter_median_ms']:>9.1f}ms {speedup:>7.0f}x")

    if subprocess_results:
        print()
        print("Subprocess cold-start (deepnote CLI vs jupyter execute):")
        print(f"  {'Notebook':<25} {'deepnote':>10} {'jupyter':>10} {'Speedup':>8}")
        print("  " + "-" * 55)
        for r in subprocess_results:
            speedup = r["jupyter_median_ms"] / r["deepnote_median_ms"] if r["deepnote_median_ms"] > 0 else float("inf")
            print(f"  {r['notebook']:<25} {r['deepnote_median_ms']:>8.0f}ms {r['jupyter_median_ms']:>8.0f}ms {speedup:>7.1f}x")

    print()

    # Save results
    raw_path = Path(__file__).parent / "headless_results.json"
    with open(raw_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Raw results saved to: {raw_path}")


if __name__ == "__main__":
    main()
