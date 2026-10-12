# 麦麦中国地图的入口与更新

日常体验入口是 [GitHub Pages](https://jay1023cn.github.io/mcd-china-map/)。Windows 下双击 `scripts/launchers/打开在线地图.cmd` 也会打开这个入口，不安装 Python、不启动本地服务。需要 MCP 连接和订单同步时，打开 [Render 在线连接版](https://mcd-china-map.onrender.com/#store-finder)。

Pages 发布公开地图、门店资料和手账功能；Render 另外提供网页后端。更新公开页面后，用户刷新即可获取新版本；本机包仍需单独更新。

## 两种入口

| 入口 | 页面与公开资料从哪里来 | 更新方式 |
| --- | --- | --- |
| 日常体验主站、打开在线地图.cmd | GitHub Pages 静态网页与公开资源 | Pages 工作流检查并发布；用户刷新 |
| 在线订单同步入口 | Render 网页服务与静态资源 | 更新并部署在线后端；用户刷新 |
| 启动网页版.cmd、启动.cmd 等本地入口 | 当前解压包中的页面、门店快照、图片和程序 | 当前版本仍需更新本地包 |

在线 CMD 里只保留固定 Pages 地址。页面内容、照片和门店目录没有写进这个 CMD，由 GitHub Pages 提供。

现有本地启动脚本则会运行包内 Python 服务，使用包内资料构建页面。它们没有自动下载新版页面或公开门店资料的功能；不能把本地包描述成跟随主站自动更新的启动器。

## 资料如何进入主站

官方公示、门店查询和其他公开资料 → 采集与交叉核对 → 门店目录和图片 → 构建并部署 GitHub Pages → 浏览器加载。

详情里的官方来源链接让用户查看出处。它们不是页面每次打开时实时查询的接口。只修改来源网址不会自动刷新门店资料，仍需完成采集、核对和发布。

## 个人记录与订单同步

网页版的手动记录、收藏、照片和备份由当前浏览器保存。公开资料在线更新不会把这些个人记录写入门店公共目录。

Token 登录和订单同步需要后端服务。GitHub Pages 只提供手动记录、收藏、照片和分享等静态功能；Render 在线连接版和本机网页服务提供 MCP 接入。本机网页版的会话保存在本机 private/web，没有接入 GitHub Pages。

Render 和本地入口分别使用自己的后端，会话与数据分开保存。

## 已核对的代码

- `scripts/launchers/启动网页版.cmd`：创建本地运行环境后启动 `scripts/web_api.py`。
- `scripts/web_api.py`：启动时构建本地页面，提供同源 API 与独立会话。
- `scripts/build_global_journal.py`：读取包内公开门店目录，把资料写入页面数据块。
- `scripts/build_web_app.py`：生成线上页面、图片等静态资源与版本清单。
- `scripts/package_skill.py`：本地包包含页面、门店快照和图片。
- `web/global-journal.js`：门店搜索使用页面携带的目录；个人记录保存在浏览器中。

本说明于 2026-10-13 更新，区分 GitHub Pages 日常入口与 Render MCP 连接入口。Windows 本地包仍需单独下载更新。
