import ast
import json
import sys
import argparse
from jinja2 import meta, Environment


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
            'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
            'abs', 'all', 'any', 'bin', 'callable', 'chr', 'dir', 'enumerate', 'eval', 'exec',
            'filter', 'format', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id',
            'input', 'isinstance', 'issubclass', 'iter', 'locals', 'map', 'max', 'min', 'next',
            'oct', 'open', 'ord', 'pow', 'repr', 'reversed', 'round', 'setattr', 'sorted', 'sum',
            'type', 'vars', 'zip', '__import__', 'True', 'False', 'None'
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


def get_defined_used_variables(block):
    visitor = VariableVisitor()
    tree = ast.parse(block["content"])
    visitor.visit(tree)
    return (
        visitor.global_vars,
        visitor.used_global_vars,
        visitor.imported_modules,
    )


# Dummy implementation of inclause - jinjasql filters
def inclause(value):
    return value


# Dummy implementation of bind - jinjasql filters
def bind(value):
    return value


# Dummy implementation of sqlsafe - jinjasql filters
def sqlsafe(value):
    return value


def sanitize_python_variable_name(name):
    """
    Python implementation of sanitizePythonVariableName from utils.ts
    """
    import re
    sanitized = re.sub(r'\s+', '_', name)
    sanitized = re.sub(r'[^0-9a-zA-Z_]', '', sanitized)
    sanitized = re.sub(r'^[^a-zA-Z_]+', '', sanitized)

    if sanitized == '':
        sanitized = 'input_1'

    return sanitized


def extract_jinja_variables(sql_code):
    env = Environment()

    # The SQL code can contain filters from jinjasql.
    # We don't use jinjasql directly as it is not compatible with the Jinja2 version we use in notebook.
    env.filters["inclause"] = inclause
    env.filters["bind"] = bind
    env.filters["sqlsafe"] = sqlsafe

    parsed_content = env.parse(sql_code)
    jinja_variables = meta.find_undeclared_variables(parsed_content)

    # Look for table names after FROM, JOIN, etc. that could be variables
    import re
    sql_variables = set()

    clean_sql = re.sub(r'\{\{.*?\}\}', '', sql_code)
    clean_sql = re.sub(r'\{%.*?%\}', '', clean_sql, flags=re.DOTALL)

    table_patterns = [
        r'\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\bINTO\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)'
    ]

    for pattern in table_patterns:
        matches = re.findall(pattern, clean_sql, re.IGNORECASE)
        for match in matches:
            if match.lower() not in ['select', 'where', 'group', 'order', 'having', 'limit', 'offset', 'union', 'intersect', 'except']:
                sql_variables.add(match)

    return jinja_variables.union(sql_variables)


# Why we are commenting out the lines instead of stripping them?
# When the parser throws an error it often contains the line number.
# If we would strip the lines the line numbers in the errors would not be correct.
def comment_out_jupyter_bash_commands(blocks):
    for block in blocks:
        if "content" in block:
            lines = block["content"].split("\n")
            for i in range(len(lines)):
                if lines[i].startswith("%") or lines[i].startswith("!"):
                    lines[i] = "#" + lines[i]
            block["content"] = "\n".join(lines)
    return blocks


def analyze_blocks(blocks):
    analysis = []

    for block in blocks:
        try:
            if block.get("type") == "code" or block.get("type") is None:
                block_defined, block_used, block_imported = get_defined_used_variables(
                    block
                )
                block_defined_list = list(block_defined)
                block_defined_list.sort()
                block_used_list = list(block_used)
                block_used_list.sort()
                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": block_defined_list,
                        "usedVariables": block_used_list,
                        "importedModules": list(block_imported),
                    }
                )
            elif block["type"] == "sql":
                jinja_variables = extract_jinja_variables(block["content"])
                jinja_variables_list = list(jinja_variables)
                jinja_variables_list.sort()

                output_variables = []
                if "metadata" in block and block["metadata"] and "deepnote_variable_name" in block["metadata"]:
                    output_variables = [block["metadata"]["deepnote_variable_name"]]

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": jinja_variables_list,
                        "importedModules": [],
                    }
                )
            elif block["type"] == "button":
                output_variables = []
                if "metadata" in block and block["metadata"] and "deepnote_variable_name" in block["metadata"]:
                    output_variables = [block["metadata"]["deepnote_variable_name"]]

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": [],
                        "importedModules": [],
                    }
                )
            elif block["type"] == "big-number":
                used_variables = []
                if "metadata" in block and block["metadata"]:
                    if "deepnote_big_number_value" in block["metadata"]:
                        used_variables.append(block["metadata"]["deepnote_big_number_value"])
                    if "deepnote_big_number_comparison_value" in block["metadata"]:
                        used_variables.append(block["metadata"]["deepnote_big_number_comparison_value"])

                used_variables = list(set(used_variables))
                used_variables.sort()

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": [],
                        "usedVariables": used_variables,
                        "importedModules": [],
                    }
                )
            elif block["type"] == "notebook-function":
                input_variables = []
                output_variables = []

                if "metadata" in block and block["metadata"]:
                    if "function_notebook_inputs" in block["metadata"]:
                        for input_key, input_config in block["metadata"]["function_notebook_inputs"].items():
                            if input_config.get("custom_value") is None and input_config.get("variable_name"):
                                sanitized_name = sanitize_python_variable_name(input_config["variable_name"])
                                input_variables.append(sanitized_name)

                    if "function_notebook_export_mappings" in block["metadata"]:
                        for output_key, output_config in block["metadata"]["function_notebook_export_mappings"].items():
                            if output_config.get("enabled") is True and output_config.get("variable_name"):
                                sanitized_name = sanitize_python_variable_name(output_config["variable_name"])
                                output_variables.append(sanitized_name)

                input_variables.sort()
                output_variables.sort()

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": input_variables,
                        "importedModules": [],
                    }
                )
            elif block["type"] in ["input-text", "input-textarea", "input-file", "input-select", "input-date", "input-date-range", "input-slider", "input-checkbox", "input-number", "input-dropdown"]:
                output_variables = []
                if "metadata" in block and block["metadata"] and "deepnote_variable_name" in block["metadata"]:
                    variable_name = block["metadata"]["deepnote_variable_name"]
                    if variable_name is not None:
                        sanitized_name = sanitize_python_variable_name(variable_name)
                        output_variables = [sanitized_name]

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": [],
                        "importedModules": [],
                    }
                )
        except Exception as e:
            analysis.append(
                {
                    "id": block["id"],
                    "definedVariables": list(),
                    "usedVariables": list(),
                    "importedModules": list(),
                    "error": {
                        "type": e.__class__.__name__,
                        "message": str(e),
                    },
                }
            )

    return analysis


def main():
    parser = argparse.ArgumentParser(description='Analyze AST of Python and SQL blocks')
    parser.add_argument('--input', required=True, help='JSON input file path')
    parser.add_argument('--output', required=True, help='JSON output file path')

    args = parser.parse_args()

    try:
        # Read input data from file
        with open(args.input, 'r') as f:
            data = json.load(f)

        blocks = comment_out_jupyter_bash_commands(data["blocks"])
        result = analyze_blocks(blocks)

        # Write output data to file
        with open(args.output, 'w') as f:
            json.dump(result, f)

    except Exception as e:
        error_result = {
            "errorMessage": f"{e.__class__.__name__}: {str(e)}"
        }
        # Write error to output file
        with open(args.output, 'w') as f:
            json.dump(error_result, f)
        sys.exit(1)


if __name__ == "__main__":
    main()
