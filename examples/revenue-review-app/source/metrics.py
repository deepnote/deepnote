def arr_movements(mrr, region="All", segment="All"):
    """ARR movements per quarter, in USD.

    ARR is 12 x month-end MRR. Each account's month-over-month ARR change is classified as
    new (first revenue), expansion (up), contraction (down, still paying) or churn (to zero),
    and the monthly changes are summed per quarter.
    """
    import pandas as pd

    df = mrr
    if region != "All":
        df = df[df["region"] == region]
    if segment != "All":
        df = df[df["segment"] == segment]
    arr = df.pivot_table(index="account_id", columns="month", values="mrr", aggfunc="sum", fill_value=0.0) * 12
    arr = arr.reindex(columns=sorted(mrr["month"].unique()), fill_value=0.0)
    prev = arr.shift(1, axis=1).fillna(0.0)
    paid_before = arr.cummax(axis=1).shift(1, axis=1).fillna(0.0) > 0
    delta = (arr - prev).iloc[:, 1:]
    kinds = {
        "New": (~paid_before & (arr > 0)).iloc[:, 1:],
        "Expansion": ((prev > 0) & (arr > 0)).iloc[:, 1:] & (delta > 0),
        "Contraction": ((prev > 0) & (arr > 0)).iloc[:, 1:] & (delta < 0),
        "Churn": ((prev > 0) & (arr == 0)).iloc[:, 1:],
    }
    rows = []
    for kind, mask in kinds.items():
        monthly = delta.where(mask, 0.0).sum(axis=0)
        quarterly = monthly.groupby(pd.PeriodIndex(monthly.index, freq="Q")).sum()
        for q, value in quarterly.items():
            rows.append({"quarter": f"{q.year}-Q{q.quarter}", "movement": kind, "arr_change": round(float(value), 2)})
    return pd.DataFrame(rows)


def arr_bridge(mrr, quarter, region="All", segment="All"):
    """Starting ARR -> new, expansion, contraction, churn -> ending ARR for one quarter ('2026-Q3')."""
    import pandas as pd

    df = mrr
    if region != "All":
        df = df[df["region"] == region]
    if segment != "All":
        df = df[df["segment"] == segment]
    q = pd.Period(quarter.replace("-", ""), freq="Q")
    start_month = (q.asfreq("M", "start") - 1).to_timestamp()
    end_month = q.asfreq("M", "end").to_timestamp()
    starting = float(df.loc[df["month"] == start_month, "mrr"].sum() * 12)
    ending = float(df.loc[df["month"] == end_month, "mrr"].sum() * 12)
    months = [m for m in sorted(mrr["month"].unique()) if start_month <= m <= end_month]
    arr = df.pivot_table(index="account_id", columns="month", values="mrr", aggfunc="sum", fill_value=0.0) * 12
    arr = arr.reindex(columns=sorted(mrr["month"].unique()), fill_value=0.0)
    paid_before = arr.cummax(axis=1).shift(1, axis=1).fillna(0.0) > 0
    arr, paid_before = arr[months], paid_before[months]
    prev = arr.shift(1, axis=1).iloc[:, 1:]
    cur, paid_before = arr.iloc[:, 1:], paid_before.iloc[:, 1:]
    delta = cur - prev
    moves = {
        "New": float(delta.where(~paid_before & (cur > 0), 0.0).sum().sum()),
        "Expansion": float(delta.where((prev > 0) & (cur > 0) & (delta > 0), 0.0).sum().sum()),
        "Contraction": float(delta.where((prev > 0) & (cur > 0) & (delta < 0), 0.0).sum().sum()),
        "Churn": float(delta.where((prev > 0) & (cur == 0), 0.0).sum().sum()),
    }
    steps = [("Starting ARR", starting)] + [(k, float(moves.get(k, 0.0))) for k in ["New", "Expansion", "Contraction", "Churn"]]
    steps.append(("Ending ARR", ending))
    return pd.DataFrame(steps, columns=["step", "arr"])


