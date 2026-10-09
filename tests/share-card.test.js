'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ShareCard = require('../web/share-card.js');

test('shareFacts projects only approved aggregates and excludes private entry fields', () => {
  const summary = {
    confirmedCount: 2,
    distinctProvinces: 1,
    distinctCities: 1,
    distinctStores: 1,
    provinces: [{province_code: '310000', count: 2, store: 'PRIVATE_STORE', address: 'PRIVATE_ADDRESS'}],
    cities: [{city: '上海', count: 2, store: 'PRIVATE_STORE', name: 'PRIVATE_NAME', token: 'PRIVATE_TOKEN'}],
    entries: [{id: 'PRIVATE_ORDER_ID', store: 'PRIVATE_STORE', address: 'PRIVATE_ADDRESS', token: 'PRIVATE_TOKEN'}],
    stores: [{store: 'PRIVATE_STORE'}]
  };
  const facts = ShareCard.shareFacts(summary, {includeCities: true, provinceNames: new Map([['310000', '上海市']])});
  assert.deepEqual(facts.provinces, [{code: '310000', name: '上海市', count: 2}]);
  assert.deepEqual(facts.cities, [{city: '上海', count: 2}]);
  assert.deepEqual(Object.keys(facts).sort(), [
    'cities', 'confirmedCount', 'distinctCities', 'distinctProvinces', 'distinctStores',
    'includeCities', 'provinceTags', 'provinces', 'theme', 'title'
  ].sort());
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE_(?:STORE|ADDRESS|NAME|TOKEN|ORDER_ID)/);
});

test('zero-footprint summary remains exportable and defaults to paper without city labels', () => {
  const facts = ShareCard.shareFacts({confirmedCount: 0, distinctProvinces: 0, distinctCities: 0,
    distinctStores: 0, provinces: [], cities: [], entries: []});
  assert.equal(facts.confirmedCount, 0);
  assert.equal(facts.theme, 'paper');
  assert.equal(facts.includeCities, false);
  assert.deepEqual(facts.provinces, []);
  assert.deepEqual(facts.cities, []);
});

test('themes are constrained and title text is sanitized and bounded', () => {
  const summary = {confirmedCount: 1, provinces: [{province_code: '310000', count: 1}]};
  const red = ShareCard.shareFacts(summary, {theme: 'red', title: '  麦麦\n足迹  '});
  const fallback = ShareCard.shareFacts(summary, {theme: 'remote-image'});
  assert.equal(red.theme, 'red');
  assert.equal(red.title, '麦麦 足迹');
  assert.equal(fallback.theme, 'paper');
  assert.ok(ShareCard.shareFacts(summary, {title: 'a'.repeat(100)}).title.length <= 36);
});

test('province and city labels have display caps and only retain aggregate fields', () => {
  const provinces = Array.from({length: 15}, (_, index) => ({province_code: String(100000 + index), count: 15 - index, address: 'PRIVATE_ADDRESS'}));
  const cities = Array.from({length: 20}, (_, index) => ({city: `城市${index}`, count: 20 - index, name: 'PRIVATE_NAME', store: 'PRIVATE_STORE'}));
  const facts = ShareCard.shareFacts({confirmedCount: 20, distinctProvinces: 15, distinctCities: 20,
    distinctStores: 20, provinces, cities}, {includeCities: true});
  assert.equal(facts.provinceTags.length, ShareCard.limits.provinceTags);
  assert.equal(facts.cities.length, ShareCard.limits.cityTags);
  assert.deepEqual(Object.keys(facts.cities[0]).sort(), ['city', 'count']);
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE_/);
});

test('render returns a full-size canvas and draws an invitation for an empty summary', async () => {
  const oldDocument = global.document;
  const drawnText = [];
  const ctx = {
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillText(text) { drawnText.push(String(text)); }, save() {}, restore() {}, rect() {}, clip() {}, lineTo() {},
    measureText(text) { return {width: String(text).length * 10}; }
  };
  const canvas = {width: 0, height: 0, getContext() { return ctx; }};
  global.document = {createElement(name) { assert.equal(name, 'canvas'); return canvas; }};
  try {
    const rendered = await ShareCard.render({confirmedCount: 0, distinctProvinces: 0, distinctCities: 0,
      distinctStores: 0, provinces: [], cities: [], entries: []}, {provinces: {type: 'FeatureCollection', features: []}});
    assert.equal(rendered, canvas);
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1440);
    assert.ok(drawnText.some(text => text.includes('第一家麦当劳')));
  } finally {
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  }
});
