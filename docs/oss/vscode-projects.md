---
title: Deepnote Projects in VS Code
description: Complete guide to managing and organizing Deepnote projects in Visual Studio Code, including project structure, workflows, and collaboration.
noIndex: false
noContent: false
---

# Deepnote Projects in VS Code

Learn how to effectively manage Deepnote projects in Visual Studio Code, from initial setup to advanced workflows and team collaboration.

## What is a Deepnote Project?

A Deepnote project is a collection of:
- **Notebooks** - One or more `.deepnote` files
- **Data files** - CSV, Excel, JSON, etc.
- **Configuration** - Environment settings and dependencies
- **Integrations** - Database and service connections
- **Outputs** - Generated results and artifacts

All contained in a single `.deepnote` file or organized as a workspace.

<!-- IMAGE: Screenshot of a typical Deepnote project structure in VS Code -->
<!-- FILE: project-structure-overview.png -->
<!-- CAPTION: Deepnote project structure in VS Code Explorer -->

## Creating a New Project

### Method 1: From Scratch

**1. Create Project Directory:**
```bash
mkdir my-deepnote-project
cd my-deepnote-project
```

**2. Initialize Git:**
```bash
git init
```

**3. Create Virtual Environment:**
```bash
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows
```

**4. Create Project Structure:**
```bash
mkdir -p notebooks data outputs scripts
touch requirements.txt README.md .gitignore .env
```

**5. Open in VS Code:**
```bash
code .
```

<!-- IMAGE: Screenshot of creating new project in VS Code -->
<!-- FILE: create-new-project.png -->
<!-- CAPTION: Creating a new Deepnote project -->

### Method 2: From Template

**Use Project Template:**

**File:** `project-template.deepnote`
```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'

version: '1.0.0'

project:
  id: 'new-project-001'
  name: 'New Project'
  
  notebooks:
    - id: 'notebook-001'
      name: 'Main Notebook'
      executionMode: 'block'
      blocks:
        - id: 'block-001'
          type: text-cell-h1
          sortingKey: '1'
          content: 'Project Title'
          metadata: {}
  
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
```

### Method 3: Clone Existing Project

**From Git Repository:**
```bash
git clone https://github.com/username/project.git
cd project
code .
```

**From Deepnote Cloud:**
1. Export project as `.deepnote` file
2. Download to local machine
3. Open in VS Code

## Project Structure

### Recommended Layout

```
my-project/
├── .venv/                      # Virtual environment
├── .vscode/                    # VS Code settings
│   ├── settings.json
│   ├── launch.json
│   └── tasks.json
├── notebooks/                  # Deepnote notebooks
│   ├── 01_data-loading.deepnote
│   ├── 02_preprocessing.deepnote
│   ├── 03_analysis.deepnote
│   └── utils.deepnote          # Module notebook
├── data/                       # Data files
│   ├── raw/
│   ├── processed/
│   └── external/
├── outputs/                    # Generated outputs
│   ├── figures/
│   ├── reports/
│   └── models/
├── scripts/                    # Utility scripts
│   └── helpers.py
├── tests/                      # Test files
│   └── test_analysis.py
├── .env                        # Environment variables
├── .gitignore                  # Git ignore rules
├── requirements.txt            # Python dependencies
└── README.md                   # Project documentation
```

<!-- IMAGE: Screenshot of recommended project structure in Explorer -->
<!-- FILE: recommended-structure.png -->
<!-- CAPTION: Recommended project structure in VS Code Explorer -->

### Configuration Files

**requirements.txt:**
```txt
# Core dependencies
pandas>=2.0.0
numpy>=1.24.0
matplotlib>=3.7.0

# Data processing
scikit-learn>=1.3.0
scipy>=1.11.0

# Database connections
psycopg2-binary>=2.9.0
sqlalchemy>=2.0.0

# Deepnote toolkit
deepnote-toolkit>=1.0.0

# Development
pytest>=7.4.0
black>=23.0.0
pylint>=2.17.0
```

