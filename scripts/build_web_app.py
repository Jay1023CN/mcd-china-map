#!/usr/bin/env python3
"""Build the public blank journal as a small, subpath-safe static site."""

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
PUBLIC_SUPPORT = '<aside class="project-support" aria-label="支持开源作品"><p><strong>下一座城，你想去吃哪家麦？</strong><br>喜欢这份手账，欢迎到 GitHub 点颗 Star 收藏作品。</p><a href="https://github.com/Jay1023CN/mcd-china-map" target="_blank" rel="noopener noreferrer">去 GitHub 点 Star ↗</a><small>登录后点仓库顶部的 Star；显示 Starred 就已收藏。</small></aside><style>.project-support{border-top:1px solid var(--line);padding:20px 0;display:flex;align-items:center;gap:12px 24px;flex-wrap:wrap}.project-support p{flex:1;min-width:220px;margin:0;color:var(--muted);font-size:12px}.project-support strong{color:var(--ink);font-size:14px}.project-support a{display:inline-flex;align-items:center;min-height:44px;color:var(--red);text-underline-offset:4px}.project-support small{flex-basis:100%;font-size:11px;color:var(--muted)}@media print{.project-support{display:none}}</style>'


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
        'archive': {'version': 1, 'data_kind': 'manual', 'entry_count': 0},
        'entrypoint': 'index.html',
        'files': files,
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    (output_dir / 'manifest.json').write_bytes(manifest_bytes)
    return manifest


if __name__ == '__main__':
    result = build()
    print(f"Built public static app: {WEB_ROOT / result['entrypoint']}")
