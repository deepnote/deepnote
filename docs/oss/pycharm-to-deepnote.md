---
title: Moving from PyCharm to Deepnote
description: Migration guide for PyCharm users switching to Deepnote for data science and notebook-based development.
noIndex: false
noContent: false
---

# Moving from PyCharm to Deepnote

This guide helps PyCharm users understand how Deepnote complements or replaces PyCharm for data science, analytics, and exploratory programming workflows.

## PyCharm vs Deepnote: Understanding the Difference

### PyCharm Strengths

PyCharm excels at:
- ✅ Traditional software development
- ✅ Large codebases and applications
- ✅ Refactoring and code navigation
- ✅ Debugging complex applications
- ✅ Test-driven development
- ✅ Package management

### Deepnote Strengths

Deepnote excels at:
- ✅ Exploratory data analysis
- ✅ Interactive computing
- ✅ Data visualization
- ✅ Rapid prototyping
- ✅ Documentation with code
- ✅ Sharing and collaboration
- ✅ Reproducible research

### When to Use Each

**Use PyCharm for:**
- Building production applications
- Large Python projects
- Backend development
- API development
- Package development
- Complex refactoring

**Use Deepnote for:**
- Data analysis and exploration
- Machine learning experiments
- Statistical analysis
- Data visualization
- Report generation
- Teaching and learning
- Collaborative research

**Use Both:**
- Develop libraries in PyCharm
- Use libraries in Deepnote notebooks
- Prototype in Deepnote
- Productionize in PyCharm

<!-- IMAGE: Diagram showing PyCharm vs Deepnote use cases -->
<!-- FILE: pycharm-vs-deepnote-usecases.png -->
<!-- CAPTION: When to use PyCharm vs Deepnote -->

## Key Differences

### Development Paradigm

**PyCharm (Script-based):**
```python
# main.py - Linear execution
import pandas as pd
import matplotlib.pyplot as plt

def load_data():
    return pd.read_csv('data.csv')

def analyze_data(df):
    return df.describe()

def visualize_data(df):
    df.plot()
    plt.show()

if __name__ == '__main__':
    df = load_data()
    stats = analyze_data(df)
    visualize_data(df)
```

**Deepnote (Notebook-based):**
```python
# Block 1: Load data
import pandas as pd
df = pd.read_csv('data.csv')

# Block 2: Explore (see results immediately)
df.head()
df.describe()

# Block 3: Visualize (interactive)
import matplotlib.pyplot as plt
df.plot()
plt.show()

# Block 4: Try different analysis (without re-running everything)
df.groupby('category').mean()
```

**Key Difference:**
- PyCharm: Write complete script, run all at once
- Deepnote: Interactive blocks, run and see results incrementally

### Execution Model

**PyCharm:**
- Run entire script
- Restart to clear state
- Debug with breakpoints
- Output in console

**Deepnote:**
- Run individual blocks
- Persistent state between blocks
- Interactive debugging
- Rich output inline

<!-- IMAGE: Screenshot comparing PyCharm console vs Deepnote inline output -->
<!-- FILE: pycharm-console-vs-deepnote-inline.png -->
<!-- CAPTION: PyCharm console output vs Deepnote inline output -->

### Project Structure

**PyCharm Project:**
```
my-project/
├── src/
│   ├── __init__.py
│   ├── data_loader.py
│   ├── analyzer.py
│   └── visualizer.py
├── tests/
│   └── test_analyzer.py
├── data/
├── requirements.txt
└── main.py
```

**Deepnote Project:**
```
my-project/
├── notebooks/
│   ├── 01_data_exploration.deepnote
│   ├── 02_analysis.deepnote
│   └── 03_visualization.deepnote
├── data/
├── outputs/
└── requirements.txt
```

**Hybrid Approach:**
```
my-project/
├── src/                    # Shared code (develop in PyCharm)
│   ├── __init__.py
│   ├── utils.py
│   └── models.py
├── notebooks/              # Analysis (use in Deepnote)
│   └── analysis.deepnote
├── tests/
├── data/
└── requirements.txt
```

## Migration Scenarios

### Scenario 1: Data Analysis Scripts

**PyCharm Script:**
```python
# analysis.py
import pandas as pd
import numpy as np
from datetime import datetime

# Load data
print("Loading data...")
df = pd.read_csv('sales_data.csv')
print(f"Loaded {len(df)} rows")

# Clean data
print("Cleaning data...")
df = df.dropna()
df['date'] = pd.to_datetime(df['date'])

# Analyze
print("Analyzing...")
monthly_sales = df.groupby(df['date'].dt.to_period('M'))['amount'].sum()
print(monthly_sales)

# Visualize
import matplotlib.pyplot as plt
monthly_sales.plot(kind='bar')
plt.title('Monthly Sales')
plt.savefig('monthly_sales.png')
print("Chart saved to monthly_sales.png")
```

