---
title: Organizing Notebooks into projects
description: Complete guide to organizing Deepnote notebooks into well-structured projects using the .deepnote format, including best practices and patterns.
noIndex: false
noContent: false
---

# Organizing Notebooks into projects

Learn how to effectively organize your Deepnote notebooks into well-structured projects using the `.deepnote` format.

## Understanding Deepnote projects

### What is a Deepnote project?

A Deepnote project is a single `.deepnote` file containing:

- **Multiple notebooks** - Related analysis notebooks
- **Shared settings** - Python version, dependencies
- **Integrations** - Database and service connections
- **Project metadata** - Creation date, version, checksums

> **Key Concept:** Unlike Jupyter where each notebook is a separate `.ipynb` file, Deepnote organizes multiple notebooks into a single project file.

### Project structure

<details>
<summary>See example project structure</summary>

```yaml
metadata:
  createdAt: "2025-01-27T12:00:00Z"
  modifiedAt: "2025-01-27T14:30:00Z"

version: "1.0.0"

project:
  id: "project-uuid"
  name: "Customer Analytics"
  initNotebookId: "notebook-001" # Default notebook

  notebooks:
    - id: "notebook-001"
      name: "Data Loading"
      blocks: [...]

    - id: "notebook-002"
      name: "Data Cleaning"
      blocks: [...]

    - id: "notebook-003"
      name: "Analysis"
      blocks: [...]

  integrations:
    - id: "postgres-prod"
      name: "Production Database"
      type: "postgres"

  settings:
    environment:
      pythonVersion: "3.11"
    requirements:
      - "pandas>=2.0.0"
      - "numpy>=1.24.0"
```

</details>

## Organization patterns

<details>
<summary> Data processing pipeline with sequential steps</summary>

**Structure:**

```yaml
project:
  name: "Sales Data Pipeline"

  notebooks:
    - name: "01 - Extract Data"
      # Load data from sources

    - name: "02 - Transform Data"
      # Clean and transform

    - name: "03 - Load Data"
      # Load to warehouse

    - name: "04 - Validate"
      # Quality checks
```

**Benefits:** Clear execution order, Easy to understand flow, Simple to maintain, Good for automation

</details>

<!-- IMAGE: Screenshot showing linear pipeline notebooks -->
<!-- FILE: linear-pipeline-structure.png -->
<!-- CAPTION: Linear pipeline organization -->

<details>
<summary> Modular analysis</summary>

**Use case:** Complex analysis with reusable components

**Structure:**

```yaml
project:
  name: "Customer Segmentation"

  notebooks:
    # Utility modules
    - name: "Utils - Data Loading"
      isModule: true

    - name: "Utils - Preprocessing"
      isModule: true

    # Analysis notebooks
    - name: "Exploratory Analysis"

    - name: "Segmentation Model"

    - name: "Visualization"
```

</details>

<details>
<summary> Multiple related analyses on same dataset </summary>

**Structure:**

```yaml
project:
  name: "E-commerce Analytics"

  notebooks:
    # Data preparation (shared)
    - name: "Data Preparation"

    # Feature analyses
    - name: "Customer Behavior"
    - name: "Product Performance"
    - name: "Revenue Analysis"
    - name: "Marketing Attribution"

    # Reporting
    - name: "Executive Dashboard"
```

**Benefits:** Parallel development, Feature isolation, Easy to navigate, Team collaboration

</details>

<details>
<summary> Machine learning experiments </summary>

**Structure:**

```yaml
project:
  name: "Churn Prediction Model"

  notebooks:
    # Setup
    - name: "Data Preparation"
    - name: "Feature Engineering"

    # Experiments
    - name: "Experiment 01 - Baseline"
    - name: "Experiment 02 - Random Forest"
    - name: "Experiment 03 - XGBoost"
    - name: "Experiment 04 - Neural Network"

    # Evaluation
    - name: "Model Comparison"
    - name: "Final Model"
```

> **Benefits:** Track experiments, Compare results, Reproducible, Version controlled

</details>

## Project Templates

<details>
<summary> Data Science Project Template </summary>

