#!/usr/bin/env python3
"""
Test script to verify the local AST analyzer works correctly.
This uses test cases from the original ast-analyzer repository.
"""

import json
import tempfile
import subprocess
import sys
import os

def test_ast_analyzer():
    """Test the local AST analyzer with sample data"""

    test_blocks = [
        {
            "type": "code",
            "id": "1",
            "content": "a = 42"
        },
        {
            "type": "code",
            "id": "2",
            "content": "b = 1 + a"
        },
        {
            "type": "sql",
            "id": "3",
            "content": "SELECT * FROM users WHERE id == {{someVariable}}"
        }
    ]

    expected_result = [
        {
            "id": "1",
            "definedVariables": ["a"],
            "usedVariables": [],
            "importedModules": []
        },
        {
            "id": "2",
            "definedVariables": ["b"],
            "usedVariables": ["a"],
            "importedModules": []
        },
        {
            "id": "3",
            "definedVariables": [],
            "usedVariables": ["someVariable", "users"],
            "importedModules": []
        }
    ]

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as input_file:
        json.dump({"blocks": test_blocks}, input_file)
        input_path = input_file.name

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as output_file:
        output_path = output_file.name

    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        script_path = os.path.join(script_dir, 'ast-analyzer.py')

        result = subprocess.run([
            'python3', script_path,
            '--input', input_path,
            '--output', output_path
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Script failed with return code {result.returncode}")
            print(f"stderr: {result.stderr}")
            return False

        with open(output_path, 'r') as f:
            actual_result = json.load(f)

        if actual_result == expected_result:
            print("✅ Test passed! AST analyzer works correctly.")
            return True
        else:
            print("❌ Test failed! Results don't match expected output.")
            print(f"Expected: {json.dumps(expected_result, indent=2)}")
            print(f"Actual: {json.dumps(actual_result, indent=2)}")
            return False

    finally:
        os.unlink(input_path)
        os.unlink(output_path)

if __name__ == "__main__":
    success = test_ast_analyzer()
    sys.exit(0 if success else 1)
