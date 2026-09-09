import ast
import json
import sys
import argparse
import re
import builtins
from jinja2 import meta, Environment


# Set of Python built-in names to ignore during analysis
BUILTINS_SET = set(dir(builtins))


class VariableVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.global_vars = set()  # Variables defined globally
        self.used_global_vars = set()  # Variables used and defined globally
        self.imported_modules = set()  # Local names introduced by imports (aliases)
        self.imported_packages = set()  # Top-level package names from import sources
        # Stack of (bound names, is_class) scopes. Bound names are parameters, assignments and
        # comprehension targets. Block boundaries are not scope boundaries, so a load that no
        # enclosing scope binds is a module-level read even deep inside a body.
        self.scope_stack = []
        self.function_globals = set()  # Names declared `global` in the current function

    def current_scope_is_global(self):
        # If the scope stack is empty, we are at the global level
        return not self.scope_stack

    def _is_local(self, name):
        if name in self.function_globals:
            return False
        for depth, (names, is_class) in enumerate(reversed(self.scope_stack)):
            # Class bodies are invisible to the scopes nested in them: a method reading a name
            # that the class body also binds reads the module-level one.
            if is_class and depth > 0:
                continue
            if name in names:
                return True
        return False

    def _record_load(self, name):
        if name in BUILTINS_SET or self._is_local(name):
            return
        self.used_global_vars.add(name)

    def _record_store(self, name):
        if self.current_scope_is_global() or name in self.function_globals:
            self.global_vars.add(name)
        else:
            self.scope_stack[-1][0].add(name)

    def _bound_names(self, nodes):
        """Names bound by statements in `nodes`, without descending into nested scopes.

        Python binds a name for the whole function when it is assigned anywhere in it, so the
        set has to be known before the body is walked: `x = x + 1` reads the local, not a global.
        """
        bound = set()
        stack = list(nodes)
        while stack:
            node = stack.pop()
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(node.name)
                continue
            if isinstance(node, (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                continue
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                bound.add(node.id)
            elif isinstance(node, ast.ExceptHandler) and node.name:
                bound.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    bound.add((alias.asname or alias.name).split(".")[0])
            elif isinstance(node, ast.arg):
                bound.add(node.arg)
            stack.extend(ast.iter_child_nodes(node))
        return bound

    def _visit_scoped(self, bound, nodes, is_class=False):
        self.scope_stack.append((set(bound), is_class))
        for node in nodes:
            self.visit(node)
        self.scope_stack.pop()

    def visit_Global(self, node):
        for name in node.names:
            self.function_globals.add(name)
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        self._record_store(node.name)
        for expr in node.bases + node.keywords + node.decorator_list:
            self.visit(expr)
        self._visit_scoped(self._bound_names(node.body), node.body, is_class=True)

    def _visit_function(self, node):
        if not isinstance(node, ast.Lambda):
            self._record_store(node.name)
            for expr in node.decorator_list:
                self.visit(expr)
            if node.returns is not None:
                self.visit(node.returns)
        # Defaults and annotations are evaluated in the enclosing scope, not the function's.
        for expr in node.args.defaults + node.args.kw_defaults:
            if expr is not None:
                self.visit(expr)
        for arg in ast.walk(node.args):
            if isinstance(arg, ast.arg) and arg.annotation is not None:
                self.visit(arg.annotation)

        prev_function_globals = self.function_globals
        self.function_globals = set()
        body = node.body if isinstance(node.body, list) else [node.body]
        self._visit_scoped(self._bound_names([node.args, *body]), body)
        self.function_globals = prev_function_globals

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function
    visit_Lambda = _visit_function

    def _visit_comprehension(self, node):
        # The first iterable is evaluated in the enclosing scope; everything else runs inside
        # the comprehension's own scope, where its targets are bound.
        generators = node.generators
        self.visit(generators[0].iter)
        bound = self._bound_names([gen.target for gen in generators])
        elements = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
        rest = [gen.iter for gen in generators[1:]]
        rest += [cond for gen in generators for cond in gen.ifs]
        self._visit_scoped(bound, rest + elements)

    visit_ListComp = _visit_comprehension
    visit_SetComp = _visit_comprehension
    visit_DictComp = _visit_comprehension
    visit_GeneratorExp = _visit_comprehension

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self._record_load(node.id)
        elif isinstance(node.ctx, ast.Store):
            self._record_store(node.id)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # Attributes are part of global usage if they are prefixed by a global variable
        if isinstance(node.value, ast.Name):
            self._record_load(node.value.id)
        else:
            self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            self.imported_modules.add(alias.asname or alias.name)
            top_level = alias.name.split(".")[0]
            self.imported_packages.add(top_level)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            self.imported_modules.add(alias.asname or alias.name)
        if node.module:
            top_level = node.module.split(".")[0]
            self.imported_packages.add(top_level)


def get_defined_used_variables(block):
    visitor = VariableVisitor()
    tree = ast.parse(block["content"])
    visitor.visit(tree)
    return (
        visitor.global_vars,
        visitor.used_global_vars,
        visitor.imported_modules,
        visitor.imported_packages,
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
    sanitized = re.sub(r"\s+", "_", name)
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "", sanitized)
    sanitized = re.sub(r"^[^a-zA-Z_]+", "", sanitized)

    if sanitized == "":
        sanitized = "input_1"

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
    sql_variables = set()

    clean_sql = re.sub(r"\{\{.*?\}\}", "", sql_code)
    clean_sql = re.sub(r"\{%.*?%\}", "", clean_sql, flags=re.DOTALL)

    table_patterns = [
        r"\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bINTO\s+([a-zA-Z_][a-zA-Z0-9_]*)",
        r"\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)",
    ]

    for pattern in table_patterns:
        matches = re.findall(pattern, clean_sql, re.IGNORECASE)
        for match in matches:
            if match.lower() not in [
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
            ]:
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


def count_lines_of_code(content):
    """
    Count lines of code in a block's content.
    Returns the total number of lines (including empty lines and comments).
    """
    if not content:
        return 0
    return len(content.split("\n"))


def analyze_blocks(blocks):
    analysis = []

    for block in blocks:
        try:
            content = block.get("content", "")
            loc = count_lines_of_code(content)

            if block.get("type") == "code" or block.get("type") is None:
                block_defined, block_used, block_imported, block_packages = get_defined_used_variables(
                    block
                )
                block_defined_list = list(block_defined)
                block_defined_list.sort()
                block_used_list = list(block_used)
                block_used_list.sort()
                block_imported_list = list(block_imported)
                block_imported_list.sort()
                block_packages_list = list(block_packages)
                block_packages_list.sort()
                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": block_defined_list,
                        "usedVariables": block_used_list,
                        "importedModules": block_imported_list,
                        "importedPackages": block_packages_list,
                        "linesOfCode": loc,
                    }
                )
            elif block["type"] == "sql":
                jinja_variables = extract_jinja_variables(block["content"])
                jinja_variables_list = list(jinja_variables)
                jinja_variables_list.sort()

                output_variables = []
                if (
                    "metadata" in block
                    and block["metadata"]
                    and "deepnote_variable_name" in block["metadata"]
                ):
                    output_variables = [block["metadata"]["deepnote_variable_name"]]

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": jinja_variables_list,
                        "importedModules": [],
                        "linesOfCode": loc,
                    }
                )
            elif block["type"] == "button":
                output_variables = []
                if (
                    "metadata" in block
                    and block["metadata"]
                    and "deepnote_variable_name" in block["metadata"]
                ):
                    output_variables = [block["metadata"]["deepnote_variable_name"]]

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": [],
                        "importedModules": [],
                        "linesOfCode": loc,
                    }
                )
            elif block["type"] == "big-number":
                used_variables = []
                if "metadata" in block and block["metadata"]:
                    if "deepnote_big_number_value" in block["metadata"]:
                        used_variables.append(
                            block["metadata"]["deepnote_big_number_value"]
                        )
                    if "deepnote_big_number_comparison_value" in block["metadata"]:
                        used_variables.append(
                            block["metadata"]["deepnote_big_number_comparison_value"]
                        )

                used_variables = list(set(used_variables))
                used_variables.sort()

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": [],
                        "usedVariables": used_variables,
                        "importedModules": [],
                        "linesOfCode": loc,
                    }
                )
            elif block["type"] == "notebook-function":
                input_variables = []
                output_variables = []

                if "metadata" in block and block["metadata"]:
                    if "function_notebook_inputs" in block["metadata"]:
                        for _, input_config in block["metadata"][
                            "function_notebook_inputs"
                        ].items():
                            if input_config.get(
                                "custom_value"
                            ) is None and input_config.get("variable_name"):
                                sanitized_name = sanitize_python_variable_name(
                                    input_config["variable_name"]
                                )
                                input_variables.append(sanitized_name)

                    if "function_notebook_export_mappings" in block["metadata"]:
                        for _, output_config in block["metadata"][
                            "function_notebook_export_mappings"
                        ].items():
                            if output_config.get(
                                "enabled"
                            ) is True and output_config.get("variable_name"):
                                sanitized_name = sanitize_python_variable_name(
                                    output_config["variable_name"]
                                )
                                output_variables.append(sanitized_name)

                input_variables.sort()
                output_variables.sort()

                analysis.append(
                    {
                        "id": block["id"],
                        "definedVariables": output_variables,
                        "usedVariables": input_variables,
                        "importedModules": [],
                        "linesOfCode": loc,
                    }
                )
            elif block["type"] in [
                "input-text",
                "input-textarea",
                "input-file",
                "input-select",
                "input-date",
                "input-date-range",
                "input-slider",
                "input-checkbox",
                "input-number",
                "input-dropdown",
            ]:
                output_variables = []
                if (
                    "metadata" in block
                    and block["metadata"]
                    and "deepnote_variable_name" in block["metadata"]
                ):
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
                        "linesOfCode": loc,
                    }
                )
        except Exception as e:
            content = block.get("content", "")
            loc = count_lines_of_code(content)
            analysis.append(
                {
                    "id": block["id"],
                    "definedVariables": [],
                    "usedVariables": [],
                    "importedModules": [],
                    "linesOfCode": loc,
                    "error": {
                        "type": e.__class__.__name__,
                        "message": str(e),
                    },
                }
            )

    return analysis


def main():
    parser = argparse.ArgumentParser(description="Analyze AST of Python and SQL blocks")
    parser.add_argument("--input", required=True, help="JSON input file path")
    parser.add_argument("--output", required=True, help="JSON output file path")

    args = parser.parse_args()

    try:
        # Read input data from file
        with open(args.input, "r") as f:
            data = json.load(f)

        blocks = comment_out_jupyter_bash_commands(data["blocks"])
        result = analyze_blocks(blocks)

        # Write output data to file
        with open(args.output, "w") as f:
            json.dump(result, f)

    except Exception as e:
        error_result = {"errorMessage": f"{e.__class__.__name__}: {str(e)}"}
        # Write error to output file
        with open(args.output, "w") as f:
            json.dump(error_result, f)
        sys.exit(1)


if __name__ == "__main__":
    main()
