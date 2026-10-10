'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MemoryCard = require('../web/memory-card.js');

function makeMockContext() {
  const texts = [];
  const draws = [];
  const textCalls = [];
  const transforms = [];
  return {
    texts, draws, textCalls, transforms,
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillText(...args) { texts.push(String(args[0])); textCalls.push({text: String(args[0]), args, font: this.font}); }, save() {}, restore() {}, lineTo() {},
    bezierCurveTo() {}, arc() {}, ellipse() {}, translate(...args) { transforms.push(['translate', ...args]); },
    rotate(...args) { transforms.push(['rotate', ...args]); }, setLineDash() {}, drawImage(...args) { draws.push(args); },
    measureText(text) {
      const size = Number((this.font || '').match(/(\d+)px/)?.[1] || 12);
      return {width: Array.from(String(text)).length * size};
    }
  };
}

function measuredWidth(ctx, call) {
  const previousFont = ctx.font;
  ctx.font = call.font;
  const width = ctx.measureText(call.text).width;
  ctx.font = previousFont;
  return width;
}

function withCanvas(t) {
  const oldDocument = global.document;
  const ctx = makeMockContext();
  const canvas = {width: 0, height: 0, getContext() { return ctx; }};
  global.document = {fonts: {ready: Promise.resolve()}, createElement(name) {
    assert.equal(name, 'canvas');
    return canvas;
  }};
  t.after(() => {
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  });
  return {canvas, ctx};
}

test('project keeps an explicit display whitelist and honors optional place/note', () => {
  const entry = {
    id: 'PRIVATE_ID', token: 'PRIVATE_TOKEN', orderID: 'PRIVATE_ORDER', store_reference: 'PRIVATE_REF',
    address: 'PRIVATE_ADDRESS', title: '记录标题', date: '2026-10-10', city: '上海', store: '人民广场店',
    foods: ['薯条', {name: '麦辣鸡腿堡'}, '奶昔', '派', '咖啡', '多余餐品'], note: '随手记'.repeat(80)
  };
  const hidden = MemoryCard.project(entry);
  assert.deepEqual(Object.keys(hidden).sort(), ['date', 'foods', 'theme', 'title']);
  assert.equal(hidden.foods.length, 5);
  assert.equal(hidden.theme, 'paper');
  assert.doesNotMatch(JSON.stringify(hidden), /PRIVATE_|上海|人民广场|随手记/);

  const shown = MemoryCard.project(entry, {includePlace: true, includeNote: true, theme: 'red'});
  assert.equal(shown.city, '上海');
  assert.equal(shown.store, '人民广场店');
  assert.equal(shown.note.length, 160);
  assert.equal(shown.theme, 'red');
  assert.equal(Object.hasOwn(shown, 'address'), false);
  assert.equal(Object.hasOwn(shown, 'store_reference'), false);
  assert.doesNotMatch(JSON.stringify(shown), /PRIVATE_/);
});

test('render draws an original no-photo travel illustration and returns 1080x1440 canvas', async t => {
  const {canvas, ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  const result = await MemoryCard.render({date: '2026-10-10', foods: ['薯条']});
  assert.equal(result, canvas);
  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1440);
  assert.equal(ctx.draws.length, 0);
  assert.ok(ctx.texts.includes('在地图上，记下一站喜欢'));
  assert.ok(ctx.texts.includes('用麦当劳，画出自己的中国足迹。'));
  assert.ok(ctx.texts.includes('2026-10-10'));
});

test('render lays out the title on two hand-drawn lines and rotates the white photo border', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });

  await MemoryCard.render({title: '下一站，去湖边吃麦'}, {kind: 'plan', includePlace: true, includeNote: true});
  assert.ok(ctx.texts.includes('下一站，'));
  assert.ok(ctx.texts.includes('去湖边吃麦'));
  assert.ok(ctx.transforms.some(call => call[0] === 'translate' && call[1] === 540 && call[2] === 660));
  assert.ok(ctx.transforms.some(call => call[0] === 'rotate' && Math.abs(call[1] + Math.PI / 180) < 1e-8));
  assert.ok(ctx.texts.includes('想去 · 尚未打卡'));
  assert.ok(!ctx.texts.includes('这一页的随记'));
});

