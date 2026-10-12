import json
import os
import time


def read_status(path):
    """Read a status.json file; returns {} when missing or mid-write."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, PermissionError):
        return {}


def write_json_atomic(path, data):
    """Write JSON via a temp file + rename so concurrent readers never see a partial file."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    # On Windows the rename fails while a reader holds the file open; retry briefly.
    for attempt in range(10):
        try:
            os.replace(tmp_path, path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.05)
