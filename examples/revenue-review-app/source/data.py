import numpy as np
import pandas as pd

# Synthetic, deterministic revenue data for a fictional B2B SaaS company ("Lumen Analytics").
AS_OF = pd.Period("2026-09", "M")
MONTHS = pd.period_range("2024-01", AS_OF, freq="M")
rng = np.random.default_rng(20260930)

REGIONS = ["North America", "EMEA", "APAC", "LATAM"]
REGION_WEIGHTS = [0.47, 0.30, 0.15, 0.08]
SEGMENTS = ["Enterprise", "Mid-market", "SMB"]
SEGMENT_WEIGHTS = [0.10, 0.32, 0.58]
INDUSTRIES = ["Retail", "Financial services", "Healthcare", "Logistics", "Manufacturing", "Software", "Media"]
# Lognormal parameters for starting MRR in USD.
START_MRR = {"Enterprise": (9.55, 0.45), "Mid-market": (8.0, 0.4), "SMB": (6.5, 0.45)}
CHURN = {"Enterprise": 0.003, "Mid-market": 0.007, "SMB": 0.014}
EXPAND = {"Enterprise": 0.07, "Mid-market": 0.05, "SMB": 0.025}
CONTRACT = {"Enterprise": 0.025, "Mid-market": 0.02, "SMB": 0.015}

PREFIXES = ["Northwind", "Bluepeak", "Corvid", "Ardent", "Silverline", "Quarry", "Harbor", "Meridian", "Tessel",
            "Orchard", "Granite", "Lattice", "Brightwater", "Fernhill", "Copperleaf", "Ridgeway", "Solano",
            "Aster", "Kinetic", "Pinecrest", "Vantage", "Halden", "Marlow", "Juniper", "Oakmont", "Ember",
            "Westbrook", "Crescent", "Alder", "Summit", "Tidewater", "Larkspur", "Beacon", "Driftwood", "Calder"]
SUFFIXES = ["Labs", "Group", "Systems", "Health", "Logistics", "Retail", "Capital", "Foods", "Energy", "Media",
            "Partners", "Works", "Analytics", "Mobility", "Insurance", "Studios", "Supply", "Bio", "Freight"]

# Named accounts behind the Q3 2026 story. Each event is (month, kind, factor).
STORY = {
    "Vireo Retail Group": ("EMEA", "Enterprise", "Retail", 74_000, [("2026-07", "churn", 0)]),
    "Nordhafen Logistics": ("EMEA", "Enterprise", "Logistics", 96_000, [("2026-08", "set", 0.75)]),
    "Kestrel Bank": ("EMEA", "Enterprise", "Financial services", 61_000, [("2026-09", "set", 0.85)]),
    "Halcyon Health": ("North America", "Enterprise", "Healthcare", 58_000, [("2026-08", "set", 1.6)]),
    "Sakura Mobility": ("APAC", "Enterprise", "Software", 39_000, [("2026-07", "set", 1.35)]),
}


def _names(n):
    pool = [f"{p} {s}{t}" for p in PREFIXES for s in SUFFIXES for t in ["", " International", " Holdings"]]
    rng.shuffle(pool)
    return pool[:n]


def _event_multipliers(region, segment, month, migrated):
    """Shocks that shape the story: the July 2026 EMEA move to the 2026 price list hits migrated accounts."""
    churn = expand = contract = 1.0
    if migrated and month >= pd.Period("2026-07", "M"):
        if segment == "SMB":
            churn, contract = 4.5, 2.4
        elif segment == "Mid-market":
            churn, contract = 3.0, 2.0
    if region == "North America" and month >= pd.Period("2026-01", "M"):
        expand = 1.25
    return churn, expand, contract


