import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_meal_catalog import ProductCards, scrape, update


class MealCatalogSyncTests(unittest.TestCase):
    def test_product_cards_read_name_link_and_official_image(self):
        parser = ProductCards()
        parser.feed('''<div><a href="/product/example">
          <div class="pic"><img src="https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/meal.png"></div>
          <span class="name">测试新品</span></a></div>''')
        self.assertEqual(parser.cards, [{
            'href': '/product/example',
            'image_url': 'https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/meal.png',
            'name': '测试新品',
        }])

    def test_refresh_adds_new_items_and_keeps_removed_items_for_journaling(self):
        catalog = {
            'checked_at': '2026-10-01',
            'categories': [{'id': 'burgers', 'label': '汉堡和卷'}],
            'items': [
                {'id': 'burgers-1', 'name': '旧汉堡', 'category': 'burgers',
                 'categories': ['burgers'], 'source_url': 'https://www.mcdonalds.com.cn/product/old',
                 'source_category_url': 'https://www.mcdonalds.com.cn/product/mcdonalds/hamburgers',
                 'aliases': [], 'official_menu_state': 'listed'},
                {'id': 'custom-1', 'name': '手动补记餐品', 'category': 'combos',
                 'categories': ['combos'], 'source_url': 'https://www.mcdonalds.com.cn/news/example',
                 'aliases': [], 'status_label': '活动已结束 · 可补记'},
            ],
        }
        rows = [{
            'name': '新汉堡', 'category': 'burgers',
            'source_url': 'https://www.mcdonalds.com.cn/product/new',
            'source_category_url': 'https://www.mcdonalds.com.cn/product/mcdonalds/hamburgers',
            'image_url': 'https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/new.png',
        }]
        updated = update(copy.deepcopy(catalog), rows, today='2026-10-13')
        by_name = {item['name']: item for item in updated['items']}
        self.assertIn('旧汉堡', by_name)
        self.assertEqual(by_name['旧汉堡']['status_label'], '官网分类未列出 · 可补记')
        self.assertEqual(by_name['新汉堡']['categories'], ['burgers', 'new'])
        self.assertEqual(by_name['新汉堡']['id'], 'burgers-2')
        self.assertIn('手动补记餐品', by_name)
        self.assertEqual(by_name['手动补记餐品']['status_label'], '活动已结束 · 可补记')
        self.assertIn({'id': 'happy_meal', 'label': '开心乐园餐'}, updated['categories'])
        category_ids = [category['id'] for category in updated['categories']]
        self.assertEqual(len(category_ids), len(set(category_ids)))

    def test_empty_or_broken_category_fails_closed(self):
        calls = []
        def fake_fetch(url):
            calls.append(url)
            if len(calls) == 1:
                return '<a href="/product/x"><span class="name">X</span></a>'
            return '<html>temporary error</html>'
        with self.assertRaisesRegex(ValueError, 'no product cards'):
            scrape(fake_fetch)

    def test_expired_limited_item_leaves_new_tab_but_stays_recordable(self):
        catalog = {'categories': [], 'items': [{
            'id': 'combos-1', 'name': '限时套餐', 'category': 'combos',
            'categories': ['combos', 'new'], 'source_url': 'https://www.mcdonalds.com.cn/news/item',
            'aliases': [], 'status_label': '限时供应至 11月3日', 'available_until': '2026-11-03',
        }]}
        refreshed = update(catalog, [{'name': '普通新套餐', 'category': 'combos',
            'source_url': 'https://www.mcdonalds.com.cn/product/new-combo',
            'source_category_url': 'https://www.mcdonalds.com.cn/product/mcdonalds/500大卡套餐-2',
            'image_url': ''}], today='2026-11-04')
        old = next(item for item in refreshed['items'] if item['id'] == 'combos-1')
        self.assertEqual(old['status_label'], '限时已结束 · 可补记')
        self.assertEqual(old['categories'], ['combos'])

    def test_active_newly_listed_item_stays_in_new_tab(self):
        catalog = {'categories': [], 'items': []}
        row = {'name': '新品', 'category': 'burgers',
               'source_url': 'https://www.mcdonalds.com.cn/product/new',
               'source_category_url': 'https://www.mcdonalds.com.cn/product/mcdonalds/hamburgers',
               'image_url': ''}
        once = update(catalog, [row], today='2026-10-13')
        twice = update(once, [row], today='2026-10-20')
        item = twice['items'][0]
        self.assertIn('new', item['categories'])
        self.assertEqual(item['listed_since'], '2026-10-13')


if __name__ == '__main__':
    unittest.main()
