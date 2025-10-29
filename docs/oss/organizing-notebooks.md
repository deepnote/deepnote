---
title: Organizing Notebooks into Projects
description: Complete guide to organizing Deepnote notebooks into well-structured projects using the .deepnote format, including best practices and patterns.
noIndex: false
noContent: false
---

# Organizing Notebooks into Projects

Learn how to effectively organize your Deepnote notebooks into well-structured projects using the `.deepnote` format, with best practices for scalability, collaboration, and maintainability.

## Understanding Deepnote Projects

### What is a Deepnote Project?

A Deepnote project is a single `.deepnote` file containing:
- **Multiple notebooks** - Related analysis notebooks
- **Shared settings** - Python version, dependencies
- **Integrations** - Database and service connections
- **Project metadata** - Creation date, version, checksums

**Key Concept:** Unlike Jupyter where each notebook is a separate `.ipynb` file, Deepnote organizes multiple notebooks into a single project file.

<!-- IMAGE: Diagram showing Jupyter's one-file-per-notebook vs Deepnote's project structure -->
<!-- FILE: jupyter-vs-deepnote-structure.png -->
<!-- CAPTION: Jupyter (multiple files) vs Deepnote (single project file) -->

### Project Structure

```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'
  modifiedAt: '2025-01-27T14:30:00Z'

version: '1.0.0'

project:
  id: 'project-uuid'
  name: 'Customer Analytics'
  initNotebookId: 'notebook-001'  # Default notebook
  
  notebooks:
    - id: 'notebook-001'
      name: 'Data Loading'
      blocks: [...]
    
    - id: 'notebook-002'
      name: 'Data Cleaning'
      blocks: [...]
    
    - id: 'notebook-003'
      name: 'Analysis'
      blocks: [...]
  
  integrations:
    - id: 'postgres-prod'
      name: 'Production Database'
      type: 'postgres'
  
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
```

## Organization Patterns

### Pattern 1: Linear Pipeline

**Use Case:** Data processing pipeline with sequential steps

**Structure:**
```yaml
project:
  name: 'Sales Data Pipeline'
  
  notebooks:
    - name: '01 - Extract Data'
      # Load data from sources
    
    - name: '02 - Transform Data'
      # Clean and transform
    
    - name: '03 - Load Data'
      # Load to warehouse
    
    - name: '04 - Validate'
      # Quality checks
```

**Benefits:**
- ✅ Clear execution order
- ✅ Easy to understand flow
- ✅ Simple to maintain
- ✅ Good for automation

**Example:**
```yaml
notebooks:
  - id: 'extract'
    name: '01 - Extract Data'
    blocks:
      - type: sql
        content: |
          SELECT * FROM raw_sales
          WHERE date >= CURRENT_DATE - INTERVAL '7 days'
        metadata:
          deepnote_variable_name: raw_data
          sql_integration_id: postgres-prod
  
  - id: 'transform'
    name: '02 - Transform Data'
    blocks:
      - type: code
        content: |
          # Clean data
          df = raw_data.copy()
          df = df.dropna()
          df['date'] = pd.to_datetime(df['date'])
          
          # Transform
          df['revenue'] = df['quantity'] * df['price']
          df['month'] = df['date'].dt.to_period('M')
  
  - id: 'load'
    name: '03 - Load Data'
    blocks:
      - type: code
        content: |
          # Load to warehouse
          df.to_sql('processed_sales', engine, if_exists='append')
```

<!-- IMAGE: Screenshot showing linear pipeline notebooks -->
<!-- FILE: linear-pipeline-structure.png -->
<!-- CAPTION: Linear pipeline organization -->

### Pattern 2: Modular Analysis

**Use Case:** Complex analysis with reusable components

**Structure:**
```yaml
project:
  name: 'Customer Segmentation'
  
  notebooks:
    # Utility modules
    - name: 'Utils - Data Loading'
      isModule: true
    
    - name: 'Utils - Preprocessing'
      isModule: true
    
    # Analysis notebooks
    - name: 'Exploratory Analysis'
    
    - name: 'Segmentation Model'
    
    - name: 'Visualization'
```

**Benefits:**
- ✅ Reusable code
- ✅ DRY principle
- ✅ Easy to test
- ✅ Modular updates