**.env:**
```bash
# Python environment
PYTHONPATH=.

# Database connections
SQL_POSTGRES_PROD={"host":"localhost","port":5432,"database":"analytics","username":"user","password":"pass"}
SQL_MYSQL_DEV={"host":"localhost","port":3306,"database":"testdb","username":"root","password":"pass"}

# API keys
API_KEY=your-api-key-here
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Application settings
DEBUG=true
LOG_LEVEL=INFO
```

**.gitignore:**
```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
ENV/

# Jupyter
.ipynb_checkpoints/
*.ipynb

# Data files
data/raw/*
data/processed/*
!data/raw/.gitkeep
!data/processed/.gitkeep

# Outputs
outputs/*
!outputs/.gitkeep

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Keep .deepnote files
!*.deepnote
```

**README.md:**
```markdown
# Project Name

## Overview
Brief description of the project.

## Setup

### Prerequisites
- Python 3.11+
- PostgreSQL database access

### Installation
```bash
# Clone repository
git clone https://github.com/username/project.git
cd project

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials
```

## Usage

### Running Notebooks
1. Open `notebooks/01_data-loading.deepnote`
2. Run all blocks (Ctrl+Shift+Enter)
3. Proceed to next notebook

## Project Structure
- `notebooks/` - Analysis notebooks
- `data/` - Data files
- `outputs/` - Generated results

## Contributing
See CONTRIBUTING.md

## License
MIT
```

## Opening Projects

### Open Folder

**Method 1: File Menu**
1. File → Open Folder
2. Select project directory
3. Click "Open"

**Method 2: Command Line**
```bash
code /path/to/project
```

**Method 3: Recent Projects**
1. File → Open Recent
2. Select project from list

<!-- IMAGE: Screenshot of Open Folder dialog -->
<!-- FILE: open-folder-dialog.png -->
<!-- CAPTION: Opening a project folder in VS Code -->

### Workspace Files

**Create Workspace:**
1. File → Save Workspace As
2. Choose location
3. Save as `.code-workspace` file

**Workspace Configuration:**
```json
{
  "folders": [
    {
      "path": "."
    }
  ],
  "settings": {
    "python.defaultInterpreterPath": ".venv/bin/python",
    "deepnote.autoSave": true,
    "files.exclude": {
      "**/__pycache__": true,
      "**/.venv": true
    }
  },
  "extensions": {
    "recommendations": [
      "deepnote.deepnote",
      "ms-python.python",
      "ms-toolsai.jupyter"
    ]
  }
}
```

<!-- IMAGE: Screenshot of workspace settings -->
<!-- FILE: workspace-settings.png -->
<!-- CAPTION: Workspace configuration in VS Code -->

## Managing Notebooks

### Creating Notebooks

**New Notebook File:**
1. Right-click `notebooks/` folder
2. Select "New File"
3. Name it `notebook-name.deepnote`
4. Open and start editing

**From Template:**
```bash
# Copy template
cp templates/notebook-template.deepnote notebooks/new-notebook.deepnote
```

### Organizing Notebooks

**Naming Convention:**
```
01_data-loading.deepnote
02_data-cleaning.deepnote
03_exploratory-analysis.deepnote
04_feature-engineering.deepnote
05_model-training.deepnote
06_model-evaluation.deepnote
07_visualization.deepnote
```

**Grouping by Purpose:**
```
notebooks/
├── data/
│   ├── loading.deepnote
│   └── cleaning.deepnote
├── analysis/
│   ├── exploratory.deepnote
│   └── statistical.deepnote
├── modeling/
│   ├── training.deepnote
│   └── evaluation.deepnote
└── utils/
    └── helpers.deepnote
```

<!-- IMAGE: Screenshot of organized notebook structure -->
<!-- FILE: organized-notebooks.png -->
<!-- CAPTION: Well-organized notebook structure -->

### Module Notebooks

**Create Reusable Modules:**

**File:** `notebooks/utils.deepnote`
```yaml
project:
  notebooks:
    - id: 'utils-notebook'
      name: 'Utility Functions'
      isModule: true  # Mark as module
      blocks:
        - type: code
          content: |
            def load_data(filepath):
                """Load data from file."""
                import pandas as pd
                return pd.read_csv(filepath)
            
            def clean_data(df):
                """Clean DataFrame."""
                return df.dropna()
```

