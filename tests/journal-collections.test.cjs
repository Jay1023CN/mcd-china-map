'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Collections = require('../web/journal-collections.js');

function entry(id, date, city, province, store, foods = []) {
  return {id, date, city, province_code: province, store, foods, confirmed: true, source: 'manual', country_code: 'CN'};
}

test('city albums normalize the city suffix but keep identically named cities in separate provinces', () => {
  const records = [entry('old', '2026-08-10', '朝阳市', '210000', '广场店'),
    entry('new', '2026-09-10', '朝阳', '210000', '广场店'), entry('other', '2026-09-12', '朝阳', '220000', '广场店')];
  const result = Collections.build(records);
  assert.equal(result.cities.length, 2);
  assert.equal(result.cities[0].key, '220000|朝阳');
  assert.equal(result.cities[1].count, 2);
  assert.deepEqual(result.cities[1].entries.map(e => e.id), ['new', 'old']);
  assert.deepEqual(records.map(e => e.id), ['old', 'new', 'other']);
});

test('months and entries sort predictably, and foods count at most once in each page', () => {
  const result = Collections.build([
    entry('z', '2026-10-02', '杭州市', '330000', '西湖店', ['薯条', '薯条', {name: '可乐'}]),
    entry('a', '2026-10-02', '杭州', '330000', '西湖店', ['薯条', '汉堡']),
    entry('old', '2026-09-20', '宁波', '330000', '广场店', ['汉堡']),
    entry('invalid', '2026-02-30', '杭州', '330000', '西湖店')
  ]);
  assert.deepEqual(result.months.map(m => m.month), ['2026-10', '2026-09']);
  assert.deepEqual(result.months[0].entries.map(e => e.id), ['a', 'z']);
  assert.equal(result.months[0].count, 2);
  assert.equal(result.months[0].cities.length, 1);
  assert.equal(result.months[0].storeCount, 1);
  assert.deepEqual(result.months[0].topFoods.find(f => f.name === '薯条'), {name: '薯条', count: 2});
});

test('store identity includes province and city, and unnamed cities do not invent a city count', () => {
  const result = Collections.build([entry('1', '2026-10-01', '北京', '110000', '人民广场店'),
    entry('2', '2026-10-02', '上海', '310000', '人民广场店'),
    entry('3', '2026-10-03', '', '', '某店')]);
  assert.equal(result.months[0].storeCount, 3);
  assert.equal(result.months[0].cities.length, 2);
  assert.equal(result.months[0].count, 3);
});

test('the month projection excludes raw data and city names unless requested', () => {
  const record = entry('private-order-id', '2026-10-03', '上海市', '310000', '私人地址店', ['薯条']);
  record.note = '私人随手记'; record.token = 'secret'; record.address = '私人地址'; record.photo = {data_url: 'private-photo'};
  const month = Collections.build([record]).months[0];
  const hidden = Collections.projectMonth(month, {title: '我的十月', photos: ['private-photo']});
  assert.deepEqual(hidden, {title: '我的十月', month: '2026-10', count: 1, cityCount: 1, storeCount: 1,
    topFoods: [{name: '薯条', count: 1}], theme: 'paper'});
  for (const secret of ['私人', 'secret', '上海', 'private-order-id', 'private-photo']) assert.ok(!JSON.stringify(hidden).includes(secret));
  assert.deepEqual(Collections.projectMonth(month, {includeCities: true}).cities, ['上海']);
});

test('projection counts are derived from entries of the selected month rather than arbitrary summary fields', () => {
  const fake = {month: '2026-10', count: 999, cities: ['虚构城市'], storeCount: 99, topFoods: [{name: '虚构餐品', count: 99}], entries: [
    entry('oct', '2026-10-01', '杭州', '330000', '西湖店', ['薯条']), entry('sep', '2026-09-01', '北京', '110000', '某店')
  ]};
  const projected = Collections.projectMonth(fake, {includeCities: true});
  assert.equal(projected.count, 1); assert.equal(projected.storeCount, 1);
  assert.deepEqual(projected.cities, ['杭州']);
  assert.deepEqual(projected.topFoods, [{name: '薯条', count: 1}]);
});

test('empty input and malformed months produce empty collections without inventing memories', () => {
  assert.deepEqual(Collections.build(null), {cities: [], months: []});
  assert.equal(Collections.projectMonth({month: '2026-13', entries: [entry('1', '2026-10-01', '北京', '110000', '某店')]}).count, 0);
  assert.deepEqual(Collections.projectMonth({}, {includeCities: true}).cities, []);
});

