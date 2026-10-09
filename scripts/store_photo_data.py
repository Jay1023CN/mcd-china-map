"""Load a data URL for a photo in the user's reviewed local store directories."""

import base64
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import store_enrichment


ROOT = Path(__file__).resolve().parents[1]
MAX_PHOTO_BYTES = 1024 * 1024
USER_AGENT = 'McDonaldsStorePhoto/1.0'
PHOTO_ERROR = '照片不可用'


def _directory_records(directory):
    if directory is None:
        return store_enrichment._default_store_directory()
    return store_enrichment._records(directory, store_enrichment.DEFAULT_DIRECTORY)


def _image_mime(data):
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


def _safe_local_path(local_asset):
    if not isinstance(local_asset, str) or not local_asset:
        raise ValueError(PHOTO_ERROR)
    relative = Path(local_asset)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError(PHOTO_ERROR)

    asset_root = (ROOT / 'assets' / 'store-photos').resolve()
    candidate = (ROOT / 'assets' / relative).resolve()
    try:
        candidate.relative_to(asset_root)
    except ValueError as exc:
        raise ValueError(PHOTO_ERROR) from exc
    return candidate


def _read_photo(photo):
    local_asset = photo.get('local_asset')
    if local_asset is not None:
        path = _safe_local_path(local_asset)
        with path.open('rb') as image_file:
            return image_file.read(MAX_PHOTO_BYTES + 1)

    source_url = photo.get('source_url')
    if not isinstance(source_url, str):
        raise ValueError(PHOTO_ERROR)
    parsed_source = urlsplit(source_url)
    if (parsed_source.scheme.lower() != 'https' or not parsed_source.hostname or
            parsed_source.username or parsed_source.password):
        raise ValueError(PHOTO_ERROR)
    request = Request(
        photo['url'],
        headers={'Referer': source_url, 'User-Agent': USER_AGENT},
    )
    with urlopen(request, timeout=10) as response:
        return response.read(MAX_PHOTO_BYTES + 1)


def load_photo_data(url, directory=None):
    """Return a data URL for an exact, HTTPS default photo in a reviewed directory."""
    try:
        if not isinstance(url, str):
            raise ValueError(PHOTO_ERROR)
        parsed = urlsplit(url)
        if parsed.scheme.lower() != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError(PHOTO_ERROR)

        matched_photo = None
        for record in _directory_records(directory):
            if not isinstance(record, dict):
                continue
            photo = record.get('default_photo')
            if isinstance(photo, dict) and photo.get('url') == url:
                matched_photo = photo
                break
        if matched_photo is None:
            raise ValueError(PHOTO_ERROR)

        content = _read_photo(matched_photo)
        if not content or len(content) > MAX_PHOTO_BYTES:
            raise ValueError(PHOTO_ERROR)
        mime = _image_mime(content)
        if mime is None:
            raise ValueError(PHOTO_ERROR)
        encoded = base64.b64encode(content).decode('ascii')
        return f'data:{mime};base64,{encoded}'
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc) == PHOTO_ERROR:
            raise
        raise ValueError(PHOTO_ERROR) from None
