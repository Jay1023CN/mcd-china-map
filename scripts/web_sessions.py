"""Encrypted, expiring browser sessions; cookie values never contain credentials."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
import unicodedata

from cryptography.fernet import Fernet, InvalidToken

REMEMBER_SECONDS = 30 * 24 * 3600
SESSION_SECONDS = 24 * 3600


class SessionStore:
    def __init__(self, directory, key=None):
        self.can_resume = key is not None
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        key_path = directory / 'session.key'
        if key is None:
            try:
                with key_path.open('xb') as stream:
                    os.chmod(key_path, 0o600)
                    stream.write(Fernet.generate_key())
            except FileExistsError:
                pass
            key = key_path.read_bytes()
        self.key = key.encode('ascii') if isinstance(key, str) else key
        self.cipher = Fernet(self.key)
        self.path = directory / 'sessions.sqlite3'
        with self.database() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions '
                       '(id TEXT PRIMARY KEY, expires REAL NOT NULL, payload BLOB NOT NULL)')
            db.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
            db.execute('CREATE TABLE IF NOT EXISTS revoked_sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL)')
            db.execute('DELETE FROM revoked_sessions WHERE expires <= ?', (time.time(),))
        os.chmod(self.path, 0o600)

    def database(self):
        # Each request uses its own connection; no shared mutable MCP client.
        from contextlib import contextmanager

        @contextmanager
        def connection():
            db = sqlite3.connect(self.path, timeout=10)
            try:
                with db:
                    yield db
            finally:
                db.close()
        return connection()

    @staticmethod
    def digest(sid):
        if not isinstance(sid, str) or len(sid) != 43:
            return ''
        return hashlib.sha256(sid.encode('utf-8')).hexdigest()

    def encode(self, payload):
        return self.cipher.encrypt(json.dumps(payload, ensure_ascii=False).encode('utf-8'))

    def get(self, sid):
        digest = self.digest(sid)
        if not digest:
            return None
        with self.database() as db:
            row = db.execute('SELECT expires, payload FROM sessions WHERE id = ?', (digest,)).fetchone()
            if row is None:
                return None
            if row[0] <= time.time():
                db.execute('INSERT OR REPLACE INTO revoked_sessions VALUES (?, ?)',
                           (digest, time.time() + REMEMBER_SECONDS))
                db.execute('DELETE FROM sessions WHERE id = ?', (digest,))
                return None
        try:
            return json.loads(self.cipher.decrypt(row[1]))
        except (InvalidToken, ValueError):
            return None

    def create(self, token, capabilities, remember=True, previous=None):
        sid = secrets.token_urlsafe(32)
        account = hmac.new(self.key, token.encode('utf-8'), hashlib.sha256).hexdigest()[:32]
        payload = {'token': token, 'account_id': account, 'remembered': remember, **capabilities}
        old = self.get(previous)
        if old and old['account_id'] == account and 'archive' in old:
            payload['archive'] = old['archive']
        lifetime = REMEMBER_SECONDS if remember else SESSION_SECONDS
        with self.database() as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                       (self.digest(sid), time.time() + lifetime, self.encode(payload)))
            db.execute('DELETE FROM sessions WHERE id = ?', (self.digest(previous),))
            if self.digest(previous):
                db.execute('INSERT OR REPLACE INTO revoked_sessions VALUES (?, ?)',
                           (self.digest(previous), time.time() + REMEMBER_SECONDS))
        return sid, payload

    def seal_resume(self, sid, scope):
        """Small authenticated recovery cookie; never includes the order archive."""
        if not self.can_resume:
            return None
        payload = self.get(sid)
        if not payload or not payload.get('remembered'):
            return None
        with self.database() as db:
            row = db.execute('SELECT expires FROM sessions WHERE id = ?', (self.digest(sid),)).fetchone()
        if not row:
            return None
        envelope = {'version': 1, 'sid': sid, 'scope': scope, 'expires': row[0],
                    'token': payload['token'], 'account_id': payload['account_id'],
                    'store_lookup': bool(payload['store_lookup']), 'order_sync': bool(payload['order_sync'])}
        return self.cipher.encrypt(json.dumps(envelope, ensure_ascii=False, separators=(',', ':')).encode()).decode('ascii')

    def restore(self, sid, sealed, scope):
        if not self.can_resume or not self.digest(sid) or not isinstance(sealed, str) or len(sealed) > 3800:
            return None
        try:
            value = json.loads(self.cipher.decrypt(sealed.encode('ascii'), ttl=REMEMBER_SECONDS))
            token = value.get('token')
            expires = value.get('expires')
            if (value.get('version') != 1 or value.get('sid') != sid or value.get('scope') != scope
                    or not isinstance(token, str) or not token.strip() or len(token) > 512
                    or any(unicodedata.category(c) == 'Cc' for c in token)
                    or type(expires) not in (int, float) or not time.time() < expires <= time.time() + REMEMBER_SECONDS
                    or type(value.get('store_lookup')) is not bool or type(value.get('order_sync')) is not bool):
                return None
            account = hmac.new(self.key, token.encode('utf-8'), hashlib.sha256).hexdigest()[:32]
            if not hmac.compare_digest(account, value.get('account_id', '')):
                return None
            payload = {'token': token, 'account_id': account, 'remembered': True,
                       'store_lookup': value['store_lookup'], 'order_sync': value['order_sync']}
            with self.database() as db:
                # Logout or replacement wins over an old recovery cookie in this server generation.
                if db.execute('SELECT 1 FROM revoked_sessions WHERE id = ? AND expires > ?',
                              (self.digest(sid), time.time())).fetchone():
                    return None
                existing = db.execute('SELECT expires FROM sessions WHERE id = ?', (self.digest(sid),)).fetchone()
                if existing:
                    return self.get(sid) if existing[0] > time.time() else None
                db.execute('INSERT OR IGNORE INTO sessions VALUES (?, ?, ?)', (self.digest(sid), expires, self.encode(payload)))
            return payload
        except (InvalidToken, ValueError, TypeError, AttributeError, UnicodeError):
            return None

    def revoke(self, sid):
        with self.database() as db:
            db.execute('INSERT OR REPLACE INTO revoked_sessions VALUES (?, ?)',
                       (self.digest(sid), time.time() + REMEMBER_SECONDS))
            db.execute('DELETE FROM sessions WHERE id = ?', (self.digest(sid),))

    def save_archive(self, sid, archive):
        # A disconnected/replaced session cannot be resurrected by a slow sync.
        with self.database() as db:
            row = db.execute('SELECT payload FROM sessions WHERE id = ? AND expires > ?',
                             (self.digest(sid), time.time())).fetchone()
            if row is None:
                raise ValueError('session was revoked')
            payload = json.loads(self.cipher.decrypt(row[0]))
            payload['archive'] = archive
            db.execute('UPDATE sessions SET payload = ? WHERE id = ?',
                       (self.encode(payload), self.digest(sid)))
