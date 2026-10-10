"""Attach public regional evidence without creating new restaurant identities."""
import hashlib
import json
import re
import unicodedata

HK_AREA_PREFIXES = ('香港新界', '香港九龍', '香港', '九龍', '新界', '元朗', '大嶼山', '深水埗', '西營盤')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def verify_digest(path, expected):
    content = path.read_bytes().replace(b'\r\n', b'\n')
    if expected not in {hashlib.sha256(content).hexdigest(),
                        hashlib.sha256(content.replace(b'\n', b'\r\n')).hexdigest()}:
        raise ValueError('Reviewed regional source changed: ' + path.name)


def hk_address_forms(address):
    """Keep every street, house, floor and unit; only omit known area prefixes."""
    address = re.sub(r'\s+', '', unicodedata.normalize('NFKC', address))
    forms = {address}
    for prefix in HK_AREA_PREFIXES:
        if prefix == '香港' and address.startswith('香港仔'):
            continue
        if prefix == '九龍' and address.startswith(('九龍城', '九龍灣', '九龍塘')):
            continue
        if address.startswith(prefix):
            forms.add(address[len(prefix):])
    return forms


def attach_hong_kong_desserts(stores, snapshot, base):
    path = base / 'hong-kong-official-dessert-station-snapshot.json'
    if not path.exists():
        return None
    stations = read(path)
    raw = snapshot['stores']
    rows = stations['rows']
    if (not stations.get('full_published_json_collected') or stations['row_count'] != len(rows)
            or stations['unique_addresses'] != len(rows)
            or len({re.sub(r'\s+', '', unicodedata.normalize('NFKC', r['address'])) for r in rows}) != len(rows)):
        raise ValueError('Incomplete or repeated Hong Kong dessert addresses')
    by_id = {s['id']: s for s in stores}
    if len(by_id) != len(raw):
        raise ValueError('Hong Kong restaurant identity changed')
    restaurant_forms = [(r, hk_address_forms(r['address'])) for r in raw]
    station_forms = [(r, hk_address_forms(r['address'])) for r in rows]
    for restaurant in raw:
        if 'dessertkiosks' in restaurant.get('facilities', []):
            store = by_id['hk:' + restaurant['rid']]
            store['tags'] = list(dict.fromkeys([*store.get('tags', []), '甜品站']))
            store['dessert_service_source_url'] = snapshot['source']
            store['dessert_checked_at'] = snapshot['collected_at']
    linked = []
    for row, forms in station_forms:
        candidates = [r for r, address in restaurant_forms if forms & address]
        if len(candidates) != 1:
            if row.get('restaurant_rid'):
                raise ValueError('Previously reviewed dessert parent is no longer unique')
            continue
        restaurant = candidates[0]
        reverse = [r for r, address in station_forms if hk_address_forms(restaurant['address']) & address]
        if len(reverse) != 1:
            continue
        if row.get('restaurant_rid') and row['restaurant_rid'] != restaurant['rid']:
            raise ValueError('Reviewed dessert restaurant identity changed')
        store = by_id['hk:' + restaurant['rid']]
        exact = re.sub(r'\s+', '', unicodedata.normalize('NFKC', row['address'])) == re.sub(
            r'\s+', '', unicodedata.normalize('NFKC', restaurant['address']))
        method = 'unique_complete_address' if exact else 'unique_complete_address_known_area_prefix'
        store.update(dessert_station_address=row['address'], dessert_station_source_url=stations['source_url'],
                     dessert_checked_at=stations['fetched_at'], dessert_match_method=method)
        store.setdefault('dessert_service_source_url', stations['source_url'])
        store['tags'] = list(dict.fromkeys([*store.get('tags', []), '甜品站']))
        linked.append({'store_id': store['id'], 'station_address': row['address'], 'match_method': method})
    return {'url': stations['source_url'], 'collected_at': stations['fetched_at'], 'published_addresses': len(rows),
            'matched_parent_restaurants': len(linked), 'unresolved_parent_addresses': len(rows) - len(linked),
            'locator_listed_restaurants': sum('dessertkiosks' in r.get('facilities', []) for r in raw),
            'restaurants_with_dessert_evidence': sum('甜品站' in s.get('tags', []) for s in stores),
            'added_restaurants': 0, 'matches': linked}


def macau_address_key(address):
    address = unicodedata.normalize('NFKC', address).replace('–', '-').replace('－', '-')
    address = re.sub(r'(?<=\d)[,，、](?=\d)', '|', address)
    address = re.sub(r'[\s,，、()（）]', '', address)
    return re.sub(r'^澳門', '', address)


def attach_macau_dated_government(stores, base):
    path = base / 'macau-government-address-crosswalk.json'
    if not path.exists():
        return None
    reviewed = read(path)
    paths = {'government': base / 'macau-government-senior-card-snapshot.json',
             'directory': base / 'macau-directory-cross-check.json', 'iam': base / 'macau-iam-license-snapshot.json'}
    for key, source in paths.items():
        verify_digest(source, reviewed['input_sha256'][key])
    government, directory = read(paths['government']), read(paths['directory'])
    rows = government['rows']
    if len(rows) != government['row_count'] or len(reviewed['rows']) != len(rows):
        raise ValueError('Incomplete Macau government address review')
    seen = set()
    attached = 0
    for row in reviewed['rows']:
        evidence = row['government_evidence']
        if evidence not in rows or evidence['source_row'] in seen:
            raise ValueError('Changed or repeated Macau government review row')
        seen.add(evidence['source_row'])
        if not row['eligible_to_attach_dated_government_source']:
            continue
        key = macau_address_key(evidence['address'])
        forward = [r for r in directory['rows'] if macau_address_key(r['address']) == key]
        reverse = [r for r in rows if macau_address_key(r['address']) == key]
        if (len(forward) != 1 or len(reverse) != 1 or forward[0]['phone'] != row['directory_phone']
                or row['directory_candidates'] != forward):
            raise ValueError('Macau government complete address is not uniquely linked')
        candidates = [s for s in stores if s.get('directory_phone') == row['directory_phone']]
        if len(candidates) != 1:
            raise ValueError('Macau government restaurant identity is ambiguous')
        store = candidates[0]
        store.update(government_service_name=evidence['name'], government_service_address=evidence['address'],
                     government_service_source_url=evidence['source_url'],
                     government_service_published_date=evidence['published_updated_date'],
                     government_service_checked_at=government['fetched_at'])
        store['aliases'] = list(dict.fromkeys([*store.get('aliases', []), evidence['name']]))
        attached += 1
    return {'url': government['source_url'], 'published_date': government['published_updated_date'],
            'collected_at': government['fetched_at'], 'published_rows': len(rows),
            'matched_existing_restaurants': attached, 'added_restaurants': 0}
