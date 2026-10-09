#!/usr/bin/env python3
"""Build an offline global journal; official MCP only supplies China candidates."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
from string import Template

from visual_assets import ROOT, asset_uri, font_faces


ENTRY_FIELDS = ('id', 'date', 'country_code', 'province_code', 'city', 'store', 'foods', 'note', 'source', 'confirmed', 'origin', 'collaboration')


def project_archive(raw):
    if raw.get('version') != 1 or not isinstance(raw.get('entries'), list) or len(raw['entries']) > 1000:
        raise ValueError('unsupported archive')
    projected = {'version': 1, 'data_kind': raw.get('data_kind', 'manual'), 'entries': []}
    if isinstance(raw.get('source'), str):
        if len(raw['source']) > 1000:
            raise ValueError('archive source exceeds 1000 characters')
        projected['source'] = raw['source']
    for item in raw['entries']:
        entry = {key: item[key] for key in ENTRY_FIELDS if key in item}
        for key, fields in [('location', ('lat', 'lon', 'precision')), ('photo', ('data_url',)), ('store_reference', ('source', 'code', 'address'))]:
            if isinstance(item.get(key), dict):
                entry[key] = {field: item[key][field] for field in fields if field in item[key]}
        projected['entries'].append(entry)
    if len(json.dumps(projected).encode()) > 8 * 1024 * 1024:
        raise ValueError('archive exceeds 8 MiB')
    return projected


def candidates(payload):
    if payload.get('source', {}).get('kind') != 'mcp':
        raise ValueError('candidate import requires actual MCP source')
    entries = []
    for order in payload['orders']:
        # No automatic interpretation of an order as a personal visit.
        if order.get('status') != 'completed':
            continue
        date = datetime.fromisoformat(order['created_at'].replace('Z', '+00:00'))
        if date.tzinfo is None:
            raise ValueError('normalized order time must contain an offset')
        entries.append({'id': 'mcp-' + hashlib.sha256(order['id'].encode()).hexdigest()[:24],
                        'date': date.date().isoformat(), 'country_code': 'CN',
                        'city': order['store'].get('city') or '', 'store': order['store']['name'],
                        'foods': [item['name'] for item in order.get('items', [])],
                        'note': '中国大陆订单线索；请核对是否本人到店，外送或代他人点单不应计作本人打卡。',
                        'source': 'mcp_candidate', 'confirmed': False})
    return {'version': 1, 'data_kind': 'mcp', 'entries': entries,
            'source': '只含官方实际返回范围内的中国大陆完成订单线索；不代表全年完整记录，更不代表本人到店。'}


def render(archive):
    data = {'archive': project_archive(archive),
            'countries': [{'code': 'CN', 'name': '中国'}],
            'provinces': json.loads((ROOT/'assets/data/china-provinces.json').read_text(encoding='utf-8')),
            'cities': json.loads((ROOT/'assets/data/china-cities.json').read_text(encoding='utf-8'))}
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return Template((ROOT/'templates/global-journal.html').read_text(encoding='utf-8')).substitute(
        font_faces=font_faces(), paper=asset_uri('paper.png'), title_art=asset_uri('global-title.png'),
        passport_art=asset_uri('global-passport.png'), plus_icon=asset_uri('icons/plus.svg'),
        close_icon=asset_uri('icons/x.svg'), journal_data=encoded,
        engine_js=(ROOT/'web/journal-engine.js').read_text(encoding='utf-8'), app_js=(ROOT/'web/global-journal.js').read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--archive', type=Path, help='personal archive or explicitly synthetic example')
    inputs.add_argument('--mcp-input', type=Path, help='normalized China order records from sync_footprints.py')
    parser.add_argument('--output', type=Path, default=Path('private/global-passport.html'))
    args = parser.parse_args()
    try:
        if args.mcp_input:
            archive = candidates(json.loads(args.mcp_input.read_text(encoding='utf-8')))
        elif args.archive:
            archive = json.loads(args.archive.read_text(encoding='utf-8'))
        else:
            archive = {'version': 1, 'data_kind': 'manual', 'entries': []}
        html = render(archive)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(html)
        os.chmod(args.output, 0o600)
        print(args.output)
    except (ValueError, TypeError, KeyError, OSError) as exc:
        parser.exit(2, 'Cannot build journal; inspect local input and required assets. No source values printed.\n')


if __name__ == '__main__':
    main()
