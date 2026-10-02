"""A Streamlit app that shows the outputs saved in a Deepnote snapshot."""

from pathlib import Path

import streamlit as st
from _sales_dashboard import render_sales_dashboard, values_by_name
from deepnote_toolkit.notebooks import DeepnoteDocument

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE.parent / "snapshot-showcase.snapshot.deepnote"

st.set_page_config(
    page_title="Static Deepnote app · Streamlit", page_icon="◆", layout="wide"
)

snapshot = DeepnoteDocument.load(SNAPSHOT)

st.caption("STATIC · saved .deepnote snapshot · no kernel or API calls")
st.title(snapshot.project_name)
st.write(
    "This app reads the outputs saved in a Deepnote snapshot. The notebook provides "
    "the data, and the layout is ordinary Streamlit code."
)

with st.sidebar:
    st.header("Saved inputs")
    for input_block in snapshot.inputs:
        st.text(
            f"{input_block.label or input_block.variable_name}: {input_block.value}"
        )

render_sales_dashboard(snapshot, values_by_name(snapshot))
