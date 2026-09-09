"""Custom presentation shared by the static and dynamic Streamlit examples."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import streamlit as st
from deepnote_toolkit.streamlit import INDEX_COLUMN


def render_sales_dashboard(outputs: Any, inputs: Mapping[str, Any]) -> None:
    dataframe = outputs.first_dataframe()
    if dataframe is None:
        st.info("This run did not produce a structured dataframe output.")
        return

    rows = dataframe.records()
    total_revenue = sum(float(row.get("Revenue ($k)", 0)) for row in rows) * 1_000
    months = _number(inputs.get("trailing_months"), 1)
    target = _number(inputs.get("target_revenue_k"), 0) * months * 1_000
    attainment = total_revenue / target if target else 0
    top_region = str(rows[0].get(INDEX_COLUMN, "—")) if rows else "—"

    revenue, target_card, region = st.columns(3)
    revenue.metric("Revenue", f"${total_revenue:,.0f}")
    target_card.metric("To target", f"{attainment:.1%}", f"${target:,.0f} target")
    region.metric("Top region", top_region)

    st.subheader("Revenue by region")
    st.bar_chart(rows, x=INDEX_COLUMN, y="Revenue ($k)", horizontal=True)
    st.dataframe(rows, hide_index=True, width="stretch")

    for image in outputs.images():
        st.image(image, width="stretch")

    if readout := outputs.agent_text():
        st.subheader("Agentic analysis")
        st.markdown(readout)


def values_by_name(document: Any) -> dict[str, Any]:
    return {
        input_block.variable_name: input_block.value for input_block in document.inputs
    }


def _number(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback
