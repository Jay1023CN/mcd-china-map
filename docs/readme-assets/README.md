# README 展示素材

这里存放 GitHub 项目展示页专用素材，与应用运行资源、渠道宣传图分开维护。

- `cover-v1.png`：本次 imagegen 原创横版封面。暖纸、细笔中文、巨无霸与薯条、旅行手账；不包含地图轮廓、个人照片或用户资料。
- 两个入口按钮、四个桌面栏目标题与四个手机栏目标题 SVG：由 `build_labels.py` 使用仓库内霞鹜文楷绘制字形路径；不依赖 GitHub 的外部字体、CSS 或脚本。手机标题使用独立字号和两行副句。
- [字体来源](../../assets/fonts/LXGWWenKai-SOURCE.md)与 [SIL OFL 许可](../../assets/fonts/LXGWWenKai-OFL.txt)；图中的文字是字体的图形输出。
- README 中产品截图、GIF 与分享卡复用 `docs/` 公开素材。计划截图为公开门店和标注的计划示例，足迹与探店卡是示例手账；不拿个人订单截图做展示。

## 第二版图文展示

`discover-v2`、`journal-v2`、`share-v2` 三组 PNG 分别展示找店、记一餐和分享。桌面与手机各一份独立排版，手机使用 `-mobile.png`，避免整张桌面图缩小后看不清。完整足迹卡按比例放入，不裁切地图。

原图来自 `docs/featured-photo-directory-preview.png`、`docs/featured-photo-detail-preview.png`、`docs/memory-card-preview.png`、`docs/city-album-card-preview.png`、`docs/monthly-newspaper-preview.png`、`docs/share-card-paper.png` 和 `docs/plan-card-preview.png`。上海门店照片使用 `assets/store-photos/shanghai-huaxu.jpg`，来源为上观新闻；门店照片来源见 `assets/data/STORE-SOURCES.md`。四个 `*-v2.svg` 是可点击的入口、下载、反馈和 Star 按钮。

生成步骤：

```sh
python docs/readme-assets/build_showcase.py
node docs/readme-assets/render_showcase.cjs
```

Python 需要 `fonttools[woff]`；Node 需要 Playwright 与 Chromium。可以用 `PLAYWRIGHT_MODULE` 指定 Playwright 路径，用 `BROWSER_CHANNEL=msedge` 使用本机 Edge。SVG 中间文件只写入 `private/readme-render/`，GitHub 使用导出的 PNG。

仓库动态卡由 [GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended) 的 `/api/pin/` 接口生成，仅查询 `Jay1023CN/mcd-china-map`，提供浅色和深色配色。第三方共享服务会缓存统计数据。

另评估了 [lowlighter/metrics](https://github.com/lowlighter/metrics) 的 repository 模板；2026-10-11 测试共享实例返回 HTTP 500，当前 README 没有嵌入这个不可用的远程图，也没有额外配置 Token。

重新生成 SVG：安装 `fonttools[woff]` 后运行 `python docs/readme-assets/build_labels.py`。封面保留生成原件，改稿使用新的版本文件名。
