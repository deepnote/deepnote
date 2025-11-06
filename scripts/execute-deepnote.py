#!/usr/bin/env python3
"""
Execute all code blocks in a .deepnote file using a running Jupyter kernel.

This script connects to an active Jupyter kernel and executes all code blocks
from a .deepnote file in sequence, displaying outputs as they arrive.

Usage:
    python scripts/execute-deepnote.py <filepath> [kernel_id]
    
If kernel_id is not provided, it will attempt to auto-detect the running kernel.

Examples:
    # Auto-detect kernel
    python scripts/execute-deepnote.py examples/1_hello_world.deepnote
    
    # Specify kernel explicitly
    python scripts/execute-deepnote.py examples/1_hello_world.deepnote fdab3b56-52c0-4070-9936-e459aff26be9
"""

import sys
import yaml
import json
import glob
import os
import re
from pathlib import Path
from jupyter_client import BlockingKernelClient
from urllib.parse import quote_plus

# Mapping of import names to package names
IMPORT_TO_PACKAGE = {
    'sklearn': 'scikit-learn',
    'cv2': 'opencv-python',
    'PIL': 'Pillow',
    'yaml': 'pyyaml',
    'sqlalchemy': 'sqlalchemy',
    'clickhouse_sqlalchemy': 'clickhouse-sqlalchemy',
    'duckdb': 'duckdb',
}

def find_active_kernel():
    """Find the most recently active Jupyter kernel."""
    runtime_dir = Path.home() / 'Library' / 'Jupyter' / 'runtime'
    kernel_files = list(runtime_dir.glob('kernel-*.json'))
    
    if not kernel_files:
        return None
    
    # Get the most recent kernel file
    latest_kernel = max(kernel_files, key=lambda p: p.stat().st_mtime)
    kernel_id = latest_kernel.stem.replace('kernel-', '')
    
    return kernel_id

def build_sqlalchemy_url(integration):
    """Build SQLAlchemy connection URL for a database integration.
    
    Based on the Deepnote database integration config:
    https://github.com/deepnote/deepnote/blob/main/packages/database-integrations/src/database-integration-env-vars.ts
    """
    integration_type = integration.get('type')
    metadata = integration.get('metadata', {})
    integration_name = integration.get('name', '').lower()
    
    if integration_type == 'clickhouse':
        # ClickHouse playground credentials or user-provided metadata
        # If no metadata, use ClickHouse playground defaults for "playground" integrations
        is_playground = 'playground' in integration_name
        
        host = metadata.get('host', 'play.clickhouse.com' if is_playground else None)
        port = metadata.get('port', '443' if is_playground else None)
        user = metadata.get('user', 'play' if is_playground else None)
        password = metadata.get('password', '')
        database = metadata.get('database', 'default' if is_playground else None)
        ssl_enabled = metadata.get('sslEnabled', True)
        
        # Validate required fields
        if not all([host, user, database]):
            return None
        
        # URL encode credentials
        user_encoded = quote_plus(user)
        password_encoded = quote_plus(password) if password else ''
        credentials = f"{user_encoded}:{password_encoded}" if password else user_encoded
        port_suffix = f":{port}" if port else ''
        
        # Build connection URL with SSL params
        protocol = 'https' if ssl_enabled else 'http'
        secure = 'true' if ssl_enabled else 'false'
        url = f"clickhouse://{credentials}@{host}{port_suffix}/{database}?protocol={protocol}&secure={secure}"
        
        return url
    
    elif integration_type == 'pgsql':
        # PostgreSQL
        host = metadata.get('host')
        port = metadata.get('port', '5432')
        user = metadata.get('user')
        password = metadata.get('password', '')
        database = metadata.get('database')
        
        user_encoded = quote_plus(user)
        password_encoded = quote_plus(password)
        port_suffix = f":{port}" if port else ''
        
        url = f"postgresql://{user_encoded}:{password_encoded}@{host}{port_suffix}/{database}"
        return url
    
    elif integration_type == 'mysql' or integration_type == 'mariadb':
        # MySQL/MariaDB
        host = metadata.get('host')
        port = metadata.get('port', '3306')
        user = metadata.get('user')
        password = metadata.get('password', '')
        database = metadata.get('database')
        
        user_encoded = quote_plus(user)
        password_encoded = quote_plus(password)
        port_suffix = f":{port}" if port else ''
        
        url = f"mysql+pymysql://{user_encoded}:{password_encoded}@{host}{port_suffix}/{database}"
        return url
    
    else:
        # Unsupported integration type
        return None

