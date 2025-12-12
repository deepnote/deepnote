/**
 * Browser-compatible reactivity module.
 * Uses Pyodide to run Python AST analysis in the browser.
 */

import { getDownstreamBlocksForBlocksIds } from './dag-analyzer'
import { buildDAGFromBlocks } from './dag-builder'
import type { AnalyzerBlock, AstAnalyzerItem, BlockContentDepsDAG, BlockContentDepsWithOrder } from './types'
import { AstAnalyzerResponseSchema } from './types'

export { getDownstreamBlocksForBlocksIds } from './dag-analyzer'
// Re-export DAG utilities
export { buildDAGFromBlocks } from './dag-builder'
export type {
  AnalyzerBlock,
  AstAnalyzerItem,
  BlockContentDeps,
  BlockContentDepsDAG,
  BlockContentDepsWithOrder,
  DAGEdge,
  DAGNode,
} from './types'

// The Python AST analyzer code (will be loaded at runtime)
const AST_ANALYZER_CODE = `
import ast
import json
import re


class VariableVisitor(ast.NodeVisitor):
    def __init__(self):
        self.global_vars = set()
        self.used_global_vars = set()
        self.imported_modules = set()
        self.scope_stack = []
        self.function_globals = set()

    def current_scope_is_global(self):
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
        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_FunctionDef(self, node):
        if self.current_scope_is_global():
            self.global_vars.add(node.name)
        prev_function_globals = self.function_globals
        self.function_globals = set()
        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()
        self.function_globals = prev_function_globals

    def visit_AsyncFunctionDef(self, node):
        if self.current_scope_is_global():
            self.global_vars.add(node.name)
        prev_function_globals = self.function_globals
        self.function_globals = set()
        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()
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
                self.used_global_vars.add(node.id)
            elif node.id in self.global_vars:
                self.used_global_vars.add(node.id)
        elif isinstance(node.ctx, ast.Store):
            if self.current_scope_is_global():
                self.global_vars.add(node.id)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name):
            if self.current_scope_is_global():
                self.used_global_vars.add(node.value.id)
            elif node.value.id in self.function_globals:
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


def _get_defined_used_variables(code):
    visitor = VariableVisitor()
    tree = ast.parse(code)
    visitor.visit(tree)
    return (visitor.global_vars, visitor.used_global_vars, visitor.imported_modules)


def _sanitize_python_variable_name(name):
    sanitized = re.sub(r'\\s+', '_', name)
    sanitized = re.sub(r'[^0-9a-zA-Z_]', '', sanitized)
    sanitized = re.sub(r'^[^a-zA-Z_]+', '', sanitized)
    if sanitized == '':
        sanitized = 'input_1'
    return sanitized


def _extract_jinja_variables(sql_code):
    jinja_vars = set(re.findall(r'\\{\\{\\s*(\\w+)', sql_code))
    clean_sql = re.sub(r'\\{\\{.*?\\}\\}', '', sql_code)
    clean_sql = re.sub(r'\\{%.*?%\\}', '', clean_sql, flags=re.DOTALL)
    table_patterns = [
        r'\\bFROM\\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\\bJOIN\\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\\bINTO\\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        r'\\bUPDATE\\s+([a-zA-Z_][a-zA-Z0-9_]*)'
    ]
    sql_keywords = {'select', 'where', 'group', 'order', 'having', 'limit', 'offset', 'union', 'intersect', 'except'}
    for pattern in table_patterns:
        matches = re.findall(pattern, clean_sql, re.IGNORECASE)
        for match in matches:
            if match.lower() not in sql_keywords:
                jinja_vars.add(match)
    return jinja_vars


def _comment_out_jupyter_bash_commands(code):
    lines = code.split("\\n")
    for i in range(len(lines)):
        if lines[i].startswith("%") or lines[i].startswith("!"):
            lines[i] = "#" + lines[i]
    return "\\n".join(lines)


def _analyze_block(block):
    try:
        block_type = block.get("type") or "code"
        code = block.get("code", "")
        metadata = block.get("metadata", {}) or {}
        block_id = block["blockId"]

        if block_type == "code":
            code = _comment_out_jupyter_bash_commands(code)
            block_defined, block_used, block_imported = _get_defined_used_variables(code)
            return {
                "blockId": block_id,
                "definedVariables": sorted(list(block_defined)),
                "usedVariables": sorted(list(block_used)),
                "importedModules": list(block_imported),
            }
        elif block_type == "sql":
            jinja_variables = _extract_jinja_variables(code)
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
                    sanitized_name = _sanitize_python_variable_name(variable_name)
                    output_variables = [sanitized_name]
            return {
                "blockId": block_id,
                "definedVariables": output_variables,
                "usedVariables": [],
                "importedModules": [],
            }
        else:
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
            "error": {"type": e.__class__.__name__, "message": str(e)},
        }


def _deepnote_analyze_blocks(blocks_json):
    try:
        blocks = json.loads(blocks_json) if isinstance(blocks_json, str) else blocks_json
        results = [_analyze_block(block) for block in blocks]
        return json.dumps(results)
    except Exception as e:
        return json.dumps({"errorMessage": f"{e.__class__.__name__}: {str(e)}"})
`