**Use in Other Notebooks:**
```python
# Import from module notebook
from utils import load_data, clean_data

df = load_data('/work/data/sales.csv')
df = clean_data(df)
```

## Working with Data Files

### Adding Data Files

**Upload Files:**
1. Drag and drop into `data/` folder
2. Or right-click → "Upload Files"

**Download from URL:**
```python
import urllib.request

url = 'https://example.com/data.csv'
urllib.request.urlretrieve(url, '/work/data/data.csv')
```

**From Cloud Storage:**
```python
# AWS S3
import boto3

s3 = boto3.client('s3')
s3.download_file('bucket-name', 'data.csv', '/work/data/data.csv')

# Google Cloud Storage
from google.cloud import storage

client = storage.Client()
bucket = client.bucket('bucket-name')
blob = bucket.blob('data.csv')
blob.download_to_filename('/work/data/data.csv')
```

### Data Organization

**By Type:**
```
data/
├── csv/
├── excel/
├── json/
└── parquet/
```

**By Stage:**
```
data/
├── raw/          # Original, immutable data
├── interim/      # Intermediate processing
└── processed/    # Final, clean data
```

**By Source:**
```
data/
├── database/
├── api/
├── manual/
└── external/
```

<!-- IMAGE: Screenshot of data folder organization -->
<!-- FILE: data-organization.png -->
<!-- CAPTION: Organized data folder structure -->

## Environment Management

### Python Environments

**Create Environment:**
```bash
# Using venv
python -m venv .venv

# Using conda
conda create -n myproject python=3.11
```

**Activate Environment:**
```bash
# venv (macOS/Linux)
source .venv/bin/activate

# venv (Windows)
.venv\Scripts\activate

# conda
conda activate myproject
```

**Select in VS Code:**
1. Ctrl/Cmd + Shift + P
2. "Python: Select Interpreter"
3. Choose your environment

<!-- IMAGE: Screenshot of Python environment selection -->
<!-- FILE: python-env-selection.png -->
<!-- CAPTION: Selecting Python environment in VS Code -->

### Managing Dependencies

**Install Packages:**
```bash
# From requirements.txt
pip install -r requirements.txt

# Individual packages
pip install pandas numpy matplotlib

# With specific versions
pip install pandas==2.0.0
```

**Update requirements.txt:**
```bash
# Generate from environment
pip freeze > requirements.txt

# Or manually maintain
echo "pandas>=2.0.0" >> requirements.txt
```

**Check Installed Packages:**
```python
# In notebook
!pip list
!pip show pandas
```

## Database Integrations

### Setting Up Connections

**Environment Variables:**

**.env file:**
```bash
# PostgreSQL
SQL_POSTGRES_PROD={"host":"db.example.com","port":5432,"database":"analytics","username":"analyst","password":"secret","sslmode":"require"}

# MySQL
SQL_MYSQL_DEV={"host":"localhost","port":3306,"database":"testdb","username":"root","password":"pass"}

# Snowflake
SQL_SNOWFLAKE_WAREHOUSE={"account":"xy12345","user":"analyst","password":"pass","warehouse":"COMPUTE_WH","database":"ANALYTICS","schema":"PUBLIC"}
```

**Load in Notebook:**
```python
# First block
from dotenv import load_dotenv
import os

load_dotenv()

# Verify loaded
print("Connections loaded:", 'SQL_POSTGRES_PROD' in os.environ)
```

### Testing Connections

**Test Database Connection:**
```python
import psycopg2
import json
import os

# Load connection details
conn_str = os.getenv('SQL_POSTGRES_PROD')
conn_details = json.loads(conn_str)

# Test connection
try:
    conn = psycopg2.connect(**conn_details)
    print("✓ Connection successful")
    conn.close()
except Exception as e:
    print(f"✗ Connection failed: {e}")
```

## Version Control

### Git Workflow

**Initialize Repository:**
```bash
git init
git add .
git commit -m "Initial commit"
```

