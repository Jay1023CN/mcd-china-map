"""Embed reviewed local assets so handoff HTML works without network requests."""
import base64
from functools import lru_cache
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=32)
def asset_uri(name: str) -> str:
    path = ROOT / "assets" / name
    types = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2"}
    return f"data:{types[path.suffix]};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


@lru_cache(maxsize=1)
def font_faces() -> str:
    blocks = []
    for source, prefix in [("source.css", "noto-display"), ("dm-mono-source.css", "dm-mono")]:
        css = (ROOT / "assets/fonts" / source).read_text(encoding='utf-8')
        urls = list(dict.fromkeys(re.findall(r"url\((https:[^)]+)\)", css)))
        for index, url in enumerate(urls):
            candidates = list((ROOT / "assets/fonts").glob(f"{prefix}-{index}.*"))
            if len(candidates) != 1:
                raise ValueError("font asset is missing or ambiguous")
            css = css.replace(url, asset_uri("fonts/" + candidates[0].name))
        blocks.append(css)
    return "\n".join(blocks)