**Deepnote Notebook:**
```python
# Block 1: Load data
import pandas as pd
df = pd.read_csv('/work/data/sales_data.csv')
print(f"Loaded {len(df)} rows")
df.head()  # See data immediately

# Block 2: Clean data
df = df.dropna()
df['date'] = pd.to_datetime(df['date'])
df.info()  # Check data types

# Block 3: Analyze
monthly_sales = df.groupby(df['date'].dt.to_period('M'))['amount'].sum()
monthly_sales  # Display results

# Block 4: Visualize
import matplotlib.pyplot as plt
monthly_sales.plot(kind='bar', figsize=(12, 6))
plt.title('Monthly Sales')
plt.show()  # Displays inline, no need to save
```

**Advantages in Deepnote:**
- ✅ See data at each step
- ✅ Modify and re-run specific blocks
- ✅ Inline visualizations
- ✅ No need to save/open images
- ✅ Add markdown explanations
- ✅ Share interactive results

### Scenario 2: Machine Learning Development

**PyCharm Approach:**
```python
# train_model.py
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import pandas as pd
import pickle

# Load and prepare data
df = pd.read_csv('data.csv')
X = df.drop('target', axis=1)
y = df['target']
X_train, X_test, y_train, y_test = train_test_split(X, y)

# Train model
model = RandomForestClassifier(n_estimators=100, max_depth=10)
model.fit(X_train, y_train)

# Evaluate
predictions = model.predict(X_test)
accuracy = accuracy_score(y_test, predictions)
print(f"Accuracy: {accuracy}")

# Save model
with open('model.pkl', 'wb') as f:
    pickle.dump(model, f)
```

**Deepnote Approach:**
```python
# Block 1: Load and explore data
import pandas as pd
df = pd.read_csv('/work/data/data.csv')
df.head()
df.describe()

# Block 2: Input blocks for hyperparameters
# Create input-slider blocks:
# - n_estimators: 10-200, default 100
# - max_depth: 1-50, default 10

# Block 3: Prepare data
X = df.drop('target', axis=1)
y = df['target']

from sklearn.model_selection import train_test_split
X_train, X_test, y_train, y_test = train_test_split(X, y, random_state=42)

# Block 4: Train model (uses input block values)
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(
    n_estimators=n_estimators,  # From input block
    max_depth=max_depth,         # From input block
    random_state=42
)
model.fit(X_train, y_train)

# Block 5: Evaluate (auto-reruns when inputs change)
from sklearn.metrics import accuracy_score, classification_report

predictions = model.predict(X_test)
accuracy = accuracy_score(y_test, predictions)

print(f"Accuracy: {accuracy:.4f}")
print("\nClassification Report:")
print(classification_report(y_test, predictions))

# Block 6: Feature importance visualization
import matplotlib.pyplot as plt

feature_importance = pd.DataFrame({
    'feature': X.columns,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)

plt.figure(figsize=(10, 6))
plt.barh(feature_importance['feature'][:10], feature_importance['importance'][:10])
plt.xlabel('Importance')
plt.title('Top 10 Feature Importances')
plt.show()

# Block 7: Save model
import pickle
with open('/work/outputs/model.pkl', 'wb') as f:
    pickle.dump(model, f)
```

**Advantages in Deepnote:**
- ✅ Interactive hyperparameter tuning
- ✅ See results at each step
- ✅ Inline visualizations
- ✅ Easy to experiment
- ✅ Document your process
- ✅ Share with team

<!-- IMAGE: Screenshot of ML workflow in Deepnote with input sliders -->
<!-- FILE: ml-workflow-deepnote.png -->
<!-- CAPTION: Interactive ML workflow with hyperparameter tuning -->

### Scenario 3: Database Queries

**PyCharm Approach:**
```python
# query_database.py
import psycopg2
import pandas as pd
from config import DB_CONFIG

# Connect to database
conn = psycopg2.connect(**DB_CONFIG)

# Query 1
query1 = """
SELECT customer_id, SUM(amount) as total
FROM orders
WHERE order_date >= '2024-01-01'
GROUP BY customer_id
"""
df1 = pd.read_sql(query1, conn)
print(df1.head())

# Query 2
query2 = """
SELECT product_id, COUNT(*) as order_count
FROM order_items
GROUP BY product_id
ORDER BY order_count DESC
LIMIT 10
"""
df2 = pd.read_sql(query2, conn)
print(df2.head())

conn.close()
```