def build():
    starts = [MONTHS[0]] * 560 + [m for m in MONTHS[1:] for _ in range(rng.poisson(14 + 0.25 * (m - MONTHS[0]).n))]
    names = _names(len(starts))
    rows, accounts = [], []
    for i, (start, name) in enumerate(zip(starts, names)):
        region = rng.choice(REGIONS, p=REGION_WEIGHTS)
        segment = rng.choice(SEGMENTS, p=SEGMENT_WEIGHTS)
        industry = rng.choice(INDUSTRIES)
        mu, sigma = START_MRR[segment]
        events = {}
        migrated = region == "EMEA" and segment in ("SMB", "Mid-market") and rng.random() < 0.7
        if i < len(STORY):
            name, (region, segment, industry, mrr0, ev) = list(STORY.items())[i]
            mrr = float(mrr0)  # monthly recurring revenue, USD
            migrated = False
            events = {pd.Period(m, "M"): (kind, f) for m, kind, f in ev}
            start = MONTHS[0]
        else:
            mrr = float(np.exp(rng.normal(mu, sigma)))
        account_id = f"ACC-{1000 + i}"
        accounts.append(dict(account_id=account_id, account=name, region=region, segment=segment,
                             industry=industry, customer_since=start.to_timestamp(),
                             price_plan="2026 price list" if migrated and start <= pd.Period("2026-07", "M") else "Legacy"))
        for month in MONTHS[MONTHS.get_loc(start):]:
            if month > start:
                if month in events:
                    kind, f = events[month]
                    mrr = 0.0 if kind == "churn" else mrr * f
                elif not events:
                    c, e, k = _event_multipliers(region, segment, month, migrated and start <= pd.Period("2026-07", "M"))
                    r = rng.random()
                    if r < CHURN[segment] * c:
                        mrr = 0.0
                    elif r < CHURN[segment] * c + EXPAND[segment] * e:
                        mrr *= 1 + rng.uniform(0.05, 0.35)
                    elif r < CHURN[segment] * c + EXPAND[segment] * e + CONTRACT[segment] * k:
                        mrr *= 1 - rng.uniform(0.1, 0.35)
            if mrr <= 0:
                break
            rows.append((account_id, month.to_timestamp(), round(mrr, 2)))
    accounts = pd.DataFrame(accounts)
    mrr = pd.DataFrame(rows, columns=["account_id", "month", "mrr"]).merge(
        accounts[["account_id", "account", "region", "segment"]], on="account_id")
    return accounts, mrr[["account_id", "account", "region", "segment", "month", "mrr"]]


def build_opportunities(mrr):
    """Open pipeline at the start of each quarter, against a new-business target per region and segment."""
    quarters = pd.period_range("2025Q1", "2026Q4", freq="Q")
    coverage_mean = {"North America": 3.3, "EMEA": 3.1, "APAC": 3.0, "LATAM": 2.8}
    stages = [("Discovery", 0.1), ("Evaluation", 0.25), ("Proposal", 0.5), ("Negotiation", 0.75)]
    rows = []
    for q in quarters:
        for region in REGIONS:
            for segment in SEGMENTS:
                base = mrr[(mrr.region == region) & (mrr.segment == segment) & (mrr.month == (q.asfreq("M", "start") - 1).to_timestamp())]
                target = round(base.mrr.sum() * 12 * 0.07, -3)
                cov = coverage_mean[region] * rng.uniform(0.9, 1.1)
                if region == "EMEA" and q >= pd.Period("2026Q4", "Q"):
                    cov = 2.05
                if region == "EMEA" and q == pd.Period("2026Q3", "Q"):
                    cov = 2.6
                pipeline = target * cov
                n = max(3, int(pipeline / {"Enterprise": 180_000, "Mid-market": 45_000, "SMB": 9_000}[segment]))
                amounts = rng.dirichlet(np.ones(n)) * pipeline
                for j, amount in enumerate(amounts):
                    stage, prob = stages[rng.integers(0, len(stages))]
                    rows.append(dict(quarter=str(q).replace("Q", "-Q"), region=region, segment=segment,
                                     opportunity_id=f"OPP-{q}-{region[:2].upper()}{segment[:1]}{j:03d}",
                                     stage=stage, probability=prob, amount=round(amount, -2), target=target))
    return pd.DataFrame(rows)


accounts, mrr = build()
opportunities = build_opportunities(mrr)
