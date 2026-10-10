"""Cross-check every city listed by the official restaurant disclosure form."""
import concurrent.futures as cf
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
CACHE = Path(tempfile.gettempdir()) / 'mcd-official-city-publicity-20261010'
OUT = Path(__file__).parent / 'official-city-publicity-snapshot.json'
CACHE.mkdir(exist_ok=True)


def clean(value):
    value = re.sub(r'<span\b[^>]*>.*?</span>', '', value, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', value))).strip()


def request(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=35) as rsp:
        return rsp.read()


def fetch(city, page):
    key = hashlib.sha256(city.encode()).hexdigest()[:16]
    cached = CACHE / f'{key}-{page}.json'
    if cached.exists():
        return json.loads(cached.read_text(encoding='utf-8'))
    url = BASE + '?' + urllib.parse.urlencode({'data[Search][city]': city, 'page': page})
    for attempt in range(5):
        try:
            raw = request(url)
            content = raw.decode('utf-8')
            tbody = re.search(r'<tbody>(.*?)</tbody>', content, re.S)
            if not tbody:
                raise ValueError('Restaurant table absent')
            rows = []
            for row_index, row in enumerate(re.findall(r'<tr>(.*?)</tr>', tbody.group(1), re.S), 1):
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
                if len(cells) != 3:
                    raise ValueError('Unexpected restaurant columns')
                ids = sorted(set(re.findall(r'/license/(\d+)/', cells[2])))
                row_city = clean(cells[0])
                if row_city != city:
                    raise ValueError('City filter mismatch')
                rows.append({'city': row_city, 'name': clean(cells[1]),
                             'official_id': ids[0] if len(ids) == 1 else None,
                             'official_publicity_ids': ids, 'source_page': page,
                             'source_row': row_index, 'source_url': url})
            navigation = re.search(r'<div class="page-pagination">(.*?)</ul>', content, re.S)
            page_labels = re.findall(r'<a\b[^>]*>\s*(\d+)\s*</a>', navigation.group(1)) if navigation else []
            last_page = max([1] + [int(v) for v in page_labels])
            result = {'city': city, 'page': page, 'rows': rows, 'last_page': last_page,
                      'fetched_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      'response_sha256': hashlib.sha256(raw).hexdigest()}
            cached.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            time.sleep(.5)
            return result
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


content = request(BASE).decode('utf-8')
select = re.search(r'<select\b[^>]*id="SearchCity"[^>]*>(.*?)</select>', content, re.S).group(1)
cities = sorted(set(html.unescape(v) for v in re.findall(r'<option\b[^>]*value="([^"]+)"', select)))
print(f'Official city options: {len(cities)}', flush=True)
pages = {}
expected = {}
failures = {}
pagination_changes = {}
with cf.ThreadPoolExecutor(max_workers=4) as pool:
    tasks = {pool.submit(fetch, city, 1): (city, 1) for city in cities}
    while tasks:
        done, _ = cf.wait(tasks, return_when=cf.FIRST_COMPLETED)
        for task in done:
            city, page = tasks.pop(task)
            try:
                result = task.result()
                pages[(city, page)] = result
                if page == 1:
                    expected[city] = result['last_page']
                    for p in range(2, result['last_page'] + 1):
                        tasks[pool.submit(fetch, city, p)] = (city, p)
                elif result['last_page'] != expected[city]:
                    pagination_changes[f'{city}/{page}'] = result['last_page']
            except Exception as exc:
                failures[f'{city}/{page}'] = type(exc).__name__ + ': ' + str(exc)
            if (len(pages) + len(failures)) % 100 == 0:
                print(f'City pages {len(pages)}, pending {len(tasks)}, failures {len(failures)}', flush=True)

stores = [r for key in sorted(pages) for r in pages[key]['rows']]
unexpected_rows = {f'{city}/{page}': len(data['rows']) for (city, page), data in pages.items()
                   if page != expected.get(city) and len(data['rows']) != 10}
keys = [(r['city'], r['name']) for r in stores]
official_ids = [r['official_id'] for r in stores if r['official_id']]
report = {
    'source': BASE, 'method': 'Exhaustive pagination of every city in the official SearchCity selector',
    'collected_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'expected_cities': len(cities), 'collected_cities': len(expected),
    'expected_pages': sum(expected.values()), 'collected_pages': len(pages),
    'failed_pages': failures, 'pagination_changes': pagination_changes,
    'unexpected_row_counts': unexpected_rows, 'rows': len(stores),
    'unique_city_names': len(set(keys)), 'unique_official_ids': len(set(official_ids)),
    'rows_without_single_official_id': len(stores) - len(official_ids),
    'duplicate_official_id_count': len(official_ids) - len(set(official_ids)),
    'full_disclosure_pagination_collected': not failures and not pagination_changes and not unexpected_rows and len(expected) == len(cities) and len(pages) == sum(expected.values()),
    'city_manifest': [{'city': city, 'expected_pages': expected.get(city),
                       'row_count': sum(len(pages[(city, p)]['rows']) for p in range(1, expected.get(city, 0)+1) if (city, p) in pages)} for city in cities],
    'pages': [{k: data[k] for k in ('city','page','last_page','response_sha256','fetched_at')} | {'row_count': len(data['rows'])} for _, data in sorted(pages.items())],
    'stores': stores,
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k not in ('stores','pages','city_manifest')}, ensure_ascii=False), flush=True)
print(str(OUT), flush=True)
if not report['full_disclosure_pagination_collected']:
    raise SystemExit(2)