def extract_imports_from_code(code_blocks):
    """Extract all import statements from code blocks."""
    imports = set()
    
    for block in code_blocks:
        content = block['content']
        
        # Find 'import X' statements
        for match in re.finditer(r'^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)', content, re.MULTILINE):
            package = match.group(1)
            imports.add(package)
        
        # Find 'from X import Y' statements
        for match in re.finditer(r'^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)', content, re.MULTILINE):
            package = match.group(1)
            imports.add(package)
    
    return imports

def generate_requirements_txt(code_blocks, target_dir='.'):
    """Auto-generate requirements.txt from imports in code blocks."""
    imports = extract_imports_from_code(code_blocks)
    
    # Map to package names and filter out stdlib
    stdlib_modules = {
        'os', 'sys', 'json', 'datetime', 'pathlib', 'collections', 
        'itertools', 'functools', 're', 'math', 'random', 'time',
        'io', 'csv', 'typing', 'abc', 'dataclasses', 'enum',
    }
    
    packages = set()
    for imp in imports:
        # Skip stdlib modules
        if imp in stdlib_modules:
            continue
        
        # Map to actual package name
        package_name = IMPORT_TO_PACKAGE.get(imp, imp)
        packages.add(package_name)
    
    if not packages:
        return False
    
    # Generate requirements.txt
    requirements_file = Path(target_dir) / 'requirements.txt'
    
    # Don't overwrite if it exists
    if requirements_file.exists():
        return False
    
    with open(requirements_file, 'w') as f:
        f.write("# Auto-generated from .deepnote file imports\n")
        for package in sorted(packages):
            # Add version constraints for common packages
            if package == 'numpy':
                f.write("numpy>=1.24.0\n")
            elif package == 'pandas':
                f.write("pandas>=2.0.0\n")
            elif package == 'scikit-learn':
                f.write("scikit-learn>=1.3.0\n")
            elif package == 'matplotlib':
                f.write("matplotlib>=3.7.0\n")
            elif package == 'seaborn':
                f.write("seaborn>=0.12.0\n")
            else:
                f.write(f"{package}\n")
    
    return True

