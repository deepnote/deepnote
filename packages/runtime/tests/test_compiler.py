"""Tests for the code compiler and executor."""

import pytest

from deepnote_runtime.compiler import (
    CodeCache,
    CompileError,
    compile_source,
    execute,
    has_top_level_await,
)


class TestCompileSource:
    def test_simple_code(self):
        code_obj = compile_source("x = 1")
        assert code_obj is not None

    def test_empty_source(self):
        code_obj = compile_source("")
        assert code_obj is not None

    def test_whitespace_only(self):
        code_obj = compile_source("   \n  \n")
        assert code_obj is not None

    def test_syntax_error(self):
        with pytest.raises(CompileError):
            compile_source("def f(:")

    def test_multiline(self):
        code_obj = compile_source("x = 1\ny = 2\nz = x + y")
        assert code_obj is not None


class TestExecute:
    def test_simple_assignment(self):
        ns = {}
        execute("x = 42", ns)
        assert ns["x"] == 42

    def test_expression_result(self):
        ns = {"x": 10}
        result = execute("x * 2", ns)
        assert result == 20

    def test_print_no_result(self):
        ns = {}
        result = execute("print('hello')", ns)
        assert result is None

    def test_multi_statement_with_expression(self):
        ns = {}
        result = execute("x = 10\ny = 20\nx + y", ns)
        assert result == 30
        assert ns["x"] == 10
        assert ns["y"] == 20

    def test_multi_statement_no_expression(self):
        ns = {}
        result = execute("x = 10\ny = 20", ns)
        assert result is None
        assert ns["x"] == 10
        assert ns["y"] == 20

    def test_empty_source(self):
        ns = {}
        result = execute("", ns)
        assert result is None

    def test_whitespace_source(self):
        ns = {}
        result = execute("  \n  ", ns)
        assert result is None

    def test_import(self):
        ns = {}
        execute("import os", ns)
        import os
        assert ns["os"] is os

    def test_function_def_and_call(self):
        ns = {}
        result = execute("def add(a, b): return a + b\nadd(3, 4)", ns)
        assert result == 7

    def test_exception_propagates(self):
        ns = {}
        with pytest.raises(ZeroDivisionError):
            execute("1 / 0", ns)

    def test_name_error(self):
        ns = {}
        with pytest.raises(NameError):
            execute("undefined_var", ns)

    def test_compile_error(self):
        ns = {}
        with pytest.raises(CompileError):
            execute("def f(:", ns)

    def test_namespace_persistence(self):
        ns = {}
        execute("x = 1", ns)
        execute("y = x + 1", ns)
        assert ns["y"] == 2

    def test_list_comprehension(self):
        ns = {}
        result = execute("[x**2 for x in range(5)]", ns)
        assert result == [0, 1, 4, 9, 16]

    def test_class_definition(self):
        ns = {}
        execute("class Foo:\n    val = 42", ns)
        assert ns["Foo"].val == 42


class TestTopLevelAwait:
    def test_no_await(self):
        assert not has_top_level_await("x = 1")

    def test_with_await(self):
        assert has_top_level_await("import asyncio\nawait asyncio.sleep(0)")

    def test_await_in_function_is_not_top_level(self):
        # await inside an async def is NOT top-level await
        source = "async def f():\n    await something()"
        assert not has_top_level_await(source)

    def test_top_level_async_for(self):
        source = "async for item in aiter:\n    print(item)"
        assert has_top_level_await(source)

    def test_syntax_error_returns_false(self):
        assert not has_top_level_await("def f(:")

    def test_async_execute(self):
        ns = {}
        execute("import asyncio\nresult = await asyncio.sleep(0, result=42)", ns)
        assert ns["result"] == 42


class TestCodeCache:
    def test_cache_hit(self):
        cache = CodeCache()
        c1 = cache.get_or_compile("x = 1")
        c2 = cache.get_or_compile("x = 1")
        assert c1 is c2

    def test_cache_miss(self):
        cache = CodeCache()
        c1 = cache.get_or_compile("x = 1")
        c2 = cache.get_or_compile("x = 2")
        assert c1 is not c2

    def test_cache_len(self):
        cache = CodeCache()
        cache.get_or_compile("x = 1")
        cache.get_or_compile("x = 2")
        cache.get_or_compile("x = 1")  # duplicate
        assert len(cache) == 2

    def test_cache_clear(self):
        cache = CodeCache()
        cache.get_or_compile("x = 1")
        cache.clear()
        assert len(cache) == 0
