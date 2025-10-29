---
title: Moving Local Workflows to Cloud
description: Complete guide to transitioning from local notebook development to cloud-based workflows with Deepnote, including hybrid approaches and best practices.
noIndex: false
noContent: false
---

# Moving Local Workflows to Cloud

This guide helps you transition from local notebook development to cloud-based workflows, whether you're moving completely to the cloud or adopting a hybrid approach.

## Understanding the Shift

### Local Development

**Characteristics:**
- 💻 Runs on your computer
- 📁 Files stored locally
- 🔧 Manual environment setup
- 👤 Single-user access
- 🏠 Works offline

**Advantages:**
- ✅ Full control
- ✅ No internet required
- ✅ Use local resources
- ✅ Privacy

**Limitations:**
- ❌ Limited by local hardware
- ❌ Manual setup required
- ❌ Difficult to share
- ❌ No collaboration
- ❌ Tied to one machine

<!-- IMAGE: Diagram showing local development setup -->
<!-- FILE: local-development-diagram.png -->
<!-- CAPTION: Local development environment -->

### Cloud Development

**Characteristics:**
- ☁️ Runs in the cloud
- 🌐 Access from anywhere
- ⚡ Scalable resources
- 👥 Team collaboration
- 🔄 Always in sync

**Advantages:**
- ✅ Access from anywhere
- ✅ Scalable compute
- ✅ Real-time collaboration
- ✅ Managed infrastructure
- ✅ Built-in integrations
- ✅ Scheduled execution

**Limitations:**
- ❌ Requires internet
- ❌ Data in cloud
- ❌ Subscription cost
- ❌ Less control

<!-- IMAGE: Diagram showing cloud development setup -->
<!-- FILE: cloud-development-diagram.png -->
<!-- CAPTION: Cloud development environment -->

### Hybrid Approach

**Best of Both Worlds:**
- 💻 Develop locally when needed
- ☁️ Deploy to cloud for sharing
- 🔄 Sync via Git
- 👥 Collaborate in cloud
- 🏠 Work offline, sync later

<!-- IMAGE: Diagram showing hybrid workflow -->
<!-- FILE: hybrid-workflow-diagram.png -->
<!-- CAPTION: Hybrid local + cloud workflow -->

## Migration Strategies

### Strategy 1: Full Cloud Migration

**When to Use:**
- Team collaboration is priority
- Need scalable compute
- Want managed infrastructure
- Sharing is frequent

**Process:**
1. Export local notebooks
2. Upload to Deepnote Cloud
3. Configure environment
4. Set up integrations
5. Invite team
6. Archive local setup

**Timeline:** 1-2 weeks

<!-- IMAGE: Flowchart showing full migration process -->
<!-- FILE: full-migration-flowchart.png -->
<!-- CAPTION: Full cloud migration process -->

### Strategy 2: Hybrid Workflow

**When to Use:**
- Need offline capability
- Want local development speed
- Require cloud collaboration
- Have sensitive local data

**Process:**
1. Keep local development
2. Set up Deepnote Cloud
3. Configure Git sync
4. Develop locally
5. Push to cloud for sharing
6. Pull updates from team

**Timeline:** 1 week setup, ongoing

<!-- IMAGE: Flowchart showing hybrid workflow -->
<!-- FILE: hybrid-workflow-flowchart.png -->
<!-- CAPTION: Hybrid workflow process -->

### Strategy 3: Gradual Migration

**When to Use:**
- Large existing codebase
- Risk-averse organization
- Learning curve needed
- Testing cloud benefits

**Process:**
1. Start with new projects in cloud
2. Migrate simple notebooks
3. Test and learn
4. Migrate complex notebooks
5. Eventually move everything
6. Or keep hybrid long-term

**Timeline:** 2-6 months

<!-- IMAGE: Timeline showing gradual migration phases -->
<!-- FILE: gradual-migration-timeline.png -->
<!-- CAPTION: Gradual migration timeline -->

## Step-by-Step Migration

### Phase 1: Assessment

**Inventory Your Notebooks:**
```bash
# Find all notebooks
find . -name "*.ipynb" -o -name "*.deepnote"

# Count notebooks
find . -name "*.ipynb" | wc -l

# Check sizes
du -sh notebooks/

# List dependencies
cat requirements.txt
pip freeze > current_environment.txt
```

