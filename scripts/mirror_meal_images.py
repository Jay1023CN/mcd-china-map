#!/usr/bin/env python3
"""Fetch official public menu photos in cloud CI and commit only small source thumbnails.

Existing verified WebP source files are reused byte-for-byte on every platform.
No account cookies, MCP credentials or original image files are used or saved.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import warnings
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_IMAGE_HOSTS = frozenset({'officiaweb-afd.mcdonalds.com.cn', 'www.mcdonalds.com.cn'})
REQUIRED_NAMES = ('巨无霸', '麦辣鸡腿汉堡', '板烧鸡腿堡', '薯条', '鲜萃咖啡')
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 60 * 1024 * 1024
MAX_THUMB_BYTES = 40 * 1024
THUMB_SIZE = (160, 120)
Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def approved_url(url: str) -> bool:
    parsed = urlparse(url)
    return (parsed.scheme == 'https' and parsed.hostname in ALLOWED_IMAGE_HOSTS
            and parsed.port in (None, 443) and not parsed.username and not parsed.password
            and parsed.path.startswith('/public/upload/attachment/'))


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not approved_url(newurl):
            raise ValueError('image redirected outside the approved official asset paths')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, referer: str, budget: dict) -> bytes:
    if not approved_url(url):
        raise ValueError('image URL is outside approved official asset paths')
    source = urlparse(referer)
    if source.scheme != 'https' or source.hostname != 'www.mcdonalds.com.cn':
        raise ValueError('source page must be the public official site')
    request = Request(url, headers={'Referer': quote(referer, safe=':/?#&=%'), 'User-Agent': 'Mozilla/5.0',
                                   'Accept': 'image/webp,image/png,image/jpeg'})
    # The public image CDN requires a normal official product-page Referer.
    with build_opener(OfficialRedirects()).open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError(f'image returned HTTP {response.status}')
        declared = response.headers.get('Content-Length')
        if declared and int(declared) > MAX_IMAGE_BYTES:
            raise ValueError('original image exceeds 8 MiB budget')
        content = bytearray()
        while True:
            if declared and len(content) == int(declared):
                break
            remaining = min(MAX_TOTAL_BYTES-budget['downloaded_bytes'], MAX_IMAGE_BYTES-len(content))
            if remaining <= 0:
                raise ValueError('original-image download budget exhausted')
            chunk = response.read(min(64 * 1024, remaining))
            if not chunk:
                break
            budget['downloaded_bytes'] += len(chunk)
            if budget['downloaded_bytes'] > MAX_TOTAL_BYTES:
                raise ValueError('total original-image downloads exceed 60 MiB budget')
            content.extend(chunk)
            if len(content) > MAX_IMAGE_BYTES:
                raise ValueError('original image exceeds 8 MiB budget')
        return bytes(content)


def thumbnail(content: bytes) -> bytes:
    with Image.open(io.BytesIO(content)) as original:
        if original.format not in {'PNG', 'JPEG', 'WEBP'}:
            raise ValueError('response is not an approved raster image')
        image = ImageOps.exif_transpose(original).convert('RGBA')
        image.thumbnail(THUMB_SIZE, Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', THUMB_SIZE, (0, 0, 0, 0))
        canvas.alpha_composite(image, ((THUMB_SIZE[0]-image.width)//2, (THUMB_SIZE[1]-image.height)//2))
        for quality in (82, 70, 55):
            output = io.BytesIO()
            canvas.save(output, format='WEBP', quality=quality, method=6)
            value = output.getvalue()
            if len(value) <= MAX_THUMB_BYTES:
                return value
    raise ValueError('thumbnail exceeds 40 KiB budget')


def valid_cached(target: Path, previous: dict, image_url: str) -> bool:
    if (not target.is_file() or target.is_symlink() or not previous
            or previous.get('source_url') != image_url):
        return False
    value = target.read_bytes()
    if not value or len(value) > MAX_THUMB_BYTES or hashlib.sha256(value).hexdigest() != previous.get('sha256'):
        return False
    try:
        with Image.open(io.BytesIO(value)) as image:
            if image.format != 'WEBP' or image.size != THUMB_SIZE:
                return False
            image.verify()
        return True
    except (OSError, ValueError):
        return False


def mirror(catalog: dict, output: Path, report_path: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'manifest.json'
    previous = {}
    if manifest_path.is_file():
        previous = {record['id']: record for record in json.loads(manifest_path.read_text(encoding='utf-8')).get('images', [])}
    budget = {'downloaded_bytes': 0}
    records, report_records = [], []
    items = catalog.get('items', [])
    priority = {name: position for position, name in enumerate(REQUIRED_NAMES)}
    items = sorted(items, key=lambda item: priority.get(item.get('name'), len(priority)))
    for item in items:
        item_id = item.get('id', '')
        name = item.get('name', '')
        status = {'id': item_id, 'name': name, 'status': 'failed'}
        try:
            if not re.fullmatch(r'[a-z]+-[0-9]+', item_id):
                raise ValueError('catalog image ID is not a safe source filename')
            image_url = item.get('image_url', '')
            if not approved_url(image_url):
                raise ValueError('catalog image source is not an approved public image')
            target = output / f'{item_id}.webp'
            cached = valid_cached(target, previous.get(item_id), image_url)
            if cached:
                value = target.read_bytes()
            else:
                if budget['downloaded_bytes'] >= MAX_TOTAL_BYTES:
                    raise ValueError('original-image download budget exhausted')
                value = thumbnail(download(image_url, item['source_url'], budget))
                temporary = output / f'{item_id}.webp.tmp'
                temporary.write_bytes(value)
                temporary.replace(target)
            record = {'id': item_id, 'file': target.name, 'source_url': image_url,
                      'sha256': hashlib.sha256(value).hexdigest(), 'size_bytes': len(value),
                      'width': THUMB_SIZE[0], 'height': THUMB_SIZE[1]}
            records.append(record)
            status.update(status='cached' if cached else 'mirrored', size_bytes=len(value))
        except (HTTPError, URLError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            status['error'] = str(error)
        report_records.append(status)
        print(f"{status['status']}: {item_id} {name}", flush=True)
    records.sort(key=lambda record: record['id'])
    manifest = {'version': 1, 'images': records}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    missing = [name for name in REQUIRED_NAMES if not any(record['name'] == name and record['status'] != 'failed' for record in report_records)]
    report = {'version': 1, 'catalog_items': len(items), 'mirrored': len(records),
              'failed': len(items)-len(records), **budget, 'required_missing': missing,
              'thumbnail_bytes': sum(record['size_bytes'] for record in records), 'images': report_records}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=ROOT/'assets/data/meal-catalog.json')
    parser.add_argument('--output-dir', type=Path, default=ROOT/'assets/meal-photos')
    parser.add_argument('--report', type=Path, default=ROOT/'private/meal-image-cache/report.json')
    args = parser.parse_args()
    report = mirror(json.loads(args.catalog.read_text(encoding='utf-8')), args.output_dir, args.report)
    print(json.dumps({key: report[key] for key in ('mirrored','failed','downloaded_bytes','thumbnail_bytes','required_missing')}, ensure_ascii=False))
    return 1 if report['required_missing'] else 0


if __name__ == '__main__':
    sys.exit(main())