**Deepnote Approach:**
```sql
-- SQL Block 1: Customer totals
-- Variable: customer_totals
-- Integration: postgres-prod
SELECT customer_id, SUM(amount) as total
FROM orders
WHERE order_date >= '2024-01-01'
GROUP BY customer_id
ORDER BY total DESC
```

```sql
-- SQL Block 2: Top products
-- Variable: top_products
-- Integration: postgres-prod
SELECT product_id, COUNT(*) as order_count
FROM order_items
GROUP BY product_id
ORDER BY order_count DESC
LIMIT 10
```

```python
# Code Block: Combine and analyze
import pandas as pd

# DataFrames from SQL blocks are automatically available
print(f"Total customers: {len(customer_totals)}")
print(f"Top products: {len(top_products)}")

# Merge and analyze
combined = customer_totals.merge(top_products, on='customer_id', how='left')
combined.head()
```

**Advantages in Deepnote:**
- ✅ No connection code needed
- ✅ SQL syntax highlighting
- ✅ Secure credential management
- ✅ Results as DataFrames automatically
- ✅ Mix SQL and Python easily

## Feature Mapping

### PyCharm Features → Deepnote Equivalents

| PyCharm Feature | Deepnote Equivalent | Notes |
|----------------|---------------------|-------|
| **Editor** | | |
| Code editor | Code blocks | Similar editing experience |
| Auto-completion | IntelliSense | Works in code blocks |
| Syntax highlighting | ✅ Supported | Python, SQL, markdown |
| Code folding | ✅ Supported | Collapse blocks |
| Multiple files | Multiple notebooks | One notebook = one file |
| **Execution** | | |
| Run script | Run all blocks | Ctrl/Cmd + Shift + Enter |
| Run selection | Run block | Shift + Enter |
| Debug | Debug mode | Set breakpoints |
| Console | Output panels | Inline outputs |
| **Tools** | | |
| Terminal | Terminal access | In Deepnote Cloud |
| Python console | Code blocks | Interactive by default |
| Database tools | SQL blocks | Native integration |
| Scientific mode | Native | Notebook-first |
| **Project** | | |
| Project structure | File explorer | Organize notebooks |
| Virtual environment | Environment settings | Managed in Deepnote |
| Requirements | requirements.txt | Same format |
| Git integration | ✅ Supported | Native Git support |

### Debugging Comparison

**PyCharm Debugger:**
```python
# Set breakpoint
def analyze_data(df):
    # Breakpoint here
    result = df.groupby('category').mean()
    return result

# Run in debug mode
# Step through with F8, F7
# Inspect variables in debugger
```

**Deepnote Debugger:**
```python
# Block 1: Set breakpoint in block
def analyze_data(df):
    # Click margin to set breakpoint
    result = df.groupby('category').mean()
    return result

# Block 2: Call function
result = analyze_data(df)

# Click "Debug Cell" button
# Use debug controls to step through
# Inspect variables in debug panel
```

**Or Simply:**
```python
# Block 1: Load data
df = pd.read_csv('data.csv')

# Block 2: Explore interactively (no debugger needed)
df.head()
df.info()
df.describe()

# Block 3: Check intermediate results
grouped = df.groupby('category')
grouped.size()  # See group sizes

# Block 4: Final analysis
result = grouped.mean()
result
```

<!-- IMAGE: Screenshot of PyCharm debugger vs Deepnote debug mode -->
<!-- FILE: debugger-comparison.png -->
<!-- CAPTION: PyCharm debugger vs Deepnote debug mode -->

## Migration Process

### Step 1: Identify What to Migrate

**Good Candidates for Deepnote:**
- ✅ Data analysis scripts
- ✅ Exploratory data analysis
- ✅ Machine learning experiments
- ✅ Data visualization scripts
- ✅ Report generation
- ✅ Statistical analysis

**Keep in PyCharm:**
- ✅ Production applications
- ✅ Web applications
- ✅ APIs and services
- ✅ Package development
- ✅ Complex class hierarchies
- ✅ Large codebases

**Hybrid Approach:**
- ✅ Develop utilities in PyCharm
- ✅ Use utilities in Deepnote notebooks
- ✅ Prototype in Deepnote
- ✅ Productionize in PyCharm

### Step 2: Convert Scripts to Notebooks

**Manual Conversion:**

1. **Break script into logical sections:**
```python
# PyCharm script sections:
# 1. Imports
# 2. Load data
# 3. Clean data
# 4. Analyze
# 5. Visualize
```

