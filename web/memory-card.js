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

  function waitForFonts() {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      return Promise.resolve(document.fonts.ready).catch(function () {});
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
    roundedRect(ctx, x, y, width, 44, 18);
    ctx.fillStyle = palette.tag;
    ctx.fill();
    ctx.fillStyle = palette.tagInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + width / 2, y + 23, width - 20);
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
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 12]);
    ctx.beginPath();
    ctx.moveTo(x + 110, y + h * 0.67);
    ctx.bezierCurveTo(x + 250, y + h * 0.22, x + 460, y + h * 0.82, x + w - 105, y + h * 0.33);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.red;
    ctx.beginPath();
    ctx.arc(x + w * 0.29, y + h * 0.48, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.gold;
    ctx.beginPath();
    ctx.arc(x + w * 0.29, y + h * 0.48, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.paper;
    roundedRect(ctx, x + w * 0.57, y + h * 0.28, w * 0.24, h * 0.47, 12);
    ctx.fill();
    ctx.fillStyle = palette.red;
    ctx.font = '700 29px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('麦门旅行记', x + w * 0.69, y + h * 0.43, w * 0.2);
    ctx.fillStyle = palette.muted;
    ctx.font = '500 20px ' + FONT;
    ctx.fillText('一站一味 · 随手记下', x + w * 0.69, y + h * 0.54, w * 0.2);
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
      base: '#b93427', baseDark: '#98271f', paper: '#fff8e9', ink: '#fff8e9', muted: '#f1c5a7',
      line: '#e9a47d', red: '#f2c849', gold: '#f2c849', illustration: '#f9dfc2', tag: '#a72f25', tagInk: '#fff8e9'
    } : {
      base: '#f3eddb', baseDark: '#e9dfc8', paper: '#fff9eb', ink: '#29231b', muted: '#806f58',
      line: '#d8c9ad', red: '#dc442e', gold: '#ecc74c', illustration: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840'
    };
    ctx.fillStyle = palette.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = palette.baseDark;
    ctx.fillRect(36, 36, WIDTH - 72, HEIGHT - 72);
    ctx.fillStyle = isRed ? palette.base : palette.paper;
    ctx.fillRect(52, 52, WIDTH - 104, HEIGHT - 104);

    ctx.fillStyle = palette.gold;
    roundedRect(ctx, 92, 88, 282, 46, 6);
    ctx.fill();
    ctx.fillStyle = isRed ? palette.baseDark : '#4b3e2b';
    ctx.font = '700 20px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText('麦麦中国地图', 112, 111);
    ctx.fillStyle = palette.muted;
    ctx.font = '600 19px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(facts.date || '一页探店日记', 988, 111, 420);
    ctx.textAlign = 'left';

    ctx.fillStyle = palette.ink;
    ctx.font = '900 61px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(facts.title, 94, 235, 890);
    ctx.fillStyle = palette.muted;
    ctx.font = '400 25px ' + FONT;
    ctx.fillText('把喜欢的味道，记在路上。', 98, 284);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(96, 318);
    ctx.lineTo(984, 318);
    ctx.stroke();

    var frame = {x: 125, y: 365, w: 830, h: 585};
    ctx.save();
    ctx.shadowColor = 'rgba(45, 30, 12, 0.16)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.restore();
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    var photoBox = {x: frame.x + 26, y: frame.y + 25, w: frame.w - 52, h: 470};
    var photo = await loadPhoto(options.photoDataUrl);
    if (photo) {
      try { drawPhotoCover(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h,options.imageFit); }
      catch (_) { drawFallback(ctx, photoBox.x, photoBox.y, photoBox.w, photoBox.h, palette); }
    } else drawFallback(ctx, photoBox.x, photoBox.y, photoBox.w, photoBox.h, palette);
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

    ctx.strokeStyle = palette.line;
    ctx.beginPath();
    ctx.moveTo(96, 1322);
    ctx.lineTo(984, 1322);
    ctx.stroke();
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
