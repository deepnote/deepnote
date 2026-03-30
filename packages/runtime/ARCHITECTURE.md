# Deepnote Runtime: Architectural Overview

> A fast, modern Jupyter kernel alternative for executing `.deepnote` files.
> Think: what uv did for pip, but for notebook execution.

---

## Table of Contents

1. [Motivation](#motivation)
2. [The .deepnote File Format](#the-deepnote-file-format)
3. [ipykernel: What We're Replacing](#ipykernel-what-were-replacing)
4. [Jupyter Messaging Protocol: What We Must Implement](#jupyter-messaging-protocol-what-we-must-implement)
5. [Where ipykernel Is Slow](#where-ipykernel-is-slow)
6. [Prior Art & Lessons](#prior-art--lessons)
7. [Proposed Architecture](#proposed-architecture)
8. [Component Breakdown](#component-breakdown)
9. [What We Keep vs. Drop](#what-we-keep-vs-drop)
10. [Speed Strategy](#speed-strategy)
11. [Open Questions](#open-questions)

---

## Motivation

ipykernel is the reference Jupyter kernel for Python. It works, but it carries 12+ years of legacy:

- **Slow startup** (1-60s depending on environment) due to deep dependency tree
- **6+ threads** for a fundamentally sequential execution model
- **Full IPython import** even when magics/history aren't needed
- **ZMQ + JSON** serialization on every message (4 JSON dicts + HMAC per message)
- **Tornado event loop** wrapping asyncio, requiring `nest_asyncio` hacks
- **~15 direct dependencies**, each pulling their own trees

We want to build a kernel that:

1. Reads and executes `.deepnote` files natively
2. Speaks the Jupyter wire protocol (compatible with JupyterLab, VS Code, Deepnote)
3. Drops legacy baggage that no modern frontend uses
4. Is measurably faster at startup, execution dispatch, and output streaming

---

## The .deepnote File Format

### Overview

`.deepnote` is a YAML-based notebook format that replaces `.ipynb`'s JSON. Key properties:

- **Human-readable YAML** — clean diffs, version-control friendly
- **Project-level organization** — one file can contain multiple notebooks
- **Block-based** (not cell-based) — richer block types beyond code/markdown
- **Snapshot separation** — outputs stored in `.snapshot.deepnote` files, keeping source clean
- **Reactive execution** — blocks can automatically re-run when dependencies change

### Top-Level Structure

```yaml
version: "1.0.0"
metadata:
  createdAt: 1730735698208       # ms timestamp
  modifiedAt: 1736850561964
  snapshotHash: "sha256..."      # hash of all content hashes
project:
  id: "uuid-v4"
  name: "My Project"
  notebooks:
    - id: "uuid-v4"
      name: "Analysis"
      executionMode: block        # "block" (individual) or "all" (sequential)
      blocks: [...]
  settings: {}
integrations: [...]               # optional: database connections
environment:                      # optional: Python version, packages
  python: "3.11"
  packages: [...]
```

### Block Types

| Type | Purpose | Has Outputs? |
|------|---------|-------------|
| `code` | Python code execution | Yes |
| `sql` | Database queries | Yes |
| `markdown` | Rich text (rendered) | No |
| `text-cell-h1/h2/h3/p` | Heading/paragraph text | No |
| `visualization` | Vega-Lite charts | Yes |
| `dataframe` | Interactive DataFrame explorer | Yes |
| `input-text` | Text input widget | No (produces variable) |
| `input-textarea` | Multi-line text input | No (produces variable) |
| `input-select` | Dropdown selection | No (produces variable) |
| `input-slider` | Numeric slider | No (produces variable) |
| `input-checkbox` | Boolean toggle | No (produces variable) |
| `input-date` | Date picker | No (produces variable) |
| `input-date-range` | Date range picker | No (produces variable) |
| `image` | Embedded image | No |
| `separator` | Visual divider | No |

### Block Schema

```yaml
- id: "block-uuid"
  blockGroup: "group-uuid"        # groups related blocks
  type: code
  content: |
    import pandas as pd
    df = pd.read_csv("data.csv")
    df.head()
  contentHash: "sha256..."        # SHA-256 of content field
  sortingKey: "a0"                # determines visual order
  executionCount: 1
  metadata:
    execution_start: 1762216339555
    execution_millis: 7
    execution_context_id: "ctx-uuid"
  outputs:                        # Jupyter-compatible output format
    - output_type: execute_result
      execution_count: 1
      data:
        text/plain: "'shape: (100, 5)'"
        text/html: "<table>...</table>"
```

### Input Block Schema

```yaml
- id: "input-uuid"
  type: input-slider
  metadata:
    deepnote_variable_name: count
    deepnote_input_label: "Number of items"
    deepnote_variable_value: 5
    deepnote_input_min: 0
    deepnote_input_max: 100
    deepnote_input_step: 1
```

### Output Format (Jupyter-Compatible)

Outputs follow the standard Jupyter output format:

```yaml
# Stream output (stdout/stderr)
- output_type: stream
  name: stdout
  text: "Hello from inline outputs!\n"

# Rich display output
- output_type: execute_result
  execution_count: 2
  data:
    text/plain: "4"
    text/html: "<b>4</b>"
    application/vnd.deepnote.dataframe.v3+json: {...}

# Error output
- output_type: error
  ename: ValueError
  evalue: "invalid literal"
  traceback: [...]
```

### Snapshot Files (`.snapshot.deepnote`)

Snapshots = source `.deepnote` + populated outputs. Two types:

1. **Latest snapshot** (`_latest.snapshot.deepnote`) — incrementally updated as blocks execute
2. **Timestamped snapshot** (`_2025-01-08T10-30-00.snapshot.deepnote`) — immutable point-in-time state

```
project/
├── source.deepnote
└── snapshots/
    ├── source_<project-id>_latest.snapshot.deepnote
    └── source_<project-id>_2025-01-08T10-30-00.snapshot.deepnote
```

The `snapshotHash` is computed from: all block contentHashes + environment hash + version + integration metadata. Temporal and execution metadata are excluded.

### Reactive Execution Model

With `executionMode: block`, input blocks produce variables that code blocks can reference. When an input value changes, dependent blocks re-execute automatically. This is a **key differentiator** from traditional Jupyter — it implies the runtime must understand block dependencies.

---

## ipykernel: What We're Replacing

### Architecture

ipykernel is a **multi-threaded Python application** with 6+ threads:

```
┌─────────────────────────────────────────────────────────┐
│ IPKernelApp (Tornado IOLoop)                            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ShellChannel │  │ ControlThread│  │  IOPubThread  │  │
│  │   Thread     │  │              │  │              │  │
│  │              │  │  interrupt   │  │  aggregates  │  │
│  │  routes msg  │  │  shutdown    │  │  all output  │  │
│  │  to subshell │  │  debug       │  │  via PULL    │  │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘  │
│         │                                    │          │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──────▼───────┐  │
│  │ Main Thread  │  │  Heartbeat   │  │  fd-watcher  │  │
│  │ (execution)  │  │   Thread     │  │  Threads (2) │  │
│  │              │  │  ping/pong   │  │  stdout/err  │  │
│  │  IPython     │  │              │  │  pipe redir  │  │
│  │  Shell       │  └──────────────┘  └──────────────┘  │
│  └──────────────┘                                       │
│                                                         │
│  ZMQ Sockets: shell(ROUTER) + control(ROUTER) +        │
│               iopub(XPUB) + stdin(ROUTER) + hb(REP)    │
└─────────────────────────────────────────────────────────┘
```

### Class Hierarchy

```
SingletonConfigurable (traitlets)
  └── Kernel (kernelbase.py)           # Base protocol
        └── IPythonKernel (ipkernel.py) # IPython execution
              └── InProcessKernel       # In-process variant

InteractiveShell (IPython)
  └── ZMQInteractiveShell (zmqshell.py) # ZMQ-adapted shell
```

### Code Execution Flow

1. Client sends `execute_request` on Shell socket
2. `ShellChannelThread` deserializes, routes to main thread via inproc socket
3. `dispatch_shell()` acquires asyncio.Lock
4. `set_parent()` establishes message context via `contextvars`
5. Publishes `status: busy` on IOPub
6. Handler lookup: `shell_handlers["execute_request"]`
7. Delegates to `ZMQInteractiveShell.run_cell()`
8. `OutStream` intercepts stdout/stderr → IOPubThread via PUSH socket
9. Display output → IOPubThread as `display_data`
10. `execute_reply` sent back on Shell
11. Publishes `status: idle` on IOPub
12. Lock released

### Dependency Tree

```
ipykernel
├── ipython (huge: ~50+ submodules, jedi, pygments, pexpect...)
├── pyzmq (C extension, libzmq)
├── tornado (event loop framework)
├── traitlets (configuration/type system)
├── jupyter_client (session mgmt, msg serialization)
│   └── jupyter_core, python-dateutil, pyzmq, tornado, traitlets
├── debugpy (Microsoft DAP, large)
├── comm (comm protocol)
├── nest_asyncio2 (event loop hack)
├── matplotlib-inline
├── psutil (C extension)
└── packaging
```

**Python ≥3.10 required. Total import time: 1-60s.**

---

## Jupyter Messaging Protocol: What We Must Implement

### Wire Format

Every message = multipart ZMQ frame sequence:

```
[zmq_identities...]         # ZMQ ROUTER routing frames
b'<IDS|MSG>'                # delimiter
HMAC-SHA256 signature       # hex string, computed over next 4 frames
header (JSON)               # msg_id, session, msg_type, version, date
parent_header (JSON)        # originating message's header
metadata (JSON)             # extensible metadata
content (JSON)              # payload (schema depends on msg_type)
buffer_0, buffer_1, ...     # optional raw binary buffers
```

### Five ZMQ Channels

| Channel | Socket | Purpose |
|---------|--------|---------|
| **Shell** | ROUTER | Request/reply for execution, completion, inspection |
| **Control** | ROUTER | High-priority: interrupt, shutdown, debug (separate thread, never blocked by shell) |
| **IOPub** | PUB/XPUB | Broadcast: stdout, display, status, errors |
| **Stdin** | ROUTER | Kernel requests user input (`input()`) |
| **Heartbeat** | REP | Bytestring ping/echo for liveness |

### Connection File

```json
{
  "transport": "tcp",
  "ip": "127.0.0.1",
  "shell_port": 57503,
  "iopub_port": 57504,
  "stdin_port": 57505,
  "control_port": 57506,
  "hb_port": 57507,
  "signature_scheme": "hmac-sha256",
  "key": "unique-secret-key"
}
```

Kernel receives path via `{connection_file}` in launch argv.

### Message Types — Full Catalog

#### Shell Channel (Request → Reply)

| Request | Reply | Purpose | Priority |
|---------|-------|---------|----------|
| `execute_request` | `execute_reply` | Execute code | **MUST** |
| `kernel_info_request` | `kernel_info_reply` | Kernel capabilities | **MUST** |
| `complete_request` | `complete_reply` | Tab completion | **SHOULD** |
| `inspect_request` | `inspect_reply` | Object introspection/tooltips | **SHOULD** |
| `is_complete_request` | `is_complete_reply` | Multi-line input detection | NICE |
| `history_request` | `history_reply` | Execution history | NICE |
| `comm_info_request` | `comm_info_reply` | List open comms | **SHOULD** (widgets) |

#### Control Channel (Request → Reply)

| Request | Reply | Purpose | Priority |
|---------|-------|---------|----------|
| `shutdown_request` | `shutdown_reply` | Shutdown/restart | **MUST** |
| `interrupt_request` | `interrupt_reply` | Interrupt execution | **MUST** |
| `debug_request` | `debug_reply` | DAP debugging | LATER |

#### IOPub Channel (Kernel → Client broadcasts)

| Message | Purpose | Priority |
|---------|---------|----------|
| `status` | busy/idle/starting | **MUST** |
| `stream` | stdout/stderr | **MUST** |
| `execute_result` | Cell result (MIME bundle) | **MUST** |
| `display_data` | Rich output (MIME bundle) | **MUST** |
| `update_display_data` | Update existing display by ID | **SHOULD** |
| `execute_input` | Echo of code being executed | **SHOULD** |
| `error` | Exception + traceback | **MUST** |
| `clear_output` | Clear cell output | **SHOULD** |
| `comm_open/msg/close` | Widget comm protocol | **SHOULD** (widgets) |

#### Stdin Channel

| Message | Purpose | Priority |
|---------|---------|----------|
| `input_request` | Kernel asks for user text input | **SHOULD** |
| `input_reply` | Frontend sends response | **SHOULD** |

### Key Message Schemas

**execute_request:**
```json
{
  "code": "print('hello')",
  "silent": false,
  "store_history": true,
  "user_expressions": {},
  "allow_stdin": true,
  "stop_on_error": true
}
```

**execute_reply (success):**
```json
{
  "status": "ok",
  "execution_count": 42,
  "payload": [],
  "user_expressions": {}
}
```

**kernel_info_reply:**
```json
{
  "status": "ok",
  "protocol_version": "5.4",
  "implementation": "deepnote-runtime",
  "implementation_version": "0.1.0",
  "language_info": {
    "name": "python",
    "version": "3.12.0",
    "mimetype": "text/x-python",
    "file_extension": ".py",
    "pygments_lexer": "ipython3",
    "codemirror_mode": {"name": "ipython", "version": 3}
  },
  "banner": "Deepnote Runtime 0.1.0"
}
```

**display_data / execute_result:**
```json
{
  "data": {
    "text/plain": "repr",
    "text/html": "<table>...</table>",
    "image/png": "base64..."
  },
  "metadata": {},
  "transient": {"display_id": "unique-id"}
}
```

### Comm Protocol (for Widgets)

Comms provide bidirectional kernel ↔ frontend messaging. Required for ipywidgets support.

```
comm_open  → {comm_id, target_name, data}    # Open channel
comm_msg   → {comm_id, data}                  # Send data
comm_close → {comm_id, data}                  # Close channel
```

Widget state sync: attributes tagged `sync=True` serialize to `comm_msg` with `{method: "update", state: {...}}`.

---

## Where ipykernel Is Slow

### 1. Startup Time (1-60 seconds)

| Bottleneck | Cost | Root Cause |
|-----------|------|------------|
| IPython import | 200-500ms | 50+ submodules, jedi, pygments |
| pyzmq + socket binding | 50-100ms | 5 ZMQ sockets, port allocation |
| traitlets initialization | 50-100ms | Configuration system setup |
| jupyter_client session | 50ms | Message factory, HMAC key |
| debugpy | 100-200ms | DAP server initialization |
| User startup scripts | 0-30s+ | IPython profiles, `exec_lines` |

**Opportunity:** A minimal kernel importing only `ast`, `sys`, `json` starts in <50ms.

### 2. Per-Message Overhead

Each message requires:
- 4x JSON serialization (header, parent_header, metadata, content)
- HMAC-SHA256 computation over all 4 serialized frames
- ZMQ multipart send (memory copies, framing)
- On receive: reverse (deserialize 4x JSON + verify HMAC)

**Measured:** ~100-500μs per message round-trip on localhost.

### 3. Output Streaming

- `OutStream.flush_interval` = 200ms default batching delay
- `_execute_sleep` = 0.5ms deliberate delay for output ordering
- fd-watching spawns 2 extra threads, redirects through pipes
- IOPubThread is a serialization bottleneck (single aggregation point)

### 4. Event Loop Complexity

- Tornado wraps asyncio → unnecessary abstraction layer
- `nest_asyncio` patches Python internals to allow nested event loops
- GUI event loop polling at 1ms intervals (wasteful for non-GUI)
- 6+ threads contending on GIL

### 5. Architectural Overhead

- traitlets adds introspection/validation cost on every attribute access
- ZMQ context creation is expensive (thread pool, IO threads)
- Connection file JSON parsing on every startup
- Session UUID generation, HMAC key setup

---

## Prior Art & Lessons

### xeus-python (C++ Jupyter kernel)

- **~9% faster** in Voila dashboards, **10-15% more** in "raw mode" (no IPython)
- Built on C++ xeus library, <3000 lines
- Trade-off: no IPython magics support
- Lesson: **IPython is the heaviest dependency; bypassing it yields real gains**

### Deno's Built-in Kernel

- First language runtime with kernel embedded directly
- Zero separate installation, leverages V8 inspector
- Lesson: **Embedding kernel into runtime eliminates an IPC layer**

### Marimo (Reactive Notebooks)

- Constructs DAG of cell dependencies via static analysis
- Reactive execution: changing a variable re-runs only downstream cells
- Stored as pure `.py` files
- Lesson: **Dependency-aware execution eliminates redundant computation**

### Kernel Forking (Experimental ipykernel PR)

- `fork()` from warm template process for near-instant kernel startup
- Challenge: ZMQ contexts are not fork-safe
- Lesson: **Pre-forking works but transport layer must be fork-safe**

### uv's Speed Playbook

| uv Strategy | Kernel Analogy |
|-------------|----------------|
| Rust + Tokio async | Native launcher with true parallelism for message dispatch |
| Lock-free caching | Cache compiled code objects, import state |
| Eliminate unnecessary work | Don't parse full messages when routing; peek at headers |
| `.rkyv` zero-copy deserialization | msgspec/MessagePack for message frames |
| Single static binary | Compiled kernel launcher, no bootstrap overhead |
| PubGrub CDCL resolver | Dependency graph for reactive re-execution |

---

## Proposed Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                     deepnote-runtime                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Protocol Layer (Python, thin)                             │  │
│  │                                                           │  │
│  │  ┌─────────┐ ┌─────────┐ ┌──────┐ ┌───────┐ ┌────────┐  │  │
│  │  │  Shell   │ │ Control │ │IOPub │ │ Stdin │ │Heartbt │  │  │
│  │  │ (ROUTER) │ │(ROUTER) │ │(PUB) │ │(ROUTER│ │ (REP)  │  │  │
│  │  └────┬─────┘ └────┬────┘ └──┬───┘ └───┬───┘ └───┬────┘  │  │
│  │       │            │         │          │         │        │  │
│  │  ┌────▼────────────▼─────────▼──────────▼─────────▼────┐  │  │
│  │  │            Message Router                           │  │  │
│  │  │  - Deserialize (msgspec)                            │  │  │
│  │  │  - HMAC verify                                      │  │  │
│  │  │  - Route to handler                                 │  │  │
│  │  └────────────────────┬────────────────────────────────┘  │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                      │
│  ┌───────────────────────▼───────────────────────────────────┐  │
│  │ Execution Engine                                          │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │   Compiler   │  │  Namespace    │  │  Output Capture │  │  │
│  │  │              │  │  Manager      │  │                 │  │  │
│  │  │  AST parse   │  │              │  │  sys.stdout     │  │  │
│  │  │  compile()   │  │  user_ns     │  │  sys.stderr     │  │  │
│  │  │  code cache  │  │  variables   │  │  display()      │  │  │
│  │  └──────────────┘  │  inputs      │  │  rich MIME      │  │  │
│  │                    └──────────────┘  └─────────────────┘  │  │
│  │                                                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │  Completions  │  │  Inspection   │  │  Comm Manager   │  │  │
│  │  │  (jedi lazy)  │  │  (inspect)    │  │  (widgets)      │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ .deepnote Runtime Layer                                   │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │ YAML Parser  │  │  Dependency   │  │  Snapshot       │  │  │
│  │  │ & Validator  │  │  Graph        │  │  Manager        │  │  │
│  │  │              │  │              │  │                 │  │  │
│  │  │ .deepnote    │  │  block deps  │  │  contentHash   │  │  │
│  │  │ .snapshot    │  │  reactive    │  │  latest/timed  │  │  │
│  │  │ schema       │  │  re-exec     │  │  snapshotHash  │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘  │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐                        │  │
│  │  │ Input Block  │  │  SQL Block    │                        │  │
│  │  │ Handler      │  │  Handler      │                        │  │
│  │  │              │  │              │                        │  │
│  │  │ variables    │  │ integrations │                        │  │
│  │  │ validation   │  │ query exec   │                        │  │
│  │  └──────────────┘  └──────────────┘                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Threading Model (Minimal)

```
Main Thread           Control Thread        Heartbeat Thread
─────────────         ──────────────        ────────────────
Shell socket    ←→    Control socket        HB socket
  │                     │                     │
  ▼                     ▼                     ▼
Message Router        interrupt/shutdown    ping/pong (trivial)
  │
  ▼
Execute code
  │
  ▼
IOPub publish (direct, no aggregation thread)
```

**3 threads instead of 6+.** IOPub publishing happens directly from the execution thread (no aggregation thread needed when there's a single execution context). The fd-watching threads are eliminated in favor of a simpler `sys.stdout`/`sys.stderr` replacement.

---

## Component Breakdown

### 1. Protocol Layer

**Responsibility:** Speak the Jupyter wire protocol over ZMQ.

| Component | Description |
|-----------|-------------|
| `connection.py` | Parse connection file, bind ZMQ sockets |
| `message.py` | Message serialization/deserialization (msgspec) |
| `auth.py` | HMAC-SHA256 signing/verification |
| `router.py` | Route incoming messages to handlers by `msg_type` |
| `session.py` | Session ID, execution counter, parent tracking |

**Key decisions:**
- Use `pyzmq` for protocol compatibility (ZMQ is the protocol, not just transport)
- Use `msgspec` for JSON serialization (5-10x faster than stdlib `json`)
- Lazy HMAC verification (verify only when `key` is non-empty)
- Pre-allocate message templates to reduce per-message allocation

### 2. Execution Engine

**Responsibility:** Execute Python code and capture all outputs.

| Component | Description |
|-----------|-------------|
| `compiler.py` | `compile()` + AST transforms, code object cache |
| `namespace.py` | User namespace management, variable injection (inputs) |
| `output.py` | stdout/stderr capture, display hook, MIME bundle construction |
| `completer.py` | Tab completion via jedi (lazy-loaded) |
| `inspector.py` | Object inspection via `inspect` module |
| `comm.py` | Comm protocol for widget support |
| `interrupts.py` | Signal-based and message-based interrupt handling |

**Key decisions:**
- **No IPython dependency.** Use `compile()` + `exec()` directly. This is the single biggest speed win.
- Lazy-load `jedi` only on first `complete_request`
- Implement a minimal `display()` function that builds MIME bundles
- Support `_repr_html_()`, `_repr_png_()`, etc. (the repr protocol is independent of IPython)
- Code object caching: hash source → cached bytecode

### 3. .deepnote Runtime Layer

**Responsibility:** Understand and execute `.deepnote` files natively.

| Component | Description |
|-----------|-------------|
| `parser.py` | YAML parsing and schema validation |
| `dependency.py` | Static analysis of block dependencies (AST-based) |
| `reactive.py` | Reactive re-execution engine (input → dependent blocks) |
| `snapshot.py` | Read/write `.snapshot.deepnote` files, hash computation |
| `inputs.py` | Input block handling, variable injection, validation |
| `sql.py` | SQL block execution against integrations |
| `runner.py` | Orchestrate execution of a `.deepnote` file (block-by-block or reactive) |

**Key decisions:**
- Use `PyYAML` or `ruamel.yaml` for parsing (ruamel preserves formatting for round-trip)
- Build dependency graph via `ast.parse()` → extract variable reads/writes per block
- Reactive execution: topological sort of dependency DAG, re-execute dirty subgraph
- Snapshot writes are atomic (write to temp, rename)

### 4. Kernel Application

**Responsibility:** Tie everything together, manage lifecycle.

| Component | Description |
|-----------|-------------|
| `app.py` | Entry point, CLI argument parsing, kernel lifecycle |
| `kernel.py` | Main kernel class, message handler registration |
| `kernelspec.py` | Install/manage kernel.json for Jupyter discovery |

**kernel.json:**
```json
{
  "argv": ["python", "-m", "deepnote_runtime", "-f", "{connection_file}"],
  "display_name": "Deepnote Runtime (Python 3)",
  "language": "python",
  "interrupt_mode": "message"
}
```

---

## What We Keep vs. Drop

### KEEP (Required for Compatibility)

| Feature | Reason |
|---------|--------|
| Jupyter wire protocol (v5.4) | All frontends speak this |
| ZMQ channels (all 5) | Protocol requirement |
| HMAC authentication | Security |
| MIME bundle outputs | Rich display standard |
| `display()` function | Used by every visualization library |
| `_repr_*_()` protocol | pandas, matplotlib, plotly all use this |
| Comm API | ipywidgets ecosystem |
| `input()` support (stdin channel) | Common in notebooks |
| Execution counter | Frontend UIs depend on it |
| Signal-based + message-based interrupts | Both modes needed |

### DROP (Legacy / Rarely Used)

| Feature | Reason |
|---------|--------|
| IPython magics (`%timeit`, `%%bash`, etc.) | Can be replicated with stdlib; massive dependency |
| IPython history (SQLite backend) | Frontends maintain their own history |
| IPython profiles / startup scripts | Unnecessary complexity |
| `user_expressions` in execute_request | Rarely used by any frontend |
| `payload` in execute_reply | Deprecated, no replacement |
| Tornado event loop | Pure asyncio is sufficient |
| traitlets configuration system | Use simple dataclasses or plain dicts |
| `nest_asyncio` hacks | Design around needing nested event loops |
| debugpy / DAP integration | Add later as optional plugin |
| `appnope` (macOS App Nap) | Edge case |
| `matplotlib-inline` backend | Users can configure matplotlib themselves |
| InProcessKernel | Niche use case |
| Subshell support (v5.5 experimental) | Too new, rarely used |
| GUI event loop integration (Qt, Tk, GTK) | Server-side kernel doesn't need GUI loops |

### ADD (New Capabilities)

| Feature | Reason |
|---------|--------|
| Native `.deepnote` file parsing | Core requirement |
| Reactive block execution | `.deepnote` format feature |
| Input block handling | `.deepnote` format feature |
| SQL block execution | `.deepnote` format feature |
| Dependency graph analysis | Enables reactive execution |
| Snapshot management | `.deepnote` format feature |
| Code object caching | Performance |
| Fast startup (target: <100ms) | UX |

---

## Speed Strategy

### Startup: Target <100ms (vs ipykernel's 1-60s)

| Strategy | Expected Gain |
|----------|---------------|
| No IPython import | -200-500ms |
| No traitlets import | -50-100ms |
| No tornado import | -50ms |
| No debugpy import | -100-200ms |
| Lazy jedi import (only on complete_request) | -100-300ms |
| Minimal imports: `sys, ast, json, hmac, hashlib, threading` | Baseline ~20ms |
| Connection file: msgspec JSON parse | ~1ms vs ~5ms |

### Per-Message: Target <50μs (vs ipykernel's 100-500μs)

| Strategy | Expected Gain |
|----------|---------------|
| msgspec JSON (not stdlib json) | 3-5x faster serialization |
| Pre-built message templates | Avoid re-creating header dicts |
| Lazy HMAC (skip when key is empty) | Eliminate crypto for local connections |
| Direct IOPub publish (no aggregation thread) | Eliminate thread handoff |
| Batch small outputs | Reduce message count |

### Execution: Target <1ms overhead per cell (vs ipykernel's ~2-5ms)

| Strategy | Expected Gain |
|----------|---------------|
| `compile()` + `exec()` directly | Skip IPython's transform pipeline |
| Code object cache (source hash → bytecode) | Skip re-compilation for unchanged cells |
| No IPython AST transforms | Eliminate `autoawait`, magic transforms |
| Minimal stdout/stderr wrapper | No fd-watching threads, no pipe redirection |
| Direct `contextvars` for parent tracking | Already used by ipykernel, just less overhead |

### Output Streaming: No artificial delays

| Strategy | Expected Gain |
|----------|---------------|
| No 200ms flush interval | Immediate output |
| No 0.5ms execute_sleep | Eliminate deliberate delay |
| No fd-watching threads | Simpler, less overhead |
| Configurable buffering | Users choose latency vs throughput |

### Import Optimization

| Strategy | Description |
|----------|-------------|
| Lazy imports everywhere | Only import when first needed |
| `importlib.import_module()` for optional deps | jedi, yaml, sql drivers |
| Module-level `__getattr__` | Defer submodule imports |

---

## Open Questions

### Architecture

1. **Should we write the protocol layer in Rust?** The uv analogy suggests a compiled core would help, but adds build complexity. We could start in pure Python and optimize later.

-> Python is good for now.

2. **How much IPython compatibility do we actually need?** Libraries like pandas and matplotlib use `_repr_html_()` which is a Python protocol, not IPython. But some libraries check `get_ipython()` to detect notebook environments. We may need a minimal `get_ipython()` shim.

-> Yes, let's do the shim.

3. **Should we support `%magic` commands at all?** Some are genuinely useful (`%time`, `%timeit`, `%pip install`). We could implement a small subset as Python functions instead.

-> No, let's skip magic commands for now. If the user needs to run something in a terminal, we'll use a new block type called shell.

4. **Event loop story for async user code:** If a user writes `await something`, ipykernel uses `nest_asyncio` + AST transforms to make it work. We need a strategy. Options:
   - Run user code in a separate thread with its own event loop
   - AST-detect top-level `await` and wrap in `asyncio.run()`
   - Use Python 3.12+ `asyncio.Runner` for cleaner nested execution

-> use python 3.12. in general assume that the minimum required version for our runtime is 3.12.

5. **ZMQ vs. alternative transport:** ZMQ is part of the Jupyter protocol spec. We must use it for Jupyter compatibility. But for .deepnote-native execution (no Jupyter frontend), we could offer a faster IPC path.

-> no need for the the compatibiltiy with jupyter frontend.

### .deepnote Specific

6. **Dependency analysis granularity:** Do we analyze at variable level (fine-grained) or block level (coarser but simpler)? Variable-level enables more precise reactive execution but is harder to implement correctly (especially with `import *`, `exec()`, globals mutation).

-> let's do it on the variable level. if someone is trying to do eval()-like stuff they must understand that the reactivity will be broken. if you detect something like that, throw a warning, but we don't need to support that.

7. **SQL block execution:** Should we embed database drivers or use a plugin system? The `integrations` field in `.deepnote` files suggests a pluggable approach.

-> no need for database drivers. we'll deal with it later.

8. **Input block UI:** When running headlessly (no frontend), how do input blocks get their values? From the `.deepnote` file's `deepnote_variable_value`? From CLI arguments?

-> yes, the user should be able to pass variables via cli arguments.

9. **Snapshot write strategy:** Write-ahead log? Atomic rename? How to handle concurrent reads during snapshot write?

-> no idea, go for the simplest option for now.

10. **Multi-notebook execution:** A `.deepnote` project can contain multiple notebooks. Should they share a namespace? Execute in isolation? What's the execution order?

-> if only one notebook is present, execute that one. if there are more, the user will need to either pass it via an arg or the cli will ask him to choose interactively.

### Compatibility

11. **`get_ipython()` shim:** Many libraries (matplotlib, pandas, tqdm) check `get_ipython()` to detect notebook mode and adjust output format. We need to decide how complete this shim needs to be. Options:
    - Full `InteractiveShell` duck-type (complex)
    - Minimal object with `.__class__.__name__ = 'ZMQInteractiveShell'` (hacky but works for most checks)
    - Environment variable approach (`JUPYTER_RUNTIME=1`)

-> minimal object and env variable. make sure it's clearly documented.

12. **Which Jupyter protocol version?** v5.4 is stable and widely supported. v5.5 adds subshells and debug improvements but is experimental. Recommend: implement v5.4, declare v5.4 in kernel_info_reply.

-> 5.4.

13. **Comm protocol version for widgets:** ipywidgets uses comm protocol v2 with specific target names. We need to implement the comm manager to support the widget ecosystem.

-> ipywidgets shouldn't be supported, skip that.

---

## Summary

The core thesis: **most of ipykernel's weight comes from IPython, and most of ipykernel's latency comes from its threading model and serialization.** By executing Python directly via `compile()` + `exec()`, using `msgspec` for serialization, and reducing to 3 threads, we can build a kernel that:

- Starts in **<100ms** (vs 1-60s)
- Adds **<1ms** overhead per cell execution (vs 2-5ms)
- Delivers output with **<10ms** latency (vs 200ms+ batching)
- Reads `.deepnote` files natively with reactive execution
- Remains fully compatible with Jupyter frontends via the wire protocol
- Supports the rich display and widget ecosystems without IPython dependency
