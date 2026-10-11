"""Small offline fixtures for serving cloud-built pages without rendering."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_web_app import load_prebuilt
from download_web_build import extract_build
from project_version import VERSION
from web_api import create_app

RUNTIME = {'local_api': True, 'web_sessions': True}
COMMIT = 'a' * 40


class PrebuiltWebTests(unittest.TestCase):
    def fixture(self, directory):
        html = b'<html>public prebuilt fixture</html>'
        (directory / 'index.html').write_bytes(html)
        manifest = {'schema_version': 1, 'app_version': VERSION, 'runtime': RUNTIME,
                    'archive': {'version': 1, 'data_kind': 'manual', 'entry_count': 0},
                    'entrypoint': 'index.html', 'files': [{'path': 'index.html',
                    'size_bytes': len(html), 'sha256': hashlib.sha256(html).hexdigest()}]}
        (directory / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        (directory / 'build-info.json').write_text(json.dumps({'commit': COMMIT}), encoding='utf-8')
        return manifest

    def test_server_uses_prebuilt_files_without_rendering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            with patch('web_api.build', side_effect=AssertionError('must not render at startup')):
                app = create_app('https://map.example', site_dir=root, state_dir=root / 'state', prebuilt=True)
            client = app.test_client()
            with client.get('/', base_url='https://map.example') as response:
                self.assertEqual(response.status_code, 200)
            self.assertTrue(client.get('/api/health', base_url='https://map.example').json['capabilities']['connect'])
            self.assertEqual(client.get('/assets/private.txt', base_url='https://map.example').status_code, 404)

    def test_runtime_mismatch_corruption_and_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.fixture(root)
            with self.assertRaises(ValueError):
                load_prebuilt(root, runtime={'local_api': False})
            (root / 'index.html').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                load_prebuilt(root, runtime=RUNTIME)
            manifest['files'][0]['path'] = '../private.txt'
            (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaises(ValueError):
                load_prebuilt(root, runtime=RUNTIME)

    def test_archive_must_match_the_server_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                for name in ['index.html', 'manifest.json', 'build-info.json']:
                    archive.add(root / name, arcname=name)
            stream.seek(0)
            self.assertEqual(extract_build(stream, root / 'correct', COMMIT)['runtime'], RUNTIME)
            stream.seek(0)
            with self.assertRaises(ValueError):
                extract_build(stream, root / 'wrong', 'b' * 40)

    def test_archive_links_and_parent_paths_are_rejected_before_extraction(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('index.html', tarfile.SYMTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                stream = io.BytesIO()
                with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    item.linkname = '../escape' if kind == tarfile.SYMTYPE else ''
                    archive.addfile(item)
                stream.seek(0)
                with self.assertRaises(ValueError):
                    extract_build(stream, Path(temporary) / 'site', COMMIT)
                self.assertFalse((Path(temporary) / 'site').exists())


if __name__ == '__main__':
    unittest.main()
