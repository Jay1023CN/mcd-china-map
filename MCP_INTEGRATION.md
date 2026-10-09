# MCP 接入说明

## 范围与凭据

官方服务为**麦当劳中国大陆 MCP**：`https://mcp.mcd.cn`，Streamable HTTP，鉴权为 `Authorization: Bearer <自己的 Token>`。凭据入口：[open.mcd.cn/mcp](https://open.mcd.cn/mcp)。实际工具与 schema 以运行时 `tools/list` 为准。

本项目中国大陆订单只作为待本人确认的线索。官方服务不提供全球订单历史、本人到店证明或本项目的全球打卡接口。海外记录由本人手动填写。

推荐双击 `同步中国订单.cmd`，在本地终端隐藏输入 Token。Python `getpass` 不回显、不写文件，凭据留在进程内存。也可由启动环境提供 `MCD_MCP_TOKEN`；不要把真实值放入源码、示例配置、截图或提交。

`mcp-config.example.json` 仅含 `${MCD_MCP_TOKEN}` 占位符。MCP 客户端须支持变量替换或提供自己的密钥配置；不能把占位符当作 Token。

云端个人保险库不会自动向 Windows 终端注入凭据，本地优先使用终端隐藏输入。

## Windows 操作

安装 Python 3.10 或更新版本，确保 `py` 或 `python` 可用。仅启动和编辑手账无需 Python。

```powershell
cd 'D:\coding\麦当劳\麦麦世界护照'

# 初始化并发现允许的只读工具，尚不查询订单
py scripts\connect_mcp.py --prompt-token

# 获取中国大陆订单线索
py scripts\sync_footprints.py --prompt-token --order-offset +08:00
```

同步成功后，在 <http://127.0.0.1:8765/> 导入 `private\mcp\global-candidates.json`，到“待确认订单”逐条补齐城市并确认本人到店。日常手账统一使用主页，不依赖不同 HTML 文件之间自动同步。

`+08:00` 明确解释原始数据中的无时区下单时间。实际字段含义变化时，应先核对响应，再选择正确偏移。

## 调用链

| 步骤 | 工具或操作 | 处理 |
| --- | --- | --- |
| 协议与 schema | `initialize`、初始化通知、`tools/list` | 协商协议，读取当前要求 |
| 时间参考 | `now-time-info` | 保存实际返回 |
| 订单范围 | `order-list` | 只处理本次返回范围 |
| 详情 | `query-order` | 根据列表的实际引用读取 |
| 规范化 | `import_mcp_footprints.py` | 不猜缺失城市或未声明状态 |
| 线索转换 | `build_global_journal.py` | 完成订单转为未确认的中国大陆候选 |
| 本人确认 | 页面表单 | 补城市、核对到访，转入手动确认记录 |

客户端只允许 `order-list`、`query-order`、`now-time-info`、`available-coupons`、`campaign-calendar`，不允许创建 / 取消订单、领取、兑换或抽奖。可选 `--with-benefits` 只读取中国大陆优惠券与活动到本地；护照主页目前不呈现这些结果。官方完整描述见 [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md)。

## 私有文件

- `private\mcp\tools.json`：允许的只读工具 schema。
- `private\mcp\connection.json`：`connect_mcp.py` 的实际初始化和工具发现结果。
- `runs\<本次运行标识>\*.result.json`、`order-detail-*.json`：按运行隔离的原始响应，可能含个人信息，不应公开；失败保留以前的响应。
- `footprints.normalized.json`：私有规范化订单，仍可能含原始订单引用。
- `global-candidates.json`：供本人导入的白名单候选，不含原始订单号、Token 或付款链接，仍属私人记录。
- `runs\<本次运行标识>\global-passport.html`：私有候选页；日常使用主页导入。
- `latest-sync.json`：上次完整成功的同步时间、响应目录与候选数量。候选 JSON 写入完成后原子替换，失败保留上次成功内容。

401 应检查凭据，403 应检查接入范围与网络限制，429 等待后再查。网络或 schema 错误会停止同步，不以虚构内容伪装成功。官方当前描述服务仅支持中国大陆接入，海外网络可能无法使用。

## 当前状态

2026-10-09 在 Windows 完成 `initialize`、初始化通知、`tools/list`、`now-time-info`、`order-list` 和 10 次 `query-order`。本次 10 条完成订单生成 10 条 `CN` 未确认候选，城市保持空缺。真实响应仅保存在私有目录，Token 未写入文件；未执行可选福利查询。详见 [运行验证](docs/VALIDATION.md)。
