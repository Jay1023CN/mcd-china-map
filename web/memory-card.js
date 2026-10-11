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

  function drawChinaMap(ctx, x, y, w, h, palette, options, facts) {
    ctx.fillStyle = '#f4efe4'; ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(151,127,89,.12)'; ctx.lineWidth = 1;
    for (var gx=0; gx<6; gx++) {
      ctx.beginPath(); ctx.moveTo(x + gx*w/5, y + 18); ctx.lineTo(x + gx*w/5, y + h - 18); ctx.stroke();
    }
    for (var gy=0; gy<4; gy++) {
      ctx.beginPath(); ctx.moveTo(x + 18, y + gy*(h-1)/3); ctx.lineTo(x + w - 18, y + gy*(h-1)/3); ctx.stroke();
    }
    var map = {x:x + w*.12, y:y + h*.12, w:w*.62, h:h*.75};
    var bounds = {minLon:73,maxLon:135,minLat:17,maxLat:54};
    var point = function (coordinate) {
      return [map.x + (coordinate[0]-bounds.minLon)/(bounds.maxLon-bounds.minLon)*map.w,
        map.y + (bounds.maxLat-coordinate[1])/(bounds.maxLat-bounds.minLat)*map.h];
    };
    var features = Array.isArray(options.mapFeatures) ? options.mapFeatures : [];
    if (features.length) {
      features.forEach(function (feature) {
        var geometry = feature && feature.geometry;
        if (!geometry || !Array.isArray(geometry.coordinates)) return;
        var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        var selected = options.includePlace === true && String(feature.properties && feature.properties.adcode) === String(options.provinceCode || facts.province_code || '');
        ctx.beginPath();
        polygons.forEach(function (polygon) {
          var ring = polygon && polygon[0];
          if (!Array.isArray(ring) || ring.length < 3) return;
          var step = Math.max(1, Math.ceil(ring.length/180));
          for (var i=0; i<ring.length; i+=step) {
            var xy = point(ring[i]);
            if (i===0) ctx.moveTo(xy[0],xy[1]); else ctx.lineTo(xy[0],xy[1]);
          }
          var last = point(ring[ring.length-1]); ctx.lineTo(last[0],last[1]); ctx.closePath();
        });
        ctx.fillStyle = selected ? '#f0d88a' : '#e2d2b5';
        ctx.strokeStyle = selected ? '#a64e38' : '#91795b';
        ctx.lineWidth = selected ? 2.6 : 1.35;
        ctx.fill('evenodd'); ctx.stroke();
      });
    } else {
      // A small offline silhouette keeps the map visible if boundary data is unavailable.
      var outline = [[.10,.22],[.18,.13],[.31,.16],[.39,.09],[.52,.17],[.66,.15],[.73,.25],[.87,.28],[.83,.39],[.91,.48],[.79,.54],[.77,.68],[.67,.67],[.59,.79],[.48,.74],[.40,.85],[.32,.73],[.22,.76],[.18,.63],[.08,.56],[.14,.44],[.05,.34]];
      ctx.beginPath();
      outline.forEach(function (p,index) { var px=map.x+p[0]*map.w,py=map.y+p[1]*map.h;if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py); });
      ctx.closePath();ctx.fillStyle='#e2d2b5';ctx.strokeStyle='#91795b';ctx.lineWidth=1.7;ctx.fill();ctx.stroke();
    }
    var location = options.includePlace === true && options.mapLocation;
    if (location && Number.isFinite(location.lon) && Number.isFinite(location.lat) &&
        location.lon >= bounds.minLon && location.lon <= bounds.maxLon && location.lat >= bounds.minLat && location.lat <= bounds.maxLat) {
      var marker = point([location.lon,location.lat]);
      ctx.fillStyle='rgba(181,53,38,.16)';ctx.beginPath();ctx.arc(marker[0],marker[1],19,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#bd3829';ctx.beginPath();ctx.arc(marker[0],marker[1],10,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fffaf0';ctx.beginPath();ctx.arc(marker[0],marker[1],3,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle=palette.red;ctx.font='600 15px '+FONT;ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ctx.fillText('MY CHINA MAP',x+w*.79,y+31);
    ctx.fillStyle=palette.ink;ctx.font='500 30px '+TITLE_FONT;
    var mapLabel=options.includePlace===true && facts.city ? facts.city : (options.kind==='plan'?'下一站':'我的足迹');
    wrapText(ctx,mapLabel,w*.19).slice(0,2).forEach(function(line,index){ctx.fillText(line,x+w*.79,y+78+index*35);});
    ctx.fillStyle=palette.muted;ctx.font='400 22px '+FONT;
    ctx.fillText(location?(location.precision==='city'?'城市参考点位':'此站已标记'):'走过的地方',x+w*.79,y+151,w*.19);
    ctx.textAlign='left';ctx.restore();
  }

  function drawStar(ctx, x, y, radius, color) {
    ctx.beginPath();
    for (var i=0;i<10;i++) {
      var angle=-Math.PI/2+i*Math.PI/5, size=i%2?radius*.42:radius;
      var px=x+Math.cos(angle)*size,py=y+Math.sin(angle)*size;
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
  }

  function drawHeart(ctx, x, y, size, color) {
    ctx.beginPath();ctx.moveTo(x,y+size*.35);
    ctx.bezierCurveTo(x-size*.75,y-size*.15,x-size*.5,y-size*.75,x,y-size*.28);
    ctx.bezierCurveTo(x+size*.5,y-size*.75,x+size*.75,y-size*.15,x,y+size*.35);
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
  }

  function drawStickers(ctx, options, palette) {
    var stickers=Array.isArray(options.stickers)?options.stickers:[];
    if(stickers.includes('sparkles')){drawStar(ctx,974,335,17,palette.gold);drawStar(ctx,1011,359,9,palette.red);}
    if(stickers.includes('heart'))drawHeart(ctx,72,335,27,palette.red);
    if(stickers.includes('stamp'))drawStamp(ctx,788,308,'这一餐记着了',palette);
    var custom=clean(options.customStickerText,10);
    if(custom){
      ctx.save();ctx.translate(922,329);ctx.rotate(-.035);ctx.strokeStyle=palette.red;ctx.fillStyle=palette.red;ctx.lineWidth=2;
      ctx.strokeRect(-104,-21,208,42);ctx.font='500 22px '+TITLE_FONT;ctx.textAlign='center';ctx.textBaseline='middle';
      var text=custom;while(Array.from(text).length>2&&ctx.measureText(text).width>184)text=Array.from(text).slice(0,-1).join('');
      ctx.fillText(text,0,1,184);ctx.restore();
    }
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

  function cardDate(value) {
    var match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');
    return match?Number(match[1])+'年'+Number(match[2])+'月'+Number(match[3])+'日':value;
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

  function drawFoodGrid(ctx, foods, images, palette, startY, options) {
    var x=104,width=872,gap=16,columns=2,cellWidth=(width-gap)/columns;
    ctx.fillStyle=palette.muted;ctx.font='500 22px '+FONT;ctx.textBaseline='alphabetic';
    ctx.fillText('这顿吃了',x,startY+23);
    ctx.fillStyle=palette.gold;ctx.beginPath();ctx.arc(x+105,startY+16,4,0,Math.PI*2);ctx.fill();
    var y=startY+38,foodSticker=Array.isArray(options.stickers)&&options.stickers.includes('food');
    ctx.font='500 '+(foods.length>3?28:30)+'px '+TITLE_FONT;
    for(var row=0;row<Math.ceil(foods.length/columns);row++){
      var rowItems=foods.slice(row*columns,row*columns+columns),prepared=rowItems.map(function(name){
        var textWidth=cellWidth-88,lines=wrapText(ctx,name,textWidth);
        return {name:name,lines:lines,image:foodSticker?images.get(name):null};
      });
      var cellHeight=Math.max(68,...prepared.map(function(item){return 16+item.lines.length*36;}));
      prepared.forEach(function(item,column){
        var cx=x+column*(cellWidth+gap);
        ctx.fillStyle='#fffdf8';roundedRect(ctx,cx,y,cellWidth,cellHeight,9);ctx.fill();
        ctx.strokeStyle=palette.line;ctx.lineWidth=1.2;ctx.stroke();
        var textX=cx+16;
        if(item.image){
          var iw=Number(item.image.naturalWidth||item.image.width),ih=Number(item.image.naturalHeight||item.image.height);
          if(iw>0&&ih>0){
            var side=48,scale=Math.max(side/iw,side/ih),sw=side/scale,sh=side/scale;
            ctx.save();ctx.beginPath();ctx.rect(cx+10,y+(cellHeight-side)/2,side,side);ctx.clip();
            ctx.drawImage(item.image,(iw-sw)/2,(ih-sh)/2,sw,sh,cx+10,y+(cellHeight-side)/2,side,side);ctx.restore();textX=cx+70;
          }
        }else{
          ctx.fillStyle=palette.gold;ctx.beginPath();ctx.arc(cx+29,y+cellHeight/2,4,0,Math.PI*2);ctx.fill();textX=cx+46;
        }
        ctx.fillStyle=palette.ink;ctx.font='500 '+(foods.length>3?28:30)+'px '+TITLE_FONT;ctx.textBaseline='middle';
        var lineHeight=36,totalHeight=item.lines.length*lineHeight,firstY=y+(cellHeight-totalHeight)/2+lineHeight/2;
        item.lines.forEach(function(line,index){ctx.fillText(line,textX,firstY+index*lineHeight,cellWidth-(textX-cx)-14);});
      });
      y+=cellHeight+10;
    }
    return y;
  }

  function contentProfile(facts, options) {
    var placeLength=options.includePlace===true?(facts.city||'').length+(facts.store||'').length:0;
    var noteLength=options.includeNote===true?(facts.note||'').length:0;
    var contentLength=placeLength+noteLength;
    facts.foods.forEach(function(food){contentLength+=food.length;});
    var cityLines=options.includePlace===true&&facts.city?Math.max(1,Math.ceil(facts.city.length/24)):0;
    var storeLines=options.includePlace===true&&facts.store?Math.max(1,Math.ceil(facts.store.length/31)):0;
    var foodRows=Math.ceil(facts.foods.length/2),noteLines=options.includeNote===true&&facts.note?Math.min(3,Math.max(1,Math.ceil(facts.note.length/28))):0;
    var bodySpace=(cityLines+storeLines)*40+(foodRows?48+foodRows*84:0)+noteLines*36+36;
    var photoHeight=Math.max(330,Math.min(540,940-bodySpace));
    var citySize=contentLength<=100?34:contentLength<=220?31:28;
    var storeSize=contentLength<=100?30:contentLength<=220?28:26;
    var noteSize=contentLength<=120?34:contentLength<=220?31:28;
    var foodSize=contentLength<=160?30:28;
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
      base: '#d44632', baseDark: '#98271f', paper: '#fff8e9', ink: '#29231b', muted: '#5f503d',
      line: '#d8c9ad', red: '#d44632', gold: '#ecc74c', illustration: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840'
    } : {
      base: '#f3eddb', baseDark: '#e9dfc8', paper: '#fff9eb', ink: '#29231b', muted: '#5f503d',
      line: '#d8c9ad', red: '#dc442e', gold: '#ecc74c', illustration: '#f8f0df', tag: '#f0e5cc', tagInk: '#6d5840'
    };
    drawPaper(ctx, palette);
    var profile = contentProfile(facts, options);
    var foodImages=new Map();
    if(Array.isArray(options.foodImages)){
      await Promise.all(options.foodImages.filter(function(item){return item&&facts.foods.includes(clean(item.name,24))&&typeof item.dataUrl==='string';}).map(async function(item){
        var image=await loadPhoto(item.dataUrl);if(image)foodImages.set(clean(item.name,24),image);
      }));
    }

    ctx.fillStyle = palette.ink;
    ctx.font = '600 24px ' + TITLE_FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText('麦麦中国地图', 76, 80);
    handLine(ctx, 76, 101, 280, 99, palette.gold, 3);
    if (options.kind === 'plan') {
      ctx.textAlign = 'right';
      drawStamp(ctx, 829, 54, '想去 · 尚未打卡', palette);
    } else {
      ctx.fillStyle = palette.muted; ctx.font = '500 27px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(cardDate(facts.date) || '一页探店记', 1004, 80);
    }
    ctx.textAlign = 'left';
    drawHandTitle(ctx, facts.title, palette);
    ctx.fillStyle = palette.muted; ctx.font = '400 22px ' + FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(options.kind === 'plan' ? '把想去的那家，先放进旅程。' : '把喜欢的味道，记在路上。', 100, 355);
    drawStickers(ctx,options,palette);

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
      catch (_) { drawChinaMap(ctx,-photoBox.w/2,-photoBox.h/2,photoBox.w,photoBox.h,palette,options,facts); }
    } else drawChinaMap(ctx,-photoBox.w/2,-photoBox.h/2,photoBox.w,photoBox.h,palette,options,facts);
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
    if (facts.foods.length) nextY=drawFoodGrid(ctx,facts.foods,foodImages,palette,nextY,options);
    if (options.includeNote === true && facts.note) {
      ctx.fillStyle = palette.ink; ctx.font = '400 ' + profile.noteSize + 'px ' + TITLE_FONT; ctx.textBaseline = 'alphabetic';
      var noteWidth = 820;
      var noteLines = wrapText(ctx, facts.note, noteWidth);
      if(noteLines.length>3)noteLines=noteLines.slice(0,2).concat('…');
      noteLines.forEach(function (line, index) { ctx.fillText(line, 122, nextY + profile.noteSize + index * (profile.noteSize+9)); });
      var finalNoteLine = noteLines[noteLines.length - 1] || '';
      var noteEndX = Math.min(122 + ctx.measureText(finalNoteLine).width + 5, noteWidth + 122);
      var noteEndY = nextY + profile.noteSize + (noteLines.length - 1) * (profile.noteSize+9) + 5;
      if (noteEndX < 940) handLine(ctx, noteEndX, noteEndY, Math.min(noteEndX+90,940), noteEndY-3, palette.gold, 2);
      nextY += profile.noteSize + noteLines.length*(profile.noteSize+9);
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
