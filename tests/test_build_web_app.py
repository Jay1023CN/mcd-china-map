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
            self.assertTrue(all(value.startswith('data:image/jpeg;base64,')
                                for value in data['store_images'].values()))

            asset_paths = set()
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
            for uri in re.findall(r'(?:url\(|src=["\'])(assets/[0-9a-f]+\.[a-z0-9]+)', html):
                self.assertIn(uri, asset_paths)
            self.assertNotRegex(html, r'data:(?:font/|image/png|image/svg\+xml);base64,')


if __name__ == '__main__':
    unittest.main()