def retention(mrr, quarter, region="All", segment="All"):
    """Trailing-twelve-month net and gross revenue retention at the end of a quarter.

    Cohort: accounts paying 12 months before the quarter end. NRR = their ARR now / their ARR then.
    GRR caps each account at its starting ARR, so expansion cannot hide churn and contraction.
    """
    import pandas as pd

    df = mrr
    if region != "All":
        df = df[df["region"] == region]
    if segment != "All":
        df = df[df["segment"] == segment]
    q = pd.Period(quarter.replace("-", ""), freq="Q")
    end_month = q.asfreq("M", "end")
    then = df[df["month"] == (end_month - 12).to_timestamp()].groupby("account_id")["mrr"].sum() * 12
    now = df[df["month"] == end_month.to_timestamp()].groupby("account_id")["mrr"].sum() * 12
    now = now.reindex(then.index, fill_value=0.0)
    base = float(then.sum())
    if base == 0:
        return {"nrr": None, "grr": None, "cohort_arr": 0.0, "cohort_accounts": 0}
    return {
        "nrr": float(now.sum() / base),
        "grr": float(now.clip(upper=then).sum() / base),
        "cohort_arr": base,
        "cohort_accounts": int(len(then)),
    }


def retention_trend(mrr, segment="All", quarters=6):
    """NRR by region for the last `quarters` quarters, long format for charting."""
    import pandas as pd

    df = mrr if segment == "All" else mrr[mrr["segment"] == segment]
    by_month = df.groupby(["month", "region", "account_id"])["mrr"].sum() * 12
    last = pd.Period(mrr["month"].max(), freq="Q")
    rows = []
    for q in pd.period_range(last - quarters + 1, last, freq="Q"):
        end_month = q.asfreq("M", "end")
        then_month, now_month = (end_month - 12).to_timestamp(), end_month.to_timestamp()
        for region in sorted(df["region"].unique()):
            try:
                then = by_month.loc[(then_month, region)]
            except KeyError:
                continue
            try:
                now = by_month.loc[(now_month, region)].reindex(then.index, fill_value=0.0)
            except KeyError:
                now = then * 0
            if then.sum() > 0:
                rows.append({"quarter": f"{q.year}-Q{q.quarter}", "region": region, "nrr": round(float(now.sum() / then.sum()), 4)})
    return pd.DataFrame(rows)


def top_movers(mrr, quarter, region="All", segment="All", n=8):
    """Accounts with the largest absolute ARR change during a quarter."""
    import pandas as pd

    df = mrr
    if region != "All":
        df = df[df["region"] == region]
    if segment != "All":
        df = df[df["segment"] == segment]
    q = pd.Period(quarter.replace("-", ""), freq="Q")
    start_month = (q.asfreq("M", "start") - 1).to_timestamp()
    end_month = q.asfreq("M", "end").to_timestamp()
    info = df.drop_duplicates("account_id").set_index("account_id")[["account", "region", "segment"]]
    start = df[df["month"] == start_month].groupby("account_id")["mrr"].sum() * 12
    end = df[df["month"] == end_month].groupby("account_id")["mrr"].sum() * 12
    both = pd.concat([start.rename("arr_start"), end.rename("arr_end")], axis=1).fillna(0.0)
    both["arr_change"] = both["arr_end"] - both["arr_start"]
    both["movement"] = "Expansion"
    both.loc[both["arr_change"] < 0, "movement"] = "Contraction"
    both.loc[both["arr_end"] == 0, "movement"] = "Churn"
    both.loc[both["arr_start"] == 0, "movement"] = "New"
    both = both[both["arr_change"] != 0].join(info)
    both = both.reindex(both["arr_change"].abs().sort_values(ascending=False).index).head(n)
    return both.reset_index()[["account", "region", "segment", "movement", "arr_start", "arr_end", "arr_change"]]


def pipeline_coverage(opportunities, quarter, region="All", segment="All"):
    """Open pipeline at the start of a quarter divided by that quarter's new-business ARR target."""
    df = opportunities[opportunities["quarter"] == quarter]
    if region != "All":
        df = df[df["region"] == region]
    if segment != "All":
        df = df[df["segment"] == segment]
    target = float(df.drop_duplicates(["region", "segment"])["target"].sum())
    pipeline = float(df["amount"].sum())
    weighted = float((df["amount"] * df["probability"]).sum())
    return {
        "pipeline": pipeline,
        "weighted_pipeline": weighted,
        "target": target,
        "coverage": pipeline / target if target else None,
    }
