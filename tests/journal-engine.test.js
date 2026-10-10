'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/journal-engine.js');
const Wishlist = require('../web/wishlist-engine.js');
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
test('synced order conversion produces a counted MCP-origin journal page and strips order credentials', () => {
  const syncedOrder = {
    id: 'safe-local-order-fixture', date: '2026-10-08', country_code: 'CN', province_code: '310000',
    city: '上海', store: '虚构同步门店', foods: ['咖啡'], source: 'manual', confirmed: true, origin: 'mcp',
    location: {lat: 31.23, lon: 121.47, precision: 'city'},
    default_photo: {url: 'https://example.com/store.jpg', source_url: 'https://example.com/source', attribution: '虚构公开资料', caption: '虚构门店照'},
    orderId: 'private-order-id', token: 'private-token'
  };
  const clean = E.normalizeArchive(archive([syncedOrder]), options);
  assert.equal(clean.entries[0].source, 'manual');
  assert.equal(clean.entries[0].confirmed, true);
  assert.equal(clean.entries[0].origin, 'mcp');
  assert.equal(E.summarize(clean, options).confirmedCount, 1, 'a converted order should appear as a journal visit');
  assert.deepEqual(clean.entries[0].location, {lat: 31.23, lon: 121.47, precision: 'city'});
  assert.deepEqual(clean.entries[0].default_photo, syncedOrder.default_photo);
  assert.equal('orderId' in clean.entries[0], false);
  assert.equal('token' in clean.entries[0], false);
  assert.throws(() => E.normalizeEntry({...syncedOrder, source: 'mcp_candidate'}, options), /MCP candidates must remain unconfirmed/);
});
test('unknown-city MCP journal entries still count as visits but not as cities', () => {
  const unknownCity = entry({id: 'mcp-aaaaaaaaaaaaaaaaaaaaaaaa', city: '', source: 'manual', confirmed: true, origin: 'mcp'});
  const clean = E.normalizeArchive(archive([unknownCity]), options);
  const summary = E.summarize(clean, options);
  assert.equal(clean.entries[0].city, '');
  assert.equal(summary.confirmedCount, 1);
  assert.equal(summary.distinctCities, 0);
  assert.equal(summary.countries[0].cityCount, 0);
});
test('deleted MCP order ids are validated, retained and only filter MCP-sourced entries', () => {
  const removed = 'mcp-aaaaaaaaaaaaaaaaaaaaaaaa';
  const removedOrigin = 'mcp-bbbbbbbbbbbbbbbbbbbbbbbb';
  const input = archive([
    entry({id: removed, city: '', source: 'mcp_candidate', confirmed: false}),
    entry({id: removed, store: '本人手动同ID记录'}),
    entry({id: removedOrigin, city: '', source: 'manual', confirmed: true, origin: 'mcp'}),
    entry({id: 'manual-keep', store: '另一条手动记录'})
  ]);
  input.deleted_order_ids = [removed, removedOrigin];
  const clean = E.normalizeArchive(input, options);
  assert.deepEqual(clean.deleted_order_ids, [removed, removedOrigin]);
  assert.deepEqual(clean.entries.map(item => item.id), [removed, 'manual-keep']);
  for (const deleted_order_ids of [null, ['not-an-mcp-id'], [`mcp-${'A'.repeat(24)}`], [removed, removed]]) {
    assert.throws(() => E.normalizeArchive({...archive([]), deleted_order_ids}, options));
  }
  assert.throws(() => E.normalizeArchive({...archive([]), deleted_order_ids: Array.from({length: 1001}, (_, i) => `mcp-${i.toString(16).padStart(24, '0')}`)}, options));
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

test('archive roundtrip preserves normalized wishlist records and strips unknown fields', () => {
  const saved = Wishlist.add([], {code: 'nearby-1', name: '收藏门店', city: '上海', address: '某路', province_code: '310000'});
  const input = archive([entry()]);
  input.wishlist = [{...saved[0], token: 'secret-token', orderId: 'secret-order', payment_url: 'https://private.test'}];
  const clean = E.normalizeArchive(input, options);
  assert.deepEqual(clean.wishlist, saved);
  assert.doesNotMatch(JSON.stringify(clean.wishlist), /secret-token|secret-order|payment_url/);
  assert.deepEqual(E.normalizeArchive(clean, options), clean);
  assert.equal(input.wishlist[0].token, 'secret-token');
});

test('archives without wishlist keep their original shape', () => {
  const input = archive([entry()]);
  const clean = E.normalizeArchive(input, options);
  assert.deepEqual(clean, {version: 1, data_kind: 'manual', entries: [E.normalizeEntry(entry(), options)]});
  assert.equal(Object.hasOwn(clean, 'wishlist'), false);
});

test('wishlist entries do not affect confirmed visit statistics', () => {
  const input = archive([entry()]);
  input.wishlist = [
    {source: 'mcp_nearby', code: 'wish-1', name: '想去门店', city: '北京', address: '地址一'},
    {source: 'manual', code: 'wish-2', name: '另一家门店', city: '杭州', address: '地址二'}
  ];
  const withWishlist = E.summarize(input, options);
  const withoutWishlist = E.summarize(archive([entry()]), options);
  assert.deepEqual(withWishlist, withoutWishlist);
  assert.equal(withWishlist.confirmedCount, 1);
});

test('archive wishlist is limited to 100 items', () => {
  const input = archive([]);
  input.wishlist = Array.from({length: 101}, (_, i) => ({source: 'mcp_nearby', code: String(i), name: `门店${i}`}));
  assert.throws(() => E.normalizeArchive(input, options), /100 stores/);
});
