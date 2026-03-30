"""Visualization block execution for deepnote-runtime.

Ported from deepnote-toolkit/deepnote_toolkit/chart/deepnote_chart.py.
Uses vl_convert and vegafusion for Vega-Lite chart rendering.
All heavy imports are lazy to avoid startup cost.
"""

from __future__ import annotations

import json
from typing import Any


CHART_ROW_LIMIT = 100_000
MIME_TYPE = "application/vnd.vegafusion-spec"


class DeepnoteChart:
    """Renders a Vega-Lite chart from a DataFrame.

    Ported from deepnote-toolkit. Produces a MIME bundle for rich display.
    """

    def __init__(
        self,
        dataframe: Any,
        spec: str | None = None,
        spec_dict: dict | None = None,
        filters: str | None = None,
    ) -> None:
        self._dataframe = dataframe
        self._spec = json.loads(spec) if isinstance(spec, str) else (spec_dict or {})
        self._filters = json.loads(filters) if isinstance(filters, str) else None
        self._result: dict[str, Any] | None = None

    def _build(self) -> dict[str, Any]:
        """Build the chart spec and return metadata."""
        import pandas as pd

        df = self._dataframe
        if not isinstance(df, pd.DataFrame):
            raise TypeError(f"DeepnoteChart requires a pandas DataFrame, got {type(df).__name__}")

        # Apply row limit
        total_rows = len(df)
        if total_rows > CHART_ROW_LIMIT:
            df = df.head(CHART_ROW_LIMIT)

        try:
            import vl_convert as vlc

            # Convert Vega-Lite to Vega
            vega_spec = vlc.vegalite_to_vega(json.dumps(self._spec))
            vega_dict = json.loads(vega_spec)
        except ImportError:
            # Fallback: return Vega-Lite spec directly
            vega_dict = self._spec

        return {
            "spec": vega_dict,
            "totalRows": total_rows,
            "rowLimit": CHART_ROW_LIMIT,
            "filtered": total_rows > CHART_ROW_LIMIT,
        }

    def _repr_mimebundle_(self, **kwargs: Any) -> dict[str, Any]:
        """IPython display protocol."""
        if self._result is None:
            self._result = self._build()
        return {MIME_TYPE: self._result}

    def __repr__(self) -> str:
        return f"<DeepnoteChart rows={len(self._dataframe)}>"


def execute_visualization_block(
    block_metadata: dict[str, Any],
    namespace: dict[str, Any],
) -> Any:
    """Execute a visualization block.

    Reads the variable name and spec from metadata, creates a DeepnoteChart.
    """
    var_name = block_metadata.get("deepnote_variable_name")
    spec_json = block_metadata.get("deepnote_chart_spec", "{}")
    filters_json = block_metadata.get("deepnote_chart_filters")

    if not var_name or var_name not in namespace:
        raise NameError(
            f"Visualization block references variable '{var_name}' which is not defined"
        )

    df = namespace[var_name]
    chart = DeepnoteChart(df, spec=spec_json, filters=filters_json)
    return chart