**Example:**
```yaml
notebooks:
  # Module notebook
  - id: 'utils-loading'
    name: 'Utils - Data Loading'
    isModule: true
    blocks:
      - type: code
        content: |
          def load_customer_data(start_date, end_date):
              """Load customer data for date range."""
              query = f"""
              SELECT * FROM customers
              WHERE signup_date BETWEEN '{start_date}' AND '{end_date}'
              """
              return pd.read_sql(query, engine)
          
          def load_transaction_data(customer_ids):
              """Load transactions for customers."""
              ids = ','.join(map(str, customer_ids))
              query = f"""
              SELECT * FROM transactions
              WHERE customer_id IN ({ids})
              """
              return pd.read_sql(query, engine)
  
  # Analysis notebook using module
  - id: 'analysis'
    name: 'Customer Analysis'
    blocks:
      - type: code
        content: |
          # Import from module
          from utils_data_loading import load_customer_data, load_transaction_data
          
          # Use module functions
          customers = load_customer_data('2024-01-01', '2024-12-31')
          transactions = load_transaction_data(customers['id'].tolist())
```

<!-- IMAGE: Screenshot showing modular project structure -->
<!-- FILE: modular-structure.png -->
<!-- CAPTION: Modular project organization with utility notebooks -->

### Pattern 3: Feature-Based

**Use Case:** Multiple related analyses on same dataset

**Structure:**
```yaml
project:
  name: 'E-commerce Analytics'
  
  notebooks:
    # Data preparation (shared)
    - name: 'Data Preparation'
    
    # Feature analyses
    - name: 'Customer Behavior'
    - name: 'Product Performance'
    - name: 'Revenue Analysis'
    - name: 'Marketing Attribution'
    
    # Reporting
    - name: 'Executive Dashboard'
```

**Benefits:**
- ✅ Parallel development
- ✅ Feature isolation
- ✅ Easy to navigate
- ✅ Team collaboration

**Example:**
```yaml
notebooks:
  - id: 'data-prep'
    name: 'Data Preparation'
    blocks:
      - type: sql
        content: |
          -- Load all necessary data
          SELECT * FROM orders o
          JOIN customers c ON o.customer_id = c.id
          JOIN products p ON o.product_id = p.id
          WHERE o.order_date >= '2024-01-01'
        metadata:
          deepnote_variable_name: base_data
  
  - id: 'customer-behavior'
    name: 'Customer Behavior'
    blocks:
      - type: code
        content: |
          # Analyze customer behavior
          customer_metrics = base_data.groupby('customer_id').agg({
              'order_id': 'count',
              'amount': 'sum',
              'order_date': ['min', 'max']
          })
  
  - id: 'product-performance'
    name: 'Product Performance'
    blocks:
      - type: code
        content: |
          # Analyze product performance
          product_metrics = base_data.groupby('product_id').agg({
              'order_id': 'count',
              'amount': 'sum',
              'quantity': 'sum'
          })
```

### Pattern 4: Experiment Tracking

**Use Case:** Machine learning experiments

**Structure:**
```yaml
project:
  name: 'Churn Prediction Model'
  
  notebooks:
    # Setup
    - name: 'Data Preparation'
    - name: 'Feature Engineering'
    
    # Experiments
    - name: 'Experiment 01 - Baseline'
    - name: 'Experiment 02 - Random Forest'
    - name: 'Experiment 03 - XGBoost'
    - name: 'Experiment 04 - Neural Network'
    
    # Evaluation
    - name: 'Model Comparison'
    - name: 'Final Model'
```

**Benefits:**
- ✅ Track experiments
- ✅ Compare results
- ✅ Reproducible
- ✅ Version controlled

**Example:**
```yaml
notebooks:
  - id: 'experiment-01'
    name: 'Experiment 01 - Baseline'
    blocks:
      - type: code
        content: |
          # Baseline model
          from sklearn.linear_model import LogisticRegression
          
          model = LogisticRegression()
          model.fit(X_train, y_train)
          
          # Evaluate
          accuracy = model.score(X_test, y_test)
          print(f"Baseline Accuracy: {accuracy:.4f}")
          
          # Save results
          results = {
              'experiment': '01-baseline',
              'model': 'LogisticRegression',
              'accuracy': accuracy,
              'date': datetime.now()
          }
  
  - id: 'experiment-02'
    name: 'Experiment 02 - Random Forest'
    blocks:
      - type: code
        content: |
          # Random Forest model
          from sklearn.ensemble import RandomForestClassifier
          
          model = RandomForestClassifier(n_estimators=100, max_depth=10)
          model.fit(X_train, y_train)
          
          # Evaluate
          accuracy = model.score(X_test, y_test)
          print(f"Random Forest Accuracy: {accuracy:.4f}")
```

<!-- IMAGE: Screenshot showing experiment tracking notebooks -->
<!-- FILE: experiment-tracking.png -->
<!-- CAPTION: Experiment tracking organization -->

