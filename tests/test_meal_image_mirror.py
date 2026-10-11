"""Small synthetic-only checks; Pillow is needed only by the cloud image mirror job."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

HAS_PILLOW = importlib.util.find_spec('PIL') is not None
if HAS_PILLOW:
    from PIL import Image
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
    import mirror_meal_images as mirror


@unittest.skipUnless(HAS_PILLOW, 'Pillow is installed in the cloud menu-image job')
class MealImageMirrorTests(unittest.TestCase):
    def picture(self):
        result = io.BytesIO()
        Image.new('RGBA', (80, 80), (255, 160, 0, 255)).save(result, format='PNG')
        return result.getvalue()

    def test_chinese_referer_is_encoded_and_downloads_remain_bounded(self):
        response = io.BytesIO(b'fixture')
        response.status = 200
        response.headers = {'Content-Length': '7'}
        opener = Mock()
        opener.open.return_value = response
        with patch.object(mirror, 'build_opener', return_value=opener):
            budget = {'downloaded_bytes': 0}
            self.assertEqual(mirror.download('https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/example.png',
                                             'https://www.mcdonalds.com.cn/product/苹板支撑Pro', budget), b'fixture')
        referer = opener.open.call_args.args[0].get_header('Referer')
        self.assertIn('%E8%8B%B9', referer)
        referer.encode('latin1')
        self.assertEqual(budget['downloaded_bytes'], 7)
        limited = io.BytesIO(b'fixture')
        limited.status = 200
        limited.headers = {'Content-Length': '7'}
        opener.open.return_value = limited
        with patch.object(mirror, 'build_opener', return_value=opener):
            exhausted = {'downloaded_bytes': mirror.MAX_TOTAL_BYTES-3}
            with self.assertRaisesRegex(ValueError, 'budget'):
                mirror.download('https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/example.png',
                                'https://www.mcdonalds.com.cn/product/fixture', exhausted)
            self.assertEqual(exhausted['downloaded_bytes'], mirror.MAX_TOTAL_BYTES)
        for bad in ['http://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/a.png',
                    'https://example.org/public/upload/attachment/a.png',
                    'https://officiaweb-afd.mcdonalds.com.cn/not-public/a.png']:
            self.assertFalse(mirror.approved_url(bad))

    def test_existing_verified_thumbnails_are_reused_without_a_network_request(self):
        catalog = {'items': [{'id': f'burgers-{index}', 'name': name,
                             'source_url': 'https://www.mcdonalds.com.cn/product/fixture',
                             'image_url': f'https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/{index}.png'}
                            for index, name in enumerate(mirror.REQUIRED_NAMES, 1)]}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'photos'
            report = Path(temporary) / 'report.json'
            with patch.object(mirror, 'download', return_value=self.picture()) as download:
                first = mirror.mirror(catalog, output, report)
                self.assertEqual(download.call_count, len(mirror.REQUIRED_NAMES))
            before = {target.name: target.read_bytes() for target in output.iterdir()}
            with patch.object(mirror, 'download', side_effect=AssertionError('cache must not refetch')):
                second = mirror.mirror(catalog, output, report)
            self.assertEqual(first['required_missing'], [])
            self.assertEqual(second['failed'], 0)
            self.assertEqual(before, {target.name: target.read_bytes() for target in output.iterdir()})
            manifest = json.loads((output/'manifest.json').read_text(encoding='utf-8'))
            for record in manifest['images']:
                with Image.open(output/record['file']) as image:
                    self.assertEqual(image.format, 'WEBP')
                    self.assertEqual(image.size, (160, 120))
                    self.assertEqual(image.getpixel((0, 0))[3], 0)
                self.assertLessEqual(record['size_bytes'], 40*1024)

    def test_failed_required_photo_is_reported(self):
        catalog = {'items': [{'id':'burgers-1','name':'巨无霸','source_url':'https://www.mcdonalds.com.cn/product/fixture',
                            'image_url':'https://officiaweb-afd.mcdonalds.com.cn/public/upload/attachment/fixture.png'}]}
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(mirror, 'download', side_effect=ValueError('fixture unavailable')):
                report = mirror.mirror(catalog, Path(temporary)/'photos', Path(temporary)/'report.json')
            self.assertEqual(report['mirrored'], 0)
            self.assertIn('巨无霸', report['required_missing'])
            self.assertEqual(report['images'][0]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
