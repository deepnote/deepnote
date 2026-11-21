"""Combine radar profiles + wind into the compact dataset embedded in the app (data.json)."""
import json, base64, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd
from astral import Observer
from astral.sun import sun

P = Path(__file__).parent / "processed"
NIGHTS = pd.date_range("2026-09-01", "2026-10-30", freq="D")
HOURS = list(range(17, 24)) + list(range(0, 6))          # map frames, UTC
MIG_DIR = 225.0                                          # autumn: towards SW
TW_UNIT = np.array([np.sin(np.deg2rad(MIG_DIR)), np.cos(np.deg2rad(MIG_DIR))])  # (east, north) towards SW
COVER_KM, CELL_DEG = 150, 0.25
METHOD_HTML = open(Path(__file__).parent / "method.html").read()

EXCLUDE_PREFIX = ("ro",)   # Romanian radars: VIR ~30-100x every other network (p99 > 500 birds/km2) -> calibration/clutter
radars = [r for r in json.load(open(P / "radars.json"))
          if (P / f"prof_{r['radar']}.parquet").exists() and not r["radar"].startswith(EXCLUDE_PREFIX)]
excluded = [r["radar"] for r in json.load(open(P / "radars.json")) if r["radar"].startswith(EXCLUDE_PREFIX)]
rid = [r["radar"] for r in radars]

# ---------- night windows per radar ----------
win = {}
for r in radars:
    obs = Observer(latitude=r["lat"], longitude=r["lon"])
    for d in NIGHTS:
        try:
            s0 = sun(obs, date=d.date(), tzinfo=dt.timezone.utc)["sunset"]
            s1 = sun(obs, date=(d + pd.Timedelta(days=1)).date(), tzinfo=dt.timezone.utc)["sunrise"]
        except ValueError:  # polar edge cases
            continue
        win[(r["radar"], d)] = (pd.Timestamp(s0), pd.Timestamp(s1))

prof = pd.concat(pd.read_parquet(P / f"prof_{x}.parquet") for x in rid)
prof = prof[prof.keep].copy()
prof["datetime"] = pd.to_datetime(prof.datetime, utc=True)

# assign each profile to a night
prof["night"] = (prof.datetime - pd.Timedelta(hours=12)).dt.floor("D").dt.tz_localize(None)
w = pd.DataFrame([(k[0], k[1], v[0], v[1]) for k, v in win.items()], columns=["radar", "night", "sunset", "sunrise"])
prof = prof.merge(w, on=["radar", "night"], how="inner")
prof = prof[(prof.datetime >= prof.sunset) & (prof.datetime < prof.sunrise)]
prof["hour"] = prof.datetime.dt.floor("h")
gs_med = (np.hypot(prof.u, prof.v) * 3.6).groupby([prof.radar, prof.night]).transform("median")
prof["mtr"] = prof.mtr.fillna(prof.vir * gs_med)

# ---------- wind ----------
wr = pd.read_parquet(P / "wind_radars.parquet").rename(columns={"id": "radar"})
wr["uw"], wr["vw"] = (wr.u925 + wr.u850) / 2, (wr.v925 + wr.v850) / 2
wr["tw"] = wr.uw * TW_UNIT[0] + wr.vw * TW_UNIT[1]
wr = wr.rename(columns={"time": "hour"})
prof = prof.merge(wr[["radar", "hour", "uw", "vw", "tw"]], on=["radar", "hour"], how="left")

