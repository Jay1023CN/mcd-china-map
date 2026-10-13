# 麦麦中国地图网页版

## 在线使用

[打开麦麦中国地图](https://jay1023cn.github.io/mcd-china-map/)。GitHub Pages 托管的是可直接使用的地图和手账版：新增、编辑、照片、筛选、想去清单、分享卡、JSON 备份恢复与打印。记录保存在当前浏览器，不需要安装或填写 Token。

需要公网 Token 连接、官方门店查询和订单同步时，打开 [Render 在线连接版](https://mcd-china-map.onrender.com/#store-finder)。GitHub Pages 发布地图、公开门店资料和个人手账页面，不包含后端凭据，也不需要用户填写 Token。源码更新到 main 后，Pages 工作流会先检查手机操作，再发布静态网页。

如需自行部署在线连接版，使用仓库提供的 [Render 配置](FREE_HOSTING.md)。

## 带 MCP 连接的完整版本

在现有中国地图和探店手账上增加网页连接。打开网站、粘贴自己的麦当劳中国 MCP Token，就能同步订单和查询门店。勾选“在这个浏览器记住连接”，30 天内再次打开可以继续；不勾选时使用会话 Cookie，服务端会话最多保留一天。Token 自身失效后需要重新连接。

地图、手账、照片、想去清单、筛选、分享、备份和打印沿用原有功能。手账保存在这个浏览器，同一个 Token 对应自己的手账空间；更换 Token 会切换空间，再换回来仍可读取之前的记录。首次连接会接续连接前写下的手账。浏览器清理数据、无痕模式或更换设备时，使用 JSON 备份恢复。

“断开连接”仅退出当前浏览器并删除它的服务端凭据和订单缓存，手账仍在。其他人的连接不受影响。不采集设备指纹。

## Windows 本机使用

安装 Python 3.10 或以上，双击 `scripts/launchers/启动网页版.cmd`。第一次启动会创建独立环境并安装 `requirements-web.txt`；之后直接启动。页面地址为 `http://127.0.0.1:8080`，在页面里填写 Token。

也可以手动启动：

```powershell
py -3.13 -m venv .venv-web
.\.venv-web\Scripts\python.exe -m pip install -r requirements-web.txt
.\.venv-web\Scripts\python.exe scripts/web_api.py --port 8080
```

原有 `启动.cmd` 仍是本地版本，其 Token 只用于本次运行。`scripts/build_web_app.py` 默认生成不带 Token 接口的静态站；网页版由 `web_api.py` 在启动时生成启用接口的同一套界面。

## Linux / macOS 使用

同一份网页后端也支持 Linux 和 macOS，安装 Python 3.10 或以上，在项目目录运行：

```bash
sh scripts/launchers/启动网页版.sh
```

首次运行会创建 `.venv-web-unix` 并安装依赖；后续直接启动，访问 `http://127.0.0.1:8080`。此环境与 Windows 的 `.venv-web` 分开，方便保留已有文件。若发行版未安装 Python 的 `venv` 模块，需要先安装发行版对应的 venv 软件包。

参数直接传给网页服务。例如更换端口或在桌面系统里自动打开浏览器：

```bash
sh scripts/launchers/启动网页版.sh --port 8081 --open-browser
```

Linux 服务器使用下方的 HTTPS 部署方式，不需要桌面环境。用户的 Windows、Linux、macOS、安卓和 iPhone 均通过浏览器打开网站；本次实际验收环境为 Windows 上的 Python 和 Edge，Linux/macOS 原生运行尚未验收。

## 部署到网站

服务器运行同一个 Python 应用，通过 HTTPS 反向代理对外提供页面。`--origin` 必须填写访问网站的完整地址；服务按该地址检查 Host 和 Origin，不信任用户提供的转发头。HTTP 只允许本机地址。

```bash
python -m venv .venv-web
.venv-web/bin/pip install -r requirements-web.txt
.venv-web/bin/python scripts/web_api.py --origin https://你的域名 --port 8080
```

将 HTTPS 代理的上游设为 `127.0.0.1:8080`，保留网站原始 Host，订单同步的读取超时设置为 300 秒。服务使用 Waitress，单进程八个线程；大量用户时需评估上游 MCP 限流和数据库容量。

容器方式：

```bash
docker build -f Dockerfile.web -t mcd-china-map-web .
docker volume create mcd-map-web-state
docker run -d --name mcd-map-web --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v mcd-map-web-state:/app/private/web \
  mcd-china-map-web python scripts/web_api.py --host 0.0.0.0 --origin https://你的域名
```

容器数据卷首次创建时继承镜像内目录权限（UID 10001）。使用绑定目录时须先设置该目录的写入权限。

## 会话和数据

首页照片优先随机展示访问 IP 所在城市中已有实景照片的门店；该城市没有照片时，展示城市参考点距离最近的有照片城市。每 10 秒换一张，只有一张时保持显示；开启减少动态效果时只选图，不自动轮换。定位失败、境外 IP 或静态版使用全国随机照片。

在线版通过 IPWhois HTTPS 接口查询城市，不请求设备 GPS，也不写入手账。查询结果仅在服务器内存中缓存 6 小时，缓存键使用 IP 摘要；重启后清空。IP 城市和城市参考点用于选图，不表示门店的精确距离。

Cookie 只保存随机会话标识，设置 HttpOnly、SameSite=Strict；HTTPS 使用 Secure 和 `__Host-` 前缀。Token 和已同步的订单线索用 Fernet 加密后存入 `private/web/sessions.sqlite3`；服务重启后仍可读取。默认加密密钥为自动生成的 `private/web/session.key`，部署时也可通过环境变量 `MCD_SESSION_KEY` 传入 Fernet 密钥。应限制私有目录权限，备份时同时保留密钥和数据库。

不同浏览器的会话、Token 和订单缓存分开存储。网络同步使用独立临时目录，结束即清理；不会读取本机 `private/mcp` 的历史订单或私有门店补充目录。数据库只保留投影后的候选记录，不保留原始订单响应。过期会话在启动、创建连接和读取时清理；未过期会话以 30 天为最长有效期。

页面、Cookie、浏览器存储、导出文件及日志不包含 Token。手账尚未提供跨设备云同步，30 天仅指连接记忆，不是云端手账保留期。清除 Cookie 后再次填写同一 Token，可继续读取该浏览器仍保存的手账。

## 验证

```powershell
.\.venv-web\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
.\.venv-web\Scripts\python.exe tests/run_browser_web_sessions.py
```

浏览器验收使用独立配置和合成 MCP 响应，覆盖登录、刷新续用、两个用户隔离、更换 Token 的手账切换、退出、HTTPOnly Cookie 与 Token 不进入浏览器存储。真实 Token 只在用户主动连接官方服务时使用。
