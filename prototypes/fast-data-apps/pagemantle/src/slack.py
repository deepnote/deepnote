# cspell:ignore dayname
# title: Slack
# description: Slack messages from 2026: how quickly threads get a first reply, by channel, person and time of day, which threads went unanswered, and message volume.
con.execute(f"""
CREATE TEMP TABLE msg AS
SELECT m.channel_id, c.name AS channel, c.is_private, m.ts, m.thread_ts, m.user_id,
  coalesce(u.real_name, u.name, m.user_id) AS person, u.title, coalesce(u.is_bot, m.subtype = 'bot_message') AS bot,
  to_timestamp(CAST(m.ts AS DOUBLE)) AS sent_at
FROM {pq('slack/messages')} m
LEFT JOIN read_parquet('{ROOT}/slack/channels.parquet') c ON c.id = m.channel_id
LEFT JOIN read_parquet('{ROOT}/slack/users.parquet') u ON u.id = m.user_id
WHERE NOT coalesce(c.is_im, FALSE)
""")
# A thread starts with a message that has replies or could have; its first reply from someone else
# gives the response time.
threads = q("""
WITH parents AS (
  SELECT * FROM msg WHERE thread_ts IS NULL OR thread_ts = ts
), first_reply AS (
  SELECT r.channel_id, r.thread_ts, min(r.sent_at) AS replied_at, count(*) AS replies
  FROM msg r JOIN parents p ON p.channel_id = r.channel_id AND p.ts = r.thread_ts
  WHERE r.thread_ts <> r.ts AND r.user_id <> p.user_id
  GROUP BY ALL
)
SELECT p.channel, p.person AS asked_by, strftime(p.sent_at, '%Y-%m-%d') AS day, dayname(p.sent_at) AS weekday, hour(p.sent_at) AS hour,
  coalesce(f.replies, 0) AS replies,
  round(date_diff('second', p.sent_at, f.replied_at) / 60.0, 1) AS minutes_to_reply,
  f.replied_at IS NOT NULL AS answered
FROM parents p LEFT JOIN first_reply f ON f.channel_id = p.channel_id AND f.thread_ts = p.ts
WHERE NOT p.bot
""")
answered = threads[threads.answered]
channels = q("""
SELECT channel, any_value(is_private) AS private, count(*) AS messages, count(DISTINCT user_id) AS people,
  count(*) FILTER (WHERE thread_ts IS NULL OR thread_ts = ts) AS threads
FROM msg GROUP BY 1 ORDER BY messages DESC
""")
by_channel = threads.groupby("channel").agg(
    threads=("answered", "size"), answered=("answered", "sum"),
    median_minutes=("minutes_to_reply", "median"), p90_minutes=("minutes_to_reply", lambda s: s.quantile(0.9)),
).reset_index()
by_channel["answered_rate"] = (by_channel.answered / by_channel.threads).round(3)
by_channel = by_channel.merge(channels[["channel", "messages", "people"]], on="channel").sort_values("threads", ascending=False)
by_channel = by_channel[by_channel.threads >= 10]
responders = q("""
WITH parents AS (SELECT * FROM msg WHERE thread_ts IS NULL OR thread_ts = ts),
firsts AS (
  SELECT r.person, r.title, date_diff('second', p.sent_at, r.sent_at) / 60.0 AS minutes,
    row_number() OVER (PARTITION BY r.channel_id, r.thread_ts ORDER BY r.sent_at) AS n
  FROM msg r JOIN parents p ON p.channel_id = r.channel_id AND p.ts = r.thread_ts
  WHERE r.thread_ts <> r.ts AND r.user_id <> p.user_id AND NOT r.bot
)
SELECT person, any_value(title) AS title, count(*) AS first_replies, round(median(minutes), 1) AS median_minutes
FROM firsts WHERE n = 1 GROUP BY 1 HAVING count(*) >= 3 ORDER BY first_replies DESC
""")
by_hour = answered.groupby("hour").agg(threads=("answered", "size"), median_minutes=("minutes_to_reply", "median")).reset_index()
weekly = q("""
SELECT strftime(sent_at, '%Y-W%V') AS week, min(sent_at)::DATE::VARCHAR AS week_start, count(*) AS messages, count(DISTINCT user_id) AS people
FROM msg GROUP BY 1 ORDER BY 1
""")
display({"application/json": {
    "dataset": {**DATASET, "note": "all channels (Slack is small, so sample and full match)"},
    "summary": {
        "messages": int(one("SELECT count(*) FROM msg")),
        "threads": int(len(threads)),
        "answered_rate": round(float(threads.answered.mean()), 3),
        "median_minutes_to_reply": round(float(answered.minutes_to_reply.median()), 1),
        "p90_minutes_to_reply": round(float(answered.minutes_to_reply.quantile(0.9)), 1),
    },
    "threads": records(threads.sort_values("day", ascending=False).head(None if FULL else 1000)),
    "channels": records(by_channel.round(1)),
    "responders": records(responders),
    "by_hour": records(by_hour.round(1)),
    "weekly": records(weekly),
}}, raw=True)
