"""Offline regression tests; all order fixtures are synthetic."""
import json
from pathlib import Path
import sys
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_global_journal import render, candidates, project_archive
from connect_mcp import save_private
from import_mcp_footprints import normalize, explicit_city
from mcp_readonly import Client, decode_sse
import sync_footprints


class ProjectTests(unittest.TestCase):
    def test_build_is_identical_across_python_hash_seeds(self):
        code = "import hashlib,json,sys;sys.path.insert(0,'scripts');from build_global_journal import render;from pathlib import Path;print(hashlib.sha256(render(json.loads(Path('examples/global-journal.synthetic.json').read_text(encoding='utf-8'))).encode()).hexdigest())"
        digests = [subprocess.check_output([sys.executable, '-c', code], cwd=ROOT, env={**os.environ, 'PYTHONHASHSEED': seed}) for seed in ['1', '2']]
        self.assertEqual(digests[0], digests[1])

    def test_windows_build_always_reads_utf8(self):
        original = Path.read_text
        def guarded(path, *args, **kwargs):
            self.assertEqual(kwargs.get('encoding'), 'utf-8', str(path))
            return original(path, *args, **kwargs)
        with patch.object(Path, 'read_text', guarded):
            html = render({'version': 1, 'data_kind': 'manual', 'entries': []})
        self.assertIn('麦麦世界护照', html)
        self.assertIn('"entries":[]', html)

    def test_inline_archive_cannot_close_script_element(self):
        marker = '</script><script>alert("fixture")</script>'
        html = render({'version': 1, 'entries': [{'id': 'fixture', 'note': marker, 'token': 'fixture-secret'}]})
        self.assertNotIn(marker, html)
        self.assertNotIn('fixture-secret', html)
        self.assertIn('\\u003c/script\\u003e', html)

    def test_candidate_conversion_drops_identifiers_and_does_not_confirm(self):
        orders = [{'id': 'fixture-order-only', 'created_at': '2026-10-08T22:00:00+08:00', 'status': 'completed', 'store': {'name': '虚构门店'}, 'items': [{'name': '咖啡'}]}, {'status': 'cancelled'}]
        result = candidates({'source': {'kind': 'mcp'}, 'orders': orders})
        self.assertEqual(len(result['entries']), 1)
        self.assertFalse(result['entries'][0]['confirmed'])
        self.assertEqual(result['entries'][0]['country_code'], 'CN')
        self.assertNotIn('fixture-order-only', json.dumps(result))
        self.assertRaises(ValueError, candidates, {'source': {'kind': 'synthetic'}, 'orders': orders})

    def test_raw_normalization_obeys_textual_status_and_explicit_timezone(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            def result(name, data):
                save_private(name, {'structuredContent': {'success': True, 'data': data}}, directory)
            result('now-time-info.result.json', {'year': 2026})
            row = {'orderId': 'fixture-order', 'createTime': '2026-10-08 22:00:00', 'storeName': '虚构门店', 'orderStatus': '订单已完成', 'status': '7', 'orderProductList': [{'productName': '套餐', 'quantity': 1, 'comboItemList': [{'itemName': '薯条', 'itemQuantity': 1}]}]}
            result('order-list.result.json', {'list': [row]})
            result('order-detail-01.json', {**row, 'storeAddress': '上海市虚构地址', 'realTotalAmount': '12.50'})
            normalized = normalize(directory, '+08:00')
            order = normalized['orders'][0]
            self.assertEqual(order['status'], 'completed')
            self.assertEqual(order['paid_cents'], 1250)
            self.assertEqual(len(order['items']), 1)
            self.assertTrue(order['created_at'].endswith('+08:00'))
            self.assertFalse(normalized['source']['coverage']['complete'])
        self.assertIsNone(explicit_city('虚构路一号'))

    def test_readonly_client_rejects_mutations_before_network(self):
        client = Client('fixture-only')
        with patch('mcp_readonly.urlopen') as network:
            self.assertRaises(ValueError, client.rpc, 'tools/call', {'name': 'create-order', 'arguments': {}})
            network.assert_not_called()

    def test_sse_skips_notifications_and_matches_response_id(self):
        response = [b': keepalive\n', b'data: {"method":"notice"}\n', b'\n', b'data: {"id":2,"result":{}}\n', b'\n']
        self.assertEqual(decode_sse(response, 2), {'id': 2, 'result': {}})

    def test_failed_sync_preserves_previous_import_and_raw_responses(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            prior = directory / 'global-candidates.json'
            prior.write_text('previous-success', encoding='utf-8')
            detail = directory / 'order-detail-01.json'
            detail.write_text('previous-raw', encoding='utf-8')
            with patch.object(sync_footprints, 'OUTPUT', directory), patch.object(sys, 'argv', ['sync', '--order-offset', '+08:00']), patch.object(sync_footprints, 'Client') as factory:
                factory.return_value.tools.return_value = [{'name': name, 'inputSchema': {}} for name in ['now-time-info', 'order-list']]
                factory.return_value.rpc.side_effect = ValueError('fixture-failure')
                with self.assertRaises(SystemExit) as error:
                    sync_footprints.main()
                self.assertEqual(error.exception.code, 2)
            self.assertEqual(prior.read_text(encoding='utf-8'), 'previous-success')
            self.assertEqual(detail.read_text(encoding='utf-8'), 'previous-raw')
            self.assertEqual(len(list((directory / 'runs').glob('*/tools.json'))), 1)


if __name__ == '__main__':
    unittest.main()