## Naming Conventions

### Notebook Names

**Good Naming:**
```yaml
notebooks:
  # Use numbers for order
  - name: '01 - Data Loading'
  - name: '02 - Data Cleaning'
  - name: '03 - Analysis'
  
  # Use descriptive names
  - name: 'Customer Segmentation Analysis'
  - name: 'Revenue Forecasting Model'
  
  # Use prefixes for categories
  - name: 'Utils - Data Loading'
  - name: 'Utils - Visualization'
  - name: 'Experiment 01 - Baseline'
  - name: 'Experiment 02 - XGBoost'
```

**Avoid:**
```yaml
notebooks:
  # Too vague
  - name: 'Notebook 1'
  - name: 'Analysis'
  - name: 'Test'
  
  # Too long
  - name: 'This is the notebook where we analyze customer behavior patterns and segment customers into different groups based on their purchase history'
```

### Project Names

**Good Examples:**
- `Customer Analytics Q4 2024`
- `Sales Forecasting Model`
- `Marketing Campaign Analysis`
- `Data Quality Dashboard`
- `Churn Prediction Pipeline`

**Naming Guidelines:**
- ✅ Descriptive and specific
- ✅ Include time period if relevant
- ✅ Use title case
- ✅ Keep under 50 characters
- ✅ Avoid special characters

## Project Templates

### Data Science Project Template

```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'

version: '1.0.0'

project:
  id: 'template-ds-001'
  name: 'Data Science Project Template'
  
  notebooks:
    - id: 'readme'
      name: '00 - README'
      blocks:
        - type: text-cell-h1
          content: 'Project Title'
        - type: text-cell-p
          content: 'Project description and objectives.'
    
    - id: 'data-loading'
      name: '01 - Data Loading'
      blocks:
        - type: code
          content: |
            import pandas as pd
            import numpy as np
            
            # Load data
            df = pd.read_csv('/work/data/data.csv')
            df.head()
    
    - id: 'eda'
      name: '02 - Exploratory Data Analysis'
      blocks:
        - type: code
          content: |
            # Data overview
            print(df.info())
            print(df.describe())
            
            # Check for missing values
            print(df.isnull().sum())
    
    - id: 'preprocessing'
      name: '03 - Data Preprocessing'
      blocks:
        - type: code
          content: |
            # Clean data
            df_clean = df.dropna()
            
            # Feature engineering
            # ...
    
    - id: 'modeling'
      name: '04 - Modeling'
      blocks:
        - type: code
          content: |
            from sklearn.model_selection import train_test_split
            
            # Split data
            X = df_clean.drop('target', axis=1)
            y = df_clean['target']
            X_train, X_test, y_train, y_test = train_test_split(X, y)
    
    - id: 'evaluation'
      name: '05 - Model Evaluation'
      blocks:
        - type: code
          content: |
            from sklearn.metrics import accuracy_score, classification_report
            
            # Evaluate model
            predictions = model.predict(X_test)
            print(f"Accuracy: {accuracy_score(y_test, predictions)}")
    
    - id: 'visualization'
      name: '06 - Visualization'
      blocks:
        - type: code
          content: |
            import matplotlib.pyplot as plt
            import seaborn as sns
            
            # Create visualizations
            # ...
  
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
      - 'scikit-learn>=1.3.0'
      - 'matplotlib>=3.7.0'
      - 'seaborn>=0.12.0'
```

<!-- IMAGE: Screenshot of data science project template -->
<!-- FILE: ds-project-template.png -->
<!-- CAPTION: Data science project template structure -->

### Analytics Dashboard Template

```yaml
project:
  name: 'Analytics Dashboard Template'
  
  notebooks:
    - name: '00 - Configuration'
      blocks:
        - type: input-date-range
          metadata:
            deepnote_variable_name: date_range
            deepnote_variable_value: past7days
        
        - type: input-select
          metadata:
            deepnote_variable_name: region
            deepnote_variable_value: 'All'
            deepnote_variable_options: ['All', 'North', 'South', 'East', 'West']
    
    - name: '01 - Data Loading'
      blocks:
        - type: sql
          content: |
            SELECT * FROM metrics
            WHERE date BETWEEN :start_date AND :end_date
            AND (:region = 'All' OR region = :region)
    
    - name: '02 - KPIs'
      blocks:
        - type: big-number
          metadata:
            deepnote_big_number_title: 'Total Revenue'
            deepnote_big_number_value: 'df["revenue"].sum()'
        
        - type: big-number
          metadata:
            deepnote_big_number_title: 'Total Orders'
            deepnote_big_number_value: 'len(df)'
    
    - name: '03 - Visualizations'
      blocks:
        - type: visualization
          metadata:
            deepnote_chart_spec:
              mark: line
              encoding:
                x: {field: date, type: temporal}
                y: {field: revenue, type: quantitative}
```

