"""Inline libraries, basemap and data into one self-contained HTML file."""
import json, sys
from pathlib import Path
H = Path(__file__).parent
# Deepnote serves the app from this entry point, not the birds directory.
out = Path(sys.argv[1]) if len(sys.argv) > 1 else H.parent / "_deepnote_static" / "index.html"
t = (H / "app_template.html").read_text()
world = json.load(open(H / "vendor/countries-50m.json"))
for k, v in {"/*__D3__*/": (H / "vendor/d3.min.js").read_text(),
             "/*__TOPOJSON__*/": (H / "vendor/topojson.min.js").read_text(),
             "/*__WORLD__*/": json.dumps(world, separators=(",", ":")),
             "/*__DATA__*/": (H / "processed/data.json").read_text()}.items():
    assert k in t, k
    t = t.replace(k, v.replace("</script", "<\\/script"))
remaining = [marker for marker in ("/*__D3__*/", "/*__TOPOJSON__*/", "/*__WORLD__*/", "/*__DATA__*/") if marker in t]
if remaining:
    raise ValueError(f"Unresolved template markers: {remaining}")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(t, encoding="utf-8")
# Keep the standalone artifact for downloads and local use.
standalone = H / "bird-migration.html"
if out.resolve() != standalone.resolve():
    standalone.write_text(t, encoding="utf-8")
print(out, round(out.stat().st_size / 1e6, 2), "MB")