```yaml
metadata:
  createdAt: "2025-01-27T12:00:00Z"

version: "1.0.0"

project:
  id: "template-ds-001"
  name: "Data Science Project Template"

  notebooks:
    - id: "readme"
      name: "00 - README"
      blocks:
        - type: text-cell-h1
          content: "Project Title"
        - type: text-cell-p
          content: "Project description and objectives."

    - id: "data-loading"
      name: "01 - Data Loading"
      blocks:
        - type: code
          content: |
            import pandas as pd
            import numpy as np

            # Load data
            df = pd.read_csv('/work/data/data.csv')
            df.head()

    - id: "eda"
      name: "02 - Exploratory Data Analysis"
      blocks:
        - type: code
          content: |
            # Data overview
            print(df.info())
            print(df.describe())

            # Check for missing values
            print(df.isnull().sum())

    - id: "preprocessing"
      name: "03 - Data Preprocessing"
      blocks:
        - type: code
          content: |
            # Clean data
            df_clean = df.dropna()

            # Feature engineering
            # ...

    - id: "modeling"
      name: "04 - Modeling"
      blocks:
        - type: code
          content: |
            from sklearn.model_selection import train_test_split

            # Split data
            X = df_clean.drop('target', axis=1)
            y = df_clean['target']
            X_train, X_test, y_train, y_test = train_test_split(X, y)

    - id: "evaluation"
      name: "05 - Model Evaluation"
      blocks:
        - type: code
          content: |
            from sklearn.metrics import accuracy_score, classification_report

            # Evaluate model
            predictions = model.predict(X_test)
            print(f"Accuracy: {accuracy_score(y_test, predictions)}")

    - id: "visualization"
      name: "06 - Visualization"
      blocks:
        - type: code
          content: |
            import matplotlib.pyplot as plt
            import seaborn as sns

            # Create visualizations
            # ...

  settings:
    environment:
      pythonVersion: "3.11"
    requirements:
      - "pandas>=2.0.0"
      - "numpy>=1.24.0"
      - "scikit-learn>=1.3.0"
      - "matplotlib>=3.7.0"
      - "seaborn>=0.12.0"
```

</details>

<details>
<summary> Analytics Dashboard Template </summary>

```yaml
project:
  name: "Analytics Dashboard Template"

  notebooks:
    - name: "00 - Configuration"
      blocks:
        - type: input-date-range
          metadata:
            deepnote_variable_name: date_range
            deepnote_variable_value: past7days

        - type: input-select
          metadata:
            deepnote_variable_name: region
            deepnote_variable_value: "All"
            deepnote_variable_options: ["All", "North", "South", "East", "West"]

    - name: "01 - Data Loading"
      blocks:
        - type: sql
          content: |
            SELECT * FROM metrics
            WHERE date BETWEEN :start_date AND :end_date
            AND (:region = 'All' OR region = :region)

    - name: "02 - KPIs"
      blocks:
        - type: big-number
          metadata:
            deepnote_big_number_title: "Total Revenue"
            deepnote_big_number_value: 'df["revenue"].sum()'

        - type: big-number
          metadata:
            deepnote_big_number_title: "Total Orders"
            deepnote_big_number_value: "len(df)"

    - name: "03 - Visualizations"
      blocks:
        - type: visualization
          metadata:
            deepnote_chart_spec:
              mark: line
              encoding:
                x: { field: date, type: temporal }
                y: { field: revenue, type: quantitative }
```

</details>

<details>
<summary> ETL Pipeline Template </summary>

```yaml
project:
  name: "ETL Pipeline Template"

  notebooks:
    - name: "01 - Extract"
      blocks:
        - type: sql
          content: |
            -- Extract from source
            SELECT * FROM source_table
            WHERE updated_at > :last_run_time

    - name: "02 - Transform"
      blocks:
        - type: code
          content: |
            # Transform data
            df_transformed = df.copy()

            # Clean
            df_transformed = df_transformed.dropna()

            # Enrich
            df_transformed['processed_date'] = pd.Timestamp.now()

            # Validate
            assert len(df_transformed) > 0, "No data to process"

    - name: "03 - Load"
      blocks:
        - type: code
          content: |
            # Load to destination
            df_transformed.to_sql(
                'destination_table',
                engine,
                if_exists='append',
                index=False
            )

            print(f"Loaded {len(df_transformed)} rows")

    - name: "04 - Validation"
      blocks:
        - type: sql
          content: |
            -- Validate load
            SELECT COUNT(*) as row_count,
                   MAX(processed_date) as last_processed
            FROM destination_table
```

</details>

Organizing notebooks into well-structured projects is essential for maintainability, collaboration, and scalability. The Deepnote format's project-based approach provides powerful organization capabilities while maintaining simplicity and readability.