# ---------- radar-night metrics ----------
def night_stats(g):
    dur = (g.sunrise.iloc[0] - g.sunset.iloc[0]).total_seconds() / 3600
    hrs_cov = g.hour.nunique() / max(dur, 1)
    wgt = g.vir.clip(lower=0)
    has_v = g.u.notna() & (wgt > 0)
    gu = np.average(g.u[has_v], weights=wgt[has_v]) if has_v.any() and wgt[has_v].sum() > 0 else np.nan
    gv = np.average(g.v[has_v], weights=wgt[has_v]) if has_v.any() and wgt[has_v].sum() > 0 else np.nan
    au = np.average((g.u - g.uw)[has_v & g.uw.notna()], weights=wgt[has_v & g.uw.notna()]) if (has_v & g.uw.notna()).any() and wgt[has_v & g.uw.notna()].sum() > 0 else np.nan
    av = np.average((g.v - g.vw)[has_v & g.uw.notna()], weights=wgt[has_v & g.uw.notna()]) if (has_v & g.uw.notna()).any() and wgt[has_v & g.uw.notna()].sum() > 0 else np.nan
    ok = has_v & g.uw.notna() & (wgt > 0)
    gsm = np.average(np.hypot(g.u, g.v)[ok], weights=wgt[ok]) if ok.any() and wgt[ok].sum() > 0 else np.nan
    asm = np.average(np.hypot(g.u - g.uw, g.v - g.vw)[ok], weights=wgt[ok]) if ok.any() and wgt[ok].sum() > 0 else np.nan
    return pd.Series(dict(gsm=gsm, asm=asm,
        mtr_night=g.mtr.mean() * dur if hrs_cov >= 0.6 else np.nan,   # birds crossing 1 km per night
        vir_mean=g.vir.mean(), vir_max=g.vir.max(), cover=hrs_cov, dur=dur,
        tw=g.tw.mean(), uw=g.uw.mean(), vw=g.vw.mean(), gu=gu, gv=gv, au=au, av=av))

rn = prof.groupby(["radar", "night"]).apply(night_stats).reset_index()
rn.to_parquet(P / "radar_nights.parquet")
# radars that (almost) never see birds -> low sensitivity / processing artefact, not "no migration"
SIG_VIR = 1.0
p90 = rn.groupby("radar").vir_mean.quantile(.9)
lowsig = set(p90[p90 < SIG_VIR].index)
rn["lowsig"] = rn.radar.isin(lowsig)
rn["rel"] = rn.mtr_night / rn.groupby("radar").mtr_night.transform("median").clip(lower=1)
rnx = rn[~rn.lowsig]

# ---------- hourly VIR per radar (map frames) ----------
frame_times = []
for d in NIGHTS:
    for h in HOURS:
        t = d + pd.Timedelta(days=1 if h < 12 else 0, hours=h)
        frame_times.append(t.tz_localize("UTC"))
hv = prof.groupby(["radar", "hour"]).agg(vir=("vir", "mean"), u=("u", "mean"), v=("v", "mean"),
                                         mtr=("mtr", "mean")).reset_index()
hv = hv.set_index(["radar", "hour"])

ft_index = {t: i for i, t in enumerate(frame_times)}
F, R = len(frame_times), len(rid)
VIR = np.full((F, R), np.nan); U = np.full((F, R), np.nan); V = np.full((F, R), np.nan)
for (r, t), row in hv.iterrows():
    i = ft_index.get(t)
    if i is not None:
        j = rid.index(r); VIR[i, j], U[i, j], V[i, j] = row.vir, row.u, row.v

for j, r in enumerate(rid):
    if r in lowsig: VIR[:, j] = np.nan; U[:, j] = np.nan; V[:, j] = np.nan
