---
title: Migrating from Local to Deepnote Cloud
description: Complete guide to migrating your local Deepnote notebooks to Deepnote Cloud, including setup, deployment, and best practices.
noIndex: false
noContent: false
---

# Migrating from Local to Deepnote Cloud

This guide walks you through migrating your locally developed Deepnote notebooks to Deepnote Cloud, taking advantage of cloud features like real-time collaboration, managed infrastructure, and integrated data sources.

## Why Migrate to Deepnote Cloud?

### Benefits of Deepnote Cloud

**Collaboration:**
- Real-time collaborative editing
- Comments and discussions
- Team workspaces
- Shared projects and notebooks

**Infrastructure:**
- Managed compute resources
- Scalable hardware (CPU/GPU)
- No local environment setup
- Automatic dependency management

**Integrations:**
- One-click database connections
- Pre-configured data sources
- OAuth authentication
- Secure credential management

**Features:**
- Scheduled notebook runs
- Version history
- Publishing and sharing
- Interactive apps and dashboards

<!-- IMAGE: Screenshot of Deepnote Cloud interface showing collaborative editing with multiple cursors -->
<!-- FILE: deepnote-cloud-collaboration.png -->
<!-- CAPTION: Real-time collaboration in Deepnote Cloud -->

## Prerequisites

Before migrating, ensure you have:

