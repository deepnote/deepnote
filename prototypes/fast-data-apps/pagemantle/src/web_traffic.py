# title: Website traffic
# description: Website sessions from Google Analytics for September 2026 (the period the export covers): daily traffic, channels, campaigns, devices, landing pages, countries, new and returning visitors, and time of day.
con.execute(f"""
CREATE TEMP TABLE s AS
SELECT date, day_of_week, hour, host_name, landing_page_path, landing_page_title, content_group,
  session_default_channel_group AS channel, session_source AS source, session_medium AS medium,
  session_campaign_name AS campaign, country, device_category AS device, browser, operating_system AS os,
  new_or_returning, plan_tier,
  session_count, active_user_count, new_user_count, returning_user_count, engaged_session_count,
  engagement_duration_seconds, view_count, key_event_count, key_event_session_count, transaction_count, total_revenue
FROM {pq('analytics/sessions')}
WHERE {in_sample('row_id')}
""")
M = """sum(session_count) AS sessions, sum(active_user_count) AS users, sum(new_user_count) AS new_users,
  round(sum(engaged_session_count) / nullif(sum(session_count), 0), 4) AS engagement_rate,
  round(sum(key_event_session_count) / nullif(sum(session_count), 0), 4) AS conversion_rate,
  sum(key_event_count) AS conversions,
  round(sum(engagement_duration_seconds) / nullif(sum(session_count), 0), 1) AS avg_engagement_seconds,
  round(sum(view_count) / nullif(sum(session_count), 0), 2) AS views_per_session"""
daily = q(f"SELECT date::VARCHAR AS day, {M} FROM s GROUP BY 1 ORDER BY 1")
daily_channel = q("SELECT date::VARCHAR AS day, channel, sum(session_count) AS sessions, sum(key_event_count) AS conversions FROM s GROUP BY ALL ORDER BY 1, 2")
daily_device = q("SELECT date::VARCHAR AS day, device, sum(session_count) AS sessions, round(sum(key_event_session_count) / nullif(sum(session_count), 0), 4) AS conversion_rate, round(sum(engaged_session_count) / nullif(sum(session_count), 0), 4) AS engagement_rate FROM s GROUP BY ALL ORDER BY 1, 2")
channels = q(f"SELECT channel, {M} FROM s GROUP BY 1 ORDER BY sessions DESC")
sources = q(f"SELECT source, medium, channel, {M} FROM s GROUP BY ALL ORDER BY sessions DESC LIMIT 40")
campaigns = q(f"SELECT campaign, channel, {M} FROM s WHERE campaign IS NOT NULL AND campaign NOT IN ('(not set)', '(direct)', '(organic)', '(referral)') GROUP BY ALL ORDER BY sessions DESC")
devices = q(f"SELECT device, {M} FROM s GROUP BY 1 ORDER BY sessions DESC")
device_os = q(f"SELECT device, os, browser, {M} FROM s GROUP BY ALL ORDER BY sessions DESC LIMIT 40")
pages = q(f"SELECT landing_page_path AS page, any_value(landing_page_title) AS title, any_value(content_group) AS content_group, {M} FROM s GROUP BY 1 ORDER BY sessions DESC LIMIT {200 if FULL else 80}")
countries = q(f"SELECT country, {M} FROM s GROUP BY 1 ORDER BY sessions DESC LIMIT 25")
visitors = q(f"SELECT new_or_returning AS visitor, {M} FROM s GROUP BY 1 ORDER BY sessions DESC")
visitors_daily = q("SELECT date::VARCHAR AS day, new_or_returning AS visitor, sum(session_count) AS sessions, round(sum(key_event_session_count) / nullif(sum(session_count), 0), 4) AS conversion_rate FROM s GROUP BY ALL ORDER BY 1")
returning_by_channel = q("""
SELECT channel, sum(session_count) FILTER (WHERE new_or_returning = 'returning') AS returning_sessions,
  sum(session_count) AS sessions,
  round(sum(session_count) FILTER (WHERE new_or_returning = 'returning') / sum(session_count), 4) AS returning_share
FROM s GROUP BY 1 ORDER BY sessions DESC
""")
hourly = q("SELECT day_of_week, hour, sum(session_count) AS sessions FROM s GROUP BY ALL ORDER BY 1, 2")
sites = q(f"SELECT host_name AS site, {M} FROM s GROUP BY 1 ORDER BY sessions DESC")
tot = q(f"SELECT {M} FROM s").iloc[0]
first, second = daily.iloc[:15].sessions.sum(), daily.iloc[15:].sessions.sum()
display({"application/json": {
    "dataset": {**DATASET, "note": "all session rows" if FULL else "every 10th session row (totals are about a tenth)"},
    "period": "2026-09-01 to 2026-09-30",
    "summary": {
        "sessions": int(tot.sessions), "users": int(tot.users), "new_users": int(tot.new_users),
        "engagement_rate": float(tot.engagement_rate), "conversion_rate": float(tot.conversion_rate),
        "conversions": int(tot.conversions),
        "second_half_change": round(float(second / first - 1), 4),
    },
    "daily": records(daily),
    "daily_by_channel": records(daily_channel),
    "daily_by_device": records(daily_device),
    "channels": records(channels),
    "sources": records(sources),
    "campaigns": records(campaigns),
    "devices": records(devices),
    "device_os": records(device_os),
    "landing_pages": records(pages),
    "countries": records(countries),
    "visitors": records(visitors),
    "visitors_daily": records(visitors_daily),
    "returning_by_channel": records(returning_by_channel),
    "hourly": records(hourly),
    "sites": records(sites),
}}, raw=True)
