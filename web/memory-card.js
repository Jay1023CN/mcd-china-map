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
  var TITLE_FONT = '"Ma Shan Zheng", ' + FONT;
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
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 148, y + 1); ctx.lineTo(x + 151, y + 43);
    ctx.lineTo(x + 2, y + 46); ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 8); ctx.lineTo(x + 143, y + 7); ctx.lineTo(x + 145, y + 38);
    ctx.lineTo(x + 9, y + 40); ctx.closePath(); ctx.stroke();
    ctx.font = '400 24px ' + TITLE_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 76, y + 24, 128);
    ctx.restore();
  }

  function drawTape(ctx, x, y, w, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + 4, y); ctx.lineTo(x + w - 3, y + 2); ctx.lineTo(x + w, y + 25);
    ctx.lineTo(x + 2, y + 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(126, 96, 45, .22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 10, y + 6); ctx.lineTo(x + w - 7, y + 7); ctx.stroke();
    ctx.restore();
  }

  function drawSnackDoodles(ctx, x, y, scale, palette) {
    var s = scale;
    ctx.save();
    ctx.strokeStyle = palette.ink; ctx.fillStyle = palette.gold; ctx.lineWidth = 3;
    // A small burger in three visible layers.
    ctx.beginPath(); ctx.moveTo(x, y + 28*s); ctx.bezierCurveTo(x + 3*s, y + 2*s, x + 49*s, y + 2*s, x + 53*s, y + 28*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 1*s, y + 31*s); ctx.lineTo(x + 54*s, y + 32*s); ctx.lineTo(x + 51*s, y + 39*s); ctx.lineTo(x + 3*s, y + 39*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 2*s, y + 42*s); ctx.bezierCurveTo(x + 7*s, y + 57*s, x + 47*s, y + 57*s, x + 52*s, y + 42*s); ctx.stroke();
    // Fries beside it, kept deliberately simple.
    ctx.beginPath(); ctx.moveTo(x + 70*s, y + 22*s); ctx.lineTo(x + 75*s, y + 7*s); ctx.moveTo(x + 83*s, y + 22*s); ctx.lineTo(x + 85*s, y + 3*s); ctx.moveTo(x + 94*s, y + 22*s); ctx.lineTo(x + 99*s, y + 8*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 69*s, y + 24*s); ctx.lineTo(x + 100*s, y + 24*s); ctx.lineTo(x + 96*s, y + 55*s); ctx.lineTo(x + 73*s, y + 55*s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawPaper(ctx, palette) {
    ctx.fillStyle = palette.paper;
    ctx.fillRect(52, 52, WIDTH - 104, HEIGHT - 104);
    // Fixed, subtle paper fibers keep exports deterministic and leave text clear.
    ctx.fillStyle = 'rgba(116, 91, 54, .035)';
    for (var i = 0; i < 26; i++) ctx.fillRect(76 + (i * 137) % 918, 80 + (i * 211) % 1260, 2, 2);
    ctx.strokeStyle = 'rgba(116, 91, 54, .08)'; ctx.lineWidth = 1;
    for (var y = 180; y < HEIGHT - 100; y += 176) handLine(ctx, 76, y, WIDTH - 76, y + 1, 'rgba(116, 91, 54, .045)', 1);
  }

  function waitForFonts() {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      return Promise.resolve(document.fonts.ready).then(function () {
        if (typeof document.fonts.load === 'function') return document.fonts.load('32px "Ma Shan Zheng"');
      }).catch(function () {});
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
    ctx.fillStyle = palette.illustration;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = palette.line; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + h * 0.78);
    ctx.bezierCurveTo(x + 220, y + h * 0.68, x + 350, y + h * 0.9, x + w - 40, y + h * 0.75);
    ctx.stroke();
    drawSnackDoodles(ctx, x + w * 0.13, y + h * 0.38, 2.4, palette);
    ctx.fillStyle = palette.red;
    ctx.font = '700 29px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('麦门旅行记', x + w * 0.69, y + h * 0.40, w * 0.24);
    ctx.fillStyle = palette.muted;
    ctx.font = '500 20px ' + FONT;
    ctx.fillText('一站一味 · 随手记下', x + w * 0.69, y + h * 0.51, w * 0.24);
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
    ctx.font = '400 ' + size + 'px ' + TITLE_FONT;
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = '400 ' + size + 'px ' + TITLE_FONT;
    }
    ctx.fillText(text, x, y);
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
    ctx.fillStyle = palette.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawPaper(ctx, palette);

    ctx.fillStyle = palette.gold;
    ctx.beginPath(); ctx.moveTo(91, 103); ctx.lineTo(373, 99); ctx.lineTo(378, 139); ctx.lineTo(96, 143); ctx.closePath(); ctx.fill();
    ctx.fillStyle = isRed ? palette.baseDark : '#4b3e2b';
    ctx.font = '700 20px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText('麦麦中国地图', 112, 111);
    ctx.fillStyle = palette.muted;
    ctx.font = '600 19px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(options.kind==='plan'?'下一站计划 · 尚未打卡':facts.date || '一页探店日记', 988, 111, 420);
    ctx.textAlign = 'left';

    ctx.fillStyle = palette.ink;
    ctx.font = '900 61px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    drawFittedTitle(ctx, facts.title, 94, 235, 890, 61, 20);
    ctx.fillStyle = palette.muted;
    ctx.font = '400 25px ' + FONT;
    ctx.fillText(options.kind==='plan'?'把想去的那家，先放进旅程。':'把喜欢的味道，记在路上。', 98, 284);
    handLine(ctx, 96, 318, 984, 316, palette.line, 2);
    drawStamp(ctx, 832, 290, options.kind === 'plan' ? '计划中' : '探店记录', palette);

    var frame = {x: 125, y: 365, w: 830, h: 585};
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(frame.x, frame.y + 3); ctx.lineTo(frame.x + frame.w - 3, frame.y);
    ctx.lineTo(frame.x + frame.w, frame.y + frame.h - 4); ctx.lineTo(frame.x + 2, frame.y + frame.h); ctx.closePath(); ctx.stroke();
    var photoBox = {x: frame.x + 26, y: frame.y + 25, w: frame.w - 52, h: 470};
    var photo = await loadPhoto(options.photoDataUrl);
    if (photo) {
      try { drawPhotoCover(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h,options.imageFit); }
      catch (_) { drawFallback(ctx, photoBox.x, photoBox.y, photoBox.w, photoBox.h, palette); }
    } else drawFallback(ctx, photoBox.x, photoBox.y, photoBox.w, photoBox.h, palette);
    ctx.strokeStyle = '#fffdf6'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(photoBox.x, photoBox.y); ctx.lineTo(photoBox.x + photoBox.w, photoBox.y);
    ctx.lineTo(photoBox.x + photoBox.w, photoBox.y + photoBox.h); ctx.lineTo(photoBox.x, photoBox.y + photoBox.h);
    ctx.closePath(); ctx.stroke();
    drawTape(ctx, frame.x + 94, frame.y - 12, 132, palette.gold);
    drawTape(ctx, frame.x + frame.w - 226, frame.y - 10, 132, palette.gold);
    ctx.fillStyle = '#5b4a38';
    ctx.font = '500 21px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(photo ? clean(options.photoCredit,70) || '旅行中的一页记录' : '在地图上，记下一站喜欢', WIDTH / 2, frame.y + 534, frame.w - 70);
    ctx.textAlign = 'left';

    var nextY = 1000;
    if (options.includePlace === true && (facts.city || facts.store)) {
      var place = [facts.city, facts.store].filter(Boolean).join(' · ');
      ctx.fillStyle = palette.ink;
      ctx.font = '700 25px ' + FONT;
      ctx.textBaseline = 'middle';
      ctx.fillText(place, 98, nextY, 884);
      nextY += 54;
    }
    if (facts.foods.length) {
      var tx = 98;
      var ty = nextY;
      facts.foods.forEach(function (food) {
        ctx.font = '600 21px ' + FONT;
        var estimated = Math.min(235, Math.max(82, ctx.measureText(food).width + 34));
        if (tx + estimated > 984) { tx = 98; ty += 56; }
        var used = roundedTag(ctx, food, tx, ty, palette);
        tx += used + 13;
      });
      nextY = ty + 66;
    }
    if (options.includeNote === true && facts.note) {
      ctx.fillStyle = palette.muted;
      ctx.font = '400 23px ' + FONT;
      ctx.textBaseline = 'top';
      var lines = wrapText(ctx, facts.note, 882);
      var noteLines = lines.slice(0, 4);
      if (lines.length > 4) {
        var last = Array.from(noteLines[3] || '');
        while (last.length && ctx.measureText(last.join('') + '…').width > 882) last.pop();
        noteLines[3] = last.join('') + '…';
      }
      noteLines.forEach(function (line, index) { ctx.fillText(line, 98, nextY + index * 33, 882); });
    }

    handLine(ctx, 96, 1322, 984, 1320, palette.line, 2);
    drawSnackDoodles(ctx, 818, 1341, .55, palette);
    ctx.fillStyle = palette.ink;
    ctx.font = '600 21px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('用麦当劳，画出自己的中国足迹。', WIDTH / 2, 1364, 888);
    ctx.textAlign = 'left';
    return canvas;
  }

  return {project: project, render: render, limits: {width: WIDTH, height: HEIGHT, photoBytes: MAX_PHOTO_BYTES}};
});
