# cspell:ignore closedate createdate dealname dealtype dprops jobtitle lcols lifecyclestage lprops newbusiness
# title: Sales
# description: HubSpot sales: every won deal with owner, team, segment, deal type (new or existing customer), amount and days to close, monthly bookings, owner performance, and open leads with their last and next activity and recent engagement.
con.execute(f"ATTACH '{db('hubspot/hubspot.sqlite')}' AS hs (TYPE sqlite, READ_ONLY)")
dprops = ["dealname", "amount", "closedate", "createdate", "dealtype", "customer_segment", "days_to_close", "sales_motion",
          "hubspot_owner_id", "hubspot_team_id", "pipeline", "billing_cadence", "pricing_model", "contract_annual_value",
          "commitment_months", "hs_last_sales_activity_type", "next_step"]
cols = ",\n".join(f"max(value) FILTER (WHERE property_name = '{p}') AS {p}" for p in dprops)
deals = q(f"""
WITH d AS (SELECT record_id, {cols} FROM hs.property_values WHERE object_type = 'deals' GROUP BY record_id)
SELECT d.record_id AS deal_id, dealname AS deal,
  TRY_CAST(amount AS DOUBLE) AS amount,
  TRY_CAST(contract_annual_value AS DOUBLE) AS annual_value,
  CAST(CAST(closedate AS TIMESTAMP) AS DATE)::VARCHAR AS close_date,
  strftime(CAST(closedate AS TIMESTAMP), '%Y-%m') AS close_month,
  strftime(CAST(closedate AS TIMESTAMP), '%Y') || '-Q' || quarter(CAST(closedate AS TIMESTAMP)) AS close_quarter,
  CASE WHEN dealtype = 'newbusiness' THEN 'First-time' ELSE 'Repeat' END AS sale_type,
  dealtype AS deal_type, customer_segment AS segment, sales_motion, pipeline,
  coalesce(TRY_CAST(days_to_close AS DOUBLE), date_diff('day', CAST(createdate AS TIMESTAMP), CAST(closedate AS TIMESTAMP))) AS days_to_close, billing_cadence, pricing_model,
  TRY_CAST(commitment_months AS INT) AS commitment_months,
  o.first_name || ' ' || o.last_name AS owner, t.name AS team
FROM d LEFT JOIN hs.owners o ON o.id = d.hubspot_owner_id LEFT JOIN hs.teams t ON t.id = d.hubspot_team_id
ORDER BY close_date DESC
""")
monthly = deals.groupby(["close_month", "sale_type"]).agg(deals=("deal_id", "size"), bookings=("amount", "sum")).reset_index()
owners = deals.groupby(["owner", "team"]).agg(
    deals=("deal_id", "size"), bookings=("amount", "sum"), avg_deal=("amount", "mean"),
    median_days_to_close=("days_to_close", "median"),
    repeat_share=("sale_type", lambda s: (s == "Repeat").mean()),
).reset_index().sort_values("bookings", ascending=False)
teams = deals.groupby("team").agg(deals=("deal_id", "size"), bookings=("amount", "sum"), avg_deal=("amount", "mean"),
                                   median_days_to_close=("days_to_close", "median")).reset_index()
lprops = ["firstname", "lastname", "jobtitle", "company", "email", "hs_lead_status", "lifecyclestage", "customer_segment",
          "hubspot_owner_id", "page_views_30d", "sessions_30d", "event_completions_30d", "notes_last_contacted",
          "notes_next_activity_date", "hs_analytics_source", "buying_role", "crm_touch_count", "createdate"]
lcols = ",\n".join(f"max(value) FILTER (WHERE property_name = '{p}') AS {p}" for p in lprops)
leads = q(f"""
WITH c AS (
  SELECT record_id, {lcols} FROM hs.property_values
  WHERE object_type = 'contacts' AND record_id IN (
    SELECT record_id FROM hs.property_values WHERE object_type = 'contacts' AND property_name = 'hs_lead_status' AND value <> ''
  ) GROUP BY record_id
)
SELECT record_id AS contact_id, firstname || ' ' || lastname AS contact, jobtitle AS title, company,
  replace(lower(hs_lead_status), '_', ' ') AS lead_status, customer_segment AS segment, buying_role,
  replace(lower(hs_analytics_source), '_', ' ') AS source,
  TRY_CAST(page_views_30d AS INT) AS page_views_30d, TRY_CAST(sessions_30d AS INT) AS sessions_30d,
  TRY_CAST(event_completions_30d AS INT) AS actions_30d, TRY_CAST(crm_touch_count AS INT) AS touches,
  TRY_CAST(notes_last_contacted AS TIMESTAMP)::DATE::VARCHAR AS last_contacted,
  date_diff('day', TRY_CAST(notes_last_contacted AS TIMESTAMP)::DATE, DATE '2026-09-30') AS days_since_contact,
  TRY_CAST(notes_next_activity_date AS TIMESTAMP)::DATE::VARCHAR AS next_activity,
  o.first_name || ' ' || o.last_name AS owner
FROM c LEFT JOIN hs.owners o ON o.id = c.hubspot_owner_id
""")
leads["lead_status"] = leads.lead_status.str.capitalize()
stage_order = ["New signal", "Outreach queued", "Attempting contact", "Connected", "Conversation started",
               "Discovery booked", "Evaluation active", "Commercially qualified", "Not a fit"]
leads["stage_rank"] = leads.lead_status.map({s: i for i, s in enumerate(stage_order)})
# Follow-up priority: engaged recently, not contacted lately, further along, no next step booked.
leads["follow_up_score"] = (
    leads.sessions_30d.fillna(0).clip(upper=30) * 2
    + leads.days_since_contact.fillna(60).clip(upper=60)
    + leads.stage_rank.fillna(0) * 5
    + leads.next_activity.isna() * 15
).where(leads.lead_status != "Not a fit", 0).round(0)
activities = q("""
SELECT strftime(CAST(occurred_at AS TIMESTAMP), '%Y-%m') AS month, activity_type, count(*) AS activities
FROM hs.activities WHERE occurred_at IS NOT NULL GROUP BY ALL ORDER BY 1
""")
display({"application/json": {
    "dataset": {**DATASET, "note": "all deals and leads (HubSpot deals are few, so sample and full match)"},
    "as_of": "2026-09-30",
    "summary": {
        "won_deals": int(len(deals)), "bookings": round(float(deals.amount.sum()), 0),
        "avg_deal": round(float(deals.amount.mean()), 0),
        "median_days_to_close": float(deals.days_to_close.median()),
        "repeat_share": round(float((deals.sale_type == "Repeat").mean()), 3),
        "open_leads": int((leads.lead_status != "Not a fit").sum()),
    },
    "deals": records(deals),
    "bookings_monthly": records(monthly.round(0)),
    "owners": records(owners.round(3)),
    "teams": records(teams.round(1)),
    "leads": records(leads.sort_values("follow_up_score", ascending=False).drop(columns="stage_rank")),
    "activities_monthly": records(activities),
}}, raw=True)
