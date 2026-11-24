# Dev helper: run one notebook source outside Deepnote. python3 try.py customers [sample|full]
import json, sys, time
name, mode = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "sample")
out = {}
import IPython.display as d
d.display = lambda obj, raw=False: out.update(obj["application/json"])
g = {"dataset": mode}
t = time.time()
exec(open("src/_prelude.py").read(), g)
g["display"] = d.display
exec(open(f"src/{name}.py").read(), g)
s = json.dumps(out)
print(f"{name} [{mode}] {time.time()-t:.1f}s {len(s)//1024}KB keys={list(out)}")
for k, v in out.items():
    if isinstance(v, list): print(f"  {k}: {len(v)} rows; {json.dumps(v[0])[:400] if v else ''}")
    elif isinstance(v, dict): print(f"  {k}: {json.dumps(v)[:300]}")
json.dump(out, open(f"/tmp/pm-{name}-{mode}.json", "w"))
