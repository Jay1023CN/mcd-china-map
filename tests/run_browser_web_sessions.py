"""Serve a temporary web app with synthetic upstream responses for browser acceptance."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
from threading import Thread
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from waitress import create_server
from web_api import create_app


class FixtureClient:
    def __init__(self, token):
        if token not in ('fixture-browser-a', 'fixture-browser-b'):
            raise ValueError('synthetic fixture login failed')
        self.token = token

    def initialize(self):
        pass

    def tools(self):
        return [{'name': name, 'inputSchema': {'required': []}} for name in
                ('order-list', 'query-order', 'now-time-info', 'query-nearby-stores')]

    def rpc(self, method, payload):
        return {'structuredContent': {'success': True, 'data': [
            {'storeName': '合成浏览器门店', 'storeCode': 'fixture-store', 'address': '合成地址'}]}}


def fixture_sync(token, **options):
    suffix = 'a' if token == 'fixture-browser-a' else 'b'
    return {'version': 1, 'data_kind': 'mcp', 'entries': [
        {'id': 'candidate-' + suffix, 'date': '2026-10-09', 'country_code': 'CN',
         'city': '上海', 'province_code': '310000', 'store': '合成订单门店' + suffix,
         'foods': ['合成早餐'], 'source': 'mcp_candidate', 'confirmed': False}]}


def main():
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        # Reserve an ephemeral loopback listener, then configure its exact Origin.
        server = create_server(lambda environ, start_response: [], host='127.0.0.1', port=0, threads=4)
        origin = f'http://127.0.0.1:{server.effective_port}'
        server.application = create_app(origin, state_dir=directory / 'state', site_dir=directory / 'site')
        thread = Thread(target=server.run, daemon=True)
        with patch('web_api.Client', FixtureClient), patch('web_api.sync_orders', fixture_sync):
            thread.start()
            try:
                env = {**os.environ, 'TEST_BASE_URL': origin + '/'}
                node = os.environ.get('NODE_BINARY', 'node')
                result = subprocess.run([node, str(ROOT / 'tests/browser-web-sessions.cjs')], cwd=ROOT, env=env)
                if result.returncode:
                    raise SystemExit(result.returncode)
            finally:
                server.close()
                server.task_dispatcher.shutdown()
                thread.join(timeout=5)


if __name__ == '__main__':
    main()
