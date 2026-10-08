#!/usr/bin/env python3
"""Package the original game, never local profiles or research materials."""
from pathlib import Path
import base64, json, re, zipfile, hashlib, argparse
from html import escape
ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', type=Path, default=ROOT/'deliverables')
OUT = parser.parse_args().output_dir
OUT.mkdir(exist_ok=True)
html = (ROOT/'dist/index.html').read_text()
assets = sorted(set(re.findall(r'assets/[A-Za-z0-9_./-]+\.(?:webp|png|ogg|m4a|mp3)', html)))
assert assets, 'No game assets found'
mimes = {'.png':'image/png', '.webp':'image/webp', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.mp3':'audio/mpeg'}
for rel in assets:
    p = ROOT/'dist'/rel
    assert p.is_file() and p.stat().st_size, rel
    uri = f'data:{mimes[p.suffix]};base64,' + base64.b64encode(p.read_bytes()).decode()
    html = html.replace(rel, uri)
assert not re.search(r'assets/[^\s"\']+\.(webp|png|ogg|m4a|mp3)', html)
notices = (ROOT/'THIRD_PARTY_NOTICES.txt').read_text() + '\n\n' + '\n\n'.join(p.name+'\n'+p.read_text() for p in sorted((ROOT/'dist/assets/licenses').glob('*.txt')))
html = html.replace('</body>', '<template id="bundled-licenses"><pre>'+escape(notices)+'</pre></template></body>')
offline=OUT/'词灵对决离线版.html'
offline.write_text(html)
delivery_zip=OUT/'词灵对决离线打开.zip'
with zipfile.ZipFile(delivery_zip,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    z.write(offline,offline.name)
    z.writestr('打开说明.txt','解压后双击词灵对决离线版.html。图片、配乐和英语音频已嵌入，无需旁边保留素材文件夹。请在设置中及时导出存档备份；file://存储兼容性随浏览器不同。')
with zipfile.ZipFile(delivery_zip) as z:
    assert z.testzip() is None and z.read(offline.name)==offline.read_bytes()
selected=[]
for folder in ['src','tests','scripts','dist','content']:
    for p in sorted((ROOT/folder).rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts and p.name != 'make-plan.py':
            if folder == 'dist' and p.suffix in mimes and str(p.relative_to(ROOT/'dist')) not in assets: continue
            selected.append(p)
for name in ['package.json','package-lock.json','tsconfig.json','README.md','THIRD_PARTY_NOTICES.txt']:
    selected.append(ROOT/name)
for name in ['词灵对决完整项目计划.docx','词灵对决交付与测试说明.txt']:
    if (ROOT/'deliverables'/name).exists(): selected.append(ROOT/'deliverables'/name)
archive=OUT/'词灵对决完整源码.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in selected: z.write(p,p.relative_to(ROOT))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any(any(x in n for x in ['node_modules/','.git/','.openai/','review-rules','review-course','textbooks/']) for n in z.namelist())
print(json.dumps({'offline':str(offline),'offline_bytes':offline.stat().st_size,'embedded_assets':len(assets),'source':str(archive),'source_bytes':archive.stat().st_size,'source_files':len(selected),'distribution_zip':str(delivery_zip),'distribution_bytes':delivery_zip.stat().st_size,'offline_sha256':hashlib.sha256(offline.read_bytes()).hexdigest()},ensure_ascii=False))
