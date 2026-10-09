"""A Streamlit app that runs a notebook with inputs from a local `.deepnote` file."""

import os
from pathlib import Path

import streamlit as st
from _sales_dashboard import render_sales_dashboard
from deepnote_toolkit.notebooks import (
    DeepnoteDocument,
    DeepnoteLocalRunner,
    RunnerError,
    RunnerInfo,
    RunResult,
)
from deepnote_toolkit.streamlit import StreamlitCloudRunner, render_inputs

HERE = Path(__file__).resolve().parent
NOTEBOOK = HERE.parent / "local-runner-showcase.deepnote"
RUNNER_URL = os.environ.get("DEEPNOTE_RUNNER_URL")
NOTEBOOK_ID = os.environ.get("DEEPNOTE_NOTEBOOK_ID")
TOKEN = os.environ.get("DEEPNOTE_TOKEN")
# Deepnote sets DEEPNOTE_PROJECT_ID for hosted apps, which run as the viewer.
HOSTED = bool(os.environ.get("DEEPNOTE_PROJECT_ID"))


def runner_info() -> RunnerInfo:
    """Ask the runner once per session, not on every widget change."""

    if "deepnote_runner_info" not in st.session_state:
        st.session_state.deepnote_runner_info = runner.info()
    return st.session_state.deepnote_runner_info


def failure_message(result: RunResult) -> str:
    """The run's error, or the first error output when the runner reports none."""

    if result.error:
        return result.error
    for output in result.outputs:
        if output.output_type == "error":
            return f"{output.raw.get('ename', 'Error')}: {output.raw.get('evalue', '')}"
    return f"Run ended with status {result.status or 'failed'}."


st.set_page_config(
    page_title="Dynamic Deepnote app · Streamlit", page_icon="◆", layout="wide"
)

notebook = DeepnoteDocument.load(NOTEBOOK)
if RUNNER_URL:
    runner = DeepnoteLocalRunner(RUNNER_URL)
elif NOTEBOOK_ID:
    runner = StreamlitCloudRunner(NOTEBOOK_ID, local=True, token=TOKEN)
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
    can_run = False

    if runner is None:
        st.warning(
            "Set NOTEBOOK_ID in this file for hosted runs. For local runs, set "
            "DEEPNOTE_NOTEBOOK_ID and DEEPNOTE_TOKEN, or DEEPNOTE_RUNNER_URL for a "
            "runner process."
        )
    else:
        try:
            info = runner_info()
            target_label = (
                "Deepnote Cloud" if info.run_target == "cloud" else "a local kernel"
            )
            can_run = info.matches_inputs(notebook.inputs)
            if can_run:
                st.success(f"Connected to {target_label}")
            else:
                st.warning(
                    "The notebook's inputs don't match the app's `.deepnote` file. "
                    "Push the file with `deepnote run --cloud --push`, or set "
                    "NOTEBOOK_ID to the notebook that matches it. Then reload the "
                    "page."
                )
        except RunnerError as error:
            if NOTEBOOK_ID and not RUNNER_URL and not TOKEN and not HOSTED:
                st.warning("Set DEEPNOTE_TOKEN to a Deepnote API token for local runs.")
            else:
                st.warning(str(error))

    st.header("Inputs")
    values = render_inputs(notebook.inputs, st.sidebar)
    run_clicked = st.button(
        "Run notebook", type="primary", width="stretch", disabled=not can_run
    )

if run_clicked:
    try:
        with st.spinner(f"Running in {target_label}…"):
            st.session_state.deepnote_result = runner.run(values)
            st.session_state.deepnote_inputs = values
    except RunnerError as error:
        st.session_state.pop("deepnote_result", None)
        st.session_state.pop("deepnote_inputs", None)
        # The notebook may have changed since the session started, so check it again.
        st.session_state.pop("deepnote_runner_info", None)
        st.error(str(error))

result = st.session_state.get("deepnote_result")
if result is None:
    if can_run:
        st.info("Edit the inputs and run the notebook to populate this dashboard.")
    else:
        st.info("This app can't run the notebook yet. The sidebar says why.")
else:
    if result.success:
        st.success("Run completed.")
    else:
        st.error(failure_message(result))
    if result.view_url:
        st.link_button("Open run in Deepnote", result.view_url)
    render_sales_dashboard(result, st.session_state.deepnote_inputs)
