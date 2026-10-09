"""Focused tests for automatic metadata added to MCP candidate archives."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import store_enrichment
from store_enrichment import enrich_archive


class StoreEnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.cities = [
            {'city': '上海', 'province_code': '310000', 'lat': 31.2304, 'lon': 121.4737},
            {'city': '杭州', 'province_code': '330000', 'lat': 30.2741, 'lon': 120.1551},
            {'city': '海', 'province_code': '999999', 'lat': 1.0, 'lon': 2.0},
        ]

    def entry(self, name, **fields):
        return {'country_code': 'CN', 'store': name, 'confirmed': False, **fields}

    def test_exact_directory_and_alias_add_city_and_default_photo(self):
        photo = {'url': 'https://example.test/store.jpg', 'source_url': 'https://example.test/source',
                 'attribution': 'Example', 'caption': '店面'}
        directory = [{'name': '麦当劳上海人民广场店', 'aliases': ['人民广场麦当劳'], 'city': '上海',
                      'province_code': '310000', 'address': '上海市黄浦区', 'source_url': 'https://example.test',
                      'default_photo': photo}]
        archive = {'version': 1, 'entries': [self.entry('人民广场麦当劳')]}
        result = enrich_archive(archive, directory=directory, cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['city'], '上海')
        self.assertEqual(entry['city_source'], 'store_directory_exact')
        self.assertEqual(entry['province_code'], '310000')
        self.assertEqual(entry['location'], {'lat': 31.2304, 'lon': 121.4737, 'precision': 'city'})
        self.assertEqual(entry['default_photo'], photo)

    def test_store_name_city_prefix_fills_city_province_and_city_point(self):
        result = enrich_archive({'entries': [self.entry('麦当劳上海南京东路店')]},
                                directory=[], cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['city'], '上海')
        self.assertEqual(entry['city_source'], 'store_name_prefix')
        self.assertEqual(entry['province_code'], '310000')
        self.assertEqual(entry['location']['precision'], 'city')

    def test_explicit_address_city_is_resolved_without_a_directory_match(self):
        result = enrich_archive({'entries': [self.entry('无城市名门店', address='上海市浦东新区某路')]},
                                directory=[], cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['city'], '上海')
        self.assertEqual(entry['city_source'], 'store_address')
        self.assertEqual(entry['province_code'], '310000')

    def test_incidental_city_word_and_ambiguous_prefix_do_not_guess(self):
        cities = self.cities + [{'city': '上海新', 'province_code': '310000', 'lat': 32, 'lon': 122}]
        archive = {'entries': [self.entry('某商场上海店'), self.entry('麦当劳上海新店')]}
        result = enrich_archive(archive, directory=[], cities=cities)
        self.assertNotIn('city', result['entries'][0])
        self.assertNotIn('city', result['entries'][1])
        self.assertNotIn('location', result['entries'][1])

    def test_existing_photo_and_user_location_are_preserved(self):
        user_photo = {'data_url': 'data:image/png;base64,user'}
        user_location = {'lat': 9, 'lon': 8, 'precision': 'user'}
        directory = [{'name': '直营门店', 'aliases': [], 'city': '上海', 'province_code': '310000',
                      'default_photo': {'url': 'https://example.test/default.jpg'}}]
        original = {'entries': [self.entry('直营门店', photo=user_photo, location=user_location)]}
        result = enrich_archive(original, directory=directory, cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['photo'], user_photo)
        self.assertEqual(entry['location'], user_location)
        self.assertEqual(entry['default_photo']['url'], 'https://example.test/default.jpg')

    def test_existing_city_conflict_skips_directory_photo_and_uses_its_own_province(self):
        directory = [{'name': '直营门店', 'aliases': [], 'city': '上海', 'province_code': '310000',
                      'default_photo': {'url': 'https://example.test/shanghai.jpg'}}]
        original = {'entries': [self.entry('直营门店', city='杭州', confirmed=True,
                                          source='user_confirmed')]}
        result = enrich_archive(original, directory=directory, cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['city'], '杭州')
        self.assertEqual(entry['province_code'], '330000')
        self.assertNotIn('default_photo', entry)
        self.assertTrue(entry['confirmed'])
        self.assertEqual(entry['source'], 'user_confirmed')

    def test_mainland_candidate_resolving_to_hong_kong_is_left_unchanged(self):
        original_entry = self.entry('香港麦当劳', city='香港', province_code='810000',
                                     confirmed=False, source='mcp_candidate')
        original = {'entries': [original_entry]}
        result = enrich_archive(original, directory=[{'name': '香港麦当劳', 'aliases': [], 'city': '香港',
                                                       'province_code': '810000',
                                                       'default_photo': {'url': 'https://example.test/hk.jpg'}}],
                                cities=self.cities + [
                                    {'city': '香港', 'province_code': '810000', 'lat': 22.3, 'lon': 114.2}])
        self.assertEqual(result['entries'][0], original_entry)

    def test_directory_province_conflict_does_not_add_coordinates(self):
        directory = [{'name': '直营门店', 'aliases': [], 'city': '上海', 'province_code': '330000'}]
        original = {'entries': [self.entry('直营门店', confirmed=False, source='mcp_candidate')]}
        result = enrich_archive(original, directory=directory, cities=self.cities)
        entry = result['entries'][0]
        self.assertEqual(entry['city'], '上海')
        self.assertEqual(entry['province_code'], '310000')
        self.assertNotIn('location', entry)
        self.assertFalse(entry['confirmed'])
        self.assertEqual(entry['source'], 'mcp_candidate')

    def test_does_not_mutate_input_and_missing_directory_is_supported(self):
        original = {'entries': [self.entry('麦当劳上海门店')]}
        before = copy.deepcopy(original)
        result = enrich_archive(original, directory=ROOT / 'assets' / 'missing-store-directory.json', cities=self.cities)
        self.assertEqual(original, before)
        self.assertIsNot(result, original)
        self.assertEqual(result['entries'][0]['city'], '上海')

    def test_default_directories_put_private_records_first_and_deduplicate_by_name(self):
        public = [
            {'name': '重名门店', 'aliases': [], 'city': '上海', 'province_code': '310000',
             'default_photo': {'url': 'https://example.test/public.jpg'}},
            {'name': '仅公共门店', 'aliases': [], 'city': '上海', 'province_code': '310000'},
        ]
        private = [
            {'name': '重名门店', 'aliases': [], 'city': '杭州', 'province_code': '330000',
             'default_photo': {'url': 'https://example.test/private.jpg'}},
            {'name': '仅私有门店', 'aliases': [], 'city': '杭州', 'province_code': '330000'},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            public_path = Path(temporary) / 'public.json'
            private_path = Path(temporary) / 'private.json'
            public_path.write_text(json.dumps(public, ensure_ascii=False), encoding='utf-8')
            private_path.write_text(json.dumps(private, ensure_ascii=False), encoding='utf-8')
            with patch.object(store_enrichment, 'DEFAULT_DIRECTORY', public_path), \
                    patch.object(store_enrichment, 'DEFAULT_PRIVATE_DIRECTORY', private_path):
                archive = {'entries': [self.entry('重名门店'), self.entry('仅公共门店'),
                                       self.entry('仅私有门店')]}
                result = enrich_archive(archive, cities=self.cities)
        entries = {entry['store']: entry for entry in result['entries']}
        self.assertEqual(entries['重名门店']['city'], '杭州')
        self.assertEqual(entries['重名门店']['default_photo']['url'], 'https://example.test/private.jpg')
        self.assertEqual(entries['仅公共门店']['city'], '上海')
        self.assertEqual(entries['仅私有门店']['city'], '杭州')

    def test_explicit_directory_path_does_not_include_default_private_records(self):
        private = [{'name': '门店', 'aliases': [], 'city': '杭州', 'province_code': '330000',
                    'default_photo': {'url': 'https://example.test/private.jpg'}}]
        explicit = [{'name': '门店', 'aliases': [], 'city': '上海', 'province_code': '310000',
                     'default_photo': {'url': 'https://example.test/explicit.jpg'}}]
        with tempfile.TemporaryDirectory() as temporary:
            private_path = Path(temporary) / 'private.json'
            explicit_path = Path(temporary) / 'explicit.json'
            private_path.write_text(json.dumps(private, ensure_ascii=False), encoding='utf-8')
            explicit_path.write_text(json.dumps(explicit, ensure_ascii=False), encoding='utf-8')
            with patch.object(store_enrichment, 'DEFAULT_PRIVATE_DIRECTORY', private_path):
                result = enrich_archive({'entries': [self.entry('门店')]}, directory=explicit_path,
                                        cities=self.cities)
        self.assertEqual(result['entries'][0]['city'], '上海')
        self.assertEqual(result['entries'][0]['default_photo']['url'], 'https://example.test/explicit.jpg')

    def test_non_mainland_entries_are_untouched(self):
        archive = {'entries': [{'country_code': 'HK', 'store': '麦当劳上海店'}]}
        result = enrich_archive(archive, directory=[], cities=self.cities)
        self.assertEqual(result, archive)


if __name__ == '__main__':
    unittest.main()
