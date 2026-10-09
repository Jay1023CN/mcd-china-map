# 麦当劳中国 MCP 官方工具目录

核实日期：**2026-10-09**。本次读取官方 README 并解析工具表，得到 **33 个工具**。公开文档最新版本日志为 **1.0.9（2026-09-10）**；本次读取的 README 最新提交日期为 **2026-10-01**。

来源：

- [麦当劳中国官方仓库与工具表](https://github.com/M-China/mcd-mcp-server#3-工具列表)
- [本次核对的固定版本 README：521150d](https://github.com/M-China/mcd-mcp-server/blob/521150dd82b7b1887e9d257800ee973ed56be0e5/README.md)
- [官方开放平台](https://open.mcd.cn/mcp)
- [官方接入说明](https://github.com/M-China/mcd-mcp-server#2-快速开始)
- [官方版本日志](https://github.com/M-China/mcd-mcp-server#4-版本日志)

下文工具名称与用途依据官方说明整理。“读取／计算／写入”描述的是业务作用。本项目于 2026-10-09 读取当前 `tools/list`，实际调用了 `now-time-info`、`order-list`、`query-order` 和 `query-nearby-stores`。运行时使用自己的 Token，并以官方返回的 schema 为参数依据。

## 接入与认证

| 项目 | 官方说明 |
|---|---|
| 服务地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 认证 | 请求头 `Authorization: Bearer YOUR_MCP_TOKEN` |
| Token 申请 | 在官方开放平台用手机号登录，进入控制台激活并同意相关协议。 |
| 限流 | 每个 Token 每分钟最多 600 次请求。 |
| 错误码 | `401`：Token 无效、过期或未提供；`429`：触发限流。 |
| 服务地区 | 中国大陆地区，不含港澳台。 |

Token 对应用户身份和权限；不能将真实 Token 写入仓库、公开网页或截图。公开文档未说明精细权限范围，本文不承诺跨账户查询、共享授权或任何特定字段一定可用。

## 33 个官方工具

### 餐品营养、地址与门店：6 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `list-nutrition-foods` | 获取常见餐品营养成分，包括能量、蛋白质、脂肪、碳水化合物、钠、钙等；用于营养咨询或指定热量搭配。 | 读取 |
| `delivery-query-addresses` | 查询用户已创建的配送地址列表，供外送点餐选择地址。 | 读取 |
| `delivery-create-address` | 用户没有可配送地址或需要新地址时，创建配送地址。 | 写入：新增地址 |
| `delivery-query-stores` | 外送场景查询收货地址附近可配送门店。 | 读取 |
| `query-meal-assistance` | 仅企业团餐场景，查询门店支持的助餐服务。 | 读取 |
| `query-nearby-stores` | 查询用户提供地址附近的麦当劳餐厅。 | 读取 |

### 门店菜单、核价与点餐订单：8 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `query-store-coupons` | 查询用户在当前门店下可使用的优惠券。 | 读取 |
| `query-meals` | 查询当前门店可售菜单，包括分类、餐品编码和标签等。 | 读取 |
| `query-meal-detail` | 按餐品编码查询详情、套餐组成及可替换选项。 | 读取 |
| `calculate-price` | 按选购商品和优惠券计算商品金额、配送费、优惠金额及应付总价。 | 计算：官方描述未说创建订单 |
| `create-order` | 按门店、就餐方式和商品创建订单，返回详情与支付链接。 | 写入：创建点餐订单 |
| `cancel-order` | 取消点餐订单。 | 写入：改变订单状态 |
| `query-order` | 查询订单状态、订单内容和配送信息等。 | 读取 |
| `order-list` | 查询近期到店／外送历史订单；不含商城订单。 | 读取 |

### 活动、优惠券、积分与时间：6 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `campaign-calendar` | 查询当月营销活动日历，含进行中、往期及未来日期活动。 | 读取 |
| `available-coupons` | 查询当前可领取的麦麦省优惠券。 | 读取 |
| `auto-bind-coupons` | 自动领取当前所有可领麦麦省券，无需指定具体券或 couponId。 | 写入：领取所有可领券 |
| `query-my-coupons` | 查询账户下已有可用优惠券。 | 读取 |
| `query-my-account` | 查询可用、累计、冻结、即将过期等积分账户信息。 | 读取 |
| `now-time-info` | 返回当前完整日期与时间，供模型核对时间。 | 读取 |

### 麦麦商城：5 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `mall-points-products` | 查询可用积分兑换或现金购买的商城商品，不包括积分兑换的第三方兑换码。 | 读取 |
| `mall-product-detail` | 查询商品图片、积分、有效期、说明和详情等。 | 读取 |
| `mall-create-order` | 用积分兑换虚拟或实物商品，完成积分校验、扣减及发券或实物库存扣减，返回兑换订单号和券码信息。 | 写入：兑换与扣减 |
| `mall-order-list` | 查询商城近一年购买或兑换的商品订单。 | 读取 |
| `mall-order-detail` | 查询商城订单详细信息，包括支付积分、金额及状态等。 | 读取 |

### 积分抽奖：3 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `query-lottery-info` | 查询积分抽奖活动状态、奖品、消耗规则和用户可用资源。 | 读取 |
| `draw-lottery` | 执行一次积分抽奖，消耗积分或次数，返回中奖与奖品信息。 | 写入：消耗积分或次数 |
| `query-my-prizes` | 分页查询用户中奖记录，按中奖时间倒序。 | 读取 |

### 主题活动预约：5 个

| 精确工具名称 | 官方用途 | 业务作用 |
|---|---|---|
| `query-party-city` | 查询主题活动商品可参与的城市。 | 读取 |
| `query-party-store` | 查询指定城市可参与主题活动的门店。 | 读取 |
| `query-partystore-date` | 查询指定门店可预约的活动日期。 | 读取 |
| `query-partystore-session` | 查询指定门店、日期可预约的场次。 | 读取 |
| `party-order-create` | 城市、门店、日期和场次选定后，创建主题活动订单。 | 写入：创建预约订单 |

总计：**25 个读取工具、1 个价格计算工具、7 个写入工具**。读取仍可能返回个人信息；“读取”只表示没有在官方描述中说明改变账户或订单。

## 本项目如何使用

中国订单同步调用 `now-time-info`、`order-list`、`query-order`，把实际返回的已完成订单转换为待确认线索。订单可能是外送或代他人点单，不直接产生本人到店记录；城市缺失时由本人补齐。港澳台地区由本人手动填写。

客户端允许六个只读工具，包含官方 query-nearby-stores 附近门店查询。`--with-benefits` 可额外读取 `available-coupons` 与 `campaign-calendar` 并保存在私人目录；主页面不展示这两项原始响应。查询可领券不等于已领取，活动日历不证明本人买过联名。

页面没有创建或取消订单、领取优惠券、积分兑换、抽奖、预约或代取授权功能。删除本地线索只改变本地手账。

## 参数与数据边界

本次观察到：`order-list`、`available-coupons`、`now-time-info` 无必填参数；`query-order` 必填 `orderId`；`campaign-calendar` 可选 `specifiedDate`（yyyy-MM-dd）。`query-nearby-stores` 的城市地标查询使用 `searchType: 2`、`city`、`keyword` 和 `beType`（1 为到店自取、5 为得来速）。运行时以 `tools/list` 当前返回的 schema 为准。

近期历史订单不等于全年完整历史。实际订单中文状态与公开数字枚举存在差异，转换模块只映射已经观察到的文本；无时区的订单时间须通过 `--order-offset +08:00` 显式解释。不推断退款、本人实际吃下的数量、门店坐标或联名购买。

官方 1.0.9 日志描述了取餐柜二维码，但工具表没有独立的代取授权或分享凭证接口；与本中国地图手账的到店确认无关。详细转换约定见 [MCP_INTEGRATION.md](../MCP_INTEGRATION.md)。
