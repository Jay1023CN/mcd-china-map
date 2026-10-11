"""Compose README boards from existing public product captures and font paths.

Requires fonttools[woff]. SVG intermediates stay in private/readme-render;
render_showcase.cjs exports the six responsive PNG boards for GitHub.
"""
from pathlib import Path
import base64
import json
import mimetypes
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parents[2]
DEST = Path(__file__).resolve().parent
WORK = ROOT / 'private/readme-render'
WORK.mkdir(parents=True, exist_ok=True)
FONT = TTFont(ROOT / 'assets/fonts/lxgw-wenkai-regular.woff2')
GLYPHS, CMAP = FONT.getGlyphSet(), FONT.getBestCmap()
UPM = FONT['head'].unitsPerEm
INK, RED, MUTED = '#302a22', '#b33f2e', '#766858'
CREAM, LINE, YELLOW = '#fff9ed', '#e5d8c1', '#efd780'


def text(value, x, y, size=24, color=INK):
    paths = []
    for char in value:
        name = CMAP[ord(char)]
        pen = SVGPathPen(GLYPHS)
        GLYPHS[name].draw(pen)
        paths.append(f'<path fill="{color}" transform="translate({x:.3f} {y}) scale({size/UPM:.6f} {-size/UPM:.6f})" d="{pen.getCommands()}"/>')
        x += FONT['hmtx'].metrics[name][0] * size / UPM
    return ''.join(paths)


def rect(x, y, w, h, color, radius=0, border=None):
    stroke = f' stroke="{border}" stroke-width="1"' if border else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{color}"{stroke}/>'


def image(path, x, y, w, h):
    source = ROOT / path
    mime = mimetypes.guess_type(source.name)[0]
    uri = f'data:{mime};base64,' + base64.b64encode(source.read_bytes()).decode()
    return f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="{uri}" preserveAspectRatio="xMidYMid meet"/>'


def framed(path, x, y, w, h):
    return (rect(x+4, y+7, w+16, h+16, '#e7ddcb', 5)
            + rect(x, y, w+16, h+16, '#fffdfa', 4, LINE)
            + image(path, x+8, y+8, w, h))


def underline(x, y, w, color=RED):
    return f'<path d="M{x} {y} Q{x+w*.45} {y+5} {x+w} {y-1}" stroke="{color}" stroke-width="2.5" fill="none" stroke-linecap="round"/>'


def base(w, h, number, label):
    return (rect(0, 0, w, h, CREAM, 10)
            + rect(0, 0, 5, h, RED, 2)
            + text(number + ' / ' + label, 28 if w<600 else 40, 35 if w<600 else 43, 15 if w<600 else 18, RED))


boards = []


