"""Loopback connection and synced-order API tests using synthetic fixtures."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import local_api
from local_api import Handler, LocalServer


class LocalConnectTests(unittest.TestCase):
    def setUp(self):
        self.server = LocalServer(('127.0.0.1', 0), Handler)
        self.server.token = ''
        self.server.connected = False
        self.server.store_lookup = False
        self.server.order_sync = False
        self.server.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.opener = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, path, method='GET', body=None, origin=None, headers=None):
        request_headers = dict(headers or {})
        if body is not None:
            request_headers.setdefault('Content-Type', 'application/json')
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        if origin is not None:
            request_headers['Origin'] = origin
        request = Request(self.server.origin + path, data=body, headers=request_headers, method=method)
        return self.opener.open(request, timeout=5)

    def test_connect_validates_read_only_tools_without_echoing_or_persisting_token(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(local_api, 'Client') as factory:
            client = factory.return_value
            client.tools.return_value = [
                {'name': 'query-nearby-stores', 'description': 'private tool metadata'},
                {'name': 'order-list'}, {'name': 'query-order'}, {'name': 'now-time-info'}
            ]
            with patch.object(local_api, 'ROOT', Path(directory)):
                response = self.request('/api/connect', 'POST', {'token': '  fixture-secret-token  '}, self.server.origin)
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(body), {'connected': True, 'store_lookup': True, 'order_sync': True})
            self.assertNotIn(b'fixture-secret-token', body)
            self.assertNotIn(b'private tool metadata', body)
            factory.assert_called_once_with('fixture-secret-token')
            client.initialize.assert_called_once_with()
            client.tools.assert_called_once_with()
            self.assertEqual(self.server.token, 'fixture-secret-token')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_failed_connect_keeps_previous_token_and_capabilities(self):
        self.server.token = 'old-secret'
        self.server.connected = True
        self.server.store_lookup = True
        self.server.order_sync = True
        with patch.object(local_api, 'Client') as factory:
            factory.return_value.initialize.side_effect = RuntimeError('fixture failure; hidden token')
            with self.assertRaises(HTTPError) as error:
                self.request('/api/connect', 'POST', {'token': 'new-secret'}, self.server.origin)
            self.assertEqual(error.exception.code, 502)
            body = error.exception.read()
            self.assertNotIn(b'new-secret', body)
        self.assertEqual(self.server.token, 'old-secret')
        self.assertTrue(self.server.connected)
        self.assertTrue(self.server.order_sync)

    def test_connect_rejects_invalid_token_without_calling_client(self):
        with patch.object(local_api, 'Client') as factory:
            for token in ['', ' x\n', 'x' * 513]:
                with self.assertRaises(HTTPError) as error:
                    self.request('/api/connect', 'POST', {'token': token}, self.server.origin)
                self.assertEqual(error.exception.code, 502)
            factory.assert_not_called()

    def test_connect_rejects_oversized_body_and_unsafe_tools(self):
        with patch.object(local_api, 'Client') as factory:
            body = json.dumps({'token': 'x' * 4090}).encode('utf-8')
            request = Request(self.server.origin + '/api/connect', data=body,
                              headers={'Origin': self.server.origin, 'Content-Type': 'application/json'}, method='POST')
            with self.assertRaises(HTTPError) as error:
                self.opener.open(request, timeout=5)
            self.assertEqual(error.exception.code, 502)
            factory.assert_not_called()
            factory.return_value.tools.return_value = [{'name': 'create-order'}]
            with self.assertRaises(HTTPError) as error:
                self.request('/api/connect', 'POST', {'token': 'replacement'}, self.server.origin)
            self.assertEqual(error.exception.code, 502)
            self.assertEqual(self.server.token, '')

    def test_origin_checks_gate_connect_disconnect_and_synced_orders(self):
        with self.assertRaises(HTTPError) as error:
            self.request('/api/connect', 'POST', {'token': 'secret'}, 'https://attacker.example')
        self.assertEqual(error.exception.code, 403)
        error.exception.read()
        with self.assertRaises(HTTPError) as error:
            self.request('/api/disconnect', 'POST', {}, 'https://attacker.example')
        self.assertEqual(error.exception.code, 403)
        error.exception.read()
        with self.assertRaises(HTTPError) as error:
            self.request('/api/sync-orders', 'POST', {}, 'https://attacker.example')
        self.assertEqual(error.exception.code, 403)
        error.exception.read()
        self.server.token = 'keep-token'
        with tempfile.TemporaryDirectory() as directory, patch.object(local_api, 'ROOT', Path(directory)):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/synced-orders', origin='https://attacker.example')
            self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.server.token, 'keep-token')

    def test_disconnect_clears_in_memory_connection_state(self):
        self.server.token = 'temporary-secret'
        self.server.connected = True
        self.server.store_lookup = True
        self.server.order_sync = True
        response = self.request('/api/disconnect', 'POST', {}, self.server.origin)
        self.assertEqual(json.load(response), {'connected': False})
        self.assertEqual(self.server.token, '')
        health = json.load(self.request('/api/health'))
        self.assertEqual(health['capabilities'], {'connect': True, 'synced_orders': True})
        self.assertFalse(health['connected'])
        self.assertFalse(health['token_present'])
        self.assertFalse(health['order_sync'])

    def test_sync_orders_requires_validated_connection(self):
        with patch.object(local_api, 'sync_orders') as sync:
            with self.assertRaises(HTTPError) as error:
                self.request('/api/sync-orders', 'POST', {}, self.server.origin)
            self.assertEqual(error.exception.code, 503)
            self.assertIn('请先连接', error.exception.read().decode('utf-8'))
            sync.assert_not_called()

    def test_sync_orders_returns_only_projected_archive_and_never_the_token(self):
        self.server.token = 'memory-only-token'
        self.server.connected = True
        self.server.order_sync = True
        archive = {'version': 1, 'data_kind': 'mcp', 'entries': [{
            'id': 'fixture-entry', 'date': '2026-10-09', 'country_code': 'CN',
            'province_code': '310000', 'city': '上海', 'store': '合成门店', 'foods': [],
            'note': '订单线索', 'source': 'mcp_candidate', 'confirmed': False,
            'token': 'private-token', 'orderId': 'private-order'
        }]}
        with patch.object(local_api, 'sync_orders', return_value=archive) as sync:
            response = self.request('/api/sync-orders', 'POST', {}, self.server.origin)
            body = response.read()
        sync.assert_called_once_with('memory-only-token')
        self.assertEqual(response.status, 200)
        projected = json.loads(body)
        self.assertEqual(set(projected), {'archive'})
        self.assertEqual(projected['archive']['entries'][0]['store'], '合成门店')
        self.assertNotIn(b'memory-only-token', body)
        self.assertNotIn(b'private-token', body)
        self.assertNotIn(b'private-order', body)

    def test_sync_orders_failure_returns_fixed_message(self):
        self.server.token = 'memory-only-token'
        self.server.connected = True
        with patch.object(local_api, 'sync_orders', side_effect=RuntimeError('secret diagnostic')) as sync:
            with self.assertRaises(HTTPError) as error:
                self.request('/api/sync-orders', 'POST', {}, self.server.origin)
            self.assertEqual(error.exception.code, 502)
            body = error.exception.read()
            self.assertIn('之前已保存', body.decode('utf-8'))
            self.assertNotIn(b'secret diagnostic', body)
            sync.assert_called_once_with('memory-only-token')

    def test_sync_orders_accepts_only_empty_json_under_the_four_kib_limit(self):
        self.server.token = 'memory-only-token'
        self.server.connected = True
        with patch.object(local_api, 'sync_orders') as sync:
            request = Request(self.server.origin + '/api/sync-orders', data=b'{"ignored":"' + b'x' * 4100 + b'"}',
                              headers={'Origin': self.server.origin, 'Content-Type': 'application/json'}, method='POST')
            with self.assertRaises(HTTPError) as error:
                self.opener.open(request, timeout=5)
            self.assertEqual(error.exception.code, 502)
            error.exception.read()
            with self.assertRaises(HTTPError) as error:
                self.request('/api/sync-orders', 'POST', {'path': 'other-file'}, self.server.origin)
            self.assertEqual(error.exception.code, 502)
            error.exception.read()
            sync.assert_not_called()

    def test_synced_orders_reads_only_fixed_private_candidate_and_projects_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'private' / 'mcp' / 'global-candidates.json'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps({
                'version': 1, 'data_kind': 'mcp',
                'entries': [{
                    'id': 'fixture-entry', 'date': '2026-10-09', 'country_code': 'CN',
                    'city': '', 'store': '合成门店', 'foods': [], 'note': '订单候选',
                    'source': 'mcp_candidate', 'confirmed': False,
                    'token': 'fixture-token', 'orderId': 'fixture-order', 'payment_url': 'https://private.example'
                }],
                'unknown_secret': 'must not escape'
            }, ensure_ascii=False), encoding='utf-8')
            with patch.object(local_api, 'ROOT', root), patch.object(local_api, 'enrich_archive', side_effect=lambda archive, **kwargs: archive) as enrich:
                try:
                    response = self.request('/api/synced-orders?path=../other-private-file')  # No Origin is allowed; query paths are ignored.
                except HTTPError as error:
                    self.fail(f'synced-orders returned {error.code}: {error.read()!r}')
                body = response.read()
                enrich.assert_called_once()
                # Default enrichment loads the user's local directory too.
                self.assertEqual(enrich.call_args.kwargs, {})
                if response.status != 200:
                    self.fail(f'synced-orders returned {response.status}: {body!r}')
        archive = json.loads(body)
        self.assertEqual(archive['entries'][0]['store'], '合成门店')
        self.assertFalse(archive['entries'][0]['confirmed'])
        self.assertNotIn(b'fixture-token', body)
        self.assertNotIn(b'fixture-order', body)
        self.assertNotIn(b'unknown_secret', body)

    def test_synced_orders_missing_file_returns_chinese_404(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(local_api, 'ROOT', Path(directory)):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/synced-orders')
            self.assertEqual(error.exception.code, 404)
            self.assertIn('未找到已同步的订单记录', error.exception.read().decode('utf-8'))

    def test_photo_data_route_uses_reviewed_loader_and_same_origin(self):
        with patch.object(local_api,'load_photo_data',return_value='data:image/png;base64,ZmFrZQ==') as loader:
            response=self.request('/api/photo-data','POST',{'url':'https://example.com/reviewed.jpg'},self.server.origin)
            self.assertEqual(json.load(response),{'data_url':'data:image/png;base64,ZmFrZQ=='})
            loader.assert_called_once_with('https://example.com/reviewed.jpg')
            with self.assertRaises(HTTPError) as error:
                self.request('/api/photo-data','POST',{'url':'https://example.com/reviewed.jpg'},'https://other.example')
            self.assertEqual(error.exception.code,403)
            self.assertEqual(loader.call_count,1)


if __name__ == '__main__':
    unittest.main()
