'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/journal-engine.js');
const options = {today: '2026-10-09'};
const entry = (changes = {}) => ({id: 'visit-1', date: '2026-10-08', country_code: 'CN', province_code: '310000', city: '上海', store: '示例门店', foods: ['咖啡'], source: 'manual', confirmed: true, ...changes});
const archive = entries => ({version: 1, data_kind: 'manual', entries});

test('rejects impossible dates, future visits and invalid countries', () => {
  for (const date of ['2026-02-29', '2026-10-10', '0000-01-01']) assert.throws(() => E.normalizeEntry(entry({date}), options));
  assert.equal(E.normalizeEntry(entry({date: '2024-02-29'}), options).date, '2024-02-29');
  assert.throws(() => E.normalizeEntry(entry({country_code: 'ZZ'}), options));
});
test('only personally confirmed manual visits count toward stamps', () => {
  const result = E.summarize(archive([entry(), entry({id: 'candidate', city: '', source: 'mcp_candidate', confirmed: false}), entry({id: 'draft', confirmed: false})]), options);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.unconfirmedCount, 1);
  assert.equal(result.distinctCountries, 1);
  assert.throws(() => E.normalizeEntry(entry({source: 'mcp_candidate'}), options));
  assert.throws(() => E.normalizeEntry(entry({country_code: 'JP', source: 'mcp_candidate', confirmed: false}), options));
});
test('confirmed China candidates retain origin and cannot become overseas MCP visits', () => {
  assert.equal(E.normalizeEntry(entry({origin: 'mcp'}), options).origin, 'mcp');
  assert.throws(() => E.normalizeEntry(entry({origin: 'mcp', country_code: 'JP'}), options));
});
test('store identities normalize case, full width characters and spaces', () => {
  const result = E.summarize(archive([entry({store: ' ＡＢＣ  店 '}), entry({id: 'visit-2', store: 'abc 店'}), entry({id: 'visit-3', province_code: '110000', city: '北京'})]), options);
  assert.equal(result.confirmedCount, 3);
  assert.equal(result.distinctStores, 2);
  assert.equal(result.distinctProvinces, 2);
  assert.equal(result.foods[0].count, 3);
});
test('year and province filters affect candidate and visit counts consistently', () => {
  const result = E.summarize(archive([entry(), entry({id: 'old', date: '2025-03-01'}), entry({id: 'beijing', province_code: '110000', city: '北京'}), entry({id: 'candidate', source: 'mcp_candidate', confirmed: false})]), {...options, year: '2026', province_code: '310000'});
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.candidateCount, 1);
});
test('China scope and official store references preserve required fields', () => {
  assert.throws(() => E.normalizeEntry(entry({country_code:'JP'}),options));
  assert.throws(() => E.normalizeEntry(entry({province_code:'999999'}),options));
  assert.throws(() => E.normalizeEntry(entry({province_code:'810000',origin:'mcp'}),options));
  const clean=E.normalizeEntry(entry({store_reference:{source:'mcp_nearby',code:'fixture-store',address:'虚构地址',token:'secret'}}),options);
  assert.deepEqual(clean.store_reference,{source:'mcp_nearby',code:'fixture-store',address:'虚构地址'});
  assert.equal(E.summarize(archive([entry({province_code:undefined})]),options).confirmedCount,1);
});
test('archive strips private fields and preserves photos, notes and location', () => {
  const clean = E.normalizeArchive(archive([entry({token: 'fixture-secret', orderId: 'private-reference', phone: 'fixture-phone', note: '手账', location: {lat: 31, lon: 121, precision: 'city', secret: true}, photo: {data_url: 'data:image/png;base64,YQ==', secret: true}})]), options);
  assert.equal(clean.entries[0].note, '手账');
  assert.deepEqual(clean.entries[0].location, {lat: 31, lon: 121, precision: 'city'});
  assert.deepEqual(clean.entries[0].photo, {data_url: 'data:image/png;base64,YQ=='});
  for (const field of ['token', 'orderId', 'phone']) assert.equal(field in clean.entries[0], false);
});
test('default store photos retain public source details and require HTTPS', () => {
  const default_photo = {
    url: 'https://example.com/store.jpg',
    source_url: 'https://example.com/source',
    attribution: '虚构来源署名',
    caption: '虚构门店环境照',
    private_note: 'must be dropped'
  };
  const clean = E.normalizeArchive(archive([entry({default_photo})]), options);
  assert.deepEqual(clean.entries[0].default_photo, {
    url: default_photo.url,
    source_url: default_photo.source_url,
    attribution: default_photo.attribution,
    caption: default_photo.caption
  });
  assert.throws(() => E.normalizeEntry(entry({default_photo: {...default_photo, url: 'http://example.com/store.jpg'}}), options));
  assert.throws(() => E.normalizeEntry(entry({default_photo: {...default_photo, source_url: 'http://example.com/source'}}), options));
});
test('identical duplicates deduplicate while conflicts reject the whole import', () => {
  assert.equal(E.normalizeArchive(archive([entry(), entry()]), options).entries.length, 1);
  assert.throws(() => E.normalizeArchive(archive([entry(), entry({note: 'changed'})]), options));
});
test('coordinates, photos and entry limits reject invalid backups', () => {
  assert.throws(() => E.normalizeEntry(entry({location: {lat: 91, lon: 0, precision: 'user'}}), options));
  assert.throws(() => E.normalizeEntry(entry({photo: {data_url: 'https://example.com/image.png'}}), options));
  assert.throws(() => E.normalizeArchive(archive(Array.from({length: 1001}, (_, i) => entry({id: String(i)}))), options));
});