test('title splitting keeps classifier phrases together and never leaves punctuation at a line start', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  await MemoryCard.render({}, {title: '周末的一页麦麦记'});
  const parts = ctx.textCalls.filter(call => call.args[1] === 84 || call.args[1] === 100 && call.args[2] === 285).map(call => call.text);
  assert.deepEqual(parts, ['周末的', '一页麦麦记']);
  const start = ctx.textCalls.length;
  await MemoryCard.render({}, {title: '周末，去一页麦麦记'});
  const punctuationParts = ctx.textCalls.slice(start).filter(call => call.args[1] === 84 || call.args[1] === 100 && call.args[2] === 285).map(call => call.text);
  assert.equal(punctuationParts.length, 2);
  assert.ok(punctuationParts.every(text => !/^[，。！？、：；,.!?;:]/.test(text)));
});

test('short content uses larger city, store and note handwriting below the full-size photo', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  await MemoryCard.render({city: '杭州', store: '千岛湖麦当劳', note: '想去湖边，顺便吃一顿。'}, {
    kind: 'plan', includePlace: true, includeNote: true
  });
  assert.equal(ctx.textCalls.find(call => call.text === '杭州').font.match(/(\d+)px/)[1], '34');
  assert.equal(ctx.textCalls.find(call => call.text === '千岛湖麦当劳').font.match(/(\d+)px/)[1], '30');
  const note = ctx.textCalls.find(call => call.text === '想去湖边，顺便吃一顿。');
  assert.equal(note.font.match(/(\d+)px/)[1], '34');
  assert.ok(note.args[2] >= 1090 && note.args[2] <= 1160);
});

test('short photo annotations stay outside the picture and connect with a small curved arrow', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  await MemoryCard.render({}, {photoAnnotation: '圆顶门店'});
  const annotation = ctx.textCalls.find(call => call.text === '圆顶门店');
  assert.ok(annotation);
  assert.equal(annotation.args[1], 1004);
  assert.equal(annotation.args[2], 352);
  assert.equal(annotation.args.length, 3);
});

test('long city, store and note text remains readable while optional hidden fields stay out', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  const city = '超长城市名称'.repeat(4);
  const store = '中央商务区超长门店名称'.repeat(3);
  const note = '这是一段很长的旅行随记，记录当时的感受。'.repeat(7);

  await MemoryCard.render({city, store, note}, {includePlace: true, includeNote: true});
  assert.ok(ctx.texts.join('').includes(city));
  assert.ok(ctx.texts.join('').includes('中央商务区'));
  assert.ok(ctx.texts.join('').includes('旅行随记'));
  assert.equal(MemoryCard.project({city, store, note}).city, undefined);
  assert.equal(MemoryCard.project({city, store, note}).store, undefined);
  assert.equal(MemoryCard.project({city, store, note}).note, undefined);
});

test('contain image fitting keeps the full embedded photo and centers it inside the photo area', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  global.Image = class {
    constructor() { this.naturalWidth = 600; this.naturalHeight = 1200; }
    set src(_) { queueMicrotask(() => this.onload()); }
  };
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  await MemoryCard.render({}, {photoDataUrl: 'data:image/jpeg;base64,aGVsbG8=', imageFit: 'contain'});
  assert.equal(ctx.draws.length, 1);
  assert.equal(ctx.draws[0].length, 5);
  assert.ok(ctx.draws[0][1] > -352);
  assert.ok(ctx.draws[0][3] < 710);
});

test('transparent snack image keeps its aspect ratio and sits beside the note', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  const snack = {naturalWidth: 1536, naturalHeight: 1024};

  await MemoryCard.render({note: '把想去的那家，先放进旅程。'}, {includeNote: true, snackImage: snack});
  const draw = ctx.draws.find(args => args[0] === snack);
  assert.ok(draw);
  assert.equal(draw[1], 715);
  assert.equal(draw[3], 280);
  assert.equal(draw[4], 280 * 1024 / 1536);
  assert.ok(ctx.textCalls.some(call => call.text.includes('把想去的那家')));
  assert.ok(!ctx.texts.includes('这一页的随记'));
});

