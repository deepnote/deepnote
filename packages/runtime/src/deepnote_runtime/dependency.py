"""AST-based dependency analysis for reactive execution.

Analyzes each code block to determine:
- Which variables it reads (dependencies)
- Which variables it writes (definitions)
- Whether it uses dynamic constructs (eval/exec) that break reactivity

Builds a dependency graph at the variable level for precise reactive
re-execution.
"""

from __future__ import annotations

import ast
import warnings
from dataclasses import dataclass, field


# Names that are always available and should not be treated as dependencies
BUILTIN_NAMES = frozenset({
    "print", "len", "range", "int", "float", "str", "list", "dict", "set",
    "tuple", "bool", "type", "isinstance", "issubclass", "hasattr", "getattr",
    "setattr", "delattr", "id", "hash", "repr", "abs", "round", "min", "max",
    "sum", "sorted", "reversed", "enumerate", "zip", "map", "filter", "any",
    "all", "next", "iter", "open", "input", "super", "property", "staticmethod",
    "classmethod", "object", "None", "True", "False", "Exception",
    "ValueError", "TypeError", "KeyError", "IndexError", "AttributeError",
    "ImportError", "RuntimeError", "StopIteration", "NotImplementedError",
    "OSError", "FileNotFoundError", "ZeroDivisionError", "NameError",
    "SyntaxError", "IOError", "AssertionError",
    "format", "chr", "ord", "hex", "oct", "bin",
    "bytes", "bytearray", "memoryview", "complex", "frozenset",
    "vars", "dir", "globals", "locals", "exec", "eval", "compile",
    "breakpoint", "callable", "divmod", "pow", "slice",
    "__name__", "__doc__", "__builtins__", "__import__",
    "display",  # Our injected display function
})

# Dynamic constructs that may break reactivity
DYNAMIC_CALLS = frozenset({"eval", "exec", "globals", "locals", "__import__"})


@dataclass
class BlockAnalysis:
    """Result of analyzing a single block's variable usage."""

    block_id: str
    reads: set[str] = field(default_factory=set)
    writes: set[str] = field(default_factory=set)
    has_dynamic_constructs: bool = False
    dynamic_warnings: list[str] = field(default_factory=list)


@dataclass
class DependencyGraph:
    """Variable-level dependency graph across all blocks.

    Maps block IDs to their read/write sets, and provides methods
    to determine execution order and dirty propagation.
    """

    analyses: dict[str, BlockAnalysis] = field(default_factory=dict)

    def add(self, analysis: BlockAnalysis) -> None:
        self.analyses[analysis.block_id] = analysis

    def get_dependencies(self, block_id: str) -> set[str]:
        """Get block IDs that this block depends on (reads variables they write)."""
        analysis = self.analyses.get(block_id)
        if not analysis:
            return set()

        deps = set()
        for other_id, other in self.analyses.items():
            if other_id == block_id:
                continue
            # This block depends on other if it reads something other writes
            if analysis.reads & other.writes:
                deps.add(other_id)
        return deps

    def get_dependents(self, block_id: str) -> set[str]:
        """Get block IDs that depend on this block."""
        analysis = self.analyses.get(block_id)
        if not analysis:
            return set()

        dependents = set()
        for other_id, other in self.analyses.items():
            if other_id == block_id:
                continue
            if other.reads & analysis.writes:
                dependents.add(other_id)
        return dependents

    def get_dirty_blocks(self, changed_variables: set[str]) -> set[str]:
        """Given a set of changed variables, return all blocks that need re-execution."""
        dirty = set()
        for block_id, analysis in self.analyses.items():
            if analysis.reads & changed_variables:
                dirty.add(block_id)
        # Transitively propagate
        return self._propagate_dirty(dirty)

    def _propagate_dirty(self, initial_dirty: set[str]) -> set[str]:
        """Propagate dirtiness through the dependency graph."""
        dirty = set(initial_dirty)
        queue = list(initial_dirty)
        while queue:
            block_id = queue.pop(0)
            for dependent in self.get_dependents(block_id):
                if dependent not in dirty:
                    dirty.add(dependent)
                    queue.append(dependent)
        return dirty

    def topological_sort(
        self,
        block_ids: set[str] | None = None,
        block_order: dict[str, int] | None = None,
    ) -> list[str]:
        """Return block IDs in execution order (topological sort).

        If block_ids is provided, only sort those blocks.
        Otherwise sort all blocks.

        block_order maps block_id -> original position index, used as
        tiebreaker so blocks without dependency constraints keep their
        natural (sorting_key) order.
        """
        if block_ids is None:
            block_ids = set(self.analyses.keys())

        # Build adjacency for the subset
        in_degree: dict[str, int] = {bid: 0 for bid in block_ids}
        graph: dict[str, list[str]] = {bid: [] for bid in block_ids}

        for bid in block_ids:
            for dep in self.get_dependencies(bid):
                if dep in block_ids:
                    graph[dep].append(bid)
                    in_degree[bid] += 1

        # Use block_order for tiebreaking (default to block_id for determinism)
        sort_key = (lambda bid: block_order.get(bid, 0)) if block_order else (lambda bid: bid)

        # Kahn's algorithm
        queue = sorted([bid for bid in block_ids if in_degree[bid] == 0], key=sort_key)
        result = []

        while queue:
            node = queue.pop(0)
            result.append(node)
            for neighbor in graph[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)
            queue.sort(key=sort_key)

        if len(result) != len(block_ids):
            # Cycle detected — include remaining blocks in original order
            remaining = block_ids - set(result)
            result.extend(sorted(remaining, key=sort_key))

        return result


