---
name: mcd-world-passport
description: 以中国大陆麦当劳 MCP 的只读订单线索辅助本人确认，结合全球手动记录制作本地手账、旅行地图与国家地区印章。
---

# 麦麦世界护照 Skill

## 使用场景

用户要记录本人在世界各地到过的麦当劳、整理餐品与照片、收集国家 / 地区印章，或把中国大陆订单线索补成手账。产物为本地页面和 JSON 备份。

中国大陆 MCP 不提供全球订单或本人到店证明。海外记录从本人输入获取，不编造旅行、门店、餐品或联名活动。

## 手动记录

1. 完整项目目录双击 `启动.cmd`，使用 `http://127.0.0.1:8765/` 的空白真实手账。
2. 新增记录需有真实日历日期、有效 ISO 国家 / 地区代码、城市和门店名称。日期不能晚于当前本地日期。
3. 餐品、随手记、联名名称与照片来自本人输入。联名标记为本人确认，不是官方联名识别。
4. 本人确认确曾到店后，保存 `source: "manual"`、`confirmed: true`。只有这些记录计入打卡、印章和门店统计。
5. 可没有位置：文字记录仍计入印章。内置城市参考点不是门店位置；手填坐标标为 `precision: "user"`。
6. 完成后导出 JSON 备份。本项目没有云同步，浏览器空间不足或网站数据被清除时，需要备份恢复。

## 中国大陆 MCP 线索

仅在用户需要读取自己的官方订单时连接。凭据只从运行时 `MCD_MCP_TOKEN` 或本地交互式隐藏输入获取，不写入 Skill、源码、参数、日志或归档。

1. 连接 `https://mcp.mcd.cn`，完成 `initialize`、初始化通知与 `tools/list`。
2. 查看实际工具 schema，不能猜必填参数或订单字段含义。
3. 只读调用 `now-time-info`、`order-list`，根据本次列表的实际引用调用 `query-order`。
4. 默认入口为 `同步中国订单.cmd`，等效于 `py scripts\sync_footprints.py --prompt-token --order-offset +08:00`。无时区时间使用操作者明确指定的偏移。
5. 将 `private\mcp\global-candidates.json` 导入主页。完成订单仍是 `source: "mcp_candidate"`、`confirmed: false`，地区固定 `CN`；订单本身不计打卡。
6. 缺失城市保持缺失。本人确曾到店后补齐城市、核对门店与日期，转为 `source: "manual"`、`confirmed: true`、`origin: "mcp"`。
7. 外送、代他人下单或无法确认到访的线索不计入本人打卡。移除线索只修改手账。
8. 保留官方实际返回范围说明，不假设全年覆盖。接口失败或 schema 变化时停止并报告，不以虚构数据替代真实结果。

## 数据边界

归档：`{ "version": 1, "data_kind": "manual" | "mcp" | "synthetic", "entries": [...] }`，可含最多 1000 字符的 `source` 覆盖范围说明。

白名单记录字段为 `id`、`date`、`country_code`、`city`、`store`、`foods`、`note`、`source`、`confirmed`，以及可选 `origin`、`location`、`photo`、`collaboration`。候选使用本地派生引用，不保留原始订单号、Token、电话或支付链接。原始响应只留私有目录。

- `mcp_candidate` 和 `origin: "mcp"` 只允许 `CN`。其他地区必须本人手动填写。
- 候选不能直接设为已确认，确认时必须转为手动记录。
- 门店按国家 / 地区、规范化城市与门店名称去重，不声称全球官方 ID 核验。
- 最多 1000 条、每张处理后图片不超过 1.5 MiB、归档不超过 8 MiB；支持 JPEG、PNG、WebP。
- 相同 ID 的相同归档记录可去重，冲突拒绝导入，不覆盖原有内容。
- 虚构示例必须保留 `data_kind: "synthetic"`，不能混入个人手账或伪装真实到访。

## 输出

说明实际页面、候选数或本人确认数、查询覆盖范围及备份位置。不把订单数说成实际用餐次数，不把城市参考点说成门店定位，不宣称未执行的连接或 Windows 运行验证。

日常手账不要求 Python；MCP 读取和 HTML 重建需要 Python 3.10 或更新版本。详见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md)。
