"""Map Deepnote input blocks to native Streamlit widgets."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Any

from .document import InputBlock


def render_inputs(
    inputs: Iterable[InputBlock], container: Any = None, *, key_prefix: str = "deepnote"
) -> dict[str, Any]:
    """Render input blocks and return API-ready values keyed by variable name.

    `container` may be `st`, `st.sidebar`, or a fake with the same widget methods for tests. When it
    is omitted, Streamlit is imported lazily so parsing and API clients work without the app extra.
    """

    if container is None:
        import streamlit as container

    values: dict[str, Any] = {}
    for input_block in inputs:
        label = input_block.label or input_block.variable_name.replace("_", " ").title()
        key = f"{key_prefix}:{input_block.variable_name}"
        values[input_block.variable_name] = _render_one(container, input_block, label, key)
    return values


def _render_one(container: Any, input_block: InputBlock, label: str, key: str) -> Any:
    if input_block.type == "input-checkbox":
        return container.checkbox(label, value=_as_bool(input_block.value), key=key)

    if input_block.type == "input-select":
        options = list(input_block.options)
        if input_block.multiple:
            defaults = input_block.value if isinstance(input_block.value, list) else []
            return container.multiselect(label, options, default=defaults, key=key)
        index = options.index(str(input_block.value)) if str(input_block.value) in options else 0
        return container.selectbox(label, options, index=index, key=key) if options else ""

    if input_block.type == "input-slider":
        minimum = input_block.min if input_block.min is not None else 0
        maximum = input_block.max if input_block.max is not None else 100
        step = input_block.step if input_block.step is not None else 1
        value = _as_number(input_block.value, minimum)
        if any(isinstance(number, float) for number in (minimum, maximum, value, step)):
            minimum, maximum, value, step = (float(number) for number in (minimum, maximum, value, step))
        return container.slider(label, min_value=minimum, max_value=maximum, value=value, step=step, key=key)

    if input_block.type == "input-date":
        return _serialize_date(container.date_input(label, value=_as_date(input_block.value), key=key))

    if input_block.type == "input-date-range":
        raw = input_block.value if isinstance(input_block.value, list) else []
        defaults = tuple(_as_date(value) for value in raw[:2])
        selected = container.date_input(label, value=defaults, key=key)
        if isinstance(selected, (list, tuple)):
            serialized = [_serialize_date(value) for value in selected]
            if len(serialized) == 2:
                return serialized
            if len(serialized) == 1:
                return [serialized[0], serialized[0]]
            fallback = [_serialize_date(value) for value in defaults]
            return fallback if len(fallback) == 2 else [date.today().isoformat()] * 2
        return [_serialize_date(selected), _serialize_date(selected)]

    if input_block.type == "input-textarea":
        return container.text_area(label, value=str(input_block.value or ""), key=key)

    return container.text_input(label, value=str(input_block.value or ""), key=key)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"true", "1"}


def _as_number(value: Any, fallback: float | int) -> float | int:
    try:
        number = float(value)
        return number if isinstance(fallback, float) or not number.is_integer() else int(number)
    except (TypeError, ValueError):
        return fallback


def _as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return date.today()


def _serialize_date(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)