- ✅ A Deepnote Cloud account ([sign up](https://deepnote.com))
- ✅ Your `.deepnote` file(s) ready
- ✅ List of dependencies and requirements
- ✅ Database connection details (if applicable)
- ✅ Any data files or assets needed

## Migration Process Overview

The migration process consists of five main steps:

1. **Prepare** - Review and clean up your local notebooks
2. **Upload** - Import your `.deepnote` file to Deepnote Cloud
3. **Configure** - Set up environment and integrations
4. **Test** - Verify all blocks execute correctly
5. **Optimize** - Take advantage of cloud features

## Step 1: Prepare Your Local Notebooks

### Review Your Notebooks

Before uploading, review your notebooks:

**Check Dependencies:**
```bash
# List all imports in your notebooks
grep -r "^import\|^from" *.deepnote | sort | uniq
```

**Identify External Files:**
```bash
# Find file references
grep -r "read_csv\|read_excel\|open(" *.deepnote
```

**List Database Connections:**
```bash
# Find SQL blocks
yq '.project.notebooks[].blocks[] | select(.type == "sql")' notebook.deepnote
```

### Clean Up Your File

Remove local-specific content:

**Remove Local File Paths:**
```python
# Before (local path)
df = pd.read_csv('/Users/username/data/sales.csv')

# After (cloud-compatible)
df = pd.read_csv('/work/data/sales.csv')
```

**Remove Local Environment Variables:**
```python
# Before (local env var)
import os
api_key = os.getenv('LOCAL_API_KEY')

# After (use Deepnote environment variables)
import os
api_key = os.getenv('API_KEY')
```

**Update Database Connections:**
```python
# Before (local connection)
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="mydb"
)

# After (use Deepnote integration)
# Will be handled by SQL blocks with integrations
```

### Create a Checklist

Document what needs to be configured in the cloud:

```markdown
## Migration Checklist

### Dependencies
- [ ] pandas>=2.0.0
- [ ] numpy>=1.24.0
- [ ] scikit-learn>=1.3.0

### Integrations
- [ ] PostgreSQL - Production Database
- [ ] Snowflake - Data Warehouse
- [ ] AWS S3 - Data Storage

### Environment Variables
- [ ] API_KEY
- [ ] AWS_ACCESS_KEY_ID
- [ ] AWS_SECRET_ACCESS_KEY

### Data Files
- [ ] sales_data.csv (10 MB)
- [ ] customer_data.xlsx (5 MB)
- [ ] model_weights.pkl (50 MB)
```

## Step 2: Upload to Deepnote Cloud

### Method 1: Upload .deepnote File

1. **Log in to Deepnote Cloud**
   - Go to [deepnote.com](https://deepnote.com)
   - Sign in or create an account

<!-- IMAGE: Screenshot of Deepnote Cloud login page -->
<!-- FILE: deepnote-login.png -->
<!-- CAPTION: Deepnote Cloud login page -->

2. **Create New Project**
   - Click "New project" button
   - Choose "Upload .deepnote file"

<!-- IMAGE: Screenshot showing "New project" dropdown with "Upload .deepnote file" option -->
<!-- FILE: upload-deepnote-file-option.png -->
<!-- CAPTION: Creating a new project from .deepnote file -->

3. **Select Your File**
   - Browse to your `.deepnote` file
   - Click "Upload"
   - Wait for import to complete

<!-- IMAGE: Screenshot of file upload dialog with .deepnote file selected -->
<!-- FILE: file-upload-dialog.png -->
<!-- CAPTION: Uploading .deepnote file to Deepnote Cloud -->

4. **Review Import Results**
   - Check that all notebooks imported
   - Verify block count matches
   - Review any import warnings

<!-- IMAGE: Screenshot showing successful import with notebook list -->
<!-- FILE: import-success.png -->
<!-- CAPTION: Successful import confirmation -->

### Method 2: Import from Git Repository

If your notebooks are in a Git repository:

1. **Connect Git Repository**
   - Click "New project"
   - Choose "Import from Git"
   - Enter repository URL

<!-- IMAGE: Screenshot of Git import dialog -->
<!-- FILE: git-import-dialog.png -->
<!-- CAPTION: Importing from Git repository -->

2. **Select Branch and Path**
   - Choose the branch containing your `.deepnote` file
   - Specify the file path
   - Click "Import"

3. **Configure Git Integration**
   - Set up automatic sync (optional)
   - Configure push/pull permissions

<!-- IMAGE: Screenshot of Git integration settings -->
<!-- FILE: git-integration-settings.png -->
<!-- CAPTION: Git integration configuration -->

### Method 3: Convert from Jupyter Notebook

If you have Jupyter notebooks (`.ipynb`):

1. **Convert Locally First**
   ```bash
   # Install converter
   npm install -g @deepnote/convert
   
   # Convert notebook
   deepnote-convert notebook.ipynb -o notebook.deepnote
   ```

2. **Upload Converted File**
   - Follow Method 1 steps above

3. **Or Use Direct Import**
   - Click "New project"
   - Choose "Upload Jupyter notebook"
   - Select `.ipynb` file

<!-- IMAGE: Screenshot showing Jupyter import option -->
<!-- FILE: jupyter-import-option.png -->
<!-- CAPTION: Direct Jupyter notebook import -->

## Step 3: Configure Your Cloud Environment

### Set Up Python Environment

1. **Navigate to Environment Settings**
   - Open your project
   - Click "Environment" in the left sidebar
   - Or use the settings icon

<!-- IMAGE: Screenshot of Environment settings panel -->
<!-- FILE: environment-settings.png -->
<!-- CAPTION: Environment configuration panel -->

2. **Select Python Version**
   - Choose Python version (3.9, 3.10, 3.11)
   - Match your local version if possible

<!-- IMAGE: Screenshot showing Python version selector -->
<!-- FILE: python-version-selector.png -->
<!-- CAPTION: Selecting Python version -->

3. **Add Dependencies**
   - Click "Add package"
   - Enter package names with versions
   - Or paste your `requirements.txt` content

```txt
pandas>=2.0.0
numpy>=1.24.0
scikit-learn>=1.3.0
matplotlib>=3.7.0
seaborn>=0.12.0
```

<!-- IMAGE: Screenshot of package installation interface -->
<!-- FILE: package-installation.png -->
<!-- CAPTION: Adding Python packages -->

4. **Install Custom Packages**
   - For packages not in PyPI
   - Use `init.ipynb` notebook
   - Add installation commands

```python
# In init.ipynb
!pip install git+https://github.com/user/custom-package.git
```

### Configure Integrations

#### Adding Database Integrations

1. **Open Integrations Panel**
   - Click "Integrations" in the left sidebar
   - Click "Add integration"

<!-- IMAGE: Screenshot of Integrations panel with "Add integration" button -->
<!-- FILE: integrations-panel.png -->
<!-- CAPTION: Integrations management panel -->

2. **Select Database Type**
   - Choose your database (PostgreSQL, MySQL, Snowflake, etc.)
   - Click "Connect"

<!-- IMAGE: Screenshot showing available integration types -->
<!-- FILE: integration-types.png -->
<!-- CAPTION: Available integration types -->

3. **Enter Connection Details**
   - Host, port, database name
   - Username and password
   - Additional parameters

**PostgreSQL Example:**
```
Host: db.example.com
Port: 5432
Database: analytics
Username: analyst
Password: ••••••••
SSL Mode: require
```

<!-- IMAGE: Screenshot of PostgreSQL connection form -->
<!-- FILE: postgres-connection-form.png -->
<!-- CAPTION: PostgreSQL connection configuration -->

4. **Test Connection**
   - Click "Test connection"
   - Verify success message
   - Save integration

<!-- IMAGE: Screenshot showing successful connection test -->
<!-- FILE: connection-test-success.png -->
<!-- CAPTION: Successful database connection test -->

5. **Name Your Integration**
   - Give it a descriptive name
   - This name will be used in SQL blocks

#### Adding Cloud Storage Integrations

**AWS S3:**

1. Click "Add integration" → "AWS S3"
2. Enter credentials:
   ```
   Access Key ID: AKIAIOSFODNN7EXAMPLE
   Secret Access Key: ••••••••
   Region: us-east-1
   Bucket: my-data-bucket
   ```
3. Test and save

<!-- IMAGE: Screenshot of S3 integration setup -->
<!-- FILE: s3-integration-setup.png -->
<!-- CAPTION: AWS S3 integration configuration -->

**Google Cloud Storage:**

1. Click "Add integration" → "Google Cloud Storage"
2. Upload service account JSON
3. Specify bucket name
4. Test and save

### Set Environment Variables

1. **Open Environment Variables**
   - Go to Settings → Environment variables
   - Click "Add variable"

<!-- IMAGE: Screenshot of environment variables panel -->
<!-- FILE: environment-variables-panel.png -->
<!-- CAPTION: Environment variables configuration -->

2. **Add Variables**
   ```
   Name: API_KEY
   Value: sk-1234567890abcdef
   Type: Secret (hidden in logs)
   ```

3. **Use in Notebooks**
   ```python
   import os
   api_key = os.getenv('API_KEY')
   ```

<!-- IMAGE: Screenshot showing how to add environment variable -->
<!-- FILE: add-environment-variable.png -->
<!-- CAPTION: Adding a new environment variable -->

### Upload Data Files

1. **Open Files Panel**
   - Click "Files" in the left sidebar
   - Navigate to `/work` directory

<!-- IMAGE: Screenshot of Files panel showing directory structure -->
<!-- FILE: files-panel.png -->
<!-- CAPTION: Files panel and directory structure -->

2. **Upload Files**
   - Click "Upload" button
   - Select files from your computer
   - Or drag and drop

3. **Organize Files**
   - Create folders: `data/`, `models/`, `outputs/`
   - Move files to appropriate locations

<!-- IMAGE: Screenshot showing file upload in progress -->
<!-- FILE: file-upload-progress.png -->
<!-- CAPTION: Uploading data files -->

4. **Large Files**
   - For files > 100 MB, use cloud storage integration
   - Or use `wget`/`curl` in a code block

```python
# Download large file
!wget https://example.com/large-dataset.csv -O /work/data/dataset.csv
```

## Step 4: Test Your Migration

### Run All Blocks

1. **Execute Notebooks**
   - Open each notebook
   - Click "Run all" or use Cmd/Ctrl + Shift + Enter

<!-- IMAGE: Screenshot showing "Run all" button location -->
<!-- FILE: run-all-button.png -->
<!-- CAPTION: Running all blocks in a notebook -->

2. **Check for Errors**
   - Review execution results
   - Fix any import errors
   - Update file paths if needed

3. **Verify Outputs**
   - Compare outputs with local execution
   - Check DataFrame displays
   - Verify plots and visualizations

<!-- IMAGE: Screenshot showing successful block execution with outputs -->
<!-- FILE: successful-execution.png -->
<!-- CAPTION: Successful block execution with outputs -->

### Test SQL Blocks

1. **Update Integration IDs**
   - Open SQL blocks
   - Select the correct integration from dropdown

<!-- IMAGE: Screenshot of SQL block with integration selector -->
<!-- FILE: sql-integration-selector.png -->
<!-- CAPTION: Selecting database integration in SQL block -->

2. **Run Queries**
   - Execute SQL blocks
   - Verify results
   - Check variable assignments

3. **Test Different Integrations**
   - Run queries against each database
   - Verify connection stability

### Test Input Blocks

1. **Verify Input Values**
   - Check that input blocks display correctly
   - Test changing values
   - Verify variable updates

<!-- IMAGE: Screenshot showing various input block types -->
<!-- FILE: input-blocks-display.png -->
<!-- CAPTION: Input blocks in Deepnote Cloud -->

2. **Test Interactivity**
   - Change input values
   - Re-run dependent blocks
   - Verify cascading updates

### Verify File Access

1. **Test File Reads**
   ```python
   # Verify file exists
   import os
   print(os.path.exists('/work/data/sales.csv'))
   
   # Read file
   df = pd.read_csv('/work/data/sales.csv')
   print(df.shape)
   ```

2. **Test File Writes**
   ```python
   # Write test file
   df.to_csv('/work/outputs/results.csv', index=False)
   ```

## Step 5: Optimize for Cloud

### Enable Collaboration Features

1. **Invite Team Members**
   - Click "Share" button
   - Enter email addresses
   - Set permissions (View, Edit, Admin)

<!-- IMAGE: Screenshot of share dialog with permission options -->
<!-- FILE: share-dialog.png -->
<!-- CAPTION: Sharing project with team members -->

2. **Add Comments**
   - Select code or text
   - Click comment icon
   - Start discussions

<!-- IMAGE: Screenshot showing comment feature in action -->
<!-- FILE: comments-feature.png -->
<!-- CAPTION: Adding comments to notebook blocks -->

### Set Up Scheduled Runs

1. **Open Schedule Settings**
   - Click "Schedule" in toolbar
   - Or go to Settings → Schedules

<!-- IMAGE: Screenshot of schedule settings panel -->
<!-- FILE: schedule-settings.png -->
<!-- CAPTION: Configuring scheduled notebook runs -->

2. **Create Schedule**
   - Choose frequency (hourly, daily, weekly)
   - Set time and timezone
   - Select notebooks to run

3. **Configure Notifications**
   - Email on success/failure
   - Slack notifications
   - Webhook integrations

<!-- IMAGE: Screenshot showing schedule configuration options -->
<!-- FILE: schedule-configuration.png -->
<!-- CAPTION: Setting up a daily scheduled run -->

### Optimize Performance

1. **Use Appropriate Hardware**
   - Go to Settings → Hardware
   - Select machine type
   - Choose CPU/GPU based on workload

<!-- IMAGE: Screenshot of hardware selection options -->
<!-- FILE: hardware-selection.png -->
<!-- CAPTION: Selecting compute resources -->

2. **Enable Caching**
   - SQL query caching (automatic)
   - DataFrame caching
   - Custom caching strategies

3. **Optimize SQL Queries**
   - Use query preview for large results
   - Enable result caching
   - Set appropriate cache duration

```yaml
# In SQL block metadata
metadata:
  deepnote_return_variable_type: query_preview
  sql_cache_max_age: 3600  # 1 hour
```

### Create Dashboards and Apps

1. **Convert to App**
   - Click "Publish" → "Create app"
   - Select blocks to include
   - Configure layout

<!-- IMAGE: Screenshot of app creation interface -->
<!-- FILE: app-creation.png -->
<!-- CAPTION: Creating an interactive app from notebook -->

2. **Customize App**
   - Arrange input blocks
   - Hide code blocks
   - Add branding

3. **Share App**
   - Generate public link
   - Embed in website
   - Share with stakeholders

<!-- IMAGE: Screenshot of published app with interactive inputs -->
<!-- FILE: published-app.png -->
<!-- CAPTION: Published interactive app -->

## Common Migration Issues

### Issue 1: Import Errors

**Problem:** Packages not found after migration

**Solution:**
1. Add missing packages to environment
2. Check package names (PyPI vs local names)
3. Verify version compatibility

```python
# Check installed packages
!pip list | grep pandas
```

### Issue 2: File Not Found

**Problem:** `FileNotFoundError` when reading files

**Solution:**
1. Upload files to `/work` directory
2. Update file paths in code
3. Use absolute paths: `/work/data/file.csv`

```python
# Before
df = pd.read_csv('data/sales.csv')

# After
df = pd.read_csv('/work/data/sales.csv')
```

### Issue 3: Database Connection Failed

**Problem:** SQL blocks fail to connect

**Solution:**
1. Verify integration credentials
2. Check network access (firewall rules)
3. Test connection in integration settings
4. Update SQL block to use correct integration

<!-- IMAGE: Screenshot showing connection error and how to debug -->
<!-- FILE: connection-error-debug.png -->
<!-- CAPTION: Debugging database connection issues -->

### Issue 4: Environment Variables Not Working

**Problem:** `os.getenv()` returns `None`

**Solution:**
1. Add variables in Settings → Environment variables
2. Restart kernel after adding variables
3. Check variable names (case-sensitive)

```python
# Debug environment variables
import os
print(os.environ.keys())
```

### Issue 5: Slow Execution

**Problem:** Notebooks run slower than local

**Solution:**
1. Upgrade hardware tier
2. Enable caching for SQL queries
3. Optimize data loading
4. Use query preview for large datasets

### Issue 6: Git Sync Issues

**Problem:** Changes not syncing with Git

**Solution:**
1. Check Git integration settings
2. Verify branch permissions
3. Manually push/pull if needed
4. Resolve merge conflicts

<!-- IMAGE: Screenshot of Git sync status and controls -->
<!-- FILE: git-sync-controls.png -->
<!-- CAPTION: Git synchronization controls -->

## Best Practices

### Organization

**Project Structure:**
```
My Project/
├── 01_data_loading.ipynb
├── 02_data_processing.ipynb
├── 03_analysis.ipynb
├── 04_visualization.ipynb
└── utils.ipynb (module)
```

**File Organization:**
```
/work/
├── data/
│   ├── raw/
│   ├── processed/
│   └── external/
├── models/
├── outputs/
└── scripts/
```

### Documentation

Add documentation blocks:

```markdown
# Project: Sales Analysis Q4 2024

## Overview
This project analyzes sales trends for Q4 2024.

## Data Sources
- PostgreSQL: Production database
- S3: Historical data archive

## Dependencies
- pandas>=2.0.0
- scikit-learn>=1.3.0

## Usage
1. Run data loading notebook
2. Run analysis notebook
3. Review outputs in visualization notebook
```

### Version Control

**Use Git Integration:**
- Commit regularly
- Use descriptive commit messages
- Create branches for experiments
- Tag releases

**Version History:**
- Deepnote automatically saves versions
- Access via "History" panel
- Restore previous versions if needed

<!-- IMAGE: Screenshot of version history panel -->
<!-- FILE: version-history.png -->
<!-- CAPTION: Accessing notebook version history -->

### Security

**Protect Sensitive Data:**
- Use environment variables for secrets
- Mark variables as "Secret"
- Don't commit credentials to Git
- Use integration authentication

**Access Control:**
- Set appropriate permissions
- Use team workspaces
- Review access regularly
- Audit sharing settings

### Performance

**Optimize Execution:**
- Cache expensive computations
- Use SQL for data filtering
- Limit DataFrame sizes
- Enable query preview

**Resource Management:**
- Choose appropriate hardware
- Monitor usage
- Upgrade when needed
- Use scheduled runs for heavy workloads

## Advanced Features

### Real-time Collaboration

**Collaborative Editing:**
- Multiple users can edit simultaneously
- See cursors and selections
- Changes sync in real-time

<!-- IMAGE: Screenshot showing multiple user cursors -->
<!-- FILE: realtime-collaboration.png -->
<!-- CAPTION: Multiple users editing simultaneously -->

**Comments and Discussions:**
- Add comments to blocks
- Tag team members
- Resolve discussions
- Track feedback

### Notebook Scheduling

**Automated Execution:**
- Schedule daily/weekly runs
- Email results
- Chain multiple notebooks
- Conditional execution

**Monitoring:**
- View execution history
- Check success/failure rates
- Debug failed runs
- Set up alerts

<!-- IMAGE: Screenshot of execution history log -->
<!-- FILE: execution-history.png -->
<!-- CAPTION: Scheduled execution history -->

### Publishing and Sharing

**Public Projects:**
- Make projects public
- Generate shareable links
- Embed notebooks in websites
- Create portfolio

**Interactive Apps:**
- Convert notebooks to apps
- Hide code, show results
- Custom branding
- Embed anywhere

### API Access

**Deepnote API:**
- Programmatic access
- Trigger notebook runs
- Fetch results
- Automate workflows

```python
# Example: Trigger notebook via API
import requests

response = requests.post(
    'https://api.deepnote.com/v1/projects/{project_id}/run',
    headers={'Authorization': f'Bearer {api_token}'},
    json={'notebook_id': 'notebook-001'}
)
```

## Migration Checklist

Use this checklist to track your migration:

### Pre-Migration
- [ ] Review local notebooks
- [ ] List all dependencies
- [ ] Identify data files
- [ ] Document database connections
- [ ] Clean up local paths
- [ ] Create migration plan

### Upload
- [ ] Create Deepnote Cloud account
- [ ] Upload .deepnote file
- [ ] Verify all notebooks imported
- [ ] Check block count

### Configuration
- [ ] Set Python version
- [ ] Install dependencies
- [ ] Add database integrations
- [ ] Configure environment variables
- [ ] Upload data files
- [ ] Set up cloud storage

### Testing
- [ ] Run all notebooks
- [ ] Test SQL blocks
- [ ] Verify input blocks
- [ ] Check file access
- [ ] Compare outputs with local
- [ ] Fix any errors

### Optimization
- [ ] Invite team members
- [ ] Set up schedules
- [ ] Configure notifications
- [ ] Optimize performance
- [ ] Create apps/dashboards
- [ ] Document project

### Post-Migration
- [ ] Train team on cloud features
- [ ] Set up monitoring
- [ ] Configure backups
- [ ] Review security settings
- [ ] Archive local environment

## Getting Help

### Resources

- **Documentation:** [docs.deepnote.com](https://docs.deepnote.com)
- **Community:** [community.deepnote.com](https://community.deepnote.com)
- **Support:** support@deepnote.com
- **Status:** [status.deepnote.com](https://status.deepnote.com)

### Common Questions

**Q: Can I keep using my local environment?**
A: Yes! You can work locally and sync with cloud via Git.

**Q: What happens to my local files?**
A: They remain on your computer. Cloud is a separate copy.

**Q: Can I migrate back to local?**
A: Yes, export your `.deepnote` file anytime.

**Q: Are there usage limits?**
A: Free tier has limits. Check pricing for details.

**Q: Is my data secure?**
A: Yes. Data is encrypted at rest and in transit.

## Next Steps

After successful migration:

1. **Explore Cloud Features**
   - Try real-time collaboration
   - Set up scheduled runs
   - Create interactive apps

2. **Optimize Workflows**
   - Use integrations for data access
   - Leverage cloud compute
   - Automate repetitive tasks

3. **Share and Collaborate**
   - Invite team members
   - Create shared workspaces
   - Publish findings

4. **Learn Advanced Features**
   - API access
   - Custom environments
   - Advanced scheduling

## Related Documentation

- [Deepnote Format](./deepnote-format.md) - File format specification
- [Reading .deepnote Files](./reading-deepnote-files.md) - Understanding the format
- [Supported Code Blocks](./supported-code-blocks.md) - Block types reference
- [VS Code Supported Blocks](./vscode-supported-blocks.md) - Local development
- [Converting Notebooks](./converting-notebooks.md) - Format conversion

## Conclusion

Migrating to Deepnote Cloud unlocks powerful collaboration and infrastructure features while maintaining compatibility with your local development workflow. Follow this guide step-by-step, and you'll have your notebooks running in the cloud in no time.

**Happy collaborating! 🚀**
