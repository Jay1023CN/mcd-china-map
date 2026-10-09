#!/usr/bin/env python3
"""Create the reviewed Windows local package; never traverse personal data."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "麦麦中国地图"
FILES = (
    "index.html", "启动.cmd", "启动门店查询.cmd", "同步中国订单.cmd", "README.md", "SKILL.md", ".gitignore",
    "LICENSE", "CONTEST_DECLARATION.md", "MCP_INTEGRATION.md",
    "mcp-config.example.json",
    "scripts/serve-local.ps1", "scripts/local_api.py", "scripts/package_skill.py",
    "scripts/build_global_journal.py", "scripts/visual_assets.py",
    "scripts/mcp_readonly.py", "scripts/connect_mcp.py",
    "scripts/import_mcp_footprints.py", "scripts/sync_footprints.py",
    "scripts/footprints.py", "scripts/store_enrichment.py", "web/global-journal.js", "web/journal-engine.js",
    "web/share-card.js", "web/journey-insights.js",
    "templates/global-journal.html", "examples/china-journal.synthetic.json",
    "references/tools.md", "docs/SOURCES.md", "docs/MCP_TOOLS.md", "docs/VALIDATION.md",
    "docs/LOCAL_WINDOWS.md", "docs/REGISTRATION.md", "docs/DEVELOPMENT.md", "docs/PRODUCT-REVIEW.md",
    "docs/china-demo.html", "docs/china-preview.png", "docs/share-card-paper.png", "docs/share-card-red.png",
    "assets/global-title.png", "assets/global-passport.png", "assets/paper.png",
    "assets/data/china-provinces.json", "assets/data/china-cities.json",
    "assets/data/LICENSE-world.txt", "assets/data/CHINA-SOURCES.md", "assets/data/store-directory.json", "assets/data/STORE-SOURCES.md",
    "assets/fonts/source.css", "assets/fonts/dm-mono-source.css",
    "assets/fonts/noto-display-0.ttf", "assets/fonts/noto-display-1.ttf",
    "assets/fonts/noto-display-2.ttf", "assets/fonts/noto-display-3.ttf",
    "assets/fonts/dm-mono-0.ttf", "assets/fonts/dm-mono-1.ttf",
    "assets/fonts/NotoSansSC-OFL.txt", "assets/fonts/DMMono-OFL.txt",
    "assets/icons/storefront.svg", "assets/icons/bag.svg", "assets/icons/clock.svg",
    "assets/icons/clipboard-text.svg", "assets/icons/map-pin.svg",
    "assets/icons/plus.svg", "assets/icons/x.svg", "assets/icons/LICENSE.txt",
    "tests/journal-engine.test.js", "tests/test_project.py", "tests/test_store_enrichment.py", "tests/browser-smoke.cjs",
    "tests/share-card.test.js", "tests/journey-insights.test.js", "tests/browser-features.cjs",
)


def reviewed_path(name):
    """Reject a reviewed name if someone redirects it outside public source."""
    path = ROOT / name
    resolved = path.resolve(strict=True)
    relative = resolved.relative_to(ROOT)
    if resolved != path.absolute() or any(
        (part.startswith(".") and part != ".gitignore") or part in {"private", "packages", "__pycache__"}
        for part in relative.parts
    ):
        raise ValueError("Only reviewed regular source files may be packaged")
    if not path.is_file():
        raise ValueError("Missing reviewed source file")
    return path


def main():
    # Check every source before creating the archive; no partial package.
    sources = [(name, reviewed_path(name).read_bytes()) for name in FILES]
    output = ROOT / "packages/mcd-china-map-local-v0.3.0.zip"
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix(".zip.tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as archive:
            for name, content in sources:
                info = ZipInfo(f"{ARCHIVE_ROOT}/{name}", date_time=(2026, 10, 9, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, content)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(output)


if __name__ == "__main__":
    main()