### ETL Pipeline Template

```yaml
project:
  name: 'ETL Pipeline Template'
  
  notebooks:
    - name: '01 - Extract'
      blocks:
        - type: sql
          content: |
            -- Extract from source
            SELECT * FROM source_table
            WHERE updated_at > :last_run_time
    
    - name: '02 - Transform'
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
    
    - name: '03 - Load'
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
    
    - name: '04 - Validation'
      blocks:
        - type: sql
          content: |
            -- Validate load
            SELECT COUNT(*) as row_count,
                   MAX(processed_date) as last_processed
            FROM destination_table
```

## Best Practices

### 1. Keep Notebooks Focused

**Good:**
```yaml
notebooks:
  - name: 'Data Loading'
    # Only data loading logic
  
  - name: 'Data Cleaning'
    # Only cleaning logic
  
  - name: 'Feature Engineering'
    # Only feature creation
```

**Avoid:**
```yaml
notebooks:
  - name: 'Everything'
    # Loading, cleaning, analysis, visualization all mixed
```

### 2. Use Module Notebooks

**Create Reusable Utilities:**
```yaml
notebooks:
  - name: 'Utils - Database'
    isModule: true
    blocks:
      - type: code
        content: |
          def get_connection(db_name):
              """Get database connection."""
              return create_engine(f"postgresql:///{db_name}")
          
          def execute_query(query, db_name='default'):
              """Execute query and return DataFrame."""
              conn = get_connection(db_name)
              return pd.read_sql(query, conn)
  
  - name: 'Utils - Visualization'
    isModule: true
    blocks:
      - type: code
        content: |
          def plot_timeseries(df, x, y, title):
              """Create time series plot."""
              plt.figure(figsize=(12, 6))
              plt.plot(df[x], df[y])
              plt.title(title)
              plt.xlabel(x)
              plt.ylabel(y)
              plt.show()
```

**Use in Other Notebooks:**
```python
from utils_database import execute_query
from utils_visualization import plot_timeseries

# Use utility functions
df = execute_query("SELECT * FROM sales")
plot_timeseries(df, 'date', 'revenue', 'Daily Revenue')
```

### 3. Document Your Project

**Add README Notebook:**
```yaml
notebooks:
  - name: '00 - README'
    blocks:
      - type: text-cell-h1
        content: 'Customer Analytics Project'
      
      - type: text-cell-h2
        content: 'Overview'
      
      - type: text-cell-p
        content: 'This project analyzes customer behavior and segments customers based on purchase patterns.'
      
      - type: text-cell-h2
        content: 'Data Sources'
      
      - type: text-cell-bullet
        content: 'PostgreSQL: customer_data table'
      
      - type: text-cell-bullet
        content: 'S3: historical_transactions.csv'
      
      - type: text-cell-h2
        content: 'Notebooks'
      
      - type: text-cell-bullet
        content: '01 - Data Loading: Loads data from sources'
      
      - type: text-cell-bullet
        content: '02 - Analysis: Performs segmentation'
      
      - type: text-cell-h2
        content: 'Requirements'
      
      - type: code
        content: |
          # Python 3.11+
          # pandas>=2.0.0
          # scikit-learn>=1.3.0
```

<!-- IMAGE: Screenshot of README notebook -->
<!-- FILE: readme-notebook.png -->
<!-- CAPTION: README notebook documenting project structure -->

### 4. Manage Dependencies

**Project-Level Requirements:**
```yaml
project:
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      # Core data science
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
      
      # Visualization
      - 'matplotlib>=3.7.0'
      - 'seaborn>=0.12.0'
      
      # Machine learning
      - 'scikit-learn>=1.3.0'
      
      # Database
      - 'psycopg2-binary>=2.9.0'
      - 'sqlalchemy>=2.0.0'
      
      # Utilities
      - 'python-dotenv>=1.0.0'
```

### 5. Use Consistent Ordering

**Numbered Notebooks:**
```yaml
notebooks:
  - name: '01 - Data Loading'
  - name: '02 - Data Cleaning'
  - name: '03 - Feature Engineering'
  - name: '04 - Model Training'
  - name: '05 - Model Evaluation'
  - name: '06 - Deployment'
```

