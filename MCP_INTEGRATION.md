# MCP 接入说明

麦麦中国地图使用官方中国大陆服务 `https://mcp.mcd.cn`，传输为 Streamable HTTP，以 `Authorization: Bearer` 鉴权。Token 从运行时环境变量 `MCD_MCP_TOKEN` 或终端隐藏输入获取，不写入源码、日志、页面或归档。示例配置仅包含环境变量占位符。

## 门店查询

`启动门店查询.cmd` 启动 Python 本机服务。网页输入城市、地标和取餐方式，同源 POST `/api/stores`，后端完成 initialize、初始化通知、tools/list，并按当前 query-nearby-stores schema 查询。参数为 searchType=2、city、keyword、beType=1（到店自取）或 5（得来速）。

返回名称、门店编码、地址、营业状态、时间等信息。选择门店会填写打卡表单，归档可保留 store_reference（来源 mcp_nearby、编码、地址）。编辑城市、门店或省份后清除旧引用。查询不下单、不预约，也不直接形成已确认足迹。

服务只绑定 127.0.0.1，验证固定 Host 和同源 Origin，不返回 Token。仅开放只读门店查询；页面手账仍保存在浏览器，不发送照片给后端。官方当前工具没有返回经纬度，地图使用城市参考点或本人提供的坐标。

## 历史订单

`同步中国订单.cmd` 调用 now-time-info、order-list，并对本次列表引用调用 query-order；显式 --order-offset +08:00 解释无时区时间。生成未确认中国大陆候选，导入后由本人补齐省份、城市并确认到店。

私有响应按运行存入 private/mcp/runs。候选文件 private/mcp/global-candidates.json 完整生成后原子替换；同步失败保留以前的响应和成功结果。订单编号、支付链接和 Token 不进入候选归档或公开演示。

客户端允许六个只读工具：query-nearby-stores、now-time-info、order-list、query-order、available-coupons、campaign-calendar。后两项只在显式可选福利查询时读取，当前页面不展示福利面板。

## 实际验证

2026-10-09 已完成真实初始化、工具发现和订单联调：本次返回 10 条完成订单及详情，转换为 10 条未确认候选。新增门店查询使用上海、人民广场、到店自取，实际返回 5 家门店。公开测试使用独立浏览器与虚构夹具。

官方服务范围为中国大陆，不含港澳台；附近查询不是全国完整门店目录，近期订单不是全年完整历史。用户本人手动填写其他地区手账。详细测试记录见 [VALIDATION.md](docs/VALIDATION.md)。
