'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Wishlist = require('../web/wishlist-engine.js');

const store = (changes = {}) => ({
  code: '001/京东', name: '人民广场麦当劳', city: '上海', address: '上海市某路1号',
  business_status: true, hours: '07:00–23:00', distance: '120m', token: 'private-token', ...changes
});

test('add uses stable source/code identity and duplicate upsert preserves the user note', () => {
  const original = Wishlist.add([], store());
  const withNote = Wishlist.normalize(original.map(item => ({...item, note: '下次尝试早餐套餐'})));
  const refreshed = Wishlist.add(withNote, store({name: '人民广场麦当劳新名称', address: '更新后的地址'}));
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].id, original[0].id);
  assert.equal(refreshed[0].name, '人民广场麦当劳新名称');
  assert.equal(refreshed[0].address, '更新后的地址');
  assert.equal(refreshed[0].note, '下次尝试早餐套餐');
  assert.equal(withNote[0].name, '人民广场麦当劳');
});

test('normalize returns a clean whitelist and stable escaped id without private fields', () => {
  const input = JSON.parse('{"source":"mcp_nearby","code":"001/京东 #1","name":"门店","city":"上海","address":"某路","province_code":"310000","business_status":true,"hours":"24小时","distance":"120m","token":"secret","orderId":"order-secret","payment_url":"https://secret.test"}');
  const before = JSON.parse(JSON.stringify(input));
  const result = Wishlist.normalize([input]);
  assert.deepEqual(result[0], {
    id: 'store-mcp_nearby-001%2F%E4%BA%AC%E4%B8%9C%20%231', source: 'mcp_nearby', code: '001/京东 #1',
    name: '门店', city: '上海', address: '某路', note: '', province_code: '310000'
  });
  assert.equal(Object.prototype.polluted, undefined);
  assert.doesNotMatch(JSON.stringify(result), /secret|orderId|payment_url|hours|distance|business_status/);
  assert.deepEqual(input, before);
  assert.notEqual(result[0], input);
});

test('normalize deduplicates source plus code while keeping separate sources distinct', () => {
  const items = [
    {source: 'mcp_nearby', code: 'same', name: '门店', note: '用户备注'},
    {source: 'mcp_nearby', code: 'same', name: '重复记录', note: '另一条'},
    {source: 'manual', code: 'same', name: '手动门店'}
  ];
  const normalized = Wishlist.normalize(items);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].name, '门店');
  assert.equal(normalized[0].note, '用户备注');
  assert.notEqual(normalized[0].id, normalized[1].id);
});

test('remove filters by stable id and does not mutate the original list', () => {
  const original = Wishlist.add(Wishlist.add([], store()), store({code: '002', name: '另一家'}));
  const removed = Wishlist.remove(original, original[0].id);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].code, '002');
  assert.equal(original.length, 2);
  assert.notEqual(removed, original);
});

test('wishlist enforces 100 unique stores, while duplicate upsert remains available at capacity', () => {
  const full = Array.from({length: Wishlist.limits.stores}, (_, index) => ({
    source: 'mcp_nearby', code: String(index), name: `门店${index}`
  }));
  const updated = Wishlist.add(full, {code: '0', name: '已更新门店'});
  assert.equal(updated.length, 100);
  assert.equal(updated[0].name, '已更新门店');
  assert.throws(() => Wishlist.add(full, {code: 'new', name: '新增门店'}), /100 stores/);
  assert.throws(() => Wishlist.normalize([...full, {source: 'mcp_nearby', code: 'overflow', name: '超出门店'}]), /100 stores/);
});

test('inputs are validated without accepting arbitrary source or prototype-shaped records', () => {
  assert.throws(() => Wishlist.add([], {code: 'x', name: '门店', source: 'unknown'}), /source is invalid/);
  assert.throws(() => Wishlist.add([], {code: '', name: '门店'}), /store code is required/);
  assert.throws(() => Wishlist.normalize([null]), /object/);
  const pollutedKey = JSON.parse('{"source":"mcp_nearby","code":"__proto__","name":"安全门店","__proto__":{"polluted":true}}');
  const safe = Wishlist.normalize([pollutedKey]);
  assert.equal(safe[0].id, 'store-mcp_nearby-__proto__');
  assert.equal(Object.prototype.polluted, undefined);
});

test('plan dates and priority survive normalization and official store refresh', () => {
  const saved = Wishlist.add([], store({planned_date: '2028-02-29', priority: true, note: '周末和朋友一起去'}));
  assert.equal(saved[0].planned_date, '2028-02-29');
  assert.equal(saved[0].priority, true);
  const refreshed = Wishlist.add(saved, store({name: '新的门店名称'}));
  assert.equal(refreshed[0].planned_date, '2028-02-29');
  assert.equal(refreshed[0].priority, true);
  assert.equal(refreshed[0].note, '周末和朋友一起去');
  const cleared = Wishlist.normalize([{...saved[0], planned_date: '', priority: false}])[0];
  assert.equal(Object.hasOwn(cleared, 'planned_date'), false);
  assert.equal(Object.hasOwn(cleared, 'priority'), false);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '26-01-01', '2026-10-10T00:00:00Z', 123]) {
    assert.throws(() => Wishlist.add([], store({planned_date: date})), /planned_date/);
  }
  assert.throws(() => Wishlist.add([], store({priority: 'yes'})), /priority/);
});

test('city and multi-word plan searches sort priority first and preserve input order for ties', () => {
  const items = ['早餐湖畔', '早餐老街', '亲子门店', '优先门店'].map((name, i) => ({
    source: 'manual', code: String(i), name, city: i === 2 ? '北京' : '上海市', note: i === 3 ? '早餐' : '',
    ...(i === 3 ? {priority: true} : {})
  }));
  assert.deepEqual(Wishlist.select(items, {city: '上海', query: '早餐'}).map(item => item.name), ['优先门店', '早餐湖畔', '早餐老街']);
  assert.deepEqual(Wishlist.select(items, {query: '上海 湖畔'}).map(item => item.name), ['早餐湖畔']);
  assert.equal(Object.hasOwn(items[0], 'id'), false);
});

test('seven-day plans cross month boundaries without counting past or undated stores', () => {
  const dates = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-06', '2027-01-07', ''];
  const items = dates.map((planned_date, i) => ({source: 'manual', code: String(i), name: String(i), planned_date}));
  assert.deepEqual(Wishlist.select(items, {when: 'week', today: '2026-12-31'}).map(item => item.code), ['1', '2', '3']);
  assert.deepEqual(Wishlist.select(items, {when: 'today', today: '2026-12-31'}).map(item => item.code), ['1']);
  assert.deepEqual(Wishlist.select(items, {when: 'unplanned'}).map(item => item.code), ['5']);
  assert.equal(Wishlist.select(items, {when: 'today', today: '2027-02-01'}).length, 0);
});
