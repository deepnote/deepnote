"""Regenerates the value-encoding fixture (Python 3.12, pandas==2.2.3, pyarrow==24.0.0), then format the JSON with
biome. One small frame, split over several record batches, holds the values the encoding tests check."""

import json
import math
import uuid
from collections.abc import Callable
from datetime import date, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa

OUT_DIR = Path(__file__).parent / "encoding"
FRAME_FILE = "5c1d7e2a-8b3f-4a6c-9d0e-1f2a3b4c5d6e.arrow"
ROWS = 30
BATCH_ROWS = [12, 12, 6]
LEVELS = ["low", "medium", "high"]
LONG_TEXT = "lorem ipsum " * 100
ARROW_TYPES = {
    "count": "int64",
    "ratio": "double",
    "flag": "bool",
    "text": "string",
    "level": "dictionary<values=string, indices=int8, ordered=0>",
    "event_at": "timestamp[ns]",
    "created_utc": "timestamp[ns, tz=UTC]",
    "local_time": "timestamp[ns, tz=Europe/Prague]",
    "day": "date32[day]",
    "clock": "time64[us]",
    "duration": "duration[ns]",
    "price": "decimal128(22, 2)",
    "rate": "decimal128(8, 8)",
    "payload": "binary",
    "tags": "list<item: int64>",
    "meta": "struct<a: int64, b: string>",
    "uid": "extension<arrow.uuid>",
}


def column(filler: Callable[[int], Any], overrides: dict[int, Any]) -> list[Any]:
    return [overrides[row] if row in overrides else filler(row) for row in range(ROWS)]


def build_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "count": pd.array(
                column(
                    lambda row: row * 7 - 50,
                    {2: None, 5: 2**53, 6: -(2**53), 18: None, 25: 2**53 + 1, 26: -(2**63)},
                ),
                dtype="Int64",
            ),
            "ratio": column(
                lambda row: row / 4,
                {
                    3: math.nan,
                    4: 0.1,
                    7: 1 / 3,
                    13: math.inf,
                    14: -math.inf,
                    16: math.nan,
                    22: 1e20,
                    23: 1.5e-07,
                    24: 1.0,
                    28: math.nan,
                },
            ),
            "flag": column(lambda row: row % 2 == 0, {1: None, 15: None}),
            "text": column(lambda row: f"row {row}", {0: None, 9: "", 11: LONG_TEXT, 12: "žluťoučký kůň 🐎", 17: None}),
            "level": pd.Categorical(column(lambda row: LEVELS[row % 3], {4: None, 20: None}), categories=LEVELS),
            "event_at": pd.Series(
                column(
                    lambda row: pd.Timestamp("2025-01-01 00:00:04") + pd.Timedelta(row * 3_601, unit="s"),
                    {
                        1: pd.NaT,
                        8: pd.Timestamp("2025-03-04 05:06:07.123456"),
                        10: pd.Timestamp("2025-03-04 05:06:07.123456789"),
                        19: pd.Timestamp("1969-12-31 23:59:59.5"),
                        21: pd.NaT,
                        27: pd.Timestamp("2025-01-01"),
                    },
                ),
                dtype="datetime64[ns]",
            ),
            "created_utc": pd.Series(
                column(
                    lambda row: pd.Timestamp("2025-06-01 12:00", tz="UTC") + pd.Timedelta(row, unit="min"),
                    {6: pd.NaT, 14: pd.Timestamp("2025-06-01 12:14:00.000250", tz="UTC")},
                ),
                dtype="datetime64[ns, UTC]",
            ),
            # Twelve-hour steps cross the switch to summer time on 2025-03-30.
            "local_time": pd.Series(
                column(
                    lambda row: pd.Timestamp("2025-03-29 12:00", tz="Europe/Prague") + pd.Timedelta(12 * row, unit="h"),
                    {2: pd.Timestamp("2025-03-30 13:00:00.25", tz="Europe/Prague"), 24: pd.NaT},
                ),
                dtype="datetime64[ns, Europe/Prague]",
            ),
            "day": column(
                lambda row: date(2025, 1, 1) + timedelta(days=row),
                {3: date(1960, 2, 29), 5: None, 26: date(1999, 12, 31)},
            ),
            "clock": column(
                lambda row: time(row % 24, row * 7 % 60, row * 13 % 60),
                {4: time(0, 0, 0, 789_000), 7: None, 29: time(23, 59, 59, 999_999)},
            ),
            "duration": pd.Series(
                column(
                    lambda row: pd.Timedelta(row * 37, unit="s"),
                    {
                        2: pd.NaT,
                        11: pd.Timedelta(-1, unit="s"),
                        12: pd.Timedelta(2, unit="D") + pd.Timedelta(3, unit="h") + pd.Timedelta(500, unit="ms"),
                        23: pd.Timedelta(1, unit="ns"),
                        25: pd.Timedelta(400, unit="D") + pd.Timedelta(1, unit="s"),
                    },
                ),
                dtype="timedelta64[ns]",
            ),
            # Every value of a decimal column shares its exponent, as the file's scale would impose it on read.
            "price": column(
                lambda row: Decimal(f"{row * 3}.{row * 17 % 100:02d}"),
                {
                    9: Decimal("-12.35"),
                    13: Decimal("12345678901234567890.12"),
                    15: None,
                    16: Decimal("0.00"),
                    20: Decimal("-0.50"),
                },
            ),
            "rate": column(lambda row: Decimal(row**4 * 3).scaleb(-8), {21: None}),
            "payload": column(
                lambda row: f"p{row}".encode(),
                {
                    1: b"",
                    3: b"\x00\x7f\xff\t\n\r\\",
                    10: b"it's",
                    14: b'say "hi" it\'s',
                    19: None,
                    22: "ž".encode(),
                },
            ),
            "tags": column(lambda row: [row, row + 1], {0: [], 5: None, 13: [4, None], 27: []}),
            "meta": column(
                lambda row: {"a": row, "b": f"m{row}"}, {2: None, 8: {"a": None, "b": "y"}, 17: {"a": 3, "b": None}}
            ),
            "uid": column(lambda row: uuid.UUID(int=(row + 1) * 0x0123456789ABCDEF0123456789ABCDEF % 2**128), {3: None, 21: None}),
        }
    )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    df = build_frame()
    frame_path = OUT_DIR / FRAME_FILE
    df.to_feather(frame_path, compression="zstd", chunksize=BATCH_ROWS[0])

    reader = pa.ipc.open_file(str(frame_path))
    batch_rows = [reader.get_batch(i).num_rows for i in range(reader.num_record_batches)]
    require(batch_rows == BATCH_ROWS, f"unexpected batch row counts {batch_rows}")
    arrow_types = {field.name: str(field.type) for field in reader.schema}
    require(arrow_types == ARROW_TYPES, f"unexpected arrow types {arrow_types}")

    manifest = {
        "version": 1,
        "file": FRAME_FILE,
        "written_at": "2026-10-06T08:00:00Z",
        "rows": ROWS,
        "batch_rows": batch_rows,
        "toolkit_version": "2.8.0",
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
