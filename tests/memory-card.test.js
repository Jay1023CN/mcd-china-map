'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MemoryCard = require('../web/memory-card.js');

function makeMockContext() {
  const texts = [];
  const draws = [];
  return {
    texts, draws,
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillText(text) { texts.push(String(text)); }, save() {}, restore() {}, lineTo() {},
    bezierCurveTo() {}, arc() {}, setLineDash() {}, drawImage(...args) { draws.push(args); },
    measureText(text) { return {width: Array.from(String(text)).length * 12}; }
  };
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
