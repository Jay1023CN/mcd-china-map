# 全国门店目录与来源校验

目标是让全国基础门店能实际检索、收藏与记录到访，并保留原有 28 家精选门店的照片和介绍。完整分页采集、地址坐标补齐、网页集成与公网验收分别记录；采集产物本身不等于功能已上线。

## 来源

- 中国大陆：[麦当劳官方餐厅信息公示](https://www.mcdonalds.com.cn/index/quality/deliveryinfo)。读取官方城市选择器与各城市分页，保留城市、门店名称和执照链接路径中的公共门店编号，不下载执照图片。
- 地址与坐标：[麦当劳官方找餐厅](https://www.mcdonalds.com.cn/top/map)使用的公共接口 `/ajaxs/search_by_keywords`、`/ajaxs/search_by_point`。不连接 MCP，不读取订单或 Token。
- 香港：[麦当劳香港官方餐厅列表](https://www.mcdonalds.com.hk/find-a-restaurant/)。当前快照有 269 个唯一 `rid`，与页面全部餐厅卡片编号一致。保留原文名称、地址、地区及官方原始坐标。
- 原有精选：`assets/data/store-directory.json` 与 `assets/data/STORE-SOURCES.md`。只在同城且名称/别名唯一吻合时标记基础库中的门店。无法唯一匹配时保留独立精选记录，不丢失图片，也不声称已与某个公示编号对应。
- 省份关联：复用项目已有 DataV 行政地图源的省级子图，仅提取地区名称和父省代码到 `national-store-localities.json`。雄安新区补充依据[中国雄安官网](https://www.xiongan.gov.cn/2023-02/27/c_129769131.htm)记为河北省。行政中心坐标不导出为门店位置。

澳门纳入 38 条公开分店资料：其中 6 条与旅游局许可按公开电话唯一对应，保留政府登记地址，并由官方场地访客页面补充找店位置，另 32 条来自公开商户目录。台湾纳入食药署 508 条和德昌餐饮场所登记（504 个不同地址），其中 211 条与官方招聘目录的分店名按完整地址严格对应。其余记录显示运营公司与原地址，不编造分店名。两地均保留 `coverage_complete:false`；登记没有营业状态，不能称为已确认当前营业的全部门店。

台湾名称对应保留登记来源和[官方招聘目录](https://hiring.mcdrecruitment.com.tw/list.php)来源。招聘网站直连被拒绝，385 条候选来自公开搜索索引；只规范全半角、空白、臺台与道路段数字，不忽略楼层或门牌。`match-taiwan-recruitment-addresses.py` 可离线复核 211 个对应，未匹配的招聘记录不自动算作新增物理门店。

## 2026-10-10 发现的采集边界

大陆不带城市过滤的第一页显示 845 页，但初版解析器在已采页面中读出 878、876、894、956 等不同末页数。已定位原因：部分官方分页 URL 路径混入旧页号，例如 `/deliveryinfo&page=161?city=北京市&page=68`，北京市真实末页数字标签是 68。扫描整个 HTML 的 `page=(数字)` 会把问号之前的旧路径数字误当末页。采集器已改为只读 `page-pagination` 中链接的数字标签，并加入回归测试。正式逐城快照已重新校验通过，旧解析结果仅保留为交叉检查依据。

地图接口的 `count` 是命中总数，不是实际响应条数。实测 `search_by_point` 返回 `count:103`，`data` 只有 10 条；关键词查询也出现 `count:100`、`data` 10 条。采集覆盖统计只数实际记录，不把这个总数当作已取得的门店。

公示来源没有地址。门店地址和坐标仅在同城、规范化名称唯一匹配时从地图接口补入。去除品牌前缀、括号、同城前缀和“餐厅/店”后可做确定匹配；不使用距离最近或任意模糊相似结果代替真实匹配。多个同城同名的公示编号不会擅自共享一个点位。

大陆官方页面直接将返回坐标传给腾讯 `TMap.LatLng`。腾讯官方[接口说明](https://github.com/TencentLBS/tencentmap-webservice-skill/blob/main/SKILL.md)声明其坐标系为 GCJ-02，目录保留 `coordinate_system:GCJ-02` 和 `precision:store`。香港原始坐标暂标记 `official_google_maps_unverified`，保留官方原值供概览展示；不转换或宣称已核实地图导航坐标系。地址导航始终使用店名与地址搜索。城市参考点没有加入全国目录的门店 `location`，没有点位的门店仍可检索收藏。

## 产物与恢复

- `scripts/sync_store_catalog.py`：快照校验、导入、官方编号去重、坐标地址匹配与原有精选合并。
- `assets/data/national-store-directory.json`：正式基础库，包含 `schema_version`、`generated_at`、`sources`、`coverage`、`stores`。正式文件只接受通过分页校验的大陆快照。
- `assets/data/official-store-locations.json`：已唯一对应的公开门店地址/点位快照；只在公示 ID、原名和城市均一致时复用。安装包无需私人缓存即可重建当前点位。
- `private/national-catalog/locator/*.json`：请求参数哈希命名的逐请求缓存。成功请求不重抓，失败请求下次恢复时继续尝试。
- `private/national-catalog/locator-progress.json`：查询进度和失败身份，不进入发布包。
- `private/national-catalog/coverage.json`：本次实际覆盖统计。
- `web/national-store-search.js`：原生 JavaScript 独立索引，支持城市、省份、多词、地址、别名、精选筛选、分页、明确编号定位和安全的收藏候选投影。

正式导入与补齐：

```powershell
py -3.13 scripts/sync_store_catalog.py --snapshot docs/growth-assets/national-store-research/official-city-publicity-snapshot.json --sync-locator
```

从已取得的关键词坐标采样官方附近门店，以补充官方店名：

```powershell
py -3.13 scripts/sync_store_catalog.py --snapshot docs/growth-assets/national-store-research/official-city-publicity-snapshot.json --sync-points
```

采样结果需要再次与公示身份对照；采样网格只是减少冗余请求，不能作为全国坐标覆盖完整的证明。

未通过校验的快照只允许写到 `private/`，用于提前获取公开地址线索：

```powershell
py -3.13 scripts/sync_store_catalog.py --staging --sync-locator --output private/national-catalog/provisional-directory.json
```

`--max-queries` 可限制一次补齐量，默认 0 为本次所有待匹配门店；`--workers` 上限 4，网络请求带重试和间隔。未来刷新可使用 `--collect-publicity`，它读取完整官方城市选择器、动态取各城页数、按日保存逐页缓存，并核对缺页、末页和重复响应；校验失败时拒绝输出正式库。

## 验证

```powershell
py -3.13 -m unittest discover -s tests -p test_sync_store_catalog.py
E:\nodejs\node.exe --test tests/national-store-search.test.cjs
```

校验检查实际分页集合、缺页、失败页、变化的页数、非末页条数、末页条数、重复响应、行总数和公示编号冲突。同名不同编号保留为不同门店，完全重复身份合并并记录出现次数。搜索测试检查 9,000 家分页、城市/省份/多关键词、重名歧义、简繁同店检索、没有坐标仍可收藏与公开字段投影。检索字形折叠来自 Apache-2.0 许可的 OpenCC `TSCharacters.txt`，固定提交 `8cf737a4e193db27d675b2ce9867d84aace33745`；仅生成搜索键，原文显示不变，许可随发布包保存。

`tests/browser-national-stores.cjs` 已在隔离的手机浏览器中通过：30 条分页、省份与城市筛选、旧城市参考表之外的石河子、普通门店详情与来源、收藏不增加到访、带真实点位打卡、缺点位文字打卡、编辑门店不沿用旧坐标、刷新和备份、香港简体品牌词、澳门科学馆与台湾台中学士简繁同店查询、台湾登记标识，以及原有 28 家精选仍保留。验收只使用公开资料和独立演示记录。CI 与 Pages 部署前均运行这套流程。

2026-10-10 本地回归：100 项 Node 测试、65 项 Python 测试通过；原有门店检索与照片流程、城市回忆册和月度小报浏览器回归通过。公网与发布包验收以本次发布记录为准。

官方关键词查询本日返回 `status:121` 和“此key每日调用量已达到上限”，已立即停止该批请求。已有成功缓存保留，额度错误不会作为“该店不存在”写入缓存。采集器检测非零业务状态会取消剩余任务并保存错误来源；不更换 key 或重复消耗失败请求。公共基础目录检索、详情与收藏不依赖该在线接口。

## 基础快照校验结果

正式大陆快照已重核通过：312 个官方城市选择项、1,028 / 1,028 页、8,448 条；失败页、分页变化和异常非末页条数均为 0。7,686 条有唯一公示编号，另 762 条用城市与完整店名的稳定哈希建立身份。两组同城同名不同公示编号保留独立记录，查询时不会任意选一家。香港另有 269 条。

基础目录还保留 12 条尚未与公示记录唯一关联的精选来源，所以目录记录总数不等于已证明互不重复的实际餐厅数。28 家精选的原图、简介和来源均保留。门店地址与坐标补齐量以每次 `coverage` 中的实际计数为准。


当前目录共 9,275 条记录；大陆 3,636 条有地址、3,628 条有门店点位，未补齐的地址/点位保持缺失。所有 312 个大陆公示城市已关联省份。目录总条数包含登记资料和 12 条未唯一合并的精选，不等同于互不重复的当前营业餐厅数。

离线重建使用包内公开快照（不发送网络请求）：

```powershell
py scripts/sync_store_catalog.py --cache private/new-empty-catalog-cache
py scripts/build_global_journal.py --output index.html
```

只有显式传入 `--collect-publicity`、`--sync-locator`、`--sync-points` 或 `--sync-localities` 才刷新相应公开来源。正式页面、手机版与 Windows 包使用同一份目录。


## v0.15.1 台湾补名与税籍证据

新增[财政部全國營業(稅籍)登記资料集](https://data.gov.tw/dataset/9400)，官方说明此表仅包含营业中税籍，每日更新。2026-10-10 正常下载官方 ZIP，SHA256 `237c2be0c01ed58d0ea1741d7b99d9f98af481aabbf3ce38eba17fd4fa14fd9d`，完整流式读取 1,713,975 行。按总机构统一编号 12411160、和德昌名称及任一餐馆业类筛出 409 条；总部与两条没有餐馆业类的分支排除，保留排除理由。不把税籍营业解释为当天开门、营业时间或品牌全店名册已完整。

143 条与既有 FDA 登记唯一对应。匹配只规范 NFKC、空白、臺台、道路段数字及县市/区后可选村里，保留完整道路、门牌和楼层；两边任一地址对应多个身份时不合并。现有 211 条招聘分店名不覆盖，其中新增 38 条来自税籍分支名称，合计 249 条可按分店名找。旧公司加地址名称保留为别名，全部 9,275 个现有 ID 和用户收藏引用保持原样；未对应不推断停业，也不重复加入 409 条凑门店数量。

`scripts/sync_taiwan_tax.py` 与 `assets/data/taiwan-operating-tax-registration.json` 提供复现与出处。Python 直接访问官方 ZIP 的证书链在本机未通过，使用 Windows 原生证书验证的 `Invoke-WebRequest` 成功下载，未关闭 TLS 校验。刷新命令：

```powershell
Invoke-WebRequest https://eip.fia.gov.tw/data/BGMOPEN1.zip -OutFile private/BGMOPEN1.zip
py scripts/sync_taiwan_tax.py --input-zip private/BGMOPEN1.zip
py scripts/sync_store_catalog.py
```

定向验证：6 项税籍来源/排除/完整地址歧义测试、11 项目录采集和身份测试、8 项目录搜索测试，以及手机新分店名/简体搜索、详情营业税籍出处、旧名别名、已有收藏编号和随记恢复流程。只有明确匹配的 143 条展示税籍营业来源，其余资料仍保留原状态。


## v0.15.1 澳门访客地址纠正

6 家既有门店与银河、新濠影汇、新濠天地、机场、澳大、金沙的官方场地访客页面交叉核对，快照 `macau-official-venue-cross-check.json` 留有原文、网页 SHA256、时间和匹配方法。前 3 条由页面公开电话唯一对应，另 3 条按既有唯一场地店名对应，不能一概称页面电话已核实。场地展示的营业时间作为该页面资料显示，不等于亲身或实时营业确认。

银河页面给访客的铺位是 G017，许可登记 G35 是另一类地址证据。导航优先使用访客地址，详情同时保留许可原址与来源，不把许可网站更新时间认定为迁址日期，不因此拆成两个店。澳大访客页只写 S1，保留原目录中 G016/G017/G018 的更详地址。目录总数和既有 ID 均不变。
