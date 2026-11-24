# cspell:ignore cust
# title: Hosting and errors
# description: Edge requests served for customer websites in September 2026: traffic and bandwidth by day, hour, region and customer, cache hits, error responses (4xx and 5xx) and slow responses, and the paths behind them.
con.execute(f"""
CREATE TEMP TABLE r AS
SELECT e.occurred_at, e.request_date AS day, hour(e.occurred_at) AS hour,
  coalesce(e.customer_id, s.customer_id) AS customer_id, e.website_id, s.site_name, s.site_type,
  e.path, e.method, e.status_code, e.response_ms, e.response_bytes, e.cache_status, e.region
FROM {pq('bigquery/site_operations/edge_requests')} e
LEFT JOIN {pq('bigquery/product_core/sites')} s ON s.site_id = e.website_id
WHERE {in_sample('e.request_id')}
""")
con.execute(f"""
CREATE TEMP TABLE cust AS
SELECT CUSTOMER_ID AS customer_id, arg_max(CUSTOMER_NAME, REFRESHED_AT) AS customer, arg_max(SEGMENT, REFRESHED_AT) AS segment
FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/CORE/CUSTOMERS')} GROUP BY 1
""")
regions = {"iad": "US East", "fra": "Frankfurt", "syd": "Sydney", "sin": "Singapore", "gru": "São Paulo"}
M = """count(*) AS requests, round(sum(response_bytes) / 1e9, 3) AS gb,
  round(count(*) FILTER (WHERE status_code >= 500) / count(*), 5) AS server_error_rate,
  round(count(*) FILTER (WHERE status_code BETWEEN 400 AND 499) / count(*), 5) AS client_error_rate,
  round(quantile_cont(response_ms, 0.5), 0) AS median_ms, round(quantile_cont(response_ms, 0.95), 0) AS p95_ms,
  round(count(*) FILTER (WHERE response_ms > 500) / count(*), 5) AS slow_share,
  round(count(*) FILTER (WHERE cache_status = 'hit') / count(*), 4) AS cache_hit_rate"""
daily = q(f"SELECT day::VARCHAR AS day, {M} FROM r GROUP BY 1 ORDER BY 1")
hourly = q(f"SELECT hour, {M} FROM r GROUP BY 1 ORDER BY 1")
by_region = q(f"SELECT region, {M} FROM r GROUP BY 1 ORDER BY requests DESC")
by_region["region"] = by_region.region.map(regions).fillna(by_region.region)
by_cache = q(f"SELECT cache_status, {M} FROM r GROUP BY 1 ORDER BY requests DESC")
statuses = q("SELECT status_code, CASE WHEN status_code >= 500 THEN 'Server error' WHEN status_code >= 400 THEN 'Client error' ELSE 'OK' END AS kind, count(*) AS requests FROM r GROUP BY ALL ORDER BY 3 DESC")
daily_status = q("SELECT day::VARCHAR AS day, status_code::VARCHAR AS status, count(*) AS requests FROM r WHERE status_code >= 400 GROUP BY ALL ORDER BY 1")
error_paths = q(f"""
SELECT path, count(*) AS requests, count(*) FILTER (WHERE status_code >= 500) AS server_errors,
  count(*) FILTER (WHERE status_code = 404) AS not_found, count(*) FILTER (WHERE status_code = 429) AS rate_limited,
  round(count(*) FILTER (WHERE status_code >= 400) / count(*), 4) AS error_rate
FROM r GROUP BY 1 HAVING count(*) FILTER (WHERE status_code >= 400) > 0
ORDER BY server_errors + not_found + rate_limited DESC LIMIT 60
""")
slow_paths = q(f"""
SELECT path, count(*) AS requests, round(quantile_cont(response_ms, 0.95), 0) AS p95_ms,
  round(count(*) FILTER (WHERE response_ms > 500) / count(*), 4) AS slow_share,
  round(count(*) FILTER (WHERE cache_status = 'hit') / count(*), 4) AS cache_hit_rate
FROM r GROUP BY 1 HAVING count(*) >= {100 if FULL else 20} ORDER BY p95_ms DESC LIMIT 60
""")
customers = q(f"""
SELECT c.customer, replace(c.segment, '_', ' ') AS segment, count(DISTINCT website_id) AS websites, {M}
FROM r JOIN cust c USING (customer_id) GROUP BY ALL ORDER BY gb DESC LIMIT {400 if FULL else 150}
""")
tot = q(f"SELECT {M} FROM r").iloc[0]
display({"application/json": {
    "dataset": {**DATASET, "note": "all requests" if FULL else "every 10th request (totals are about a tenth)"},
    "period": "2026-09-01 to 2026-09-30",
    "summary": {k: (float(v) if v == v else None) for k, v in tot.items()},
    "daily": records(daily),
    "hourly": records(hourly),
    "regions": records(by_region),
    "cache": records(by_cache),
    "status_codes": records(statuses),
    "errors_daily": records(daily_status),
    "error_paths": records(error_paths),
    "slow_paths": records(slow_paths),
    "customers": records(customers),
}}, raw=True)
