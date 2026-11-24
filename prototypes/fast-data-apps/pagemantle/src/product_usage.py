# title: Product usage
# description: How customers use PageMantle, from PostHog product events in September 2026: which features each workspace uses, daily activity per feature, use by plan, segment and use case, devices, and publishing outcomes.
con.execute(f"""
CREATE TEMP VIEW ev AS
SELECT
  CAST(timestamp AS TIMESTAMP)::DATE AS day,
  event_family AS feature, event_name AS event, workspace_id, person_id,
  json_extract_string(workspace_properties_json, '$.plan') AS plan,
  json_extract_string(workspace_properties_json, '$.customer_segment') AS segment,
  json_extract_string(workspace_properties_json, '$.primary_use_case') AS use_case,
  json_extract_string(workspace_properties_json, '$.region') AS region,
  json_extract_string(properties_json, '$."$device_type"') AS device
FROM {pq('posthog/events')}
WHERE workspace_id IS NOT NULL AND {in_sample('workspace_id')}
""")
con.execute("CREATE TEMP TABLE e AS SELECT * FROM ev")
labels = {
    "navigation": "Navigation", "editing": "Editor", "preview": "Preview", "integrations": "Integrations",
    "domains": "Custom domains", "forms": "Forms", "analytics": "Analytics reports", "collaboration": "Collaboration",
    "localization": "Localization", "feature_flags": "Feature flags", "publish": "Publishing", "ai": "AI assistant",
    "onboarding": "Onboarding",
}
active = one("SELECT count(DISTINCT workspace_id) FROM e")
features = q(f"""
SELECT feature, count(*) AS events, count(DISTINCT workspace_id) AS workspaces, count(DISTINCT person_id) AS people,
  round(count(DISTINCT workspace_id) / {active}, 4) AS adoption,
  round(count(*) / count(DISTINCT workspace_id), 1) AS events_per_workspace
FROM e WHERE feature NOT IN ('feature_flags') GROUP BY 1 ORDER BY workspaces DESC
""")
features["feature"] = features.feature.map(labels).fillna(features.feature)
daily = q("""
SELECT day::VARCHAR AS day, feature, count(*) AS events, count(DISTINCT workspace_id) AS workspaces
FROM e WHERE feature NOT IN ('feature_flags', 'onboarding') GROUP BY ALL ORDER BY 1, 2
""")
daily["feature"] = daily.feature.map(labels).fillna(daily.feature)
by_plan = q("""
SELECT plan, feature, count(DISTINCT workspace_id) AS workspaces, count(*) AS events
FROM e WHERE feature NOT IN ('feature_flags', 'onboarding', 'navigation') GROUP BY ALL
""")
plan_size = q("SELECT plan, count(DISTINCT workspace_id) AS plan_workspaces FROM e GROUP BY 1")
by_plan = by_plan.merge(plan_size, on="plan")
by_plan["adoption"] = (by_plan.workspaces / by_plan.plan_workspaces).round(4)
by_plan["feature"] = by_plan.feature.map(labels).fillna(by_plan.feature)
workspaces = q("""
SELECT workspace_id, any_value(plan) AS plan, any_value(segment) AS segment, any_value(use_case) AS use_case,
  any_value(region) AS region,
  count(*) AS events, count(DISTINCT day) AS active_days, count(DISTINCT person_id) AS people,
  count(DISTINCT feature) AS features_used,
  count(*) FILTER (WHERE feature = 'editing') AS edits,
  count(*) FILTER (WHERE event = 'publish_completed') AS publishes,
  count(*) FILTER (WHERE event = 'publish_failed') AS failed_publishes,
  count(*) FILTER (WHERE feature = 'ai') AS ai_actions,
  count(*) FILTER (WHERE day > DATE '2026-09-16') AS events_last_14d,
  count(*) FILTER (WHERE day BETWEEN DATE '2026-09-03' AND DATE '2026-09-16') AS events_prior_14d
FROM e GROUP BY 1 ORDER BY events DESC
""")
use_cases = q("""
SELECT use_case, count(DISTINCT workspace_id) AS workspaces, count(*) AS events,
  round(count(*) / count(DISTINCT workspace_id), 0) AS events_per_workspace
FROM e GROUP BY 1 ORDER BY workspaces DESC
""")
devices = q("SELECT coalesce(device, 'Unknown') AS device, count(*) AS events, count(DISTINCT person_id) AS people FROM e GROUP BY 1 ORDER BY 2 DESC")
publishing = q("""
SELECT day::VARCHAR AS day,
  count(*) FILTER (WHERE event = 'publish_started') AS started,
  count(*) FILTER (WHERE event = 'publish_completed') AS completed,
  count(*) FILTER (WHERE event = 'publish_failed') AS failed
FROM e WHERE feature = 'publish' GROUP BY 1 ORDER BY 1
""")
publishing["success_rate"] = (publishing.completed / (publishing.completed + publishing.failed)).round(4)
display({"application/json": {
    "dataset": {**DATASET, "note": "all workspaces" if FULL else "every 10th workspace"},
    "period": "2026-09-01 to 2026-09-30",
    "summary": {
        "active_workspaces": int(active),
        "active_people": int(one("SELECT count(DISTINCT person_id) FROM e")),
        "events": int(one("SELECT count(*) FROM e")),
        "publish_success_rate": round(float(publishing.completed.sum() / (publishing.completed.sum() + publishing.failed.sum())), 4),
    },
    "features": records(features),
    "daily": records(daily),
    "feature_by_plan": records(by_plan),
    "workspaces": records(workspaces),
    "use_cases": records(use_cases),
    "devices": records(devices),
    "publishing_daily": records(publishing),
}}, raw=True)
