# 中国订单手账的读取顺序

1. 初始化 `https://mcp.mcd.cn` 并读取当前 `tools/list` schema。
2. `now-time-info` 记录查询时间，不代表订单的最后更新时间。
3. `order-list` 读取近期到店 / 外送历史，不代表全年或全球订单。
4. 对返回的真实 `orderId` 调用 `query-order`，补齐订单内容、门店及状态。
5. 规范化本次取得的中国大陆完成订单，去除原始订单号、联系方式、地址、支付链接。
6. 页面自动匹配城市、省份和默认照片，生成可编辑手账；用户可修改或删除，重复导入保留编辑与删除。

其他国家 / 地区由本人手动添加。地图使用城市参考点或用户坐标；订单自动整理是手账功能，不代表官方核验到店。联名标签由用户填写。

可选 `--with-benefits` 仅查询 `available-coupons`、`campaign-calendar`，原始响应保存至私人目录；不会领取优惠券，也不生成联名记录。

来源：https://github.com/M-China/mcd-mcp-server
