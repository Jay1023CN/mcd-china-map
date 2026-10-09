#!/usr/bin/env python3
"""Optional loopback server with official read-only nearby restaurant lookup."""
import argparse
import getpass
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import mimetypes
import os
import stat
import socket
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.error import HTTPError, URLError
import webbrowser
from mcp_readonly import Client
from build_global_journal import render

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'http://127.0.0.1:8765'


class LocalServer(HTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address


def query_stores(client, city, keyword, be_type):
    if not isinstance(city, str) or not city.strip() or len(city) > 120:
        raise ValueError('invalid city')
    if not isinstance(keyword, str) or not keyword.strip() or len(keyword) > 200:
        raise ValueError('invalid keyword')
    if type(be_type) is not int or be_type not in (1, 5):
        raise ValueError('invalid pickup mode')
    client.initialize()
    tools = {tool['name']: tool for tool in client.tools()}
    schema = tools.get('query-nearby-stores', {}).get('inputSchema')
    arguments = {'searchType': 2, 'city': city.strip(), 'keyword': keyword.strip(), 'beType': be_type}
    if not isinstance(schema, dict) or not set(schema.get('required', [])).issubset(arguments):
        raise ValueError('current store schema is unsupported')
    result = client.rpc('tools/call', {'name': 'query-nearby-stores', 'arguments': arguments})
    if not isinstance(result, dict):
        raise ValueError('invalid official response')
    content = result.get('structuredContent', {})
    if result.get('isError') or not isinstance(content, dict) or content.get('success') is not True or not isinstance(content.get('data'), list):
        raise ValueError('official store query failed')
    stores = []
    for row in content['data']:
        if not isinstance(row, dict) or not isinstance(row.get('storeName'), str) or not isinstance(row.get('storeCode'), str):
            raise ValueError('official store fields changed')
        stores.append({'name': row['storeName'], 'code': row['storeCode'], 'address': row.get('address') or '',
                       'city': city.strip(), 'business_status': row.get('businessStatus'),
                       'hours': '–'.join(str(row.get(k) or '') for k in ['businessStartTime', 'businessEndTime']).strip('–'),
                       'distance': row.get('distance')})
    return {'stores': stores, 'coverage': '官方本次城市与关键词附近查询结果，不代表全国全部门店。'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # No request data, addresses, credentials or private contents in logs.

    def reply(self, status, body, content_type='application/json; charset=utf-8'):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def valid_host(self):
        if self.headers.get_all('Host') != [f'127.0.0.1:{self.server.server_port}']:
            self.reply(400, {'error': '请使用固定的本机地址。'})
            return False
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.valid_host():
            return
        path = unquote(urlsplit(self.path).path)
        if path == '/api/health':
            self.reply(200, {'project': 'mcd-china-map', 'store_lookup': bool(self.server.token)})
            return
        if path == '/':
            path = '/index.html'
        if path == '/index.html' and getattr(self.server, 'homepage', None) is not None:
            self.reply(200, self.server.homepage, 'text/html; charset=utf-8')
            return
        allowed = path in ['/index.html', '/docs/china-demo.html'] or path.startswith(('/assets/', '/web/'))
        segments = path.split('/')[1:]
        if not allowed or '\\' in path or ':' in path or any(ord(c) < 32 for c in path) or any(p.startswith('.') for p in segments):
            self.reply(404, {'error': 'Not found'})
            return
        target = ROOT.joinpath(*segments)
        try:
            if not target.resolve().is_relative_to(ROOT) or any(p.is_symlink() or (getattr(p.lstat(), 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)) for p in [target, *target.parents] if p != ROOT and p.is_relative_to(ROOT)):
                raise OSError()
            body = target.read_bytes()
        except OSError:
            self.reply(404, {'error': 'Not found'})
            return
        content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.reply(200, body, content_type + ('; charset=utf-8' if content_type.startswith('text/') else ''))

    def do_POST(self):
        if not self.valid_host():
            return
        if self.path != '/api/stores':
            self.reply(405, {'error': 'Only the read-only store query endpoint is available.'})
            return
        if self.headers.get('Origin') != self.server.origin or self.headers.get('Content-Type') != 'application/json':
            self.reply(403, {'error': '请从本机地图页面查询门店。'})
            return
        if not self.server.token:
            self.reply(503, {'error': '请使用“启动门店查询.cmd”并在终端隐藏输入 Token。'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048 or self.headers.get('Transfer-Encoding'):
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('query payload must be an object')
            result = query_stores(Client(self.server.token), payload.get('city'), payload.get('keyword'), payload.get('be_type'))
            self.reply(200, result)
        except HTTPError as error:
            self.reply(502, {'error': f'官方门店查询 HTTP {error.code}，请检查 Token 或稍后重试。'})
        except (ValueError, KeyError, TypeError, OSError, URLError):
            self.reply(502, {'error': '门店查询失败，请检查输入、网络和当前官方接口；未生成虚构门店。'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt-token', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--archive', type=Path, help='open an explicit local journal or synced order archive as the homepage')
    parser.add_argument('--port', type=int, default=8765, help='optional isolated test port')
    args = parser.parse_args()
    homepage = None
    if args.archive:
        try:
            homepage = render(json.loads(args.archive.read_text(encoding='utf-8'))).encode('utf-8')
        except (OSError, ValueError, TypeError, KeyError):
            parser.exit(2, 'Cannot read the local journal archive. Public files were not changed.\n')
    token = os.environ.get('MCD_MCP_TOKEN', '').strip()
    if not token and args.prompt_token:
        token = getpass.getpass('MCP Token（不回显、不保存）：').strip()
    try:
        server = LocalServer(('127.0.0.1', args.port), Handler)
    except OSError:
        parser.exit(2, 'Local port is occupied. Close the earlier map launcher first.\n')
    server.token = token
    server.homepage = homepage
    server.origin = f'http://127.0.0.1:{server.server_port}'
    print('麦麦中国地图：' + server.origin, flush=True)
    print('保持本窗口打开。Token 仅用于只读门店查询，关闭进程即清除。', flush=True)
    if not args.no_browser:
        webbrowser.open(server.origin)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
