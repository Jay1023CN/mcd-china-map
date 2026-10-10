"""Add evidence-backed Chinese store metadata to private MCP candidates."""

from copy import deepcopy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRECTORY = ROOT / 'assets' / 'data' / 'national-store-directory.json'
DEFAULT_PRIVATE_DIRECTORY = ROOT / 'private' / 'store-directory.json'
DEFAULT_CITIES = ROOT / 'assets' / 'data' / 'china-cities.json'
SPECIAL_REGION_CODES = {'710000', '810000', '820000'}


def _records(value, default_path):
    """Load a JSON list or accept an already loaded list; missing files are OK."""
    if value is None:
        path = default_path
    elif isinstance(value, (str, Path)):
        path = Path(value)
    else:
        return value if isinstance(value, list) else value.get('stores', []) if isinstance(value, dict) else []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return []
    return data if isinstance(data, list) else data.get('stores', []) if isinstance(data, dict) else []


def _default_store_directory():
    """Load private records first, then public records with unseen names."""
    private_records = _records(DEFAULT_PRIVATE_DIRECTORY, DEFAULT_PRIVATE_DIRECTORY)
    public_records = _records(DEFAULT_DIRECTORY, DEFAULT_DIRECTORY)
    combined = []
    names = set()
    for record in private_records:
        if not isinstance(record, dict) or not isinstance(record.get('name'), str):
            continue
        name = record['name']
        if name in names:
            continue
        names.add(name)
        combined.append(record)
    combined.extend(record for record in public_records if isinstance(record, dict) and record.get('name') not in names)
    return combined


def _city_index(cities):
    result = {}
    for city in cities:
        if not isinstance(city, dict):
            continue
        name = city.get('city')
        if isinstance(name, str) and name and isinstance(city.get('province_code'), str):
            # Duplicate city names with different administrative codes are
            # ambiguous and therefore cannot support an inferred location.
            result.setdefault(name, []).append(city)
    return result


def _directory_match(store_name, directory, city=None, province=None):
    matches = []
    for record in directory:
        if not isinstance(record, dict) or not isinstance(record.get('name'), str):
            continue
        names = [record['name'], record.get('featured_name'), record.get('locator_name')]
        aliases = record.get('aliases', [])
        if isinstance(aliases, list):
            names.extend(alias for alias in aliases if isinstance(alias, str))
        if (store_name in names and (not city or city.removesuffix('市') == record.get('city', '').removesuffix('市'))
                and (not province or not record.get('province_code') or province == record['province_code'])):
            matches.append(record)
    return matches[0] if len(matches) == 1 else None


def _resolve_city(label, index):
    if not isinstance(label, str) or not label:
        return None
    matches = index.get(label, [])
    return matches[0] if len(matches) == 1 else None


def _same_city(first, second, index):
    first_record = _resolve_city(first, index)
    second_record = _resolve_city(second, index)
    if first_record is not None and second_record is not None:
        return first_record['city'] == second_record['city']
    if isinstance(first, str) and isinstance(second, str):
        return first.removesuffix('市') == second.removesuffix('市')
    return False


def _special_region(province_code=None, city_record=None):
    return province_code in SPECIAL_REGION_CODES or (
        city_record is not None and city_record.get('province_code') in SPECIAL_REGION_CODES
    )


def _address_city(address, index):
    """Resolve an address only when a city label starts its locality portion."""
    if not isinstance(address, str):
        return None
    address = address.strip()
    matches = []
    for name in index:
        labels = (name, name + '市')
        if any(address.startswith(label) for label in labels):
            matches.append(name)
            continue
        # Addresses commonly start with a province or autonomous region.
        # Accept a city label immediately after that administrative prefix.
        for marker in ('省', '自治区'):
            boundary = address.find(marker)
            if boundary >= 0 and any(address[boundary + len(marker):].startswith(label) for label in labels):
                matches.append(name)
                break
    matches = list(dict.fromkeys(matches))
    return _resolve_city(matches[0], index) if len(matches) == 1 else None