# ---------- Europe-wide birds aloft (nearest-radar cells within 150 km) ----------
lat = np.array([r["lat"] for r in radars]); lon = np.array([r["lon"] for r in radars])
glat, glon = np.meshgrid(np.arange(34, 71.5, CELL_DEG) + CELL_DEG / 2, np.arange(-12, 36, CELL_DEG) + CELL_DEG / 2, indexing="ij")
glat, glon = glat.ravel(), glon.ravel()
def hav(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = map(np.deg2rad, (la1, lo1, la2, lo2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))
D = hav(glat[:, None], glon[:, None], lat[None, :], lon[None, :])     # cells x radars
cell_area = (111.32 * CELL_DEG) ** 2 * np.cos(np.deg2rad(glat))
near = D < COVER_KM
cells = near.any(axis=1)
D, cell_area, near = D[cells], cell_area[cells], near[cells]
covered_km2 = float(cell_area.sum()); DATA_COVER = covered_km2
aloft = np.zeros(F)
for i in range(F):
    ok = ~np.isnan(VIR[i])
    if not ok.any():
        continue
    Dm = np.where(near & ok[None, :], D, np.inf)
    j = Dm.argmin(axis=1); valid = np.isfinite(Dm.min(axis=1))
    aloft[i] = float((VIR[i, j[valid]] * cell_area[valid]).sum())
aloft = aloft.reshape(len(NIGHTS), len(HOURS))

# ---------- night-level Europe summary ----------
nn = rnx.groupby("night").agg(mtr_med=("mtr_night", "median"), mtr_mean=("mtr_night", "mean"),
                             tw=("tw", "mean"), n=("radar", "size")).reindex(NIGHTS)

# ---------- wind grid frames ----------
wg = pd.read_parquet(P / "wind_grid.parquet")
wg["uw"], wg["vw"] = (wg.u925 + wg.u850) / 2, (wg.v925 + wg.v850) / 2
ids = sorted(wg.id.unique(), key=lambda s: (float(s[1:].split("_")[0]), float(s.split("_")[1])))
glats = sorted({float(s[1:].split("_")[0]) for s in ids}); glons = sorted({float(s.split("_")[1]) for s in ids})
wg = wg.set_index(["time", "id"])
WU = np.zeros((F, len(glats), len(glons)), np.int8); WV = np.zeros_like(WU)
for i, t in enumerate(frame_times):
    if t not in wg.index.get_level_values(0):
        continue
    sub = wg.loc[t]
    for k, s in enumerate(ids):
        a, b = glats.index(float(s[1:].split("_")[0])), glons.index(float(s.split("_")[1]))
        WU[i, a, b] = np.clip(np.round(sub.at[s, "uw"] * 2), -127, 127)
        WV[i, a, b] = np.clip(np.round(sub.at[s, "vw"] * 2), -127, 127)

# ---------- binned relationships ----------
rnx = rnx.assign(gs=rnx.gsm, as_=rnx.asm)
def bins_of(df, col, min_n=25, floor=None):
    b = df.assign(x=df.tw.round()).dropna(subset=[col, "x"])
    out = []
    for x, g in b.groupby("x"):
        if len(g) < min_n or not -10 <= x <= 10: continue
        v = g[col].clip(lower=floor) if floor else g[col]
        out.append(dict(x=int(x), med=float(v.median()), q1=float(v.quantile(.25)), q3=float(v.quantile(.75)), n=int(len(g))))
    return out
active = rnx[rnx.vir_mean >= 2]       # speeds only where there are enough birds to measure
bins = dict(mtr=bins_of(rnx, "rel"), gs=bins_of(active, "gs"), as_=bins_of(active, "as_"))
bins["as"] = bins.pop("as_")
bins["speed_dom"] = [0, float(np.ceil(max(d["q3"] for d in bins["gs"] + bins["as"]) / 5) * 5)]

# ---------- story numbers ----------
tot = rnx.groupby("night").mtr_night.sum().reindex(NIGHTS).fillna(0)
top10_share = tot.sort_values(ascending=False).head(10).sum() / tot.sum()
half_nights = int((tot.sort_values(ascending=False).cumsum() < tot.sum() / 2).sum() + 1)
peaks = pd.Series(aloft.max(axis=1), index=NIGHTS)
cover_frac = rnx.groupby("night").radar.size().reindex(NIGHTS).fillna(0) / (len(radars) - len(lowsig))
quiet = peaks[cover_frac >= 0.8].idxmin(); quiet_i = list(NIGHTS).index(quiet)
busy = peaks.idxmax()
tw_hi = rnx[rnx.tw > 3].rel.median(); tw_lo = rnx[rnx.tw < -3].rel.median()
ratio = tw_hi / tw_lo
big = rnx[rnx.rel >= 3]; share_tail_big, share_tail_all = (big.tw > 0).mean(), (rnx.tw > 0).mean()
from scipy.stats import spearmanr
rho_r = rnx.dropna(subset=["tw", "mtr_night"]).groupby("radar").apply(lambda g: spearmanr(g.tw, g.mtr_night).statistic)
rho_med, rho_pos = rho_r.median(), (rho_r > 0).mean()
as_med, gs_lo, gs_hi = active.as_.median(), active[active.tw < -3].gs.median(), active[active.tw > 3].gs.median()
fmtd = lambda d: pd.Timestamp(d).strftime("%-d %B")
def fm(x): return f"{x/1e6:.1f} million" if x >= 1e6 else f"{x/1e3:.0f} thousand"

as_hw, as_tw = active[active.tw < -3].as_.median(), active[active.tw > 3].as_.median()
gs_hw, gs_tw = active[active.tw < -3].gs.median(), active[active.tw > 3].gs.median()

# ---------- extra story numbers ("So what's happening here?") ----------
COUNTRY = dict(be="Belgium", ch="Switzerland", cz="Czechia", de="Germany", dk="Denmark", ee="Estonia", es="Spain",
               fi="Finland", fr="France", hr="Croatia", ie="Ireland", is_="Iceland", lt="Lithuania", nl="Netherlands",
               no="Norway", pt="Portugal", se="Sweden", si="Slovenia", sk="Slovakia", pl="Poland", ro="Romania")
country = lambda r: COUNTRY.get(r[:2], COUNTRY.get(r[:2] + "_", r[:2].upper()))
lat_of = {r["radar"]: r["lat"] for r in radars}
rnl = rnx.assign(lat=rnx.radar.map(lat_of))
def half_night(df):
    t = df.groupby("night").mtr_night.sum().reindex(NIGHTS).fillna(0)
    return t.index[int((t.cumsum() < t.sum() / 2).sum())] if t.sum() > 0 else None
north, south = rnl[rnl.lat >= 58], rnl[(rnl.lat >= 40) & (rnl.lat <= 47)]
hn, hs = half_night(north), half_night(south)
lag = (hs - hn).days if hn is not None and hs is not None else None
# take-off: minutes after sunset when a radar first sees half of that night's peak density
pp = prof[~prof.radar.isin(lowsig)].copy()
pp["since"] = (pp.datetime - pp.sunset).dt.total_seconds() / 60
pp["vmax"] = pp.groupby(["radar", "night"]).vir.transform("max")
lift = pp[(pp.vmax >= 5) & (pp.vir >= 0.5 * pp.vmax)].groupby(["radar", "night"]).since.min()
takeoff = float(lift.median())
peak_hour = HOURS[int(np.argmax(aloft.mean(axis=0)))]
# where the wind link is clearest
clear = rho_r[rho_r >= 0.3]
top_c = pd.Series([country(r) for r in clear.index]).value_counts().head(3).index.tolist()
# which way they flew
act_dir = active.dropna(subset=["gu", "gv"])
track = (np.degrees(np.arctan2(act_dir.gu, act_dir.gv)) + 360) % 360
sw_share = float(((track >= 180) & (track <= 270)).mean())
med_dir = float(np.degrees(np.arctan2(np.average(act_dir.gu, weights=act_dir.vir_mean), np.average(act_dir.gv, weights=act_dir.vir_mean))) % 360)
compass = lambda d: ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][int(round(d / 45)) % 8]
short = lambda x: fm(x).replace(" million", "M").replace(" thousand", "k")
list_words = lambda xs: ", ".join(xs[:-1]) + " and " + xs[-1] if len(xs) > 1 else (xs[0] if xs else "")

