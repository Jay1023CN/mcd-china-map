# 中国地图与城市参考点

`china-provinces.json` 原始下载自 [DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) 的[全国分省 GeoJSON](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)，下载于 2026-10-09，保留原始几何和属性。包含 34 个省级地区与南海附属图形；显示完整中国分省轮廓及南海诸岛插图。地区选项与官方 MCP 接入范围分别处理。

2026-10-10 重新下载源文件并按 JSON 对象逐项比对，本地几何和属性与该公开源完全一致。文件 SHA-256：`99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275`。地图与分享卡使用同一份几何，保留台湾、香港、澳门及 `100000_JD` 南海附属图形；分享卡移除可能造成越界错觉的椭圆装饰，并加强省界与南海附图的对比。未使用生成式图片重绘地图。

跨平台构建按完整解析数据校验：JSON 按键排序、保留 UTF-8 中文并使用紧凑分隔符后的 SHA-256 为 `2db51bf48312b8de2fce7ebbe4dcd95c532e91fcd645c2ffb4244d1bed7630b0`。该校验检查全部几何与属性，避免 Windows 的 CRLF 换行影响文件字节哈希。

`china-cities.json` 从 Natural Earth 1:50m Populated Places 固定版本中提取中国城市参考点，共 103 个；坐标与中文名称保留源字段，通过分省几何匹配省份代码。它们是城市参考位置，不是麦当劳门店坐标。

- [原始城市数据固定版本](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_populated_places.geojson)
- [Natural Earth 数据使用条款](https://www.naturalearthdata.com/about/terms-of-use/)：地图数据为公共领域。
- 原有第三方素材与字体许可见 `LICENSE-world.txt`、字体和图标目录中的许可文件。

地图不加载第三方瓦片、不上传使用者位置。官方附近门店工具返回名称、编码、地址等信息，目前未提供经纬度；选择门店后使用城市参考点或本人填写的坐标显示。