**Categorize Notebooks:**
```markdown
## Migration Priority

### High Priority (Migrate First)
- [ ] Team collaboration notebooks
- [ ] Frequently shared analyses
- [ ] Production dashboards
- [ ] Scheduled reports

### Medium Priority (Migrate Second)
- [ ] Individual analyses
- [ ] Exploratory work
- [ ] Documentation notebooks

### Low Priority (Keep Local or Migrate Last)
- [ ] Personal experiments
- [ ] Archived projects
- [ ] One-time analyses
```

**Assess Dependencies:**
```python
# check_dependencies.py
import pkg_resources
import json

def check_cloud_compatibility():
    """Check if packages are cloud-compatible."""
    
    installed = {pkg.key: pkg.version for pkg in pkg_resources.working_set}
    
    # Common cloud-compatible packages
    compatible = [
        'pandas', 'numpy', 'matplotlib', 'seaborn',
        'scikit-learn', 'scipy', 'statsmodels',
        'plotly', 'altair', 'bokeh'
    ]
    
    # Potentially problematic packages
    problematic = [
        'pyspark',  # Requires cluster setup
        'tensorflow-gpu',  # Requires GPU
        'opencv-python',  # May need system libraries
    ]
    
    print("✓ Compatible packages:")
    for pkg in compatible:
        if pkg in installed:
            print(f"  - {pkg}: {installed[pkg]}")
    
    print("\n⚠ Potentially problematic:")
    for pkg in problematic:
        if pkg in installed:
            print(f"  - {pkg}: {installed[pkg]}")

check_cloud_compatibility()
```

<!-- IMAGE: Screenshot of assessment checklist -->
<!-- FILE: assessment-checklist.png -->
<!-- CAPTION: Migration assessment checklist -->

### Phase 2: Preparation

**Clean Up Notebooks:**
```bash
# Remove outputs
jupyter nbconvert --clear-output --inplace notebooks/*.ipynb

# Remove checkpoints
find . -name ".ipynb_checkpoints" -type d -exec rm -rf {} +

# Organize files
mkdir -p notebooks/{active,archived,experimental}
```

**Document Current Setup:**
```markdown
# Current Local Setup

## Environment
- Python: 3.11.0
- OS: macOS 14.0
- RAM: 16 GB
- Storage: 500 GB SSD

## Dependencies
See requirements.txt

## Data Sources
- Local CSV files: ~/data/
- PostgreSQL: localhost:5432
- MySQL: localhost:3306

## File Paths
- Data: ~/projects/analysis/data/
- Notebooks: ~/projects/analysis/notebooks/
- Outputs: ~/projects/analysis/outputs/

## Scheduled Jobs
- Daily report: cron at 2 AM
- Weekly summary: cron on Mondays
```

**Create Migration Plan:**
```markdown
# Migration Plan

## Week 1: Setup
- [ ] Create Deepnote account
- [ ] Set up team workspace
- [ ] Configure environment
- [ ] Test with sample notebook

## Week 2: Data Migration
- [ ] Upload sample data
- [ ] Set up database integrations
- [ ] Configure cloud storage
- [ ] Test data access

## Week 3: Notebook Migration
- [ ] Migrate high-priority notebooks
- [ ] Test execution
- [ ] Fix path issues
- [ ] Verify outputs

## Week 4: Team Onboarding
- [ ] Invite team members
- [ ] Training sessions
- [ ] Documentation
- [ ] Feedback collection
```

### Phase 3: Cloud Setup

