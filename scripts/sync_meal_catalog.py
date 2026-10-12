#!/usr/bin/env python3
"""Refresh the public meal log catalog from McDonald's China menu pages.

New official menu entries are added automatically. Entries missing from the
official category pages stay available for journaling and are marked as past
menu items; they are never deleted from the user's food history.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MENU_ROOT = 'https://www.mcdonalds.com.cn/product/mcdonalds/'
CATALOG = ROOT / 'assets/data/meal-catalog.json'
MENU_CATEGORIES = [
    ('burgers', '汉堡和卷', 'hamburgers'),
    ('drinks', '饮品', 'beverage'),
    ('drinks', '麦咖啡', '/index/Food/mccafe/mccafe-menu'),
    ('snacks', '小食', 'Snacks'),
    ('desserts', '甜品', 'desserts'),
    ('breakfast', '早餐', 'Breakfast-26'),
    ('combos', '套餐', '500大卡套餐-2'),
    ('happy_meal', '开心乐园餐', 'Happy-Meal-Items-2'),
]
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
NEW_LABEL_DAYS = 30


class ProductCards(HTMLParser):
    """Read product-card links from the official category page HTML."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards = []
        self.card = None
        self.card_depth = 0
        self.name_depth = 0
        self.name_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and self.card is None:
            href = attrs.get('href', '')
            if href.startswith('/product/') and not href.startswith('/product/mcdonalds/'):
                self.card = {'href': href, 'image_url': '', 'name': ''}
                self.card_depth = 1
        elif self.card is not None:
            if tag == 'a':
                self.card_depth += 1
            elif tag == 'span' and 'name' in attrs.get('class', '').split():
                self.name_depth += 1
                self.name_parts = []
            elif tag == 'img' and not self.card['image_url']:
                self.card['image_url'] = attrs.get('src', '') or attrs.get('data-src', '')

    def handle_endtag(self, tag):
        if self.card is None:
            return
        if tag == 'span' and self.name_depth:
            self.name_depth -= 1
            if not self.name_depth:
                self.card['name'] = ''.join(self.name_parts).strip()
        elif tag == 'a':
            self.card_depth -= 1
            if not self.card_depth:
                if self.card['name']:
                    self.cards.append(self.card)
                self.card = None

    def handle_data(self, data):
        if self.name_depth:
            self.name_parts.append(data)


def fetch(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname != 'www.mcdonalds.com.cn':
        raise ValueError('refusing non-official menu URL')
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html'})
    with urlopen(request, timeout=35) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError('official menu page exceeded 5 MiB')
    return raw.decode('utf-8')


def normalize_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme.lower(), (parsed.hostname or '').lower(),
                       unquote(parsed.path).rstrip('/'), '', ''))


def normalize_name(value: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or '')).lower()


def scrape(fetch_page=fetch) -> list[dict]:
    records = []
    for category, _label, slug in MENU_CATEGORIES:
        page_url = (urljoin('https://www.mcdonalds.com.cn', quote(slug, safe='/')) if slug.startswith('/')
                    else urljoin(MENU_ROOT, quote(slug, safe='')))
        parser = ProductCards()
        parser.feed(fetch_page(page_url))
        found = {}
        for card in parser.cards:
            product_url = urljoin(page_url, card['href'])
            if normalize_url(product_url) in found:
                continue
            image_url = urljoin(page_url, card['image_url']) if card['image_url'] else ''
            if image_url and urlsplit(image_url).hostname != 'officiaweb-afd.mcdonalds.com.cn':
                image_url = ''
            found[normalize_url(product_url)] = {
                'name': card['name'], 'category': category, 'source_url': product_url,
                'source_category_url': page_url, 'image_url': image_url,
            }
        if not found:
            raise ValueError(f'no product cards found on official category: {page_url}')
        records.extend(found.values())
        print(f'{category}: {len(found)} products', flush=True)
        time.sleep(.25)
    return records


