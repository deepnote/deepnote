# title: Website performance
# description: Real-user Core Web Vitals for customer websites hosted on PageMantle in September 2026: loading (LCP), responsiveness (INP) and layout stability (CLS), by day, device and page, with the share of good, needs-improvement and poor measurements.
con.execute(f"""
CREATE TEMP TABLE v AS
SELECT measurement_date AS day, metric_name AS metric, value, rating, device_category AS device, page_path, website_id
FROM {pq('bigquery/site_operations/web_vitals')}
WHERE {in_sample('measurement_id')}
""")
names = {"LCP": "Largest contentful paint (ms)", "INP": "Interaction to next paint (ms)", "CLS": "Cumulative layout shift"}
P = """count(*) AS measurements, round(quantile_cont(value, 0.75), 3) AS p75,
  round(count(*) FILTER (WHERE rating = 'good') / count(*), 4) AS good_share,
  round(count(*) FILTER (WHERE rating = 'poor') / count(*), 4) AS poor_share"""
summary = q(f"SELECT metric, {P} FROM v GROUP BY 1 ORDER BY 1")
daily = q(f"SELECT day::VARCHAR AS day, metric, device, {P} FROM v GROUP BY ALL ORDER BY 1")
devices = q(f"SELECT device, metric, {P} FROM v GROUP BY ALL ORDER BY 1, 2")
ratings = q("SELECT metric, device, replace(rating, '_', ' ') AS rating, count(*) AS measurements FROM v GROUP BY ALL")
pages = q(f"""
SELECT page_path AS page, {P},
  round(quantile_cont(value, 0.75) FILTER (WHERE metric = 'LCP'), 0) AS lcp_p75,
  round(quantile_cont(value, 0.75) FILTER (WHERE metric = 'INP'), 0) AS inp_p75,
  round(quantile_cont(value, 0.75) FILTER (WHERE metric = 'CLS'), 3) AS cls_p75
FROM v GROUP BY 1 HAVING count(*) >= {50 if FULL else 10} ORDER BY poor_share DESC LIMIT 100
""")
display({"application/json": {
    "dataset": {**DATASET, "note": "all measurements" if FULL else "every 10th measurement"},
    "period": "2026-09-01 to 2026-09-30",
    "thresholds": {"LCP_good_ms": 2500, "LCP_poor_ms": 4000, "INP_good_ms": 200, "INP_poor_ms": 500, "CLS_good": 0.1, "CLS_poor": 0.25},
    "metric_names": names,
    "summary": records(summary),
    "daily": records(daily),
    "devices": records(devices),
    "ratings": records(ratings),
    "pages": records(pages.drop(columns=["p75"])),
}}, raw=True)
