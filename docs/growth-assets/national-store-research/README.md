# 全国门店库来源与完整性核查

用户要求补齐全国麦当劳门店，保留原 28 家特色店为精选内容。手动填店和缩小宣传范围不能代替门店库建设。本目录是公开来源研究和采集快照，不表示数据已经接入或部署。

## 大陆官方公示

来源：[麦当劳官方餐厅信息公示](https://www.mcdonalds.com.cn/index/quality/deliveryinfo)。使用页面原有城市筛选参数 `data[Search][city]`（Search 大写）与 `page`，不请求营业执照图片。

- `collect-official-publicity.py`：第一轮全部城市分页采集，共 845 页、8,447 行，city+name 去重 8,403，覆盖 309 城。与逐城结果相比存在重复及缺失，用于交叉比对，不能优先作为主表。
- `collect-official-by-city.py`：读取官方城市选择器的全部 312 个城市，逐城采完 1,028 页、8,448 行；每行城市匹配、缺页、失败、逐页行数和分页变化检查均通过。结果在 `official-city-publicity-snapshot.json`，`full_disclosure_pagination_collected=true`。
- 临时逐页缓存分别在 `%TEMP%/mcd-official-publicity-20261010` 和 `%TEMP%/mcd-official-city-publicity-20261010`，不进入 Git。记录含抓取时间和页面 SHA256。

官方公示字段是城市、名称、公示 ID 与来源页；没有公开地址坐标。`/license/<数字>/` 提取为公示 ID，不假定等同 MCP storeCode。没有唯一 ID 的行保留原 ID 数组，不能按同名无条件合并。

分页解析曾误把链接路径中的旧 `page` 参数混入总页数，例如北京页 16 的链接路径夹带 `page=161`，实际分页按钮末页为 68。已修正为只取分页导航中锚点的可见数字，并重新请求核对 46 个受影响页面，重导两个报告。大陆所谓 956 页是误读路径参数；超范围页的响应不能证明有 956 页。采集器错误已纠正，不归因于官方目录扩大或缓存版本变化。

逐城主表比全城市视图多 43 个 city+name，原全城市视图的独有记录为 0；补出的城市包括伊春、抚州、榆林。详细差异与快照 SHA256 在 `cross-check-report.json`。逐城主表中 7,686 行有唯一公示 ID，762 行没有唯一 ID；所有已取得的唯一公示 ID 均不重复。哈尔滨金太阳（3230027／3230027001）、柳州地王（3570059／3570272）各有两条不同官方 ID 的同名记录，保持独立，不能按同名丢掉一条。

## 大陆官方地图

来源：[官方找餐厅页面](https://www.mcdonalds.com.cn/top/map)内调用的公开查询：POST `/ajaxs/search_by_point`，参数 `point=纬度,经度`、`type`。上海中心点已实测，数据有官方 id、title、address、city、province、district、adcode、location、tel 与设施标签。

重要：响应 `count=103` 不等于返回了 103 条。开发续对话独立核查实际 `data` 只有 10 条，分页参数尚未找到有效支持。城市点查询不能作为全量门店来源；需和公示清单逐条比对、断点补齐。没有核实的坐标保持缺失，不用城市中心冒充门店位置。

## 香港官方目录

来源：[香港官方餐厅地址](https://www.mcdonalds.com.hk/find-a-restaurant/)。`collect-hong-kong.py` 仅解析该页面内嵌公开的 restaurants 数组，结果为 `hong-kong-official-snapshot.json`。

已取得 269 条、269 个唯一 rid，与页面 269 张门店卡片的 ID 集合一致。有地址、经纬度、电话、设施与营业时间。坐标原样保存，页面使用 Google Maps，未独立确认坐标系。原 city 中有机场禁区说明，规范化时不要丢失该信息。

官网[甜品站地址 FAQ](https://www.mcdonalds.com.hk/faqs/about-dessert-kiosk/dessert-kiosk-address)另链接 `https://mcds.hk/dkaddresslist`，正常跳转到官方活动页面；该页的 `dk.js` 明确读取 [甜品站地址 JSON](https://campaign.mcdonalds.com.hk/dk-store/dk-store-list.json?v=20260630)。`collect-hong-kong-dessert-stations.py` 已完整收集 101 条、101 个不同地址（香港岛 10／九龙 35／新界 54／离岛 2），保存于 `hong-kong-official-dessert-station-snapshot.json`。仅做 NFKC 和空白规范的完整地址唯一匹配，41 条对应已有餐厅 rid，60 条父餐厅身份待核对；楼层、门牌或表述差异不能当作新增独立门店证据。现有餐厅目录中只有 50 条 `dessertkiosks` 设施标记，此单独的品牌来源可用于补充服务点信息，但不能把 101 条直接加到餐厅总数。全量目标包含核对这些公开服务地址，不以排除它们代替完成覆盖。

## 台湾与澳门

台湾[官方找餐厅](https://www.mcdonalds.com/tw/zh-tw/restaurant-locator.html)及官方客服站直连返回 403，未取得品牌全店名册。但已取得食药署[食品业者登记资料集](https://data.gov.tw/dataset/8938)原始公开 CSV ZIP，完整读取 828,316 行，筛选统一编号 12411160：1,004 条中有餐饮场所 508 条、销售场所 495 条、公司登记 1 条。纯餐饮场所保存在 `taiwan-food-restaurant-registration.json`：508 个不同登记号，504 个不同地址；4 组重复地址保留供导入时核对。公司办公室与销售场所不进入餐厅表。可复现脚本为 `collect-taiwan-food-registration.py`，原始 ZIP SHA256 `9d096491c8891e66dffb8f37ba5dc89a488213f4f09e4d5928b16f9d1524012b`。

运营公司与品牌的关系由[麦当劳官网隐私政策](https://www.mcdonalds.com/tw/zh-tw/privacy-policy.html)确认，统一编号由[政府公司登记](https://findbiz.nat.gov.tw/fts/company/12411160)确认。登记数据没有品牌分店名称、坐标或营业状态，不能称为 508 家当前营业门店；公司名称加地址仅可作为有明确出处的餐饮登记记录，后续继续与品牌目录核对。全量政府登记读取完成不等于全量当前品牌门店已验证。

另从[官方招聘门店表](https://hiring.mcdrecruitment.com.tw/list.php)的公开搜索索引取得 385 条不同分店名／地址，合并快照为 `taiwan-official-recruitment-combined-snapshot.json`。原网站普通直连和真实浏览器返回 403，未绕过限制，也未提交求职表；搜索快照不是直播完整列表。与政府餐饮登记按完整地址精确匹配（只规范全半角、空白、臺台及道路段数字，不删楼层、门牌）得到 211 条登记号对应品牌分店名，结果在 `taiwan-recruitment-address-matches.json`。未匹配的招聘地址不可直接算作新增独立物理门店。

澳门旅游局许可名录已取得 6 条酒店内门店，白名单记录在 `macau-tourism-license-partial.json`，`coverage_complete=false`。旅游局[光影节公开参与商户 JSON](https://lum.macaotourism.gov.mo/data/stores.json)共 211 条，筛出海景、金融中心、建兴龙 3 家，保存在 `macau-government-event-stores.json`；这是 2025 活动资料，不能保证当前营业或全部门店。旅游局许可来源也不代表全部市政许可餐厅。

澳门[黄页公司介绍分店表](https://www.yp.mo/business/%E6%BE%B3%E9%96%80%E9%BA%A5%E7%95%B6%E5%8B%9E%E9%A4%90%E5%BB%B3.html)已实际解析 38 个分店名、地址和 38 个不同电话，保存在 `macau-directory-cross-check.json`。其中 6 个电话与旅游局许可一对一吻合，附带官方 ID 与许可登记地址。许可网站的更新时间不证明地址刚更新：银河许可地址 G35 在历史资料中已存在，而[银河度假城当前访客页面](https://www.galaxymacau.com/zh-hant/dining/restaurants/mcdonald/)仍列时尚大道东 G017、同一电话 28827110。登记地址和访客位置须分别保留，不能凭差异判为迁店或第二家店；找店优先采用场地运营方的访客位置并展示来源。伦敦人目录的 1029 与许可 L2 也需按场地访客来源继续核对。该公开商户目录可以补充基础查询，但不冒充品牌官方全量名单或已核实营业状态；公司办公室不算分店。

`collect-macau-venues.py` 完整跑通 6 个场地运营方公开访客页面，结果为 `macau-official-venue-cross-check.json`。银河、新濠影汇、新濠天地的页面公开电话与既有目录唯一对应；机场、澳门大学、金沙通过既有唯一场地分店和官网具名条目核对，页面未展示门店电话，不伪称电话交叉验证。每条保留来源、抓取日期、响应 SHA256、访客位置、已公布营业时间及原目录／许可地址（若有）。澳门大学当前商户时间表更新于 2026-09-25。6 条补充事实不新增门店；网站列有营业时间也不等于实地确认正在营业。

`collect-macau-directory.py` 可复现黄页分店表和旅游局活动 JSON 的采集，按已保存的旅游局许可电话精确交叉核对。地图社区点位不混入此脚本输出。

已追到市政署当前[公开餐饮许可查询](https://app.iam.gov.mo/LFBPriceEnquiry/spring/main?lang=cn)，入口来自[市政署服务目录 JSON](https://www.iam.gov.mo/data/onestopservice_c.json)。`collect-macau-iam-licenses.py` 用普通匿名会话完整读取名称“麥當勞”、三个地区勾选后的 31 条结果、4 页，保存在 `macau-iam-license-snapshot.json`；未保存 Cookie、ViewState 或其他商户资料。IAM 页面不列电话或许可号，行号仅是快照内证据位置，不用来生成门店 ID。查完本次同名结果不等于品牌全澳门覆盖已完成。

`reconcile-macau-iam.py` 生成 [31↔38逐行完整地址交叉表](macau-iam-directory-crosswalk.md) 和同名 JSON。5 条完整地址对应、5 条独立活动电话及地址对应，可以附加 IAM 许可来源；15 条地址候选、5 条地址冲突继续核对，不做模糊自动合并。8 条既有目录不在本次 IAM 同名查询中，其中 6 条已有旅游局独立许可，科技大学和葡京人仍查场地来源。新城市的第二座/第二十一座、湖景776/766及不同楼层单元等差异都保留，不能覆盖原地址或当作额外新店。

发现现有目录缺少“利新”分店：IAM 公开许可列高美士街124-126号利新大厦地下及阁楼A；[2026新口岸消费节商户页](https://file.findmacau.com/app/findmacau_h5/newfindings/macau-zape-fest-2026.html) 的 JS 实际读取匿名商户搜索接口，直播结果具名“利新麥當勞餐廳”、电话28373930、同门牌/大厦/地下A。`collect-macau-event-merchants.py` 可复现页面→JS→查询，`macau-event-merchant-snapshot.json` 有6条，其中5电话与旧目录唯一对应、1条利新新增证据。活动合作平台来源和政府许可分别注明，未冒充品牌名单；坐标原值虽有保存，但坐标系未核实，不直接用于导航。许可/活动条目不是实地确认正在营业；新增店的集成、旧ID兼容和手机验收由续开发处理。

澳门 OpenStreetMap 公开范围查询取得 36 个点，保存在 `macau-osm-research-leads.json`，其中仅 2 个点的电话与目录精确吻合，当前仅用于查缺和比对线索，尚未集成。其社区来源、坐标系与 ODbL 许可必须与政府／品牌目录分别处理，不能当作官方完整名册。继续补足澳门覆盖及台湾品牌分店名，不用猜测记录凑数量。

## 交付与职责

来源采集由原宣发／用户反馈对话负责；全国门店库续开发对话 `01a12452-df7f-7b31-996b-67c9f0abfcd1` 负责导入、检索、地址坐标策略和集成验收。所有内容均来自公开页面，不含用户私人订单、Token、私人照片或私人地址。

验收要落实为：官方清单缺页与差异已处理、去重键可解释、每条资料有来源与日期、城市和门店可在手机查到、详情可收藏及打卡、缺失坐标不会伪造。素材制作和宣称全量完成要以实际交付结果为准。

葡京人另有单独公开访客证据：`collect-macau-lisboeta.py` 与 `macau-lisboeta-venue-snapshot.json` 读取页面明确链接的公开 WordPress JSON。电话28870082唯一对应旧店，位置H853娱乐小镇1楼F07、页面公布10:00–20:00；2025-11-26修改日期不代表今天实地营业。不新增门店，保留原溜冰路128号详细地址。
