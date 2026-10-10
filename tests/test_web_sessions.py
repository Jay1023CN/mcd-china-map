"""Offline acceptance for persistent per-browser web sessions and order isolation."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from web_api import create_app
from web_sessions import SessionStore

TOOLS = [{'name': name} for name in ['order-list', 'query-order', 'now-time-info', 'query-nearby-stores']]
ORIGIN = 'https://map.example'


class WebSessionsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        # Render is exercised by build tests; API tests need no heavy bundled assets.
        self.builder = patch('web_api.build')
        self.builder.start().return_value = {'files': []}
        self.app = create_app(ORIGIN, state_dir=self.directory / 'state', site_dir=self.directory / 'site')
        self.a = self.app.test_client()
        self.b = self.app.test_client()

    def tearDown(self):
        self.builder.stop()
        self.temporary.cleanup()

    def post(self, client, route, value, **kwargs):
        headers = {'Origin': ORIGIN, **kwargs.pop('headers', {})}
        return client.post(route, json=value, base_url=ORIGIN, headers=headers, **kwargs)

    def health(self, client):
        return client.get('/api/health', base_url=ORIGIN).get_json()

    def login(self, client, token, remember=True):
        with patch('web_api.Client') as factory:
            factory.return_value.tools.return_value = TOOLS
            response = self.post(client, '/api/connect', {'token': token, 'remember': remember})
        self.assertEqual(response.status_code, 200)
        return response

    def test_cookie_encryption_restart_and_browser_isolation(self):
        response = self.login(self.a, 'private-a-secret')
        cookie = response.headers['Set-Cookie']
        for attribute in ['__Host-mcd_session=', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=2592000', 'Path=/']:
            self.assertIn(attribute, cookie)
        self.assertNotIn('private-a-secret', cookie)
        self.assertNotIn('private-a-secret', response.get_data(as_text=True))
        self.assertTrue(self.health(self.a)['connected'])
        self.assertFalse(self.health(self.b)['connected'])
        old_cookie = self.a.get_cookie('__Host-mcd_session', domain='map.example')
        restarted = create_app(ORIGIN, state_dir=self.directory / 'state', site_dir=self.directory / 'site')
        restored = restarted.test_client()
        restored.set_cookie('__Host-mcd_session', old_cookie.value, domain='map.example')
        self.assertEqual(self.health(restored)['account_id'], self.health(self.a)['account_id'])
        for path in (self.directory / 'state').iterdir():
            self.assertNotIn(b'private-a-secret', path.read_bytes())

    def test_rotating_cookie_same_account_and_logout_other_browser_untouched(self):
        first = self.login(self.a, 'secret-a')
        old_cookie = self.a.get_cookie('__Host-mcd_session', domain='map.example').value
        self.login(self.b, 'secret-b')
        replacement = self.login(self.a, 'secret-a', remember=False)
        self.assertEqual(first.json['account_id'], replacement.json['account_id'])
        self.assertNotIn('Max-Age', replacement.headers['Set-Cookie'])
        self.assertIsNone(self.app.extensions['mcd_sessions'].get(old_cookie))
        self.post(self.a, '/api/disconnect', {})
        self.assertFalse(self.health(self.a)['connected'])
        self.assertTrue(self.health(self.b)['connected'])

    def test_order_cache_is_private_projected_encrypted_and_removed_on_logout(self):
        self.login(self.a, 'secret-a')
        self.login(self.b, 'secret-b')
        fixture = {'version': 1, 'data_kind': 'mcp', 'entries': [
            {'id': 'candidate-a', 'country_code': 'CN', 'store': '合成测试门店',
             'source': 'mcp_candidate', 'confirmed': False, 'token': 'raw-token', 'orderId': 'raw-order'}]}
        with patch('web_api.sync_orders', return_value=fixture) as sync:
            response = self.post(self.a, '/api/sync-orders', {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sync.call_args.args[0], 'secret-a')
        self.assertEqual(sync.call_args.kwargs['store_directory'], ROOT / 'assets/data/store-directory.json')
        self.assertFalse(sync.call_args.kwargs['output_dir'].exists())
        self.assertNotIn('raw-token', response.get_data(as_text=True))
        self.assertNotIn('raw-order', response.get_data(as_text=True))
        self.assertEqual(self.a.get('/api/synced-orders', base_url=ORIGIN).status_code, 200)
        self.assertEqual(self.b.get('/api/synced-orders', base_url=ORIGIN).status_code, 404)
        for path in (self.directory / 'state').iterdir():
            self.assertNotIn('合成测试门店'.encode(), path.read_bytes())
        self.post(self.a, '/api/disconnect', {})
        self.assertEqual(self.a.get('/api/synced-orders', base_url=ORIGIN).status_code, 401)

    def test_failed_login_preserves_connection_failed_sync_preserves_cache(self):
        self.login(self.a, 'old-secret')
        before = self.health(self.a)
        with patch('web_api.Client') as factory:
            factory.return_value.initialize.side_effect = RuntimeError('new-secret')
            response = self.post(self.a, '/api/connect', {'token': 'new-secret'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('new-secret', response.get_data(as_text=True))
        self.assertEqual(self.health(self.a), before)
        sid = self.a.get_cookie('__Host-mcd_session', domain='map.example').value
        previous = {'version': 1, 'data_kind': 'manual', 'entries': []}
        self.app.extensions['mcd_sessions'].save_archive(sid, previous)
        with patch('web_api.sync_orders', side_effect=ValueError('secret failure')):
            self.assertEqual(self.post(self.a, '/api/sync-orders', {}).status_code, 502)
        self.assertEqual(self.a.get('/api/synced-orders', base_url=ORIGIN).json, previous)

    def test_invalid_origin_host_account_and_expiry(self):
        self.login(self.a, 'secret-a')
        for route in ['/api/connect', '/api/disconnect', '/api/sync-orders', '/api/stores']:
            response = self.a.post(route, json={}, base_url=ORIGIN, headers={'Origin': 'https://evil.example'})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.a.get('/api/synced-orders', base_url=ORIGIN,
                                  headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.a.get('/api/health', base_url='https://evil.example').status_code, 400)
        self.assertEqual(self.post(self.a, '/api/sync-orders', {},
                                  headers={'X-Journal-Account': 'wrong-account'}).status_code, 409)
        with self.app.extensions['mcd_sessions'].database() as db:
            db.execute('UPDATE sessions SET expires=0')
        self.assertFalse(self.health(self.a)['connected'])
        self.assertEqual(self.post(self.a, '/api/sync-orders', {}).status_code, 401)

    def test_bad_input_and_revoked_sync_cannot_recreate_session(self):
        with patch('web_api.Client') as client:
            for token in ['', 'bad\n', 'x' * 513, None]:
                self.assertEqual(self.post(self.a, '/api/connect', {'token': token}).status_code, 400)
            client.assert_not_called()
        self.login(self.a, 'secret-a')
        sid = self.a.get_cookie('__Host-mcd_session', domain='map.example').value
        sessions = self.app.extensions['mcd_sessions']
        sessions.revoke(sid)
        with self.assertRaises(ValueError):
            sessions.save_archive(sid, {'version': 1, 'entries': []})

    def test_oversized_body_static_whitelist_and_connect_rate_limit(self):
        self.assertEqual(self.a.post('/api/connect', data=b'x' * 4097, content_type='application/json',
                                    base_url=ORIGIN, headers={'Origin': ORIGIN}).status_code, 413)
        self.assertEqual(self.a.get('/private/web/session.key', base_url=ORIGIN).status_code, 404)
        self.assertEqual(self.a.get('/assets/old-private.txt', base_url=ORIGIN).status_code, 404)
        with patch('web_api.Client') as client:
            client.return_value.initialize.side_effect = ValueError('synthetic')
            for _ in range(19):
                self.post(self.a, '/api/connect', {'token': 'rate-fixture'})
            self.assertEqual(self.post(self.a, '/api/connect', {'token': 'rate-fixture'}).status_code, 429)

    def test_public_host_requires_https(self):
        with self.assertRaises(ValueError):
            create_app('http://public.example', state_dir=self.directory / 'rejected')


if __name__ == '__main__':
    unittest.main()
