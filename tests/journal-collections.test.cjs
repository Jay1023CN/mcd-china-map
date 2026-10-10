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
