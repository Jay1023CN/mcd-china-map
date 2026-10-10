"""Regional evidence preserves identities and complete address boundaries."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import sync_store_catalog as C
import regional_store_sources as R

BASE = ROOT / 'docs/growth-assets/national-store-research'


class RegionalSourcesTests(unittest.TestCase):
    def test_hong_kong_complete_addresses_and_existing_ids(self):
        stores, source = C.import_hong_kong(BASE / 'hong-kong-official-snapshot.json')
        raw = R.read(BASE / 'hong-kong-official-snapshot.json')['stores']
        self.assertEqual({s['id'] for s in stores}, {'hk:' + r['rid'] for r in raw})
        self.assertEqual(len(stores), 269)
        evidence = source['dessert_stations']
        self.assertEqual(evidence['published_addresses'], 101)
        self.assertEqual(evidence['matched_parent_restaurants'], 55)
        self.assertEqual(evidence['unresolved_parent_addresses'], 46)
        self.assertEqual(evidence['locator_listed_restaurants'], 50)
        self.assertEqual(evidence['restaurants_with_dessert_evidence'], 80)
        self.assertEqual(evidence['added_restaurants'], 0)
        for store, original in zip(stores, raw):
            self.assertEqual(store['address'], original['address'])
            self.assertEqual(store['location']['lat'], original['lat'])
        by_id = {s['id']: s for s in stores}
        self.assertEqual(by_id['hk:900043']['dessert_match_method'], 'unique_complete_address_known_area_prefix')
        self.assertIn('甜品站', by_id['hk:900016']['tags'])
        self.assertNotIn('dessert_station_source_url', by_id['hk:900347'])

    def test_address_forms_keep_numbers_floors_and_units(self):
        self.assertNotIn('仔中心地下A舖', R.hk_address_forms('香港仔中心地下A舖'))
        self.assertNotIn('灣德福廣場F21舖', R.hk_address_forms('九龍灣德福廣場F21舖'))
        for a, b in [('山頂道118號2樓209-210號舖', '山頂道118號2樓11-12號舖'),
                     ('康城4樓431號舖', '康城4樓431A號舖'),
                     ('新城市2樓222-223號舖', '新城市2樓221-223號舖')]:
            self.assertFalse(R.hk_address_forms(a) & R.hk_address_forms(b))
        self.assertNotEqual(R.macau_address_key('澳門街1,2號地下A座'), R.macau_address_key('澳門街12號地下A座'))
        self.assertNotEqual(R.macau_address_key('澳門街12號地下A座'), R.macau_address_key('澳門街12號一樓A座'))

    def test_changed_reviewed_hong_kong_parent_fails(self):
        stores, _ = C.import_hong_kong(BASE / 'hong-kong-official-snapshot.json')
        snapshot = R.read(BASE / 'hong-kong-official-snapshot.json')
        stations = R.read(BASE / 'hong-kong-official-dessert-station-snapshot.json')
        next(r for r in stations['rows'] if r.get('restaurant_rid'))['restaurant_rid'] = 'wrong-parent'
        with patch.object(R, 'read', return_value=stations), self.assertRaisesRegex(ValueError, 'identity changed'):
            R.attach_hong_kong_desserts(copy.deepcopy(stores), snapshot, BASE)

    def test_macau_dated_sources_do_not_replace_addresses_or_add_iam(self):
        stores, source = C.import_macau(BASE / 'macau-tourism-license-partial.json')
        self.assertEqual(len(stores), 39)
        self.assertEqual(source['official_venue_visitor_pages']['rows'], 8)
        self.assertEqual(source['dated_government_service_points']['matched_existing_restaurants'], 9)
        ferry = next(s for s in stores if s['directory_phone'] == '28703031')
        self.assertIn('3006', ferry['venue_location'])
        self.assertEqual(ferry['venue_hours'], '07:00-19:30')
        dated = [s for s in stores if s.get('government_service_source_url')]
        self.assertEqual(len(dated), 9)
        self.assertTrue(all(s['government_service_published_date'] == '2025/03/21' for s in dated))
        university = next(s for s in dated if s['directory_phone'] == '28451098')
        self.assertNotIn('iam_source_url', university)
        self.assertIn('P102', university['government_service_address'])
        before = copy.deepcopy(stores)
        R.attach_macau_dated_government(stores, BASE)
        self.assertEqual([(s['id'], s['address'], s.get('iam_address')) for s in stores],
                         [(s['id'], s['address'], s.get('iam_address')) for s in before])
        for phone in ('28768198', '28238758', '28716521'):
            self.assertNotIn('government_service_source_url', next(s for s in stores if s['directory_phone'] == phone))

    def test_changed_government_input_requires_new_review(self):
        stores, _ = C.import_macau(BASE / 'macau-tourism-license-partial.json')
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            for name in ('macau-government-address-crosswalk.json', 'macau-government-senior-card-snapshot.json',
                         'macau-directory-cross-check.json', 'macau-iam-license-snapshot.json'):
                (base / name).write_bytes((BASE / name).read_bytes())
            path = base / 'macau-government-senior-card-snapshot.json'
            data = R.read(path)
            data['rows'][0]['address'] += '变更'
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'source changed'):
                R.attach_macau_dated_government(stores, base)


if __name__ == '__main__':
    unittest.main()
