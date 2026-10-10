import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import sync_taiwan_tax as T


def tax(ban='12345678', address='臺北市大安區建安里敦化南路１段１００號２樓', **changes):
    return {'統一編號':ban, '總機構統一編號':T.PARENT, '營業人名稱':'和德昌股份有限公司測試分公司',
            '營業地址':address, '行業代號':'561114', **changes}


class TaxTests(unittest.TestCase):
    def test_village_is_optional_but_house_and_floor_are_required(self):
        food=[{'食品業者登錄字號':'fda:one','業者地址':'台北市大安區敦化南路一段100號2樓'}]
        self.assertIn('fda:one',T.match_food_registration(food,[tax()]))
        for wrong in ('台北市大安區敦化南路1段100號1樓','台北市大安區敦化南路1段101號2樓',
                      '台北市大安區敦化北路1段100號2樓','台北市大安區敦化南路1段100號'):
            self.assertFalse(T.match_food_registration([dict(food[0],業者地址=wrong)],[tax()]))

    def test_village_name_can_contain_village_character_without_removing_road(self):
        self.assertEqual(T.address_key('嘉義市東區興村里吳鳳南路310號'), '嘉義市東區吳鳳南路310號')
        self.assertEqual(T.address_key('台北市大安區敦化南路100號2樓'), '台北市大安區敦化南路100號2樓')

    def test_duplicate_fda_or_tax_addresses_do_not_choose_an_arbitrary_identity(self):
        food={'食品業者登錄字號':'fda:one','業者地址':tax()['營業地址']}
        self.assertFalse(T.match_food_registration([food,dict(food,食品業者登錄字號='fda:two')],[tax()]))
        self.assertFalse(T.match_food_registration([food],[tax(),tax(ban='87654321')]))

    def test_headquarters_and_non_restaurant_or_other_owner_are_excluded(self):
        self.assertFalse(T.restaurant(tax(ban=T.PARENT)))
        self.assertFalse(T.restaurant(tax(行業代號='458312')))
        self.assertFalse(T.restaurant(tax(總機構統一編號='00000000')))
        self.assertTrue(T.restaurant(tax(行業代號='472999',行業代號1='561115')))

    def test_collector_exports_only_related_restaurants_and_explicit_exclusions(self):
        stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=T.FIELDS);writer.writeheader()
        for row in (tax(),tax(ban=T.PARENT),tax(ban='99999999',總機構統一編號='87654321')):
            writer.writerow({key:row.get(key,'') for key in T.FIELDS})
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'public.zip'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('BGMOPEN1.csv',stream.getvalue().encode('utf-8-sig'))
            result=T.collect(path)
        self.assertEqual(result['source_csv_rows'],3)
        self.assertEqual(len(result['rows']),1)
        self.assertEqual(len(result['excluded']),1)
        self.assertNotIn('99999999',json.dumps(result))

    def test_real_snapshot_has_unique_tax_ids_and_preserves_all_existing_directory_ids(self):
        source=json.loads((ROOT/'assets/data/taiwan-operating-tax-registration.json').read_text(encoding='utf-8'))
        self.assertEqual(len(source['rows']),409)
        self.assertEqual(len({r['統一編號'] for r in source['rows']}),409)
        catalog=json.loads((ROOT/'assets/data/national-store-directory.json').read_text(encoding='utf-8'))
        self.assertEqual(catalog['sources']['taiwan']['operating_tax_matched_records'],143)
        self.assertEqual(catalog['sources']['taiwan']['tax_branch_names_added'],38)
        self.assertEqual(catalog['sources']['taiwan']['named_registration_records'],249)
        self.assertEqual(len(catalog['stores']),9275)


if __name__ == '__main__':unittest.main()
