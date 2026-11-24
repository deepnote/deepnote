# title: Website content
# description: Pages customers build on PageMantle: page revisions and new pages over time (2020 to September 2026), content approvals with decisions and time to decide, reviewers, and pages by type and publication state, plus the company's own docs in Notion and their review status.
con.execute(f"CREATE TEMP TABLE rev AS SELECT * FROM {pq('bigquery/product_core/page_revisions')} WHERE {in_sample('site_id')}")
con.execute(f"CREATE TEMP TABLE pg AS SELECT * FROM {pq('bigquery/product_core/pages')} WHERE {in_sample('site_id')}")
con.execute(f"CREATE TEMP TABLE ap AS SELECT * FROM {pq('bigquery/product_core/approvals')} WHERE {in_sample('site_id')}")
monthly = q("""
WITH r AS (SELECT strftime(created_at, '%Y-%m') AS month, count(*) AS revisions, count(DISTINCT page_id) AS pages_edited,
             round(sum(content_size_bytes) / 1e6, 2) AS mb_written FROM rev GROUP BY 1),
     p AS (SELECT strftime(created_at, '%Y-%m') AS month, count(*) AS new_pages, count(*) FILTER (WHERE publication_state = 'published') AS new_published FROM pg GROUP BY 1)
SELECT month, coalesce(revisions, 0) AS revisions, coalesce(pages_edited, 0) AS pages_edited, coalesce(mb_written, 0) AS mb_written,
  coalesce(new_pages, 0) AS new_pages, coalesce(new_published, 0) AS new_published
FROM r FULL JOIN p USING (month) ORDER BY month
""")
by_type = q("""
SELECT pg.page_type, count(DISTINCT pg.page_id) AS pages,
  count(DISTINCT pg.page_id) FILTER (WHERE publication_state = 'published') AS published,
  count(DISTINCT pg.page_id) FILTER (WHERE publication_state = 'draft') AS drafts,
  count(rev.revision_id) AS revisions, round(count(rev.revision_id) / count(DISTINCT pg.page_id), 2) AS revisions_per_page
FROM pg LEFT JOIN rev USING (page_id) GROUP BY 1 ORDER BY pages DESC
""")
type_monthly = q("""
SELECT strftime(rev.created_at, '%Y-%m') AS month, pg.page_type, count(*) AS revisions
FROM rev JOIN pg USING (page_id) WHERE rev.created_at >= TIMESTAMP '2025-10-01' GROUP BY ALL ORDER BY 1
""")
approvals = q(f"""
SELECT approval_id, decision, requested_at::DATE::VARCHAR AS requested, decided_at::DATE::VARCHAR AS decided,
  round(date_diff('minute', requested_at, decided_at) / 60.0, 1) AS hours_to_decide,
  CASE WHEN decision = 'pending' THEN date_diff('day', requested_at::DATE, DATE '2026-09-30') END AS days_waiting,
  reviewer_user_id AS reviewer, requested_by_user_id AS requested_by, site_id
FROM ap ORDER BY requested_at DESC LIMIT {None if FULL else 1500}
""".replace("LIMIT None", ""))
approvals_monthly = q("""
SELECT strftime(requested_at, '%Y-%m') AS month, count(*) AS requests,
  count(*) FILTER (WHERE decision = 'approved') AS approved, count(*) FILTER (WHERE decision = 'rejected') AS rejected,
  count(*) FILTER (WHERE decision = 'pending') AS pending,
  round(median(date_diff('minute', requested_at, decided_at)) / 60.0, 1) AS median_hours_to_decide
FROM ap GROUP BY 1 ORDER BY 1
""")
reviewers = q("""
SELECT reviewer_user_id AS reviewer, count(*) AS reviews, count(*) FILTER (WHERE decision = 'pending') AS pending,
  round(count(*) FILTER (WHERE decision = 'rejected') / nullif(count(*) FILTER (WHERE decision <> 'pending'), 0), 3) AS rejection_rate,
  round(median(date_diff('minute', requested_at, decided_at)) / 60.0, 1) AS median_hours_to_decide
FROM ap GROUP BY 1 ORDER BY reviews DESC LIMIT 50
""")
# The company's own documents in Notion and where each stands in review.
con.execute(f"ATTACH '{db('notion/catalog.sqlite')}' AS nt (TYPE sqlite, READ_ONLY)")
docs = q("""
SELECT p.title, d.title AS collection,
  max(pp.value_text) FILTER (WHERE pp.name = 'Status') AS status,
  max(pp.value_text) FILTER (WHERE pp.name = 'Team') AS team,
  max(pp.value_text) FILTER (WHERE pp.name IN ('Document form', 'Document class')) AS form,
  CAST(p.created_time AS TIMESTAMP)::DATE::VARCHAR AS created,
  CAST(p.last_edited_time AS TIMESTAMP)::DATE::VARCHAR AS last_edited,
  date_diff('day', CAST(p.last_edited_time AS TIMESTAMP)::DATE, DATE '2026-09-30') AS days_since_edit
FROM nt.pages p LEFT JOIN nt.databases d ON d.id = p.database_id LEFT JOIN nt.page_properties pp ON pp.page_id = p.id
WHERE NOT coalesce(CAST(p.archived AS BOOLEAN), FALSE)
GROUP BY ALL HAVING status IN ('Draft', 'In review', 'Published')
ORDER BY last_edited DESC
""")
pend = approvals[approvals.decision == "pending"]
display({"application/json": {
    "dataset": {**DATASET, "note": "all sites" if FULL else "every 10th site"},
    "as_of": "2026-09-30",
    "summary": {
        "pages": int(one("SELECT count(*) FROM pg")),
        "revisions_last_30d": int(one("SELECT count(*) FROM rev WHERE created_at >= TIMESTAMP '2026-09-01'")),
        "approval_requests": int(one("SELECT count(*) FROM ap")),
        "approval_rate": round(float(one("SELECT count(*) FILTER (WHERE decision = 'approved') / count(*) FILTER (WHERE decision <> 'pending') FROM ap")), 4),
        "pending_approvals": int(one("SELECT count(*) FROM ap WHERE decision = 'pending'")),
        "median_hours_to_decide": float(one("SELECT round(median(date_diff('minute', requested_at, decided_at)) / 60.0, 1) FROM ap")),
        "docs_in_review": int((docs.status == "In review").sum()),
    },
    "monthly": records(monthly),
    "page_types": records(by_type),
    "revisions_by_type_monthly": records(type_monthly),
    "approvals": records(approvals),
    "approvals_monthly": records(approvals_monthly),
    "reviewers": records(reviewers),
    "docs": records(docs),
}}, raw=True)
