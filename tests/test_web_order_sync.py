"""Run the real order normalization pipeline without shared local response files."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import sync_footprints
import test_sync_orders as fixtures


class WebOrderSyncTests(unittest.TestCase):
    def test_web_sync_never_uses_shared_output_private_directory_or_html(self):
        fixture = fixtures.SyncOrdersTests().make_client()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            shared = directory / 'shared'
            shared.mkdir()
            marker = shared / 'global-candidates.json'
            marker.write_text('other user previous records', encoding='utf-8')
            with patch('sync_footprints.Client', fixture), \
                    patch('sync_footprints.OUTPUT', shared), \
                    patch('connect_mcp.OUTPUT', shared), \
                    patch('store_enrichment._default_store_directory', side_effect=AssertionError('private stores read')), \
                    patch('sync_footprints.render', side_effect=AssertionError('private page rendered')):
                for name in ('a', 'b'):
                    output = directory / name
                    archive = sync_footprints.sync_orders('fixture-secret-' + name, output_dir=output,
                              store_directory=ROOT / 'assets/data/store-directory.json', render_page=False)
                    self.assertEqual(archive['entries'][0]['source'], 'mcp_candidate')
                    self.assertEqual(len(archive['entries']), 1)
                    self.assertTrue((output / 'global-candidates.json').is_file())
                    self.assertEqual(list(output.rglob('*.html')), [])
                    for path in output.rglob('*.json'):
                        self.assertNotIn('fixture-secret-', path.read_text(encoding='utf-8'))
            self.assertEqual(marker.read_text(encoding='utf-8'), 'other user previous records')
            self.assertEqual(list(shared.iterdir()), [marker])


if __name__ == '__main__':
    unittest.main()