def update(catalog: dict, official_items: list[dict], today: str | None = None) -> dict:
    if not official_items:
        raise ValueError('empty official catalog')
    date = today or datetime.now(timezone.utc).date().isoformat()
    official_by_url = {normalize_url(item['source_url']): item for item in official_items}
    official_category_urls = {normalize_url(item['source_category_url']) for item in official_items}
    category_counts = {}
    for item in official_items:
        category_counts[item['category']] = category_counts.get(item['category'], 0) + 1
    if any(not count for count in category_counts.values()):
        raise ValueError('an official category is empty')

    by_url = {normalize_url(item['source_url']): item for item in catalog['items']
              if item.get('source_url')}
    by_name = {}
    for item in catalog['items']:
        by_name.setdefault((item.get('category'), normalize_name(item.get('name', ''))), item)
    used_ids = {item['id'] for item in catalog['items']}
    next_id = {}
    for category, *_ in MENU_CATEGORIES:
        numbers = [int(match.group(1)) for item in catalog['items']
                   if (match := re.fullmatch(re.escape(category) + r'-(\d+)', item.get('id', '')))]
        next_id[category] = max(numbers, default=0) + 1

    seen = set()
    for row in official_items:
        key = normalize_url(row['source_url'])
        item = by_url.get(key) or by_name.get((row['category'], normalize_name(row['name'])))
        if item is None:
            number = next_id[row['category']]
            while f"{row['category']}-{number}" in used_ids:
                number += 1
            next_id[row['category']] = number + 1
            item = {'id': f"{row['category']}-{number}", 'name': row['name'],
                    'category': row['category'], 'categories': [row['category']],
                    'source_url': row['source_url'], 'aliases': [],
                    'official_menu_state': 'listed', 'listed_since': date,
                    'new_until': (datetime.fromisoformat(date) + timedelta(days=NEW_LABEL_DAYS)).date().isoformat(),
                    'status_label': f'官网新品 · {date[5:]} 首次收录'}
            item['categories'].append('new')
            catalog['items'].append(item)
            used_ids.add(item['id'])
            by_url[key] = item
            by_name[(row['category'], normalize_name(row['name']))] = item
        old_name = item.get('name', '')
        if old_name and old_name != row['name']:
            item['aliases'] = list(dict.fromkeys([*item.get('aliases', []), old_name]))
            item['name'] = row['name']
        prior_url = item.get('source_url', '')
        if prior_url and normalize_url(prior_url) != key and '/news/' in prior_url:
            item.setdefault('announcement_source_url', prior_url)
        item.update({'category': row['category'], 'source_url': row['source_url'],
                     'source_category_url': row['source_category_url'],
                     'official_menu_state': 'listed'})
        by_url[key] = item
        item['categories'] = list(dict.fromkeys([row['category'], *item.get('categories', [])]))
        if item.get('new_until', '') >= date and item.get('status_label', '').startswith('官网新品 ·'):
            item['categories'] = list(dict.fromkeys([*item['categories'], 'new']))
        if row.get('image_url'):
            item['image_url'] = row['image_url']
        if item.get('status_label') == '官网分类未列出 · 可补记':
            item.pop('status_label', None)
        seen.add(id(item))

    for item in catalog['items']:
        if (item.get('official_menu_state') or normalize_url(item.get('source_category_url', '')) in official_category_urls) and id(item) not in seen:
            item['official_menu_state'] = 'not_listed'
            if not item.get('available_until') and (not item.get('status_label') or
                    item.get('status_label', '').startswith('官网新品 ·') or
                    item.get('status_label') == '官网分类未列出 · 可补记'):
                item['status_label'] = '官网分类未列出 · 可补记'
        new_until = item.get('new_until')
        if new_until and new_until < date:
            item['categories'] = [category for category in item.get('categories', []) if category != 'new']
            if item.get('status_label', '').startswith('官网新品 ·'):
                item.pop('status_label', None)
        available_until = item.get('available_until')
        if available_until and available_until < date and item.get('status_label', '').startswith('限时供应至'):
            item['status_label'] = '限时已结束 · 可补记'
            item['categories'] = [category for category in item.get('categories', []) if category != 'new']

    category_ids = {item['id'] for item in catalog['categories']}
    for category, label, _slug in MENU_CATEGORIES:
        if category not in category_ids:
            catalog['categories'].append({'id': category, 'label': label})
            category_ids.add(category)
    catalog['checked_at'] = date
    return catalog


def main() -> int:
    try:
        catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
        refreshed = update(catalog, scrape())
        CATALOG.write_text(json.dumps(refreshed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except (OSError, ValueError, HTTPError, URLError) as error:
        print(f'menu refresh failed: {type(error).__name__}: {error}', file=sys.stderr)
        return 1
    print(f"official catalog refreshed: {len(refreshed['items'])} items", flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
