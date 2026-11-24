# title: Customers
# description: One row per paying customer, joining the CRM (HubSpot), billing (Stripe), product usage and publishing (Snowflake). Usage compares the last 14 days of September 2026 with the 14 days before.
props = [
    "name", "customer_segment", "country", "industry", "acquisition_source", "customer_since",
    "annual_contract_value", "customer_health_score", "customer_health", "renewal_risk", "payment_days",
    "open_support_issues", "csat_score", "editor_count", "site_count", "billing_cadence", "pricing_model",
    "support_tier", "adoption_stage", "hubspot_owner_id", "last_contacted", "num_open_deals", "stripe_customer_id",
]
cols = ",\n".join(f"max(value) FILTER (WHERE property_name = '{p}') AS {p}" for p in props)
con.execute(f"ATTACH '{db('hubspot/hubspot.sqlite')}' AS hs (TYPE sqlite, READ_ONLY)")
con.execute(f"ATTACH '{db('stripe/stripe.sqlite')}' AS st (TYPE sqlite, READ_ONLY)")
con.execute(f"""
CREATE TEMP TABLE crm AS
SELECT record_id AS crm_id, {cols}
FROM hs.property_values
WHERE object_type = 'companies' AND {in_sample('record_id')}
GROUP BY record_id
""")
con.execute(f"""
CREATE TEMP TABLE ids AS
SELECT DISTINCT CUSTOMER_ID AS customer_id, CRM_COMPANY_ID AS crm_id
FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/CORE/CUSTOMERS')}
WHERE CRM_COMPANY_ID IN (SELECT crm_id FROM crm)
""")
# Snowflake tables keep every refresh of a row: take the latest refresh per customer and day.
# Adoption figures are month-to-date running totals, refreshed many times a day: take the latest
# refresh per customer and day, then difference the running totals.
con.execute(f"""
CREATE TEMP TABLE usage AS
SELECT customer_id,
  max(s) FILTER (WHERE d = DATE '2026-09-30') - max(s) FILTER (WHERE d = DATE '2026-09-16') AS sessions_recent,
  max(s) FILTER (WHERE d = DATE '2026-09-16') - max(s) FILTER (WHERE d = DATE '2026-09-02') AS sessions_before,
  max(people) AS active_people,
  max(pubs) AS publishes_30d
FROM (
  SELECT CUSTOMER_ID AS customer_id, SNAPSHOT_DATE AS d, arg_max(SESSIONS, REFRESHED_AT) AS s,
    arg_max(ACTIVE_PEOPLE, REFRESHED_AT) AS people, arg_max(SUCCESSFUL_PUBLISHES, REFRESHED_AT) AS pubs
  FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/PRODUCT/CUSTOMER_ADOPTION_DAILY')}
  WHERE CUSTOMER_ID IN (SELECT customer_id FROM ids)
  GROUP BY ALL
) GROUP BY customer_id
""")
con.execute(f"""
CREATE TEMP TABLE pub AS
SELECT customer_id, sum(att) AS publish_attempts, sum(failed) AS failed_publishes
FROM (
  SELECT CUSTOMER_ID AS customer_id, ACTIVITY_DATE, arg_max(PUBLISH_ATTEMPTS, REFRESHED_AT) AS att,
    arg_max(FAILED_PUBLISHES, REFRESHED_AT) AS failed
  FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/OPERATIONS/PUBLISH_RELIABILITY_DAILY')}
  WHERE CUSTOMER_ID IN (SELECT customer_id FROM ids)
  GROUP BY ALL
) GROUP BY customer_id
""")
con.execute(f"""
CREATE TEMP TABLE band AS
SELECT CUSTOMER_ID AS customer_id, arg_max(HEALTH_BAND, REFRESHED_AT) AS health_band,
  arg_max(OVERDUE_INVOICES, REFRESHED_AT) AS overdue_invoices
FROM {pq('snowflake/PAGEMANTLE_ANALYTICS/CUSTOMER_SUCCESS/CUSTOMER_HEALTH_DAILY')}
WHERE SNAPSHOT_DATE = DATE '2026-09-30' AND CUSTOMER_ID IN (SELECT customer_id FROM ids)
GROUP BY 1
""")
con.execute("""
CREATE TEMP TABLE bill AS
SELECT s.customer_id AS billing_id,
  sum(CASE WHEN s.status = 'active' THEN p.unit_amount * s.quantity / 100.0 / (CASE WHEN p.recurring_interval = 'year' THEN 12 ELSE 1 END) ELSE 0 END) AS mrr,
  bool_and(s.status = 'canceled') AS canceled
FROM st.subscriptions s JOIN st.prices p ON p.id = s.price_id
GROUP BY 1
""")
con.execute("""
CREATE TEMP TABLE fails AS
SELECT customer_id AS billing_id, count(*) AS failed_payments_12m
FROM st.payments WHERE failure_code IS NOT NULL GROUP BY 1
""")
customers = q("""
SELECT
  c.crm_id AS customer_id,
  c.name AS customer,
  c.customer_segment AS segment,
  json_extract_string(sc.metadata_json, '$.current_plan') AS plan,
  c.country, c.industry,
  c.acquisition_source AS channel,
  CAST(c.customer_since AS DATE)::VARCHAR AS customer_since,
  date_diff('month', CAST(c.customer_since AS DATE), DATE '2026-09-30') AS tenure_months,
  CASE WHEN date_diff('month', CAST(c.customer_since AS DATE), DATE '2026-09-30') < 12 THEN 'New (under 1 year)' ELSE 'Long-term (1 year+)' END AS customer_type,
  round(coalesce(b.mrr, 0), 2) AS mrr,
  round(coalesce(b.mrr, 0) * 12, 0) AS arr,
  CASE WHEN b.canceled THEN 'Churned' ELSE 'Active' END AS status,
  CAST(c.customer_health_score AS INT) AS health_score,
  c.customer_health AS health,
  replace(coalesce(hb.health_band, 'unknown'), '_', ' ') AS health_band,
  coalesce(hb.overdue_invoices, 0) AS overdue_invoices,
  c.renewal_risk,
  c.adoption_stage,
  c.billing_cadence,
  c.support_tier,
  CAST(c.payment_days AS INT) AS payment_days,
  CAST(c.open_support_issues AS INT) AS open_support_issues,
  TRY_CAST(c.csat_score AS DOUBLE) AS csat,
  CAST(c.editor_count AS INT) AS editors,
  CAST(c.site_count AS INT) AS sites,
  coalesce(u.sessions_recent, 0) AS sessions_14d,
  coalesce(u.sessions_before, 0) AS sessions_prior_14d,
  CASE WHEN coalesce(u.sessions_before, 0) > 0 THEN round(u.sessions_recent / u.sessions_before - 1, 3) END AS usage_change,
  coalesce(u.active_people, 0) AS active_people,
  coalesce(u.publishes_30d, 0) AS publishes_30d,
  CASE WHEN coalesce(p.publish_attempts, 0) > 0 THEN round(p.failed_publishes / p.publish_attempts, 4) END AS publish_failure_rate,
  coalesce(f.failed_payments_12m, 0) AS failed_payments,
  CASE WHEN coalesce(b.mrr, 0) > 0 THEN round(coalesce(u.sessions_recent, 0) / b.mrr, 2) END AS sessions_per_dollar,
  o.first_name || ' ' || o.last_name AS owner
FROM crm c
LEFT JOIN ids i ON i.crm_id = c.crm_id
LEFT JOIN usage u ON u.customer_id = i.customer_id
LEFT JOIN pub p ON p.customer_id = i.customer_id
LEFT JOIN band hb ON hb.customer_id = i.customer_id
LEFT JOIN bill b ON b.billing_id = c.stripe_customer_id
LEFT JOIN fails f ON f.billing_id = c.stripe_customer_id
LEFT JOIN st.customers sc ON sc.id = c.stripe_customer_id
LEFT JOIN hs.owners o ON o.id = c.hubspot_owner_id
ORDER BY arr DESC
""")
active = customers[customers.status == "Active"]
display({"application/json": {
    "dataset": {**DATASET, "note": "all customers" if FULL else "every 10th customer"},
    "as_of": "2026-09-30",
    "summary": {
        "customers": int(len(active)),
        "churned": int((customers.status == "Churned").sum()),
        "arr": round(float(active.arr.sum()), 0),
        "mrr": round(float(active.mrr.sum()), 0),
        "avg_health": round(float(active.health_score.mean()), 1),
        "at_risk": int((active.health_band == "at risk").sum()),
        "watch": int((active.health_band == "watch").sum()),
        "usage_dropping": int((active.usage_change < -0.3).sum()),
    },
    "customers": records(customers),
}}, raw=True)
