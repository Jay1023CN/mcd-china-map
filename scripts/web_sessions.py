"""Encrypted, expiring browser sessions; cookie values never contain credentials."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time

from cryptography.fernet import Fernet, InvalidToken

REMEMBER_SECONDS = 30 * 24 * 3600
SESSION_SECONDS = 24 * 3600


class SessionStore:
    def __init__(self, directory, key=None):
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
        return sid, payload

    def revoke(self, sid):
        with self.database() as db:
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
