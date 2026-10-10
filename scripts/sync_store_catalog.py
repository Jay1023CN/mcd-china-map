#!/usr/bin/env python3
"""Build a public national catalog from verified official snapshots and locator data.

No MCP credentials, orders, license images or personal data are read. All network
responses and progress are resumable under private/national-catalog/.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import time
import threading
import unicodedata
import urllib.parse
import urllib.request
from sync_taiwan_tax import match_food_registration

ROOT = Path(__file__).resolve().parents[1]
PUBLICITY = 'https://www.mcdonalds.com.cn/index/quality/deliveryinfo'
LOCATOR = 'https://www.mcdonalds.com.cn/ajaxs/search_by_keywords'
POINT = 'https://www.mcdonalds.com.cn/ajaxs/search_by_point'
MAP = 'https://www.mcdonalds.com.cn/top/map'
CACHE = ROOT / 'private/national-catalog'
SNAPSHOT = ROOT / 'docs/growth-assets/national-store-research/official-city-publicity-snapshot.json'
LOCALITIES = ROOT / 'assets/data/national-store-localities.json'
SAVED_LOCATIONS = ROOT / 'assets/data/official-store-locations.json'
LOCALITY_SUPPLEMENTS = [{'city': '雄安新区', 'province_code': '130000',
                        'source_url': 'https://www.xiongan.gov.cn/2023-02/27/c_129769131.htm'}]


class LocatorUnavailable(RuntimeError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or '')).lower()


def city_key(value):
    return normalized(value).removesuffix('市')


def name_key(value, city=''):
    value = normalized(value)
    value = re.sub(r'[()（）·]', '', value).removeprefix('麦当劳')
    for label in sorted({normalized(city), city_key(city)}, key=len, reverse=True):
        if label:
            value = value.removeprefix(label)
    return re.sub(r'(餐厅|餐廳|店)$', '', value)


def parse_page(content, page, url, raw_hash=''):
    body = re.search(r'<tbody\b[^>]*>(.*?)</tbody>', content, re.S | re.I)
    if not body:
        raise ValueError('Official disclosure table missing')
    def text(cell):
        cell = re.sub(r'<span\b[^>]*>.*?</span>', '', cell, flags=re.S | re.I)
        return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', cell))).strip()
    rows = []
    for ordinal, fragment in enumerate(re.findall(r'<tr\b[^>]*>(.*?)</tr>', body[1], re.S | re.I), 1):
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', fragment, re.S | re.I)
        if len(cells) != 3:
            raise ValueError('Official disclosure columns changed')
        row = {'city': text(cells[0]), 'name': text(cells[1]),
               'official_publicity_ids': sorted(set(re.findall(r'/license/(\d+)/', cells[2]))),
               'source_url': url, 'source_page': page, 'source_row': ordinal}
        if not row['city'] or not row['name']:
            raise ValueError('Empty official city/name')
        rows.append(row)
    # Official hrefs can contain stale `&page=161` in the path BEFORE `?`.
    # Anchor labels inside the restaurant paginator are the real page numbers.
    paginator = re.search(r'<div\b[^>]*class="page-pagination"[^>]*>(.*?)</div>', content, re.S | re.I)
    if paginator:
        pages = [int(v) for v in re.findall(r'<a\b[^>]*>\s*(\d+)\s*</a>', paginator[1], re.I)]
    else:
        pages = []
    return {'page': page, 'rows': rows, 'last_page': max([page, *pages]),
            'fetched_at': now(), 'response_sha256': raw_hash}


def request(url, params=None, attempts=4):
    for attempt in range(attempts):
        try:
            data = urllib.parse.urlencode(params).encode() if params is not None else None
            headers = {'User-Agent': 'Mozilla/5.0'}
            if urllib.parse.urlparse(url).hostname == 'www.mcdonalds.com.cn':
                headers['Referer'] = MAP
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=35) as response:
                raw = response.read()
            time.sleep(.3)
            return raw
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(min(8, 2 ** attempt))


def collect_publicity(cache, workers):
    """Explicit future refresh only; current run consumes the shared snapshot."""
    def fetch(page, refresh=False):
        path = cache / 'pages' / f'{page}.json'
        if path.exists() and not refresh:
            return read(path)
        url = PUBLICITY + '?' + urllib.parse.urlencode({'data[Search][city]': '', 'page': page})
        raw = request(url)
        value = parse_page(raw.decode('utf-8'), page, url, hashlib.sha256(raw).hexdigest())
        save(path, value)
        return value
    first = fetch(1, True)
    last = first['last_page']
    pages, failures = {1: first}, {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, p): p for p in range(2, last + 1)}
        for task in as_completed(futures):
            page = futures[task]
            try:
                pages[page] = task.result()
            except Exception as exc:
                failures[str(page)] = type(exc).__name__
            if len(pages) % 50 == 0:
                print(f'Disclosure pages {len(pages)}/{last}', flush=True)
    ending = fetch(last, True)
    pages[last] = ending
    boundary = fetch(1, True)
    changed = {str(p): v['last_page'] for p, v in pages.items() if v['last_page'] != last}
    if boundary['last_page'] != last or boundary['rows'] != first['rows']:
        changed['boundary'] = boundary['last_page']
    result = {'source': PUBLICITY, 'collected_at': now(), 'expected_pages': last,
              'collected_pages': len(pages), 'failed_pages': failures,
              'unexpected_row_counts': {str(p): len(v['rows']) for p, v in pages.items()
                                        if p != last and len(v['rows']) != 10},
              'pagination_changes': changed,
              'pages': [{'page': p, 'row_count': len(v['rows']),
                         'response_sha256': v['response_sha256'], 'fetched_at': v['fetched_at']}
                        for p, v in sorted(pages.items())],
              'stores': [r for p in sorted(pages) for r in pages[p]['rows']]}
    result['rows'] = len(result['stores'])
    save(cache / 'publicity-snapshot.json', result)
    validate_snapshot(result)
    return result


def collect_publicity_by_city(cache, workers):
    """Recoverable exhaustive collection of the official city selector."""
    content = request(PUBLICITY).decode('utf-8')
    selector = re.search(r'<select\b[^>]*id="SearchCity"[^>]*>(.*?)</select>', content, re.S | re.I)
    if not selector:
        raise ValueError('Official city selector missing')
    cities = sorted({html.unescape(v) for v in re.findall(r'<option\b[^>]*value="([^"]+)"', selector[1]) if v})
    if not cities:
        raise ValueError('Official city list empty')
    day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    def fetch(city, page):
        digest = hashlib.sha256(city.encode()).hexdigest()[:20]
        path = cache / 'city-pages' / day / f'{digest}-{page}.json'
        if path.exists():
            return read(path)
        url = PUBLICITY + '?' + urllib.parse.urlencode({'data[Search][city]': city, 'page': page})
        raw = request(url)
        value = parse_page(raw.decode('utf-8'), page, url, hashlib.sha256(raw).hexdigest())
        if any(r['city'] != city for r in value['rows']):
            raise ValueError('Official city filter mismatch')
        value['city'] = city
        save(path, value)
        return value
    pages, expected, failures = {}, {}, {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tasks = {pool.submit(fetch, city, 1): (city, 1) for city in cities}
        while tasks:
            done = next(as_completed(tasks))
            city, page = tasks.pop(done)
            try:
                value = done.result()
                pages[(city, page)] = value
                if page == 1:
                    expected[city] = value['last_page']
                    for number in range(2, value['last_page'] + 1):
                        tasks[pool.submit(fetch, city, number)] = (city, number)
            except Exception as exc:
                failures[f'{city}/{page}'] = type(exc).__name__
            if len(pages) % 100 == 0:
                print(f'City disclosure pages {len(pages)}; pending {len(tasks)}', flush=True)
    changed = {f'{city}/{page}': v['last_page'] for (city, page), v in pages.items()
               if v['last_page'] != expected[city]}
    unexpected = {f'{city}/{page}': len(v['rows']) for (city, page), v in pages.items()
                  if page != expected[city] and len(v['rows']) != 10}
    snapshot = {'source': PUBLICITY, 'method': 'Exhaustive official city selector pagination',
                'collected_at': now(), 'expected_cities': len(cities), 'collected_cities': len(expected),
                'expected_pages': sum(expected.values()), 'collected_pages': len(pages),
                'failed_pages': failures, 'pagination_changes': changed, 'unexpected_row_counts': unexpected,
                'city_manifest': [{'city': city, 'expected_pages': expected.get(city),
                                   'row_count': sum(len(v['rows']) for (c, _), v in pages.items() if c == city)} for city in cities],
                'pages': [{'city': city, 'page': page, 'last_page': v['last_page'], 'row_count': len(v['rows']),
                           'response_sha256': v['response_sha256'], 'fetched_at': v['fetched_at']}
                          for (city, page), v in sorted(pages.items())],
                'stores': [r for key in sorted(pages) for r in pages[key]['rows']]}
    snapshot['rows'] = len(snapshot['stores'])
    snapshot['full_disclosure_pagination_collected'] = not failures and not changed and not unexpected and len(expected) == len(cities)
    save(cache / 'publicity-snapshot.json', snapshot)
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot):
    last = snapshot['expected_pages']
    pages = snapshot['pages']
    if not isinstance(last, int) or last < 1:
        raise ValueError('Invalid page count')
    if snapshot.get('city_manifest'):
        expected = {(city['city'], page) for city in snapshot['city_manifest']
                    for page in range(1, (city.get('expected_pages') or 0) + 1)}
        actual = [(p['city'], p['page']) for p in pages]
        if set(actual) != expected or len(set(actual)) != len(actual) or len(expected) != last:
            raise ValueError('Missing or repeated city pages')
        if snapshot.get('collected_cities') != snapshot.get('expected_cities'):
            raise ValueError('Missing cities')
        final_pages = {city['city']: city['expected_pages'] for city in snapshot['city_manifest']}
        for page in pages:
            is_final = page['page'] == final_pages[page['city']]
            if (not is_final and page['row_count'] != 10) or (is_final and not 0 <= page['row_count'] <= 10):
                raise ValueError('Unexpected city page row count')
            if page.get('last_page') != final_pages[page['city']]:
                raise ValueError('City pagination changed')
    elif sorted(p['page'] for p in pages) != list(range(1, last + 1)):
        raise ValueError('Missing or repeated page numbers')
    if snapshot.get('failed_pages') or snapshot.get('pagination_changes') or snapshot.get('unexpected_row_counts'):
        raise ValueError('Disclosure acquisition incomplete or changed during collection')
    if not snapshot.get('city_manifest') and any(p['row_count'] != 10 for p in pages if p['page'] != last):
        raise ValueError('Non-final page has unexpected row count')
    if not snapshot.get('city_manifest'):
        ending = next(p for p in pages if p['page'] == last)
        if not 1 <= ending['row_count'] <= 10:
            raise ValueError('Invalid final page')
    if len({p['response_sha256'] for p in pages}) != len(pages):
        raise ValueError('Repeated response pages')
    if sum(p['row_count'] for p in pages) != len(snapshot['stores']):
        raise ValueError('Row count differs from page inventory')
    for row in snapshot['stores']:
        if not row.get('city') or not row.get('name'):
            raise ValueError('Empty city or store name')
    return True


def import_publicity(snapshot, cities, staging=False):
    if not staging:
        validate_snapshot(snapshot)
    city_codes = {}
    city_sources = {}
    for city in cities:
        key = city_key(city['city'])
        city_codes.setdefault(key, set()).add(city['province_code'])
        city_sources[key] = city.get('source_url') or 'existing_city_reference'
    stores, identities, official_ids = [], {}, {}
    for row in snapshot['stores']:
        ids = sorted(set(row.get('official_publicity_ids', [])))
        identity = tuple(ids) if ids else (row['city'], row['name'])
        if identity in identities:
            prior = identities[identity]
            if prior['name'] != row['name'] or prior['city'] != row['city']:
                raise ValueError('Conflicting disclosure identity')
            prior['disclosure_occurrences'] += 1
            continue
        key = 'cn:' + ('license:' + '-'.join(ids) if ids else 'name:' + hashlib.sha256(
            (row['city'] + '\n' + row['name']).encode()).hexdigest()[:20])
        for official_id in ids:
            if official_id in official_ids:
                raise ValueError('Overlapping disclosure IDs require manual reconciliation')
            official_ids[official_id] = key
        store = {'id': key, 'code': key, 'country_code': 'CN', 'city': row['city'],
                 'name': row['name'], 'official_publicity_ids': ids,
                 'source_url': row['source_url'], 'source': 'official_publicity',
                 'source_page': row.get('source_page') or int(urllib.parse.parse_qs(
                     urllib.parse.urlparse(row['source_url']).query).get('page', ['1'])[0]),
                 'disclosure_occurrences': 1, 'address': '', 'featured': False}
        if row.get('source_row'):
            store['source_row'] = row['source_row']
        codes = city_codes.get(city_key(row['city']), set())
        if len(codes) == 1:
            store['province_code'] = next(iter(codes))
            store['province_source'] = city_sources[city_key(row['city'])]
        stores.append(store)
        identities[identity] = store
    names = {}
    for store in stores:
        key = (city_key(store['city']), name_key(store['name'], store['city']))
        names[key] = names.get(key, 0) + 1
    for store in stores:
        if names[(city_key(store['city']), name_key(store['name'], store['city']))] > 1:
            store['locator_ambiguous_disclosure_name'] = True
    return stores


def sync_localities(cache, workers):
    """Reuse the project's DataV administrative map source for province labels.

    Only locality names and parent codes are exported. Administrative centers
    are deliberately omitted so they cannot become invented restaurant points.
    """
    provinces = read(ROOT / 'assets/data/china-provinces.json')['features']
    features = [f['properties'] for f in provinces if isinstance(f['properties'].get('adcode'), int)
                and f['properties']['adcode'] not in (710000, 810000, 820000)]
    records, sources = list(LOCALITY_SUPPLEMENTS), []
    for province in features:
        code = str(province['adcode'])
        records.append({'city': province['name'], 'province_code': code,
                        'source_url': 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'})
    def fetch(province):
        code = str(province['adcode'])
        url = f'https://geo.datav.aliyun.com/areas_v3/bound/{code}_full.json'
        path = cache / 'localities' / f'{code}.json'
        if path.exists():
            return read(path)
        raw = request(url)
        value = json.loads(raw)
        result = {'url': url, 'fetched_at': now(), 'response_sha256': hashlib.sha256(raw).hexdigest(),
                  'records': [{'city': f['properties']['name'], 'province_code': code, 'source_url': url}
                              for f in value['features'] if f.get('properties', {}).get('name')]}
        save(path, result)
        return result
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for result in pool.map(fetch, features):
            records.extend(result['records'])
            sources.append({k: result[k] for k in ('url', 'fetched_at', 'response_sha256')})
    save(LOCALITIES, {'schema_version': 1, 'generated_at': now(), 'sources': sources, 'localities': records})


def locator_records(cache):
    values = []
    for path in sorted((cache / 'locator').glob('*.json')):
        item = read(path)
        for raw in item.get('data', []):
            values.append({**raw, '_source_endpoint': item['endpoint'], '_fetched_at': item['fetched_at']})
    return values


def match_locator(store, candidates):
    """Same city and full normalized name/local name only; never nearest/fuzzy."""
    if store.get('locator_ambiguous_disclosure_name'):
        return None
    same_city = [r for r in candidates if city_key(r.get('city')) == city_key(store['city'])]
    exact = [r for r in same_city if normalized(r.get('title')) == normalized(store['name'])]
    matched = exact or [r for r in same_city if name_key(r.get('title'), store['city']) == name_key(store['name'], store['city'])]
    # Official nearby rows have the company's store names; prefer those over
    # Tencent public POI names when both feeds contain the same candidate.
    point_matches = [r for r in matched if r.get('_source_endpoint') == POINT]
    matched = point_matches or matched
    groups = {}
    for row in matched:
        loc = row.get('location', {})
        fingerprint = (normalized(row.get('address')), loc.get('lat'), loc.get('lng'))
        groups[fingerprint] = row
    if len(groups) != 1:
        return None
    return next(iter(groups.values()))


def apply_locator(store, row):
    if not row:
        return
    store['address'] = row.get('address', '')
    store['locator_name'] = row.get('title', '')
    store['district'] = row.get('district', '')
    store['locator_source_url'] = row['_source_endpoint']
    store['locator_fetched_at'] = row['_fetched_at']
    store['locator_match'] = 'same_city_normalized_name'
    adcode = str(row.get('adcode', ''))
    if re.fullmatch(r'\d{6}', adcode):
        store['province_code'] = adcode[:2] + '0000'
        store['province_source'] = 'official_locator_adcode'
    location = row.get('location', {})
    lat, lon = location.get('lat'), location.get('lng')
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and 18 <= lat <= 54 and 73 <= lon <= 136:
        store['location'] = {'lat': lat, 'lon': lon, 'precision': 'store', 'coordinate_system': 'GCJ-02'}


def apply_saved_locations(stores, path=SAVED_LOCATIONS):
    """Reuse the reviewed public matches without requiring unpublished caches."""
    if not path.exists():
        return
    saved = {row['id']: row for row in read(path)['stores']}
    fields = ('address','locator_name','district','locator_source_url','locator_fetched_at','locator_match',
              'location','province_code','province_source')
    for store in stores:
        row = saved.get(store['id'])
        if (row and row['name'] == store['name'] and row['city'] == store['city']
                and not store.get('locator_ambiguous_disclosure_name')):
            for key in fields:
                if key in row:
                    store[key] = row[key]


def sync_locator(stores, cache, workers, maximum):
    counts = {}
    for store in stores:
        key = (city_key(store['city']), name_key(store['name'], store['city']))
        counts[key] = counts.get(key, 0) + 1
    for store in stores:
        if counts[(city_key(store['city']), name_key(store['name'], store['city']))] > 1:
            store['locator_ambiguous_disclosure_name'] = True
    known = locator_records(cache)
    by_city = {}
    for row in known:
        by_city.setdefault(city_key(row.get('city')), []).append(row)
    missing = []
    for store in stores:
        if store.get('locator_ambiguous_disclosure_name'):
            continue
        hit = match_locator(store, by_city.get(city_key(store['city']), []))
        if hit:
            apply_locator(store, hit)
        else:
            missing.append(store)
    tasks = missing[:maximum] if maximum else missing
    failures = {}
    stop = threading.Event()
    def fetch(store):
        if stop.is_set():
            raise LocatorUnavailable('Official keyword locator unavailable')
        params = {'keywords': store['name'], 'city': store['city']}
        digest = hashlib.sha256(json.dumps(params, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        path = cache / 'locator' / f'{digest}.json'
        if path.exists():
            return read(path)
        value = json.loads(request(LOCATOR, params))
        if isinstance(value, dict) and value.get('status') not in (None, 0):
            stop.set()
            save(cache / 'locator-last-error.json', {'endpoint': LOCATOR, 'observed_at': now(),
                 'status': value.get('status'), 'message': value.get('message')})
            raise LocatorUnavailable('Official keyword locator unavailable; retain cache and stop this batch')
        if not isinstance(value, dict) or not isinstance(value.get('data'), list):
            raise ValueError('Unexpected locator response')
        result = {'endpoint': LOCATOR, 'query': params, 'status': value.get('status'), 'count': value.get('count'),
                  'returned_rows': len(value['data']), 'data': value['data'], 'fetched_at': now()}
        save(path, result)
        return result
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, store): store for store in tasks}
        for ordinal, task in enumerate(as_completed(futures), 1):
            store = futures[task]
            try:
                response = task.result()
                records = [{**row, '_source_endpoint': response['endpoint'], '_fetched_at': response['fetched_at']}
                           for row in response['data']]
                apply_locator(store, match_locator(store, records))
            except Exception as exc:
                failures[store['id']] = type(exc).__name__
                if isinstance(exc, LocatorUnavailable):
                    for pending in futures:
                        pending.cancel()
                    print('Official keyword locator unavailable; stopped batch, successful cache retained.', flush=True)
                    break
            if ordinal % 100 == 0:
                print(f'Locator queries {ordinal}/{len(tasks)}; matched {sum(bool(s.get("location")) for s in stores)}', flush=True)
                save(cache / 'locator-progress.json', {'updated_at': now(), 'completed': ordinal,
                     'scheduled': len(tasks), 'failures': failures})
    save(cache / 'locator-progress.json', {'updated_at': now(), 'completed': len(tasks),
         'scheduled': len(tasks), 'failures': failures})
    # Reconcile all gathered responses, including results useful to other stores.
    by_city = {}
    for row in locator_records(cache):
        by_city.setdefault(city_key(row.get('city')), []).append(row)
    for store in stores:
        if store.get('locator_ambiguous_disclosure_name'):
            continue
        apply_locator(store, match_locator(store, by_city.get(city_key(store['city']), [])))
    return failures


def sync_points(stores, cache, workers, maximum):
    """Use public POI locations as query seeds, never as unverified assignments."""
    allowed_cities = {city_key(s['city']) for s in stores}
    seeds = {}
    # City reference points are query seeds only. No returned center is copied
    # into a restaurant; stores still require a unique official name match.
    for city in read(ROOT / 'assets/data/china-cities.json'):
        if city_key(city['city']) in allowed_cities:
            lat, lon = city['lat'], city['lon']
            seeds.setdefault((round(lat / .015), round(lon / .015)), (lat, lon))
    for path in sorted((cache / 'locator').glob('*.json')):
        response = read(path)
        if response['endpoint'] != LOCATOR:
            continue
        query_city = city_key(response['query']['city'])
        for row in response.get('data', []):
            location = row.get('location', {})
            if city_key(row.get('city')) != query_city or query_city not in allowed_cities:
                continue
            lat, lon = location.get('lat'), location.get('lng')
            if not isinstance(lat, (float, int)) or not isinstance(lon, (float, int)):
                continue
            # A seed samples nearest ten official stores; this grid controls
            # redundant sampling, it does not assert geographic completeness.
            grid = (round(lat / .015), round(lon / .015))
            seeds.setdefault(grid, (lat, lon))
    tasks = list(seeds.values())
    if maximum:
        tasks = tasks[:maximum]
    failures = {}
    def fetch(location):
        params = {'point': f'{location[0]:.6f},{location[1]:.6f}', 'type': ''}
        digest = hashlib.sha256(('point:' + params['point']).encode()).hexdigest()
        path = cache / 'locator' / f'{digest}.json'
        if path.exists():
            return
        value = json.loads(request(POINT, params))
        if not isinstance(value, dict) or not isinstance(value.get('data'), list):
            raise ValueError('Unexpected nearby response')
        save(path, {'endpoint': POINT, 'query': params, 'count': value.get('count'),
                    'returned_rows': len(value['data']), 'data': value['data'], 'fetched_at': now()})
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, location): location for location in tasks}
        for ordinal, task in enumerate(as_completed(futures), 1):
            try:
                task.result()
            except Exception as exc:
                failures[str(futures[task])] = type(exc).__name__
            if ordinal % 100 == 0:
                print(f'Nearby query seeds {ordinal}/{len(tasks)}', flush=True)
    return failures


def merge_featured(stores, featured):
    unmatched = []
    for feature in featured:
        same_city = [s for s in stores if city_key(s['city']) == city_key(feature['city'])]
        names = {name_key(n, feature['city']) for n in [feature['name'], *feature.get('aliases', [])]}
        matches = [s for s in same_city if name_key(s['name'], s['city']) in names]
        if len(matches) == 1:
            target = matches[0]
        else:
            # Preserve each independently sourced curated store without asserting an uncertain match.
            target = {**feature, 'id': 'featured:' + hashlib.sha256(feature['name'].encode()).hexdigest()[:20],
                      'country_code': 'CN', 'source': 'curated_official_sources'}
            target['code'] = target['id']
            stores.append(target)
            unmatched.append(feature['name'])
        target['featured'] = True
        target['featured_name'] = feature['name']
        for key in ('aliases', 'tags', 'default_photo', 'short_description', 'search_keyword'):
            if key in feature:
                target[key] = feature[key]
        if not target.get('address'):
            target['address'] = feature.get('address', '')
            target['address_source_url'] = feature.get('source_url', '')
    return unmatched


def import_hong_kong(path):
    if not path.exists():
        return [], None
    snapshot = read(path)
    raw = snapshot['stores']
    if not snapshot.get('rendered_ids_match') or len({s['rid'] for s in raw}) != len(raw):
        raise ValueError('Hong Kong snapshot coverage not verified')
    result = []
    for item in raw:
        store = {'id': 'hk:' + item['rid'], 'code': 'hk:' + item['rid'], 'country_code': 'CN',
                 'province_code': '810000', 'city': '香港', 'name': '麥當勞' + item['name'],
                 'official_name': item['name'], 'address': item['address'], 'district': item.get('district', ''),
                 'source': 'official_hong_kong', 'source_url': snapshot['source'], 'featured': False}
        if item.get('city') != '香港':
            store['locality_note'] = item.get('city', '')
        if isinstance(item.get('lat'), (float, int)) and isinstance(item.get('lng'), (float, int)):
            store['location'] = {'lat': item['lat'], 'lon': item['lng'], 'precision': 'store',
                                 'coordinate_system': 'official_google_maps_unverified'}
        result.append(store)
    from regional_store_sources import attach_hong_kong_desserts
    dessert = attach_hong_kong_desserts(result, snapshot, path.parent)
    return result, {'url': snapshot['source'], 'collected_at': snapshot['collected_at'], 'rows': len(result),
                    'dessert_stations': dessert}


def apply_macau_reviewed_sources(stores, base):
    """Attach reviewed public evidence; query row numbers never identify stores."""
    cross_path = base / 'macau-iam-directory-crosswalk.json'
    if not cross_path.exists():
        return None
    paths = {'iam':base/'macau-iam-license-snapshot.json', 'directory':base/'macau-directory-cross-check.json',
             'event':base/'macau-event-merchant-snapshot.json', 'tourism':base/'macau-tourism-license-partial.json'}
    cross = read(cross_path)
    for key, path in paths.items():
        # Git checkouts may use CRLF. Only line endings may differ from the
        # reviewed input; changed source content requires a fresh crosswalk.
        content = path.read_bytes().replace(b'\r\n', b'\n')
        digests = {hashlib.sha256(content).hexdigest(),hashlib.sha256(content.replace(b'\n',b'\r\n')).hexdigest()}
        if cross['input_sha256'][key] not in digests:
            raise ValueError('Macau reviewed input changed: ' + key)
    iam, directory, event = read(paths['iam']), read(paths['directory']), read(paths['event'])
    raw = iam['rows']
    if not iam['full_query_pagination_collected'] or len(raw) != iam['published_query_total'] or [r['source_row'] for r in raw] != list(range(len(raw))):
        raise ValueError('Incomplete Macau IAM query')
    iam_by_row = {r['source_row']:r for r in raw}
    if len(cross['rows']) != len(raw) or {r['iam_source_row'] for r in cross['rows']} != set(iam_by_row):
        raise ValueError('Incomplete or repeated Macau reviewed rows')
    events = {r['phone']:r for r in event['rows']}
    directory_by_phone = {r['phone']:r for r in directory['rows']}
    if len(events) != len(event['rows']) or len(directory_by_phone) != len(directory['rows']):
        raise ValueError('Ambiguous Macau source phone')
    existing_links = added = 0
    for row in cross['rows']:
        source = iam_by_row[row['iam_source_row']]
        if (row['license_address'],row['license_source_url'],row['iam_name']) != (source['address'],source['source_url'],source['name']):
            raise ValueError('Macau reviewed address changed')
        if row['eligible_to_attach_iam_source']:
            if row['relationship'] not in {'complete_address_agreement','event_phone_and_address'}:
                raise ValueError('Unconfirmed Macau relationship cannot attach a source')
            original = directory_by_phone.get(row['directory_phone'])
            if not original or (original['name'],original['address']) != (row['directory_name'],row['directory_address']):
                raise ValueError('Macau directory identity changed')
            candidates = [s for s in stores if s.get('directory_phone') == row['directory_phone'] and s['name'] == row['directory_name']]
            if len(candidates) != 1:
                raise ValueError('Macau reviewed identity not unique')
            store = candidates[0]
            if row['relationship'] == 'event_phone_and_address' and row.get('event_evidence') != events.get(row['directory_phone']):
                raise ValueError('Macau independent event evidence changed')
            existing_links += 1
        elif row['relationship'] == 'new_branch_supported':
            evidence = row.get('event_evidence')
            if not evidence or evidence != events.get(evidence['phone']) or evidence['phone'] in directory_by_phone or any(s.get('directory_phone') == evidence['phone'] for s in stores):
                raise ValueError('Macau new branch requires unique reviewed public evidence')
            code = 'mo:directory:' + hashlib.sha256(evidence['phone'].encode()).hexdigest()[:20]
            store = {'id':code,'code':code,'country_code':'CN','province_code':'820000','city':'澳门',
                     'name':evidence['name'],'address':evidence['address'],'directory_phone':evidence['phone'],
                     'source':'macau_public_event_merchant','source_url':evidence['source_url'],'featured':False,
                     'record_kind':'public_directory','current_open_status_verified':False,
                     'aliases':['麦当劳'],
                     'short_description':'公开商户资料与市政署登记地址交叉核对，出发前请再确认营业时间。'}
            stores.append(store)
            added += 1
        else:
            continue
        store.update({'iam_address':source['address'], 'iam_source_url':source['source_url'],
                      'iam_checked_at':iam['fetched_at'], 'iam_match_method':row['relationship']})
    for row in event['rows']:
        candidates = [s for s in stores if s.get('directory_phone') == row['phone']]
        if len(candidates) == 1:
            store = candidates[0]
            store.update({'merchant_name':row['name'],'merchant_source_url':row['source_url'],'merchant_checked_at':event['fetched_at']})
            store['aliases'] = list(dict.fromkeys([*store.get('aliases',[]),row['name']]))
    return {'url':iam['source_url'],'collected_at':iam['fetched_at'],'rows':len(raw),'pages':len(iam['pages']),
            'pagination_verified':True,'existing_store_matches':existing_links,'new_reviewed_stores':added,
            'matched_store_records':existing_links+added,'coverage_complete':False,
            'event_source':{'url':event['source_url'],'collected_at':event['fetched_at'],'rows':len(event['rows'])}}


def import_macau(path):
    if not path.exists():
        return [], None
    snapshot = read(path)
    stores = []
    seen = set()
    for row in snapshot['stores']:
        identity = row['comKey']
        if identity in seen:
            raise ValueError('Repeated Macau government entity identity')
        seen.add(identity)
        if row.get('closeDate') or row.get('statusCode') != '0100':
            continue
        stores.append({'id': 'mo:mgto:' + identity, 'code': 'mo:mgto:' + identity, 'country_code': 'CN',
                       'province_code': '820000', 'city': '澳门', 'name': row['comNameCn'],
                       'aliases': [row['comNameTw']], 'address': row['comAdsCn'], 'license_address': row['comAdsCn'],
                       'directory_phone': row.get('comTel',''),
                       'source': 'macau_government_tourism_license', 'source_url': snapshot['source'],
                       'featured': False, 'region_coverage_complete': False})
    directory_path = path.parent / 'macau-directory-cross-check.json'
    directory_source = None
    if directory_path.exists():
        directory = read(directory_path)
        by_id = {s['id']: s for s in stores}
        seen_phones = set()
        for row in directory['rows']:
            if row['phone'] in seen_phones:
                raise ValueError('Repeated Macau public directory telephone')
            seen_phones.add(row['phone'])
            match = row.get('government_license_match')
            store = by_id.get('mo:mgto:' + match['official_id']) if match else None
            if store:
                store['official_name'] = store['name']
                store['name'] = row['name']
                store['directory_phone'] = row['phone']
                store['directory_address'] = row['address']
                store['directory_source_url'] = directory['source_url']
                # Registered premises and visitor locations are separate evidence.
            else:
                code = 'mo:directory:' + hashlib.sha256(row['phone'].encode()).hexdigest()[:20]
                stores.append({'id': code, 'code': code, 'country_code': 'CN', 'province_code': '820000',
                               'city': '澳门', 'name': row['name'], 'address': row['address'], 'directory_phone':row['phone'], 'featured': False,
                               'source': 'macau_public_business_directory', 'source_url': directory['source_url'],
                               'record_kind': 'public_directory', 'current_open_status_verified': False,
                               'short_description': '公开商户目录中的分店地址，营业状态请再确认。'})
        directory_source = {'url': directory['source_url'], 'collected_at': directory['fetched_at'],
                            'rows': directory['row_count'], 'government_license_matches': directory['government_license_phone_matches']}
    venue_path = path.parent / 'macau-official-venue-cross-check.json'
    venue_source = None
    if venue_path.exists():
        venue = read(venue_path)
        lisboeta_path = path.parent / 'macau-lisboeta-venue-snapshot.json'
        if lisboeta_path.exists():
            additional = read(lisboeta_path)
            venue['rows'].extend({**row,'fetched_at':additional['fetched_at']} for row in additional['rows'])
            venue['fetched_at'] = max(venue['fetched_at'],additional['fetched_at'])
        ferry_path = path.parent / 'macau-ferry-venue-snapshot.json'
        if ferry_path.exists():
            ferry = read(ferry_path)
            venue['rows'].extend({**row, 'fetched_at':ferry['fetched_at']} for row in ferry['rows'])
            venue['fetched_at'] = max(venue['fetched_at'],ferry['fetched_at'])
        if len({row['directory_phone'] for row in venue['rows']}) != len(venue['rows']):
            raise ValueError('Repeated Macau official visitor phone')
        for row in venue['rows']:
            candidates = [s for s in stores if s.get('directory_phone') == row['directory_phone'] and s['name'] == row['directory_name']]
            if len(candidates) != 1 or not row.get('live_page_facts_verified'):
                raise ValueError('Macau visitor listing identity not uniquely verified')
            store = candidates[0]
            store.update({'venue_address':row['visitor_address'], 'venue_location':row['visitor_location'],
                          'venue_source_url':row['source_url'], 'venue_checked_at':row['fetched_at'],
                          'venue_hours':row['opening_hours_as_published'], 'venue_match_method':row['match_method']})
            # The university source identifies S1 but the directory retains its
            # fuller G016/G017/G018 units. Do not remove useful address detail.
            # Lisboaeta's directory retains the street/house number as well as
            # L01/F07. Keep it while adding the official H853 visitor location.
            if 'university' not in row['match_method'] and 'lisboetamacau.com' not in row['source_url']:
                store['address'] = row['visitor_address']
        venue_source = {'rows':len(venue['rows']), 'collected_at':venue['fetched_at'], 'coverage_complete':False}
    reviewed = apply_macau_reviewed_sources(stores,path.parent)
    from regional_store_sources import attach_macau_dated_government
    government_service = attach_macau_dated_government(stores, path.parent)
    return stores, {'url': snapshot['source'], 'collected_at': snapshot['collected_at'],
                    'rows': len(stores), 'government_license_rows': len(snapshot['stores']),
                    'directory': directory_source, 'official_venue_visitor_pages':venue_source, 'reviewed_iam_sources':reviewed,
                    'dated_government_service_points':government_service, 'coverage_complete': False}


def import_taiwan_registrations(path):
    if not path.exists():
        return [], None
    snapshot = read(path)
    stores, seen = [], set()
    match_path = path.with_name('taiwan-recruitment-address-matches.json')
    brand_matches = {row['registration_id']: row for row in read(match_path)['rows']} if match_path.exists() else {}
    tax_path = ROOT / 'assets/data/taiwan-operating-tax-registration.json'
    tax_snapshot = read(tax_path) if tax_path.exists() else None
    tax_matches = match_food_registration(snapshot['rows'], tax_snapshot['rows']) if tax_snapshot else {}
    for row in snapshot['rows']:
        if row.get('登錄項目') != '餐飲場所' or row.get('公司統一編號') != '12411160':
            continue
        identity = row['食品業者登錄字號']
        if identity in seen:
            raise ValueError('Repeated Taiwan food registration identity')
        seen.add(identity)
        address = row['業者地址']
        match = re.match(r'^(?:\d{3,6})?([^縣市]{2,4}[縣市])', address)
        city = match[1].replace('臺', '台') if match else '台湾'
        brand = brand_matches.get(identity)
        tax = tax_matches.get(identity)
        if brand and brand['government_address'] != address:
            raise ValueError('Taiwan brand address no longer matches registration')
        original_name = row['公司或商業登記名稱'] + ' · ' + address
        tax_branch = tax['營業人名稱'].removeprefix('和德昌股份有限公司') if tax else None
        name = '麥當勞' + brand['brand_store_name'] if brand else '麥當勞' + tax_branch if tax else original_name
        stores.append({'id': 'tw:fda:' + identity, 'code': 'tw:fda:' + identity, 'country_code': 'CN',
                       'province_code': '710000', 'city': city, 'name': name,
                       'operator_name': row['公司或商業登記名稱'], 'address': address,
                       'source': 'taiwan_food_restaurant_registration', 'source_url': snapshot['dataset_page'],
                       'aliases': ['麦当劳','麥當勞',original_name] + ([brand['brand_store_name']] if brand else []) +
                                  ([tax['營業人名稱'], tax_branch, re.sub(r'(分公司|門市部)$', '', tax_branch)] if tax else []),
                       **({'brand_name_source_url': brand['brand_name_source_url']} if brand else {}),
                       **({'tax_registration_id': tax['統一編號'], 'tax_registered_name': tax['營業人名稱'],
                           'tax_status': 'listed_as_operating', 'tax_source_url': tax_snapshot['dataset_page'],
                           'tax_checked_at': tax_snapshot['fetched_at']} if tax else {}),
                       'featured': False, 'record_kind': 'government_registration',
                       'short_description': '本次财政部税籍资料列为营业中；当天营业时间请出发前再确认。' if tax else
                                            '政府餐饮场所登记地址，未提供营业状态；出发前请再确认。'})
    return stores, {'url': snapshot['dataset_page'], 'download_url': snapshot['source_url'],
                    'collected_at': snapshot['fetched_at'], 'rows': len(stores), 'coverage_complete': False,
                    'record_kind': 'government_registration', 'brand_directory_verified': False,
                    'official_branch_name_matches': sum(bool(s.get('brand_name_source_url')) for s in stores),
                    'tax_branch_names_added': sum(bool(s.get('tax_registration_id')) and not s.get('brand_name_source_url') for s in stores),
                    'named_registration_records': sum(s['name'].startswith('麥當勞') for s in stores),
                    'operating_tax_matched_records': len(tax_matches),
                    'operating_tax_source': {key:tax_snapshot[key] for key in ('dataset_page','source_url','fetched_at','source_zip_sha256')} if tax_snapshot else None,
                    'unique_addresses': len({s['address'] for s in stores})}


def build(snapshot, stores, hk_source, unmatched, failures, macau_source=None, locator_status=None, taiwan_source=None):
    mainland = [s for s in stores if s.get('source') == 'official_publicity']
    try:
        complete = validate_snapshot(snapshot)
    except ValueError:
        complete = False
    summary = {'total_stores': len(stores), 'mainland_disclosure_rows': len(snapshot['stores']),
               'mainland_unique_stores': len(mainland), 'mainland_expected_pages': snapshot['expected_pages'],
               'mainland_collected_pages': len(snapshot['pages']), 'mainland_pagination_verified': complete,
               'mainland_failed_pages': snapshot.get('failed_pages', {}),
               'mainland_pagination_changes': snapshot.get('pagination_changes', {}),
               'mainland_duplicate_rows': len(snapshot['stores']) - len(mainland),
               'mainland_with_address': sum(bool(s.get('address')) for s in mainland),
               'mainland_with_coordinates': sum(bool(s.get('location')) for s in mainland),
               'mainland_city_count': len({s['city'] for s in mainland}),
               'mainland_without_province': sum(not s.get('province_code') for s in mainland),
               'featured_stores': sum(bool(s.get('featured')) for s in stores),
               'featured_without_unique_disclosure_match': unmatched,
               'hong_kong_stores': sum(s.get('source') == 'official_hong_kong' for s in stores),
               'macau_verified_partial_stores': sum(s.get('source') == 'macau_government_tourism_license' for s in stores),
               'macau_public_directory_records': sum(s.get('source') == 'macau_public_business_directory' for s in stores),
               'macau_public_event_records': sum(s.get('source') == 'macau_public_event_merchant' for s in stores),
               'taiwan_restaurant_registration_records': sum(s.get('source') == 'taiwan_food_restaurant_registration' for s in stores),
               'locator_failed_queries': len(failures),
               'locator_keyword_status': locator_status,
               'regions_pending_sources': ['澳门', '台湾']}
    return {'schema_version': 1, 'generated_at': now(),
            'sources': {'mainland': {'url': snapshot['source'], 'collected_at': snapshot['collected_at'],
                        'coverage': 'all_verified_official_disclosure_pages' if complete else 'provisional_disclosure_snapshot'}, 'hong_kong': hk_source,
                        'macau': macau_source,
                        'taiwan': taiwan_source,
                        'locator': {'url': LOCATOR, 'display_url': MAP, 'coordinate_system': 'GCJ-02'},
                        'administrative_localities': {'url': 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
                             'snapshot': 'national-store-localities.json'} if LOCALITIES.exists() else None},
            'coverage': summary, 'stores': stores}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=SNAPSHOT)
    parser.add_argument('--cache', type=Path, default=CACHE)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/data/national-store-directory.json')
    parser.add_argument('--collect-publicity', action='store_true', help='Future full city-selector refresh; do not run alongside another collector')
    parser.add_argument('--sync-locator', action='store_true')
    parser.add_argument('--sync-points', action='store_true', help='Supplement official nearby names from cached keyword query seed locations')
    parser.add_argument('--sync-localities', action='store_true', help='Refresh public administrative names for province association')
    parser.add_argument('--staging', action='store_true', help='Process a provisional snapshot only to a private output')
    parser.add_argument('--max-queries', type=int, default=0, help='0 means all unresolved stores')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    args = parser.parse_args()
    if args.staging and not args.output.resolve().is_relative_to((ROOT / 'private').resolve()):
        parser.error('--staging requires --output inside private/')
    snapshot = collect_publicity_by_city(args.cache, args.workers) if args.collect_publicity else read(args.snapshot)
    cities = read(ROOT / 'assets/data/china-cities.json')
    if args.sync_localities:
        sync_localities(args.cache, args.workers)
    if LOCALITIES.exists():
        cities = [*cities, *read(LOCALITIES)['localities']]
    cities.extend(LOCALITY_SUPPLEMENTS)
    stores = import_publicity(snapshot, cities, staging=args.staging)
    apply_saved_locations(stores)
    if args.sync_points:
        sync_points(stores, args.cache, args.workers, args.max_queries)
    failures = sync_locator(stores, args.cache, args.workers, args.max_queries) if args.sync_locator else {}
    if not args.sync_locator:
        by_city = {}
        for row in locator_records(args.cache):
            by_city.setdefault(city_key(row.get('city')), []).append(row)
        for store in stores:
            apply_locator(store, match_locator(store, by_city.get(city_key(store['city']), [])))
    # Province identity may be established by consistent official locator city
    # metadata even when an individual store has no safely matched point.
    city_provinces = {}
    for row in locator_records(args.cache):
        adcode = str(row.get('adcode', ''))
        if re.fullmatch(r'\d{6}', adcode):
            city_provinces.setdefault(city_key(row.get('city')), set()).add(adcode[:2] + '0000')
    for store in stores:
        codes = city_provinces.get(city_key(store['city']), set())
        if not store.get('province_code') and len(codes) == 1:
            store['province_code'] = next(iter(codes))
            store['province_source'] = 'consistent_official_locator_city_adcode'
    hk, hk_source = import_hong_kong(ROOT / 'docs/growth-assets/national-store-research/hong-kong-official-snapshot.json')
    stores.extend(hk)
    macau, macau_source = import_macau(ROOT / 'docs/growth-assets/national-store-research/macau-tourism-license-partial.json')
    stores.extend(macau)
    taiwan, taiwan_source = import_taiwan_registrations(ROOT / 'docs/growth-assets/national-store-research/taiwan-food-restaurant-registration.json')
    stores.extend(taiwan)
    unmatched = merge_featured(stores, read(ROOT / 'assets/data/store-directory.json'))
    status_path = args.cache / 'locator-last-error.json'
    status = read(status_path) if status_path.exists() else None
    output = build(snapshot, stores, hk_source, unmatched, failures, macau_source, status, taiwan_source)
    save(args.cache / 'coverage.json', output['coverage'])
    save(args.output, output)
    print(json.dumps(output['coverage'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
