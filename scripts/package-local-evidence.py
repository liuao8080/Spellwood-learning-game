from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / 'evidence/local-gpu-2026-10-10'
destination.mkdir(parents=True, exist_ok=True)
sources = json.loads(Path(sys.argv[1]).read_text())
records = []
for label, selection in sources.items():
    relative = selection['path'] if isinstance(selection, dict) else selection
    extensions = set(selection.get('extensions', ['.json', '.png', '.webm', '.txt'])) if isinstance(selection, dict) else {'.json', '.png', '.webm', '.txt'}
    if not extensions.issubset({'.json', '.png', '.webm', '.txt'}):
        raise RuntimeError('Only explicit safe evidence formats may be archived')
    path = root / relative
    if not path.exists():
        raise RuntimeError(f'Missing evidence: {relative}')
    files = sorted(path.rglob('*')) if path.is_dir() else [path]
    for file in files:
        if not file.is_file() or file.suffix not in extensions:
            continue
        if file.name in {'pending-question.json', 'selected-answer.json'}:
            raise RuntimeError('Operator question files must be removed before packaging')
        if 'client-bundle' in file.parts:
            continue
        relative_file = file.relative_to(path) if path.is_dir() else Path(file.name)
        data = file.read_bytes()
        records.append({'source': str(file.relative_to(root)), 'archivePath': f'{label}/{relative_file}',
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

groups = []
group, size = [], 0
for record in records:
    if group and size + record['bytes'] > 14 * 1024 * 1024:
        groups.append(group)
        group, size = [], 0
    group.append(record)
    size += record['bytes']
if group:
    groups.append(group)

archives = []
for index, group in enumerate(groups, 1):
    name = f'original-evidence-{index:02}.zip'
    output = destination / name
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for record in group:
            archive.write(root / record['source'], record['archivePath'])
            record['archive'] = name
    with zipfile.ZipFile(output) as archive:
        for record in group:
            if hashlib.sha256(archive.read(record['archivePath'])).hexdigest() != record['sha256']:
                raise RuntimeError('Archived original bytes changed')
    archives.append({'file': name, 'bytes': output.stat().st_size,
                     'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'files': len(group)})

manifest = {'schema': 1, 'scope': 'Original synthetic local evidence; no resizing, rerendering, retiming or interpolation',
            'sources': sources, 'files': records, 'archives': archives,
            'fileCount': len(records), 'originalBytes': sum(r['bytes'] for r in records),
            'exclusions': ['Browser profiles', 'Cookies and credentials', 'SQLite', 'HAR and traces',
                           'Internal Playwright error contexts', 'Operator question files', 'Regenerable client bundles']}
(destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'directory': str(destination), 'files': len(records), 'parts': len(archives),
                  'originalBytes': manifest['originalBytes'], 'zipBytes': sum(a['bytes'] for a in archives)}))
