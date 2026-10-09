/* Local, privacy-safe share card renderer. No network or storage access. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShareCard = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WIDTH = 1080;
  var HEIGHT = 1440;
  var MAX_PROVINCE_TAGS = 8;
  var MAX_CITY_TAGS = 10;
  var FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

  function count(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function cleanLabel(value, maximum) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function provinceName(code, options) {
    var names = options && options.provinceNames;
    var value;
    if (names instanceof Map) value = names.get(code) || names.get(Number(code));
    else if (names && typeof names === 'object') value = names[code];
    if (typeof value === 'string' && value.trim()) return cleanLabel(value, 24);
    var features = options && options.provinces && options.provinces.features;
    if (Array.isArray(features)) {
      var feature = features.find(function (item) {
        return item && item.properties && String(item.properties.adcode) === code;
      });
      if (feature && feature.properties && typeof feature.properties.name === 'string') {
        return cleanLabel(feature.properties.name, 24);
      }
    }
    return code;
  }

  function shareFacts(summary, options) {
    summary = summary && typeof summary === 'object' ? summary : {};
    options = options && typeof options === 'object' ? options : {};
    var provinceMap = new Map();
    (Array.isArray(summary.provinces) ? summary.provinces : []).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var code = String(item.province_code || '');
      if (!/^\d{6}$/.test(code)) return;
      var amount = count(item.count);
      if (!amount) return;
      provinceMap.set(code, (provinceMap.get(code) || 0) + amount);
    });
    var provinces = Array.from(provinceMap.entries()).map(function (pair) {
      return {code: pair[0], name: provinceName(pair[0], options), count: pair[1]};
    }).sort(function (a, b) { return b.count - a.count || a.code.localeCompare(b.code); });

    var includeCities = options.includeCities === true;
    var cities = [];
    if (includeCities && Array.isArray(summary.cities)) {
      var seenCities = new Set();
      summary.cities.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var city = cleanLabel(item.city, 18);
        if (!city || seenCities.has(city)) return;
        seenCities.add(city);
        cities.push({city: city, count: count(item.count)});
      });
      cities = cities.slice(0, MAX_CITY_TAGS);
    }

    var title = cleanLabel(options.title, 36) || '我的麦麦中国足迹';
    return {
      title: title,
      theme: options.theme === 'red' ? 'red' : 'paper',
      includeCities: includeCities,
      confirmedCount: count(summary.confirmedCount),
      distinctProvinces: count(summary.distinctProvinces),
      distinctCities: count(summary.distinctCities),
      distinctStores: count(summary.distinctStores),
      provinces: provinces,
      provinceTags: provinces.slice(0, MAX_PROVINCE_TAGS),
      cities: cities
    };
  }

  function geometryPath(ctx, geometry, project) {
    var polygons;
    if (!geometry) return false;
    if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
    else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates;
    else return false;
    var hasPoints = false;
    polygons.forEach(function (polygon) {
      polygon.forEach(function (ring) {
        ring.forEach(function (coordinate, index) {
          if (!Array.isArray(coordinate) || coordinate.length < 2) return;
          var point = project(Number(coordinate[0]), Number(coordinate[1]));
          if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
          if (index === 0) ctx.moveTo(point[0], point[1]);
          else ctx.lineTo(point[0], point[1]);
          hasPoints = true;
        });
        ctx.closePath();
      });
    });
    return hasPoints;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function waitForFonts() {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      return document.fonts.ready.catch(function () {});
    }
    return Promise.resolve();
  }

  async function render(summary, options) {
    options = options && typeof options === 'object' ? options : {};
    var facts = shareFacts(summary, options);
    var features = options.provinces && Array.isArray(options.provinces.features) ? options.provinces.features : [];
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw new Error('ShareCard.render requires a browser canvas');
    }
    await waitForFonts();
    var canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');

    var isRed = facts.theme === 'red';
    var palette = isRed ? {
      base: '#b93427', baseDark: '#98271f', paper: '#fff8e9', ink: '#fff8e9', muted: '#f1c5a7',
      line: '#e9a47d', visited: '#f2c849', idle: '#d98168', map: '#c44735', tag: '#a72f25', tagInk: '#fff8e9',
      gold: '#f2c849'
    } : {
      base: '#f3eddb', baseDark: '#e9dfc8', paper: '#fff9eb', ink: '#29231b', muted: '#806f58',
      line: '#d8c9ad', visited: '#dc442e', idle: '#e8dfc5', map: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840',
      gold: '#ecc74c'
    };
    ctx.fillStyle = palette.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = palette.baseDark;
    ctx.fillRect(38, 38, WIDTH - 76, HEIGHT - 76);
    ctx.fillStyle = isRed ? palette.base : palette.paper;
    ctx.fillRect(54, 54, WIDTH - 108, HEIGHT - 108);

    ctx.fillStyle = palette.gold;
    roundedRect(ctx, 94, 92, 255, 44, 5);
    ctx.fill();
    ctx.fillStyle = isRed ? palette.baseDark : '#4b3e2b';
    ctx.font = '700 18px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText('MY CHINA JOURNEY', 112, 114);
    ctx.fillStyle = palette.muted;
    ctx.font = '600 16px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText('CHINA · PERSONAL CHECK-INS', 986, 114);
    ctx.textAlign = 'left';

    ctx.fillStyle = palette.ink;
    ctx.font = '900 60px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(facts.title, 92, 220, 895);
    ctx.fillStyle = palette.muted;
    ctx.font = '400 24px ' + FONT;
    ctx.fillText('每一站，都是喜欢的味道。', 96, 270);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(96, 304);
    ctx.lineTo(984, 304);
    ctx.stroke();

    var metrics = [
      {value: facts.confirmedCount, label: '确认足迹'},
      {value: facts.distinctProvinces, label: '省份 / 地区'},
      {value: facts.distinctCities, label: '城市'},
      {value: facts.distinctStores, label: '门店'}
    ];
    var metricY = 336;
    var metricW = 207;
    metrics.forEach(function (metric, index) {
      var x = 96 + index * 222;
      ctx.fillStyle = isRed ? '#c34934' : '#f3e7ce';
      roundedRect(ctx, x, metricY, metricW, 139, 9);
      ctx.fill();
      ctx.fillStyle = isRed ? palette.gold : '#c43c2b';
      ctx.font = '700 52px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(String(metric.value), x + metricW / 2, metricY + 76);
      ctx.fillStyle = isRed ? palette.paper : palette.muted;
      ctx.font = '600 20px ' + FONT;
      ctx.fillText(metric.label, x + metricW / 2, metricY + 116);
    });
    ctx.textAlign = 'left';

    var mapBox = {x: 96, y: 520, w: 888, h: 555};
    ctx.fillStyle = isRed ? '#fff7e8' : '#f8f2e4';
    roundedRect(ctx, mapBox.x, mapBox.y, mapBox.w, mapBox.h, 12);
    ctx.fill();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    var visited = new Set(facts.provinces.map(function (province) { return province.code; }));
    var main = {x: mapBox.x + 32, y: mapBox.y + 35, w: mapBox.w - 68, h: mapBox.h - 78};
    var mainProject = function (lon, lat) {
      return [main.x + (lon - 72) / 64 * main.w, main.y + (55 - lat) / 38 * main.h];
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(main.x, main.y, main.w, main.h);
    ctx.clip();
    features.forEach(function (feature) {
      ctx.beginPath();
      if (!geometryPath(ctx, feature.geometry, mainProject)) return;
      var code = feature.properties ? String(feature.properties.adcode) : '';
      ctx.fillStyle = visited.has(code) ? palette.visited : palette.idle;
      ctx.strokeStyle = palette.paper;
      ctx.lineWidth = 1.15;
      ctx.fill('evenodd');
      ctx.stroke();
    });
    ctx.restore();

    // Keep the full source feature collection in use and show its southern
    // islands in a separate inset, as on the journal's main China map.
    var inset = {x: mapBox.x + mapBox.w - 184, y: mapBox.y + mapBox.h - 205, w: 146, h: 166};
    ctx.fillStyle = isRed ? '#fff9eb' : '#f4ead4';
    roundedRect(ctx, inset.x, inset.y, inset.w, inset.h, 5);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(inset.x + 5, inset.y + 5, inset.w - 10, inset.h - 10);
    ctx.clip();
    var seaProject = function (lon, lat) {
      return [inset.x + 5 + (lon - 105) / 20 * (inset.w - 10), inset.y + 5 + (25 - lat) / 24 * (inset.h - 10)];
    };
    features.forEach(function (feature) {
      ctx.beginPath();
      if (!geometryPath(ctx, feature.geometry, seaProject)) return;
      var code = feature.properties ? String(feature.properties.adcode) : '';
      ctx.fillStyle = visited.has(code) ? palette.visited : palette.idle;
      ctx.strokeStyle = '#a68e6c';
      ctx.lineWidth = .8;
      ctx.fill('evenodd');
      ctx.stroke();
    });
    ctx.restore();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, inset.x, inset.y, inset.w, inset.h, 5);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = '500 14px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#806f58';
    ctx.fillText('南海诸岛', inset.x + inset.w / 2, inset.y + inset.h - 12);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#806f58';
    ctx.font = '500 16px ' + FONT;
    ctx.fillText(facts.confirmedCount ? '点亮的省份与地区' : '中国地图，等你点亮第一站', mapBox.x + 28, mapBox.y + mapBox.h - 22);

    var tagY = 1122;
    ctx.fillStyle = palette.ink;
    ctx.font = '700 24px ' + FONT;
    ctx.fillText(facts.includeCities ? '走过的城市' : '已点亮的地方', 96, tagY);
    var tags = facts.includeCities ? facts.cities.map(function (city) { return city.city; }) : facts.provinceTags.map(function (province) { return province.name; });
    var omitted = facts.includeCities ? Math.max(0, facts.cities.length - MAX_CITY_TAGS) : Math.max(0, facts.provinces.length - MAX_PROVINCE_TAGS);
    if (facts.includeCities && Array.isArray(summary && summary.cities)) {
      omitted = Math.max(0, summary.cities.filter(function (item) { return item && typeof item.city === 'string' && item.city.trim(); }).length - facts.cities.length);
    }
    var tagX = 96;
    var rowY = tagY + 30;
    tags.forEach(function (tag) {
      ctx.font = '600 17px ' + FONT;
      var tagW = Math.ceil(ctx.measureText(tag).width) + 30;
      if (tagX + tagW > 980) { tagX = 96; rowY += 47; }
      ctx.fillStyle = palette.tag;
      roundedRect(ctx, tagX, rowY, tagW, 36, 18);
      ctx.fill();
      ctx.fillStyle = palette.tagInk;
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tagX + 15, rowY + 18);
      tagX += tagW + 10;
    });
    ctx.textBaseline = 'alphabetic';
    if (omitted > 0) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 16px ' + FONT;
      ctx.fillText('+' + omitted + ' 更多', Math.min(tagX, 925), rowY + 22);
    }

    if (!facts.confirmedCount) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 19px ' + FONT;
      ctx.fillText('从第一家麦当劳开始，慢慢画出自己的中国。', 96, 1325);
    } else if (facts.includeCities && !facts.cities.length) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 17px ' + FONT;
      ctx.fillText('城市名称尚未提供。', 96, 1325);
    }
    ctx.strokeStyle = palette.line;
    ctx.beginPath();
    ctx.moveTo(96, 1360);
    ctx.lineTo(984, 1360);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = '500 14px ' + FONT;
    ctx.fillText('麦麦中国地图', 96, 1390);
    ctx.textAlign = 'right';
    ctx.fillText('用麦当劳，画出中国足迹。', 984, 1390);
    ctx.textAlign = 'left';
    return canvas;
  }

  return Object.freeze({render: render, shareFacts: shareFacts, size: Object.freeze({width: WIDTH, height: HEIGHT}),
    limits: Object.freeze({provinceTags: MAX_PROVINCE_TAGS, cityTags: MAX_CITY_TAGS})});
});
