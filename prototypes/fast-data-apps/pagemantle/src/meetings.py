# cspell:ignore dayname isodow
# title: Meetings
# description: Company calendar from June to September 2026: every meeting with its length, attendees and person-hours, recurring series, each person's weekly meeting load, and when meetings happen. Person-hours times an hourly cost gives meeting cost.
con.execute(f"ATTACH '{db('calendar/calendar.sqlite')}' AS cal (TYPE sqlite, READ_ONLY)")
con.execute(f"ATTACH '{db('linear/linear.sqlite')}' AS lin (TYPE sqlite, READ_ONLY)")
# Each attendee's calendar holds its own copy of a meeting: keep one copy per title and start time.
con.execute("""
CREATE TEMP TABLE m AS
SELECT * EXCLUDE (copy) FROM (
  SELECT e.calendar_id, e.id, e.summary AS meeting, e.organizer_email,
    to_timestamp(e.start_utc)::TIMESTAMP AS starts,
    CAST(substr(e.start_time, 12, 2) AS INT) AS local_hour,
    (e.end_utc - e.start_utc) / 3600.0 AS hours,
    e.recurring_event_id IS NOT NULL OR EXISTS (SELECT 1 FROM cal.recurrence_rules r WHERE r.event_id = e.id) AS recurring,
    row_number() OVER (PARTITION BY e.summary, e.start_utc ORDER BY e.organizer_email = c.owner_email DESC, e.id) AS copy
  FROM cal.events e JOIN cal.calendars c ON c.id = e.calendar_id
  WHERE e.status = 'confirmed' AND NOT coalesce(CAST(e.all_day AS BOOLEAN), FALSE)
) WHERE copy = 1
""")
con.execute("""
CREATE TEMP TABLE att AS
SELECT DISTINCT m.id AS event_id, a.email, coalesce(u.display_name, a.display_name, a.email) AS person
FROM cal.attendees a
JOIN cal.events e ON e.id = a.event_id
JOIN m ON m.meeting = e.summary AND m.starts = to_timestamp(e.start_utc)::TIMESTAMP
LEFT JOIN cal.users u ON u.email = a.email
WHERE NOT coalesce(CAST(a.resource AS BOOLEAN), FALSE) AND coalesce(a.response_status, '') <> 'declined'
""")
meetings = q("""
WITH n AS (SELECT event_id, count(*) AS attendees FROM att GROUP BY 1)
SELECT m.id AS meeting_id, m.meeting, strftime(m.starts, '%Y-%m-%d') AS day, strftime(m.starts, '%Y-W%V') AS week,
  dayname(m.starts) AS weekday, m.local_hour AS hour, round(m.hours, 2) AS hours,
  coalesce(n.attendees, 0) AS attendees, round(m.hours * coalesce(n.attendees, 0), 2) AS person_hours,
  m.recurring, coalesce(o.display_name, m.organizer_email) AS organizer
FROM m LEFT JOIN n ON n.event_id = m.id LEFT JOIN cal.users o ON o.email = m.organizer_email
ORDER BY day DESC
""")
con.register("meetings_t", meetings)
series = q("""
SELECT meeting, count(*) AS occurrences, round(avg(hours), 2) AS avg_hours, round(avg(attendees), 1) AS avg_attendees,
  round(sum(person_hours), 1) AS person_hours, bool_or(recurring) AS recurring
FROM meetings_t
GROUP BY 1 ORDER BY person_hours DESC
""")
people = q("""
SELECT a.person, any_value(lu.title) AS title,
  count(DISTINCT m.id) AS meetings,
  round(sum(m.hours), 1) AS meeting_hours,
  round(sum(m.hours) / (date_diff('day', DATE '2026-06-05', DATE '2026-09-30') / 7.0), 1) AS hours_per_week,
  round(sum(m.hours) FILTER (WHERE m.recurring) / sum(m.hours), 3) AS recurring_share,
  round(avg(m.hours), 2) AS avg_meeting_hours
FROM att a JOIN m ON m.id = a.event_id LEFT JOIN lin.users lu ON lower(lu.email) = lower(a.email)
GROUP BY 1 ORDER BY meeting_hours DESC
""")
people["share_of_week"] = (people.hours_per_week / 40).round(3)
weekly = q("""
SELECT strftime(m.starts, '%Y-W%V') AS week, min(m.starts)::DATE::VARCHAR AS week_start,
  count(DISTINCT m.id) AS meetings, round(sum(m.hours), 1) AS meeting_hours,
  round(sum(m.hours * n), 1) AS person_hours
FROM m JOIN (SELECT event_id, count(*) AS n FROM att GROUP BY 1) c ON c.event_id = m.id
GROUP BY 1 ORDER BY 1
""")
grid = q("""
SELECT dayname(starts) AS weekday, isodow(starts) AS weekday_number, local_hour AS hour, count(*) AS meetings
FROM m GROUP BY ALL ORDER BY 2, 3
""")
sizes = q("""
SELECT CASE WHEN attendees <= 2 THEN '1:1 (2)' WHEN attendees <= 5 THEN 'Small (3–5)' WHEN attendees <= 10 THEN 'Medium (6–10)' ELSE 'Large (11+)' END AS size,
  count(*) AS meetings, round(sum(person_hours), 1) AS person_hours
FROM meetings_t
GROUP BY 1 ORDER BY person_hours DESC
""")
display({"application/json": {
    "dataset": {**DATASET, "note": "all calendars (the calendar is small, so sample and full match)"},
    "period": "2026-06-05 to 2026-09-30",
    "assumptions": {"hourly_cost": 85, "work_hours_per_week": 40},
    "summary": {
        "meetings": int(len(meetings)),
        "person_hours": round(float(meetings.person_hours.sum()), 0),
        "avg_attendees": round(float(meetings.attendees.mean()), 1),
        "avg_hours_per_person_week": round(float(people.hours_per_week.mean()), 1),
        "recurring_share": round(float(meetings[meetings.recurring].person_hours.sum() / meetings.person_hours.sum()), 3),
        "estimated_cost": round(float(meetings.person_hours.sum() * 85), 0),
    },
    "meetings": records(meetings),
    "series": records(series),
    "people": records(people),
    "weekly": records(weekly),
    "time_grid": records(grid),
    "sizes": records(sizes),
}}, raw=True)
