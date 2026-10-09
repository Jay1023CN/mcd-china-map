"""Synthetic read-only MCP loop tests for the sync_orders function."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import store_enrichment
import sync_footprints
import connect_mcp


class SyncOrdersTests(unittest.TestCase):
    def make_tools(self):
        return [
            {'name': 'now-time-info', 'inputSchema': {'required': []}},
            {'name': 'order-list', 'inputSchema': {'required': []}},
            {'name': 'query-order', 'inputSchema': {'required': ['orderId']}},
        ]

    def make_client(self):
        now = {'year': 2026}
        order = {
            'orderId': 'synthetic-order-1', 'createTime': '2026-10-09 08:30:00',
            'storeName': '合成上海门店', 'storeCode': 'synthetic-store-1',
            'orderStatus': '订单已完成',
            'orderProductList': [{'productName': '合成早餐', 'quantity': 1}]
        }
        detail = {**order, 'storeAddress': '上海市虚构路1号', 'realTotalAmount': '12.50'}

        def rpc(_method, payload):
            name = payload['name']
            data = {
                'now-time-info': now,
                'order-list': {'list': [order]},
                'query-order': detail,
            }[name]
            return {'structuredContent': {'success': True, 'data': data}}

        class FakeClient:
            def __init__(self, token):
                self.token = token
                self.calls = []

            def initialize(self):
                return None

            def tools(self):
                return self_tools

            def rpc(self, method, payload):
                self.calls.append((method, payload))
                return rpc(method, payload)

        self_tools = self.make_tools()
        return FakeClient

    def test_sync_orders_runs_read_only_loop_and_publishes_unconfirmed_archive(self):
        FakeClient = self.make_client()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            private_directory = output / 'test-private-store-directory.json'
            with patch.object(sync_footprints, 'OUTPUT', output), \
                    patch.object(connect_mcp, 'OUTPUT', output), \
                    patch.object(sync_footprints, 'Client', FakeClient), \
                    patch.object(store_enrichment, 'DEFAULT_PRIVATE_DIRECTORY', private_directory):
                progress = []
                archive = sync_footprints.sync_orders('synthetic-token', progress=progress.append)
            self.assertEqual(len(archive['entries']), 1)
            entry = archive['entries'][0]
            self.assertEqual(entry['store'], '合成上海门店')
            self.assertEqual(entry['city'], '上海市')
            self.assertEqual(entry['source'], 'mcp_candidate')
            self.assertFalse(entry['confirmed'])
            self.assertNotIn('synthetic-order-1', json.dumps(archive))
            self.assertGreaterEqual(len(progress), 4)
            self.assertTrue((output / 'global-candidates.json').is_file())
            self.assertTrue((output / 'footprints.normalized.json').is_file())
            self.assertTrue((output / 'latest-sync.json').is_file())
            runs = list((output / 'runs').glob('*/global-candidates.json'))
            self.assertEqual(len(runs), 1)
            self.assertFalse(any('synthetic-token' in path.read_text(encoding='utf-8') for path in output.rglob('*.json')))

    def test_failed_sync_preserves_prior_published_outputs(self):
        class FailingClient:
            def __init__(self, _token):
                pass

            def initialize(self):
                return None

            def tools(self):
                return [{'name': 'now-time-info', 'inputSchema': {'required': []}},
                        {'name': 'order-list', 'inputSchema': {'required': []}}]

            def rpc(self, _method, _payload):
                raise ValueError('synthetic failure')

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            previous = {
                'global-candidates.json': 'old candidates',
                'footprints.normalized.json': 'old normalized',
                'latest-sync.json': 'old latest'
            }
            for name, content in previous.items():
                (output / name).write_text(content, encoding='utf-8')
            private_directory = output / 'test-private-store-directory.json'
            with patch.object(sync_footprints, 'OUTPUT', output), \
                    patch.object(connect_mcp, 'OUTPUT', output), \
                    patch.object(sync_footprints, 'Client', FailingClient), \
                    patch.object(store_enrichment, 'DEFAULT_PRIVATE_DIRECTORY', private_directory):
                with self.assertRaises(ValueError):
                    sync_footprints.sync_orders('synthetic-token')
            for name, content in previous.items():
                self.assertEqual((output / name).read_text(encoding='utf-8'), content)


if __name__ == '__main__':
    unittest.main()
