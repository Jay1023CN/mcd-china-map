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
from local_api import query_stores
from local_api import LocalServer, Handler
import threading
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError


class ProjectTests(unittest.TestCase):
    def test_local_api_checks_origin_host_and_json_before_official_call(self):
        server=LocalServer(('127.0.0.1',0),Handler)
        server.token='fixture-only';server.origin=f'http://127.0.0.1:{server.server_port}'
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        opener=build_opener(ProxyHandler({}))
        try:
            self.assertTrue(json.load(opener.open(server.origin+'/api/health',timeout=5))['store_lookup'])
            server.homepage=b'<html>fixture personal journal</html>'
            self.assertEqual(opener.open(server.origin+'/',timeout=5).read(),server.homepage)
            self.assertEqual(opener.open(Request(server.origin+'/',method='HEAD'),timeout=5).read(),b'')
            for path in ['/private/mcp/global-candidates.json','/assets/%2e%2e/README.md','/assets/%00']:
                with self.assertRaises(HTTPError) as error:opener.open(server.origin+path,timeout=5)
                self.assertEqual(error.exception.code,404)
            with patch('local_api.Client') as factory:
                request=Request(server.origin+'/api/stores',data=b'{}',headers={'Origin':'https://example.com','Content-Type':'application/json'})
                with self.assertRaises(HTTPError) as error:opener.open(request,timeout=5)
                self.assertEqual(error.exception.code,403);factory.assert_not_called()
                request=Request(server.origin+'/api/stores',data=b'[]',headers={'Origin':server.origin,'Content-Type':'application/json'})
                with self.assertRaises(HTTPError) as error:opener.open(request,timeout=5)
                self.assertEqual(error.exception.code,502);factory.assert_not_called()
            with self.assertRaises(HTTPError) as error:opener.open(Request(server.origin+'/',headers={'Host':'localhost:'+str(server.server_port)}),timeout=5)
            self.assertEqual(error.exception.code,400)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=5)

    def test_nearby_lookup_uses_official_schema_and_strips_private_fields(self):
        from unittest.mock import Mock
        client = Mock()
        client.tools.return_value = [{'name':'query-nearby-stores','inputSchema':{'required':['searchType','beType']}}]
        client.rpc.return_value = {'structuredContent':{'success':True,'data':[{'storeName':'虚构门店','storeCode':'fixture-store','address':'虚构街道','businessStatus':False,'businessStartTime':'07:00','businessEndTime':'23:00','token':'fixture-secret','customer':'private'}]}}
        result=query_stores(client,'上海','测试地标',1)
        client.rpc.assert_called_once_with('tools/call',{'name':'query-nearby-stores','arguments':{'searchType':2,'city':'上海','keyword':'测试地标','beType':1}})
        self.assertFalse(result['stores'][0]['business_status'])
        self.assertNotIn('fixture-secret',json.dumps(result))
        self.assertRaises(ValueError,query_stores,client,'上海','',1)
        client.rpc.return_value={'isError':True}
        self.assertRaises(ValueError,query_stores,client,'上海','测试地标',1)

    def test_build_is_identical_across_python_hash_seeds(self):
        code = "import hashlib,json,sys;sys.path.insert(0,'scripts');from build_global_journal import render;from pathlib import Path;print(hashlib.sha256(render(json.loads(Path('examples/china-journal.synthetic.json').read_text(encoding='utf-8'))).encode()).hexdigest())"
        digests = [subprocess.check_output([sys.executable, '-c', code], cwd=ROOT, env={**os.environ, 'PYTHONHASHSEED': seed}) for seed in ['1', '2']]
        self.assertEqual(digests[0], digests[1])

    def test_windows_build_always_reads_utf8(self):
        original = Path.read_text
        def guarded(path, *args, **kwargs):
            self.assertEqual(kwargs.get('encoding'), 'utf-8', str(path))
            return original(path, *args, **kwargs)
        with patch.object(Path, 'read_text', guarded):
            html = render({'version': 1, 'data_kind': 'manual', 'entries': []})
        self.assertIn('麦麦中国地图', html)
        self.assertIn('"entries":[]', html)

    def test_inline_archive_cannot_close_script_element(self):
        marker = '</script><script>alert("fixture")</script>'
        html = render({'version': 1, 'entries': [{'id': 'fixture', 'note': marker, 'token': 'fixture-secret'}]})
        self.assertNotIn(marker, html)
        self.assertNotIn('fixture-secret', html)
        self.assertIn('\\u003c/script\\u003e', html)

    def test_project_archive_preserves_wishlist_whitelist_and_legacy_shape(self):
        legacy = {'version': 1, 'data_kind': 'manual', 'entries': []}
        self.assertEqual(project_archive(legacy), legacy)
        archive = {**legacy, 'wishlist': [{
            'id': 'store-mcp_nearby-code', 'source': 'mcp_nearby', 'code': 'code',
            'name': '收藏门店', 'city': '上海', 'address': '某路', 'note': '下次来试试',
            'province_code': '310000', 'token': 'private-token', 'orderId': 'private-order',
            'payment_url': 'https://private.test', 'business_status': True
        }]}
        projected = project_archive(archive)
        self.assertEqual(projected['wishlist'], [{
            'id': 'store-mcp_nearby-code', 'source': 'mcp_nearby', 'code': 'code',
            'name': '收藏门店', 'city': '上海', 'address': '某路', 'note': '下次来试试',
            'province_code': '310000'
        }])
        self.assertNotIn('wishlist', project_archive(legacy))
        self.assertRaises(ValueError, project_archive, {**legacy, 'wishlist': [{}] * 101})
        self.assertRaises(ValueError, project_archive, {**legacy, 'wishlist': {}})

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
