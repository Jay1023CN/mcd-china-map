'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/journal-engine.js');
const options = {today: '2026-10-09'};
const entry = (changes = {}) => ({id: 'visit-1', date: '2026-10-08', country_code: 'CN', city: '上海', store: '示例门店', foods: ['咖啡'], source: 'manual', confirmed: true, ...changes});
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
  const result = E.summarize(archive([entry({store: ' ＡＢＣ  店 '}), entry({id: 'visit-2', store: 'abc 店'}), entry({id: 'visit-3', country_code: 'JP'})]), options);
  assert.equal(result.confirmedCount, 3);
  assert.equal(result.distinctStores, 2);
  assert.equal(result.distinctCountries, 2);
  assert.equal(result.foods[0].count, 3);
});
test('year and country filters affect candidate and visit counts consistently', () => {
  const result = E.summarize(archive([entry(), entry({id: 'old', date: '2025-03-01'}), entry({id: 'japan', country_code: 'JP'}), entry({id: 'candidate', source: 'mcp_candidate', confirmed: false})]), {...options, year: '2026', country_code: 'CN'});
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.candidateCount, 1);
});
test('archive strips private fields and preserves photos, notes and location', () => {
  const clean = E.normalizeArchive(archive([entry({token: 'fixture-secret', orderId: 'private-reference', phone: 'fixture-phone', note: '手账', location: {lat: 31, lon: 121, precision: 'city', secret: true}, photo: {data_url: 'data:image/png;base64,YQ==', secret: true}})]), options);
  assert.equal(clean.entries[0].note, '手账');
  assert.deepEqual(clean.entries[0].location, {lat: 31, lon: 121, precision: 'city'});
  assert.deepEqual(clean.entries[0].photo, {data_url: 'data:image/png;base64,YQ=='});
  for (const field of ['token', 'orderId', 'phone']) assert.equal(field in clean.entries[0], false);
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