def execute_deepnote_file(filepath: str, kernel_id: str = None):
    """Execute all code blocks from a .deepnote file in the specified kernel."""
    
    # Auto-detect kernel if not provided
    if kernel_id is None:
        kernel_id = find_active_kernel()
        if kernel_id is None:
            print("Error: No active Jupyter kernel found.")
            print("Please open a .deepnote file in VS Code/Cursor first.")
            sys.exit(1)
        print(f"Auto-detected kernel: {kernel_id}")
    
    # Read the .deepnote file
    try:
        with open(filepath, 'r') as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"Error: File not found: {filepath}")
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"Error: Invalid YAML in {filepath}: {e}")
        sys.exit(1)
    
    # Check if there's an init notebook
    project = data.get('project', {})
    init_notebook_id = project.get('initNotebookId')
    notebooks = project.get('notebooks', [])
    integrations = project.get('integrations', [])
    
    # Build integration lookup map
    integration_map = {integration['id']: integration for integration in integrations}
    
    # Separate init notebook from other notebooks
    init_notebook = None
    other_notebooks = []
    
    for notebook in notebooks:
        if notebook.get('id') == init_notebook_id:
            init_notebook = notebook
        else:
            other_notebooks.append(notebook)
    
    # Process notebooks in order: init first, then others
    notebooks_to_process = []
    if init_notebook:
        notebooks_to_process.append(('Init', init_notebook))
    for notebook in other_notebooks:
        notebook_name = notebook.get('name', 'Unnamed')
        notebooks_to_process.append((notebook_name, notebook))
    
    # Extract input widgets, code blocks, SQL blocks, and chart blocks from all notebooks
    input_widgets = []
    code_blocks = []
    sql_blocks = []
    chart_blocks = []
    
    for notebook_name, notebook in notebooks_to_process:
        for block in notebook.get('blocks', []):
            block_type = block.get('type', '')
            
            # Collect input widgets
            if block_type.startswith('input-'):
                metadata = block.get('metadata', {})
                var_name = metadata.get('deepnote_variable_name')
                var_value = metadata.get('deepnote_variable_value')
                
                if var_name and var_value is not None:
                    input_widgets.append({
                        'type': block_type,
                        'name': var_name,
                        'value': var_value,
                        'metadata': metadata,
                        'sortingKey': block.get('sortingKey', ''),
                        'notebook': notebook_name,
                    })
            
            # Collect code blocks
            elif block_type == 'code' and block.get('content'):
                code_blocks.append({
                    'id': block.get('id'),
                    'content': block.get('content'),
                    'sortingKey': block.get('sortingKey', ''),
                    'notebook': notebook_name,
                })
            
            # Collect SQL blocks
            elif block_type == 'sql':
                content = block.get('content', '').strip()
                if not content:
                    # Skip SQL blocks without content (malformed or placeholder blocks)
                    continue
                    
                metadata = block.get('metadata', {})
                integration_id = metadata.get('sql_integration_id')
                var_name = metadata.get('deepnote_variable_name', 'df')
                
                if integration_id:
                    sql_blocks.append({
                        'id': block.get('id'),
                        'content': content,
                        'integration_id': integration_id,
                        'var_name': var_name,
                        'sortingKey': block.get('sortingKey', ''),
                        'notebook': notebook_name,
                    })
            
            # Collect chart/visualization blocks
            elif block_type == 'visualization':
                metadata = block.get('metadata', {})
                var_name = metadata.get('deepnote_variable_name')
                spec = metadata.get('deepnote_visualization_spec')
                filters = metadata.get('deepnote_chart_filter', {}).get('advancedFilters', [])
                
                if var_name and spec:
                    chart_blocks.append({
                        'id': block.get('id'),
                        'var_name': var_name,
                        'spec': spec,
                        'filters': filters,
                        'sortingKey': block.get('sortingKey', ''),
                        'notebook': notebook_name,
                    })
    
    if not code_blocks and not sql_blocks and not chart_blocks:
        print(f"No code, SQL, or chart blocks found in {filepath}")
        sys.exit(0)
    
    # Auto-generate requirements.txt if needed (in the same dir as the .deepnote file)
    deepnote_dir = Path(filepath).parent.resolve()
    requirements_generated = generate_requirements_txt(code_blocks, target_dir=deepnote_dir)
    
    # Add SQL dependencies if we have SQL blocks
    if sql_blocks:
        requirements_file = Path(deepnote_dir) / 'requirements.txt'
        existing_content = ""
        if requirements_file.exists():
            with open(requirements_file, 'r') as f:
                existing_content = f.read()
        
        # Add sqlalchemy and pandas if not present
        sql_deps = []
        if 'sqlalchemy' not in existing_content.lower():
            sql_deps.append('sqlalchemy>=2.0.0')
        if 'pandas' not in existing_content.lower():
            sql_deps.append('pandas>=2.0.0')
        
        # Check which SQL connectors we need
        for sql_block in sql_blocks:
            # Handle special Deepnote dataframe SQL integration
            if sql_block['integration_id'] == 'deepnote-dataframe-sql':
                if 'duckdb' not in existing_content.lower():
                    sql_deps.append('duckdb>=0.9.0')
                continue
            
            integration = integration_map.get(sql_block['integration_id'])
            if integration:
                integration_type = integration.get('type')
                if integration_type == 'clickhouse' and 'clickhouse-sqlalchemy' not in existing_content.lower():
                    sql_deps.append('clickhouse-sqlalchemy>=0.2.0')
                elif integration_type in ['mysql', 'mariadb'] and 'pymysql' not in existing_content.lower():
                    sql_deps.append('pymysql>=1.0.0')
                elif integration_type == 'pgsql' and 'psycopg2' not in existing_content.lower():
                    sql_deps.append('psycopg2-binary>=2.9.0')
        
        if sql_deps:
            with open(requirements_file, 'a') as f:
                if existing_content and not existing_content.endswith('\n'):
                    f.write('\n')
                for dep in sql_deps:
                    f.write(f"{dep}\n")
            requirements_generated = True
    
    print(f"\nFound {len(notebooks_to_process)} notebook(s):")
    for notebook_name, _ in notebooks_to_process:
        if notebook_name == 'Init':
            print(f"  - {notebook_name} (will run first)")
        else:
            print(f"  - {notebook_name}")
    
    if requirements_generated:
        print(f"\n✓ Auto-generated requirements.txt from imports")
    
    block_summary = []
    if input_widgets:
        block_summary.append(f"{len(input_widgets)} input widget(s)")
    if code_blocks:
        block_summary.append(f"{len(code_blocks)} code block(s)")
    if sql_blocks:
        block_summary.append(f"{len(sql_blocks)} SQL block(s)")
    if chart_blocks:
        block_summary.append(f"{len(chart_blocks)} chart block(s)")
    
    print(f"\nTotal: {', '.join(block_summary)}")
    print(f"{'='*70}\n")
    
    # Connect to the running kernel
    connection_file = Path.home() / 'Library' / 'Jupyter' / 'runtime' / f'kernel-{kernel_id}.json'
    
    if not connection_file.exists():
        print(f"Error: Kernel connection file not found: {connection_file}")
        print("The kernel may have stopped. Please restart the notebook.")
        sys.exit(1)
    
    client = BlockingKernelClient()
    client.load_connection_file(str(connection_file))
    client.start_channels()
    
    try:
        # Wait for kernel to be ready
        client.wait_for_ready(timeout=10)
        print(f"✓ Connected to kernel {kernel_id}\n")
        
        # Change working directory to where the .deepnote file is located
        # This ensures file operations work relative to the notebook
        client.execute(f"import os; os.chdir({repr(str(deepnote_dir))})", silent=True)
        # Wait for completion
        while True:
            try:
                msg = client.get_iopub_msg(timeout=2)
                if msg['header']['msg_type'] == 'status' and msg['content']['execution_state'] == 'idle':
                    break
            except:
                break
        
        # If we generated requirements.txt, install packages before running blocks
        if requirements_generated:
            print("Installing dependencies from auto-generated requirements.txt...")
            requirements_path = deepnote_dir / 'requirements.txt'
            
            # Install packages using pip
            install_code = f"""
import subprocess
import sys
result = subprocess.run(
    [sys.executable, '-m', 'pip', 'install', '-q', '-r', {repr(str(requirements_path))}],
    capture_output=True,
    text=True
)
if result.returncode == 0:
    print("✓ Dependencies installed successfully!")
else:
    print(f"⚠ Warning: Some dependencies failed to install")
    if result.stderr:
        print(result.stderr)
"""
            client.execute(install_code, silent=False)
            
            # Wait for installation to complete
            while True:
                try:
                    msg = client.get_iopub_msg(timeout=60)  # Longer timeout for installation
                    msg_type = msg['header']['msg_type']
                    content = msg['content']
                    
                    if msg_type == 'stream':
                        # Show installation output
                        for line in content['text'].strip().split('\n'):
                            if line.strip():
                                print(f"  {line}")
                    elif msg_type == 'error':
                        print(f"  ⚠ Installation error: {content['ename']}: {content['evalue']}")
                    elif msg_type == 'status' and content['execution_state'] == 'idle':
                        break
                except Exception as e:
                    print(f"  ⚠ Installation timeout or error: {e}")
                    break
            
            print()  # Empty line after installation
        
        # Initialize input widget variables
        if input_widgets:
            print("Initializing input widgets:")
            for widget in input_widgets:
                var_name = widget['name']
                var_value = widget['value']
                widget_type = widget['type']
                
                # Generate Python code to set the variable based on widget type
                if widget_type == 'input-checkbox':
                    # Boolean value
                    code = f"{var_name} = {str(var_value)}"
                    display_value = str(var_value)
                    
                elif widget_type == 'input-slider':
                    # Numeric value (convert string to number)
                    try:
                        # Check if it's a float or int
                        if '.' in str(var_value):
                            code = f"{var_name} = {float(var_value)}"
                        else:
                            code = f"{var_name} = {int(var_value)}"
                        display_value = str(var_value)
                    except ValueError:
                        code = f"{var_name} = '{var_value}'"
                        display_value = f"'{var_value}'"
                        
                elif widget_type == 'input-date':
                    # Date value - import datetime and create date object
                    code = f"import datetime; {var_name} = '{var_value}'"
                    display_value = f"'{var_value}'"
                    
                elif widget_type == 'input-date-range':
                    # Date range - list of dates
                    if isinstance(var_value, list) and len(var_value) > 0:
                        # Convert to datetime.date objects (convert strings to ints to avoid leading zero issues)
                        try:
                            dates_code = ', '.join([
                                f"datetime.date({int(year)}, {int(month)}, {int(day)})" 
                                for date_str in var_value 
                                for year, month, day in [date_str.split('-')]
                            ])
                            code = f"import datetime; {var_name} = [{dates_code}]"
                            display_value = str(var_value)
                        except (ValueError, AttributeError):
                            # Fallback if date parsing fails
                            code = f"{var_name} = {repr(var_value)}"
                            display_value = repr(var_value)
                    else:
                        code = f"{var_name} = {repr(var_value)}"
                        display_value = repr(var_value)
                        
                else:
                    # Text input (input-text, input-textarea, input-select)
                    # Use repr() to properly escape strings
                    code = f"{var_name} = {repr(var_value)}"
                    display_value = repr(var_value) if len(repr(var_value)) < 50 else repr(var_value)[:47] + "..."
                
                print(f"  {var_name} = {display_value}")
                # DEBUG: Uncomment to see generated code
                # print(f"    Code: {code}")
                
                # Execute the initialization code
                msg_id = client.execute(code, silent=True)
                
                # Wait for completion and check for errors
                had_error = False
                while True:
                    try:
                        msg = client.get_iopub_msg(timeout=5)
                        msg_type = msg['header']['msg_type']
                        
                        if msg_type == 'error':
                            content = msg['content']
                            print(f"    ⚠ Error initializing: {content['ename']}: {content['evalue']}")
                            had_error = True
                        elif msg_type == 'status' and msg['content']['execution_state'] == 'idle':
                            break
                    except Exception as e:
                        break
                
                if had_error:
                    print(f"    Falling back to: {var_name} = {repr(var_value)}")
                    # Try simple assignment as fallback
                    client.execute(f"{var_name} = {repr(var_value)}", silent=True)
            
            print()  # Empty line after initialization
        
        # Execute each code block
        execution_errors = []
        current_notebook = None
        
        for i, block in enumerate(code_blocks, 1):
            # Print notebook header when switching notebooks
            if block['notebook'] != current_notebook:
                current_notebook = block['notebook']
                print(f"{'─'*70}")
                print(f"📓 Notebook: {current_notebook}")
                print(f"{'─'*70}\n")
            
            block_id = block['id'][:8]
            print(f"[{i}/{len(code_blocks)}] Block {block['sortingKey']} ({block_id}):")
            
            # Show code preview
            code_lines = block['content'].strip().split('\n')
            if len(code_lines) == 1:
                print(f"    {code_lines[0][:70]}...")
            else:
                print(f"    {code_lines[0][:70]}...")
                if len(code_lines) > 1:
                    print(f"    ... ({len(code_lines)} lines total)")
            
            # Execute the code
            msg_id = client.execute(block['content'])
            
            # Wait for execution to complete and print outputs
            had_output = False
            had_error = False
            while True:
                try:
                    msg = client.get_iopub_msg(timeout=30)
                    msg_type = msg['header']['msg_type']
                    content = msg['content']
                    
                    if msg_type == 'stream':
                        if not had_output:
                            print("    Output:")
                        had_output = True
                        for line in content['text'].rstrip().split('\n'):
                            print(f"      {line}")
                            
                    elif msg_type == 'execute_result':
                        if not had_output:
                            print("    Result:")
                        had_output = True
                        result = content.get('data', {}).get('text/plain', '')
                        for line in result.strip().split('\n'):
                            print(f"      {line}")
                            
                    elif msg_type == 'display_data':
                        if not had_output:
                            print("    Display:")
                        had_output = True
                        # Handle various display types
                        data = content.get('data', {})
                        if 'text/plain' in data:
                            for line in data['text/plain'].strip().split('\n'):
                                print(f"      {line}")
                        elif 'text/html' in data:
                            print("      [HTML output]")
                        elif 'image/png' in data:
                            print("      [PNG image]")
                            
                    elif msg_type == 'error':
                        had_error = True
                        print(f"    ✗ Error: {content['ename']}: {content['evalue']}")
                        execution_errors.append({
                            'block': i,
                            'error': f"{content['ename']}: {content['evalue']}"
                        })
                        
                    elif msg_type == 'status' and content['execution_state'] == 'idle':
                        break
                        
                except KeyboardInterrupt:
                    print("\n⚠ Execution interrupted by user")
                    client.stop_channels()
                    sys.exit(1)
                except Exception as e:
                    print(f"    ⚠ Communication error: {e}")
                    break
            
            if not had_output and not had_error:
                print("    (no output)")
            
            print()  # Empty line between blocks
        
        # Execute SQL blocks
        if sql_blocks:
            print(f"{'─'*70}")
            print(f"🗄️  Executing SQL blocks")
            print(f"{'─'*70}\n")
            
            for i, sql_block in enumerate(sql_blocks, 1):
                # Handle special Deepnote dataframe SQL integration
                if sql_block['integration_id'] == 'deepnote-dataframe-sql':
                    integration_name = 'Pandas DataFrame (DuckDB)'
                    integration_type = 'pandas-dataframe'
                    integration = {
                        'type': 'pandas-dataframe',
                        'name': integration_name
                    }
                else:
                    # Get integration details
                    integration = integration_map.get(sql_block['integration_id'])
                    if not integration:
                        print(f"[{i}/{len(sql_blocks)}] SQL Block {sql_block['sortingKey']}: ✗ Integration not found")
                        execution_errors.append({
                            'block': f"SQL {i}",
                            'error': f"Integration {sql_block['integration_id']} not found"
                        })
                        continue
                    
                    integration_name = integration.get('name', 'Unnamed')
                    integration_type = integration.get('type', 'unknown')
                
                print(f"[{i}/{len(sql_blocks)}] SQL Block {sql_block['sortingKey']} → {sql_block['var_name']}")
                print(f"    Integration: {integration_name} ({integration_type})")
                
                # Show SQL preview
                sql_lines = sql_block['content'].strip().split('\n')
                if len(sql_lines) == 1:
                    print(f"    SQL: {sql_lines[0][:60]}...")
                else:
                    print(f"    SQL: {sql_lines[0][:60]}...")
                    if len(sql_lines) > 1:
                        print(f"         ... ({len(sql_lines)} lines total)")
                
                # Handle pandas-dataframe queries (DuckDB)
                if integration_type == 'pandas-dataframe':
                    sql_code = f"""
import duckdb

try:
    # DuckDB can query pandas DataFrames directly
    {sql_block['var_name']} = duckdb.query({repr(sql_block['content'])}).df()
    print(f"✓ Retrieved {{len({sql_block['var_name']})}} rows")
    print(f"  Columns: {{', '.join({sql_block['var_name']}.columns.tolist()[:5])}}")
    if len({sql_block['var_name']}.columns) > 5:
        print(f"  ... and {{len({sql_block['var_name']}.columns) - 5}} more")
except Exception as e:
    print(f"✗ SQL execution failed: {{type(e).__name__}}: {{e}}")
    raise
"""
                else:
                    # Build connection URL for external databases
                    connection_url = build_sqlalchemy_url(integration)
                    if not connection_url:
                        print(f"    ✗ Unsupported integration type: {integration_type}")
                        execution_errors.append({
                            'block': f"SQL {i}",
                            'error': f"Unsupported integration type: {integration_type}"
                        })
                        print()
                        continue
                    
                    # Execute SQL query using pandas + SQLAlchemy
                    sql_code = f"""
import pandas as pd
from sqlalchemy import create_engine

try:
    _engine = create_engine({repr(connection_url)})
    {sql_block['var_name']} = pd.read_sql({repr(sql_block['content'])}, _engine)
    print(f"✓ Retrieved {{len({sql_block['var_name']})}} rows")
    print(f"  Columns: {{', '.join({sql_block['var_name']}.columns.tolist()[:5])}}")
    if len({sql_block['var_name']}.columns) > 5:
        print(f"  ... and {{len({sql_block['var_name']}.columns) - 5}} more")
except Exception as e:
    print(f"✗ SQL execution failed: {{type(e).__name__}}: {{e}}")
    raise
"""
                
                # Execute the SQL code
                msg_id = client.execute(sql_code, silent=False)
                
                # Wait for execution and capture output
                had_output = False
                had_error = False
                while True:
                    try:
                        msg = client.get_iopub_msg(timeout=60)  # Longer timeout for SQL queries
                        msg_type = msg['header']['msg_type']
                        content = msg['content']
                        
                        if msg_type == 'stream':
                            if not had_output:
                                print("    Output:")
                            had_output = True
                            for line in content['text'].rstrip().split('\n'):
                                print(f"      {line}")
                        
                        elif msg_type == 'error':
                            had_error = True
                            print(f"    ✗ Error: {content['ename']}: {content['evalue']}")
                            execution_errors.append({
                                'block': f"SQL {i}",
                                'error': f"{content['ename']}: {content['evalue']}"
                            })
                        
                        elif msg_type == 'status' and content['execution_state'] == 'idle':
                            break
                    
                    except KeyboardInterrupt:
                        print("\n⚠ Execution interrupted by user")
                        client.stop_channels()
                        sys.exit(1)
                    except Exception as e:
                        print(f"    ⚠ Communication error: {e}")
                        break
                
                if not had_output and not had_error:
                    print("    (no output)")
                
                print()  # Empty line between blocks
        
        # Execute chart/visualization blocks
        if chart_blocks:
            print(f"{'─'*70}")
            print(f"📊 Executing chart blocks")
            print(f"{'─'*70}\n")
            
            for i, chart_block in enumerate(chart_blocks, 1):
                print(f"[{i}/{len(chart_blocks)}] Chart Block {chart_block['sortingKey']}")
                print(f"    Source: {chart_block['var_name']}")
                
                # Get chart type from spec if available
                chart_type = chart_block['spec'].get('mark', 'unknown') if isinstance(chart_block['spec'], dict) else 'unknown'
                print(f"    Type: {chart_type}")
                
                # Execute chart using Deepnote toolkit
                chart_code = f"""
import deepnote_toolkit
import json

try:
    _chart = deepnote_toolkit.DeepnoteChart(
        {chart_block['var_name']}, 
        {repr(json.dumps(chart_block['spec']))}, 
        filters={repr(json.dumps(chart_block['filters']))}
    )
    # Display the chart
    display(_chart)
    print(f"✓ Chart created from {{len({chart_block['var_name']})}} rows")
except Exception as e:
    print(f"✗ Chart execution failed: {{type(e).__name__}}: {{e}}")
    raise
"""
                
                # Execute the chart code
                msg_id = client.execute(chart_code, silent=False)
                
                # Wait for execution and capture output
                had_output = False
                had_error = False
                while True:
                    try:
                        msg = client.get_iopub_msg(timeout=30)
                        msg_type = msg['header']['msg_type']
                        content = msg['content']
                        
                        if msg_type == 'stream':
                            if not had_output:
                                print("    Output:")
                            had_output = True
                            for line in content['text'].rstrip().split('\n'):
                                print(f"      {line}")
                        
                        elif msg_type == 'display_data' or msg_type == 'execute_result':
                            if not had_output:
                                print("    Output:")
                            had_output = True
                            # Chart was displayed
                            print(f"      Chart rendered (interactive visualization)")
                        
                        elif msg_type == 'error':
                            had_error = True
                            print(f"    ✗ Error: {content['ename']}: {content['evalue']}")
                            execution_errors.append({
                                'block': f"Chart {i}",
                                'error': f"{content['ename']}: {content['evalue']}"
                            })
                        
                        elif msg_type == 'status' and content['execution_state'] == 'idle':
                            break
                    
                    except KeyboardInterrupt:
                        print("\n⚠ Execution interrupted by user")
                        client.stop_channels()
                        sys.exit(1)
                    except Exception as e:
                        print(f"    ⚠ Communication error: {e}")
                        break
                
                if not had_output and not had_error:
                    print("    (no output)")
                
                print()  # Empty line between blocks
        
        # Summary
        print(f"{'='*70}")
        total_blocks = len(code_blocks) + len(sql_blocks) + len(chart_blocks)
        if execution_errors:
            print(f"⚠ Completed with {len(execution_errors)} error(s):")
            for err in execution_errors:
                print(f"  Block {err['block']}: {err['error']}")
        else:
            block_types = []
            if code_blocks:
                block_types.append(f"{len(code_blocks)} code")
            if sql_blocks:
                block_types.append(f"{len(sql_blocks)} SQL")
            if chart_blocks:
                block_types.append(f"{len(chart_blocks)} chart")
            print(f"✅ Successfully executed all {' + '.join(block_types)} blocks!")
        
    except KeyboardInterrupt:
        print("\n⚠ Execution interrupted")
        sys.exit(1)
    finally:
        client.stop_channels()

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    filepath = sys.argv[1]
    kernel_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    execute_deepnote_file(filepath, kernel_id)

if __name__ == "__main__":
    main()

