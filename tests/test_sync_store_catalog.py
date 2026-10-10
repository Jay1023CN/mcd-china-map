"""Acquisition integrity and conservative matching for public store catalogs."""
import copy
from pathlib import Path
import sys
import unittest
import json
import tempfile
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import sync_store_catalog as C


def snapshot():
    return {'source': C.PUBLICITY, 'collected_at': '2026-10-10T00:00:00Z',
            'expected_pages': 1, 'pages': [{'page': 1, 'row_count': 2, 'response_sha256': 'abc'}],
            'stores': [{'name': '麦当劳上海幸福餐厅', 'city': '上海市', 'official_publicity_ids': ['123'], 'source_url': C.PUBLICITY + '?page=1'},
                       {'name': '麦当劳上海幸福餐厅', 'city': '上海市', 'official_publicity_ids': ['456'], 'source_url': C.PUBLICITY + '?page=1'}]}


class CatalogTests(unittest.TestCase):
    def test_distinct_official_ids_preserve_same_name_stores(self):
        stores=C.import_publicity(snapshot(), [{'city': '上海', 'province_code': '310000'}])
        self.assertEqual(len(stores),2)
        self.assertNotEqual(stores[0]['id'],stores[1]['id'])
        self.assertNotIn('location',stores[0])
        self.assertTrue(stores[0]['locator_ambiguous_disclosure_name'])
        self.assertIsNone(C.match_locator(stores[0],[{'city':'上海市','title':stores[0]['name'],'address':'1号'}]))

    def test_missing_repeated_failed_or_changed_pages_are_rejected(self):
        for patch in ({'expected_pages':2}, {'failed_pages':{'1':'timeout'}}, {'pagination_changes':{'1':2}}):
            value=snapshot();value.update(patch)
            with self.assertRaises(ValueError):C.validate_snapshot(value)
        value=snapshot();value['pages'].append(copy.deepcopy(value['pages'][0]))
        with self.assertRaises(ValueError):C.validate_snapshot(value)

    def test_city_manifest_is_verified_against_actual_city_page_set(self):
        value=snapshot()
        value.update({'city_manifest':[{'city':'上海市','expected_pages':1}], 'collected_cities':1,'expected_cities':1})
        value['pages'][0].update({'city':'上海市','last_page':1})
        self.assertTrue(C.validate_snapshot(value))
        value['pages'][0]['city']='北京市'
        with self.assertRaises(ValueError):C.validate_snapshot(value)

    def test_conflicting_administrative_city_names_do_not_assign_a_province(self):
        stores=C.import_publicity(snapshot(),[{'city':'上海市','province_code':'310000'}, {'city':'上海','province_code':'320000'}])
        self.assertNotIn('province_code',stores[0])

    def test_duplicate_identity_dedup_and_conflict_rejection(self):
        value=snapshot();value['stores'][1]=copy.deepcopy(value['stores'][0])
        stores=C.import_publicity(value,[])
        self.assertEqual(len(stores),1);self.assertEqual(stores[0]['disclosure_occurrences'],2)
        value['stores'][1]['name']='另一家'
        with self.assertRaises(ValueError):C.import_publicity(value,[])

    def test_parser_records_page_row_and_ids_without_downloading_images(self):
        content='<tbody><tr><td><span>城市</span>上海市</td><td><span>门店名称</span>麦当劳幸福餐厅</td><td><a _href="https://example/license/123/BUSINESS/a.png">执照</a></td></tr></tbody><div class="page-pagination"><a href="?page=3">3</a></div>'
        result=C.parse_page(content,1,C.PUBLICITY,'hash')
        self.assertEqual(result['last_page'],3)
        self.assertEqual(result['rows'][0]['name'],'麦当劳幸福餐厅')
        self.assertEqual(result['rows'][0]['source_row'],1)
        self.assertEqual(result['rows'][0]['official_publicity_ids'],['123'])
        self.assertNotIn('a.png',str(result))

    def test_stale_page_numbers_in_official_url_paths_do_not_pollute_pagination(self):
        content='<tbody></tbody><div class="page-pagination"><a href="/deliveryinfo&page=161?city=北京&page=68">68</a></div><a href="/news?page=999">新闻</a>'
        self.assertEqual(C.parse_page(content,4,C.PUBLICITY)['last_page'],68)

    def test_matching_requires_same_city_and_unique_name_and_address(self):
        store={'name':'麦当劳上海幸福餐厅','city':'上海市'}
        row={'title':'麦当劳(幸福店)','city':'上海市','address':'徐汇区1号','location':{'lat':31.2,'lng':121.4}}
        self.assertEqual(C.match_locator(store,[row]),row)
        self.assertIsNone(C.match_locator(store,[{**row,'city':'南京市'}]))
        self.assertIsNone(C.match_locator(store,[row,{**row,'address':'虹口区2号'}]))
        self.assertIsNone(C.match_locator(store,[{**row,'title':'麦当劳幸福广场店'}]))

    def test_enrichment_keeps_coordinate_system_and_projects_only_public_fields(self):
        store={'name':'麦当劳幸福餐厅','city':'上海市'}
        row={'title':store['name'],'city':'上海市','address':'1号','adcode':310101,'location':{'lat':31.2,'lng':121.4},
             '_source_endpoint':C.LOCATOR,'_fetched_at':'date','token':'private'}
        C.apply_locator(store,row)
        self.assertEqual(store['location']['coordinate_system'],'GCJ-02')
        self.assertEqual(store['location']['precision'],'store')
        self.assertEqual(store['province_code'],'310000')
        self.assertNotIn('private',str(store))

    def test_saved_public_location_requires_unchanged_id_name_and_city(self):
        row = {'id':'cn:1','name':'真实店','city':'上海市','address':'公开路1号',
               'location':{'lat':31.2,'lon':121.4,'precision':'store','coordinate_system':'GCJ-02'}}
        stores = [dict(row, address=''), dict(row, id='cn:2', address=''),
                  dict(row, name='改名', address=''), dict(row, city='杭州市', address='')]
        for store in stores: store.pop('location')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'public.json';path.write_text(json.dumps({'stores':[row]}),encoding='utf-8')
            C.apply_saved_locations(stores,path)
        self.assertEqual(stores[0]['location'],row['location'])
        self.assertTrue(all('location' not in store for store in stores[1:]))

    def test_business_quota_error_stops_batch_without_caching_fake_empty_results(self):
        stores=[{'id':str(i),'name':f'麦当劳幸福{i}餐厅','city':'上海市'} for i in range(20)]
        with tempfile.TemporaryDirectory() as directory:
            cache=Path(directory)
            with patch.object(C,'request',return_value=json.dumps({'status':121,'message':'quota'}).encode()) as req:
                failures=C.sync_locator(stores,cache,1,0)
            self.assertEqual(req.call_count,1)
            self.assertTrue(failures)
            self.assertEqual(list((cache/'locator').glob('*.json')),[])
            self.assertEqual(C.read(cache/'locator-last-error.json')['status'],121)


if __name__=='__main__':unittest.main()
