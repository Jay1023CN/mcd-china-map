# 项目结构与文件管理

本文说明公开项目文件的职责，以及修改后如何生成和验收页面。个人订单、照片、Token 和本机导入结果留在私有环境中。

## 目录与文件职责

| 位置 | 用途 | 修改方式 |
| --- | --- | --- |
| `assets/data/` | 随公开项目分发的省市参考数据、门店目录和对应来源说明。`store-directory.json` 是可审核的公开门店资料，不存个人订单。 | 更新资料时同时核对来源、字段和来源说明；不要把 Token 或订单写入这里。 |
| `web/journal-engine.js` | 手账记录、照片和备份归档的校验与数据处理。 | 在源文件中修改，并用 Node.js 单元测试覆盖行为。 |
| `web/wishlist-engine.js` | 收藏门店、探店日期、优先想去与城市/日期/文字筛选。 | `planned_date` 为有效 `YYYY-MM-DD`，允许未来日期；`priority` 为布尔值。官方资料刷新保留用户的日期、优先标记与理由。构建投影的字段白名单同步更新，备份通过手账归档统一保存。 |
| `web/global-journal.js` | 地图、门店发现、手账、详情、照片及分享表单的交互。 | 在源文件中修改，并运行相关浏览器验收。 |
| `web/journal-collections.js` | 从筛选后的手账派生城市回忆册、月份统计，渲染城市选页长图与 1080×1440 月度小报。 | 不操作存储或联网。照片由页面提供图片数据；城市选页严格核验同城身份，最多12页，月份统计不随选照片变化。分享投影仅含标题、随记、统计和用户选择显示的城市 / 门店 / 每页文字。 |
| `web/collection-preferences.js` | 归档中的 `collection_preferences` 编辑选择白名单与更新。 | 按城市 / 月份 ID 保存封面、最多12页选页、最多3张照片顺序、版式与一句随记；旧归档无需该字段。页面保存时通过引擎归一化，Python 构建同步投影，多窗口合并按集合 ID，导入恢复保留编辑选择。 |
| `web/store-navigation.js` | 高德 URI 搜索链接与可复制店名 / 地址的投影。 | 仅传名称、城市和已知地址；不把城市参考点传为门店坐标。默认门店地址由同城市同名称的公开目录匹配。 |
| `web/order-journal.js` | 完成订单自动成为可编辑手账，匹配城市、省份和默认照片。 | 保留稳定 ID、用户随记和照片；删除记录通过 `deleted_order_ids` 随备份保存，同步时保持删除。 |
| `scripts/build_web_app.py` | 构建空白公开网页，拆出带哈希的字体与装饰资源，生成分发清单。 | 输出到 `dist/web`；使用空白归档和公开资料，不读取个人订单目录。 |
| `scripts/web_api.py`、`scripts/web_sessions.py` | 网页 MCP 接口和按浏览器独立的 Cookie 会话。 | 会话数据库、密钥及订单缓存位于 `private/web`；部署说明统一放在 `docs/WEB.md`。 |
| `web/share-card.js`、`web/memory-card.js` | 足迹与单篇探店卡片的排版；图片生成与分享使用同一弹窗。 | 单篇照片只接受本地图片数据，门店默认图经已收录目录转换。 |
| `web/journal-search.js`、`web/archive-merge.js` | 手账文字搜索；多窗口保存时按条目合并，保留新增、编辑与删除。 | 模块不操作存储，页面负责读取、校验与保存；单元测试覆盖数据行为。 |
| `scripts/store_photo_data.py` | 把已审核门店目录中的默认照片转为内存图片数据，供单篇分享卡使用。 | 公开镜像放在 `assets/store-photos/`；个人照片不写入公开素材。 |
| `templates/global-journal.html` | 页面结构与样式模板；构建时嵌入 Web 脚本和页面数据。 | 页面改动写在模板或 Web 源文件中，不直接编辑生成的 HTML。 |
| `scripts/` | 构建、门店资料同步与补充、订单导入、校验和打包工具。 | 修改前确认脚本输入输出范围；同步或补充脚本不得把个人结果写入公开资料目录。 |
| `scripts/project_version.py` | 页面底部、本机接口和压缩包名共用的版本号。 | 每次发行只在这里更新代码版本，再生成页面与包。 |
| `启动.cmd`、`备用启动.cmd`、`scripts/start-local.cmd` | 两个固定地址入口，共用 Python 版本检查与 PowerShell 回退。 | 普通入口使用 8765，备用入口使用 18765；不随机切换地址，不停止其他软件。 |
| `examples/` | 明确标注为虚构的演示归档。 | 只放合成记录，不放真实订单或用户照片。 |
| `tests/` | 引擎、项目文件与浏览器行为测试。 | 所有订单、门店和照片都使用虚构 fixture；浏览器图片请求由测试路由拦截。 |
| `docs/` | 来源、操作、验证和开发说明；`*-demo.html` 与预览图是生成的演示产物。 | 编辑说明源文档；演示 HTML 由构建脚本生成。 |
| `private/` | 本机 MCP 响应、真实订单候选、私人手账页面及其他个人资料。 | 仅在本机使用，不检查进 Git，也不纳入公开压缩包。 |
| `packages/` | 本地生成的发行压缩包。 | 用 `scripts/package_skill.py` 的显式文件白名单生成。 |
| `test-results/` | 浏览器验收截图和临时结果。 | 可重新生成，不作为项目资料或发行内容。 |
| `docs/growth-assets/`、`private/growth-work/` | 前者仅保留采用的宣传图与来源；后者保留旧版草稿、渲染脚本和验收中间文件。 | 宣发对话负责文案和素材，主 Agent 审核后显式加入 Git 与打包清单。 |

