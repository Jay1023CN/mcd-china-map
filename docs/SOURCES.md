# 来源与素材许可

整理日期：2026-10-09。以下为实现依据；本次 Windows 与 MCP 实测见 [VALIDATION.md](VALIDATION.md)。

## 官方来源

1. [麦当劳中国 MCP](https://github.com/M-China/mcd-mcp-server) 与 [参考 README 版本](https://github.com/M-China/mcd-mcp-server/blob/521150dd82b7b1887e9d257800ee973ed56be0e5/README.md)：接入范围、传输和 33 个工具描述。实际 schema 以 `tools/list` 为准；目录见 [MCP_TOOLS.md](MCP_TOOLS.md)。
2. [官方 Token 入口](https://open.mcd.cn/mcp)。
3. [MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。
4. [创意开发大赛仓库](https://github.com/M-China/mcd-developer-innovation-challenge) 与 [参考规则版本](https://github.com/M-China/mcd-developer-innovation-challenge/blob/80b3de97c303efe0aef67549d74e24920dd03e1e/activityGuidelines.md)：参赛文件与报名流程。
5. [官方参赛声明](https://github.com/M-China/mcd-developer-innovation-challenge/blob/80b3de97c303efe0aef67549d74e24920dd03e1e/CONTEST_DECLARATION.md)：保留原文件。2026-10-09 与官方当前文件逐字节比对一致。

## 全球地理数据

| 文件 | 来源与含义 |
| --- | --- |
| `assets/data/countries.json` | 249 个 ISO 3166-1 国家 / 地区代码及显示名称；不是麦当劳营业地区清单 |
| `assets/data/cities.json` | Natural Earth 1:50m Populated Places 中的 60 个常用城市参考点；不是门店位置或到访证据 |
| `assets/data/world-land.json` | Natural Earth 1:110m Land 陆地轮廓，不含行政边界层或门店分布 |

原始链接、版本及许可详见 [assets/data/LICENSE-world.txt](../assets/data/LICENSE-world.txt)。Natural Earth 地图数据为公共领域；本项目对部分城市中文显示名称做规范化。地图不请求外部瓦片、不使用地理编码服务或自动 GPS。城市参考位置与本人填写坐标均不代表官方门店定位。

国家 / 地区选项不表示 MCP 在当地可用；当前官方接入只生成中国大陆订单线索。

## 视觉素材

- 世界护照艺术字、旅行插画、纸张纹理等通过 Image Gen 生成，不是麦当劳官方宣传素材。
- 不使用用户私聊截图、聊天者姓名或头像。旅行、门店与餐品演示明确标为虚构，不作为真实到访或订单证明。
- [Noto Sans SC](https://fonts.google.com/specimen/Noto+Sans+SC)、[DM Mono](https://fonts.google.com/specimen/DM+Mono) 为 SIL OFL 字体，许可在 `assets/fonts`。固定界面文字字体子集以外的动态文字使用设备字体回退。
- [Phosphor Icons](https://github.com/phosphor-icons/core) 为 MIT 图标，许可在 `assets/icons/LICENSE.txt`。
- 构建 HTML 内嵌所需图片、字体、地图与脚本，页面无需向外部服务请求这些素材。

## 项目说明

本地原型延续作者此前自有取餐 / 轨迹项目的部分客户端与视觉基础，增加全球手动打卡、照片手账与印章。目标目录为 `D:\coding\麦当劳\麦麦世界护照`，不把旧项目 GitHub 地址当作本项目发布地址。

项目不宣称“首个”“唯一”或全球官方集成。原创代码与文档遵循 [MIT License](../LICENSE)；麦当劳商标、服务与官方声明不因此获得额外授权，第三方素材遵循各自许可。
