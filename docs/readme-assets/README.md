# README 展示素材

这里存放 GitHub 项目展示页专用素材，与应用运行资源、渠道宣传图分开维护。

- `cover-v1.png`：本次 imagegen 原创横版封面。暖纸、细笔中文、巨无霸与薯条、旅行手账；不包含地图轮廓、个人照片或用户资料。
- 两个入口按钮、四个桌面栏目标题与四个手机栏目标题 SVG：由 `build_labels.py` 使用仓库内霞鹜文楷绘制字形路径；不依赖 GitHub 的外部字体、CSS 或脚本。手机标题使用独立字号和两行副句。
- [字体来源](../../assets/fonts/LXGWWenKai-SOURCE.md)与 [SIL OFL 许可](../../assets/fonts/LXGWWenKai-OFL.txt)；图中的文字是字体的图形输出。
- README 中产品截图、GIF 与分享卡复用 `docs/` 公开素材。计划截图为公开门店和标注的计划示例，足迹与探店卡是示例手账；不拿个人订单截图做展示。

重新生成 SVG：安装 `fonttools[woff]` 后运行 `python docs/readme-assets/build_labels.py`。封面保留生成原件，改稿使用新的版本文件名。
