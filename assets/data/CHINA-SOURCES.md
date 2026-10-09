# 中国地图与城市参考点

`china-provinces.json` 原始下载自 [DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) 的[全国分省 GeoJSON](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)，下载于 2026-10-09，保留原始几何和属性。包含 34 个省级地区与南海附属图形；显示完整中国分省轮廓及南海诸岛插图。地区选项与官方 MCP 接入范围分别处理。

`china-cities.json` 从 Natural Earth 1:50m Populated Places 固定版本中提取中国城市参考点，共 103 个；坐标与中文名称保留源字段，通过分省几何匹配省份代码。它们是城市参考位置，不是麦当劳门店坐标。

- [原始城市数据固定版本](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_populated_places.geojson)
- [Natural Earth 数据使用条款](https://www.naturalearthdata.com/about/terms-of-use/)：地图数据为公共领域。
- 原有第三方素材与字体许可见 `LICENSE-world.txt`、字体和图标目录中的许可文件。

地图不加载第三方瓦片、不上传使用者位置。官方附近门店工具返回名称、编码、地址等信息，目前未提供经纬度；选择门店后使用城市参考点或本人填写的坐标显示。