def save(name, w, h, body):
    (WORK / (name+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>', encoding='utf-8')
    boards.append({'name': name, 'width': w, 'height': h})


# Discovery: one coherent directory capture, with a public Shanghai photo.
b = base(960, 610, '01', '先找一家喜欢的店')
b += text('下一站，', 40, 122, 42) + text('去吃哪家麦？', 40, 177, 42)
b += underline(40, 194, 254, YELLOW)
b += text('湖畔、老街，或家门口。', 40, 244, 23, MUTED)
b += text('按城市找，点开看照片和介绍。', 40, 278, 23, MUTED)
b += framed('assets/store-photos/shanghai-huaxu.jpg', 40, 316, 350, 197)
b += text('上海 · 人民广场旁的华旭旗舰店', 49, 549, 17, MUTED)
b += framed('docs/featured-photo-directory-preview.png', 440, 66, 474, 491)
b += text('9,276 条门店资料  /  31 家特色店实景', 40, 588, 19, RED)
save('discover-v2', 960, 610, b)
b = base(390, 950, '01', '先找一家喜欢的店')
b += text('下一站，去吃哪家麦？', 28, 87, 29)
b += underline(28, 100, 260, YELLOW)
b += text('按城市找，点开看照片和介绍。', 28, 136, 18, MUTED)
b += framed('docs/featured-photo-detail-preview.png', 24, 158, 326, 685)
b += text('9,276 条门店资料', 28, 893, 26, RED)
b += text('31 家特色店有实景照片，先收藏再出发。', 28, 925, 17, MUTED)
save('discover-v2-mobile', 390, 950, b)

# Journal: the actual memory card, city album and monthly newspaper.
b = base(960, 610, '02', '吃过之后，留一页')
b += framed('docs/memory-card-preview.png', 40, 78, 324, 432)
b += text('把一顿麦，', 418, 123, 42) + text('写成自己的故事。', 418, 179, 42)
b += underline(418, 196, 316, YELLOW)
b += text('照片、餐品、随手记，一起收好。', 418, 241, 24, MUTED)
b += text('按城市翻回忆，按月份出一份小报。', 418, 277, 24, MUTED)
b += framed('docs/city-album-card-preview.png', 418, 312, 218, 211)
b += framed('docs/monthly-newspaper-preview.png', 678, 290, 198, 264)
b += text('探店手账', 144, 562, 21, RED)
b += text('城市回忆册', 466, 567, 18, MUTED) + text('月度麦麦小报', 717, 588, 18, MUTED)
save('journal-v2', 960, 610, b)
b = base(390, 652, '02', '吃过之后，留一页')
b += text('把一顿麦，写成一页。', 28, 87, 29)
b += underline(28, 100, 254, YELLOW)
b += text('照片、餐品，还有当时的小心情。', 28, 136, 18, MUTED)
b += framed('docs/memory-card-preview.png', 37, 158, 300, 400)
b += text('再翻成城市回忆册、月度麦麦小报。', 28, 610, 18, MUTED)
save('journal-v2-mobile', 390, 652, b)

# Sharing: always scale the entire existing map card, preserving its full map.
b = base(960, 630, '03', '把下一站，发给朋友')
b += text('这张中国地图，', 40, 113, 42) + text('是你一顿一顿吃出来的。', 40, 165, 35)
b += underline(40, 184, 326, YELLOW)
b += text('保存图片、复制图片，或打开系统分享。', 40, 227, 23, MUTED)
b += framed('docs/share-card-paper.png', 40, 256, 251, 335)
b += framed('docs/plan-card-preview.png', 343, 256, 251, 335)
b += rect(654, 91, 260, 106, '#f2e6cd', 4)
b += text('给朋友的一句邀约', 675, 129, 22, RED)
b += text('「周末，要不要去这家？」', 670, 168, 18)
b += text('中国足迹卡', 670, 292, 25) + text('看这一趟走过了哪里', 670, 327, 19, MUTED)
b += text('下一站计划卡', 670, 399, 25) + text('把照片、日期和理由发出去', 670, 434, 19, MUTED)
b += text('到店之后', 670, 507, 25) + text('再留一张探店分享卡', 670, 542, 19, MUTED)
save('share-v2', 960, 630, b)
b = base(390, 682, '03', '把下一站，发给朋友')
b += text('把你的麦麦足迹晒出来。', 28, 87, 27)
b += underline(28, 100, 290, YELLOW)
b += text('一张地图，就是一份旅行回忆。', 28, 136, 18, MUTED)
b += framed('docs/share-card-paper.png', 37, 158, 300, 400)
b += text('也能分享探店卡、下一站邀约卡。', 28, 610, 18, MUTED)
b += text('保存图片  /  复制图片  /  系统分享', 28, 644, 18, RED)
save('share-v2-mobile', 390, 682, b)


def button(name, title, primary=False, icon=None):
    bg, fg = (RED, CREAM) if primary else (CREAM, RED)
    body = rect(1, 1, 238, 56, bg, 9, RED if primary else LINE)
    advance = sum(FONT['hmtx'].metrics[CMAP[ord(c)]][0] for c in title) / UPM
    size = min(23, (184 if icon else 208) / advance)
    body += text(title, 18, 36, size, fg)
    if icon == 'arrow':
        body += f'<path d="M209 20h12v12m-13 1 13-13" fill="none" stroke="{fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    write = f'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="58" viewBox="0 0 240 58">{body}</svg>\n'
    (DEST/name).write_text(write, encoding='utf-8')


button('open-map-v2.svg', '打开地图，找家麦', True, 'arrow')
button('download-v2.svg', '下载 Windows 版')
button('feedback-v2.svg', '推荐门店 / 提建议')
button('support-v2.svg', '喜欢的话，点颗 Star')
(WORK/'manifest.json').write_text(json.dumps(boards, ensure_ascii=False, indent=2), encoding='utf-8')
FONT.close()
print('Composed six responsive boards and four image actions from existing public assets.')
