# Windows 运行验证

验证日期：2026-10-09，本机 Windows；不含个人订单、Token 或照片。

## 本地页面

Windows PowerShell 5.1 启动固定 `127.0.0.1:8765` 服务；首页 HTTP 200，HEAD 无正文。独立 Edge 测试浏览器使用全新上下文和虚构数据，不接触用户浏览器资料。

已验证空白首页；新增与编辑；刷新恢复；照片缩小与备份；JSON 导出及新上下文导入恢复；删除及刷新；中国候选导入、补齐城市确认、重复同步不恢复已确认候选；冲突 ID 和虚构示例混入个人手账时拒绝；保存失败仍可导出；桌面 1440 和手机 390 像素布局，无脚本错误或横向溢出。

私有目录、点文件、目录穿越路径不可获取，POST 返回 405，其他 Host 返回 400。

## 真实官方 MCP

隐藏输入运行时 Token，未写文件。`initialize`、初始化通知、`tools/list` 成功。实际调用 `now-time-info`、`order-list` 和 10 次 `query-order` 均成功。本次 10 条完成订单生成 10 条中国大陆未确认候选；城市缺失、确认数为 0，不证明本人到访或全年完整覆盖。

原始响应留在 `private/mcp`；后续同步按 `private/mcp/runs` 隔离。未查询可选福利，未调用下单、取消、领券、兑换或抽奖。

## 回归检查

```powershell
node --test tests/journal-engine.test.js
py -m unittest discover -s tests -p test_project.py -v
```

9 项 JavaScript 测试覆盖日期、中国省份、候选边界、筛选、去重、照片与归档白名单；10 项 Python 测试覆盖 Windows UTF-8 构建、不同哈希种子的可重复构建、JSON 转义、候选脱敏、虚构响应转换、只读工具限制、SSE、同步失败保留旧数据、门店响应投影与本机 HTTP 接口。

浏览器验收：启动本地服务，安装 Playwright，运行 `node tests/browser-smoke.cjs`。可设置 `BROWSER_CHANNEL=msedge` 使用 Edge，`PLAYWRIGHT_MODULE` 指定依赖位置。GitHub Actions 在 Windows 执行检查，CI 是否通过以实际运行状态为准。

## 修复与限制

显式 UTF-8 读取修复 Windows GBK 构建失败；固定字段顺序修复 Python 随机哈希导致构建结果变化；同步按运行隔离、失败保留旧数据、候选原子替换；启动支持 `-NoBrowser` 供测试。存储仍为本浏览器，无云同步。测试通过不代表替用户确认真实到访。

## 中国地图 v0.2.0 验证

中国分省地图、省份点亮、省份筛选、城市 M 点位、南海插图、门店选择带入表单和门店引用备份均通过独立浏览器验收。手动编辑门店后旧官方引用被清除。真实 nearby 查询以“上海／人民广场／到店自取”返回 5 家门店。门店 HTTP 服务使用同源校验和本机绑定，Token 仅留进程内存。

本机 8765 由另一现有应用占用，本次浏览器测试使用隔离端口 18765；未停止该现有应用。普通发行入口仍固定 8765。
