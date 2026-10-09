"""Focused tests for embedding only verified public store photos."""

import base64
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import store_photo_data


PHOTO_URL = 'https://photos.example.test/known.jpg'
SOURCE_URL = 'https://news.example.test/known-store'
JPEG = b'\xff\xd8\xff' + b'jpeg-content'


def directory_for(photo):
    return [{'name': '公开示例店', 'default_photo': photo}]


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        return self.content[:limit]


class StorePhotoDataTests(unittest.TestCase):
    def test_known_url_sends_source_referer_and_returns_jpeg_data_url(self):
        photo = {'url': PHOTO_URL, 'source_url': SOURCE_URL}
        with patch.object(store_photo_data.store_enrichment, '_default_store_directory',
                          return_value=directory_for(photo)), \
                patch.object(store_photo_data, 'urlopen', return_value=FakeResponse(JPEG)) as open_url:
            result = store_photo_data.load_photo_data(PHOTO_URL)

        self.assertEqual(result, 'data:image/jpeg;base64,' + base64.b64encode(JPEG).decode('ascii'))
        request = open_url.call_args.args[0]
        self.assertEqual(request.get_header('Referer'), SOURCE_URL)
        self.assertEqual(request.get_header('User-agent'), store_photo_data.USER_AGENT)
        self.assertEqual(open_url.call_args.kwargs['timeout'], 10)

    def test_unlisted_url_is_rejected_without_network_access(self):
        with patch.object(store_photo_data, 'urlopen') as open_url:
            with self.assertRaisesRegex(ValueError, '^照片不可用$'):
                store_photo_data.load_photo_data('https://unknown.example/photo.jpg', directory=[])
        open_url.assert_not_called()

    def test_oversized_and_non_image_responses_are_rejected(self):
        photo = {'url': PHOTO_URL, 'source_url': SOURCE_URL}
        invalid_responses = [JPEG + b'x' * store_photo_data.MAX_PHOTO_BYTES,
                             b'<!doctype html><title>not an image</title>']
        for content in invalid_responses:
            with self.subTest(content_length=len(content)), \
                    patch.object(store_photo_data, 'urlopen', return_value=FakeResponse(content)):
                with self.assertRaisesRegex(ValueError, '^照片不可用$'):
                    store_photo_data.load_photo_data(PHOTO_URL, directory=directory_for(photo))

    def test_local_asset_is_embedded_and_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            local_dir = root / 'assets' / 'store-photos'
            local_dir.mkdir(parents=True)
            (local_dir / 'known.jpg').write_bytes(JPEG)
            photo = {'url': PHOTO_URL, 'local_asset': 'store-photos/known.jpg'}
            with patch.object(store_photo_data, 'ROOT', root):
                result = store_photo_data.load_photo_data(PHOTO_URL, directory=directory_for(photo))
                self.assertEqual(result, 'data:image/jpeg;base64,' + base64.b64encode(JPEG).decode('ascii'))

                photo['local_asset'] = 'store-photos/../../private/secret.jpg'
                with patch.object(store_photo_data, 'urlopen') as open_url:
                    with self.assertRaisesRegex(ValueError, '^照片不可用$'):
                        store_photo_data.load_photo_data(PHOTO_URL, directory=directory_for(photo))
                open_url.assert_not_called()


if __name__ == '__main__':
    unittest.main()
