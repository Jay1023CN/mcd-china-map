#!/usr/bin/env python3
"""Serve the existing China journal with independent remembered browser sessions."""
import argparse
import hashlib
import ipaddress
from collections import deque
import json
import math
import os
from pathlib import Path
import tempfile
from threading import Lock, Thread
import time
import unicodedata
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from build_global_journal import project_archive
from build_web_app import build, load_prebuilt
from local_api import query_stores
from mcp_readonly import Client, READ_TOOLS
from project_version import VERSION
from store_photo_data import load_photo_data
from sync_footprints import sync_orders
from web_sessions import SessionStore, REMEMBER_SECONDS

ROOT = Path(__file__).resolve().parents[1]


def create_app(origin, *, state_dir=None, site_dir=None, prebuilt=False):
    parsed = urlsplit(origin)
    if (parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment or parsed.username or parsed.password
            or (parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'))):
        raise ValueError('origin must be an HTTPS site or loopback HTTP URL')
    origin = origin.rstrip('/')
    secure = parsed.scheme == 'https'
    cookie_name = '__Host-mcd_session' if secure else 'mcd_session'
    resume_cookie = '__Host-mcd_resume' if secure else 'mcd_resume'
    state_dir = Path(state_dir or ROOT / 'private' / 'web')
    site_dir = Path(site_dir or ROOT / 'dist' / 'web-connected')
    runtime = {'local_api': True, 'web_sessions': True}
    manifest = load_prebuilt(site_dir, runtime=runtime) if prebuilt else build(site_dir, runtime=runtime)
    public_assets = {item['path'][len('assets/'):] for item in manifest['files'] if item['path'].startswith('assets/')}
    sessions = SessionStore(state_dir, os.environ.get('MCD_SESSION_KEY'))
    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=4096, JSON_AS_ASCII=False)
    app.extensions['mcd_sessions'] = sessions
    attempts, attempt_lock = {}, Lock()
    geo_cache, geo_calls, geo_lock = {}, deque(), Lock()

    def visitor_location():
        # Render forwards the visitor IP. Local installs use their direct peer.
        peer = request.remote_addr or ''
        if os.environ.get('RENDER') == 'true':
            peer = request.headers.get('X-Forwarded-For', peer).split(',')[0].strip()
        try:
            address = ipaddress.ip_address(peer)
            if not address.is_global:
                return {'available': False}
        except ValueError:
            return {'available': False}
        key = hashlib.sha256(str(address).encode()).hexdigest()
        now = time.monotonic()
        with geo_lock:
            for stale in [k for k, (expiry, _) in geo_cache.items() if expiry <= now]:
                del geo_cache[stale]
            if key in geo_cache:
                return geo_cache[key][1]
            while geo_calls and geo_calls[0] <= now - 86400:
                geo_calls.popleft()
            if len(geo_calls) >= 950 or len(geo_cache) >= 2048:
                return {'available': False}
            geo_calls.append(now)
            geo_cache[key] = (now + 60, {'available': False})
        result = {'available': False}
        try:
            url = f'https://ipwho.is/{address}?fields=success,country_code,city,latitude,longitude'
            with urlopen(Request(url, headers={'User-Agent': 'mcd-china-map'}), timeout=3) as response:
                value = json.loads(response.read(16384))
            lat, lon = value.get('latitude'), value.get('longitude')
            if (value.get('success') is True and value.get('country_code') in ('CN', 'HK', 'MO', 'TW')
                    and type(lat) in (int, float) and type(lon) in (int, float)
                    and math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                result = {'available': True, 'city': str(value.get('city') or '')[:100],
                          'lat': lat, 'lon': lon, 'precision': 'ip-city'}
        except Exception:
            pass
        with geo_lock:
            geo_cache[key] = (now + (21600 if result['available'] else 300), result)
        return result

    def error(message, status):
        return jsonify(error=message), status

    def status(session):
        return {'connected': bool(session), 'store_lookup': bool(session and session['store_lookup']),
                'order_sync': bool(session and session['order_sync']),
                'account_id': session['account_id'] if session else None,
                'remembered': bool(session and session['remembered']),
                'capabilities': {'connect': True, 'synced_orders': bool(session), 'remember_session': True,
                                 'durable_remember_session': sessions.can_resume}}

    def body():
        if request.mimetype != 'application/json':
            raise ValueError('JSON required')
        value = request.get_json()
        if not isinstance(value, dict):
            raise ValueError('object required')
        return value

    @app.before_request
    def guard():
        if request.host != parsed.netloc:
            return error('请使用地图的网址打开。', 400)
        if request.path.startswith('/api/'):
            source = request.headers.get('Origin')
            if (request.method not in ('GET', 'HEAD') and source != origin) or (source and source != origin):
                return error('请从地图页面操作。', 403)
            if request.headers.get('Sec-Fetch-Site') == 'cross-site':
                return error('请从地图页面操作。', 403)
        g.sid = request.cookies.get(cookie_name, '')
        g.session = sessions.get(g.sid)
        if not g.session and request.cookies.get(resume_cookie):
            g.session = sessions.restore(g.sid, request.cookies[resume_cookie], origin)
        expected = request.headers.get('X-Journal-Account')
        if expected and request.path not in ('/api/health', '/api/connect'):
            if not g.session or g.session['account_id'] != expected:
                return error('连接已在另一个窗口更换，请刷新页面再继续。', 409)

    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'})
        # Credentials are encrypted in an HttpOnly recovery cookie, never in JS storage or HTML.
        if request.cookies.get(cookie_name) and not getattr(g, 'session', None) and 'Set-Cookie' not in response.headers:
            response.delete_cookie(cookie_name, secure=secure, httponly=True, samesite='Strict')
            response.delete_cookie(resume_cookie, secure=secure, httponly=True, samesite='Strict')
        return response

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return error('请求无法处理，请检查输入或刷新页面。', exc.code)

    @app.get('/api/health')
    def health():
        return jsonify(project='mcd-china-map', version=VERSION, **status(g.session))

    @app.get('/api/visitor-location')
    def location():
        return jsonify(visitor_location())

    @app.post('/api/connect')
    def connect():
        # Bound repeated upstream authentication attempts per peer; no persisted IP/device tracking.
        with attempt_lock:
            now = time.monotonic()
            stale = [peer for peer, values in attempts.items() if not values or values[-1] < now - 300]
            for peer in stale:
                del attempts[peer]
            queue = attempts.setdefault(request.remote_addr, deque())
            while queue and queue[0] < now - 300:
                queue.popleft()
            if len(queue) >= 20 or len(attempts) > 10000:
                return error('连接尝试较多，请稍后再试。', 429)
            queue.append(now)
        try:
            value = body()
            token = value.get('token')
            remember = value.get('remember', True)
            if (not isinstance(token, str) or any(unicodedata.category(c) == 'Cc' for c in token)
                    or not token.strip() or len(token) > 512 or type(remember) is not bool):
                return error('请填写有效的 Token。', 400)
            token = token.strip()
            client = Client(token)
            client.initialize()
            tools = client.tools()
            names = {t.get('name') for t in tools if isinstance(t, dict)}
            if not names.intersection(READ_TOOLS):
                raise ValueError('unsupported tools')
            sid, payload = sessions.create(token, {
                'store_lookup': 'query-nearby-stores' in names,
                'order_sync': {'order-list', 'query-order', 'now-time-info'}.issubset(names),
            }, remember, previous=g.sid)
            response = jsonify(status(payload))
            response.set_cookie(cookie_name, sid, max_age=REMEMBER_SECONDS if remember else None,
                                secure=secure, httponly=True, samesite='Strict', path='/')
            recovery = sessions.seal_resume(sid, origin) if remember else None
            if recovery:
                response.set_cookie(resume_cookie, recovery, max_age=REMEMBER_SECONDS,
                                    secure=secure, httponly=True, samesite='Strict', path='/')
            else:
                response.delete_cookie(resume_cookie, secure=secure, httponly=True, samesite='Strict')
            return response
        except HTTPException:
            raise
        except Exception:
            return error('连接未完成，请检查 Token 或稍后再试。原有连接仍保留。', 502)

    @app.post('/api/disconnect')
    def disconnect():
        try:
            if body():
                raise ValueError('empty body required')
            sessions.revoke(g.sid)
            response = jsonify(status(None))
            response.delete_cookie(cookie_name, secure=secure, httponly=True, samesite='Strict')
            response.delete_cookie(resume_cookie, secure=secure, httponly=True, samesite='Strict')
            return response
        except ValueError:
            return error('断开请求格式无效。', 400)

    @app.get('/api/synced-orders')
    def synced_orders():
        if not g.session:
            return error('请先连接麦当劳。', 401)
        if 'archive' not in g.session:
            return error('还没有同步记录，点击“同步我的订单”开始。', 404)
        return jsonify(g.session['archive'])

    @app.post('/api/sync-orders')
    def sync():
        if not g.session:
            return error('请先连接麦当劳。', 401)
        if not g.session['order_sync']:
            return error('当前 Token 尚未开放订单读取。', 403)
        try:
            if body():
                return error('同步请求格式无效。', 400)
            # Every run has an independent temporary directory. Only the projected
            # candidate archive is retained, encrypted alongside this session.
            with tempfile.TemporaryDirectory(prefix='sync-', dir=state_dir) as temporary:
                archive = sync_orders(g.session['token'], output_dir=Path(temporary),
                                      store_directory=ROOT / 'assets/data/store-directory.json', render_page=False)
            archive = project_archive(archive)
            sessions.save_archive(g.sid, archive)
            return jsonify(archive=archive)
        except HTTPException:
            raise
        except Exception:
            return error('订单暂未同步，之前的记录仍保留。请检查连接或稍后再试。', 502)

    @app.post('/api/stores')
    def stores():
        if not g.session:
            return error('请先连接麦当劳，再查找门店。', 401)
        if not g.session['store_lookup']:
            return error('当前 Token 尚未开放门店查询。', 403)
        try:
            value = body()
            return jsonify(query_stores(Client(g.session['token']), value.get('city'),
                                        value.get('keyword'), value.get('be_type')))
        except HTTPException:
            raise
        except Exception:
            return error('门店暂时没查到，请检查连接、城市和地标后重试。', 502)

    @app.post('/api/photo-data')
    def photo():
        try:
            return jsonify(data_url=load_photo_data(body().get('url'), directory=ROOT / 'assets/data/store-directory.json'))
        except HTTPException:
            raise
        except Exception:
            return error('照片暂时没取到，可以先使用自己的照片或旅行插画。', 502)

    @app.get('/')
    def home():
        return send_from_directory(site_dir, 'index.html')

    @app.get('/build-info.json')
    def build_info():
        # The cloud build writes only its public source commit here.
        info = site_dir / 'build-info.json'
        if not info.is_file():
            return error('Not found', 404)
        return send_from_directory(site_dir, 'build-info.json')

    @app.get('/assets/<path:filename>')
    def asset(filename):
        # Only files emitted by the blank public build are reachable.
        if filename not in public_assets:
            return error('Not found', 404)
        return send_from_directory(site_dir / 'assets', filename)

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--origin', help='exact public HTTPS URL, or loopback HTTP URL for local use')
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--site-dir', type=Path)
    parser.add_argument('--prebuilt', action='store_true', help='serve a verified connected build without rendering at startup')
    parser.add_argument('--open-browser', action='store_true', help='open the loopback website after it is ready')
    args = parser.parse_args()
    origin = args.origin or f'http://127.0.0.1:{args.port}'
    app = create_app(origin, state_dir=args.state_dir, site_dir=args.site_dir, prebuilt=args.prebuilt)
    if args.open_browser:
        if urlsplit(origin).hostname not in ('localhost', '127.0.0.1', '::1'):
            parser.error('--open-browser requires a loopback origin')
        def open_ready_page():
            from urllib.request import urlopen, Request
            import webbrowser
            for _ in range(60):
                try:
                    with urlopen(Request(origin + '/api/health', method='HEAD'), timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(origin)
                            return
                except OSError:
                    time.sleep(0.25)
        Thread(target=open_ready_page, daemon=True).start()
    from waitress import serve
    print('麦麦中国地图网页版：' + origin, flush=True)
    serve(app, host=args.host, port=args.port, threads=8, max_request_body_size=4096,
          channel_timeout=30, expose_tracebacks=False)


if __name__ == '__main__':
    main()
