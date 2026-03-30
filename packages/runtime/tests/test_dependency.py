"""Tests for AST-based dependency analysis."""

from deepnote_runtime.dependency import (
    DependencyGraph,
    analyze_block,
)


class TestAnalyzeBlock:
    def test_simple_assignment(self):
        analysis = analyze_block("b1", "x = 1")
        assert "x" in analysis.writes
        assert len(analysis.reads) == 0

    def test_simple_read(self):
        analysis = analyze_block("b1", "print(x)")
        # print is a builtin, filtered out
        assert "x" in analysis.reads
        assert "print" not in analysis.reads

    def test_read_and_write(self):
        analysis = analyze_block("b1", "y = x + 1")
        assert "x" in analysis.reads
        assert "y" in analysis.writes

    def test_import(self):
        analysis = analyze_block("b1", "import os")
        assert "os" in analysis.writes

    def test_from_import(self):
        analysis = analyze_block("b1", "from os.path import join")
        assert "join" in analysis.writes

    def test_from_import_as(self):
        analysis = analyze_block("b1", "from os.path import join as j")
        assert "j" in analysis.writes
        assert "join" not in analysis.writes

    def test_import_star_warning(self):
        analysis = analyze_block("b1", "from os import *")
        assert analysis.has_dynamic_constructs
        assert len(analysis.dynamic_warnings) > 0

    def test_function_def_writes_name(self):
        analysis = analyze_block("b1", "def foo(x):\n    return x + 1")
        assert "foo" in analysis.writes
        # x is a parameter, should be in local scope, not module reads
        assert "x" not in analysis.reads

    def test_function_reads_external(self):
        analysis = analyze_block("b1", "def foo():\n    return external_var")
        assert "foo" in analysis.writes
        assert "external_var" in analysis.reads

    def test_class_def_writes_name(self):
        analysis = analyze_block("b1", "class Foo:\n    pass")
        assert "Foo" in analysis.writes

    def test_class_with_base_reads(self):
        analysis = analyze_block("b1", "class Foo(Base):\n    pass")
        assert "Foo" in analysis.writes
        assert "Base" in analysis.reads

    def test_for_loop(self):
        analysis = analyze_block("b1", "for i in data:\n    print(i)")
        assert "i" in analysis.writes
        assert "data" in analysis.reads

    def test_tuple_unpacking(self):
        analysis = analyze_block("b1", "a, b = pair")
        assert "a" in analysis.writes
        assert "b" in analysis.writes
        assert "pair" in analysis.reads

    def test_eval_warning(self):
        analysis = analyze_block("b1", "result = eval('1 + 2')")
        assert analysis.has_dynamic_constructs
        assert any("eval" in w for w in analysis.dynamic_warnings)

    def test_exec_warning(self):
        analysis = analyze_block("b1", "exec('x = 1')")
        assert analysis.has_dynamic_constructs

    def test_global_warning(self):
        analysis = analyze_block("b1", "def f():\n    global x\n    x = 1")
        assert analysis.has_dynamic_constructs

    def test_comprehension_scope(self):
        """List comprehension variables should not leak to module scope in Python 3."""
        analysis = analyze_block("b1", "result = [x for x in data]")
        assert "result" in analysis.writes
        assert "data" in analysis.reads
        # 'x' inside comprehension is local

    def test_empty_source(self):
        analysis = analyze_block("b1", "")
        assert len(analysis.reads) == 0
        assert len(analysis.writes) == 0

    def test_syntax_error(self):
        analysis = analyze_block("b1", "def f(:")
        assert len(analysis.reads) == 0
        assert len(analysis.writes) == 0

    def test_decorator_reads(self):
        analysis = analyze_block("b1", "@decorator\ndef foo():\n    pass")
        assert "foo" in analysis.writes
        assert "decorator" in analysis.reads

    def test_multiline_complex(self):
        source = """
import math
data = [1, 2, 3]
total = sum(data)
avg = total / len(data)
result = math.sqrt(avg)
"""
        analysis = analyze_block("b1", source)
        assert "math" in analysis.writes
        assert "data" in analysis.writes
        assert "total" in analysis.writes
        assert "avg" in analysis.writes
        assert "result" in analysis.writes
        # sum, len are builtins - filtered
        assert "sum" not in analysis.reads
        assert "len" not in analysis.reads
        # data, total, avg are read within same block
        assert "data" in analysis.reads
        assert "total" in analysis.reads


class TestDependencyGraph:
    def _make_graph(self):
        """Create a simple graph: b1 writes x, b2 reads x writes y, b3 reads y."""
        graph = DependencyGraph()
        graph.add(analyze_block("b1", "x = 10"))
        graph.add(analyze_block("b2", "y = x + 1"))
        graph.add(analyze_block("b3", "z = y * 2"))
        return graph

    def test_dependencies(self):
        graph = self._make_graph()
        assert graph.get_dependencies("b2") == {"b1"}
        assert graph.get_dependencies("b3") == {"b2"}
        assert graph.get_dependencies("b1") == set()

    def test_dependents(self):
        graph = self._make_graph()
        assert graph.get_dependents("b1") == {"b2"}
        assert graph.get_dependents("b2") == {"b3"}
        assert graph.get_dependents("b3") == set()

    def test_topological_sort(self):
        graph = self._make_graph()
        order = graph.topological_sort()
        assert order.index("b1") < order.index("b2")
        assert order.index("b2") < order.index("b3")

    def test_topological_sort_subset(self):
        graph = self._make_graph()
        order = graph.topological_sort({"b2", "b3"})
        assert order.index("b2") < order.index("b3")

    def test_dirty_blocks(self):
        graph = self._make_graph()
        dirty = graph.get_dirty_blocks({"x"})
        # b2 reads x, b3 reads y (which b2 writes)
        assert "b2" in dirty
        assert "b3" in dirty
        assert "b1" not in dirty

    def test_dirty_blocks_leaf(self):
        graph = self._make_graph()
        dirty = graph.get_dirty_blocks({"y"})
        assert "b3" in dirty
        assert "b2" not in dirty  # b2 doesn't read y, it writes y
        assert "b1" not in dirty

    def test_independent_blocks(self):
        graph = DependencyGraph()
        graph.add(analyze_block("b1", "x = 1"))
        graph.add(analyze_block("b2", "y = 2"))
        assert graph.get_dependencies("b1") == set()
        assert graph.get_dependencies("b2") == set()

    def test_cycle_handling(self):
        """Cycles should not cause infinite loops."""
        graph = DependencyGraph()
        graph.add(analyze_block("b1", "x = y"))
        graph.add(analyze_block("b2", "y = x"))
        # Should complete without hanging
        order = graph.topological_sort()
        assert set(order) == {"b1", "b2"}