findings = [
  dict(title="Migration comes in waves", big=str(half_nights), unit=f"of {len(NIGHTS)} nights carried half the birds",
       body=f"Half of everything the radars counted this autumn flew on just {half_nights} nights, and the ten busiest nights carried {top10_share:.0%}. "
            "A bird can't fly every night: it has to refuel, then wait for the weather to turn. When conditions line up over a large area, birds everywhere leave at once.",
       see="Chapter 1: the tall bars are those wave nights."),
  dict(title="One night, the sky fills up", big=short(peaks.max()), unit="birds in the air at the same moment",
       body=f"At the peak of {fmtd(busy)}, about {fm(peaks.max())} birds were flying at once, and that's only within {COVER_KM} km of a radar. "
            f"On {fmtd(quiet)}, with the same radars watching, the peak was {fm(peaks[quiet])}: {peaks.max()/max(peaks[quiet],1):.0f}× fewer.",
       action="busy", action_label="Play the busiest night on the map"),
  dict(title="Tailwind nights carry the crowd", big=f"{ratio:.1f}×", unit="traffic with a tailwind vs a headwind",
       body=f"A small songbird cruises at only 8–12 m/s, so a good tailwind can almost double its speed on the same fuel. "
            f"Tailwinds blew on {share_tail_all:.0%} of radar-nights but on {share_tail_big:.0%} of the big ones (3× a radar's typical night or more).",
       see="Chapter 2: traffic climbs steadily from headwind to tailwind."),
  dict(title="But the wind doesn't decide everywhere", big=f"{len(clear)}", unit=f"of {int(rho_r.notna().sum())} radars show a clear wind link",
       body=f"At {rho_pos:.0%} of radars more tailwind meant more birds, but the link is clear (rank correlation ≥ 0.3) at only {len(clear)}"
            + (f", most of them in {list_words(top_c)}" if top_c else "") + ". "
            "Elsewhere rain, temperature, the calendar and local geography matter as much as the wind."),
  dict(title="The wave rolls south" if lag is not None and lag >= 3 else "North and south moved together",
       big=f"{lag} days" if lag is not None else "–", unit="between the far north and the south",
       body=(f"Above 58°N, half of the season's birds had passed by {fmtd(hn)}. Between 40 and 47°N, that point came on {fmtd(hs)}, {lag} days later: "
             "the season moving down the continent as birds hop south night by night.") if lag is not None and lag >= 3 else
            "Half of the birds had passed the northern (above 58°N) and southern (40–47°N) radars within a few days of each other. Big weather systems triggered departures across the whole continent at once.",
       see="On the map, step through September and October: the glow drifts from Scandinavia towards Iberia."),
  dict(title="Take-off right after dusk", big=f"{takeoff:.0f} min", unit="after sunset, typical take-off",
       body=f"On a typical night, traffic over a radar reaches half its peak about {takeoff:.0f} minutes after sunset. "
            f"Across Europe, the most birds are aloft around {peak_hour:02d}:00 UTC, and numbers fade towards dawn as birds land to rest and feed. "
            "Night flight keeps them cool, away from hawks, and leaves daylight for eating.",
       see="On the map, watch the glow switch on as the night line sweeps west."),
  dict(title="Heading southwest", big=f"{sw_share:.0%}", unit="of busy radar-nights flew between south and west",
       body=f"The average flight direction this autumn was {med_dir:.0f}° ({compass(med_dir)}), towards Iberia, the Mediterranean and Africa. "
            "Birds steer by the stars, Earth's magnetic field and the glow of the sunset. That's why tailwind here means wind towards the southwest.",
       see="On the map, turn on flight direction: most arrows point bottom-left."),
  dict(title="Flying harder into the wind", big=f"{as_hw:.1f} vs {as_tw:.1f}", unit="m/s own airspeed, headwind vs tailwind",
       body=f"Into a headwind birds fly harder ({as_hw:.1f} m/s) yet still cover less ground ({gs_hw:.1f} m/s). "
            f"With a tailwind they ease off ({as_tw:.1f} m/s) and still travel faster ({gs_tw:.1f} m/s). Waiting for the right wind saves fuel.",
       see="Chapter 2: the two speed charts."),
]
story = dict(
  speed_gs=f"Median ground speed: {gs_hw:.1f} m/s into headwinds (> 3 m/s), {gs_tw:.1f} m/s with tailwinds (> 3 m/s).",
  speed_as=f"Airspeed = bird ground velocity − wind vector. Into headwinds birds fly harder ({as_hw:.1f} m/s); with tailwinds they ease off ({as_tw:.1f} m/s) and let the wind do the work.",
  rhythm_text=(f"Across {len(radars) - len(lowsig)} radars from Portugal to Finland, the autumn of 2026 was anything but steady. "
               f"<strong>Half of all migration traffic happened on just {half_nights} of {len(NIGHTS)} nights</strong>, "
               f"and the ten busiest nights carried {top10_share:.0%} of it. On the busiest night, {fmtd(busy)}, an estimated "
               f"<strong>{fm(peaks.max())} birds</strong> were in the air at once over the radar-covered area alone "
               f"({DATA_COVER/1e6:.1f} million km² within {COVER_KM} km of a radar). On {fmtd(quiet)}, with the same radars watching, the peak was {fm(peaks[quiet])}."),
  rhythm_stats=[dict(v=fm(peaks.max()).replace(" million", "M").replace(" thousand", "k"), l=f"birds aloft at once, peak of {fmtd(busy)}", c="var(--bird-3)"),
                dict(v=f"{half_nights}/{len(NIGHTS)}", l="nights that carried half of the season's traffic"),
                dict(v=f"{peaks.max()/max(peaks[quiet],1):.0f}×", l=f"busiest vs. quietest well-observed night ({fmtd(quiet)})")],
  wind_head=f"The big nights ride the wind: tailwinds bring {ratio:.1f}× the traffic of headwinds.",
  wind_text=(f"Radars differ in sensitivity, so we compare each radar only with itself. A night’s traffic is expressed as a multiple of that radar’s typical night "
             f"(its season median), and that is paired with the wind at that radar. With a tailwind of more than 3 m/s, the median radar-night carried "
             f"<strong>{tw_hi:.1f}× a typical night</strong>; with an equally strong headwind, {tw_lo:.1f}×. "
             f"Tailwinds blew on {share_tail_all:.0%} of all radar-nights but on {share_tail_big:.0%} of the big ones (≥ 3× typical). "
             f"At {rho_pos:.0%} of radars, more tailwind meant more birds (median Spearman ρ = {rho_med:.2f}). "
             f"Wind isn’t the only factor (rain, temperature and the calendar matter too), but it is the clearest single signal."),
  findings=findings,
)
story["method_html"] = METHOD_HTML.format(n_radars=len(radars), excluded=", ".join(excluded) or "none", cover=COVER_KM,
                                          ex_n=len(excluded), n_low=len(lowsig), low=", ".join(sorted(lowsig)))

