"""Pricing scenario planner: what moving legacy accounts to the 2026 price list does to ARR.

The "Pricing baseline" notebook writes baseline.json on a schedule from the governed revenue
modules. This app only models on top of it, so its starting numbers match every other app.
"""

import json
import os
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

st.set_page_config(page_title="Pricing scenario planner", layout="wide")

BASELINE = Path(os.environ.get("PRICING_BASELINE_PATH", Path(__file__).with_name("baseline.json")))
if not BASELINE.exists():
    st.error(f"{BASELINE.name} is missing. Run the Pricing baseline notebook first.")
    st.stop()

baseline = json.loads(BASELINE.read_text())
groups = pd.DataFrame(baseline["groups"])


def calibrated_sensitivity(frame):
    """Extra monthly churn per 1% price increase, from accounts already moved to the 2026 list (+8%)."""
    moved = frame[frame["price_plan"] == "2026 price list"].set_index("segment")["monthly_churn"]
    legacy = frame[frame["price_plan"] == "Legacy"].set_index("segment")["monthly_churn"]
    both = moved.index.intersection(legacy.index)
    return float(((moved[both] - legacy[both]) / 8).mean()) if len(both) else 0.0


st.title("Pricing scenario planner")
st.caption(
    f"Lindquett Software · baseline as of {baseline['as_of']} from the governed revenue modules · "
    "synthetic data for a fictional company"
)

with st.sidebar:
    st.header("Scenario")
    st.write("Price increase for legacy accounts when they renew")
    increases = {
        segment: st.slider(segment, 0, 20, 8 if segment != "Enterprise" else 0, format="%d%%")
        for segment in ["Enterprise", "Mid-market", "SMB"]
    }
    default_sensitivity = round(calibrated_sensitivity(groups) * 100, 3)
    sensitivity = st.number_input(
        "Extra monthly churn per 1% increase (points)",
        min_value=0.0,
        max_value=0.5,
        value=default_sensitivity,
        step=0.005,
        format="%.3f",
        help="Defaults to what accounts already moved to the 2026 price list did.",
    ) / 100
    months = st.radio("Horizon", [12, 24], horizontal=True, format_func=lambda m: f"{m} months")


def project(frame, increase_for):
    rows = []
    for g in frame.itertuples():
        increase = increase_for(g) / 100
        arr = g.arr * (1 + increase)
        churn = g.monthly_churn + sensitivity * increase * 100
        net = 1 - churn - g.monthly_contraction + g.monthly_expansion
        for month in range(months + 1):
            rows.append({"month": month, "segment": g.segment, "price_plan": g.price_plan, "arr": arr * net**month})
    return pd.DataFrame(rows)


current = project(groups, lambda g: 0)
scenario = project(groups, lambda g: increases[g.segment] if g.price_plan == "Legacy" else 0)
total = lambda frame: frame.groupby("month")["arr"].sum()
end_current, end_scenario = total(current).iloc[-1], total(scenario).iloc[-1]

a, b, c = st.columns(3)
a.metric("ARR today", f"${groups['arr'].sum() / 1e6:,.1f}M")
b.metric(f"ARR in {months} months, prices unchanged", f"${end_current / 1e6:,.1f}M")
c.metric(
    f"ARR in {months} months, with the increase",
    f"${end_scenario / 1e6:,.1f}M",
    f"{(end_scenario - end_current) / 1e6:+,.2f}M vs unchanged",
)

lines = pd.concat([
    total(current).rename("Prices unchanged"),
    total(scenario).rename("With the increase"),
], axis=1).reset_index().melt("month", var_name="Scenario", value_name="ARR")
st.altair_chart(
    alt.Chart(lines).mark_line(strokeWidth=3).encode(
        x=alt.X("month:Q", title="Months from today"),
        y=alt.Y("ARR:Q", title="ARR ($)", scale=alt.Scale(zero=False), axis=alt.Axis(format="$,.2s")),
        color=alt.Color("Scenario:N", scale=alt.Scale(range=["#8a94a6", "#2f6fde"])),
        tooltip=["Scenario", "month", alt.Tooltip("ARR:Q", format="$,.0f")],
    ),
    width="stretch",
)

by_group = (
    scenario[scenario["month"] == months].set_index(["segment", "price_plan"])["arr"]
    - current[current["month"] == months].set_index(["segment", "price_plan"])["arr"]
).rename("ARR difference").reset_index()
table = groups.merge(by_group, on=["segment", "price_plan"])
st.subheader("By segment and price plan")
st.dataframe(
    table.assign(
        **{
            "ARR today": table["arr"].map(lambda v: f"${v / 1e3:,.0f}K"),
            "Monthly churn": table["monthly_churn"].map(lambda v: f"{v:.2%}"),
            f"Difference at {months} months": table["ARR difference"].map(lambda v: f"${v / 1e3:+,.0f}K"),
        }
    )[["segment", "price_plan", "accounts", "ARR today", "Monthly churn", f"Difference at {months} months"]],
    hide_index=True,
    width="stretch",
)
