"""A Streamlit app that edits and runs a local `.deepnote` notebook."""

import os
from pathlib import Path

import streamlit as st
from _sales_dashboard import render_sales_dashboard
from deepnote_toolkit.streamlit import (
    DeepnoteCloudRunner,
    DeepnoteDocument,
    DeepnoteRunner,
    RunnerError,
    render_inputs,
)

HERE = Path(__file__).resolve().parent
NOTEBOOK = HERE.parent / "local-runner-showcase.deepnote"
RUNNER_URL = os.environ.get("DEEPNOTE_RUNNER_URL")
NOTEBOOK_ID = os.environ.get("DEEPNOTE_NOTEBOOK_ID")

st.set_page_config(
    page_title="Deepnote run app · Streamlit", page_icon="◆", layout="wide"
)

notebook = DeepnoteDocument.load(NOTEBOOK)
if RUNNER_URL:
    runner = DeepnoteRunner(RUNNER_URL)
elif NOTEBOOK_ID:
    runner = DeepnoteCloudRunner(NOTEBOOK_ID)
else:
    runner = None

st.caption("DYNAMIC · local .deepnote source · viewer-scoped cloud run or local kernel")
st.title(notebook.project_name)
st.write(
    "The controls come from the notebook's input blocks. The hosted runner calls the public API "
    "as the current viewer; local development can use an API token or a runner sidecar."
)

with st.sidebar:
    st.header("Inputs")
    values = render_inputs(notebook.inputs, st.sidebar)
    input_contract_matches = False

    if runner is None:
        info = None
        st.warning(
            "Set DEEPNOTE_NOTEBOOK_ID for a hosted or API-token run, or "
            "DEEPNOTE_RUNNER_URL for sidecar-based local development."
        )
    else:
        try:
            info = runner.info()
            target_label = (
                "Deepnote Cloud" if info.run_target == "cloud" else "a local kernel"
            )
            input_contract_matches = info.accepts_inputs(notebook.inputs)
            if input_contract_matches:
                st.success(f"Runner connected · {target_label}")
            else:
                st.warning(
                    "The runner notebook has different input names or types. "
                    "Sync this file with `deepnote run --cloud --push`, or point "
                    "DEEPNOTE_NOTEBOOK_ID at the notebook represented by this file."
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
        st.error(str(error))

result = st.session_state.get("deepnote_result")
if result is None:
    st.info("Edit the inputs and run the notebook to populate this dashboard.")
else:
    if result.success:
        st.success(f"Run completed in {result.target}.")
    else:
        st.error(result.error or f"Run ended with status {result.status or 'failed'}.")
    if result.view_url:
        st.link_button("Open run in Deepnote", result.view_url)
    render_sales_dashboard(result, st.session_state.get("deepnote_inputs", values))