def r1(x, n=1):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)

out = dict(
    generated=dt.datetime.now(dt.timezone.utc).isoformat(),
    nights=[d.strftime("%Y-%m-%d") for d in NIGHTS], hours=HOURS,
    radars=[dict(id=r["radar"], lat=r["lat"], lon=r["lon"], elev=r["elev"], low=r["radar"] in lowsig) for r in radars],
    windows={f"{k[0]}|{k[1].strftime('%Y-%m-%d')}": [v[0].isoformat(), v[1].isoformat()] for k, v in win.items()},
    vir=[[r1(x) for x in row] for row in VIR], bu=[[r1(x) for x in row] for row in U], bv=[[r1(x) for x in row] for row in V],
    aloft=[[round(x) for x in row] for row in aloft], covered_km2=round(covered_km2),
    radar_nights=[dict(rel=r1(x.rel, 2), r=x.radar, n=x.night.strftime("%Y-%m-%d"), mtr=r1(x.mtr_night, 0), vir=r1(x.vir_mean),
                       tw=r1(x.tw, 2), uw=r1(x.uw, 2), vw=r1(x.vw, 2), gu=r1(x.gu, 2), gv=r1(x.gv, 2),
                       au=r1(x.au, 2), av=r1(x.av, 2)) for x in rn.itertuples()],
    europe_nights=[dict(n=d.strftime("%Y-%m-%d"), mtr_med=r1(x.mtr_med, 0), mtr_mean=r1(x.mtr_mean, 0), tw=r1(x.tw, 2),
                        peak=int(aloft[i].max())) for i, (d, x) in enumerate(nn.iterrows())],
    wind=dict(lats=glats, lons=glons, scale=0.5,
              u=base64.b64encode(WU.tobytes()).decode(), v=base64.b64encode(WV.tobytes()).decode()),
    params=dict(mig_dir=MIG_DIR, cover_km=COVER_KM, quiet_night=quiet_i, busy_night=list(NIGHTS).index(busy),
                vir_scale_max=int(np.ceil(np.nanpercentile(VIR, 99.5)))),
    bins=bins, story=story,
)
json.dump(out, open(P / "data.json", "w"), separators=(",", ":"))
print("data.json", round((P / "data.json").stat().st_size / 1e6, 2), "MB")
pk = pd.DataFrame(aloft, index=NIGHTS, columns=HOURS).max(axis=1).sort_values(ascending=False)
print(pk.head(8)); print(pk.tail(5))
