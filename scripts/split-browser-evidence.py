"""Split unchanged, already-produced browser evidence for bounded file transfer.

This script does not run a browser, modify screenshots, or alter test outcomes.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

PART_BYTES = 8 * 1024 * 1024
MAX_PARTS = 8
MAX_SINGLE_BYTES = 28 * 1024 * 1024


def split_evidence(source, destination, request, limit=PART_BYTES, single_limit=MAX_SINGLE_BYTES):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_dir() or destination.exists():
        raise ValueError("Need an existing source and a fresh destination")
    if destination.is_relative_to(source):
        raise ValueError("Output must not be inside source")
    files = sorted(source.rglob("*"))
    entries = []
    for item in files:
        if item.is_symlink():
            raise ValueError("Evidence symlinks are not supported")
        if item.is_dir():
            continue
        relative = item.relative_to(source)
        if item.suffix not in {".png", ".json", ".webm"}:
            raise ValueError(f"Unexpected evidence type: {relative}")
        size = item.stat().st_size
        if size > single_limit:
            raise ValueError(f"Single file exceeds supported transfer budget: {relative}")
        entries.append((item, relative, size))
    if not entries:
        raise ValueError("No evidence files")
    batches, batch, used = [], [], 0
    for entry in entries:
        if batch and used + entry[2] > limit:
            batches.append(batch)
            batch, used = [], 0
        batch.append(entry)
        used += entry[2]
    batches.append(batch)
    if len(batches) > MAX_PARTS:
        raise ValueError("Evidence exceeds the eight-part transfer bound")
    destination.mkdir(parents=True)
    manifest = {"schema": 1, "source": request, "unchangedBytes": True,
                "partByteLimit": limit, "singleFileByteLimit": single_limit, "parts": []}
    for number, batch in enumerate(batches, 1):
        name = f"part-{number:02d}"
        part = {"name": name, "bytes": sum(item[2] for item in batch), "files": []}
        for item, relative, size in batch:
            target = destination / name / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item, target)
            with item.open("rb") as original:
                digest = hashlib.file_digest(original, "sha256").hexdigest()
            with target.open("rb") as copied:
                if hashlib.file_digest(copied, "sha256").hexdigest() != digest:
                    raise ValueError("Copied evidence does not match source")
            part["files"].append({"path": str(relative), "bytes": size, "sha256": digest})
        manifest["parts"].append(part)
    (destination / "manifest").mkdir()
    (destination / "manifest" / "source-and-file-hashes.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("request")
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    result = split_evidence(args.source, args.destination, request)
    print(json.dumps({"sourceRunId": request["sourceRunId"], "parts": len(result["parts"]),
                      "files": sum(len(p["files"]) for p in result["parts"])}))
