"""Contract tests for the public static web build."""

import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_web_app


class BuildWebAppTests(unittest.TestCase):
    def test_blank_public_build_uses_relative_hashed_assets_and_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = build_web_app.build(output)
            html = (output / 'index.html').read_text(encoding='utf-8')
            saved_manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))

            self.assertEqual(saved_manifest, manifest)
            self.assertEqual(manifest['archive'], {'version': 1, 'data_kind': 'manual', 'entry_count': 0})
            self.assertEqual(manifest['entrypoint'], 'index.html')
            self.assertNotIn(str(ROOT), html)
            self.assertNotIn('file://', html)
            self.assertNotRegex(html, r'(?:src|href)=["\']/|url\(["\']?/')

            data_match = re.search(
                r'<script\s+id="journal-data"\s+type="application/json">(.*?)</script>',
                html, re.DOTALL,
            )
            self.assertIsNotNone(data_match)
            data = json.loads(data_match.group(1))
            self.assertEqual(data['runtime'], {'local_api': False})
            self.assertEqual(data['archive']['entries'], [])
            self.assertNotIn('wishlist', data['archive'])
            self.assertTrue(data['store_images'])
            source_stores = json.loads((ROOT / 'assets' / 'data' / 'store-directory.json').read_text(encoding='utf-8'))
            offline_index = (ROOT / 'index.html').read_text(encoding='utf-8')
            self.assertRegex(offline_index, r'data:image/(?:jpeg|webp);base64,',
                             'the offline index should keep its self-contained photo payloads')
            self.assertEqual([store['name'] for store in data['stores']], [store['name'] for store in source_stores])
            self.assertTrue(source_stores)
            self.assertGreaterEqual(len(source_stores), 18, 'expanded public directory should contain at least 18 stores')
            self.assertGreaterEqual(len({store.get('city') for store in source_stores if store.get('city')}), 12,
                                    'expanded public directory should cover at least 12 cities')
            self.assertTrue(all(store.get('default_photo', {}).get('local_asset') for store in source_stores),
                            'each public catalog store should identify its checked-in photo mirror')
            for store in source_stores:
                mirror = ROOT / 'assets' / store['default_photo']['local_asset']
                self.assertTrue(mirror.is_file(), f"missing public mirror for {store['name']}: {mirror}")

            asset_paths = set()
            manifest_by_path = {record['path']: record for record in manifest['files']}
            for record in manifest['files']:
                path = record['path']
                self.assertFalse(path.startswith(('/', '\\')))
                self.assertNotIn('..', Path(path).parts)
                content = (output / path).read_bytes()
                self.assertEqual(len(content), record['size_bytes'])
                self.assertEqual(hashlib.sha256(content).hexdigest(), record['sha256'])
                if path.startswith('assets/'):
                    digest = Path(path).stem
                    self.assertEqual(digest, record['sha256'])
                    asset_paths.add(path)

            self.assertTrue(asset_paths)
            for store in source_stores:
                photo = store['default_photo']
                uri = data['store_images'].get(photo['url'])
                self.assertIsNotNone(uri, f"missing built image mapping for {store['name']}")
                self.assertRegex(uri, r'^assets/[0-9a-f]{64}\.(?:jpg|jpeg|png|webp)$')
                self.assertIn(uri, asset_paths, f"missing hashed build asset for {store['name']}")
                record = manifest_by_path[uri]
                mirror = ROOT / 'assets' / photo['local_asset']
                mirror_bytes = mirror.read_bytes()
                source_hash = hashlib.sha256(mirror_bytes).hexdigest()
                self.assertEqual(Path(uri).stem, source_hash, f"hashed public asset must match the checked-in mirror for {store['name']}")
                self.assertEqual(record['sha256'], source_hash)
                self.assertEqual(record['size_bytes'], len(mirror_bytes))
            for uri in re.findall(r'(?:url\(|src=["\'])(assets/[0-9a-f]+\.[a-z0-9]+)', html):
                self.assertIn(uri, asset_paths)
            self.assertNotRegex(html, r'data:image/(?:jpeg|webp);base64,')
            self.assertNotRegex(html, r'data:(?:font/|image/png|image/svg\+xml);base64,')


if __name__ == '__main__':
    unittest.main()