**Daily Workflow:**
```bash
# Start work
git pull origin main

# Make changes
# ... edit notebooks ...

# Stage changes
git add notebooks/

# Commit
git commit -m "Add data analysis notebook"

# Push
git push origin main
```

<!-- IMAGE: Screenshot of Git integration in VS Code -->
<!-- FILE: git-workflow.png -->
<!-- CAPTION: Git workflow in VS Code Source Control panel -->

### Branching Strategy

**Feature Branches:**
```bash
# Create feature branch
git checkout -b feature/customer-segmentation

# Work on feature
# ... make changes ...

# Commit changes
git add .
git commit -m "Implement customer segmentation"

# Push branch
git push origin feature/customer-segmentation

# Create pull request (on GitHub/GitLab)
```

**Branch Naming:**
```
feature/new-analysis
bugfix/data-loading-error
experiment/ml-model-comparison
refactor/code-cleanup
```

### Handling Merge Conflicts

**Resolve Conflicts:**
1. VS Code highlights conflicts
2. Choose "Accept Current" or "Accept Incoming"
3. Or manually edit
4. Save and commit

**For .deepnote Files:**
- Use YAML-aware merge tools
- Validate syntax after merge
- Test execution

<!-- IMAGE: Screenshot of merge conflict resolution -->
<!-- FILE: merge-conflict-resolution.png -->
<!-- CAPTION: Resolving merge conflicts in VS Code -->

## Collaboration

### Team Workflows

**Shared Repository:**
```bash
# Clone team repository
git clone https://github.com/team/project.git

# Create your branch
git checkout -b yourname/analysis

# Push your work
git push origin yourname/analysis
```

**Code Reviews:**
1. Create pull request
2. Request reviews from team
3. Address feedback
4. Merge when approved

### Project Documentation

**Document Your Work:**

**In Notebooks:**
```markdown
# Analysis Overview

## Objective
Analyze customer churn patterns

## Data Sources
- PostgreSQL: customer_data table
- S3: historical_transactions.csv

## Methodology
1. Load and clean data
2. Exploratory analysis
3. Feature engineering
4. Model training

## Results
- Churn rate: 15.3%
- Key factors: tenure, support_tickets
```

**In README:**
- Project overview
- Setup instructions
- Usage guide
- Contributing guidelines

### Sharing Projects

**Export for Sharing:**
1. Ensure all paths are relative
2. Document dependencies
3. Include sample data
4. Add setup instructions

**Share via Git:**
```bash
# Push to GitHub
git remote add origin https://github.com/username/project.git
git push -u origin main
```

**Share .deepnote File:**
1. File → Export
2. Share file directly
3. Include requirements.txt

## Project Templates

### Data Science Template

```
data-science-project/
├── notebooks/
│   ├── 01_data-exploration.deepnote
│   ├── 02_feature-engineering.deepnote
│   ├── 03_model-training.deepnote
│   └── 04_evaluation.deepnote
├── data/
│   ├── raw/
│   └── processed/
├── models/
├── reports/
│   └── figures/
├── src/
│   ├── __init__.py
│   ├── data.py
│   ├── features.py
│   └── models.py
├── tests/
├── .env
├── requirements.txt
└── README.md
```

### Analytics Template

```
analytics-project/
├── notebooks/
│   ├── daily-report.deepnote
│   ├── weekly-summary.deepnote
│   └── monthly-analysis.deepnote
├── data/
│   └── exports/
├── dashboards/
├── sql/
│   └── queries/
├── .env
├── requirements.txt
└── README.md
```

### ETL Pipeline Template

```
etl-project/
├── notebooks/
│   ├── extract.deepnote
│   ├── transform.deepnote
│   └── load.deepnote
├── data/
│   ├── staging/
│   └── warehouse/
├── logs/
├── config/
├── .env
├── requirements.txt
└── README.md
```

## Advanced Project Features

### Multi-Notebook Workflows

**Chain Notebooks:**

**File:** `run_pipeline.py`
```python
import subprocess

notebooks = [
    'notebooks/01_data-loading.deepnote',
    'notebooks/02_preprocessing.deepnote',
    'notebooks/03_analysis.deepnote'
]

for notebook in notebooks:
    print(f"Running {notebook}...")
    subprocess.run(['deepnote-cli', 'run', notebook])
    print(f"✓ Completed {notebook}")
```

