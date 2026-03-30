"""Tests for namespace management."""

import builtins

from deepnote_runtime.namespace import (
    create_namespace,
    extract_user_variables,
    inject_variables,
)


class TestCreateNamespace:
    def test_default_namespace(self):
        ns = create_namespace()
        assert ns["__name__"] == "__main__"
        assert ns["__builtins__"] is builtins

    def test_custom_name(self):
        ns = create_namespace(name="test_module")
        assert ns["__name__"] == "test_module"

    def test_with_input_variables(self):
        ns = create_namespace(input_variables={"x": 10, "y": "hello"})
        assert ns["x"] == 10
        assert ns["y"] == "hello"

    def test_with_display_fn(self):
        fn = lambda obj: None
        ns = create_namespace(display_fn=fn)
        assert ns["display"] is fn

    def test_can_exec_code(self):
        ns = create_namespace()
        exec("x = 1 + 2", ns)
        assert ns["x"] == 3

    def test_builtins_available(self):
        ns = create_namespace()
        exec("result = len([1, 2, 3])", ns)
        assert ns["result"] == 3


class TestInjectVariables:
    def test_inject(self):
        ns = create_namespace()
        inject_variables(ns, {"foo": 42, "bar": "baz"})
        assert ns["foo"] == 42
        assert ns["bar"] == "baz"

    def test_override(self):
        ns = create_namespace(input_variables={"x": 1})
        inject_variables(ns, {"x": 2})
        assert ns["x"] == 2


class TestExtractUserVariables:
    def test_extract(self):
        ns = create_namespace()
        ns["x"] = 10
        ns["y"] = "hello"
        user_vars = extract_user_variables(ns)
        assert "x" in user_vars
        assert "y" in user_vars
        assert "__name__" not in user_vars
        assert "__builtins__" not in user_vars

    def test_skip_display(self):
        ns = create_namespace(display_fn=lambda x: None)
        ns["result"] = 42
        user_vars = extract_user_variables(ns)
        assert "display" not in user_vars
        assert "result" in user_vars
