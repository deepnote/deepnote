"""
AST Analyzer for Python code blocks.
Extracts variable definitions and usages for dependency graph construction.
This version is designed to run in Pyodide (browser) without file I/O.
"""

import ast
import json
import re


class VariableVisitor(ast.NodeVisitor):
    def __init__(self):
        self.global_vars = set()  # Variables defined globally
        self.used_global_vars = set()  # Variables used and defined globally
        self.imported_modules = set()  # Imported modules
        self.scope_stack = []  # Stack to track scopes
        self.function_globals = set()  # Global variables declared in current function

    def current_scope_is_global(self):
        # If the scope stack is empty, we are at the global level
        return not self.scope_stack

    def visit_Global(self, node):
        for name in node.names:
            self.function_globals.add(name)
        self.generic_visit(node)

    def visit_Assign(self, node):
        for target in node.targets:
            if isinstance(target, ast.Name):
                if self.current_scope_is_global():
                    self.global_vars.add(target.id)
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        if isinstance(node.target, ast.Name):
            if self.current_scope_is_global():
                self.global_vars.add(node.target.id)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        target = node.target
        if isinstance(target, ast.Name) and self.current_scope_is_global():
            self.global_vars.add(target.id)
        self.generic_visit(node)

    def visit_NamedExpr(self, node):
        if isinstance(node.target, ast.Name) and self.current_scope_is_global():
            self.global_vars.add(node.target.id)
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        if self.current_scope_is_global():
            self.global_vars.add(node.name)
        self.scope_stack.append(node.name)  # Enter class scope
        self.generic_visit(node)
        self.scope_stack.pop()  # Exit class scope

    def visit_FunctionDef(self, node):
        if self.current_scope_is_global():
            self.global_vars.add(node.name)

        prev_function_globals = self.function_globals
        self.function_globals = set()

        self.scope_stack.append(node.name)  # Enter function scope
        self.generic_visit(node)
        self.scope_stack.pop()  # Exit function scope

        self.function_globals = prev_function_globals

    def visit_AsyncFunctionDef(self, node):
        if self.current_scope_is_global():
            self.global_vars.add(node.name)

        prev_function_globals = self.function_globals
        self.function_globals = set()

        self.scope_stack.append(node.name)  # Enter function scope
        self.generic_visit(node)
        self.scope_stack.pop()  # Exit function scope

        self.function_globals = prev_function_globals

    def visit_Name(self, node):
        builtins = {
            "print",
            "len",
            "range",
            "str",
            "int",
            "float",
            "bool",
            "list",
            "dict",
            "set",
            "tuple",
            "abs",
            "all",
            "any",
            "bin",
            "callable",
            "chr",
            "dir",
            "enumerate",
            "eval",
            "exec",
            "filter",
            "format",
            "getattr",
            "globals",
            "hasattr",
            "hash",
            "help",
            "hex",
            "id",
            "input",
            "isinstance",
            "issubclass",
            "iter",
            "locals",
            "map",
            "max",
            "min",
            "next",
            "oct",
            "open",
            "ord",
            "pow",
            "repr",
            "reversed",
            "round",
            "setattr",
            "sorted",
            "sum",
            "type",
            "vars",
            "zip",
            "__import__",
            "True",
            "False",
            "None",
        }

        if isinstance(node.ctx, ast.Load):
            if node.id in builtins:
                self.generic_visit(node)
                return

            if self.current_scope_is_global():
                self.used_global_vars.add(node.id)
            elif node.id in self.function_globals:
                # Variable explicitly declared as global in current function
                self.used_global_vars.add(node.id)
            elif node.id in self.global_vars:
                self.used_global_vars.add(node.id)
        elif isinstance(node.ctx, ast.Store):
            # Only track variable assignments at global scope
            if self.current_scope_is_global():
                self.global_vars.add(node.id)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # Attributes are part of global usage if they are prefixed by a global variable
        if isinstance(node.value, ast.Name):
            if self.current_scope_is_global():
                self.used_global_vars.add(node.value.id)
            elif node.value.id in self.function_globals:
                # Variable explicitly declared as global in current function
                self.used_global_vars.add(node.value.id)
            elif node.value.id in self.global_vars:
                self.used_global_vars.add(node.value.id)
        else:
            self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            self.imported_modules.add(alias.asname or alias.name)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            self.imported_modules.add(alias.asname or alias.name)


def get_defined_used_variables(code):
    visitor = VariableVisitor()
    tree = ast.parse(code)
    visitor.visit(tree)
    return (
        visitor.global_vars,
        visitor.used_global_vars,
        visitor.imported_modules,
    )


def sanitize_python_variable_name(name):
    """
    Python implementation of sanitizePythonVariableName from utils.ts
    """
    sanitized = re.sub(r"\s+", "_", name)
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "", sanitized)
    sanitized = re.sub(r"^[^a-zA-Z_]+", "", sanitized)

    if sanitized == "":
        sanitized = "input_1"

    return sanitized


