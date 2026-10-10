# 展示与入口核查｜2026-10-10

## 推广优先级

优先麦麦中国地图。GitHub API 本轮读取为地图 2 Star、取餐交接官 0 Star；两个参赛 Issue 均有 M-China-Official 的成功参赛回复。官方 RANKING.md 的 2026-10-10 18:00:21 快照中，地图为并列第 92、2 Star；同一快照首位为 67 Star。榜单会变动，成功参赛和入榜不等于最终资格审核完成。

官方规则：同账号只保留最高 Star 项目；同 Star 选最早报名项目（交接官 #128 早于地图 #139）。最终统计截止北京时间 2026-10-26 00:00；不要把两件作品算成两个奖励名额。

来源：[规则](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md)、[榜单](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/RANKING.md)、[地图报名](https://github.com/M-China/mcd-developer-innovation-challenge/issues/139)、[交接官报名](https://github.com/M-China/mcd-developer-innovation-challenge/issues/128)。

## 当前真实状态

- 两个公开仓库均存在 CONTEST_DECLARATION.md、MCP_INTEGRATION.md、mcp-config.example.json。
- 地图 About 简介、首页 URL 和 china-map / food-journal / mcdonalds / mcp Topics 已配置，保持现有设置。
- 地图最新 Release 为 v0.14.0，本机 ZIP 附件状态 uploaded，约 109 MB；网页版应作为普通访客首选。
- 云浏览器实测公开网页显示 v0.14.0、19 城 28 家目录；打开杭州千岛湖详情并点击「想去这家」，按钮变为「已收藏想去」。本轮未连接 Token 或读取私人订单。
- 交接官 README 标明真实历史订单查询通过，真实待取餐订单仍需现场验收。地图的公开静态手账体验更适合作为本轮主要传播入口。

## 障碍和修改

| 障碍 | 本轮修改 | 验证方式 |
| --- | --- | --- |
| README Star 提示靠近末尾，读者可能没有看到 | 首屏增设简洁提示，明确 Star / Starred 操作；尾部提供仓库链接 | 文案与相对链接检查、公开 README 回读 |
| 空白个人地图需要访客自己想第一步 | 在 README 给出选城 → 门店介绍 → 收藏的短路线，并说明收藏不算到访 | 本轮公开网页实测走通 |
| 体验页只有反馈入口，没有回到作品仓库的支持链接 | 保持原图与布局，在备份区域前增加低干扰的 GitHub 支持入口 | 静态构建、发布前浏览器 CI、发布后网页回读 |
| 非技术用户不清楚网页版和 MCP 本机版的区别 | 增加 TRY-AND-SUPPORT.md，并在首屏说明无需安装 / Token | 与 MCP_INTEGRATION.md、Release 和现有验证文档核对 |
| 现有宣传说明仍以 v0.11 为当前版本 | 在 GROWTH.md 顶部添加 v0.14 当前文案、置顶评论和已有素材配图顺序 | 图片路径和事实边界核对 |
| 分享网页时摘要缺失 | 补充 description 和 Open Graph 标题、摘要、已有公开封面 URL | 生成 HTML 检查；不保证各平台展示缓存或抓取结果 |

既有手绘封面与实际功能截图均保留；没有重做视频、重新报名或修改官方规则。网页新增入口仅跳转仓库，不自动 Star、不统计私人记录、不新增跟踪脚本。

## 验证与后续观察

本轮静态构建契约通过，生成公开静态页面并检查三份修改文档的本地资源链接全部存在，git diff --check 通过。当前执行环境缺少 Playwright 的 Chromium 可执行文件，因此本机手机浏览器回归未运行成功；发布前浏览器验证由已有 GitHub Actions 执行，状态以该提交实际运行结果为准。

没有声称自然流量或 Star 已因修改增长。传播时使用现有公开图、上述正文和同一仓库链接；收到真实反馈后再调整。旧历史文案不宜直接当最新版本说明发布。现有封面约 2.54 MB，后续若有慢网加载反馈再评估压缩，避免无依据降低原图品质。
