# 手机直接用，先免费上线

[现有手机入口](https://jay1023cn.github.io/mcd-china-map/#store-finder)已经支持搜店、收藏、照片、记餐和分享。用户打开网址就能用。

订单同步需要服务器。仓库里的 `render.yaml` 使用 Render 免费 Python 服务，部署现有网页后端。手机访问 Render 分配的 HTTPS 网址，在页面中连接自己的 Token；页面和接口在同一个网站，用户不用运行电脑或安装程序。

## 创建服务

[部署到 Render](https://render.com/deploy?repo=https://github.com/Jay1023CN/mcd-china-map)

用 GitHub 登录 Render，授权访问这个仓库。部署页面读取 `render.yaml`，确认服务方案是 **Free** 后创建。配置只创建一个免费网页服务，没有付费磁盘和数据库。

服务启动完成后，从 Render 面板打开实际分配的网址。网址由平台分配，不预设 `mcd-china-map.onrender.com` 一定可用。把这个网址发给体验者即可。

## 免费版实际能做到什么

搜店、收藏、记餐和分享照常使用。订单同步由服务器调用麦当劳 MCP，使用每个人在网页中填写的 Token；不会使用开发者电脑上的 Token。

手账、照片和收藏仍保存在用户的浏览器里。不同网站分别保存记录：从 GitHub Pages 转到新网址时，需要先导出 JSON 备份，再到新网址导入。暂时没有跨设备云同步。

Render 免费服务闲置 15 分钟后休眠，下次打开约等一分钟。休眠、重启和重新部署会清除服务器的临时文件，因此登录连接和订单候选缓存可能丢失，需要重新连接、重新同步。已经保存到浏览器的手账不受服务器重启影响。现有“记住连接”最长 30 天，在免费服务上不能保证保持到 30 天。

免费服务有月度运行时长、流量和构建额度。先用默认免费方案；如果平台要求升级或绑定付款方式，先停在创建页面核对原因。

## 上线核对

部署配置准备好不等于服务已经上线。取得实际网址后还需逐项检查：

1. 手机打开页面，搜一家门店、收藏、记一餐，刷新后记录仍在。
2. `/api/health` 返回 200，连接前 `connected` 为 false。
3. 两个独立浏览器分别连接自己的 Token，确认订单各自可见。
4. 用自己的有效 Token 同步一次，确认官方接口能从服务器访问；不把本地合成响应测试当成真实订单验收。

通过后再把新网址设为完整体验入口，更新二维码和宣传链接。

## 配置对应的代码

`startCommand` 读取 Render 提供的 `PORT` 和 `RENDER_EXTERNAL_URL`。服务通过实际 HTTPS 网址检查 Host 和 Origin，保留独立会话、HttpOnly Cookie 和凭据加密。现有 GitHub Pages 继续提供手动记录版。

更新代码后，Render 等仓库检查通过再自动部署。只维护这一份项目，用户刷新取得网页更新。

平台依据：[免费方案](https://render.com/docs/free)、[部署配置](https://render.com/docs/blueprint-spec)、[环境变量](https://render.com/docs/environment-variables)。核对日期：2026-10-11。
