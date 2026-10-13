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
  var FONT = '"LXGW WenKai", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  var TITLE_FONT = FONT;

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
      theme: options.theme === 'collage' ? 'collage' : options.theme === 'red' ? 'red' : 'paper',
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

  function handLine(ctx, x1, y1, x2, y2, color, width) {
    var bend = (x2 - x1) * .34;
    ctx.strokeStyle = color; ctx.lineWidth = width || 2;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + bend, y1 + 2); ctx.lineTo(x1 + bend * 2, y2 - 1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawPaper(ctx, paper) {
    ctx.fillStyle = paper; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(116, 91, 54, .035)';
    for (var i = 0; i < 24; i++) ctx.fillRect(74 + (i * 173) % 914, 76 + (i * 223) % 1268, 2, 2);
  }

  function drawTornSheet(ctx, x, y, width, height, fill, seed) {
    var points = [], step = 24, phase = seed || 0;
    for (var px = x; px < x + width; px += step) points.push([px, y + Math.sin((px + phase) * .19) * 3]);
    for (var py = y; py < y + height; py += step) points.push([x + width + Math.sin((py + phase) * .17) * 3, py]);
    for (var px = x + width; px > x; px -= step) points.push([px, y + height + Math.sin((px + phase) * .21) * 3]);
    for (var py = y + height; py > y; py -= step) points.push([x + Math.sin((py + phase) * .15) * 3, py]);
    ctx.beginPath(); points.forEach(function (point, index) { if (index === 0) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]); }); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }

  function drawTape(ctx, x, y, width, angle, fill) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = .86;
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(width, 0); ctx.lineTo(width - 4, 31); ctx.lineTo(3, 34); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .2; ctx.strokeStyle = '#fffdf4'; ctx.lineWidth = 2;
    for (var i = 12; i < width; i += 18) { ctx.beginPath(); ctx.moveTo(i, 6); ctx.lineTo(i - 1, 29); ctx.stroke(); }
    ctx.restore();
  }

  function drawCollageBackdrop(ctx, palette) {
    ctx.fillStyle = '#e8dcc7'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save(); ctx.shadowColor = 'rgba(75,54,30,.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    drawTornSheet(ctx, 35, 28, 1010, 1380, palette.paper, 23); ctx.restore();
    drawTornSheet(ctx, 852, 34, 185, 248, '#f2e2c7', 47);
    ctx.fillStyle = 'rgba(112,83,48,.035)';
    for (var fiber = 0; fiber < 1100; fiber++) ctx.fillRect(40 + (fiber * 137) % 997, 35 + (fiber * 211) % 1339, fiber % 4 === 0 ? 2 : 1, 1);
    ctx.save(); ctx.translate(943, 139); ctx.rotate(-.08); ctx.fillStyle = '#514638'; ctx.font = '600 17px ' + FONT; ctx.textAlign = 'center';
    ['GOOD','FOOD','GOOD','JOURNEY'].forEach(function (line, index) { ctx.fillText(line, 0, index * 24); }); ctx.restore();
    ctx.save(); ctx.shadowColor = 'rgba(75,54,30,.11)'; ctx.shadowBlur = 13; ctx.shadowOffsetY = 5;
    drawTornSheet(ctx, 46, 351, 988, 565, '#fffdf5', 64); ctx.restore();
    drawTape(ctx, 818, 319, 124, .07, '#d85a45');
    ctx.save(); ctx.fillStyle = '#d64a32'; ctx.font = '32px ' + FONT; ctx.fillText('♥', 1012, 1188); ctx.restore();
    drawTornSheet(ctx, 42, 1380, 994, 60, '#bd302b', 8);
  }

  function titleLines(text) {
    var chars = Array.from(text);
    var split = Math.ceil(chars.length / 2);
    for (var i = Math.max(1, split - 4); i <= Math.min(chars.length - 1, split + 4); i++) {
      if (/[，。！？、；：,.!?;:\s]/.test(chars[i - 1])) { split = i; break; }
    }
    return [chars.slice(0, split).join('').trim(), chars.slice(split).join('').trim()];
  }

  function drawFittedTitle(ctx, text, x, y, maxWidth, baseSize, minSize, color, accent) {
    var lines = titleLines(text);
    var size = baseSize;
    function setFont() { ctx.font = '400 ' + size + 'px ' + TITLE_FONT; }
    setFont();
    while (size > minSize && lines.some(function (line) { return ctx.measureText(line).width > maxWidth; })) {
      size -= 1;
      setFont();
    }
    ctx.fillStyle = color;
    ctx.fillText(lines[0], x, y);
    ctx.fillStyle = accent;
    ctx.fillText(lines[1], x + 8, y + 82);
    handLine(ctx, x + 8, y + 98, x + 8 + Math.min(maxWidth, ctx.measureText(lines[1]).width + 12), y + 96, accent, 3);
    return {lines: lines, size: size};
  }

  function waitForFonts() {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      var load = typeof document.fonts.load === 'function' ? document.fonts.load('400 48px "LXGW WenKai"') : Promise.resolve();
      return Promise.resolve(load).then(function () { return document.fonts.ready; }).catch(function () {});
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
    var isCollage = facts.theme === 'collage';
    var palette = {
      paper: isRed ? '#fff8ee' : '#fff9ed', ink: '#29231b', muted: '#756752',
      visited: isRed ? '#c83c32' : '#d64a32', idle: isRed ? '#e6d8c3' : '#e9dfc9',
      gold: isRed ? '#dc5945' : '#edbd36', accent: isRed ? '#c83c32' : '#d64a32',
      blue: '#69b8c2', sea: isRed ? '#f5e7dd' : '#f1eadc'
    };
    drawPaper(ctx, palette.paper);
    if (isCollage) drawCollageBackdrop(ctx, palette);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.ink; ctx.font = '400 26px ' + FONT;
    ctx.fillText('麦麦中国地图', 62, 76);
    handLine(ctx, 62, 96, 276, 93, isRed ? palette.accent : palette.gold, 4);
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 2.5;
    var stampX = isCollage ? 943 : 900;
    ctx.beginPath(); ctx.ellipse(stampX, 68, isCollage ? 82 : 128, 30, -.025, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center';
    var stampText = facts.confirmedCount ? '已走过 · ' + facts.confirmedCount + ' 站' : '想去 · 尚未打卡';
    var stampSize = 24;
    ctx.font = '400 ' + stampSize + 'px ' + FONT;
    while (stampSize > 16 && ctx.measureText(stampText).width > (isCollage ? 146 : 210)) {
      stampSize -= 1; ctx.font = '400 ' + stampSize + 'px ' + FONT;
    }
    ctx.fillText(stampText, stampX, 76, isCollage ? 146 : 210);
    ctx.textAlign = 'left';

    drawFittedTitle(ctx, facts.title, 74, 194, isCollage ? 730 : 930, isCollage ? 72 : 64, 34, palette.ink, palette.accent);

    // The map is drawn directly on the paper, without a panel or route lines.
    var mapBox = {x: 64, y: 365, w: 952, h: 540};
    var visited = new Set(facts.provinces.map(function (province) { return province.code; }));
    var main = {x: mapBox.x + 15, y: mapBox.y + 20, w: mapBox.w - 30, h: mapBox.h - 38};
    var mainProject = function (lon, lat) {
      return [main.x + (lon - 72) / 64 * main.w, main.y + (55 - lat) / 38 * main.h];
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(main.x, main.y, main.w, main.h); ctx.clip();
    features.forEach(function (feature) {
      ctx.beginPath();
      if (!geometryPath(ctx, feature.geometry, mainProject)) return;
      var code = feature.properties ? String(feature.properties.adcode) : '';
      ctx.fillStyle = visited.has(code) ? palette.visited : palette.idle;
      ctx.strokeStyle = '#b9aa8e'; ctx.lineWidth = 1.15;
      if (code === '100000_JD') { ctx.fillStyle = '#9b896b'; ctx.strokeStyle = '#9b896b'; }
      ctx.fill('evenodd'); ctx.stroke();
    });
    ctx.restore();

    // Keep the source geometry's South China Sea islands visible as a small
    // map inset, with a light hand-drawn edge rather than a framed section.
    var inset = {x: 876, y: 746, w: 132, h: 142};
    ctx.fillStyle = palette.paper;
    roundedRect(ctx, inset.x, inset.y, inset.w, inset.h, 18); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.rect(inset.x + 5, inset.y + 5, inset.w - 10, inset.h - 10); ctx.clip();
    var seaProject = function (lon, lat) {
      return [inset.x + 5 + (lon - 105) / 20 * (inset.w - 10), inset.y + 5 + (25 - lat) / 24 * (inset.h - 10)];
    };
    features.forEach(function (feature) {
      ctx.beginPath();
      if (!geometryPath(ctx, feature.geometry, seaProject)) return;
      var code = feature.properties ? String(feature.properties.adcode) : '';
      ctx.fillStyle = visited.has(code) ? palette.visited : palette.idle;
      ctx.strokeStyle = '#baa98b'; ctx.lineWidth = .8;
      if (code === '100000_JD') { ctx.fillStyle = '#8e7d60'; ctx.strokeStyle = '#8e7d60'; }
      ctx.fill('evenodd'); ctx.stroke();
    });
    ctx.restore();
    ctx.strokeStyle = isRed ? '#d68d77' : '#d5c6aa'; ctx.lineWidth = 1.5;
    roundedRect(ctx, inset.x, inset.y, inset.w, inset.h, 18); ctx.stroke();
    ctx.fillStyle = palette.muted; ctx.font = '400 15px ' + FONT; ctx.textAlign = 'center';
    ctx.fillText('南海诸岛', inset.x + inset.w / 2, inset.y + inset.h - 10); ctx.textAlign = 'left';

    // A small map-side note acts as the legend and names the actual state.
    ctx.fillStyle = palette.ink; ctx.font = '400 22px ' + FONT;
    ctx.fillText(facts.confirmedCount ? '走过的地方' : '中国地图，等你点亮第一站', 78, 943);
    ctx.fillStyle = palette.visited; ctx.beginPath(); ctx.arc(332, 936, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.muted; ctx.font = '400 17px ' + FONT; ctx.fillText('已到访', 347, 942);
    ctx.fillStyle = palette.idle; ctx.beginPath(); ctx.arc(429, 936, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.muted; ctx.fillText('尚未到访', 444, 942);
    ctx.strokeStyle = palette.blue; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(76, 966); ctx.quadraticCurveTo(180, 976, 288, 962); ctx.stroke();
    if (facts.provinces.length) {
      var provinceNote = facts.provinces.slice(0, 3).map(function (province) { return province.name; }).join(' · ');
      if (facts.provinces.length > 3) provinceNote += ' 等 ' + facts.provinces.length + ' 个省份／地区';
      ctx.fillStyle = palette.muted; ctx.font = '400 18px ' + FONT;
      ctx.fillText('点亮：' + provinceNote, 78, 987);
    }

    // Facts sit as handwritten margin notes, not four boxed metric cards.
    var metrics = [
      {value: facts.confirmedCount, label: '确认足迹'},
      {value: facts.distinctProvinces, label: '省份 / 地区'},
      {value: facts.distinctCities, label: '城市'},
      {value: facts.distinctStores, label: '门店'}
    ];
    var metricXs = [78, 300, 520, 730];
    metrics.forEach(function (metric, index) {
      var x = metricXs[index];
      ctx.fillStyle = index === 0 ? palette.visited : palette.ink;
      ctx.font = '400 40px ' + FONT; ctx.fillText(String(metric.value), x, 1043);
      ctx.fillStyle = palette.muted; ctx.font = '400 18px ' + FONT; ctx.fillText(metric.label, x, 1072);
      handLine(ctx, x, 1084, x + 116, 1082, index === 1 ? palette.blue : palette.gold, 3);
    });

    var tagY = 1144;
    ctx.fillStyle = palette.ink; ctx.font = '400 27px ' + FONT;
    ctx.fillText(facts.includeCities ? '走过的城市' : '点亮的省份与地区', 76, tagY);
    var tags = facts.includeCities ? facts.cities.map(function (city) { return city.city; }) : facts.provinceTags.map(function (province) { return province.name; });
    var omitted = facts.includeCities ? 0 : Math.max(0, facts.provinces.length - MAX_PROVINCE_TAGS);
    if (facts.includeCities && Array.isArray(summary && summary.cities)) {
      var uniqueCityCount = new Set(summary.cities.map(function (item) {
        return item && typeof item.city === 'string' ? cleanLabel(item.city, 18) : '';
      }).filter(Boolean)).size;
      omitted = Math.max(0, uniqueCityCount - facts.cities.length);
    }
    var tagX = 78;
    var rowY = tagY + 40;
    tags.forEach(function (tag, index) {
      ctx.font = '400 18px ' + FONT;
      var tagW = Math.ceil(ctx.measureText(tag).width) + 20;
      if (tagX + tagW > 1000) { tagX = 78; rowY += 39; }
      ctx.fillStyle = index % 3 === 0 ? palette.visited : palette.ink;
      ctx.textBaseline = 'middle'; ctx.fillText(tag, tagX, rowY);
      handLine(ctx, tagX, rowY + 14, tagX + tagW - 9, rowY + 13, index % 2 ? palette.blue : palette.gold, 2.5);
      tagX += tagW + 22;
    });
    ctx.textBaseline = 'alphabetic';
    if (omitted > 0) {
      ctx.fillStyle = palette.muted; ctx.font = '400 17px ' + FONT;
      ctx.fillText('还有 ' + omitted + ' 个地方', Math.min(tagX, 740), rowY + 27);
    }
    if (tags.length) {
      ctx.strokeStyle = palette.blue; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(Math.min(tagX - 22, 720), rowY + 22);
      ctx.quadraticCurveTo(575, Math.max(rowY + 105, 1288), 823, 1288); ctx.stroke();
    }

    if (!facts.confirmedCount) {
      ctx.fillStyle = palette.ink; ctx.font = '400 24px ' + FONT;
      ctx.fillText('从第一家麦当劳开始，慢慢画出自己的中国。', 78, 1324);
      handLine(ctx, 78, 1340, 657, 1337, palette.blue, 3);
    } else if (facts.includeCities && !facts.cities.length) {
      ctx.fillStyle = palette.muted; ctx.font = '400 18px ' + FONT;
      ctx.fillText('城市名称尚未提供。', 78, 1324);
    }
    ctx.fillStyle = isCollage ? '#fff8e9' : palette.muted; ctx.font = '400 20px ' + FONT;
    ctx.fillText(isCollage ? '麦麦中国地图 · 吃一顿麦，留一页手账' : '用麦当劳，画出自己的中国足迹。', 78, 1400);
    ctx.textAlign = 'right'; ctx.fillText(isCollage ? 'mcd-china-map.onrender.com' : '麦麦中国地图', 1008, 1400); ctx.textAlign = 'left';
    return canvas;
  }

  return Object.freeze({render: render, shareFacts: shareFacts, size: Object.freeze({width: WIDTH, height: HEIGHT}),
    limits: Object.freeze({provinceTags: MAX_PROVINCE_TAGS, cityTags: MAX_CITY_TAGS})});
});
