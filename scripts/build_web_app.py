#!/usr/bin/env python3
"""Build the public blank journal as a small, subpath-safe static site."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

from build_global_journal import render
from project_version import VERSION
from visual_assets import ROOT


WEB_ROOT = ROOT / 'dist' / 'web'
BLANK_ARCHIVE = {'version': 1, 'data_kind': 'manual', 'entries': []}
DATA_SCRIPT = re.compile(
    r'(<script\s+id="journal-data"\s+type="application/json">)(.*?)(</script>)',
    re.DOTALL,
)
DATA_URL = re.compile(r'data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)')
EXTERNAL_MIME_TYPES = {
    'font/ttf': '.ttf',
    'font/woff2': '.woff2',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
}


PUBLIC_METADATA = '<meta name="description" content="找特色麦当劳，收藏下一站，把餐品、照片和随手记攒成中国足迹。网页版无需安装，支持分享卡、城市回忆册、月度小报与备份。"><meta property="og:title" content="麦麦中国地图｜吃一顿麦，留一页手账，点亮一座城"><meta property="og:description" content="先收藏一家想去的店，再把照片和小事写进自己的中国地图。网页版无需安装。"><meta property="og:image" content="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/cover-v1.png"><meta property="og:type" content="website">'
PUBLIC_SUPPORT = '<aside class="project-support" aria-label="支持开源作品"><div class="support-copy"><small>给这份手账，一颗小星星</small><h2>下一座城，再一起去吃麦。</h2><p>如果你喜欢这个小项目，欢迎到 GitHub 点颗 Star，支持它慢慢长大。</p></div><div class="support-action"><a href="https://github.com/Jay1023CN/mcd-china-map" target="_blank" rel="noopener noreferrer">☆ 给作品点颗星 ↗</a><small>登录后点 ☆ Star，显示 Starred 就好了。</small></div></aside><style>.project-support{position:relative;display:grid;grid-template-columns:1fr auto;align-items:center;gap:24px;margin:8px 0 0;padding:28px 32px;background:#f4ead6;border:0;border-left:3px solid #b54a34}.support-copy>small{font:14px \'LXGW WenKai\',var(--sans);color:#a34430}.support-copy h2{margin:8px 0 10px;font:400 29px/1.4 \'LXGW WenKai\',var(--sans);color:#3d3022}.support-copy p{margin:0;font:14px/1.8 var(--sans);color:#79664d}.support-action{display:flex;flex-direction:column;gap:12px;align-items:flex-start}.support-action a{display:inline-flex;align-items:center;min-height:48px;padding:12px 20px;background:#a94331;color:#fff9eb;text-decoration:none;border-radius:3px;font:18px \'LXGW WenKai\',var(--sans)}.support-action a:hover{background:#923b2c}.support-action a:focus-visible{outline:2px solid #923b2c;outline-offset:4px}.support-action small{font:12px/1.7 var(--sans);color:#79664d}@media(max-width:680px){.project-support{grid-template-columns:1fr;padding:24px 20px;gap:20px}.support-copy h2{font-size:25px}.support-action{align-items:stretch}.support-action a{justify-content:center}}@media print{.project-support{display:none}}</style>'


def _blank_html(runtime=None):
    html = render(BLANK_ARCHIVE)
    # Public visitors can return to the repository; offline journal builds stay self-contained.
    html = html.replace("</title>", "</title>" + PUBLIC_METADATA, 1)
    html = html.replace('<div class="lower">', PUBLIC_SUPPORT + '<div class="lower">', 1)
    match = DATA_SCRIPT.search(html)
    if match is None:
        raise ValueError('journal data block is missing')
    payload = json.loads(match.group(2))
    payload['runtime'] = runtime if runtime is not None else {'local_api': False}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    encoded = encoded.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return html[:match.start(2)] + encoded + html[match.end(2):]


def _externalize_assets(html, assets_dir):
    assets_dir.mkdir(parents=True, exist_ok=True)
    files = {}

    def replace(match):
        mime = match.group(1)
        suffix = EXTERNAL_MIME_TYPES.get(mime)
        if suffix is None:
            return match.group(0)
        try:
            content = base64.b64decode(match.group(2), validate=True)
        except (ValueError, base64.binascii.Error) as exc:
            raise ValueError('embedded asset is invalid') from exc
        digest = hashlib.sha256(content).hexdigest()
        relative_path = f'assets/{digest}{suffix}'
        target = assets_dir / f'{digest}{suffix}'
        existing = files.get(relative_path)
        if existing is None:
            target.write_bytes(content)
            files[relative_path] = {
                'path': relative_path,
                'size_bytes': len(content),
                'sha256': digest,
            }
        elif existing['sha256'] != digest:
            raise ValueError('asset hash collision')
        return relative_path

    return DATA_URL.sub(replace, html), files


def build(output_dir=WEB_ROOT, *, runtime=None):
    """Write index.html, hashed static assets and a deterministic manifest."""
    output_dir = Path(output_dir)
    html = _blank_html(runtime)
    html, assets = _externalize_assets(html, output_dir / 'assets')

    index_path = output_dir / 'index.html'
    index_bytes = html.encode('utf-8')
    index_path.write_bytes(index_bytes)
    files = [
        {
            'path': 'index.html',
            'size_bytes': len(index_bytes),
            'sha256': hashlib.sha256(index_bytes).hexdigest(),
        },
        *sorted(assets.values(), key=lambda item: item['path']),
    ]
    manifest = {
        'schema_version': 1,
        'app_version': VERSION,
        'runtime': runtime if runtime is not None else {'local_api': False},
        'archive': {'version': 1, 'data_kind': 'manual', 'entry_count': 0},
        'entrypoint': 'index.html',
        'files': files,
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    (output_dir / 'manifest.json').write_bytes(manifest_bytes)
    return manifest


def load_prebuilt(output_dir, *, runtime):
    """Verify a build with bounded memory before serving its approved files."""
    output_dir = Path(output_dir).resolve()
    manifest = json.loads((output_dir / 'manifest.json').read_text(encoding='utf-8'))
    if (manifest.get('schema_version') != 1 or manifest.get('app_version') != VERSION
            or manifest.get('runtime') != runtime or manifest.get('entrypoint') != 'index.html'
            or manifest.get('archive') != {'version': 1, 'data_kind': 'manual', 'entry_count': 0}):
        raise ValueError('prebuilt site does not match this server')
    records = manifest.get('files')
    if not isinstance(records, list) or not records:
        raise ValueError('prebuilt site file list is missing')
    seen = set()
    for record in records:
        relative = record.get('path')
        if (not isinstance(relative, str) or relative in seen
                or (relative != 'index.html' and not re.fullmatch(
                    r'assets/[0-9a-f]{64}\.(?:ttf|woff2|png|jpg|webp|svg)', relative))):
            raise ValueError('prebuilt site contains an unapproved path')
        candidate = output_dir / relative
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(output_dir):
            raise ValueError('prebuilt site contains an unapproved file')
        digest = hashlib.sha256()
        size = 0
        with candidate.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                size += len(chunk)
                digest.update(chunk)
        if size != record.get('size_bytes') or digest.hexdigest() != record.get('sha256'):
            raise ValueError('prebuilt site file failed integrity check')
        if relative.startswith('assets/') and candidate.stem != digest.hexdigest():
            raise ValueError('prebuilt asset name does not match its content')
        seen.add(relative)
    if 'index.html' not in seen:
        raise ValueError('prebuilt site index is missing')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=WEB_ROOT)
    parser.add_argument('--connected', action='store_true', help='build for the independent-session web server')
    args = parser.parse_args()
    runtime = {'local_api': True, 'web_sessions': True} if args.connected else None
    result = build(args.output_dir, runtime=runtime)
    print(f"Built web app: {args.output_dir / result['entrypoint']}")