`.gitignore` 已排除 `private/`、`packages/`、`test-results/`、`node_modules/`、Python 缓存、环境文件和本机配置。添加文件前仍应检查 `git status` 和打包清单，避免将本机数据纳入提交或发行包。

## 开发步骤

1. 修改 `web/` 或 `templates/` 中的源文件；若更新公开门店资料，核对 `assets/data/store-directory.json` 及其来源记录。
2. 从模板重新生成公开首页和虚构演示页：

   ```powershell
   py scripts/build_global_journal.py --output index.html
   py scripts/build_global_journal.py --archive examples/china-journal.synthetic.json --output docs/china-demo.html
   ```

3. 运行相关检查：

   ```powershell
   node --test tests/journal-engine.test.js
   py -m unittest discover -s tests -p 'test_*.py' -v
   ```

   浏览器行为改动还应按 `docs/VALIDATION.md` 启动本机服务并运行 `node tests/browser-smoke.cjs`。测试不得依赖真实门店接口、真实订单或个人浏览器资料。

4. 检查生成页、测试结果和 `git status`，确认只有预期的公开源文件与生成产物变化；按需用 `py scripts/package_skill.py` 生成发行包。

## 生成文件与发行边界

`index.html` 与 `docs/china-demo.html` 是由 `templates/global-journal.html`、`web/` 源文件和输入归档生成的页面。不要手工修改这两个 HTML；修改后通过构建脚本重新生成，首页使用空白归档，演示页只使用 `examples/china-journal.synthetic.json`。

发行包由 `scripts/package_skill.py` 中的 `FILES` 白名单决定。新增公开文件只有在确认内容和发行必要性后才加入白名单；不要通过打包整个仓库来替代清单。`private/`、`packages/`、`test-results/` 及本机配置不属于公开发行内容。

本机查询入口的 Token 只在进程内使用；网页连接版可选择记住连接，由服务端加密保存到独立会话目录。Token 不写入公开源代码、配置样例、手账备份、日志、Git 历史或发行包。真实订单和用户照片只留在私有环境中；测试与演示使用虚构资料。

## 完成标准

- 源文件已修改，生成页面来自当前模板和脚本。
- 与改动相关的单元、项目或浏览器检查已实际运行，并如实记录未运行项。
- `git status` 与打包白名单已检查，个人数据、Token 和临时测试产物未进入公开内容。
