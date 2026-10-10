/* Derived city albums and monthly newspapers; no network or storage access. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JournalCollections = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var WIDTH = 1080, HEIGHT = 1440;
  var FONT = '"LXGW WenKai", "Noto Sans SC", "Microsoft YaHei", sans-serif';

  function clean(value, max) {
    return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  function identity(value) { return clean(value, 200).normalize('NFKC').toLowerCase(); }
  function cityInfo(entry) {
    var city = clean(entry.city, 120).replace(/市$/, '');
    var province = clean(entry.province_code, 6);
    return city ? {key: province + '|' + identity(city), city: city, province_code: province} : null;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var year = +value.slice(0, 4), month = +value.slice(5, 7), day = +value.slice(8, 10);
    var date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
    return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function entriesSorted(entries) {
    return (Array.isArray(entries) ? entries : []).filter(function (entry) {
      return entry && typeof entry === 'object' && validDate(entry.date);
    }).map(function (entry, index) { return {entry: entry, index: index}; }).sort(function (a, b) {
      return compareText(b.entry.date, a.entry.date) || compareText(clean(a.entry.id, 100), clean(b.entry.id, 100)) || a.index - b.index;
    }).map(function (item) { return item.entry; });
  }
  function summarizeMonth(month, entries) {
    var cities = new Map(), stores = new Set(), foods = new Map();
    entries.forEach(function (entry) {
      var city = cityInfo(entry);
      if (city && !cities.has(city.key)) cities.set(city.key, city);
      var store = identity(entry.store || entry.store_name);
      if (store) stores.add((city ? city.key : clean(entry.province_code, 6) + '|') + '|' + store);
      var pageFoods = new Set();
      (Array.isArray(entry.foods) ? entry.foods : []).forEach(function (item) {
        var name = clean(typeof item === 'string' ? item : item && (item.name || item.title), 120);
        var key = identity(name);
        if (!name || pageFoods.has(key)) return;
        pageFoods.add(key);
        var current = foods.get(key);
        if (current) current.count += 1;
        else foods.set(key, {name: name, count: 1});
      });
    });
    return {month: month, entries: entries, count: entries.length, cities: Array.from(cities.values()),
      storeCount: stores.size, topFoods: Array.from(foods.values()).sort(function (a, b) {
        return b.count - a.count || compareText(identity(a.name), identity(b.name));
      })};
  }
  function build(entries) {
    var cities = new Map(), months = new Map();
    entriesSorted(entries).forEach(function (entry) {
      var city = cityInfo(entry);
      if (city) {
        var album = cities.get(city.key);
        if (!album) { album = {key: city.key, city: city.city, province_code: city.province_code, entries: [], count: 0, latestDate: entry.date}; cities.set(city.key, album); }
        album.entries.push(entry); album.count += 1;
      }
      var month = entry.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(entry);
    });
    return {cities: Array.from(cities.values()).sort(function (a, b) {
      return compareText(b.latestDate, a.latestDate) || compareText(a.key, b.key);
    }), months: Array.from(months.keys()).sort(function (a, b) { return compareText(b, a); }).map(function (month) {
      return summarizeMonth(month, months.get(month));
    })};
  }
  function projectMonth(collection, options) {
    collection = collection && typeof collection === 'object' ? collection : {};
    options = options && typeof options === 'object' ? options : {};
    var month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(collection.month || '') ? collection.month : '';
    var entries = entriesSorted(collection.entries).filter(function (entry) { return entry.date.slice(0, 7) === month; });
    var summary = summarizeMonth(month, entries);
    var result = {title: clean(options.title, 42) || '这个月，把喜欢写进手账', month: month,
      count: summary.count, cityCount: summary.cities.length, storeCount: summary.storeCount,
      topFoods: summary.topFoods.slice(0, 3).map(function (food) { return {name: clean(food.name, 24), count: food.count}; }),
      theme: options.theme === 'red' ? 'red' : 'paper'};
    if (options.includeCities === true) result.cities = summary.cities.map(function (city) { return clean(city.city, 32); });
    var caption = clean(options.caption, 100);
    if (caption) result.caption = caption;
    return result;
  }
  function selectCity(collection, options) {
    collection = collection && typeof collection === 'object' ? collection : {};
    options = options && typeof options === 'object' ? options : {};
    var city = cityInfo(collection), seen = new Set();
    var all = entriesSorted(collection.entries).filter(function (entry) {
      var info = cityInfo(entry), id = clean(entry.id, 100);
      if (!city || (collection.key != null && collection.key !== city.key) || !info || info.key !== city.key || !id || seen.has(id)) return false;
      seen.add(id); return true;
    });
    var entries;
    if (options.selectedIds === undefined) entries = all.slice(0, 6);
    else {
      var byId = new Map(all.map(function (entry) { return [clean(entry.id, 100), entry]; })), selected = new Set();
      entries = [];
      (Array.isArray(options.selectedIds) ? options.selectedIds : []).forEach(function (value) {
        var id = clean(value, 100);
        if (entries.length >= 12 || selected.has(id) || !byId.has(id)) return;
        entries.push(byId.get(id)); selected.add(id);
      });
    }
    var coverId = clean(options.coverId, 100), cover = entries.findIndex(function (entry) { return clean(entry.id, 100) === coverId; });
    if (cover > 0) entries.unshift(entries.splice(cover, 1)[0]);
    return {city: city && city.city || '', entries: entries, totalCount: all.length};
  }
  function projectCity(collection, options) {
    options = options && typeof options === 'object' ? options : {};
    var selected = selectCity(collection, options);
    var result = {title: clean(options.title, 42) || '我的麦麦城市回忆册', count: selected.entries.length,
      totalCount: selected.totalCount, pages: selected.entries.map(function (entry) {
        var page = {date: entry.date, foods: (Array.isArray(entry.foods) ? entry.foods : []).map(function (item) {
          return clean(typeof item === 'string' ? item : item && (item.name || item.title), 24);
        }).filter(Boolean).slice(0, 5)};
        if (options.includeCities === true) page.store = clean(entry.store || entry.store_name, 48);
        if (options.includeNote === true) page.note = clean(entry.note, 140);
        return page;
      })};
    if (options.includeCities === true) result.city = clean(selected.city, 32);
    var caption = clean(options.caption, 140);
    if (caption) result.caption = caption;
    return result;
  }
  function wrap(ctx, text, width) {
    var lines = [], line = '';
    Array.from(text).forEach(function (char) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = char; }
      else line += char;
    });
    if (line) lines.push(line);
    return lines;
  }
  function ellipsis(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    var chars = Array.from(text);
    while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop();
    return chars.join('') + '…';
  }
  function line(ctx, x, y, width, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + width * .45, y + 4, x + width, y - 1); ctx.stroke();
  }
  function validPhoto(value) {
    var match = typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length % 4) return false;
    var bytes = match[1].length * 3 / 4 - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
    return bytes > 0 && bytes <= 2 * 1024 * 1024;
  }
  function loadPhoto(value) {
    return new Promise(function (resolve) {
      if (!validPhoto(value) || typeof Image === 'undefined') return resolve(null);
      var image = new Image();
      image.onload = function () { resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null); };
      image.onerror = function () { resolve(null); }; image.src = value;
    });
  }
  function drawPhoto(ctx, image, x, y, width, height) {
    var w = image.naturalWidth, h = image.naturalHeight, ratio = width / height;
    var sw = w, sh = h, sx = 0, sy = 0;
    if (w / h > ratio) { sw = h * ratio; sx = (w - sw) / 2; }
    else { sh = w / ratio; sy = (h - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }
  function drawLines(ctx, text, x, y, width, maxLines, lineHeight) {
    var lines = wrap(ctx, text, width);
    lines.slice(0, maxLines).forEach(function (value, index) {
      var rest = index === maxLines - 1 && lines.length > maxLines ? '…' : '';
      ctx.fillText(ellipsis(ctx, value + rest, width), x, y + index * lineHeight);
    });
  }
  async function waitForFonts() {
    if (typeof document === 'undefined') throw new Error('Journal cards need a browser canvas');
    if (document.fonts) {
      try { if (document.fonts.load) await document.fonts.load('400 32px "LXGW WenKai"'); await document.fonts.ready; } catch (_) {}
    }
  }
  function drawSnack(ctx, image, x, y, width, height) {
    var w = image && Number(image.naturalWidth || image.width), h = image && Number(image.naturalHeight || image.height);
    if (w > 0 && h > 0) { var scale = Math.min(width / w, height / h); ctx.drawImage(image, x, y, w * scale, h * scale); }
  }
  async function renderCity(collection, options) {
    options = options && typeof options === 'object' ? options : {};
    await waitForFonts();
    var selected = selectCity(collection, options), facts = projectCity(collection, options);
    var photoInputs = new Map();
    (Array.isArray(options.photos) ? options.photos : []).forEach(function (photo) {
      if (!photo || typeof photo !== 'object') return;
      var id = clean(photo.entryId, 100);
      if (!photoInputs.has(id) && validPhoto(photo.dataUrl)) photoInputs.set(id, photo.dataUrl);
    });
    var photos = await Promise.all(selected.entries.map(function (entry) { return loadPhoto(photoInputs.get(clean(entry.id, 100))); }));
    var top = 416, rowHeight = 480, rows = Math.ceil(facts.count / 2);
    var height = facts.count ? top + rows * rowHeight + 150 : 900;
    var canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = height;
    var ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable');
    var paper = options.theme === 'red' ? '#fff1e8' : '#fff9ed', ink = '#302a22', muted = '#887760', red = '#e44832';
    ctx.fillStyle = paper; ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = 'rgba(116,91,54,.035)';
    for (var fiber = 0; fiber < Math.ceil(height / 24); fiber++) ctx.fillRect(18 + (fiber * 137) % 1038, 24 + (fiber * 211) % (height - 48), 2, 2);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.font = '400 28px ' + FONT;
    ctx.fillText('麦麦中国地图 · 城市回忆册', 68, 66);
    if (facts.city) { ctx.textAlign = 'right'; ctx.fillStyle = red; ctx.font = '400 27px ' + FONT; ctx.fillText(ellipsis(ctx, facts.city, 340), 1012, 66); ctx.textAlign = 'left'; }
    line(ctx, 68, 90, 944, '#ddcdb1');
    var size = 68, titleLines;
    do { ctx.font = '400 ' + size + 'px ' + FONT; titleLines = wrap(ctx, facts.title, 944); if (titleLines.length <= 2 || size <= 40) break; size -= 2; } while (true);
    ctx.fillStyle = red; drawLines(ctx, facts.title, 68, 165, 944, 2, size + 12);
    ctx.fillStyle = muted; ctx.font = '400 24px ' + FONT;
    drawLines(ctx, facts.caption || '同一座城，不同的小停靠。把喜欢的一页页，装订在一起。', 70, 275, 940, 4, 28);
    ctx.fillStyle = ink; ctx.font = '400 23px ' + FONT;
    ctx.fillText('挑了 ' + facts.count + ' 页 · 这座城共有 ' + facts.totalCount + ' 页回忆', 70, 398);
    if (!facts.count) {
      ctx.fillStyle = ink; ctx.font = '400 43px ' + FONT; ctx.fillText('先挑几页喜欢的回忆', 70, 532);
      ctx.fillStyle = muted; ctx.font = '400 26px ' + FONT; ctx.fillText('选好之后，再把这座城装进一张长图。', 72, 588);
      line(ctx, 72, 624, 330, '#e7bf42');
    }
    facts.pages.forEach(function (page, index) {
      var width = 460, x = index === facts.count - 1 && facts.count % 2 ? (WIDTH - width) / 2 : 68 + index % 2 * 484;
      var y = top + Math.floor(index / 2) * rowHeight;
      ctx.save(); ctx.shadowColor = 'rgba(68,48,24,.10)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#fffdf8'; ctx.fillRect(x, y, width, 456); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillRect(x + 10, y + 10, width - 20, 218);
      if (photos[index]) drawPhoto(ctx, photos[index], x + 20, y + 20, width - 40, 198);
      else {
        ctx.fillStyle = '#f1e9d8'; ctx.fillRect(x + 20, y + 20, width - 40, 198);
        ctx.fillStyle = muted; ctx.font = '400 26px ' + FONT; ctx.fillText('这一餐，留在手账里', x + 48, y + 123);
        line(ctx, x + 48, y + 151, 244, '#e7bf42');
      }
      ctx.fillStyle = red; ctx.font = '400 22px ' + FONT; ctx.fillText(page.date, x + 22, y + 260);
      ctx.textAlign = 'right'; ctx.fillStyle = muted; ctx.font = '400 18px ' + FONT; ctx.fillText(String(index + 1).padStart(2, '0'), x + width - 24, y + 260); ctx.textAlign = 'left';
      var textY = y + 300;
      if (page.store) { ctx.fillStyle = ink; ctx.font = '400 26px ' + FONT; drawLines(ctx, page.store, x + 22, textY, width - 44, 2, 30); textY += 60; }
      if (page.foods.length) { ctx.fillStyle = '#975842'; ctx.font = '400 21px ' + FONT; drawLines(ctx, page.foods.join(' · '), x + 22, textY, width - 44, 2, 25); textY += 54; }
      if (page.note) {
        ctx.fillStyle = muted; ctx.font = '400 20px ' + FONT;
        var remaining = Math.max(1, Math.floor((y + 430 - textY) / 24) + 1);
        drawLines(ctx, page.note, x + 22, textY, width - 44, Math.min(3, remaining), 24);
      }
    });
    var footerY = height - 125;
    ctx.fillStyle = muted; ctx.font = '400 26px ' + FONT; ctx.fillText('用麦当劳，画出自己的中国足迹。', 70, footerY + 25);
    drawSnack(ctx, options.snackImage, 836, footerY - 30, 174, 96);
    line(ctx, 68, height - 57, 944, '#ddcdb1');
    ctx.fillStyle = muted; ctx.font = '400 17px ' + FONT;
    ctx.fillText(ellipsis(ctx, clean(options.photoCredit, 160) || '来自我的照片手账 · 麦麦中国地图', 940), 70, height - 22);
    return canvas;
  }
  async function renderMonth(collection, options) {
    options = options && typeof options === 'object' ? options : {};
    await waitForFonts();
    var facts = projectMonth(collection, options);
    var photos = await Promise.all((Array.isArray(options.photos) ? options.photos : []).slice(0, 3).map(loadPhoto));
    photos = photos.filter(Boolean);
    var canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    var paper = facts.theme === 'red' ? '#fff1e8' : '#fff9ed', ink = '#302a22', muted = '#887760', red = '#e44832';
    ctx.fillStyle = paper; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(116,91,54,.035)';
    for (var i = 0; i < 56; i++) ctx.fillRect(18 + (i * 137) % 1038, 24 + (i * 211) % 1386, 2, 2);
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = ink; ctx.font = '400 28px ' + FONT;
    ctx.fillText('麦麦中国地图 · 月度小报', 78, 78);
    var monthLabel = facts.month ? facts.month.slice(0, 4) + ' 年 ' + Number(facts.month.slice(5)) + ' 月' : '我的月度回忆';
    ctx.textAlign = 'right'; ctx.fillStyle = red; ctx.fillText(monthLabel, 1002, 78); ctx.textAlign = 'left';
    line(ctx, 78, 104, 924, '#ddcdb1');
    var fontSize = 74, titleLines;
    do { ctx.font = '400 ' + fontSize + 'px ' + FONT; titleLines = wrap(ctx, facts.title, 914); if (titleLines.length <= 2 || fontSize <= 40) break; fontSize -= 2; } while (true);
    ctx.fillStyle = red;
    titleLines.slice(0, 2).forEach(function (text, index) { ctx.fillText(ellipsis(ctx, text, 914), 78, 202 + index * (fontSize + 12)); });
    ctx.fillStyle = muted; ctx.font = '400 24px ' + FONT;
    drawLines(ctx, facts.caption || '把这一月的照片、餐品和小停靠，装进一页。', 80, 317, 914, 2, 29);
    var gap = 18, frameW = (924 - gap * (photos.length - 1)) / Math.max(1, photos.length), frameH = 390;
    if (photos.length) photos.forEach(function (image, index) {
      var x = 78 + index * (frameW + gap), y = 365, w = frameW, h = frameH;
      if (options.layout === 'feature' && photos.length > 1) {
        if (index === 0) { w = 602; }
        else { x = 698; w = 304; h = photos.length === 3 ? 186 : frameH; y += photos.length === 3 ? (index - 1) * 204 : 0; }
      }
      ctx.save(); ctx.shadowColor = 'rgba(68,48,24,.12)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.restore();
      drawPhoto(ctx, image, x + 12, y + 12, w - 24, h - 50);
      ctx.fillStyle = muted; ctx.font = '400 18px ' + FONT; ctx.fillText('这一月的小停靠 ' + (index + 1), x + 14, y + h - 16);
    });
    else {
      ctx.fillStyle = '#f1e9d8'; ctx.fillRect(78, 365, 924, frameH);
      ctx.fillStyle = ink; ctx.font = '400 44px ' + FONT; ctx.fillText('有些回忆，先从一句话开始。', 135, 534);
      ctx.fillStyle = muted; ctx.font = '400 27px ' + FONT; ctx.fillText('照片会从这个月的手账里自动选入', 138, 593);
      line(ctx, 138, 636, 310, '#edc64f');
    }
    var stats = [{value: facts.count, label: '页手账'}, {value: facts.cityCount, label: '座城市'}, {value: facts.storeCount, label: '家门店'}];
    stats.forEach(function (stat, index) {
      var x = 80 + index * 312;
      ctx.fillStyle = index === 0 ? red : ink; ctx.font = '400 64px ' + FONT; ctx.fillText(String(stat.value), x, 856);
      ctx.fillStyle = muted; ctx.font = '400 24px ' + FONT; ctx.fillText(stat.label, x + 4, 898);
      line(ctx, x, 918, 234, index === 1 ? '#72b5bf' : '#e7bf42');
    });
    ctx.fillStyle = ink; ctx.font = '400 34px ' + FONT; ctx.fillText('这个月，常出现在手账里的味道', 80, 987);
    if (facts.topFoods.length) facts.topFoods.forEach(function (food, index) {
      var x = 80 + index * 312;
      ctx.fillStyle = red; ctx.font = '400 23px ' + FONT; ctx.fillText('0' + (index + 1), x, 1040);
      ctx.fillStyle = ink; ctx.font = '400 27px ' + FONT;
      var foodLines = wrap(ctx, food.name, 250);
      foodLines.slice(0, 2).forEach(function (text, lineIndex) {
        ctx.fillText(ellipsis(ctx, text + (lineIndex === 1 && foodLines.length > 2 ? '…' : ''), 250), x, 1080 + lineIndex * 35);
      });
      ctx.fillStyle = muted; ctx.font = '400 20px ' + FONT; ctx.fillText(food.count + ' 页手账有它', x, 1152);
    });
    else { ctx.fillStyle = muted; ctx.font = '400 25px ' + FONT; ctx.fillText('每一页随手记，也值得好好收藏。', 80, 1065); }
    ctx.fillStyle = muted; ctx.font = '400 25px ' + FONT;
    if (facts.cities && facts.cities.length) {
      ctx.fillStyle = ink; ctx.fillText('这一个月，停靠过', 80, 1221);
      ctx.fillStyle = red; ctx.font = '400 27px ' + FONT;
      var cityLines = wrap(ctx, facts.cities.join(' · '), 704);
      cityLines.slice(0, 2).forEach(function (text, index) {
        ctx.fillText(ellipsis(ctx, text + (index === 1 && cityLines.length > 2 ? '…' : ''), 704), 80, 1264 + index * 35);
      });
    } else { ctx.fillText('用麦当劳，画出自己的中国足迹。', 80, 1270); }
    var snack = options.snackImage, snackW = snack && Number(snack.naturalWidth || snack.width), snackH = snack && Number(snack.naturalHeight || snack.height);
    if (snackW > 0 && snackH > 0) {
      var scale = Math.min(176 / snackW, 136 / snackH); ctx.drawImage(snack, 826, 1224, snackW * scale, snackH * scale);
    }
    line(ctx, 78, 1356, 924, '#ddcdb1');
    ctx.fillStyle = muted; ctx.font = '400 17px ' + FONT;
    var credit = clean(options.photoCredit, 160);
    ctx.fillText(ellipsis(ctx, credit || '来自我的照片手账 · 麦麦中国地图', 924), 80, 1391);
    return canvas;
  }
  return {build: build, projectMonth: projectMonth, renderMonth: renderMonth, projectCity: projectCity, renderCity: renderCity, WIDTH: WIDTH, HEIGHT: HEIGHT};
});
