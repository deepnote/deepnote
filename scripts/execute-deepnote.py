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
from pathlib import Path
from jupyter_client import BlockingKernelClient

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
    
    # Extract code blocks
    code_blocks = []
    for notebook in data.get('project', {}).get('notebooks', []):
        for block in notebook.get('blocks', []):
            if block.get('type') == 'code' and block.get('content'):
                code_blocks.append({
                    'id': block.get('id'),
                    'content': block.get('content'),
                    'sortingKey': block.get('sortingKey', ''),
                })
    
    if not code_blocks:
        print(f"No code blocks found in {filepath}")
        sys.exit(0)
    
    print(f"\nFound {len(code_blocks)} code blocks to execute")
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
        
        # Execute each code block
        execution_errors = []
        for i, block in enumerate(code_blocks, 1):
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
        
        # Summary
        print(f"{'='*70}")
        if execution_errors:
            print(f"⚠ Completed with {len(execution_errors)} error(s):")
            for err in execution_errors:
                print(f"  Block {err['block']}: {err['error']}")
        else:
            print(f"✅ Successfully executed all {len(code_blocks)} code blocks!")
        
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

