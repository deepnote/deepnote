"""SQL block execution for deepnote-runtime.

Ported from deepnote-toolkit/deepnote_toolkit/sql/sql_execution.py.
Stripped of Jupyter middleware, SSH tunneling, IAM/federated auth, and caching.
Core path: read env var JSON → SQLAlchemy engine → pd.read_sql_query().
"""

from __future__ import annotations

import json
import os
import re
import uuid
import warnings
from typing import Any


def execute_sql_block(
    query: str,
    integration_id: str,
    namespace: dict[str, Any],
    variable_name: str | None = None,
) -> Any:
    """Execute a SQL block and return the result DataFrame.

    Args:
        query: The SQL query (may contain Jinja2 templates).
        integration_id: The integration ID from block metadata.
        namespace: The execution namespace (for Jinja variable resolution).
        variable_name: Variable name to assign result to in namespace.

    Returns:
        The result DataFrame (or None for non-SELECT queries).
    """
    env_var_name = _integration_id_to_env_var(integration_id)
    connection_json = os.environ.get(env_var_name)

    if not connection_json:
        raise RuntimeError(
            f"SQL integration not configured. "
            f"Expected env var '{env_var_name}' with connection JSON.\n"
            f"Set it with the connection details for integration '{integration_id}'."
        )

    sql_alchemy_dict = json.loads(connection_json)
    url = sql_alchemy_dict["url"]
    params = sql_alchemy_dict.get("params", {})
    param_style = sql_alchemy_dict.get("param_style")

    # Auto-detect param_style for databases that need it
    if param_style is None:
        param_style = _detect_param_style(url)

    # Render Jinja2 templates in the query
    compiled_query, bind_params = _render_jinja_sql(query, namespace, param_style)

    if not compiled_query.strip():
        return None

    # Execute
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")
        df = _execute_on_engine(url, params, compiled_query, bind_params)

    if df is not None and variable_name:
        namespace[variable_name] = df

    return df


def _integration_id_to_env_var(integration_id: str) -> str:
    """Convert integration ID to env var name: SQL_<ID> with special chars → underscores."""
    sanitized = re.sub(r"[^a-zA-Z0-9]", "_", integration_id).upper()
    return f"SQL_{sanitized}"


def _detect_param_style(url: str) -> str | None:
    """Auto-detect param_style for databases that don't support pyformat."""
    if url.startswith("trino"):
        return "qmark"
    if "duckdb" in url:
        return "qmark"
    return None


def _render_jinja_sql(
    template: str,
    namespace: dict[str, Any],
    param_style: str | None,
) -> tuple[str, dict[str, Any] | list[Any]]:
    """Render Jinja2 templates in SQL, returning (query, bind_params).

    Ported from deepnote-toolkit jinjasql_utils.py.
    """
    try:
        from jinja2 import Environment, meta

        effective_style = param_style or "pyformat"

        # Escape % for pyformat/format styles
        escaped = template
        if effective_style in ("format", "pyformat"):
            escaped = re.sub(r"(?<=[^{])%(?=[^}])", "%%", template)

        env = Environment()
        parsed = env.parse(escaped)
        required_vars = meta.find_undeclared_variables(parsed)

        context = {}
        for var in required_vars:
            if var in namespace:
                context[var] = namespace[var]

        rendered = env.from_string(escaped).render(context)
        return rendered, {}

    except ImportError:
        # No jinja2 — return template as-is (no template variables)
        return template, {}


def _execute_on_engine(
    url: str,
    params: dict[str, Any],
    query: str,
    bind_params: dict[str, Any] | list[Any],
) -> Any:
    """Create SQLAlchemy engine and execute query via pandas.

    Ported from deepnote-toolkit _execute_sql_on_engine / _query_data_source.
    """
    import pandas as pd
    from sqlalchemy import create_engine

    engine = create_engine(url, **params, pool_pre_ping=True)

    try:
        with engine.begin() as connection:
            try:
                params_for_pandas = (
                    tuple(bind_params) if isinstance(bind_params, list) else bind_params
                )
                return pd.read_sql_query(
                    query,
                    con=connection,
                    params=params_for_pandas or None,
                )
            except Exception as e:
                # ResourceClosedError for non-SELECT queries (UPDATE, INSERT, etc.)
                if "ResourceClosedError" in type(e).__name__:
                    return None
                raise
    finally:
        engine.dispose()
