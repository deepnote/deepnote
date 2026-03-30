"""User namespace management.

Creates isolated namespaces for notebook execution, injects input
variables, and provides the display() builtin.
"""

from __future__ import annotations

import builtins
from typing import Any


def create_namespace(
    name: str = "__main__",
    input_variables: dict[str, Any] | None = None,
    display_fn: Any = None,
) -> dict[str, Any]:
    """Create a fresh namespace for code execution.

    Args:
        name: Module __name__ for the namespace.
        input_variables: Variables from input blocks to inject.
        display_fn: Custom display() function to inject.
    """
    ns: dict[str, Any] = {
        "__name__": name,
        "__doc__": None,
        "__builtins__": builtins,
    }

    # Inject display function
    if display_fn is not None:
        ns["display"] = display_fn

    # Inject input variables
    if input_variables:
        ns.update(input_variables)

    return ns


def inject_variables(
    namespace: dict[str, Any],
    variables: dict[str, Any],
) -> None:
    """Inject variables into an existing namespace."""
    namespace.update(variables)


def extract_user_variables(namespace: dict[str, Any]) -> dict[str, Any]:
    """Extract user-defined variables from a namespace.

    Filters out dunder names and builtins.
    """
    skip = {"__name__", "__doc__", "__builtins__", "display"}
    return {
        k: v
        for k, v in namespace.items()
        if not k.startswith("__") or k not in skip
        if k not in skip
    }
