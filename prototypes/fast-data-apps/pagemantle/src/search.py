# title: Google search
# description: Google Search Console for September 2026: daily clicks, impressions, click-through rate and position, queries and pages with the most room to grow, devices, countries and indexing status.
daily = q(f"SELECT date::VARCHAR AS day, clicks, impressions, round(ctr, 4) AS ctr, round(position, 2) AS position FROM read_parquet('{ROOT}/search_console/daily-summary.parquet') ORDER BY 1")
# Typical click-through rate by position on page one, to size the opportunity of each query.
expected = {1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.025}
queries = q(f"""
SELECT query_text AS query, query_type, clicks, impressions, round(ctr, 4) AS ctr, round(position, 1) AS position
FROM read_parquet('{ROOT}/search_console/query-summary.parquet')
WHERE NOT privacy_hidden
""")
# Opportunity: extra monthly clicks if the query reached the top 3, at the click-through rate this
# site's own top-3 non-brand queries get.
top3 = queries[(queries.position <= 3) & (queries.query_type != "brand")]
target_ctr = float((top3.clicks.sum() / top3.impressions.sum()) if len(top3) else expected[3])
queries["opportunity_clicks"] = (
    (queries.impressions * (target_ctr - queries.ctr)).clip(lower=0).where(queries.position > 3, 0).round(0)
)
queries["status"] = queries.position.map(
    lambda p: "Top 3" if p <= 3 else "Positions 4–6" if p <= 6 else "Positions 7–10" if p <= 10 else "Page two" if p <= 20 else "Beyond page two"
)
if not FULL:  # the sample keeps the queries with the most clicks or the most room to grow
    queries = queries.loc[queries.clicks.nlargest(150).index.union(queries.opportunity_clicks.nlargest(250).index)]
queries = queries.sort_values("opportunity_clicks", ascending=False)
pages = q(f"""
SELECT url, title, page_type, inspection_verdict AS verdict, coverage_state AS coverage,
  clicks, impressions, round(ctr, 4) AS ctr, round(position, 1) AS position
FROM read_parquet('{ROOT}/search_console/page-summary.parquet')
ORDER BY impressions DESC LIMIT {1500 if FULL else 300}
""")
pages["opportunity_clicks"] = (
    (pages.impressions * (target_ctr - pages.ctr)).clip(lower=0).where(pages.position > 3, 0).round(0)
)
con.execute(f"CREATE TEMP TABLE perf AS SELECT * FROM {pq('search_console/performance')} WHERE {in_sample('source_event_id')}")
devices = q("SELECT device, sum(clicks) AS clicks, sum(impressions) AS impressions, round(sum(clicks) / sum(impressions), 4) AS ctr, round(sum(position_sum) / sum(impressions), 1) AS position FROM perf GROUP BY 1 ORDER BY 2 DESC")
countries = q("SELECT country_code AS country, sum(clicks) AS clicks, sum(impressions) AS impressions, round(sum(clicks) / sum(impressions), 4) AS ctr, round(sum(position_sum) / sum(impressions), 1) AS position FROM perf GROUP BY 1 ORDER BY 2 DESC LIMIT 20")
appearance = q("SELECT search_appearance AS appearance, sum(clicks) AS clicks, sum(impressions) AS impressions, round(sum(clicks) / sum(impressions), 4) AS ctr FROM perf GROUP BY 1 ORDER BY 3 DESC")
query_types = q(f"SELECT query_type, count(*) AS queries, sum(clicks) AS clicks, sum(impressions) AS impressions, round(sum(clicks) / sum(impressions), 4) AS ctr, round(avg(position), 1) AS avg_position FROM read_parquet('{ROOT}/search_console/query-summary.parquet') GROUP BY 1 ORDER BY impressions DESC")
indexing = q(f"SELECT coverage_state AS coverage, inspection_verdict AS verdict, count(*) AS pages FROM read_parquet('{ROOT}/search_console/page-summary.parquet') GROUP BY ALL ORDER BY pages DESC")
tot = daily[["clicks", "impressions"]].sum()
display({"application/json": {
    "dataset": {**DATASET, "note": "all queries and pages" if FULL else "top 400 queries and 300 pages; device and country splits from every 10th row"},
    "period": "2026-09-01 to 2026-09-30",
    "summary": {
        "clicks": int(tot.clicks), "impressions": int(tot.impressions),
        "ctr": round(float(tot.clicks / tot.impressions), 4),
        "avg_position": round(float((daily.position * daily.impressions).sum() / tot.impressions), 2),
        "opportunity_clicks": int(queries.opportunity_clicks.sum()),
        "queries_on_page_two": int((queries.status == "Page two").sum()),
        "top3_ctr": round(target_ctr, 4),
    },
    "daily": records(daily),
    "queries": records(queries),
    "pages": records(pages),
    "devices": records(devices),
    "countries": records(countries),
    "appearance": records(appearance),
    "query_types": records(query_types),
    "indexing": records(indexing),
}}, raw=True)
