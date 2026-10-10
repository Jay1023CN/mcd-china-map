'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const OrderJournal = require('../web/order-journal.js');

const cities = [
  {city: '上海', province_code: '310000', lat: 31.23, lon: 121.47},
  {city: '北京', province_code: '110000', lat: 39.9, lon: 116.4}
];
const defaultPhoto = {
  url: 'https://example.com/store.jpg', source_url: 'https://example.com/source',
  attribution: '虚构公开资料', caption: '虚构门店照'
};
const stores = [{
  name: '麦当劳上海示例餐厅', aliases: ['上海示例店'], city: '上海', province_code: '310000', default_photo: defaultPhoto
}];
const order = (id, changes = {}) => ({
  id, date: '2026-10-08', country_code: 'CN', province_code: '', city: '', store: '上海示例店',
  foods: ['咖啡'], note: '中国大陆订单线索；请核对是否本人到店。', source: 'mcp_candidate', confirmed: false, ...changes
});
const archive = entries => ({version: 1, data_kind: 'mcp', entries});

test('materializes an order with matched city coordinates and public default photo', () => {
  const result = OrderJournal.materialize(archive([order('mcp-aaaaaaaaaaaaaaaaaaaaaaaa')]), {cities, stores});
  const entry = result.entries[0];
  assert.equal(result.entries.length, 1);
  assert.equal(entry.source, 'manual');
  assert.equal(entry.confirmed, true);
  assert.equal(entry.origin, 'mcp');
  assert.equal(entry.city, '上海');
  assert.equal(entry.province_code, '310000');
  assert.deepEqual(entry.location, {lat: 31.23, lon: 121.47, precision: 'city'});
  assert.deepEqual(entry.default_photo, defaultPhoto);
  assert.equal(entry.note, '', 'generated order hint should not become a personal note');
});

test('preserves a personal note and uploaded photo while adding the matched store default', () => {
  const personalPhoto = {data_url: 'data:image/png;base64,YQ=='};
  const result = OrderJournal.materialize(archive([order('mcp-bbbbbbbbbbbbbbbbbbbbbbbb', {
    city: '上海市', province_code: '310000', note: '想起那天的雨。', photo: personalPhoto
  })]), {cities, stores});
  const entry = result.entries[0];
  assert.equal(entry.note, '想起那天的雨。');
  assert.deepEqual(entry.photo, personalPhoto);
  assert.deepEqual(entry.default_photo, defaultPhoto);
  assert.equal(entry.city, '上海市', 'known city spelling should be preserved');
});

test('keeps separate orders at the same store as separate journal pages', () => {
  const result = OrderJournal.materialize(archive([
    order('mcp-cccccccccccccccccccccccc', {date: '2026-10-08'}),
    order('mcp-dddddddddddddddddddddddd', {date: '2026-10-09'})
  ]), {cities, stores});
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map(entry => entry.id), ['mcp-cccccccccccccccccccccccc', 'mcp-dddddddddddddddddddddddd']);
  assert.ok(result.entries.every(entry => entry.source === 'manual' && entry.confirmed && entry.origin === 'mcp'));
});

test('honors deletion tombstones for candidates and already materialized MCP pages', () => {
  const candidateId = 'mcp-eeeeeeeeeeeeeeeeeeeeeeee';
  const pageId = 'mcp-ffffffffffffffffffffffff';
  const result = OrderJournal.materialize({
    ...archive([order(candidateId), order(pageId, {source: 'manual', confirmed: true, origin: 'mcp'})]),
    deleted_order_ids: [candidateId, pageId]
  }, {cities, stores});
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.deleted_order_ids, [candidateId, pageId]);
});

test('leaves an unmatched city empty instead of inferring one from unrelated directory data', () => {
  const result = OrderJournal.materialize(archive([order('mcp-111111111111111111111111', {
    store: '虚构未收录餐厅'
  })]), {cities, stores});
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].city, '');
  assert.equal(result.entries[0].province_code, '');
  assert.equal(Object.hasOwn(result.entries[0], 'location'), false);
  assert.equal(Object.hasOwn(result.entries[0], 'default_photo'), false);
  assert.equal(result.entries[0].confirmed, true);
});

test('does not modify synthetic demo archives', () => {
  const input = {
    version: 1, data_kind: 'synthetic', source: 'demo',
    entries: [order('mcp-222222222222222222222222')], deleted_order_ids: []
  };
  const original = structuredClone(input);
  const result = OrderJournal.materialize(input, {cities, stores});
  assert.deepEqual(result, original);
  assert.deepEqual(input, original, 'materialization must not mutate its input');
});
