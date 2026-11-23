// Reproduce the Lindquett Software business demos from their notebook snapshots.
// Prompts describe what each app is for (from examples/lindquett-software/README.md),
// not how the original page is laid out.
export const LINDQUETT = [
  {
    id: 'revenue-review',
    snapshot: 'revenue-review',
    request:
      "Revenue review for leadership and RevOps: headline KPIs (NRR, ending ARR, churned ARR, pipeline coverage) with changes vs the prior quarter, the ARR bridge for the quarter, net revenue retention by region over time, and the accounts that moved ARR most. Use the notebook's story sentences as headings.",
  },
  {
    id: 'deal-desk',
    snapshot: 'deal-desk',
    request:
      'Renewal deal desk for account managers: the quote for the selected account (proposed vs current ARR, churn risk, how the price was built from current ARR through uplift and term discount, and the reasons), the account facts, and the renewal book they can search, plus the largest renewals.',
  },
  {
    id: 'account-health',
    snapshot: 'account-health',
    request:
      'Account health for customer success: how many accounts are at risk of churning and how much ARR, the accounts that crossed the risk threshold this month, and a searchable highest-risk-first list where clicking an account shows why it scored what it did.',
  },
  {
    id: 'data-health',
    snapshot: 'data-health',
    request:
      "Data health page for anyone reading a dashboard: are the revenue numbers safe to use right now, how many checks and tables pass, each table's status, and every check with its result and detail.",
  },
  {
    id: 'pricing-planner',
    snapshot: 'pricing-planner',
    request:
      'Pricing scenario planner for finance: sliders for the price increase legacy accounts get at renewal per segment (Enterprise default 0%, Mid-market and SMB default 8%), extra monthly churn per 1% increase (default 0.15 points), and a 12 or 24 month horizon. Project ARR month by month with prices unchanged vs with the increase (monthly net retention = 1 - churn - contraction + expansion), show the ARR difference at the horizon, and break it down by segment and price plan.',
  },
]
