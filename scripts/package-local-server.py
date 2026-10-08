#!/usr/bin/env python3
"""Package the local full-stack source, excluding profiles and hosting credentials."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--plan", type=Path)
args = parser.parse_args()
files = {}

def add(source, relative):
    source = source.resolve()
    if not source.is_file() or source.is_symlink():
        raise ValueError(f"Not a regular source file: {relative}")
    if not source.is_relative_to(ROOT) and not (args.plan and source == args.plan.resolve()):
        raise ValueError(f"Unexpected source outside project: {relative}")
    files[str(relative)] = source.read_bytes()

mobile_evidence = {"07-after-320-battle.png", "10-after-320-card-info.png", "24-after-844-battle.png"}
for folder in ["src", "tests", "scripts", "server", "content", "evidence"]:
    for source in sorted((ROOT / folder).rglob("*")):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        if "mobile-layout" in source.parts and source.name not in mobile_evidence:
            continue
        if source.name == "make-plan.py" or source.suffix in [".log", ".pyc"]:
            continue
        add(source, source.relative_to(ROOT))
for name in ["package.json", "package-lock.json", "tsconfig.json", "README.md", "README-2.7.5.md", "THIRD_PARTY_NOTICES.txt", "COMBAT-2.2.md", "CHANGELOG.md", ".gitignore", ".gitattributes", ".nvmrc", "docs/VALIDATION-3.2.9.md"]:
    add(ROOT / name, name)

# The preserved build enumerates all voice clips and original artwork/music.
# Include every expansion card explicitly; no runtime asset is replaced by a CDN.
html = (ROOT / "dist/index.html").read_text()
assets = sorted(set(re.findall(r"assets/[A-Za-z0-9_./-]+\.(?:webp|png|ogg|m4a|mp3)", html)))
assets = sorted(set(assets) | {str(p.relative_to(ROOT / "dist")) for folder in ["cards", "materials"] for p in (ROOT / "dist/assets" / folder).glob("*.webp")})
if not assets:
    raise ValueError("Legacy asset inventory was not found")
for relative in assets:
    add(ROOT / "dist" / relative, "dist/" + relative)
for source in sorted((ROOT / "dist/assets/licenses").glob("*.txt")):
    add(source, source.relative_to(ROOT))
if args.plan:
    if args.plan.suffix.lower() != ".docx":
        raise ValueError("Expected the reviewed user-facing DOCX plan")
    add(args.plan, "docs/词灵对决三维与匹配升级计划.docx")

files["启动说明.txt"] = ("这是可迁移的三维匹配完整源码包。素材与语音均在包内，初次安装Node依赖需要npm。\n"
    "解压到一个文件夹，安装Node.js24或更高版本，依次运行：\nnpm ci\nnpm run build:network\nnpm run server\n"
    "然后在服务器同一台电脑打开http://127.0.0.1:4173。两个独立会话选同范围可匹配，默认无人等待10秒进入电脑挑战。\n"
    "此服务器只保存内存房间，重启会结束未完联网对局；学习记录在浏览器，请使用JSON备份。\n"
    "旧离线源码也保留，可运行npm run build生成dist/index.html。已交付的2.7.5离线包是独立检查点。\n"
    "此包不含用户档案、账号凭据或部署到旧站点的配置。Docker模板尚未实际构建。浏览器验收边界见README。\n").encode()


commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
manifest = {"product": "Spellwood 3D local matching source", "client_version": json.loads((ROOT / "package.json").read_text())["version"] + "-preview", "source_commit": commit, "working_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
    "build": ["npm ci", "npm run build:network", "npm run server"],
    "legacy_build": "npm run build", "assets_embedded_in_archive": len(assets),
    "exclusions": ["node_modules", "client-dist", "dist/index.html", ".git", ".openai", "private browser profiles", "local QA save files", "textbook PDFs"],
    "files": [{"path": p, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for p, data in sorted(files.items())]}
files["PACKAGE-MANIFEST.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()

args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(files.items()):
        if name.startswith("/") or ".." in Path(name).parts:
            raise ValueError("Unsafe archive member")
        info = zipfile.ZipInfo(name, (2026, 10, 7, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(args.output) as archive:
    assert archive.testzip() is None
    for item in manifest["files"]:
        assert hashlib.sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
    assert not any(name.startswith((".openai/", ".git/", "node_modules/", "review-")) for name in archive.namelist())
size = args.output.stat().st_size
print(json.dumps({"file": str(args.output), "bytes": size, "native_attachment_under_20MB": size < 20_000_000,
    "files": len(files), "assets": len(assets), "commit": commit, "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}, ensure_ascii=False))
if size >= 20_000_000:
    raise SystemExit("Source archive exceeds this conversation's 20,000,000-byte attachment limit")
