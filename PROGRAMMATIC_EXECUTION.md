# 🚀 Complete Deepnote Programmatic Execution System

> **TL;DR:** A complete Python script that can programmatically execute ANY Deepnote notebook via the Deepnote Kernel (a wrapper around Jupyter), enabling AI agents, batch processing, automated testing, and CI/CD integration.

---

## ✅ What's Been Built

A complete Python script (`scripts/execute-deepnote.py`) that can programmatically execute ANY Deepnote notebook by connecting to a running Deepnote Kernel. This enables:

- **AI agents** to run notebook code
- **Batch processing** of multiple notebooks
- **Automated testing** and validation
- **CI/CD integration** for data pipelines

---

## 📊 All Block Types - Fully Supported!

### 1. ✅ **Code Blocks**

- Full Python execution
- Matplotlib, Seaborn, Plotly visualizations
- NumPy, Pandas, Scikit-learn operations
- **Example:** Housing prediction ML model with visualizations

### 2. ✅ **Input Widgets** (All 7 Types)

- `input-text` - Text inputs
- `input-textarea` - Multi-line text
- `input-select` - Dropdown selections
- `input-slider` - Numeric sliders
- `input-checkbox` - Boolean checkboxes
- `input-date` - Date pickers
- `input-date-range` - Date range pickers

**Example:** All 7 widgets working in `2_blocks.deepnote`

### 3. ✅ **SQL Blocks** (4 Integration Types)

- **Pandas DataFrames (DuckDB)** - Query in-memory data with SQL!
- **ClickHouse** - Including free playground access
- **PostgreSQL** - Ready with credentials
- **MySQL/MariaDB** - Ready with credentials

**Example:** ClickHouse playground querying GitHub actors data

### 4. ✅ **Chart Blocks**

- **Code-based charts** - matplotlib, seaborn, plotly ✅
- **No-code chart blocks** - Deepnote visual builder ✅ (using `deepnote_toolkit.DeepnoteChart`)
- All chart types: bar, line, scatter, pie, donut, area, etc.

**Example:** Housing demo with seaborn scatter plots and box plots

---

## 🧪 Test Results - All Examples Pass!

```bash
✅ examples/1_hello_world.deepnote
   └─ 1 code block executed successfully

✅ examples/2_blocks.deepnote
   └─ 7 input widgets + 8 code blocks executed successfully

✅ examples/3_integrations.deepnote
   └─ 1 SQL block (ClickHouse playground, 100 rows)

✅ examples/demos/housing_price_prediction.deepnote
   └─ Init notebook
   └─ 14 code blocks (ML model training)
   └─ 1 SQL block (DuckDB analytics)
   └─ Beautiful seaborn visualizations
```

---

## 🎯 Key Features

### Auto-Detection

- **Kernel discovery** - No need to specify kernel ID
- **Init notebooks** - Automatically runs setup notebooks first
- **Multiple notebooks** - Handles projects with several notebooks

### Auto-Dependencies

- **Import analysis** - Extracts Python imports from code
- **requirements.txt generation** - Creates dependency file automatically
- **Automatic installation** - Installs packages before execution
- **SQL drivers** - Auto-adds DuckDB, ClickHouse, PostgreSQL drivers

### Smart Execution

- **Variable initialization** - Input widgets set before code runs
- **Working directory** - Properly set for file operations
- **Database connections** - Built from integration metadata
- **Error handling** - Clear reporting of which blocks failed

### Rich Output

- **Real-time display** - Shows output as code executes
- **Progress tracking** - Block-by-block execution status
- **Summary reports** - Final success/error count
- **Chart rendering** - Displays visualization info

---

## 📁 Files Created/Modified

```
.cursorrules                        # AI assistant rules for .deepnote files
scripts/execute-deepnote.py         # Main execution script (800+ lines)
scripts/README.md                   # Complete documentation
.gitignore                          # Ignores auto-generated files
```

---

## 🎓 Usage

### Basic Usage

```bash
# Auto-detect kernel and run
python scripts/execute-deepnote.py examples/1_hello_world.deepnote

# Specify kernel explicitly
python scripts/execute-deepnote.py examples/file.deepnote <kernel-id>
```

### Example Output

```
Auto-detected kernel: fdab3b56-52c0-4070-9936-e459aff26be9

Found 1 notebook(s):
  - 1. Hello World - example

Total: 1 code block(s)
======================================================================

✓ Connected to kernel fdab3b56-52c0-4070-9936-e459aff26be9

──────────────────────────────────────────────────────────────────────
📓 Notebook: 1. Hello World - example
──────────────────────────────────────────────────────────────────────

[1/1] Block a0 (15bc86a3):
    print("Hello world!")...
    Output:
      Hello world!

======================================================================
✅ Successfully executed all 1 code blocks!
```

---

## 🏆 What Makes This Special

1. **Complete Coverage** - Every major Deepnote block type supported
2. **Zero Manual Setup** - Auto-detects kernel, auto-installs dependencies
3. **Production Ready** - Handles errors, reports progress, cleans up
4. **AI-Friendly** - Clear output format, comprehensive error messages
5. **Deepnote Native** - Uses actual Deepnote toolkit for charts/SQL

---

## 💪 Real-World Example

The housing prediction demo showcases everything working together:

- ✅ Init notebook installs scikit-learn, matplotlib, seaborn
- ✅ Generates 300 synthetic housing records with 8 features
- ✅ Trains Random Forest regression model
- ✅ SQL analytics on age buckets using DuckDB
- ✅ Beautiful seaborn visualizations (scatter plot + box plot)
- ✅ All 14 code blocks + 1 SQL block execute flawlessly