### Automated Testing

**Test Notebooks:**

**File:** `tests/test_notebooks.py`
```python
import pytest
from deepnote_toolkit import validate_notebook

def test_data_loading():
    """Test data loading notebook."""
    result = validate_notebook('notebooks/01_data-loading.deepnote')
    assert result.success
    assert 'df' in result.variables

def test_analysis():
    """Test analysis notebook."""
    result = validate_notebook('notebooks/03_analysis.deepnote')
    assert result.success
    assert result.variables['df'].shape[0] > 0
```

**Run Tests:**
```bash
pytest tests/
```

### CI/CD Integration

**GitHub Actions:**

**File:** `.github/workflows/test.yml`
```yaml
name: Test Notebooks

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.11'
    
    - name: Install dependencies
      run: |
        pip install -r requirements.txt
        pip install pytest
    
    - name: Run tests
      run: pytest tests/
```

<!-- IMAGE: Screenshot of CI/CD pipeline running -->
<!-- FILE: cicd-pipeline.png -->
<!-- CAPTION: CI/CD pipeline testing notebooks -->

## Project Maintenance

### Cleaning Up

**Remove Outputs:**
```bash
# Clear all outputs
find notebooks/ -name "*.deepnote" -exec deepnote-cli clear-outputs {} \;
```

**Clean Data:**
```bash
# Remove temporary files
rm -rf data/interim/*
rm -rf outputs/temp/*
```

**Update Dependencies:**
```bash
# Update packages
pip install --upgrade -r requirements.txt

# Regenerate requirements
pip freeze > requirements.txt
```

### Archiving Projects

**Archive Completed Project:**
```bash
# Create archive
tar -czf project-archive-$(date +%Y%m%d).tar.gz \
  notebooks/ \
  data/ \
  outputs/ \
  requirements.txt \
  README.md

# Move to archive
mv project-archive-*.tar.gz ~/archives/
```

### Project Backup

**Backup Strategy:**
1. Git repository (code and notebooks)
2. Cloud storage (data files)
3. Local backup (complete project)

```bash
# Backup to cloud
aws s3 sync . s3://my-backup-bucket/project-name/ \
  --exclude ".venv/*" \
  --exclude "__pycache__/*"
```

## Troubleshooting

### Common Issues

**Issue: Python Interpreter Not Found**
- Solution: Select interpreter in VS Code
- Command: "Python: Select Interpreter"

**Issue: Packages Not Found**
- Solution: Activate virtual environment
- Check: `which python` shows correct path

**Issue: Environment Variables Not Loading**
- Solution: Install python-dotenv
- Add: `load_dotenv()` in first block

**Issue: Git Merge Conflicts**
- Solution: Use VS Code merge editor
- Validate YAML syntax after merge

## Best Practices

### Project Organization
- ✅ Use consistent naming conventions
- ✅ Separate data, code, and outputs
- ✅ Document dependencies
- ✅ Use version control

### Code Quality
- ✅ Add docstrings to functions
- ✅ Use type hints
- ✅ Follow PEP 8 style guide
- ✅ Write tests

### Collaboration
- ✅ Write clear commit messages
- ✅ Create descriptive pull requests
- ✅ Review code thoroughly
- ✅ Document changes

### Security
- ✅ Never commit credentials
- ✅ Use environment variables
- ✅ Add .env to .gitignore
- ✅ Rotate secrets regularly

## Related Documentation

- [Deepnote VS Code Extension](./vscode-extension.md) - Extension features
- [Running .deepnote in VS Code](./vscode-running.md) - Execution guide
- [Reading .deepnote Files](./reading-deepnote-files.md) - File format
- [Migrating to Cloud](./migrating-to-cloud.md) - Cloud migration

## Conclusion

Effective project management in VS Code enables productive data science workflows. By following these guidelines and best practices, you can maintain organized, collaborative, and reproducible Deepnote projects.

**Happy analyzing! 📊**