2. **Create blocks for each section:**
```python
# Block 1: Imports
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Block 2: Load data
df = pd.read_csv('/work/data/data.csv')
df.head()

# Block 3: Clean data
df = df.dropna()
df['date'] = pd.to_datetime(df['date'])
df.info()

# Block 4: Analyze
summary = df.groupby('category').agg({
    'amount': ['sum', 'mean', 'count']
})
summary

# Block 5: Visualize
summary['amount']['sum'].plot(kind='bar')
plt.title('Total Amount by Category')
plt.show()
```

3. **Add markdown documentation:**
```markdown
# Data Analysis Report

## Overview
This notebook analyzes sales data for Q4 2024.

## Data Source
- File: sales_data.csv
- Period: Q4 2024
- Rows: 10,000
```

### Step 3: Set Up Environment

**In PyCharm:**
```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install packages
pip install pandas numpy matplotlib
pip freeze > requirements.txt
```

**In Deepnote:**
1. Upload `requirements.txt`
2. Or add packages in Environment settings
3. Deepnote installs automatically

### Step 4: Migrate Data Files

**From PyCharm Project:**
```bash
# Your data location
project/
├── data/
│   ├── sales.csv
│   └── customers.csv
```

**To Deepnote:**
1. Upload files to `/work/data/`
2. Or connect to cloud storage (S3, GCS)
3. Update file paths in code

```python
# PyCharm
df = pd.read_csv('data/sales.csv')

# Deepnote
df = pd.read_csv('/work/data/sales.csv')
```

### Step 5: Adapt Database Connections

**PyCharm Configuration:**
```python
# config.py
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'mydb',
    'user': 'user',
    'password': 'pass'
}

# query.py
import psycopg2
conn = psycopg2.connect(**DB_CONFIG)
```

**Deepnote Configuration:**
1. Add database integration
2. Use SQL blocks
3. No connection code needed

```sql
-- SQL Block
-- Integration: postgres-prod
-- Variable: results
SELECT * FROM table
```

## Working with Both Tools

### Develop Libraries in PyCharm, Use in Deepnote

**PyCharm - Create Package:**
```python
# my_package/utils.py
def clean_dataframe(df):
    """Clean DataFrame by removing nulls and duplicates."""
    df = df.dropna()
    df = df.drop_duplicates()
    return df

def calculate_metrics(df):
    """Calculate summary metrics."""
    return {
        'mean': df.mean(),
        'median': df.median(),
        'std': df.std()
    }
```

**Package Structure:**
```
my_package/
├── __init__.py
├── utils.py
├── models.py
└── setup.py
```

**Install in Deepnote:**
```python
# Block 1: Install your package
!pip install git+https://github.com/username/my_package.git

# Block 2: Use in notebook
from my_package import utils

df = pd.read_csv('data.csv')
df_clean = utils.clean_dataframe(df)
metrics = utils.calculate_metrics(df_clean)
```

### Prototype in Deepnote, Productionize in PyCharm

**Deepnote - Prototype:**
```python
# Experiment with different approaches
# Block 1: Try approach A
result_a = df.groupby('category').mean()

# Block 2: Try approach B
result_b = df.pivot_table(values='amount', index='category', aggfunc='mean')

# Block 3: Compare
print("Approach A:", result_a.shape)
print("Approach B:", result_b.shape)
```

**PyCharm - Production:**
```python
# production_script.py
# Once you know what works, create production script

def process_data(df):
    """Production-ready data processing."""
    # Use the approach that worked best
    return df.pivot_table(
        values='amount',
        index='category',
        aggfunc='mean'
    )

if __name__ == '__main__':
    df = load_data()
    result = process_data(df)
    save_result(result)
```

## PyCharm Features You'll Miss (and Alternatives)

### 1. Advanced Refactoring

**PyCharm:**
- Rename variables across files
- Extract method
- Change signature
- Move class

**Deepnote Alternative:**
- Manual refactoring
- Use find/replace
- Keep code in blocks simple
- Extract complex logic to separate packages

### 2. Code Navigation

**PyCharm:**
- Go to definition (Ctrl+B)
- Find usages
- Class hierarchy
- Call hierarchy

**Deepnote Alternative:**
- Search in notebook
- Use variable explorer
- Keep related code in same notebook
- Import complex code from packages

### 3. Advanced Testing

**PyCharm:**
- Integrated test runner
- Coverage reports
- Test debugging

**Deepnote Alternative:**
- Run tests in code blocks
- Use `pytest` in terminal
- Or develop tests in PyCharm, use code in Deepnote

```python
# Block: Run tests
!pytest tests/ -v
```