def _strip_magic_syntax(source: str) -> str:
    """Strip IPython magic/shell syntax so ast.parse() can analyze the rest."""
    lines = source.strip().split("\n")
    if not lines:
        return source

    first = lines[0].strip()

    # Cell magics: %%bash, %%time, etc. — skip the whole block or the magic line
    if first.startswith("%%"):
        magic = first.split()[0][2:]
        if magic in ("bash", "sh"):
            return ""  # Entire block is shell, no Python to analyze
        # %%time — analyze body
        return "\n".join(lines[1:])

    # Shell commands: !pip install foo — remove those lines
    # Line magics: %matplotlib inline — remove those lines
    filtered = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("!") or (stripped.startswith("%") and not stripped.startswith("%%")):
            continue
        filtered.append(line)
    return "\n".join(filtered)


def analyze_block(block_id: str, source: str) -> BlockAnalysis:
    """Analyze a code block's variable reads and writes."""
    analysis = BlockAnalysis(block_id=block_id)

    source = _strip_magic_syntax(source)
    if not source.strip():
        return analysis

    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError:
        return analysis

    visitor = _VariableVisitor(analysis)
    visitor.visit(tree)

    # Remove builtins from reads
    analysis.reads -= BUILTIN_NAMES
    # Remove self-defined variables from reads (defined before use)
    # We keep reads that are NOT in writes for cross-block dependencies
    # But we keep all reads because order within a block matters less
    # than cross-block dependencies.

    return analysis


