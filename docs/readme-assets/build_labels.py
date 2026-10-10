"""Draw README labels from the project's OFL font; no browser font dependency.

Run with Python and fonttools[woff]. Outputs contain glyph paths, no scripts,
remote fonts or embedded user data. The cover is authored with imagegen.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parents[2]
DEST = Path(__file__).resolve().parent
FONT = TTFont(ROOT / 'assets/fonts/lxgw-wenkai-regular.woff2')
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT['head'].unitsPerEm


def text(value, x, y, size, color):
    result = []
    for char in value:
        glyph_name = CMAP[ord(char)]
        pen = SVGPathPen(GLYPHS)
        GLYPHS[glyph_name].draw(pen)
        result.append(f'<path fill="{color}" transform="translate({x:.3f} {y}) scale({size/UPM:.6f} {-size/UPM:.6f})" d="{pen.getCommands()}"/>')
        x += FONT['hmtx'].metrics[glyph_name][0] * size / UPM
    return ''.join(result)


def write(name, width, height, body):
    (DEST / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{body}</svg>\n', encoding='utf-8')


for name, title, primary in [
    ('open-web.svg', '打开网页版', True),
    ('download-local.svg', '下载本地完整版', False),
]:
    background, foreground = ('#bd4533', '#fff9eb') if primary else ('#fff9eb', '#a13f30')
    content = f'<rect x="1" y="1" width="248" height="62" rx="8" fill="{background}" stroke="#bd4533" stroke-width="1.5"/>'
    content += text(title, 25 if primary else 18, 42, 27, foreground)
    content += f'<path d="M222 23L222 36M209 23H222M208 37L222 23" fill="none" stroke="{foreground}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' if primary else ''
    write(name, 250, 64, content)

for name, number, title, subtitle in [
    ('share-heading.svg', '01', '把你的麦麦足迹，晒给朋友看', '一张中国地图，一页探店手账，或一张下一站邀约卡。'),
    ('stores-heading.svg', '02', '找一家特别的麦', '19 座城市，28 家特色门店。湖畔、老街、城市旗舰，点开看照片。'),
    ('plans-heading.svg', '03', '下一站，去吃哪家麦？', '收藏、选日期、约朋友。到店后，把计划写成手账。'),
    ('collections-heading.svg', '04', '把这一城、这一月，好好收藏', '城市回忆册、月度麦麦小报。翻照片，选封面，再分享。'),
]:
    content = '<rect width="960" height="138" rx="7" fill="#fff9eb"/>'
    content += text(number, 24, 36, 19, '#ba4835') + text(title, 24, 82, 37, '#302a22')
    content += '<path d="M24 94 Q180 101 318 93" fill="none" stroke="#d19d36" stroke-width="2.5" stroke-linecap="round"/>'
    content += text(subtitle, 24, 121, 18, '#706454')
    write(name, 960, 138, content)
    content = '<rect width="390" height="138" rx="7" fill="#fff9eb"/>'
    content += text(number, 18, 26, 13, '#ba4835') + text(title, 18, 61, 22, '#302a22')
    content += '<path d="M18 72 Q95 78 185 72" fill="none" stroke="#d19d36" stroke-width="2" stroke-linecap="round"/>'
    lines, current, advance = [], '', 0
    for char in subtitle:
        width = FONT['hmtx'].metrics[CMAP[ord(char)]][0] * 13 / UPM
        if advance + width > 352:
            lines.append(current)
            current, advance = '', 0
        current += char
        advance += width
    lines.append(current)
    if len(lines) > 2:
        raise ValueError('mobile heading subtitle must fit in two lines')
    for index, line in enumerate(lines):
        content += text(line, 18, 100 + index * 19, 13, '#706454')
    write(name.replace('.svg', '-mobile.svg'), 390, 138, content)

FONT.close()
print('Created two SVG actions and eight responsive SVG headings using the bundled OFL font.')
