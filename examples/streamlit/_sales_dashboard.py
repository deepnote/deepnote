"""The dashboard layout shared by the static and dynamic Streamlit examples."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import streamlit as st

INDEX_COLUMN = "_deepnote_index_column"


def render_sales_dashboard(outputs: Any, inputs: Mapping[str, Any]) -> None:
    dataframe = outputs.first_dataframe()
    if dataframe is None:
        st.info("This run produced no dataframe output.")
        return

    rows = dataframe.records()
    total_revenue = sum(float(row.get("Revenue ($k)", 0)) for row in rows) * 1_000
    months = _number(inputs.get("trailing_months"), 1)
    target = _number(inputs.get("target_revenue_k"), 0) * months * 1_000
    attainment = total_revenue / target if target else 0
    top_row = max(rows, key=lambda row: float(row.get("Revenue ($k)", 0)), default={})
    top_region = str(top_row.get(INDEX_COLUMN, "—"))

    revenue, target_card, region = st.columns(3)
    revenue.metric("Revenue", f"${total_revenue:,.0f}")
    target_card.metric(
        "Target attainment",
        f"{attainment:.1%}",
        f"{attainment - 1:+.1%} vs target",
        help=f"Target: ${target:,.0f}",
    )
    region.metric("Top region", top_region)

    st.subheader("Revenue by region")
    # Name the column instead of passing x_label, which older Streamlit releases put on
    # the other axis of a horizontal chart.
    chart_rows = [
        {"Region": row.get(INDEX_COLUMN), "Revenue ($k)": row.get("Revenue ($k)")}
        for row in rows
    ]
    st.bar_chart(chart_rows, x="Region", y="Revenue ($k)", horizontal=True)
    st.dataframe(
        rows, hide_index=True, width="stretch", column_config={INDEX_COLUMN: "Region"}
    )

    for image in outputs.images():
        st.image(image, width="stretch")

    if readout := outputs.agent_text():
        st.subheader("Agent analysis")
        # Escape dollar signs so Streamlit doesn't render amounts as LaTeX.
        st.markdown(readout.replace("$", r"\$"))


def values_by_name(document: Any) -> dict[str, Any]:
    return {
        input_block.variable_name: input_block.value for input_block in document.inputs
    }


def _number(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback
