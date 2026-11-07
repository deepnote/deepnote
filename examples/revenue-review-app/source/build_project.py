"""Generate ../revenue-review.deepnote from data.py and metrics.py.

    python3 examples/revenue-review-app/source/build_project.py examples/revenue-review-app/revenue-review.deepnote

Needs PyYAML. Block ids are derived from block names, so regenerating keeps them stable.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])

DATA_NB = "5f0c1d2e-7a41-4c8e-9b6a-0d1e2f3a4b01"
METRICS_NB = "5f0c1d2e-7a41-4c8e-9b6a-0d1e2f3a4b02"
APP_NB = "5f0c1d2e-7a41-4c8e-9b6a-0d1e2f3a4b03"


def bid(key):
    return hashlib.md5(key.encode()).hexdigest()


class Literal(str):
    pass


yaml.add_representer(Literal, lambda d, v: d.represent_scalar("tag:yaml.org,2002:str", v, style="|"))


def lit(s):
    s = s.strip("\n")
    return Literal(s) if "\n" in s else s


def notebook(nb_id, name, blocks, is_module=False):
    out = []
    for i, b in enumerate(blocks):
        key = f"{name}/{b.pop('key')}"
        block = {
            "id": bid(key),
            "blockGroup": bid("group/" + key),
            "sortingKey": f"a{i:03d}",
            "type": b.pop("type"),
            "content": lit(b.pop("content", "")),
            "metadata": b.pop("metadata", {}),
        }
        assert not b, b
        out.append(block)
    nb = {"id": nb_id, "name": name, "executionMode": "block"}
    if is_module:
        nb["isModule"] = True
    nb["blocks"] = out
    return nb


def app(meta, order, group=None, width=None, code_hidden=True, output_hidden=False):
    m = dict(meta)
    m["deepnote_app_block_visible"] = True
    m["deepnote_app_block_order"] = order
    m["deepnote_app_is_code_hidden"] = code_hidden
    m["deepnote_app_is_output_hidden"] = output_hidden
    if group:
        m["deepnote_app_block_group_id"] = group
        m["deepnote_app_block_subgroup_id"] = f"{group}-{order}"
        m["deepnote_app_block_width"] = width
    return m


def hidden(meta=None):
    m = dict(meta or {})
    m["deepnote_app_block_visible"] = False
    return m


# ---------------------------------------------------------------- Revenue data module
data_src = (HERE / "data.py").read_text()
data_src = data_src.replace("\naccounts, mrr = build()\nopportunities = build_opportunities(mrr)\n", "\n")
data_blocks = [
    dict(key="intro", type="markdown", content="""
# Revenue data

Governed source tables for the revenue review. **Synthetic, deterministic data** for a fictional
B2B SaaS company, generated with a fixed seed so every run, module call and app session sees
identical numbers. Swap the generator block for warehouse SQL blocks to point this at real data;
the exported names and columns are the contract.

| Export | Grain | Columns |
| --- | --- | --- |
| `accounts` | one row per customer | account_id, account, region, segment, industry, customer_since, price_plan |
| `mrr` | account × month (only months with revenue) | account_id, account, region, segment, month, mrr (USD) |
| `opportunities` | open pipeline at the start of each quarter | quarter, region, segment, opportunity_id, stage, probability, amount, target |
"""),
    dict(key="generator", type="code", content=data_src),
    dict(key="accounts", type="code", content="accounts, mrr = build()\naccounts",
         metadata={"function_export_name": "accounts"}),
    dict(key="mrr", type="code", content="mrr", metadata={"function_export_name": "mrr"}),
    dict(key="opportunities", type="code", content="opportunities = build_opportunities(mrr)\nopportunities",
         metadata={"function_export_name": "opportunities"}),
]

# ---------------------------------------------------------------- Revenue metrics module
metrics_src = (HERE / "metrics.py").read_text()
functions = re.split(r"\n\n\n(?=def )", metrics_src.strip())
metric_blocks = [dict(key="intro", type="markdown", content="""
# Revenue metrics

The semantic layer for revenue: **one definition per metric**, exported as functions so every
notebook, app and AI agent computes ARR, NRR, GRR and pipeline coverage the same way. Each function
is self-contained (imports inside, no shared globals) because exported functions run in the
importing notebook.

- **ARR** is 12 × month-end MRR.
- **NRR** (trailing twelve months): ARR today from the accounts that paid twelve months ago,
  divided by their ARR then.
- **GRR**: the same cohort with each account capped at its starting ARR, so expansion can't hide
  churn and contraction.
- **Pipeline coverage**: open pipeline at the start of a quarter ÷ that quarter's new-business target.
""")]
for fn in functions:
    name = re.match(r"def (\w+)", fn).group(1)
    metric_blocks.append(dict(key=name, type="code", content=f"{fn}\n\n\n{name}",
                              metadata={"function_export_name": name}))
metric_names = [b["key"] for b in metric_blocks[1:]]

# ---------------------------------------------------------------- App notebook
QUARTERS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]


def select(name, label, options, value, order):
    return dict(key=f"input-{name}", type="input-select", metadata=app({
        "deepnote_variable_name": name,
        "deepnote_input_label": label,
        "deepnote_variable_value": value,
        "deepnote_variable_default_value": value,
        "deepnote_variable_options": options,
        "deepnote_variable_custom_options": options,
        "deepnote_variable_select_type": "from-options",
        "deepnote_allow_multiple_values": False,
    }, order, group="filters", width=33, code_hidden=False))


def big_number(key, title, value, comparison_title, comparison_value, fmt, order, comparison_type="absolute-change"):
    return dict(key=key, type="big-number", metadata=app({
        "deepnote_big_number_title": title,
        "deepnote_big_number_value": value,
        "deepnote_big_number_format": fmt,
        "deepnote_big_number_comparison_enabled": True,
        "deepnote_big_number_comparison_type": comparison_type,
        "deepnote_big_number_comparison_title": comparison_title,
        "deepnote_big_number_comparison_value": comparison_value,
        "deepnote_big_number_comparison_format": "",
    }, order, group="kpis", width=25, code_hidden=False))


def chart_spec(title, mark, x, y, color, domain=None, colors=None):
    y_enc = {
        "axis": {"format": {"type": "default", "decimals": None}, "formatType": "numberFormatFromNumberType"},
        "type": "quantitative", "field": y, "title": y, "scale": {"type": "linear"},
        "format": {"type": "default", "decimals": None}, "aggregate": "sum",
        "formatType": "numberFormatFromNumberType",
    }
    if mark == "bar":
        y_enc["stack"] = True
    if mark == "line":
        y_enc["scale"]["zero"] = False
    color_enc = {"type": "nominal", "field": color, "scale": {"scheme": "deepnote10"}}
    if domain:
        color_enc["scale"] = {"domain": domain, "range": colors}
    mark_def = {"clip": True, "type": mark, "tooltip": True}
    if mark == "line":
        mark_def["point"] = True
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "config": {"legend": {"disable": False}},
        "encoding": {},
        "usermeta": {"seriesNames": [y], "seriesOrder": [0], "specSchemaVersion": 2, "tooltipDefaultMode": True},
        "layer": [{"layer": [{"layer": [{
            "mark": mark_def,
            "encoding": {"x": {"sort": None, "type": "nominal", "field": x}, "y": y_enc, "color": color_enc},
            "transform": [],
        }]}], "resolve": {"scale": {"color": "independent"}}}],
    }


AGENT_PROMPT = """
You are the revenue analyst embedded in this quarterly revenue review app.

Answer the viewer's question: the current value of the `question` input. Use the filter inputs
(`region`, `segment`, `quarter`) as the default scope unless the question names a different one.

How to work:
- Use the governed metric functions from the "Revenue metrics" module, which are already loaded:
  arr_movements, arr_bridge, retention, retention_trend, top_movers and pipeline_coverage. Never
  re-implement ARR, NRR, GRR or coverage. For a cut the functions don't take as a parameter
  (for example price_plan or industry), filter `mrr` or `opportunities` first and pass the subset in.
- The data frames `accounts`, `mrr` and `opportunities` come from the "Revenue data" module; the
  "Analyst guide" block lists their columns.
- Only add new blocks below this one. Never edit or delete existing blocks.
- Be concise: at most three code blocks and at most two charts, each with a title and labelled axes.
- Finish with one markdown block: the answer in one bold sentence, three bullets of evidence with
  numbers, and one recommended next step.
- If `question` is empty, summarize what changed in the selected quarter instead.
"""

ANALYST_GUIDE = """
### Analyst guide (hidden in the app; context for the agent)

Loaded by the module blocks above:

- `accounts` — account_id, account, region, segment, industry, customer_since, price_plan
  (`"2026 price list"` or `"Legacy"`).
- `mrr` — account_id, account, region, segment, month (month start), mrr in USD. Rows exist only for
  months with revenue; a churned account simply stops having rows.
- `opportunities` — quarter (`"2026-Q4"`), region, segment, opportunity_id, stage, probability,
  amount, target (the new-business ARR target for that region and segment, repeated per row).

Metric functions (all accept `region="All"` and `segment="All"`):

- `arr_movements(mrr, region, segment)` → quarter, movement (New/Expansion/Contraction/Churn), arr_change
- `arr_bridge(mrr, quarter, region, segment)` → step, arr
- `retention(mrr, quarter, region, segment)` → dict: nrr, grr, cohort_arr, cohort_accounts
- `retention_trend(mrr, segment, quarters=6)` → quarter, region, nrr
- `top_movers(mrr, quarter, region, segment, n=8)` → account, region, segment, movement, arr_start, arr_end, arr_change
- `pipeline_coverage(opportunities, quarter, region, segment)` → dict: pipeline, weighted_pipeline, target, coverage
"""

COMPUTE = """
import pandas as pd

# Everything the dashboard shows, computed once from the governed module functions.
_q = pd.Period(quarter.replace("-", ""), freq="Q")
prior_quarter = f"{(_q - 1).year}-Q{(_q - 1).quarter}"
next_quarter = f"{(_q + 1).year}-Q{(_q + 1).quarter}"

bridge = arr_bridge(mrr, quarter, region, segment)
prior_bridge = arr_bridge(mrr, prior_quarter, region, segment)
current = retention(mrr, quarter, region, segment)
previous = retention(mrr, prior_quarter, region, segment)
coverage_next = pipeline_coverage(opportunities, next_quarter, region, segment)
coverage_this = pipeline_coverage(opportunities, quarter, region, segment)

ending_arr_m = round(bridge["arr"].iloc[-1] / 1e6, 2)
prior_ending_arr_m = round(prior_bridge["arr"].iloc[-1] / 1e6, 2)
nrr = round(current["nrr"], 3)
prior_nrr = round(previous["nrr"], 3)
grr = round(current["grr"], 3)
prior_grr = round(previous["grr"], 3)
pipeline_cover = round(coverage_next["coverage"], 2)
prior_pipeline_cover = round(coverage_this["coverage"], 2)

_moves = arr_movements(mrr, region, segment)
_recent = [f"{p.year}-Q{p.quarter}" for p in pd.period_range(_q - 5, _q, freq="Q")]
arr_movement_chart = (
    _moves[_moves["quarter"].isin(_recent)]
    .assign(**{"ARR change ($M)": lambda d: (d["arr_change"] / 1e6).round(2)})
    .rename(columns={"quarter": "Quarter", "movement": "Movement"})[["Quarter", "Movement", "ARR change ($M)"]]
)
_trend = retention_trend(mrr, segment, quarters=8)
nrr_trend_chart = (
    _trend[_trend["quarter"] <= quarter]
    .assign(**{"NRR (%)": lambda d: (d["nrr"] * 100).round(1)})
    .rename(columns={"quarter": "Quarter", "region": "Region"})[["Quarter", "Region", "NRR (%)"]]
)
"""

BRIDGE_TABLE = """
# ARR bridge for the selected quarter
bridge.assign(**{"ARR ($M)": (bridge["arr"] / 1e6).round(2)}).rename(columns={"step": "Step"})[["Step", "ARR ($M)"]]
"""

MOVERS_TABLE = """
# The accounts that moved ARR most this quarter
(
    top_movers(mrr, quarter, region, segment, n=8)
    .assign(
        **{
            "Start ARR ($K)": lambda d: (d["arr_start"] / 1e3).round(0),
            "End ARR ($K)": lambda d: (d["arr_end"] / 1e3).round(0),
            "Change ($K)": lambda d: (d["arr_change"] / 1e3).round(0),
        }
    )
    .rename(columns={"account": "Account", "region": "Region", "segment": "Segment", "movement": "Movement"})
    [["Account", "Region", "Segment", "Movement", "Start ARR ($K)", "End ARR ($K)", "Change ($K)"]]
)
"""

MOVEMENT_COLORS = ["#2f9e6b", "#4c8bf5", "#f2a33a", "#e5534b"]

app_blocks = [
    dict(key="title", type="text-cell-h1", content="Quarterly revenue review", metadata=app({}, 0)),
    dict(key="subtitle", type="markdown", content="""
ARR, retention and pipeline from the governed **Revenue metrics** module. Pick a scope, then ask
the analyst anything below. *Synthetic data for a fictional company, as of 30 September 2026.*
""", metadata=app({}, 1)),
    select("region", "Region", ["All", "North America", "EMEA", "APAC", "LATAM"], "All", 2),
    select("segment", "Segment", ["All", "Enterprise", "Mid-market", "SMB"], "All", 3),
    select("quarter", "Quarter", QUARTERS, "2026-Q3", 4),
    dict(key="module-data", type="notebook-function", content="", metadata=hidden({
        "function_notebook_id": DATA_NB,
        "function_notebook_inputs": {},
        "function_notebook_export_mappings": {
            n: {"enabled": True, "variable_name": n} for n in ["accounts", "mrr", "opportunities"]
        },
    })),
    dict(key="module-metrics", type="notebook-function", content="", metadata=hidden({
        "function_notebook_id": METRICS_NB,
        "function_notebook_inputs": {},
        "function_notebook_export_mappings": {n: {"enabled": True, "variable_name": n} for n in metric_names},
    })),
    dict(key="compute", type="code", content=COMPUTE, metadata=hidden()),
    big_number("kpi-arr", "Ending ARR ($M)", "ending_arr_m", "vs prior quarter", "prior_ending_arr_m", "number", 5,
               comparison_type="percentage-change"),
    big_number("kpi-nrr", "Net revenue retention", "nrr", "vs prior quarter", "prior_nrr", "percent", 6),
    big_number("kpi-grr", "Gross revenue retention", "grr", "vs prior quarter", "prior_grr", "percent", 7),
    big_number("kpi-coverage", "Pipeline coverage, next quarter", "pipeline_cover", "vs this quarter",
               "prior_pipeline_cover", "number", 8),
    dict(key="chart-movements", type="visualization", metadata=app({
        "deepnote_variable_name": "arr_movement_chart",
        "deepnote_visualization_spec": chart_spec("ARR movements by quarter ($M)", "bar", "Quarter", "ARR change ($M)", "Movement",
                                                  ["New", "Expansion", "Contraction", "Churn"], MOVEMENT_COLORS),
    }, 9, group="charts", width=55, code_hidden=False)),
    dict(key="chart-nrr", type="visualization", metadata=app({
        "deepnote_variable_name": "nrr_trend_chart",
        "deepnote_visualization_spec": chart_spec("Net revenue retention by region (%)", "line", "Quarter", "NRR (%)", "Region"),
    }, 10, group="charts", width=45, code_hidden=False)),
    dict(key="table-bridge", type="code", content=BRIDGE_TABLE, metadata=app({}, 11, group="tables", width=30)),
    dict(key="table-movers", type="code", content=MOVERS_TABLE, metadata=app({}, 12, group="tables", width=70)),
    dict(key="ask-heading", type="text-cell-h2", content="Ask the analyst", metadata=app({}, 13)),
    dict(key="ask-intro", type="markdown", content="""
Type any question about revenue, retention or pipeline and press **Run**. An AI analyst answers
it with the same governed metrics as the dashboard above, adding its own analysis and charts below.
""", metadata=app({}, 14)),
    dict(key="input-question", type="input-textarea", metadata=app({
        "deepnote_variable_name": "question",
        "deepnote_input_label": "Your question",
        "deepnote_variable_value": "Why did EMEA net revenue retention drop in 2026-Q3, and which accounts or plans drove it?",
        "deepnote_variable_default_value": "",
    }, 15, code_hidden=False)),
    dict(key="analyst-guide", type="markdown", content=ANALYST_GUIDE, metadata=hidden()),
    dict(key="agent", type="agent", content=AGENT_PROMPT, metadata=app({"deepnote_agent_model": "auto"}, 16,
                                                                         code_hidden=False)),
]

project = {
    "metadata": {"createdAt": "2026-11-06T09:00:00.000Z", "modifiedAt": "2026-11-06T09:00:00.000Z"},
    "version": "1.0.0",
    "project": {
        "id": "5f0c1d2e-7a41-4c8e-9b6a-0d1e2f3a4b00",
        "name": "Quarterly revenue review",
        "notebooks": [
            notebook(APP_NB, "Revenue review", app_blocks),
            notebook(DATA_NB, "Revenue data", data_blocks, is_module=True),
            notebook(METRICS_NB, "Revenue metrics", metric_blocks, is_module=True),
        ],
    },
}

class NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


NoAliasDumper.add_representer(Literal, lambda d, v: d.represent_scalar("tag:yaml.org,2002:str", v, style="|"))
OUT.write_text(yaml.dump(project, Dumper=NoAliasDumper, sort_keys=False, allow_unicode=True, width=120))
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