def _prefix_city(store_name, index):
    if not isinstance(store_name, str) or not store_name.startswith('麦当劳'):
        return None
    remainder = store_name[len('麦当劳'):].lstrip()
    matches = [name for name in index if remainder.startswith(name)]
    # Require a single possible city prefix; do not search the rest of the
    # store name for incidental city words.
    if len(matches) != 1:
        return None
    return _resolve_city(matches[0], index) if len(matches) == 1 else None


def enrich_archive(archive, *, directory=None, cities=None):
    """Return a copied archive with store directory/city metadata filled in.

    ``directory`` and ``cities`` may be JSON file paths or in-memory lists.
    Only CN entries are enriched. Prefer uniquely matched public store points;
    city-level fallback points remain explicitly labelled as city references.
    """
    result = deepcopy(archive)
    if not isinstance(result, dict) or not isinstance(result.get('entries'), list):
        return result
    store_directory = _default_store_directory() if directory is None else _records(directory, DEFAULT_DIRECTORY)
    city_records = _records(cities, DEFAULT_CITIES)
    city_index = _city_index(city_records)

    for entry in result['entries']:
        if not isinstance(entry, dict) or entry.get('country_code') != 'CN':
            continue
        store_name = entry.get('store')
        exact = _directory_match(store_name, store_directory, entry.get('city'), entry.get('province_code'))

        reference = entry.get('store_reference')
        address = exact.get('address') if exact else None
        if not isinstance(address, str) and isinstance(reference, dict):
            address = reference.get('address')
        if not isinstance(address, str):
            address = entry.get('address')

        city_record = _resolve_city(entry.get('city'), city_index)
        directory_city = _resolve_city(exact.get('city'), city_index) if exact else None
        if directory_city is None and exact:
            directory_city = _address_city(exact.get('address'), city_index)
        if _special_region(entry.get('province_code'), city_record) or _special_region(
                exact.get('province_code') if exact else None, directory_city):
            continue

        exact_city_label = exact.get('city') if exact else None
        if not isinstance(exact_city_label, str) or not exact_city_label:
            exact_city_label = directory_city.get('city') if directory_city else None
        city_conflict = bool(entry.get('city') and exact_city_label and
                             not _same_city(entry['city'], exact_city_label, city_index))
        directory_province_conflict = bool(
            exact and exact.get('province_code') and directory_city and
            exact['province_code'] != directory_city.get('province_code')
        )

        if exact is not None and not city_conflict:
            if not entry.get('city') and isinstance(exact.get('city'), str) and exact['city']:
                entry['city'] = exact['city']
                entry['city_source'] = 'store_directory_exact'
            if not entry.get('default_photo') and isinstance(exact.get('default_photo'), dict):
                entry['default_photo'] = deepcopy(exact['default_photo'])
            location = exact.get('location')
            if (not entry.get('location') and not directory_province_conflict and isinstance(location, dict)
                    and location.get('precision') == 'store' and location.get('coordinate_system') in {'GCJ-02','WGS84','official_google_maps_unverified'}
                    and isinstance(location.get('lat'), (int, float)) and -90 <= location['lat'] <= 90
                    and isinstance(location.get('lon'), (int, float)) and -180 <= location['lon'] <= 180):
                entry['location'] = {key: location[key] for key in ('lat','lon','precision','coordinate_system')}

        if city_record is None:
            city_record = _resolve_city(entry.get('city'), city_index)
        if city_record is None:
            city_record = _address_city(address, city_index)
            if city_record and not entry.get('city'):
                entry['city'] = city_record['city']
                entry['city_source'] = 'store_directory_exact' if exact else 'store_address'
        if city_record is None and not entry.get('city'):
            city_record = _prefix_city(store_name, city_index)
            if city_record:
                entry['city'] = city_record['city']
                entry['city_source'] = 'store_name_prefix'

        if not entry.get('province_code'):
            if (exact is not None and not city_conflict and not directory_province_conflict and
                    isinstance(exact.get('province_code'), str) and exact['province_code']):
                entry['province_code'] = exact['province_code']
            elif city_record is not None:
                entry['province_code'] = city_record['province_code']
        if (('location' not in entry or entry['location'] is None) and city_record is not None
                and not directory_province_conflict):
            if all(key in city_record for key in ('lat', 'lon')):
                entry['location'] = {'lat': city_record['lat'], 'lon': city_record['lon'], 'precision': 'city'}
    return result
