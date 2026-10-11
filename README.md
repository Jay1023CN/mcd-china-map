<p align="center">
  <img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/cover-v1.png" alt="麦麦中国地图｜把麦当劳吃成一张中国地图" width="960">
</p>

<p align="center"><strong>下次旅行，哪家麦值得顺路去？</strong><br><sub>先收藏一家店，再把每一餐留下来。电脑、手机都能打开。</sub></p>

<p align="center">
  <a href="https://jay1023cn.github.io/mcd-china-map/"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/open-map-v2.svg" alt="打开地图，找家麦" width="240"></a>
  &nbsp;
  <a href="https://github.com/Jay1023CN/mcd-china-map/releases/latest"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/download-v2.svg" alt="下载 Windows 版" width="240"></a>
</p>

<br>

<p><picture><source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/discover-v2-mobile.png"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/discover-v2.png" alt="先找一家喜欢的店：按城市发现门店，查看照片、介绍和地址，收藏下一站。9276 条门店资料，31 家特色店实景。" width="960"></picture></p>

<p align="center"><sub>搜城市、店名或路名，点「想去这家」，你的下一站就收好了。</sub></p>

<br>

<p><picture><source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/journal-v2-mobile.png"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/journal-v2.png" alt="吃过之后留一页：照片、餐品和随手记，整理成探店手账、城市回忆册和月度麦麦小报。" width="960"></picture></p>

<p align="center"><sub>门店照片自动带入，也能拍照或从相册选。喜欢的一餐，随时回来翻。</sub></p>

<br>

<p><picture><source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/share-v2-mobile.png"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/share-v2.png" alt="把下一站发给朋友：中国足迹卡、探店分享卡、下一站邀约卡，保存图片、复制图片或系统分享。" width="960"></picture></p>

<p align="center"><sub>选标题、换照片、写一句话，发给想一起出发的人。</sub></p>

<br>

<details>
<summary><strong>看一段操作演示：打开地图，翻一页手账</strong></summary>

<p align="center"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/product-preview.gif" alt="地图与手账操作演示动图，记录为公开示例" width="850"></p>

</details>

<details>
<summary><strong>第一次用：网页版与本地版怎么选？</strong></summary>

**想先试试：** [打开网页版](https://jay1023cn.github.io/mcd-china-map/)，直接记一餐、上传照片、收藏门店、排期、翻城市回忆册、生成月度小报和分享卡。无需安装。

**想同步自己的麦当劳订单：** [下载 Windows 完整包](https://github.com/Jay1023CN/mcd-china-map/releases/latest)，解压后双击 `启动.cmd`。普通手账无需 Python；安装 Python 3.10+ 后，可连接自己的 [麦当劳中国 MCP Token](https://open.mcd.cn/mcp)，自动整理完成订单、查询官方附近门店。门店资料与默认照片自动带入，仍可编辑随记、换照片或删除记录。

当前 GitHub Pages 提供地图与手账，MCP 连接通过本机版使用。更多入口和步骤见 [Windows 使用说明](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/LOCAL_WINDOWS.md)、[网页版与部署](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/WEB.md)。

</details>

<details>
<summary><strong>我的照片、记录和备份放在哪里？</strong></summary>

手账和想去清单保存在当前浏览器。导出 JSON 可以带上照片、日期与优先标记，换设备时导入恢复；也能打印或保存 PDF。

目前没有云同步，换浏览器、清理网站数据或换地址前请导出备份。最多保存 1000 页手账、100 家想去门店，处理后的单张照片不超过 1.5 MiB，完整归档不超过 8 MiB。旧版中国记录可恢复。

地图提供 34 个省份 / 地区选项。公开门店只标已匹配点位；尚未核实坐标的店仍可搜索、收藏、打卡。手账可以选择门店位置、城市参考位置或本人填写的坐标。麦当劳中国 MCP 服务范围为中国大陆。公开截图使用独立公开门店或示例记录，个人 Token、订单、地址和照片不进入 GitHub。

</details>

<details>
<summary><strong>参与开发：源码、构建、验证与素材</strong></summary>

```powershell
py scripts/build_global_journal.py --output index.html
node --test tests/journal-engine.test.js tests/wishlist-engine.test.js
py -m unittest discover -s tests -p 'test_*.py' -v
py scripts/package_skill.py
```

[开发与文件管理](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/DEVELOPMENT.md) · [运行验证](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/VALIDATION.md) · [MCP 接入](https://github.com/Jay1023CN/mcd-china-map/blob/main/MCP_INTEGRATION.md) · [Skill](https://github.com/Jay1023CN/mcd-china-map/blob/main/SKILL.md) · [素材来源](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/SOURCES.md) · [宣传素材](https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/GROWTH.md)

页面模板位于 `templates/`，交互和归档位于 `web/`，构建与服务入口位于 `scripts/`。GitHub Actions 自动检查并发布网页版；预览图、字标和宣传图按目录分别管理。

</details>

<br>

<p align="center"><strong>哪家麦值得收进地图？你来推荐。</strong></p>

<p align="center">
  <a href="https://github.com/Jay1023CN/mcd-china-map/issues/new/choose"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/feedback-v2.svg" alt="推荐门店或提建议" width="240"></a>
  &nbsp;
  <a href="https://github.com/Jay1023CN/mcd-china-map#start-of-content"><img src="https://raw.githubusercontent.com/Jay1023CN/mcd-china-map/main/docs/readme-assets/support-v2.svg" alt="喜欢的话，点颗 Star" width="240"></a>
</p>

<p align="center">
  <a href="https://github.com/Jay1023CN/mcd-china-map">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github-stats-extended.vercel.app/api/pin/?username=Jay1023CN&amp;repo=mcd-china-map&amp;title_color=efc67d&amp;text_color=e6dccb&amp;icon_color=eb7a66&amp;bg_color=292621&amp;border_color=50483c&amp;border_radius=12&amp;card_width=480&amp;description_lines_count=3&amp;locale=cn">
      <img src="https://github-stats-extended.vercel.app/api/pin/?username=Jay1023CN&amp;repo=mcd-china-map&amp;title_color=b33f2e&amp;text_color=514738&amp;icon_color=b33f2e&amp;bg_color=fff9eb&amp;border_color=eadcc7&amp;border_radius=12&amp;card_width=480&amp;description_lines_count=3&amp;locale=cn" alt="麦麦中国地图仓库动态：GitHub Stats Extended 项目卡片" width="480">
    </picture>
  </a>
</p>

<p align="center"><sub>喜欢这个创意，可以在仓库顶部点颗 Star，下次来看看又多了哪些店。</sub></p>

<p align="center"><sub>社区独立作品 · 原创代码 <a href="https://github.com/Jay1023CN/mcd-china-map/blob/main/LICENSE">MIT</a> · <a href="https://github.com/M-China/mcd-developer-innovation-challenge/issues/139">参赛作品</a> · <a href="https://github.com/Jay1023CN/mcd-china-map/blob/main/docs/ROADMAP.md">接下来做什么</a></sub></p>
