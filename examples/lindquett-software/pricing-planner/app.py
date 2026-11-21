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
from packaging.version import Version

# `width="stretch"` arrived in Streamlit 1.49 for `st.dataframe` but only in 1.51 for `st.altair_chart`;
# older images still take `use_container_width` and reject `width` outright.
_STREAMLIT = Version(st.__version__)
WIDE_TABLE = {"width": "stretch"} if _STREAMLIT >= Version("1.49") else {"use_container_width": True}
WIDE_CHART = {"width": "stretch"} if _STREAMLIT >= Version("1.51") else {"use_container_width": True}

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


# The same title block as Lindquett's data apps: forest green, serif title, mustard figures.
st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');
    html, body, [class*="css"], .stApp { font-family: 'DM Sans', system-ui, sans-serif; }
    .block-container { padding-top: 2rem; max-width: 1120px; }
    .lq-title { background: #0b3d2e; color: #fff; margin: 1rem -1rem 1.5rem; padding: 36px 48px 40px; border-radius: 0 0 12px 12px; }
    .lq-title .meta { font-size: 14px; color: rgba(255,255,255,0.78); }
    .lq-title h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 44px; line-height: 1.05; margin: 12px 0 10px; color: #fff; }
    .lq-title p { font-size: 17px; line-height: 1.5; max-width: 64ch; color: rgba(255,255,255,0.86); margin: 0; }
    .lq-figures { display: flex; flex-wrap: wrap; gap: 12px 48px; margin-top: 18px; }
    .lq-figure .v { font-family: 'DM Serif Display', Georgia, serif; font-size: 44px; line-height: 1; color: #f2b134; }
    .lq-figure .l { font-size: 13px; color: rgba(255,255,255,0.78); margin-top: 6px; }
    h2, h3 { font-family: 'DM Serif Display', Georgia, serif !important; font-weight: 400 !important; }
    [data-testid="stMetric"] { background: #fff; border: 1px solid #dce0d9; border-radius: 8px; padding: 14px 16px; }
    </style>
    """,
    unsafe_allow_html=True,
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

difference = end_scenario - end_current
raised = [segment for segment, pct in increases.items() if pct > 0]
verb = "adds" if difference >= 0 else "costs"
st.markdown(
    f"""
    <div class="lq-title">
      <div class="meta">Lindquett Software · Pricing scenario planner · baseline as of {baseline['as_of']}</div>
      <h1>{"A " + ", ".join(f"{increases[s]}% {s}" for s in raised) + " increase " + verb + f" ${abs(difference) / 1e6:,.2f}M of ARR in {months} months" if raised else "Prices unchanged: nothing to compare yet"}</h1>
      <p>{"Legacy accounts renew at the higher price; churn rises by " + f"{sensitivity * 100:.3f}" + " points a month for each 1% of increase, the rate accounts already moved to the 2026 list have shown." if raised else "Move the sliders to raise the price legacy accounts pay at renewal, and see what it does to ARR after churn."}</p>
      <div class="lq-figures">
        <div class="lq-figure"><div class="v">${end_scenario / 1e6:,.1f}M</div><div class="l">ARR in {months} months with the increase</div></div>
        <div class="lq-figure"><div class="v">${end_current / 1e6:,.1f}M</div><div class="l">ARR in {months} months, prices unchanged</div></div>
        <div class="lq-figure"><div class="v">${groups['arr'].sum() / 1e6:,.1f}M</div><div class="l">ARR today</div></div>
      </div>
    </div>
    """,
    unsafe_allow_html=True,
)

lines = pd.concat([
    total(current).rename("Prices unchanged"),
    total(scenario).rename("With the increase"),
], axis=1).reset_index().melt("month", var_name="Scenario", value_name="ARR")
st.altair_chart(
    alt.Chart(lines).mark_line(strokeWidth=3).encode(
        x=alt.X("month:Q", title="Months from today"),
        y=alt.Y("ARR:Q", title="ARR ($)", scale=alt.Scale(zero=False), axis=alt.Axis(format="$,.2s")),
        color=alt.Color("Scenario:N", scale=alt.Scale(range=["#b8b2a7", "#0b3d2e"])),
        tooltip=["Scenario", "month", alt.Tooltip("ARR:Q", format="$,.0f")],
    ),
    **WIDE_CHART,
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
    **WIDE_TABLE,
)
