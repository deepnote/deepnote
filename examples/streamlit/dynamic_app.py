"""A Streamlit app that runs a notebook with inputs from a local `.deepnote` file."""

import os
from pathlib import Path

import streamlit as st
from _sales_dashboard import render_sales_dashboard
from deepnote_toolkit.notebooks import (
    DeepnoteDocument,
    DeepnoteLocalRunner,
    RunnerError,
)
from deepnote_toolkit.streamlit import StreamlitCloudRunner, render_inputs

HERE = Path(__file__).resolve().parent
NOTEBOOK = HERE.parent / "local-runner-showcase.deepnote"
RUNNER_URL = os.environ.get("DEEPNOTE_RUNNER_URL")
NOTEBOOK_ID = os.environ.get("DEEPNOTE_NOTEBOOK_ID")

st.set_page_config(
    page_title="Dynamic Deepnote app · Streamlit", page_icon="◆", layout="wide"
)

notebook = DeepnoteDocument.load(NOTEBOOK)
if RUNNER_URL:
    runner = DeepnoteLocalRunner(RUNNER_URL)
elif NOTEBOOK_ID:
    runner = StreamlitCloudRunner(
        NOTEBOOK_ID, local=True, token=os.environ.get("DEEPNOTE_TOKEN")
    )
else:
    runner = None

st.caption("DYNAMIC · local .deepnote file · runs in Deepnote Cloud or a local kernel")
st.title(notebook.project_name)
st.write(
    "The controls come from the notebook's input blocks. When Deepnote hosts this "
    "app, the notebook runs as the current viewer. When you run the app locally, it "
    "uses an API token or a runner process."
)

with st.sidebar:
    st.header("Inputs")
    values = render_inputs(notebook.inputs, st.sidebar)
    input_contract_matches = False

    if runner is None:
        info = None
        st.warning(
            "Set NOTEBOOK_ID in this file for hosted runs. For local runs, set "
            "DEEPNOTE_NOTEBOOK_ID and DEEPNOTE_TOKEN, or DEEPNOTE_RUNNER_URL for a "
            "runner process."
        )
    else:
        try:
            info = runner.info()
            target_label = (
                "Deepnote Cloud" if info.run_target == "cloud" else "a local kernel"
            )
            input_contract_matches = info.matches_inputs(notebook.inputs)
            if input_contract_matches:
                st.success(f"Connected to {target_label}")
            else:
                st.warning(
                    "The notebook's inputs don't match the app's `.deepnote` file. "
                    "Push the file with `deepnote run --cloud --push`, or set "
                    "NOTEBOOK_ID to the notebook that matches it."
                )
        except RunnerError as error:
            info = None
            st.warning(str(error))

    run_clicked = st.button(
        "Run notebook",
        type="primary",
        width="stretch",
        disabled=info is None or not input_contract_matches,
    )

if run_clicked:
    try:
        with st.spinner(f"Running in {target_label}…"):
            st.session_state.deepnote_result = runner.run(values)
            st.session_state.deepnote_inputs = values
    except RunnerError as error:
        st.session_state.pop("deepnote_result", None)
        st.session_state.pop("deepnote_inputs", None)
        st.error(str(error))

result = st.session_state.get("deepnote_result")
if result is None:
    st.info("Edit the inputs and run the notebook to populate this dashboard.")
else:
    if result.success:
        st.success("Run completed.")
    else:
        st.error(result.error or f"Run ended with status {result.status or 'failed'}.")
    if result.view_url:
        st.link_button("Open run in Deepnote", result.view_url)
    render_sales_dashboard(result, st.session_state.deepnote_inputs)
