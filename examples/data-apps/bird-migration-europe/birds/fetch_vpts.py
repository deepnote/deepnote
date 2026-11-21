"""Download Aloft VPTS monthly CSVs (Sep-Oct 2026) and reduce each radar to per-profile metrics.

Source: s3://aloftdata/baltrad/monthly/{radar}/{yyyy}/{radar}_vpts_{yyyymm}.csv.gz (anonymous, CC BY 4.0)

Cleaning (documented thresholds, also shown in the app):
  - duplicate profiles (same radar/datetime/height from multiple scan tasks) are averaged
  - dens set to 0 where sd_vvp < sd_vvp_threshold (vol2bird: low radial-velocity spread = not birds)
  - gap bins / missing dens inside valid height range count as 0 birds
  - height range: bins whose centre is >= 200 m above the antenna (ground clutter) and <= 4000 m above it
  - bin-level: dens > 1000 birds/km^3 -> treated as contamination, profile dropped
  - profile-level rain filter: profile dropped if >= 25% of valid bins have dbz_all > 15 dBZ
"""
import io, sys, json, concurrent.futures as cf
from pathlib import Path
import numpy as np, pandas as pd, requests

B = "https://aloftdata.s3-eu-west-1.amazonaws.com"
MONTHS = ["202609", "202610"]
OUT = Path(__file__).parent / "processed"; OUT.mkdir(exist_ok=True)
CURTAIN_RADARS = {"czbrd", "czska"}

CLUTTER_M, TOP_M = 200, 4000
DENS_MAX, DBZ_RAIN, RAIN_FRAC = 1000.0, 15.0, 0.25


def radars_for_months():
    cov = pd.read_csv(Path(__file__).parent / "raw/coverage.csv")
    cov = cov[cov.directory.str.startswith("baltrad/hdf5/")]
    p = cov.directory.str.split("/", expand=True)
    cov["radar"], cov["ym"] = p[2], p[3] + p[4]
    s = cov[cov.ym.isin(MONTHS)].groupby(["radar", "ym"]).file_count.sum().unstack().fillna(0)
    return sorted(s[(s > 2000).all(axis=1)].index)


def process(radar):
    frames = []
    for ym in MONTHS:
        url = f"{B}/baltrad/monthly/{radar}/{ym[:4]}/{radar}_vpts_{ym}.csv.gz"
        r = requests.get(url, timeout=120)
        if r.status_code != 200:
            continue
        frames.append(pd.read_csv(io.BytesIO(r.content), compression="gzip",
                                  usecols=["radar", "datetime", "height", "u", "v", "ff", "dens", "dbz_all",
                                           "sd_vvp", "sd_vvp_threshold", "radar_latitude", "radar_longitude",
                                           "radar_height"]))
    if not frames:
        return None
    d = pd.concat(frames)
    meta = dict(radar=radar, lat=float(d.radar_latitude.iloc[0]), lon=float(d.radar_longitude.iloc[0]),
                elev=float(d.radar_height.iloc[0]))
    d["datetime"] = pd.to_datetime(d.datetime, utc=True)
    d = d.replace([np.inf, -np.inf], np.nan)
    d.loc[d.sd_vvp < d.sd_vvp_threshold, "dens"] = 0.0
    d = d.groupby(["datetime", "height"], as_index=False)[["u", "v", "ff", "dens", "dbz_all"]].mean()

    bin_h = float(np.diff(np.sort(d.height.unique()))[0])  # 200 m
    centre_agl = d.height + bin_h / 2 - meta["elev"]
    d = d[(centre_agl >= CLUTTER_M) & (centre_agl <= TOP_M)].copy()
    d["dens"] = d.dens.fillna(0.0)
    dh_km = bin_h / 1000

    g = d.groupby("datetime")
    n_bins = g.height.size()
    bad_dens = g.dens.max() > DENS_MAX
    rain = (d.dbz_all > DBZ_RAIN).groupby(d.datetime).mean() >= RAIN_FRAC
    keep = ~(bad_dens | rain) & (n_bins >= 5)

    d["w"] = d.dens * dh_km                        # birds/km^2 in this bin
    # gap bins can hold birds but lack speed: fill u/v/ff with the profile's density-weighted mean
    has = d.ff.notna() & (d.w > 0)
    d["wf"] = np.where(has, d.w, 0.0)
    for c in ("u", "v", "ff"):
        d["_" + c] = np.where(has, d[c] * d.w, 0.0)
    s = d.groupby("datetime")[["wf", "_u", "_v", "_ff"]].transform("sum")
    for c in ("u", "v", "ff"):
        d[c] = d[c].fillna(s["_" + c] / s.wf.where(s.wf > 0))
    d["ffk"] = d.ff * 3.6                          # km/h (NaN if the whole profile has no speed)
    d["mtr_b"] = d.w * d.ffk                       # birds/km/h through this bin
    d["wu"] = d.w * d.u; d["wv"] = d.w * d.v; d["wh"] = d.w * (d.height + bin_h / 2)
    a = d.groupby("datetime")[["w", "wu", "wv", "wh"]].sum()
    a["mtr_b"] = d.groupby("datetime").mtr_b.sum(min_count=1)
    a.loc[a.w <= 0, "mtr_b"] = 0.0
    prof = pd.DataFrame({
        "radar": radar,
        "vir": a.w, "mtr": a.mtr_b,
        "u": np.where(a.w > 0, a.wu / a.w.where(a.w > 0), np.nan),
        "v": np.where(a.w > 0, a.wv / a.w.where(a.w > 0), np.nan),
        "hmean": np.where(a.w > 0, a.wh / a.w.where(a.w > 0), np.nan),
        "rain": rain.reindex(a.index).values, "bad": bad_dens.reindex(a.index).values,
        "keep": keep.reindex(a.index).values,
    }).reset_index()
    prof.to_parquet(OUT / f"prof_{radar}.parquet")
    if radar in CURTAIN_RADARS:
        d.loc[d.datetime.isin(keep[~keep].index), "dens"] = np.nan
        d[["datetime", "height", "dens", "u", "v"]].to_parquet(OUT / f"curtain_{radar}.parquet")
    meta.update(n_prof=int(len(prof)), dropped_rain=int(prof.rain.sum()), dropped_dens=int(prof.bad.sum()))
    return meta


if __name__ == "__main__":
    radars = radars_for_months()
    print(len(radars), "radars", flush=True)
    metas = []
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(process, r): r for r in radars}
        for f in cf.as_completed(futs):
            r = futs[f]
            try:
                m = f.result()
                if m: metas.append(m)
                print("ok", r, m and m["n_prof"], flush=True)
            except Exception as e:
                print("FAIL", r, repr(e), flush=True)
    json.dump(sorted(metas, key=lambda m: m["radar"]), open(OUT / "radars.json", "w"), indent=1)
    print("done", len(metas))
