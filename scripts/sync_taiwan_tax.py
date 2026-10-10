"""Filter a public Taiwan tax CSV ZIP and conservatively join FDA addresses.

Download the official ZIP with normal certificate verification before running.
No cookies, access keys, personal state, or nonmatching business rows are saved.
"""
import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://eip.fia.gov.tw/data/BGMOPEN1.zip'
DATASET = 'https://data.gov.tw/dataset/9400'
PARENT = '12411160'
FIELDS = ('營業地址', '統一編號', '總機構統一編號', '營業人名稱', '設立日期',
          '行業代號', '名稱', '行業代號1', '名稱1', '行業代號2', '名稱2', '行業代號3', '名稱3')


def address_key(address):
    value = re.sub(r'\s+', '', unicodedata.normalize('NFKC', address).replace('臺', '台'))
    for chinese, digit in zip('一二三四五六七八九', '123456789'):
        value = value.replace(chinese + '段', digit + '段')
    # Tax addresses optionally include a village/neighborhood immediately after
    # the city and district. Keep the entire road, house number and floor suffix.
    return re.sub(r'^([^縣市]{2,4}[縣市][^鄉鎮市區]{1,5}[鄉鎮市區])'
                  r'[^路街巷弄號\d]{1,6}[里村](?=[^路街巷弄號\d]+(?:路|街|大道))', r'\1', value)


def restaurant(row):
    return (row.get('總機構統一編號') == PARENT and row.get('統一編號') != PARENT
            and row.get('營業人名稱', '').startswith('和德昌股份有限公司')
            and any(row.get('行業代號' + suffix, '').startswith('561') for suffix in ('', '1', '2', '3')))


def collect(path):
    rows, excluded, count = [], [], 0
    with zipfile.ZipFile(path) as archive:
        names = [item for item in archive.infolist() if item.filename.lower().endswith('.csv')]
        if len(names) != 1:
            raise ValueError('Expected one public tax CSV')
        member = names[0]
        with archive.open(member) as stream:
            reader = csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig', newline=''))
            if not set(FIELDS).issubset(reader.fieldnames or []):
                raise ValueError('Tax source schema changed')
            for raw in reader:
                count += 1
                if raw.get('總機構統一編號') != PARENT and raw.get('統一編號') != PARENT:
                    continue
                row = {key: raw[key] for key in FIELDS}
                if restaurant(row):
                    rows.append(row)
                else:
                    excluded.append(row)
    if len({row['統一編號'] for row in rows}) != len(rows):
        raise ValueError('Repeated tax identity')
    return {'schema_version': 1, 'source_url': SOURCE, 'dataset_page': DATASET,
            'fetched_at': datetime.now(timezone.utc).isoformat(),
            'source_zip_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'source_zip_bytes': path.stat().st_size, 'source_csv_rows': count,
            'source_csv_timestamp': list(member.date_time), 'operator_headquarters_id': PARENT,
            'status_scope': 'Source describes this dataset as operating tax entities only; not opening hours.',
            'brand_directory_complete': False, 'rows': rows,
            'excluded': [{**row, 'reason': 'company_headquarters' if row['統一編號'] == PARENT else 'no_restaurant_industry'} for row in excluded]}


def match_food_registration(food, tax):
    """Only one FDA identity and one tax identity at the full address can join."""
    foods, taxes = defaultdict(list), defaultdict(list)
    for row in food:
        foods[address_key(row['業者地址'])].append(row)
    for row in tax:
        if restaurant(row):
            taxes[address_key(row['營業地址'])].append(row)
    return {records[0]['食品業者登錄字號']: taxes[key][0] for key, records in foods.items()
            if len(records) == 1 and len(taxes[key]) == 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-zip', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/data/taiwan-operating-tax-registration.json')
    args = parser.parse_args()
    value = collect(args.input_zip)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.json.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(args.output)
    print(json.dumps({'source_rows': value['source_csv_rows'], 'restaurant_tax_rows': len(value['rows']),
                      'excluded': len(value['excluded'])}))


if __name__ == '__main__':
    main()
