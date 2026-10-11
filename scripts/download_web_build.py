#!/usr/bin/env python3
"""Install the public connected-site artifact built by GitHub Actions."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile
import tempfile
from urllib.request import Request, urlopen

from build_web_app import load_prebuilt

BASE = 'https://github.com/Jay1023CN/mcd-china-map/releases/download/web-runtime-builds/'
CONNECTED = {'local_api': True, 'web_sessions': True}
MAX_BYTES = 250 * 1024 * 1024


def extract_build(stream, output_dir, commit):
    output_dir = Path(output_dir)
    with tarfile.open(fileobj=stream, mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members) > 300 or sum(member.size for member in members) > MAX_BYTES:
            raise ValueError('build archive exceeds limits')
        seen = set()
        for member in members:
            if member.name in seen or not member.isfile() or not re.fullmatch(
                    r'(?:index\.html|manifest\.json|build-info\.json|assets/[0-9a-f]{64}\.(?:ttf|woff2|png|jpg|webp|svg))', member.name):
                raise ValueError('build archive contains an unapproved file')
            seen.add(member.name)
        archive.extractall(output_dir, members=members, filter='data')
    info = json.loads((output_dir / 'build-info.json').read_text(encoding='utf-8'))
    if info.get('commit') != commit:
        raise ValueError('build artifact belongs to another commit')
    return load_prebuilt(output_dir, runtime=CONNECTED)


def download(commit, output_dir):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('a complete Git commit is required')
    name = f'connected-web-{commit}.tar.gz'
    def request(suffix):
        return urlopen(Request(BASE + name + suffix, headers={'User-Agent': 'mcd-china-map-build'}), timeout=90)
    with request('.sha256') as response:
        expected = response.read(513).decode('ascii').split()[0]
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('invalid build checksum')
    with tempfile.TemporaryFile() as stream:
        size, digest = 0, hashlib.sha256()
        with request('') as response:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError('build download exceeds limits')
                digest.update(chunk)
                stream.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('build download failed integrity check')
        stream.seek(0)
        return extract_build(stream, output_dir, commit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('dist/web-connected'))
    args = parser.parse_args()
    download(args.commit, args.output_dir)
    print('Installed verified GitHub Actions build for ' + args.commit)
