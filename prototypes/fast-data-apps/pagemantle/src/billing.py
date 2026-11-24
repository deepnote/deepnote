# title: Subscriptions and billing
# description: Monthly recurring revenue, new and churned customers, plans, failed payments and how they were recovered, and how quickly customers pay, from Stripe and HubSpot. Monthly history from 2021 to September 2026.
con.execute(f"ATTACH '{db('stripe/stripe.sqlite')}' AS st (TYPE sqlite, READ_ONLY)")
con.execute(f"ATTACH '{db('hubspot/hubspot.sqlite')}' AS hs (TYPE sqlite, READ_ONLY)")
con.execute(f"""
CREATE TEMP TABLE subs AS
SELECT s.id, s.customer_id,
  json_extract_string(c.metadata_json, '$.current_plan') AS plan,
  json_extract_string(c.metadata_json, '$.segment') AS segment,
  p.recurring_interval AS billing,
  p.unit_amount * s.quantity / 100.0 / (CASE WHEN p.recurring_interval = 'year' THEN 12 ELSE 1 END) AS mrr,
  CAST(s.created_at AS TIMESTAMP)::DATE AS started,
  CAST(coalesce(s.ended_at, s.canceled_at) AS TIMESTAMP)::DATE AS ended
FROM st.subscriptions s
JOIN st.prices p ON p.id = s.price_id
JOIN st.customers c ON c.id = s.customer_id
WHERE {in_sample('s.customer_id')}
""")
# Month-end state: a subscription counts in every month it was live at the month's end.
monthly = q("""
WITH months AS (
  SELECT unnest(generate_series(DATE '2021-01-01', DATE '2026-09-01', INTERVAL 1 MONTH))::DATE AS m
)
SELECT strftime(m, '%Y-%m') AS month,
  round(sum(mrr) FILTER (WHERE started <= last_day(m) AND (ended IS NULL OR ended > last_day(m))), 0) AS mrr,
  count(*) FILTER (WHERE started <= last_day(m) AND (ended IS NULL OR ended > last_day(m))) AS customers,
  count(*) FILTER (WHERE date_trunc('month', started) = m) AS new_customers,
  count(*) FILTER (WHERE date_trunc('month', ended) = m) AS churned_customers,
  round(coalesce(sum(mrr) FILTER (WHERE date_trunc('month', started) = m), 0), 0) AS new_mrr,
  round(coalesce(sum(mrr) FILTER (WHERE date_trunc('month', ended) = m), 0), 0) AS churned_mrr
FROM months, subs
GROUP BY m ORDER BY m
""")
monthly["churn_rate"] = (monthly.churned_customers / monthly.customers.shift(1)).round(4)
monthly["net_new_mrr"] = monthly.new_mrr - monthly.churned_mrr
plans = q("""
SELECT plan, billing,
  count(*) FILTER (WHERE ended IS NULL) AS customers,
  round(sum(mrr) FILTER (WHERE ended IS NULL), 0) AS mrr,
  round(avg(mrr) FILTER (WHERE ended IS NULL), 0) AS avg_mrr,
  count(*) FILTER (WHERE ended >= DATE '2025-10-01') AS churned_12m,
  round(count(*) FILTER (WHERE ended >= DATE '2025-10-01') / count(*) FILTER (WHERE ended IS NULL OR ended >= DATE '2025-10-01'), 4) AS churn_rate_12m
FROM subs GROUP BY ALL ORDER BY mrr DESC
""")
# Failed payment attempts and whether the invoice was paid afterwards.
failures = q(f"""
SELECT f.id AS payment_id, c.name AS customer,
  CAST(f.created_at AS TIMESTAMP)::DATE::VARCHAR AS failed_on,
  strftime(CAST(f.created_at AS TIMESTAMP), '%Y-%m') AS month,
  replace(f.failure_code, '_', ' ') AS reason,
  f.payment_method_type AS method,
  f.amount / 100.0 AS amount,
  ok.created_at IS NOT NULL AS recovered,
  round(date_diff('hour', CAST(f.created_at AS TIMESTAMP), CAST(ok.created_at AS TIMESTAMP)) / 24.0, 1) AS days_to_recover
FROM st.payments f
JOIN st.customers c ON c.id = f.customer_id
LEFT JOIN st.payments ok ON ok.invoice_id = f.invoice_id AND ok.status = 'succeeded'
WHERE f.failure_code IS NOT NULL AND {in_sample('f.customer_id')}
ORDER BY failed_on DESC
""")
fail_monthly = q("""
SELECT strftime(CAST(created_at AS TIMESTAMP), '%Y-%m') AS month,
  count(*) FILTER (WHERE status = 'succeeded') AS payments,
  count(*) FILTER (WHERE failure_code IS NOT NULL) AS failed,
  round(sum(amount) FILTER (WHERE failure_code IS NOT NULL) / 100.0, 0) AS failed_amount
FROM st.payments GROUP BY 1 ORDER BY 1
""")
fail_monthly["failure_rate"] = (fail_monthly.failed / (fail_monthly.payments + fail_monthly.failed)).round(4)
# How quickly customers pay: HubSpot keeps each customer's typical days to pay.
pay_speed = q(f"""
SELECT max(value) FILTER (WHERE property_name = 'name') AS customer,
  max(value) FILTER (WHERE property_name = 'customer_segment') AS segment,
  max(value) FILTER (WHERE property_name = 'billing_cadence') AS billing_cadence,
  CAST(max(value) FILTER (WHERE property_name = 'payment_days') AS INT) AS payment_days,
  TRY_CAST(max(value) FILTER (WHERE property_name = 'annual_contract_value') AS DOUBLE) AS contract_value
FROM hs.property_values
WHERE object_type = 'companies' AND {in_sample('record_id')}
  AND property_name IN ('name', 'customer_segment', 'billing_cadence', 'payment_days', 'annual_contract_value')
GROUP BY record_id
""")
pay_speed["pays"] = pay_speed.payment_days.map(
    lambda d: "On receipt" if d == 0 else "Within 15 days" if d <= 15 else "16–30 days" if d <= 30 else "Over 30 days"
)
invoices = q(f"""
SELECT strftime(CAST(created_at AS TIMESTAMP), '%Y-%m') AS month, count(*) AS invoices,
  round(sum(total) / 100.0, 0) AS invoiced, round(sum(amount_paid) / 100.0, 0) AS paid,
  round(avg(date_diff('minute', CAST(created_at AS TIMESTAMP), CAST(paid_at AS TIMESTAMP))) / 1440.0, 2) AS avg_days_to_pay,
  round(avg(attempt_count), 2) AS avg_attempts
FROM st.invoices WHERE {in_sample('customer_id')} GROUP BY 1 ORDER BY 1
""")
last = monthly.iloc[-1]
year_ago = monthly.iloc[-13]
display({"application/json": {
    "dataset": {**DATASET, "note": "all customers" if FULL else "every 10th customer"},
    "as_of": "2026-09-30",
    "kpis": {
        "mrr": float(last.mrr), "mrr_year_ago": float(year_ago.mrr),
        "arr": float(last.mrr * 12),
        "customers": int(last.customers), "customers_year_ago": int(year_ago.customers),
        "churn_rate_month": float(last.churn_rate),
        "avg_churn_rate_12m": round(float(monthly.churn_rate.tail(12).mean()), 4),
        "failed_payments": int(len(failures)),
        "recovery_rate": round(float(failures.recovered.mean()), 4) if len(failures) else None,
        "avg_days_to_recover": round(float(failures.days_to_recover.mean()), 1) if len(failures) else None,
    },
    "monthly": records(monthly),
    "plans": records(plans),
    "payment_failures": records(failures),
    "payments_monthly": records(fail_monthly),
    "invoices_monthly": records(invoices),
    "payment_speed": records(pay_speed),
}}, raw=True)
