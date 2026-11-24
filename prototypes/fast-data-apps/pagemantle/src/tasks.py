# title: Tasks
# description: Linear issues across teams and projects as of September 30, 2026: priority, status, assignee, estimate, due date and age, so work can be ranked and overdue items found.
con.execute(f"ATTACH '{db('linear/linear.sqlite')}' AS lin (TYPE sqlite, READ_ONLY)")
issues = q("""
SELECT i.identifier AS issue, i.title, t.name AS team, p.name AS project, s.name AS status, s.type AS status_type,
  CASE i.priority WHEN 1 THEN 'Urgent' WHEN 2 THEN 'High' WHEN 3 THEN 'Medium' WHEN 4 THEN 'Low' ELSE 'None' END AS priority,
  i.priority AS priority_rank, i.estimate, u.name AS assignee, u.title AS assignee_title,
  CAST(i.due_date AS DATE)::VARCHAR AS due_date,
  CAST(i.created_at AS TIMESTAMP)::DATE::VARCHAR AS created,
  date_diff('day', CAST(i.created_at AS TIMESTAMP)::DATE, DATE '2026-09-30') AS age_days,
  CASE WHEN i.due_date IS NOT NULL THEN date_diff('day', DATE '2026-09-30', CAST(i.due_date AS DATE)) END AS days_until_due,
  (SELECT count(*) FROM lin.comments c WHERE c.issue_id = i.id) AS comments,
  (SELECT count(*) FROM lin.relations r WHERE r.related_issue_id = i.id AND r.type = 'blocks') AS blocking,
  (SELECT string_agg(l.name, ', ') FROM lin.issue_labels il JOIN lin.labels l ON l.id = il.label_id WHERE il.issue_id = i.id) AS labels
FROM lin.issues i
JOIN lin.teams t ON t.id = i.team_id
LEFT JOIN lin.projects p ON p.id = i.project_id
LEFT JOIN lin.workflow_states s ON s.id = i.state_id
LEFT JOIN lin.users u ON u.id = i.assignee_id
WHERE NOT coalesce(CAST(i.archived AS BOOLEAN), FALSE)
ORDER BY i.priority, days_until_due NULLS LAST
""")
open_ = issues[~issues.status_type.isin(["completed", "canceled"])]
open_ = open_.assign(overdue=open_.days_until_due < 0)
# A simple ranking: priority first, then how soon it is due, then how many issues it blocks.
issues["score"] = (
    (5 - issues.priority_rank.clip(1, 4)) * 25
    + issues.days_until_due.apply(lambda d: 0 if d != d else max(0, 30 - d))
    + issues.blocking * 10
).astype(int)
projects = q("""
SELECT p.name AS project, t.name AS team, p.status, CAST(p.target_date AS DATE)::VARCHAR AS target_date,
  count(i.id) AS issues, count(i.id) FILTER (WHERE s.type NOT IN ('completed', 'canceled')) AS open_issues
FROM lin.projects p JOIN lin.teams t ON t.id = p.team_id LEFT JOIN lin.issues i ON i.project_id = p.id
LEFT JOIN lin.workflow_states s ON s.id = i.state_id GROUP BY ALL ORDER BY open_issues DESC
""")
display({"application/json": {
    "dataset": {**DATASET, "note": "all issues (Linear is small, so sample and full match)"},
    "as_of": "2026-09-30",
    "summary": {
        "open_issues": int(len(open_)),
        "urgent_or_high": int(open_.priority_rank.isin([1, 2]).sum()),
        "overdue": int(open_.overdue.sum()),
        "unassigned": int(open_.assignee.isna().sum()),
    },
    "issues": records(issues.sort_values("score", ascending=False)),
    "projects": records(projects),
}}, raw=True)