---

## 🛠️ Technical Implementation

### Architecture

The system works by:

1. **Parsing** `.deepnote` YAML files to extract blocks
2. **Connecting** to a running Deepnote Kernel (wrapper around Jupyter)
3. **Initializing** input widget variables in the kernel
4. **Installing** dependencies from auto-generated `requirements.txt`
5. **Executing** blocks in order (init → code → SQL → charts)
6. **Capturing** outputs via Jupyter messaging protocol
7. **Reporting** results with clear success/error messages

### Key Technologies

- **Deepnote Kernel** - Jupyter-compatible kernel with enhanced features ([GitHub](https://github.com/deepnote/deepnote-toolkit), [PyPI](https://pypi.org/project/deepnote-toolkit/))
- **Jupyter Client** - For kernel communication protocol
- **YAML Parser** - For `.deepnote` file parsing
- **SQLAlchemy** - For database connections
- **DuckDB** - For SQL on pandas DataFrames
- **Deepnote Toolkit** - Provides `DeepnoteChart`, SQL execution, and component library

### Block Type Handlers

- **Code blocks** → Direct execution in Deepnote Kernel
- **Input widgets** → Variable initialization in kernel scope
- **SQL blocks** → SQLAlchemy/DuckDB queries → pandas DataFrames
- **Chart blocks** → `deepnote_toolkit.DeepnoteChart()` rendering (Vega-based visualizations)

### What is the Deepnote Kernel?

The [Deepnote Kernel](https://github.com/deepnote/deepnote-toolkit) is a Jupyter-compatible kernel with enhanced capabilities:

- **First-class SQL** - Native SQL execution without manual connector setup
- **Chart rendering** - Built-in Vega/Altair/Plotly visualization support
- **Component library** - Beautiful DataFrame rendering and interactive inputs
- **Curated libraries** - Pre-installed data science packages
- **Full Jupyter compatibility** - Works with standard Jupyter protocols

Available on [PyPI](https://pypi.org/project/deepnote-toolkit/) as `deepnote-toolkit` and powers both Deepnote Cloud and Deepnote Open Source.

---

## 🎯 Use Cases

### 1. AI Agents

AI assistants can now execute Deepnote notebooks programmatically:

```python
# AI agent workflow
notebook = parse_deepnote_file("analysis.deepnote")
results = execute_notebook(notebook)
if results.success:
    analyze_results(results.outputs)
```

### 2. Batch Processing

Process multiple notebooks in sequence:

```bash
for notebook in examples/*.deepnote; do
    python scripts/execute-deepnote.py "$notebook"
done
```

### 3. CI/CD Integration

Validate notebooks in your pipeline:

```yaml
# .github/workflows/test.yml
- name: Test Notebooks
  run: python scripts/execute-deepnote.py examples/test_suite.deepnote
```

### 4. Automated Testing

Ensure notebooks always work:

```bash
# Run all examples and check for errors
python scripts/execute-deepnote.py examples/1_hello_world.deepnote || exit 1
python scripts/execute-deepnote.py examples/2_blocks.deepnote || exit 1
```

---

## 🛠️ Real-World Development Workflow

Want to see how **Cursor (AI)** built and debugged a complex notebook using programmatic execution?

Check out the complete workflow showing how the AI created a **627-line Sales Analytics Dashboard** and debugged it in under 5 minutes using just 2 simple user prompts:

**[📖 Read the AI Development Workflow Guide →](./examples/demos/DEVELOPMENT_WORKFLOW.md)**

Includes:

- AI creating 627 lines from 1 prompt
- AI running programmatic execution
- AI identifying and fixing 3 errors automatically
- Before/after code examples
- Time breakdown (~5 minutes total, 2 user prompts)

---

## 🚧 Current Limitations

- **Requires active Deepnote Kernel** - Cannot create new kernels automatically (must have a `.deepnote` file open in VS Code/Cursor)
- **Text-only output** - Terminal display (no rich HTML/images in terminal)
- **SQL credentials** - External databases need configuration (but ClickHouse playground is free!)

---

## 🔮 Future Enhancements

Potential improvements:

- [ ] Kernel auto-creation support
- [ ] HTML output rendering
- [ ] More database integrations (MongoDB, BigQuery, etc.)
- [ ] Parallel block execution
- [ ] Output caching
- [ ] Notebook diffing for CI/CD

---

## 📚 Documentation

- **Script README**: `scripts/README.md` - Detailed usage guide
- **Cursor Rules**: `.cursorrules` - AI assistant guidelines for `.deepnote` files
- **Examples**: `examples/` - Working example notebooks

---

## 🤝 Development Story

This system was built iteratively through a collaborative AI-assisted development session:

1. **Phase 1**: Basic code block execution
2. **Phase 2**: Input widget support (all 7 types)
3. **Phase 3**: Init notebook handling + auto-dependencies
4. **Phase 4**: SQL block support (DuckDB + ClickHouse)
5. **Phase 5**: Chart block support (visual builder + code-based)

Each phase built upon the previous, resulting in a comprehensive execution system that handles every major Deepnote block type.

---

## 🎉 Result

A production-ready system that transforms Deepnote from an interactive tool into a programmable platform, enabling automation, AI integration, and seamless CI/CD workflows.

**Try it yourself:**

```bash
python scripts/execute-deepnote.py examples/demos/housing_price_prediction.deepnote
```

Watch as it auto-installs dependencies, trains an ML model, runs SQL analytics, and creates beautiful visualizations - all programmatically! 🚀
