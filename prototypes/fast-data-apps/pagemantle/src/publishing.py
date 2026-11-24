# cspell:ignore cust
# title: Publishing reliability
# description: Site publishing in September 2026 from the Snowflake reliability model and PostHog publish events: daily attempts, failures and success rate, by segment and plan, the customers with the most failures, and why publishes failed.
con.execute(f"""
CREATE TEMP TABLE cust AS
SELECT CUSTOMER_ID AS customer_id, arg_max(CUSTOMER_NAME, REFRESHED_AT) AS customer, arg_max(SEGMENT, REFRESHED_AT) AS segment
FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/CORE/CUSTOMERS')} GROUP BY 1
""")
con.execute(f"""
CREATE TEMP TABLE p AS
SELECT CUSTOMER_ID AS customer_id, ACTIVITY_DATE AS day,
  arg_max(PUBLISH_ATTEMPTS, REFRESHED_AT) AS attempts, arg_max(SUCCESSFUL_PUBLISHES, REFRESHED_AT) AS ok,
  arg_max(FAILED_PUBLISHES, REFRESHED_AT) AS failed
FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/OPERATIONS/PUBLISH_RELIABILITY_DAILY')}
WHERE {in_sample('CUSTOMER_ID')}
GROUP BY ALL
""")
daily = q("""
SELECT day::VARCHAR AS day, sum(attempts) AS attempts, sum(ok) AS successful, sum(failed) AS failed,
  round(sum(ok) / sum(attempts), 4) AS success_rate, count(DISTINCT customer_id) FILTER (WHERE failed > 0) AS customers_with_failures
FROM p GROUP BY 1 ORDER BY 1
""")
segments = q("""
SELECT replace(c.segment, '_', ' ') AS segment, sum(attempts) AS attempts, sum(failed) AS failed,
  round(sum(ok) / sum(attempts), 4) AS success_rate, count(DISTINCT p.customer_id) AS customers
FROM p LEFT JOIN cust c USING (customer_id) GROUP BY 1 ORDER BY attempts DESC
""")
customers = q(f"""
SELECT c.customer, replace(c.segment, '_', ' ') AS segment, sum(attempts) AS attempts, sum(failed) AS failed,
  round(sum(ok) / sum(attempts), 4) AS success_rate, count(*) FILTER (WHERE failed > 0) AS days_with_failures,
  max(day) FILTER (WHERE failed > 0)::VARCHAR AS last_failure
FROM p LEFT JOIN cust c USING (customer_id)
GROUP BY ALL HAVING sum(failed) > 0 ORDER BY failed DESC LIMIT {500 if FULL else 150}
""")
bands = q("""
SELECT CASE WHEN rate >= 0.99 THEN '99%+' WHEN rate >= 0.97 THEN '97–99%' WHEN rate >= 0.95 THEN '95–97%' WHEN rate >= 0.9 THEN '90–95%' ELSE 'Under 90%' END AS success_band,
  count(*) AS customers
FROM (SELECT customer_id, sum(ok) / sum(attempts) AS rate FROM p GROUP BY 1 HAVING sum(attempts) > 0) GROUP BY 1
""")
# Why publishes failed, from the product's own publish events.
con.execute(f"""
CREATE TEMP TABLE pe AS
SELECT CAST(timestamp AS TIMESTAMP)::DATE AS day, event_name,
  json_extract_string(properties_json, '$.error_code') AS error_code,
  json_extract_string(properties_json, '$.failed_step') AS failed_step,
  json_extract_string(properties_json, '$.site_type') AS site_type,
  json_extract_string(properties_json, '$.plan') AS plan,
  TRY_CAST(json_extract_string(properties_json, '$.duration_ms') AS DOUBLE) AS duration_ms
FROM {pq('posthog/events')}
WHERE event_family = 'publish' AND {in_sample('workspace_id')}
""")
errors = q("SELECT error_code, failed_step, count(*) AS failures FROM pe WHERE event_name = 'publish_failed' GROUP BY ALL ORDER BY 3 DESC")
by_site_type = q("""
SELECT site_type, count(*) FILTER (WHERE event_name = 'publish_completed') AS completed, count(*) FILTER (WHERE event_name = 'publish_failed') AS failed,
  round(count(*) FILTER (WHERE event_name = 'publish_failed') / count(*) FILTER (WHERE event_name IN ('publish_completed', 'publish_failed')), 4) AS failure_rate,
  round(median(duration_ms) FILTER (WHERE event_name = 'publish_completed') / 1000, 2) AS median_seconds
FROM pe GROUP BY 1 ORDER BY completed DESC
""")
by_plan = q("""
SELECT plan, count(*) FILTER (WHERE event_name = 'publish_failed') AS failed,
  round(count(*) FILTER (WHERE event_name = 'publish_failed') / count(*) FILTER (WHERE event_name IN ('publish_completed', 'publish_failed')), 4) AS failure_rate
FROM pe GROUP BY 1 ORDER BY failed DESC
""")
tot = daily[["attempts", "successful", "failed"]].sum()
display({"application/json": {
    "dataset": {**DATASET, "note": "all customers" if FULL else "every 10th customer"},
    "period": "2026-09-01 to 2026-09-30",
    "summary": {
        "attempts": int(tot.attempts), "failed": int(tot.failed),
        "success_rate": round(float(tot.successful / tot.attempts), 4),
        "worst_day": daily.sort_values("success_rate").iloc[0].day,
        "customers_affected": int(one("SELECT count(DISTINCT customer_id) FROM p WHERE failed > 0")),
    },
    "daily": records(daily),
    "segments": records(segments),
    "customers": records(customers),
    "success_bands": records(bands),
    "errors": records(errors),
    "by_site_type": records(by_site_type),
    "by_plan": records(by_plan),
}}, raw=True)
