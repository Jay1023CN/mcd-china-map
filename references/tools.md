# 中国订单线索的读取顺序

1. 初始化 `https://mcp.mcd.cn` 并读取当前 `tools/list` schema。
2. `now-time-info` 记录查询时间，不代表订单的最后更新时间。
3. `order-list` 读取近期到店 / 外送历史，不代表全年或全球订单。
4. 对返回的真实 `orderId` 调用 `query-order`，补齐订单内容、门店及状态。
5. 规范化为中国大陆待确认线索，去除原始订单号、联系方式、地址、支付链接。
6. 本人在手账中补齐城市、核对日期并确认到店，才会计入地图、印章和打卡统计。

其他国家 / 地区由本人手动添加。不要猜门店位置、用外送订单推断本人到店，或自动认定联名购买。

可选 `--with-benefits` 仅查询 `available-coupons`、`campaign-calendar`，原始响应保存至私人目录；不会领取优惠券，也不生成联名记录。

来源：https://github.com/M-China/mcd-mcp-server
