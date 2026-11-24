# Shared setup, copied into the first code block of every PageMantle notebook.
# `dataset` comes from the notebook's input: "sample" (fast, for checking apps) or "full".
import json
import os

import duckdb
from IPython.display import display

ROOT = os.path.expanduser(os.environ.get("PAGEMANTLE_DATA", "~/data/pagemantle"))
FULL = dataset == "full"
con = duckdb.connect()
con.execute("LOAD sqlite")


def pq(path):
    """All Parquet partitions under a folder of the extracted dataset."""
    return f"read_parquet('{ROOT}/{path}/**/*.parquet', union_by_name=true)"


def db(path):
    return f"{ROOT}/{path}"


def q(sql):
    return con.execute(sql).df()


def records(df):
    return json.loads(df.to_json(orient="records", date_format="iso", double_precision=4))


def one(sql):
    return con.execute(sql).fetchone()[0]


# Sampling keeps every 10th customer (by a stable hash), so customer tables stay consistent
# across notebooks. Event-level sources sample the most recent days instead (see each notebook).
def in_sample(col):
    return "TRUE" if FULL else f"(hash({col}) % 10 = 0)"


DATASET = {"mode": "full" if FULL else "sample"}