### 4. Database Tools

**PyCharm:**
- Database browser
- Query console
- Schema visualization
- Data editor

**Deepnote Alternative:**
- SQL blocks for queries
- Use pandas for data viewing
- Or keep PyCharm for database management

## Best Practices for Hybrid Workflow

### 1. Organize Your Code

**Shared Code (PyCharm):**
```
src/
├── __init__.py
├── data_loader.py    # Reusable data loading
├── preprocessor.py   # Data cleaning
└── models.py         # ML models
```

**Analysis (Deepnote):**
```
notebooks/
├── exploration.deepnote      # Use src modules
├── experiments.deepnote      # Try different approaches
└── final_analysis.deepnote   # Production analysis
```

### 2. Version Control Strategy

**Git Structure:**
```
.gitignore
├── .venv/              # Ignore
├── __pycache__/        # Ignore
├── .ipynb_checkpoints/ # Ignore
├── src/                # Commit
├── notebooks/          # Commit
├── tests/              # Commit
└── requirements.txt    # Commit
```

**Workflow:**
```bash
# Develop in PyCharm
git add src/
git commit -m "Add new utility function"

# Analyze in Deepnote
git add notebooks/
git commit -m "Add customer analysis notebook"

# Push
git push origin main
```

### 3. Documentation

**Code Documentation (PyCharm):**
```python
def process_data(df: pd.DataFrame, threshold: float = 0.5) -> pd.DataFrame:
    """
    Process DataFrame by applying threshold filter.
    
    Args:
        df: Input DataFrame
        threshold: Minimum value threshold
        
    Returns:
        Filtered DataFrame
        
    Examples:
        >>> df = pd.DataFrame({'value': [0.3, 0.7, 0.9]})
        >>> process_data(df, threshold=0.5)
    """
    return df[df['value'] > threshold]
```

**Analysis Documentation (Deepnote):**
```markdown
# Customer Segmentation Analysis

## Objective
Segment customers based on purchase behavior.

## Methodology
1. Load customer data
2. Calculate RFM metrics
3. Apply K-means clustering
4. Analyze segments

## Results
- Identified 4 distinct segments
- High-value segment: 15% of customers, 60% of revenue
```

## Troubleshooting

### Issue: Missing PyCharm Features

**Problem:** Can't find familiar PyCharm features

**Solution:**
- Focus on notebook strengths
- Use PyCharm for complex development
- Use Deepnote for analysis and exploration

### Issue: Code Organization

**Problem:** Notebook gets too long

**Solution:**
```python
# Split into multiple notebooks
notebooks/
├── 01_data_loading.deepnote
├── 02_preprocessing.deepnote
├── 03_analysis.deepnote
└── 04_visualization.deepnote

# Or extract to modules
from my_utils import load_data, clean_data
df = load_data('data.csv')
df = clean_data(df)
```

### Issue: Testing

**Problem:** How to test notebook code

**Solution:**
```python
# Option 1: Test in notebook
def my_function(x):
    return x * 2

# Test
assert my_function(5) == 10
print("✓ Test passed")

# Option 2: Extract to module, test in PyCharm
# my_module.py
def my_function(x):
    return x * 2

# test_my_module.py (in PyCharm)
def test_my_function():
    assert my_function(5) == 10
```

## Migration Checklist

### Assessment
- [ ] Identify scripts for migration
- [ ] List dependencies
- [ ] Note database connections
- [ ] Check for PyCharm-specific features
- [ ] Decide what stays in PyCharm

### Preparation
- [ ] Export requirements.txt
- [ ] Document current workflow
- [ ] Backup PyCharm projects
- [ ] Set up Deepnote account

### Migration
- [ ] Convert scripts to notebooks
- [ ] Set up environment
- [ ] Upload data files
- [ ] Configure database integrations
- [ ] Test execution
- [ ] Add documentation

### Validation
- [ ] Verify outputs match
- [ ] Test interactivity
- [ ] Check performance
- [ ] Share with team
- [ ] Document differences

## Related Documentation

- [Moving from Jupyter to Deepnote](./jupyter-to-deepnote.md) - Jupyter migration
- [Moving from VS Code to Deepnote](./vscode-jupyter-to-deepnote.md) - VS Code migration
- [Deepnote Format](./deepnote-format.md) - File format
- [Supported Code Blocks](./supported-code-blocks.md) - Block types

## Conclusion

PyCharm and Deepnote serve different purposes and can work together effectively. Use PyCharm for traditional software development and Deepnote for data analysis, exploration, and collaboration. The combination provides a powerful workflow for data science projects.

**Choose the right tool for the job! 🛠️**