**Create Deepnote Account:**
1. Go to [deepnote.com](https://deepnote.com)
2. Sign up with email or Google/GitHub
3. Choose plan (Free, Team, or Enterprise)
4. Create workspace

<!-- IMAGE: Screenshot of Deepnote signup page -->
<!-- FILE: deepnote-signup.png -->
<!-- CAPTION: Creating Deepnote account -->

**Configure Environment:**
```yaml
# In Deepnote Cloud: Environment settings

# Python version
pythonVersion: '3.11'

# Packages
requirements:
  - 'pandas>=2.0.0'
  - 'numpy>=1.24.0'
  - 'matplotlib>=3.7.0'
  - 'seaborn>=0.12.0'
  - 'scikit-learn>=1.3.0'
  - 'sqlalchemy>=2.0.0'
  - 'psycopg2-binary>=2.9.0'
  - 'python-dotenv>=1.0.0'

# Environment variables
environmentVariables:
  - name: 'API_KEY'
    value: 'your-api-key'
    secret: true
  
  - name: 'DB_HOST'
    value: 'db.example.com'
    secret: false
```

<!-- IMAGE: Screenshot of environment configuration -->
<!-- FILE: environment-config.png -->
<!-- CAPTION: Configuring cloud environment -->

**Set Up Integrations:**

**PostgreSQL:**
```
Integration Name: Production Database
Type: PostgreSQL
Host: db.example.com
Port: 5432
Database: analytics
Username: analyst
Password: ••••••••
SSL Mode: require
```

**AWS S3:**
```
Integration Name: Data Lake
Type: AWS S3
Access Key ID: AKIAIOSFODNN7EXAMPLE
Secret Access Key: ••••••••
Region: us-east-1
Bucket: company-data-lake
```

**Snowflake:**
```
Integration Name: Data Warehouse
Type: Snowflake
Account: xy12345.us-east-1
Username: analyst
Password: ••••••••
Warehouse: COMPUTE_WH
Database: ANALYTICS
Schema: PUBLIC
```

<!-- IMAGE: Screenshot of integration setup -->
<!-- FILE: integration-setup.png -->
<!-- CAPTION: Setting up database integrations -->

### Phase 4: Data Migration

**Option 1: Upload Files**
```bash
# Small files (< 100 MB)
# Upload via Deepnote UI

# Or use API
curl -X POST https://api.deepnote.com/v1/files/upload \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "file=@data/sales.csv" \
  -F "path=/work/data/sales.csv"
```

**Option 2: Cloud Storage**
```python
# Upload to S3
import boto3

s3 = boto3.client('s3')
s3.upload_file('data/sales.csv', 'company-data-lake', 'sales.csv')

# Access in Deepnote
import boto3
s3 = boto3.client('s3')
s3.download_file('company-data-lake', 'sales.csv', '/work/data/sales.csv')
```

**Option 3: Database Access**
```sql
-- SQL Block in Deepnote
-- Integration: Production Database
-- Variable: sales_data

SELECT * FROM sales
WHERE date >= '2024-01-01'
```

<!-- IMAGE: Screenshot of data upload options -->
<!-- FILE: data-upload-options.png -->
<!-- CAPTION: Data migration options -->

### Phase 5: Notebook Migration

**Convert Notebooks:**
```bash
# Convert .ipynb to .deepnote
deepnote-convert notebook.ipynb -o notebook.deepnote

# Batch convert
for file in notebooks/*.ipynb; do
  deepnote-convert "$file" -o "cloud/${file%.ipynb}.deepnote"
done
```

**Update File Paths:**
```python
# Local paths
df = pd.read_csv('data/sales.csv')
df = pd.read_csv('../data/sales.csv')
df = pd.read_csv('/Users/username/data/sales.csv')

# Cloud paths
df = pd.read_csv('/work/data/sales.csv')

# Or use pathlib for portability
from pathlib import Path
import os

# Detect environment
is_cloud = os.path.exists('/work')
data_dir = Path('/work/data') if is_cloud else Path('data')

df = pd.read_csv(data_dir / 'sales.csv')
```

**Update Database Connections:**
```python
# Local connection
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    database="mydb",
    user="user",
    password="pass"
)

# Cloud - use SQL blocks instead
# No connection code needed!
```

**Replace Widgets:**
```python
# Local (ipywidgets)
import ipywidgets as widgets
slider = widgets.IntSlider(min=0, max=100, value=50)
display(slider)

# Cloud (input blocks)
# Create input-slider block
# Variable: slider_value
# Min: 0, Max: 100, Default: 50
```

**Test Execution:**
```python
# Add at start of notebook
import sys
print(f"Python: {sys.version}")
print(f"Platform: {sys.platform}")

import os
print(f"Working directory: {os.getcwd()}")
print(f"Is cloud: {os.path.exists('/work')}")

# Verify packages
import pandas as pd
import numpy as np
print(f"pandas: {pd.__version__}")
print(f"numpy: {np.__version__}")
```

<!-- IMAGE: Screenshot of migrated notebook running in cloud -->
<!-- FILE: migrated-notebook-running.png -->
<!-- CAPTION: Migrated notebook executing in cloud -->

### Phase 6: Workflow Adaptation

**Scheduled Execution:**

**Local (cron):**
```bash
# crontab -e
0 2 * * * cd /path/to/project && jupyter nbconvert --execute notebook.ipynb
```

**Cloud (Deepnote):**
1. Click "Schedule" button
2. Choose frequency: Daily
3. Set time: 2:00 AM
4. Configure notifications
5. Save

<!-- IMAGE: Screenshot of schedule configuration -->
<!-- FILE: schedule-config.png -->
<!-- CAPTION: Configuring scheduled execution -->

**Collaboration:**

**Local (Git):**
```bash
# Edit notebook
git add notebook.ipynb
git commit -m "Update analysis"
git push

# Team member pulls
git pull
# Merge conflicts possible
```

**Cloud (Real-time):**
- Open shared project
- Edit together
- See changes live
- No merge conflicts
- Built-in comments

<!-- IMAGE: Screenshot of real-time collaboration -->
<!-- FILE: realtime-collab.png -->
<!-- CAPTION: Real-time collaboration in cloud -->

**Sharing Results:**

**Local:**
```bash
# Export to HTML
jupyter nbconvert --to html notebook.ipynb

# Email or upload to server
```

**Cloud:**
1. Click "Share" button
2. Choose permissions
3. Generate link
4. Or publish as app

<!-- IMAGE: Screenshot of sharing options -->
<!-- FILE: sharing-options.png -->
<!-- CAPTION: Sharing options in cloud -->

## Hybrid Workflow Setup

### Git-Based Sync

**Repository Structure:**
```
project/
├── .git/
├── .gitignore
├── notebooks/
│   ├── analysis.deepnote    # Commit this
│   └── analysis.ipynb        # Don't commit (generated)
├── data/
│   └── .gitkeep
├── outputs/
│   └── .gitkeep
├── requirements.txt
└── README.md
```

**.gitignore:**
```gitignore
# Local working copies
*.ipynb

# Keep Deepnote format
!*.deepnote

# Python
__pycache__/
*.pyc
.venv/
venv/

# Data (too large for Git)
data/*
!data/.gitkeep

# Outputs
outputs/*
!outputs/.gitkeep

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db
```

**Workflow:**

**Local Development:**
```bash
# 1. Pull latest
git pull origin main

# 2. Convert to .ipynb for local work
deepnote-convert notebooks/analysis.deepnote -o notebooks/analysis.ipynb

# 3. Work in JupyterLab
jupyter lab notebooks/analysis.ipynb

# 4. Convert back to .deepnote
deepnote-convert notebooks/analysis.ipynb -o notebooks/analysis.deepnote --clearOutputs

# 5. Commit and push
git add notebooks/analysis.deepnote
git commit -m "Update analysis"
git push origin main
```

**Cloud Sync:**
```bash
# Deepnote Cloud automatically syncs with Git
# Or manually sync:
# 1. Pull from Git in Deepnote
# 2. Make changes in Deepnote
# 3. Commit and push from Deepnote
```

<!-- IMAGE: Diagram showing Git-based sync workflow -->
<!-- FILE: git-sync-workflow.png -->
<!-- CAPTION: Git-based hybrid workflow -->

### Automation Scripts

**Sync Script:**
```bash
#!/bin/bash
# sync.sh - Sync between local and cloud

case "$1" in
  pull)
    echo "Pulling from cloud..."
    git pull origin main
    
    echo "Converting to .ipynb for local work..."
    for file in notebooks/*.deepnote; do
      deepnote-convert "$file" -o "${file%.deepnote}.ipynb"
    done
    ;;
  
  push)
    echo "Converting to .deepnote..."
    for file in notebooks/*.ipynb; do
      deepnote-convert "$file" -o "${file%.ipynb}.deepnote" --clearOutputs
    done
    
    echo "Pushing to cloud..."
    git add notebooks/*.deepnote
    git commit -m "Update notebooks"
    git push origin main
    ;;
  
  *)
    echo "Usage: $0 {pull|push}"
    exit 1
    ;;
esac
```

**Usage:**
```bash
# Start work (pull from cloud)
./sync.sh pull

# Work locally in JupyterLab
jupyter lab

# End work (push to cloud)
./sync.sh push
```

**Makefile:**
```makefile
.PHONY: pull push start clean

pull:
	git pull origin main
	@for file in notebooks/*.deepnote; do \
		deepnote-convert "$$file" -o "$${file%.deepnote}.ipynb"; \
	done

push:
	@for file in notebooks/*.ipynb; do \
		deepnote-convert "$$file" -o "$${file%.ipynb}.deepnote" --clearOutputs; \
	done
	git add notebooks/*.deepnote
	git commit -m "Update notebooks"
	git push origin main

start: pull
	jupyter lab

clean:
	rm -f notebooks/*.ipynb
```

**Usage:**
```bash
# Start working
make start

# Push changes
make push

# Clean local copies
make clean
```

## Common Challenges and Solutions

### Challenge 1: File Paths

**Problem:** Local paths don't work in cloud

**Solution:**
```python
# Portable path handling
import os
from pathlib import Path

# Detect environment
IS_CLOUD = os.path.exists('/work')

# Set base paths
if IS_CLOUD:
    BASE_DIR = Path('/work')
    DATA_DIR = BASE_DIR / 'data'
    OUTPUT_DIR = BASE_DIR / 'outputs'
else:
    BASE_DIR = Path.cwd()
    DATA_DIR = BASE_DIR / 'data'
    OUTPUT_DIR = BASE_DIR / 'outputs'

# Use portable paths
df = pd.read_csv(DATA_DIR / 'sales.csv')
df.to_csv(OUTPUT_DIR / 'results.csv')
```

### Challenge 2: Large Data Files

**Problem:** Data files too large for cloud upload

**Solution:**
```python
# Option 1: Use cloud storage
import boto3

s3 = boto3.client('s3')
obj = s3.get_object(Bucket='my-bucket', Key='large-file.csv')
df = pd.read_csv(obj['Body'])

# Option 2: Use database
# SQL Block
# SELECT * FROM large_table

# Option 3: Stream data
import pandas as pd

chunks = []
for chunk in pd.read_csv('large-file.csv', chunksize=10000):
    processed = process_chunk(chunk)
    chunks.append(processed)

df = pd.concat(chunks)
```

### Challenge 3: Local Dependencies

**Problem:** Some packages only work locally

**Solution:**
```python
# Conditional imports
import sys

if sys.platform == 'darwin':  # macOS
    import local_only_package
else:
    # Use alternative in cloud
    import cloud_compatible_package

# Or check environment
import os

if os.path.exists('/work'):
    # Cloud environment
    use_cloud_approach()
else:
    # Local environment
    use_local_approach()
```

### Challenge 4: Credentials Management

**Problem:** How to handle secrets securely

**Solution:**

**Local (.env file):**
```bash
# .env (never commit!)
API_KEY=your-api-key
DB_PASSWORD=your-password
```

```python
from dotenv import load_dotenv
import os

load_dotenv()
api_key = os.getenv('API_KEY')
```

**Cloud (Environment Variables):**
1. Go to Settings → Environment Variables
2. Add variables
3. Mark as "Secret"
4. Use in notebooks

```python
import os
api_key = os.getenv('API_KEY')  # Works in both!
```

### Challenge 5: Performance Differences

**Problem:** Cloud runs slower/faster than local

**Solution:**
```python
# Profile code
import time

start = time.time()
result = expensive_operation()
end = time.time()

print(f"Execution time: {end - start:.2f}s")

# Optimize for cloud
# - Use vectorized operations
# - Leverage cloud resources
# - Cache results
# - Use appropriate hardware tier
```

<!-- IMAGE: Screenshot showing performance comparison -->
<!-- FILE: performance-comparison.png -->
<!-- CAPTION: Performance comparison: local vs cloud -->

## Best Practices

### 1. Start Small

```markdown
## Migration Phases

### Phase 1: Pilot (Week 1)
- Migrate 1-2 simple notebooks
- Test basic functionality
- Learn cloud features

### Phase 2: Expand (Weeks 2-4)
- Migrate team collaboration notebooks
- Set up integrations
- Train team

### Phase 3: Scale (Months 2-3)
- Migrate remaining notebooks
- Optimize workflows
- Establish best practices
```

### 2. Document Everything

```markdown
# Cloud Migration Guide

## Environment Setup
- Python version: 3.11
- Required packages: See requirements.txt
- Environment variables: See .env.example

## File Paths
- Local: `data/file.csv`
- Cloud: `/work/data/file.csv`

## Database Connections
- Local: Manual connection
- Cloud: Use SQL blocks with integrations

## Scheduled Jobs
- Local: cron
- Cloud: Deepnote scheduler

## Troubleshooting
- Issue 1: File not found
  - Solution: Check path format
- Issue 2: Package missing
  - Solution: Add to requirements
```

### 3. Maintain Compatibility

```python
# Write portable code
import os
from pathlib import Path

class Config:
    """Environment-aware configuration."""
    
    IS_CLOUD = os.path.exists('/work')
    
    if IS_CLOUD:
        BASE_DIR = Path('/work')
        USE_SQL_BLOCKS = True
    else:
        BASE_DIR = Path.cwd()
        USE_SQL_BLOCKS = False
    
    DATA_DIR = BASE_DIR / 'data'
    OUTPUT_DIR = BASE_DIR / 'outputs'

# Use config
df = pd.read_csv(Config.DATA_DIR / 'sales.csv')
```

### 4. Test Thoroughly

```python
# Test notebook
def test_notebook():
    """Test notebook execution."""
    
    # Test imports
    try:
        import pandas as pd
        import numpy as np
        print("✓ Imports successful")
    except ImportError as e:
        print(f"✗ Import failed: {e}")
        return False
    
    # Test data access
    try:
        df = pd.read_csv(Config.DATA_DIR / 'test.csv')
        print(f"✓ Data loaded: {len(df)} rows")
    except FileNotFoundError:
        print("✗ Data file not found")
        return False
    
    # Test processing
    try:
        result = process_data(df)
        print(f"✓ Processing successful: {len(result)} rows")
    except Exception as e:
        print(f"✗ Processing failed: {e}")
        return False
    
    print("\n✓ All tests passed!")
    return True

test_notebook()
```

### 5. Monitor and Optimize

```python
# Monitor execution
import time
import psutil
import os

def monitor_execution(func):
    """Monitor function execution."""
    
    def wrapper(*args, **kwargs):
        # Start monitoring
        start_time = time.time()
        process = psutil.Process(os.getpid())
        start_memory = process.memory_info().rss / 1024 / 1024
        
        # Execute
        result = func(*args, **kwargs)
        
        # End monitoring
        end_time = time.time()
        end_memory = process.memory_info().rss / 1024 / 1024
        
        # Report
        print(f"\nExecution Stats:")
        print(f"  Time: {end_time - start_time:.2f}s")
        print(f"  Memory: {end_memory - start_memory:.2f} MB")
        
        return result
    
    return wrapper

@monitor_execution
def process_data(df):
    # Your processing code
    return df
```

## Migration Checklist

### Pre-Migration
- [ ] Inventory all notebooks
- [ ] Document current setup
- [ ] List dependencies
- [ ] Identify data sources
- [ ] Check package compatibility
- [ ] Create migration plan

### Setup
- [ ] Create Deepnote account
- [ ] Set up workspace
- [ ] Configure environment
- [ ] Install packages
- [ ] Set up integrations
- [ ] Configure environment variables

### Data Migration
- [ ] Upload small files
- [ ] Set up cloud storage
- [ ] Configure database access
- [ ] Test data loading
- [ ] Verify data integrity

### Notebook Migration
- [ ] Convert notebooks
- [ ] Update file paths
- [ ] Replace local connections
- [ ] Update widgets
- [ ] Test execution
- [ ] Verify outputs

### Workflow Setup
- [ ] Configure Git sync
- [ ] Set up schedules
- [ ] Configure notifications
- [ ] Test collaboration
- [ ] Document workflows

### Training
- [ ] Train team on cloud features
- [ ] Document best practices
- [ ] Create troubleshooting guide
- [ ] Collect feedback

### Optimization
- [ ] Monitor performance
- [ ] Optimize slow notebooks
- [ ] Review costs
- [ ] Adjust resources
- [ ] Refine workflows

## Related Documentation

- [Migrating to Deepnote Cloud](./migrating-to-cloud.md) - Cloud migration
- [Organizing Notebooks](./organizing-notebooks.md) - Project structure
- [Deepnote in JupyterLab](./deepnote-in-jupyterlab.md) - Hybrid workflows
- [VS Code Extension](./vscode-extension.md) - Local development

## Conclusion

Moving from local to cloud workflows is a significant transition that offers powerful benefits in collaboration, scalability, and accessibility. Whether you choose full migration, hybrid approach, or gradual transition, proper planning and execution ensures a smooth move to cloud-based development.

**Start your cloud journey today! ☁️**