// Pyodide interface (minimal typing)
interface PyodideInterface {
  runPythonAsync: (code: string) => Promise<unknown>
  globals: {
    get: (name: string) => unknown
  }
}

/**
 * Creates a browser-compatible AST analyzer that runs in Pyodide.
 */
export function createBrowserAstAnalyzer(pyodide: PyodideInterface) {
  let initialized = false

  async function ensureInitialized(): Promise<void> {
    if (initialized) return

    // Load the AST analyzer code into Pyodide
    await pyodide.runPythonAsync(AST_ANALYZER_CODE)
    initialized = true
  }

  /**
   * Analyze blocks and return their variable dependencies.
   */
  async function analyzeBlocks(blocks: AnalyzerBlock[]): Promise<BlockContentDepsWithOrder[]> {
    await ensureInitialized()

    // Convert blocks to the format expected by the Python analyzer
    const blocksForAnalyzer = blocks
      .filter(
        block =>
          block.cell_type === 'code' ||
          block.cell_type === 'sql' ||
          block.cell_type === 'button' ||
          block.cell_type === 'big-number' ||
          block.cell_type?.startsWith('input-')
      )
      .map(block => ({
        type: block.cell_type,
        blockId: block.cellId,
        code: block.source,
        metadata: block.metadata,
      }))

    if (blocksForAnalyzer.length === 0) {
      return []
    }

    const inputJson = JSON.stringify(blocksForAnalyzer)

    // Call the Python analyzer
    const resultJson = (await pyodide.runPythonAsync(
      `_deepnote_analyze_blocks('''${inputJson.replace(/'/g, "\\'")}''')`
    )) as string

    const parsed = AstAnalyzerResponseSchema.safeParse(JSON.parse(resultJson))
    if (!parsed.success) {
      throw new Error('Invalid AST analyzer response format')
    }

    const parsedData = parsed.data

    if (Array.isArray(parsedData)) {
      return parsedData.map((item: AstAnalyzerItem) => ({
        ...item,
        order: blocks.findIndex(b => b.cellId === item.blockId),
      }))
    }

    if ('errorMessage' in parsedData) {
      throw new Error(parsedData.errorMessage)
    }

    throw new Error('Unexpected AST analyzer response')
  }

  /**
   * Build a complete DAG from blocks.
   */
  async function buildDAG(blocks: AnalyzerBlock[]): Promise<BlockContentDepsDAG> {
    const deps = await analyzeBlocks(blocks)
    return buildDAGFromBlocks(deps)
  }

  /**
   * Get all downstream blocks that depend on the given block IDs.
   */
  async function getDownstreamBlocks(blocks: AnalyzerBlock[], changedBlockIds: string[]): Promise<string[]> {
    const dag = await buildDAG(blocks)
    return getDownstreamBlocksForBlocksIds(dag, changedBlockIds)
  }

  return {
    analyzeBlocks,
    buildDAG,
    getDownstreamBlocks,
    ensureInitialized,
  }
}

export type BrowserAstAnalyzer = ReturnType<typeof createBrowserAstAnalyzer>