**Prefixed Notebooks:**
```yaml
notebooks:
  # Utilities (00-09)
  - name: '00 - README'
  - name: '01 - Utils - Database'
  - name: '02 - Utils - Visualization'
  
  # Data (10-19)
  - name: '10 - Data Loading'
  - name: '11 - Data Cleaning'
  
  # Analysis (20-29)
  - name: '20 - Exploratory Analysis'
  - name: '21 - Statistical Analysis'
  
  # Modeling (30-39)
  - name: '30 - Model Training'
  - name: '31 - Model Evaluation'
```

## Scaling Projects

### Small Projects (1-5 Notebooks)

**Structure:**
```yaml
project:
  name: 'Quick Analysis'
  notebooks:
    - name: 'Analysis'
    - name: 'Visualization'
```

**Characteristics:**
- Simple linear flow
- Minimal organization needed
- Quick iterations

### Medium Projects (5-15 Notebooks)

**Structure:**
```yaml
project:
  name: 'Customer Segmentation'
  notebooks:
    - name: '00 - README'
    - name: '01 - Data Loading'
    - name: '02 - EDA'
    - name: '03 - Preprocessing'
    - name: '04 - Feature Engineering'
    - name: '05 - Clustering'
    - name: '06 - Evaluation'
    - name: '07 - Visualization'
    - name: 'Utils - Database'
    - name: 'Utils - Plotting'
```

**Characteristics:**
- Clear sections
- Some reusable utilities
- Numbered for order

### Large Projects (15+ Notebooks)

**Structure:**
```yaml
project:
  name: 'E-commerce Platform Analytics'
  notebooks:
    # Documentation
    - name: '00 - README'
    - name: '01 - Architecture'
    
    # Utilities (10-19)
    - name: '10 - Utils - Database'
    - name: '11 - Utils - Preprocessing'
    - name: '12 - Utils - Visualization'
    - name: '13 - Utils - ML'
    
    # Data Pipeline (20-29)
    - name: '20 - Extract - Orders'
    - name: '21 - Extract - Customers'
    - name: '22 - Extract - Products'
    - name: '23 - Transform - Join'
    - name: '24 - Transform - Enrich'
    - name: '25 - Load - Warehouse'
    
    # Analysis (30-49)
    - name: '30 - Customer Behavior'
    - name: '31 - Product Performance'
    - name: '32 - Revenue Analysis'
    - name: '33 - Cohort Analysis'
    
    # Modeling (50-69)
    - name: '50 - Churn Prediction'
    - name: '51 - Recommendation Engine'
    - name: '52 - Price Optimization'
    
    # Reporting (70-79)
    - name: '70 - Executive Dashboard'
    - name: '71 - Daily Report'
```

**Characteristics:**
- Hierarchical numbering
- Multiple utility modules
- Clear sections
- Extensive documentation

<!-- IMAGE: Screenshot of large project structure -->
<!-- FILE: large-project-structure.png -->
<!-- CAPTION: Large project with hierarchical organization -->

## Collaboration Strategies

### Team Workflows

**Assign Notebooks:**
```yaml
notebooks:
  - name: 'Data Loading'
    # Owner: Alice
  
  - name: 'Feature Engineering'
    # Owner: Bob
  
  - name: 'Model Training'
    # Owner: Charlie
```

**Use Comments:**
```yaml
blocks:
  - type: code
    content: |
      # TODO: Optimize this query - Alice
      # FIXME: Handle edge case - Bob
      # NOTE: This assumes data is sorted - Charlie
```

### Review Process

**Add Review Notebook:**
```yaml
notebooks:
  - name: '99 - Review Checklist'
    blocks:
      - type: text-cell-h1
        content: 'Review Checklist'
      
      - type: text-cell-todo
        content: 'All notebooks execute without errors'
        metadata:
          checked: false
      
      - type: text-cell-todo
        content: 'Data quality checks pass'
        metadata:
          checked: false
      
      - type: text-cell-todo
        content: 'Visualizations are clear'
        metadata:
          checked: false
```

## Related Documentation

- [Deepnote Format](./deepnote-format.md) - Format specification
- [Reading .deepnote Files](./reading-deepnote-files.md) - File structure
- [Deepnote in JupyterLab](./deepnote-in-jupyterlab.md) - JupyterLab integration
- [Moving Local Workflows to Cloud](./local-to-cloud-workflows.md) - Cloud migration

## Conclusion

Organizing notebooks into well-structured projects is essential for maintainability, collaboration, and scalability. The Deepnote format's project-based approach provides powerful organization capabilities while maintaining simplicity and readability.

**Start with a template and adapt to your needs! 📁**
