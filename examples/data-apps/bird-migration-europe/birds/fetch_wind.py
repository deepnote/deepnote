"""Hourly wind at 925 and 850 hPa for radar sites and a coarse Europe grid (Sep-Oct 2026).

Prototype source: Open-Meteo historical-forecast API, model ecmwf_ifs025 (ECMWF IFS 0.25 deg; keyless).
The Open-Meteo ERA5 archive has no pressure-level variables. In Deepnote, use `era5_cds()` with a CDS key
in secrets (dataset "reanalysis-era5-pressure-levels"); the downstream code only needs u/v columns.
"""
import json, time
from pathlib import Path
import numpy as np, pandas as pd, requests

OUT = Path(__file__).parent / "processed"
START, END = "2026-08-31", "2026-11-01"
URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
VARS = ["wind_speed_925hPa", "wind_direction_925hPa", "wind_speed_850hPa", "wind_direction_850hPa"]


def fetch(points):
    rows = []
    for i in range(0, len(points), 40):
        chunk = points[i:i + 40]
        params = dict(latitude=",".join(f"{p[1]:.3f}" for p in chunk),
                      longitude=",".join(f"{p[2]:.3f}" for p in chunk),
                      start_date=START, end_date=END, hourly=",".join(VARS),
                      wind_speed_unit="ms", models="ecmwf_ifs025", timezone="GMT")
        for attempt in range(6):
            r = requests.get(URL, params=params, timeout=120)
            if r.status_code == 200: break
            print("retry", r.status_code, r.text[:120], flush=True); time.sleep(20 * (attempt + 1))
        js = r.json(); js = js if isinstance(js, list) else [js]
        for p, j in zip(chunk, js):
            h = pd.DataFrame(j["hourly"]); h["id"] = p[0]
            rows.append(h)
        print(f"{i + len(chunk)}/{len(points)}", flush=True); time.sleep(1.5)
    df = pd.concat(rows)
    df["time"] = pd.to_datetime(df.time, utc=True)
    for lev in ("925", "850"):
        s, d = df[f"wind_speed_{lev}hPa"], np.deg2rad(df[f"wind_direction_{lev}hPa"])
        # meteorological direction = where wind comes FROM
        df[f"u{lev}"], df[f"v{lev}"] = -s * np.sin(d), -s * np.cos(d)
    return df[["id", "time", "u925", "v925", "u850", "v850"]]


def era5_cds(area=(71, -12, 34, 35), out="era5_pl.nc"):
    """Deepnote path: ERA5 hourly pressure-level wind via CDS (needs CDSAPI_URL/CDSAPI_KEY secrets)."""
    import cdsapi
    cdsapi.Client().retrieve("reanalysis-era5-pressure-levels", {
        "product_type": ["reanalysis"], "variable": ["u_component_of_wind", "v_component_of_wind"],
        "pressure_level": ["850", "925"], "year": ["2026"], "month": ["09", "10"],
        "day": [f"{d:02d}" for d in range(1, 32)], "time": [f"{h:02d}:00" for h in range(24)],
        "area": list(area), "data_format": "netcdf"}, out)


if __name__ == "__main__":
    radars = json.load(open(OUT / "radars.json"))
    pts = [(r["radar"], r["lat"], r["lon"]) for r in radars]
    fetch(pts).to_parquet(OUT / "wind_radars.parquet")
    grid = [(f"g{la}_{lo}", la, lo) for la in range(34, 72, 2) for lo in range(-12, 36, 2)]
    g = fetch(grid)
    g = g[g.time.dt.hour.isin([16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6])]
    g.to_parquet(OUT / "wind_grid.parquet")
    print("done")
