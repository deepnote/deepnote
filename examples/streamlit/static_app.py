"""A zero-runner Streamlit app over a committed Deepnote snapshot."""

from pathlib import Path

import streamlit as st
from _sales_dashboard import render_sales_dashboard, values_by_name
from deepnote_streamlit import DeepnoteDocument

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE.parent / "snapshot-showcase.snapshot.deepnote"

st.set_page_config(
    page_title="Deepnote snapshot · Streamlit", page_icon="◆", layout="wide"
)

snapshot = DeepnoteDocument.load(SNAPSHOT)

st.caption("STATIC · local .deepnote snapshot · no kernel or API")
st.title(snapshot.project_name)
st.write(
    "This app reads structured outputs from a committed Deepnote snapshot. Its layout is custom "
    "Streamlit code; the notebook is the data contract, not the presentation."
)

with st.sidebar:
    st.header("Run inputs")
    for input_block in snapshot.inputs:
        st.text(
            f"{input_block.label or input_block.variable_name}: {input_block.value}"
        )

render_sales_dashboard(snapshot, values_by_name(snapshot))
