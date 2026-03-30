"""Tests for reactive execution engine."""

import pytest

from deepnote_runtime.models import Block, BlockType, ExecutionMode, Notebook
from deepnote_runtime.reactive import ReactiveEngine


def _make_notebook(blocks, execution_mode=ExecutionMode.BLOCK):
    return Notebook(
        id="test-nb",
        name="Test",
        blocks=blocks,
        execution_mode=execution_mode,
    )


def _code_block(id, content, sorting_key="a0"):
    return Block(
        id=id,
        type=BlockType.CODE,
        content=content,
        sorting_key=sorting_key,
    )


def _input_block(id, var_name, var_value, sorting_key="a0"):
    return Block(
        id=id,
        type=BlockType.INPUT_TEXT,
        sorting_key=sorting_key,
        metadata={
            "deepnote_variable_name": var_name,
            "deepnote_variable_value": var_value,
        },
    )


class TestReactiveEngine:
    def test_simple_execution(self):
        nb = _make_notebook([
            _code_block("b1", "x = 42", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        assert len(result.block_results) == 1
        assert result.block_results[0].success
        assert result.namespace["x"] == 42

    def test_multi_block_sequential(self):
        nb = _make_notebook([
            _code_block("b1", "x = 10", "a0"),
            _code_block("b2", "y = x + 5", "a1"),
            _code_block("b3", "z = y * 2", "a2"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        assert result.namespace["x"] == 10
        assert result.namespace["y"] == 15
        assert result.namespace["z"] == 30

    def test_dependency_order(self):
        """Blocks should execute in dependency order even if sorting keys differ."""
        nb = _make_notebook([
            _code_block("b2", "y = x + 1", "a1"),
            _code_block("b1", "x = 10", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        assert result.namespace["y"] == 11

    def test_execution_count_increments(self):
        nb = _make_notebook([
            _code_block("b1", "x = 1", "a0"),
            _code_block("b2", "y = 2", "a1"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.block_results[0].execution_count == 1
        assert result.block_results[1].execution_count == 2

    def test_stdout_captured(self):
        nb = _make_notebook([
            _code_block("b1", 'print("hello")', "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        outputs = result.block_results[0].outputs
        stream_outputs = [o for o in outputs if o.output_type == "stream"]
        assert len(stream_outputs) == 1
        assert stream_outputs[0].text == "hello\n"

    def test_expression_result_captured(self):
        nb = _make_notebook([
            _code_block("b1", "42", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        outputs = result.block_results[0].outputs
        result_outputs = [o for o in outputs if o.output_type == "execute_result"]
        assert len(result_outputs) == 1
        assert result_outputs[0].data["text/plain"] == "42"

    def test_error_captured(self):
        nb = _make_notebook([
            _code_block("b1", "1 / 0", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert not result.success
        outputs = result.block_results[0].outputs
        error_outputs = [o for o in outputs if o.output_type == "error"]
        assert len(error_outputs) == 1
        assert error_outputs[0].ename == "ZeroDivisionError"

    def test_stop_on_error(self):
        nb = _make_notebook([
            _code_block("b1", "x = 1", "a0"),
            _code_block("b2", "1 / 0", "a1"),
            _code_block("b3", "y = 2", "a2"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb, stop_on_error=True)

        assert not result.success
        # b3 should NOT have been executed
        assert len(result.block_results) == 2

    def test_continue_on_error(self):
        nb = _make_notebook([
            _code_block("b1", "x = 1", "a0"),
            _code_block("b2", "1 / 0", "a1"),
            _code_block("b3", "y = 2", "a2"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb, stop_on_error=False)

        assert not result.success
        # All 3 blocks should have been attempted
        assert len(result.block_results) == 3
        assert result.block_results[2].success

    def test_input_variables(self):
        nb = _make_notebook([
            _input_block("i1", "name", "World", "a0"),
            _code_block("b1", 'greeting = f"Hello, {name}!"', "a1"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        assert result.namespace["greeting"] == "Hello, World!"

    def test_input_override_from_cli(self):
        nb = _make_notebook([
            _input_block("i1", "name", "World", "a0"),
            _code_block("b1", 'greeting = f"Hello, {name}!"', "a1"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb, input_variables={"name": "Claude"})

        assert result.success
        assert result.namespace["greeting"] == "Hello, Claude!"

    def test_display_function_available(self):
        nb = _make_notebook([
            _code_block("b1", "display({'key': 'value'})", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        outputs = result.block_results[0].outputs
        display_outputs = [o for o in outputs if o.output_type == "display_data"]
        assert len(display_outputs) == 1

    def test_duration_tracked(self):
        nb = _make_notebook([
            _code_block("b1", "x = sum(range(100))", "a0"),
        ])
        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.block_results[0].duration_ms >= 0


class TestReactiveReExecution:
    def test_re_execute_on_variable_change(self):
        nb = _make_notebook([
            _input_block("i1", "x", 10, "a0"),
            _code_block("b1", "y = x * 2", "a1"),
            _code_block("b2", "z = 100", "a2"),
        ])
        engine = ReactiveEngine()
        engine.execute_notebook(nb)

        # Now change x and re-execute
        engine._namespace["x"] = 20
        result = engine.re_execute({"x"}, nb)

        # Only b1 should re-execute (it reads x), not b2
        assert len(result.block_results) == 1
        assert result.block_results[0].block_id == "b1"
        assert result.namespace["y"] == 40

    def test_transitive_re_execution(self):
        nb = _make_notebook([
            _input_block("i1", "x", 10, "a0"),
            _code_block("b1", "y = x + 1", "a1"),
            _code_block("b2", "z = y + 1", "a2"),
        ])
        engine = ReactiveEngine()
        engine.execute_notebook(nb)

        # Change x — both b1 (reads x) and b2 (reads y, which b1 writes) should re-run
        engine._namespace["x"] = 20
        result = engine.re_execute({"x"}, nb)

        assert len(result.block_results) == 2
        assert result.namespace["y"] == 21
        assert result.namespace["z"] == 22

    def test_no_re_execution_if_unrelated(self):
        nb = _make_notebook([
            _code_block("b1", "x = 1", "a0"),
            _code_block("b2", "y = 2", "a1"),
        ])
        engine = ReactiveEngine()
        engine.execute_notebook(nb)

        # Change a variable that nobody reads
        result = engine.re_execute({"unrelated"}, nb)
        assert len(result.block_results) == 0