test('maximum place, food, note and photo source text stays above the footer at readable size', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  global.Image = class {
    constructor() { this.naturalWidth = 1200; this.naturalHeight = 800; }
    set src(_) { queueMicrotask(() => this.onload()); }
  };
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });
  const city = '超长城市名称'.repeat(4);
  const store = '中央商务区超长门店名称'.repeat(3);
  const foods = Array.from({length: 5}, (_,i) => ('超长餐品名称' + i).repeat(3));
  const note = '这是一段很长的旅行随记，记录当时的感受。'.repeat(7);
  const credit = '公开照片来源说明'.repeat(8);

  await MemoryCard.render({city, store, foods, note}, {
    includePlace: true, includeNote: true, photoDataUrl: 'data:image/jpeg;base64,aGVsbG8=', photoCredit: credit
  });
  const bodyCalls = ctx.textCalls.filter(call => call.text.includes('城市') || call.text.includes('中央商务') ||
    call.text.includes('超长餐品') || call.text.includes('旅行随记') || call.text.includes('这一页的随记'));
  assert.ok(bodyCalls.length > 0);
  assert.ok(bodyCalls.every(call => call.args[2] <= 1330));
  assert.ok(bodyCalls.every(call => Number(call.font.match(/(\d+)px/)[1]) >= 22));
  const sourceCalls = ctx.textCalls.filter(call => call.text.includes('公开照片来源说明'));
  assert.ok(sourceCalls.length >= 1);
  assert.ok(sourceCalls.every(call => call.args[2] >= 1345 && Number(call.font.match(/(\d+)px/)[1]) === 22));
  assert.equal(sourceCalls.map(call => call.text).join(''), credit);
});

test('render accepts an embedded photo, center-crops to fit and never fetches', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  const oldFetch = global.fetch;
  let fetched = false;
  global.fetch = () => { fetched = true; throw new Error('network access is forbidden'); };
  global.Image = class {
    constructor() { this.naturalWidth = 1200; this.naturalHeight = 800; }
    set src(value) { assert.match(value, /^data:image\/jpeg;base64,/); queueMicrotask(() => this.onload()); }
  };
  t.after(() => {
    if (oldImage === undefined) delete global.Image; else global.Image = oldImage;
    if (oldFetch === undefined) delete global.fetch; else global.fetch = oldFetch;
  });
  await MemoryCard.render({}, {photoDataUrl: 'data:image/jpeg;base64,aGVsbG8='});
  assert.equal(ctx.draws.length, 1);
  assert.equal(ctx.draws[0].length, 9);
  assert.equal(ctx.draws[0][7], 902);
  assert.equal(ctx.draws[0][8], 562);
  assert.equal(fetched, false);
});

test('invalid external photo and image load failure both use illustration fallback', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  let imageConstructed = 0;
  global.Image = class {
    constructor() { imageConstructed++; }
    set src(_) { queueMicrotask(() => this.onerror(new Error('failed'))); }
  };
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });

  await MemoryCard.render({}, {photoDataUrl: 'https://example.invalid/photo.jpg'});
  assert.equal(imageConstructed, 0);
  await MemoryCard.render({}, {photoDataUrl: 'data:image/webp;base64,aGVsbG8='});
  assert.equal(imageConstructed, 1);
  assert.equal(ctx.draws.length, 0);
  assert.ok(ctx.texts.filter(text => text === '在地图上，记下一站喜欢').length >= 2);
});

test('plan cards keep the plan label and subtitle despite an entry date and custom title', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });

  await MemoryCard.render({date: '2026-10-10', title: '自定义标题'}, {
    kind: 'plan', title: '自定义标题'
  });
  assert.ok(ctx.texts.includes('想去 · 尚未打卡'));
  assert.ok(ctx.texts.includes('把想去的那家，先放进旅程。'));
  assert.equal(ctx.textCalls.filter(call => call.args[1] === 84 || call.args[1] === 100 && call.args[2] === 285).map(call => call.text).join(''), '自定义标题');
  assert.ok(ctx.texts.includes('在地图上，记下一站喜欢'));
  assert.ok(!ctx.texts.includes('2026-10-10'));
});

test('long memory-card titles break naturally and long food labels remain readable without canvas compression', async t => {
  const {ctx} = withCanvas(t);
  const oldImage = global.Image;
  delete global.Image;
  t.after(() => { if (oldImage === undefined) delete global.Image; else global.Image = oldImage; });

  await MemoryCard.render({foods: ['超长餐品名称'.repeat(4)]}, {title: '长标题'.repeat(14)});
  const titleParts = ctx.textCalls.filter(call => call.args[1] === 84 || call.args[1] === 100 && call.args[2] === 285);
  assert.equal(titleParts.map(call => call.text).join(''), '长标题'.repeat(14));
  assert.ok(titleParts.every(call => call.args.length === 3));
  assert.ok(titleParts.every(call => Number(call.font.match(/(\d+)px/)[1]) < 61));
  assert.ok(titleParts.every(call => measuredWidth(ctx, call) <= 810));
  const food = ctx.textCalls.find(call => call.text.includes('超长餐品名称'.repeat(4)));
  assert.ok(food);
  assert.equal(food.args.length, 3);
  assert.ok(measuredWidth(ctx, food) <= 820);
});
