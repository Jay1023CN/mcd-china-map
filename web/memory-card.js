/* A local-only renderer for one personal restaurant journal entry. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MemoryCard = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WIDTH = 1080;
  var HEIGHT = 1440;
  var FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  var NOTE_FONT = '"LXGW WenKai", ' + FONT;
  var TITLE_FONT = NOTE_FONT;
  var MAX_PHOTO_BYTES = 2 * 1024 * 1024;

  function clean(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function project(entry, options) {
    entry = entry && typeof entry === 'object' ? entry : {};
    options = options && typeof options === 'object' ? options : {};
    var result = {
      title: clean(options.title, 42) || clean(entry.title, 42) || '一页探店记',
      date: clean(entry.date, 24),
      foods: (Array.isArray(entry.foods) ? entry.foods : []).map(function (item) {
        return clean(typeof item === 'string' ? item : item && (item.name || item.title), 24);
      }).filter(Boolean).slice(0, 5),
      theme: options.theme === 'red' ? 'red' : 'paper'
    };
    if (options.includePlace === true) {
      result.city = clean(entry.city, 32);
      result.store = clean(entry.store || entry.store_name, 48);
    }
    if (options.includeNote === true) result.note = clean(entry.note, 160);
    return result;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function handLine(ctx, x1, y1, x2, y2, color, width) {
    var bend = (x2 - x1) * 0.34;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + bend, y1 + (y2 - y1) * 0.42 + 2);
    ctx.lineTo(x1 + bend * 2, y1 + (y2 - y1) * 0.72 - 1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawStamp(ctx, x, y, text, palette) {
    ctx.save();
    ctx.strokeStyle = palette.red;
    ctx.fillStyle = palette.red;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(x + 78, y + 23, 74, 21, -0.035, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '400 16px ' + TITLE_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 76, y + 24);
    ctx.restore();
  }

  function drawSnackDoodles(ctx, x, y, scale, palette) {
    var s = scale;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 2.5;
    // Original pen paths: bun, two patties, cheese, lettuce and heel.
    ctx.fillStyle = '#e8a04f'; ctx.strokeStyle = palette.ink;
    ctx.beginPath(); ctx.moveTo(x, y + 65*s); ctx.bezierCurveTo(x + 2*s, y + 18*s, x + 68*s, y + 8*s, x + 82*s, y + 62*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f6d58b';
    for (var seed = 0; seed < 5; seed++) { ctx.beginPath(); ctx.ellipse(x + (18 + seed*11)*s, y + (31 + (seed%2)*5)*s, 1.6*s, 2.3*s, -.4, 0, Math.PI*2); ctx.fill(); }
    ctx.fillStyle = '#5b3323';
    ctx.beginPath(); ctx.moveTo(x + 2*s,y + 66*s); ctx.bezierCurveTo(x + 15*s,y + 57*s,x + 67*s,y + 57*s,x + 81*s,y + 67*s); ctx.lineTo(x + 78*s,y + 75*s); ctx.bezierCurveTo(x + 50*s,y + 81*s,x + 20*s,y + 79*s,x + 3*s,y + 74*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5ca36';
    ctx.beginPath(); ctx.moveTo(x + 4*s,y + 75*s); ctx.lineTo(x + 78*s,y + 74*s); ctx.lineTo(x + 70*s,y + 87*s); ctx.lineTo(x + 31*s,y + 84*s); ctx.lineTo(x + 19*s,y + 92*s); ctx.lineTo(x + 18*s,y + 82*s); ctx.lineTo(x + 6*s,y + 83*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4f7b3e';
    ctx.beginPath(); ctx.moveTo(x + 4*s,y + 86*s); ctx.bezierCurveTo(x + 15*s,y + 79*s,x + 18*s,y + 94*s,x + 29*s,y + 86*s); ctx.bezierCurveTo(x + 41*s,y + 79*s,x + 48*s,y + 96*s,x + 57*s,y + 86*s); ctx.bezierCurveTo(x + 65*s,y + 79*s,x + 72*s,y + 91*s,x + 79*s,y + 84*s); ctx.lineTo(x + 77*s,y + 96*s); ctx.lineTo(x + 7*s,y + 98*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5b3323';
    ctx.beginPath(); ctx.moveTo(x + 7*s,y + 98*s); ctx.bezierCurveTo(x + 21*s,y + 91*s,x + 59*s,y + 91*s,x + 78*s,y + 96*s); ctx.lineTo(x + 74*s,y + 106*s); ctx.lineTo(x + 12*s,y + 106*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8a04f';
    ctx.beginPath(); ctx.moveTo(x + 12*s,y + 108*s); ctx.bezierCurveTo(x + 25*s,y + 100*s,x + 59*s,y + 100*s,x + 74*s,y + 107*s); ctx.bezierCurveTo(x + 68*s,y + 125*s,x + 24*s,y + 128*s,x + 12*s,y + 108*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    // Fries and their packet.
    ctx.strokeStyle = palette.ink; ctx.fillStyle = '#f4cb3b';
    ctx.beginPath(); ctx.moveTo(x + 102*s,y + 57*s); ctx.lineTo(x + 101*s,y + 11*s); ctx.moveTo(x + 114*s,y + 58*s); ctx.lineTo(x + 117*s,y + 3*s); ctx.moveTo(x + 126*s,y + 56*s); ctx.lineTo(x + 131*s,y + 15*s); ctx.moveTo(x + 139*s,y + 58*s); ctx.lineTo(x + 144*s,y + 9*s); ctx.stroke();
    ctx.fillStyle = '#d83c2c';
    ctx.beginPath(); ctx.moveTo(x + 98*s,y + 52*s); ctx.lineTo(x + 150*s,y + 52*s); ctx.lineTo(x + 140*s,y + 118*s); ctx.lineTo(x + 108*s,y + 118*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f4cb3b'; ctx.lineWidth = 3*s;
    ctx.beginPath(); ctx.moveTo(x + 119*s,y + 76*s); ctx.bezierCurveTo(x + 110*s,y + 83*s,x + 126*s,y + 91*s,x + 119*s,y + 100*s); ctx.stroke();
    ctx.restore();
  }

  function drawSnack(ctx, options, x, y, palette) {
    var image = options && options.snackImage;
    var imageW = image && Number(image.naturalWidth || image.width);
    var imageH = image && Number(image.naturalHeight || image.height);
    if (image && imageW > 0 && imageH > 0) {
      var width = 280;
      ctx.drawImage(image, x, y, width, width * imageH / imageW);
    } else drawSnackDoodles(ctx, x, y, 1.55, palette);
  }

  function drawPaper(ctx, palette) {
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Fixed, subtle paper fibers keep exports deterministic and leave text clear.
    ctx.fillStyle = 'rgba(116, 91, 54, .035)';
    for (var i = 0; i < 42; i++) ctx.fillRect(18 + (i * 137) % 1038, 24 + (i * 211) % 1386, 2, 2);
  }

  function waitForFonts() {
    if (typeof document !== 'undefined' && document.fonts) {
      var fonts = document.fonts;
      var load = typeof fonts.load === 'function' ? Promise.resolve().then(function () { return fonts.load('400 32px "LXGW WenKai"'); }).catch(function () {}) : Promise.resolve();
      return load.then(function () {
        return fonts.ready ? Promise.resolve(fonts.ready).catch(function () {}) : undefined;
      });
    }
    return Promise.resolve();
  }

  function validPhotoDataUrl(value) {
    if (typeof value !== 'string') return false;
    var match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match || match[1].length % 4 !== 0) return false;
    var encoded = match[1];
    var padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    var bytes = encoded.length * 3 / 4 - padding;
    return bytes > 0 && bytes <= MAX_PHOTO_BYTES;
  }

  function loadPhoto(dataUrl) {
    return new Promise(function (resolve) {
      if (!validPhotoDataUrl(dataUrl) || typeof Image === 'undefined') return resolve(null);
      var image;
      try { image = new Image(); } catch (_) { return resolve(null); }
      image.onload = function () { resolve(image); };
      image.onerror = function () { resolve(null); };
      try { image.src = dataUrl; } catch (_) { resolve(null); }
    });
  }

  function roundedTag(ctx, text, x, y, palette) {
    ctx.font = '600 21px ' + FONT;
    var width = Math.min(235, Math.max(82, ctx.measureText(text).width + 34));
    var maxTextWidth = width - 34;
    var displayText = text;
    if (ctx.measureText(displayText).width > maxTextWidth) {
      var chars = Array.from(displayText);
      while (chars.length && ctx.measureText(chars.join('') + '…').width > maxTextWidth) chars.pop();
      displayText = chars.join('') + '…';
    }
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 39); ctx.lineTo(x + width - 4, y + 41); ctx.stroke();
    ctx.fillStyle = palette.tag;
    ctx.fillStyle = palette.tagInk;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, x + 8, y + 23);
    ctx.textAlign = 'left';
    return width;
  }

  function wrapText(ctx, text, maxWidth) {
    var lines = [];
    var line = '';
    Array.from(text).forEach(function (char) {
      var candidate = line + char;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
      } else line = candidate;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawFallback(ctx, x, y, w, h, palette) {
    ctx.fillStyle = '#f6efdf'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = palette.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + w*.5, y + h*.29, 13, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w*.5, y + h*.31); ctx.lineTo(x + w*.5, y + h*.39); ctx.stroke();
    ctx.fillStyle = palette.ink; ctx.font = '400 28px ' + TITLE_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('在地图上，记下一站喜欢', x + w * .69, y + h * .43, w * .52);
    ctx.fillStyle = palette.muted; ctx.font = '400 20px ' + FONT;
    ctx.fillText('还没有照片 · 留一格给旅程', x + w * .69, y + h * .54, w * .52);
    ctx.textAlign = 'left';
  }

  function drawPhotoCover(ctx, image, x, y, w, h, fit) {
    var sourceW = Number(image.naturalWidth || image.width);
    var sourceH = Number(image.naturalHeight || image.height);
    if (!(sourceW > 0 && sourceH > 0)) throw new Error('Invalid image dimensions');
    if(fit==='contain') {
      var scale=Math.min(w/sourceW,h/sourceH);
      ctx.fillStyle='#f3eddf';ctx.fillRect(x,y,w,h);
      ctx.drawImage(image,x+(w-sourceW*scale)/2,y+(h-sourceH*scale)/2,sourceW*scale,sourceH*scale);
      return;
    }
    var sourceRatio = sourceW / sourceH;
    var targetRatio = w / h;
    var sx = 0, sy = 0, sw = sourceW, sh = sourceH;
    if (sourceRatio > targetRatio) {
      sw = sourceH * targetRatio;
      sx = (sourceW - sw) / 2;
    } else {
      sh = sourceW / targetRatio;
      sy = (sourceH - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function drawFittedTitle(ctx, text, x, y, maxWidth, baseSize, minSize) {
    var size = baseSize;
    ctx.font = '900 ' + size + 'px ' + TITLE_FONT;
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = '900 ' + size + 'px ' + TITLE_FONT;
    }
    ctx.fillText(text, x, y);
  }

  function splitTitle(ctx, text) {
    var chars = Array.from(text);
    if (chars.length < 2) return [text, ''];
    var best = 1, bestScore = Infinity;
    for (var i = 1; i < chars.length; i++) {
      var before = chars[i - 1];
      var after = chars[i];
      var classifiers = '个家页站次天年口杯份';
      if (/[，。！？、：；,.!?;:]/.test(after) || i === 1 && /[，。！？、：；,.!?;:]/.test(before)) continue;
      if (/[一二三四五六七八九十几两]$/.test(before) && classifiers.indexOf(after) >= 0) continue;
      var left = chars.slice(0, i).join('');
      var right = chars.slice(i).join('');
      var score = Math.abs(ctx.measureText(left).width - ctx.measureText(right).width);
      if (/[，。！？、：；,.!?;:]$/.test(left)) score -= 80;
      if (/[的地得和与在去把给]$/.test(left)) score += 12;
      if (/^[的地得和与在去把给]/.test(right)) score += 24;
      if (/^[一二三四五六七八九十几两][个家页站次天年口杯份]/.test(right)) score -= 24;
      if (/[个家页站次天年口杯份]$/.test(left)) score += 12;
      if (score < bestScore) { best = i; bestScore = score; }
    }
    if (bestScore === Infinity) return [text, ''];
    return [chars.slice(0, best).join(''), chars.slice(best).join('')];
  }

  function drawHandTitle(ctx, title, palette) {
    var size = 59;
    var max = 810;
    var lines;
    while (true) {
      ctx.font = '400 ' + size + 'px ' + TITLE_FONT;
      lines = splitTitle(ctx, title);
      if (Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1] || '').width) <= max || size <= 34) break;
      size -= 1;
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.ink;
    ctx.fillText(lines[0], 84, 207);
    if (lines[1]) {
      ctx.fillStyle = palette.red;
      ctx.fillText(lines[1], 100, 285);
      handLine(ctx, 99, 310, Math.min(99 + ctx.measureText(lines[1]).width, 900), 306, palette.red, 3);
    }
  }

  function drawPlace(ctx, facts, palette, y, profile) {
    if (!facts.city && !facts.store) return y;
    ctx.fillStyle = palette.red; ctx.lineWidth = 3; ctx.strokeStyle = palette.red;
    ctx.beginPath(); ctx.moveTo(89,y-7); ctx.bezierCurveTo(74,y+4,82,y+24,94,y+33); ctx.bezierCurveTo(106,y+20,112,y+5,97,y-7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = palette.paper; ctx.beginPath(); ctx.arc(94,y+3,4,0,Math.PI*2); ctx.fill();
    var city = facts.city || '';
    ctx.textBaseline = 'alphabetic';
    profile = profile || {citySize: 28, storeSize: 22};
    ctx.fillStyle = palette.ink; ctx.font = '400 ' + profile.citySize + 'px ' + TITLE_FONT;
    var cityWidth = city ? ctx.measureText(city).width : 0;
    var contentY = y + 30;
    if (city) {
      ctx.fillStyle = palette.ink; ctx.font = '400 ' + profile.citySize + 'px ' + TITLE_FONT;
      var cityLines = wrapText(ctx, city, 820);
      var cityLineHeight = profile.citySize + 4;
      cityLines.forEach(function (line,index) { ctx.fillText(line, 122, contentY + index*cityLineHeight); });
      contentY += cityLines.length*cityLineHeight;
    }
    if (facts.store) {
      ctx.fillStyle = palette.muted; ctx.font = '400 ' + profile.storeSize + 'px ' + FONT;
      var storeLines = wrapText(ctx, facts.store, 820);
      var storeLineHeight = profile.storeSize + 3;
      storeLines.forEach(function (line,index) { ctx.fillText(line, 122, contentY + 2 + index*storeLineHeight); });
      contentY += storeLines.length*storeLineHeight + 2;
    }
    if (city) handLine(ctx, 122, y+39, Math.min(122 + cityWidth, 402), y+37, palette.gold, 2);
    return contentY + 8;
  }

  function contentProfile(facts, options) {
    var contentLength = 0;
    if (options.includePlace === true) contentLength += (facts.city || '').length + (facts.store || '').length;
    facts.foods.forEach(function (food) { contentLength += food.length; });
    if (options.includeNote === true) contentLength += (facts.note || '').length;
    var photoHeight = contentLength <= 100 ? 580 : contentLength <= 200 ? 520 : contentLength <= 300 ? 470 : 420;
    var citySize = contentLength <= 100 ? 34 : contentLength <= 200 ? 30 : contentLength <= 300 ? 26 : 24;
    var storeSize = contentLength <= 100 ? 30 : contentLength <= 200 ? 26 : contentLength <= 300 ? 24 : 22;
    var noteSize = contentLength <= 100 ? 34 : contentLength <= 180 ? 30 : contentLength <= 260 ? 26 : 22;
    var foodSize = contentLength <= 100 ? 26 : contentLength <= 200 ? 24 : 22;
    return {contentLength: contentLength, photoHeight: photoHeight, citySize: citySize, storeSize: storeSize, noteSize: noteSize, foodSize: foodSize};
  }

  async function render(entry, options) {
    options = options && typeof options === 'object' ? options : {};
    var facts = project(entry, options);
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw new Error('MemoryCard.render requires a browser canvas');
    }
    await waitForFonts();
    var canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    var isRed = facts.theme === 'red';
    var palette = isRed ? {
      base: '#d44632', baseDark: '#98271f', paper: '#fff8e9', ink: '#29231b', muted: '#806f58',
      line: '#d8c9ad', red: '#d44632', gold: '#ecc74c', illustration: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840'
    } : {
      base: '#f3eddb', baseDark: '#e9dfc8', paper: '#fff9eb', ink: '#29231b', muted: '#806f58',
      line: '#d8c9ad', red: '#dc442e', gold: '#ecc74c', illustration: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840'
    };
    drawPaper(ctx, palette);
    var profile = contentProfile(facts, options);

    ctx.fillStyle = palette.ink;
    ctx.font = '600 21px ' + TITLE_FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText('麦麦中国地图', 76, 80);
    handLine(ctx, 76, 101, 280, 99, palette.gold, 3);
    if (options.kind === 'plan') {
      ctx.textAlign = 'right';
      drawStamp(ctx, 829, 54, '想去 · 尚未打卡', palette);
    } else {
      ctx.fillStyle = palette.muted; ctx.font = '400 22px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(facts.date || '一页探店记', 1004, 80);
    }
    ctx.textAlign = 'left';
    drawHandTitle(ctx, facts.title, palette);
    ctx.fillStyle = palette.muted; ctx.font = '400 22px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(options.kind === 'plan' ? '把想去的那家，先放进旅程。' : '把喜欢的味道，记在路上。', 100, 355);

    var frame = {x: 80, y: 370, w: 920, h: profile.photoHeight};
    var photoBox = {x: frame.x + 9, y: frame.y + 9, w: frame.w - 18, h: frame.h - 18};
    var photo = await loadPhoto(options.photoDataUrl);
    ctx.save();
    ctx.translate(frame.x + frame.w/2, frame.y + frame.h/2);
    ctx.rotate(-Math.PI/180);
    ctx.fillStyle = '#fffefa';
    ctx.fillRect(-frame.w/2, -frame.h/2, frame.w, frame.h);
    ctx.shadowColor = 'rgba(52,42,26,.18)'; ctx.shadowBlur = 17; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 5;
    ctx.strokeStyle = 'rgba(78,64,43,.12)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-frame.w/2, -frame.h/2, frame.w, frame.h);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if (photo) {
      try { drawPhotoCover(ctx, photo, -photoBox.w/2, -photoBox.h/2, photoBox.w, photoBox.h, options.imageFit); }
      catch (_) { drawFallback(ctx, -photoBox.w/2, -photoBox.h/2, photoBox.w, photoBox.h, palette); }
    } else drawFallback(ctx, -photoBox.w/2, -photoBox.h/2, photoBox.w, photoBox.h, palette);
    ctx.strokeStyle = '#fffefa'; ctx.lineWidth = 8;
    ctx.strokeRect(-photoBox.w/2, -photoBox.h/2, photoBox.w, photoBox.h);
    ctx.restore();
    ctx.strokeStyle = palette.ink; ctx.fillStyle = palette.ink; ctx.lineWidth = 1.8;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var photoAnnotation = clean(options.photoAnnotation,10);
    if (photoAnnotation) {
      ctx.fillStyle = palette.ink; ctx.font = '400 22px ' + TITLE_FONT; ctx.textAlign = 'right';
      ctx.fillText(photoAnnotation, 1004, 352);
      ctx.strokeStyle = '#66b8c7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(986,359); ctx.bezierCurveTo(986,364,984,368,981,375); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(981,375); ctx.lineTo(980,368); ctx.lineTo(986,371); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'left';
    }

    var nextY = frame.y + frame.h + 18;
    if (options.includePlace === true) nextY = drawPlace(ctx, facts, palette, nextY, profile);
    if (facts.foods.length) {
      ctx.font = '400 ' + profile.foodSize + 'px ' + TITLE_FONT;
      var foodLines = [];
      var currentFoodLine = '记下的味道：';
      facts.foods.forEach(function (food) {
        var candidate = currentFoodLine ? currentFoodLine + ' ' + food : food;
        if (currentFoodLine && ctx.measureText(candidate).width > 820) {
          foodLines.push(currentFoodLine);
          currentFoodLine = food;
        } else currentFoodLine = candidate;
      });
      if (currentFoodLine) foodLines.push(currentFoodLine);
      foodLines.forEach(function (line,index) {
        ctx.fillStyle = palette.ink;
        ctx.fillText(line, 122, nextY + profile.foodSize + 2 + index*(profile.foodSize+2));
        handLine(ctx, 122, nextY + profile.foodSize + 6 + index*(profile.foodSize+2), Math.min(122 + ctx.measureText(line).width, 330), nextY + profile.foodSize + 5 + index*(profile.foodSize+2), palette.gold, 1.5);
      });
      nextY += profile.foodSize + 2 + foodLines.length*(profile.foodSize+2);
    }
    if (options.includeNote === true && facts.note) {
      ctx.fillStyle = palette.ink; ctx.font = '400 ' + profile.noteSize + 'px ' + TITLE_FONT; ctx.textBaseline = 'alphabetic';
      var noteWidth = 560;
      var noteLines = wrapText(ctx, facts.note, noteWidth);
      noteLines.forEach(function (line, index) { ctx.fillText(line, 122, nextY + profile.noteSize + index * (profile.noteSize+3)); });
      var finalNoteLine = noteLines[noteLines.length - 1] || '';
      var noteEndX = Math.min(122 + ctx.measureText(finalNoteLine).width + 5, noteWidth + 122);
      var noteEndY = nextY + profile.noteSize + (noteLines.length - 1) * (profile.noteSize+3) + 5;
      if (noteEndX < 712) handLine(ctx, noteEndX, noteEndY, 713, noteEndY - 3, '#66b8c7', 2);
      ctx.save(); drawSnack(ctx, options, 715, nextY + 4, palette); ctx.restore();
      nextY += profile.noteSize + noteLines.length*(profile.noteSize+3);
    } else {
      var doodleYEmpty = Math.min(Math.max(nextY + 10, 1080), 1130);
      ctx.save(); drawSnack(ctx, options, 715, doodleYEmpty, palette); ctx.restore();
    }

    var photoCredit = photo ? clean(options.photoCredit,70) : '';
    if (photoCredit) {
      ctx.fillStyle = palette.muted; ctx.font = '400 22px ' + FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      wrapText(ctx, photoCredit, 900).forEach(function (line,index) { ctx.fillText(line, 76, 1345 + index*26); });
    }
    ctx.fillStyle = palette.ink;
    ctx.font = '400 22px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    handLine(ctx, 76, 1400, 220, 1398, palette.gold, 2);
    ctx.fillText('用麦当劳，画出自己的中国足迹。', 76, 1420);
    ctx.textAlign = 'left';
    return canvas;
  }

  return {project: project, render: render, limits: {width: WIDTH, height: HEIGHT, photoBytes: MAX_PHOTO_BYTES}};
});
