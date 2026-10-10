"""Collect every public restaurant-disclosure page; never fetch license images."""
import concurrent.futures
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
BASE = 'https://www.mcdonalds.com.cn/index/quality/deliveryinfo'
CACHE = Path(tempfile.gettempdir()) / 'mcd-official-publicity-20261010'
OUT = Path(__file__).parent / 'official-publicity-snapshot.json'
CACHE.mkdir(exist_ok=True)


def clean(fragment):
    fragment = re.sub(r'<span\b[^>]*>.*?</span>', '', fragment, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', fragment))).strip()


def fetch(page):
    cached = CACHE / f'{page}.json'
    if cached.exists():
        return json.loads(cached.read_text(encoding='utf-8'))
    url = BASE + '?' + urllib.parse.urlencode({'data[Search][city]': '', 'page': page})
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=35) as rsp:
                raw = rsp.read()
            content = raw.decode('utf-8')
            tbody = re.search(r'<tbody>(.*?)</tbody>', content, re.S)
            if not tbody:
                raise ValueError('Restaurant table absent')
            rows = []
            for row in re.findall(r'<tr>(.*?)</tr>', tbody.group(1), re.S):
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
                if len(cells) != 3:
                    raise ValueError('Unexpected restaurant columns')
                ids = sorted(set(re.findall(r'/license/(\d+)/', cells[2])))
                rows.append({'city': clean(cells[0]), 'name': clean(cells[1]),
                             'official_publicity_ids': ids, 'source_url': url})
            navigation = re.search(r'<div class="page-pagination">(.*?)</ul>', content, re.S)
            pages = [int(v) for v in re.findall(r'<a\b[^>]*>\s*(\d+)\s*</a>', navigation.group(1))] if navigation else [1]
            result = {'page': page, 'rows': rows, 'last_page': max(pages),
                      'fetched_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      'response_sha256': hashlib.sha256(raw).hexdigest()}
            cached.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            time.sleep(.5)
            return result
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


first = fetch(1)
last_page = first['last_page']
pages = {1: first}
failures = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    tasks = {pool.submit(fetch, p): p for p in range(2, last_page + 1)}
    for task in concurrent.futures.as_completed(tasks):
        p = tasks[task]
        try:
            pages[p] = task.result()
        except Exception as exc:
            failures[str(p)] = type(exc).__name__ + ': ' + str(exc)
        if (len(pages) + len(failures)) % 50 == 0:
            print(f'Pages {len(pages)}/{last_page}, failures {len(failures)}', flush=True)

stores = [row for p in sorted(pages) for row in pages[p]['rows']]
unexpected_rows = {str(p): len(v['rows']) for p, v in pages.items()
                   if p != last_page and len(v['rows']) != 10}
changed_pagination = {str(p): v['last_page'] for p, v in pages.items()
                      if v['last_page'] != last_page}
keys = [(r['city'], r['name']) for r in stores]
duplicate_city_names = len(keys) - len(set(keys))
result = {
    'source': BASE, 'scope': 'All pages of the official mainland restaurant disclosure; not a guarantee of all currently operating stores or coordinates',
    'collected_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'expected_pages': last_page, 'collected_pages': len(pages), 'failed_pages': failures,
    'unexpected_row_counts': unexpected_rows, 'pagination_changes': changed_pagination,
    'rows': len(stores), 'unique_city_names': len(set(keys)),
    'duplicate_city_name_count': duplicate_city_names,
    'city_count': len(set(r['city'] for r in stores)),
    'full_disclosure_pagination_collected': len(pages) == last_page and not failures and not unexpected_rows and not changed_pagination,
    'pages': [{'page': p, 'row_count': len(pages[p]['rows']),
               'response_sha256': pages[p]['response_sha256'], 'fetched_at': pages[p]['fetched_at']}
              for p in sorted(pages)],
    'stores': stores,
}
OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: v for k, v in result.items() if k not in ('stores', 'pages')}, ensure_ascii=False), flush=True)
print(str(OUT), flush=True)
if not result['full_disclosure_pagination_collected']:
    raise SystemExit(2)