test('city export preserves selected page order and moves only a selected cover to the front', () => {
  const city = Collections.build([
    entry('old', '2026-09-01', '杭州市', '330000', '老店'),
    entry('middle', '2026-10-01', '杭州', '330000', '中间店'),
    entry('new', '2026-10-04', '杭州', '330000', '新店')
  ]).cities[0];
  const selected = Collections.projectCity(city, {selectedIds: ['old', 'new', 'middle'], coverId: 'middle', includeCities: true});
  assert.deepEqual(selected.pages.map(page => page.store), ['中间店', '老店', '新店']);
  assert.equal(selected.count, 3); assert.equal(selected.totalCount, 3);
  assert.deepEqual(Collections.projectCity(city, {selectedIds: ['old', 'new'], coverId: 'middle'}).pages.map(page => page.date), ['2026-09-01', '2026-10-04']);
});

test('city export checks province and city identity rather than trusting the supplied entry list', () => {
  const city = {key: '330000|杭州', city: '杭州', province_code: '330000', count: 999, entries: [
    entry('same', '2026-10-01', '杭州市', '330000', '杭州店'),
    entry('foreign-city', '2026-10-02', '宁波', '330000', '宁波店'),
    entry('foreign-province', '2026-10-03', '杭州', '440000', '同名外省店')
  ]};
  const exported = Collections.projectCity(city, {selectedIds: ['foreign-city', 'same', 'foreign-province'], includeCities: true});
  assert.equal(exported.totalCount, 1); assert.equal(exported.count, 1); assert.equal(exported.pages[0].store, '杭州店');
  assert.equal(Collections.projectCity({...city, key: '440000|杭州'}).count, 0);
});

test('city export defaults to six pages, permits an explicit empty selection and limits distinct selected pages to twelve', () => {
  const records = Array.from({length: 16}, (_, i) => entry('page-' + i, '2026-10-' + String(i + 1).padStart(2, '0'), '杭州', '330000', '店-' + i));
  records.push({...records[0]});
  const city = {key: '330000|杭州', city: '杭州', province_code: '330000', entries: records};
  const defaultPages = Collections.projectCity(city, {includeCities: true});
  assert.equal(defaultPages.count, 6); assert.equal(defaultPages.totalCount, 16); assert.equal(defaultPages.pages[0].store, '店-15');
  assert.equal(Collections.projectCity(city, {selectedIds: []}).count, 0);
  const explicit = Collections.projectCity(city, {selectedIds: ['page-0', 'page-0', 'not-present', ...records.map(page => page.id)], includeCities: true});
  assert.equal(explicit.count, 12); assert.equal(explicit.pages[0].store, '店-0'); assert.equal(explicit.pages[11].store, '店-11');
});

test('city export shares only selected date and food fields until city/store and notes are enabled', () => {
  const record = entry('secret-id', '2026-10-01', '上海', '310000', '私人门店', ['薯条']);
  Object.assign(record, {note: '原始私人随记', address: '秘密地址', token: 'secret-token', photo: {data_url: 'private-photo'}, store_reference: {code: 'secret-code', address: '秘密地址'}});
  const city = Collections.build([record]).cities[0];
  const hidden = Collections.projectCity(city, {caption: '我自己写的说明'});
  assert.deepEqual(hidden, {title: '我的麦麦城市回忆册', count: 1, totalCount: 1,
    pages: [{date: '2026-10-01', foods: ['薯条']}], caption: '我自己写的说明'});
  for (const secret of ['上海', '私人', '秘密', 'secret-', 'private-photo']) assert.ok(!JSON.stringify(hidden).includes(secret));
  const visible = Collections.projectCity(city, {includeCities: true, includeNote: true});
  assert.equal(visible.city, '上海'); assert.equal(visible.pages[0].store, '私人门店'); assert.equal(visible.pages[0].note, '原始私人随记');
  assert.ok(!JSON.stringify(visible).includes('秘密地址')); assert.ok(!JSON.stringify(visible).includes('secret-id'));
});

test('captions come only from options and are length limited without changing the monthly totals or selected city count', () => {
  const records = [entry('one', '2026-10-01', '杭州', '330000', '西湖店', ['薯条']),
    entry('two', '2026-10-02', '宁波', '330000', '广场店', ['咖啡'])];
  records[0].note = '不自动当作标题说明';
  const collections = Collections.build(records), month = {...collections.months[0], caption: '来自对象的私人说明'};
  assert.equal(Collections.projectMonth(month).caption, undefined);
  const strip = Collections.projectMonth(month, {caption: '月'.repeat(150), layout: 'strip', photos: ['one']}),
    feature = Collections.projectMonth(month, {caption: '月'.repeat(150), layout: 'feature', photos: ['one', 'two']});
  assert.equal(strip.caption.length, 100); assert.deepEqual(feature, strip); assert.equal(feature.count, 2); assert.equal(feature.cityCount, 2);
  const city = Collections.projectCity(collections.cities.find(item => item.city === '杭州'), {caption: '城'.repeat(160)});
  assert.equal(city.caption.length, 140); assert.equal(city.count, 1);
});