class _VariableVisitor(ast.NodeVisitor):
    """AST visitor that extracts variable reads and writes."""

    def __init__(self, analysis: BlockAnalysis) -> None:
        self.analysis = analysis
        self._local_scopes: list[set[str]] = []  # Stack for function/class scopes

    @property
    def _in_local_scope(self) -> bool:
        return len(self._local_scopes) > 0

    def visit_Name(self, node: ast.Name) -> None:
        name = node.id
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            if self._in_local_scope:
                self._local_scopes[-1].add(name)
            else:
                self.analysis.writes.add(name)
        elif isinstance(node.ctx, ast.Load):
            if not self._in_local_scope:
                self.analysis.reads.add(name)
            elif name not in self._local_scopes[-1]:
                # Reading a variable not defined in local scope
                # could be a module-level dependency
                self.analysis.reads.add(name)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            name = alias.asname or alias.name.split(".")[0]
            self.analysis.writes.add(name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            if alias.name == "*":
                self.analysis.has_dynamic_constructs = True
                self.analysis.dynamic_warnings.append(
                    f"Block {self.analysis.block_id}: 'from ... import *' "
                    "may break reactive execution"
                )
            else:
                name = alias.asname or alias.name
                self.analysis.writes.add(name)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if not self._in_local_scope:
            self.analysis.writes.add(node.name)
        # Visit decorators in current scope
        for decorator in node.decorator_list:
            self.visit(decorator)
        # Visit defaults in current scope
        for default in node.args.defaults:
            self.visit(default)
        for default in node.args.kw_defaults:
            if default:
                self.visit(default)
        # Visit body in new local scope
        self._local_scopes.append(set())
        # Add parameter names to local scope
        for arg in node.args.args + node.args.posonlyargs + node.args.kwonlyargs:
            self._local_scopes[-1].add(arg.arg)
        if node.args.vararg:
            self._local_scopes[-1].add(node.args.vararg.arg)
        if node.args.kwarg:
            self._local_scopes[-1].add(node.args.kwarg.arg)
        for stmt in node.body:
            self.visit(stmt)
        self._local_scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if not self._in_local_scope:
            self.analysis.writes.add(node.name)
        for decorator in node.decorator_list:
            self.visit(decorator)
        for base in node.bases:
            self.visit(base)
        # Visit body in new scope
        self._local_scopes.append(set())
        for stmt in node.body:
            self.visit(stmt)
        self._local_scopes.pop()

    def visit_For(self, node: ast.For) -> None:
        # Target is a write
        self._visit_target(node.target)
        self.visit(node.iter)
        for stmt in node.body:
            self.visit(stmt)
        for stmt in node.orelse:
            self.visit(stmt)

    def visit_comprehension(self, node: ast.comprehension) -> None:
        # Comprehension variables are local in Python 3
        self.visit(node.iter)
        for if_ in node.ifs:
            self.visit(if_)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        # Comprehensions have their own scope in Python 3
        self._local_scopes.append(set())
        for gen in node.generators:
            self._visit_target(gen.target)
            self.visit(gen.iter)
            for if_ in gen.ifs:
                self.visit(if_)
        self.visit(node.elt)
        self._local_scopes.pop()

    visit_SetComp = visit_ListComp
    visit_GeneratorExp = visit_ListComp

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._local_scopes.append(set())
        for gen in node.generators:
            self._visit_target(gen.target)
            self.visit(gen.iter)
            for if_ in gen.ifs:
                self.visit(if_)
        self.visit(node.key)
        self.visit(node.value)
        self._local_scopes.pop()

    def visit_Call(self, node: ast.Call) -> None:
        # Check for dynamic constructs
        if isinstance(node.func, ast.Name) and node.func.id in DYNAMIC_CALLS:
            self.analysis.has_dynamic_constructs = True
            self.analysis.dynamic_warnings.append(
                f"Block {self.analysis.block_id}: '{node.func.id}()' "
                "may break reactive execution"
            )
        self.generic_visit(node)

    def visit_Global(self, node: ast.Global) -> None:
        self.analysis.has_dynamic_constructs = True
        self.analysis.dynamic_warnings.append(
            f"Block {self.analysis.block_id}: 'global' statement "
            "may break reactive execution"
        )

    def _visit_target(self, target: ast.AST) -> None:
        """Visit an assignment target (handles tuple unpacking, etc.)."""
        if isinstance(target, ast.Name):
            if self._in_local_scope:
                self._local_scopes[-1].add(target.id)
            else:
                self.analysis.writes.add(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for elt in target.elts:
                self._visit_target(elt)
        elif isinstance(target, ast.Starred):
            self._visit_target(target.value)
