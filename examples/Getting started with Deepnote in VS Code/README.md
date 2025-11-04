# Getting started with Deepnote in VS Code

Deepnote notebooks can be opened and run locally in your favorite code editor. Whether you use **VS Code**, **Cursor**, or **Windsurf**, the Deepnote extension brings the power of modern notebooks to your local development environment.

**This guide covers using Deepnote in VS Code.** For other editors, see:

- [Getting started with Deepnote in Cursor](../Getting%20started%20with%20Deepnote%20in%20Cursor/README.md)
- [Deepnote VS Code Extension Documentation](../../docs/vscode-extension.md)

---

This example demonstrates how to build a player churn prediction model using Deepnote in VS Code. The `Model Training.deepnote` notebook showcases SQL blocks, database integrations, feature engineering, and machine learning workflows—all running locally with the power of a modern Jupyter kernel.


## Prerequisites

- **VS Code** installed ([download here](https://code.visualstudio.com/))
- **Python environment** (Python 3.8 or higher recommended)
- **Required Python packages**: `pandas`, `numpy`, `scikit-learn` (or `tensorflow` for deep learning)
- **Database connection** (optional): Snowflake, PostgreSQL, or other supported databases

## Installation

### Step 1: Install the Deepnote extension

**Option A: From extensions marketplace**

1. Open VS Code
2. Click the Extensions icon in the sidebar (or press `Cmd/Ctrl + Shift + X`)
3. Search for "Deepnote"
4. Click **Install** on the Deepnote extension
5. Wait for installation to complete

### Step 2: Verify installation

1. Open Command Palette (`Cmd/Ctrl + Shift + P`)
2. Type "Deepnote"
3. You should see Deepnote-related commands like "Deepnote: Open Notebook"

## Opening the example notebook

### Method 1: Using VS Code UI

1. In VS Code, go to **File → Open Folder...**
2. Navigate to and select `examples/Getting started with Deepnote in VS Code`
3. In the File Explorer, click on `Model Training.deepnote`

### Method 2: Using terminal

```bash
# Navigate to the example folder
cd examples/Getting\ started\ with\ Deepnote\ in\ VS\ Code

# Open in VS Code
code .
```

Then click on `Model Training.deepnote` in the File Explorer.

### If the notebook opens as plain text

If the `.deepnote` file opens as raw YAML instead of the notebook interface:

1. Open Command Palette (`Cmd/Ctrl + Shift + P`)
2. Type and select **"Deepnote: Open Notebook"**
3. The file will reload in notebook view

## Understanding the example: Player churn prediction

### The business problem

This notebook demonstrates a real-world machine learning workflow: predicting which players are likely to churn (stop playing) based on their behavior patterns. This helps game companies:

- Identify at-risk players early
- Target retention campaigns effectively
- Allocate resources to high-value players

### The workflow

1. **Query player data** from Snowflake using SQL blocks
2. **Engineer features** in Python (days since signup, sessions per day)
3. **Train a churn prediction model** using scikit-learn or TensorFlow
4. **Calculate churn probabilities** and categorize players by risk level
5. **Query results** using SQL on Python DataFrames

## Running the notebook

### Step 1: Configure database connection (optional)

If you have a Snowflake or other database connection:

1. Open the integrations panel in your Deepnote project
2. Add your database credentials (host, username, private key, etc.)
3. The notebook will use this connection for SQL blocks

**Note**: The example works with sample data, so a database connection is optional for learning purposes.

### Step 2: Execute SQL blocks

**What are SQL blocks?**

SQL blocks let you query databases directly in your notebook. The results automatically become Python DataFrames.

**Run the first SQL block:**

```sql
SELECT
    *
FROM
    DEMO_DEV.PUBLIC.PLAYERS_HISTORICAL
```

- Click the **▶ Play button** next to the SQL block
- Or press `Shift + Enter` (Windows/Linux) or `Shift + Return` (macOS)
- The query creates a DataFrame called `df_1` automatically

**What you'll see:**

- Player data with 100 rows
- Columns: `player_id`, `signup_date`, `country`, `platform`, `acquisition_source`, `last_login_date`, `total_sessions`, `has_churned`

**Run the second SQL block:**

```sql
SELECT
    *
FROM
    DEMO_DEV.PUBLIC.SESSIONS_HISTORICAL
```

This creates `df_2` with session-level data for feature engineering.

### Step 3: Feature engineering in Python

**The power of SQL + Python:**

Deepnote seamlessly combines SQL and Python. DataFrames created from SQL blocks are immediately available in Python code blocks.

**Example feature engineering:**

```python
import pandas as pd
from datetime import datetime

# Calculate days since signup
df_1['signup_date'] = pd.to_datetime(df_1['signup_date'])
df_1['days_since_signup'] = (datetime.now() - df_1['signup_date']).dt.days

# Calculate sessions per day
df_1['sessions_per_day'] = df_1['total_sessions'] / df_1['days_since_signup']

# View correlation matrix
df_1.corr()
```

**Expected insights:**

- Negative correlation between `sessions_per_day` and `has_churned`
- Players with fewer sessions per day are more likely to churn

### Step 4: Train the churn prediction model

**Install required packages:**

If you need to install packages, use a bash block:

```bash
pip install scikit-learn
# or
pip install tensorflow
```

**Train a simple model:**

```python
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report

# Prepare features
features = ['days_since_signup', 'sessions_per_day', 'total_sessions']
X = df_1[features]
y = df_1['has_churned']

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train model
model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

# Evaluate
y_pred = model.predict(X_test)
print(classification_report(y_test, y_pred))
```

### Step 5: Calculate churn probabilities

```python
# Predict churn probability for all players
df_1['churn_probability'] = model.predict_proba(X)[:, 1]

# Categorize by risk level
def risk_category(prob):
    if prob < 0.3:
        return 'low'
    elif prob < 0.7:
        return 'medium'
    else:
        return 'high'

df_1['risk_level'] = df_1['churn_probability'].apply(risk_category)
```

### Step 6: Query Python DataFrames with SQL

**One of Deepnote's superpowers:**

You can query Python DataFrames using SQL! This is perfect for filtering and aggregating results.

```sql
SELECT
    risk_level,
    COUNT(*) as player_count,
    AVG(churn_probability) as avg_probability
FROM
    df_1
GROUP BY
    risk_level
ORDER BY
    avg_probability DESC
```

## Advanced features

### Using variables in SQL queries (Jinja templates)

Make your queries interactive by using Python variables:

```python
# Define a variable
start_date = '2025-09-01'
```

Then use it in SQL with Jinja syntax:

```sql
SELECT
    *
FROM
    DEMO_DEV.PUBLIC.PLAYERS_HISTORICAL
WHERE
    signup_date >= '{{ start_date }}'
```

This adds interactivity—change the variable and re-run to get different results.

### Debugging support

- Set breakpoints by clicking in the left margin
- Click "Debug Cell" button
- Step through execution
- Inspect variables in real-time

### Variable explorer

- View all variables in current scope
- Inspect DataFrame shapes and types
- Access via notebook toolbar or Command Palette → "Deepnote: Show Variables"

## Next steps

### Enhance the model

- Add more features (platform, country, acquisition source)
- Try different algorithms (XGBoost, neural networks)
- Perform hyperparameter tuning
- Create evaluation plots and confusion matrices

### Create an interactive data app

Once your analysis is complete, you can:

1. Drag-and-drop the project to deepnote.com
2. Select blocks to include in your app
3. Publish for stakeholders to interact with
4. Users can adjust parameters (like `start_date`) and see live results

- **Reactive execution**: Cells automatically re-run when dependencies change

## Additional resources

- [Deepnote VS Code Extension Documentation](https://deepnote.com/docs/vscode-extension)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Deepnote.vscode-deepnote)
- [Open VSX Registry](https://open-vsx.org/extension/Deepnote/vscode-deepnote)
- [GitHub Repository](https://github.com/deepnote/deepnote-vscode)
- [Deepnote Documentation](https://deepnote.com/docs)
- [SQL Blocks Documentation](https://deepnote.com/docs/sql-blocks)
- [Database Integrations](https://deepnote.com/docs/integrations)
- [Report Issues](https://github.com/deepnote/deepnote-vscode/issues)

---

**Build better data science workflows with Deepnote in VS Code! 🚀**