def extract_jinja_variables(sql_code):
    """
    Extract Jinja variables from SQL code.
    Simplified version that doesn't require jinja2 - just uses regex.
    """
    # Find {{ variable }} patterns
    jinja_vars = set(re.findall(r"\{\{\s*(\w+)", sql_code))

    # Look for table names after FROM, JOIN, etc. that could be variables
    clean_sql = re.sub(r"\{\{.*?\}\}", "", sql_code)
    clean_sql = re.sub(r"\{%.*?%\}", "", clean_sql, flags=re.DOTALL)

    table_patterns = [
        r"\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bINTO\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)",
    ]

    sql_keywords = {
        "select",
        "where",
        "group",
        "order",
        "having",
        "limit",
        "offset",
        "union",
        "intersect",
        "except",
    }

    for pattern in table_patterns:
        matches = re.findall(pattern, clean_sql, re.IGNORECASE)
        for match in matches:
            if match.lower() not in sql_keywords:
                jinja_vars.add(match)

    return jinja_vars


def comment_out_jupyter_bash_commands(code):
    """Comment out lines starting with % or ! to prevent parse errors."""
    lines = code.split("\n")
    for i in range(len(lines)):
        if lines[i].startswith("%") or lines[i].startswith("!"):
            lines[i] = "#" + lines[i]
    return "\n".join(lines)


def analyze_block(block):
    """Analyze a single block and return its variable dependencies."""
    try:
        block_type = block.get("type") or "code"
        code = block.get("code", "")
        metadata = block.get("metadata", {}) or {}
        block_id = block["blockId"]

        if block_type == "code":
            # Comment out magic commands
            code = comment_out_jupyter_bash_commands(code)
            block_defined, block_used, block_imported = get_defined_used_variables(code)

            return {
                "blockId": block_id,
                "definedVariables": sorted(list(block_defined)),
                "usedVariables": sorted(list(block_used)),
                "importedModules": list(block_imported),
            }

        elif block_type == "sql":
            jinja_variables = extract_jinja_variables(code)
            output_variables = []
            if metadata.get("deepnote_variable_name"):
                output_variables = [metadata["deepnote_variable_name"]]

            return {
                "blockId": block_id,
                "definedVariables": output_variables,
                "usedVariables": sorted(list(jinja_variables)),
                "importedModules": [],
            }

        elif block_type == "button":
            output_variables = []
            if metadata.get("deepnote_variable_name"):
                output_variables = [metadata["deepnote_variable_name"]]

            return {
                "blockId": block_id,
                "definedVariables": output_variables,
                "usedVariables": [],
                "importedModules": [],
            }

        elif block_type == "big-number":
            used_variables = []
            if metadata.get("deepnote_big_number_value"):
                used_variables.append(metadata["deepnote_big_number_value"])
            if metadata.get("deepnote_big_number_comparison_value"):
                used_variables.append(metadata["deepnote_big_number_comparison_value"])

            return {
                "blockId": block_id,
                "definedVariables": [],
                "usedVariables": sorted(list(set(used_variables))),
                "importedModules": [],
            }

        elif block_type.startswith("input-"):
            output_variables = []
            if metadata.get("deepnote_variable_name"):
                variable_name = metadata["deepnote_variable_name"]
                if variable_name:
                    sanitized_name = sanitize_python_variable_name(variable_name)
                    output_variables = [sanitized_name]

            return {
                "blockId": block_id,
                "definedVariables": output_variables,
                "usedVariables": [],
                "importedModules": [],
            }

        else:
            # Unknown block type - return empty
            return {
                "blockId": block_id,
                "definedVariables": [],
                "usedVariables": [],
                "importedModules": [],
            }

    except Exception as e:
        return {
            "blockId": block.get("blockId", "unknown"),
            "definedVariables": [],
            "usedVariables": [],
            "importedModules": [],
            "error": {
                "type": e.__class__.__name__,
                "message": str(e),
            },
        }


def analyze_blocks(blocks_json):
    """
    Main entry point for browser usage.
    Takes JSON string of blocks, returns JSON string of analysis.
    """
    try:
        blocks = (
            json.loads(blocks_json) if isinstance(blocks_json, str) else blocks_json
        )
        results = [analyze_block(block) for block in blocks]
        return json.dumps(results)
    except Exception as e:
        return json.dumps({"errorMessage": f"{e.__class__.__name__}: {str(e)}"})


# For direct testing
if __name__ == "__main__":
    test_blocks = [
        {"blockId": "a", "type": "code", "code": "x = 1\ny = 2"},
        {"blockId": "b", "type": "code", "code": "z = x + y"},
        {
            "blockId": "c",
            "type": "code",
            "code": "import pandas as pd\ndf = pd.DataFrame()",
        },
    ]
    print(analyze_blocks(json.dumps(test_blocks)))
