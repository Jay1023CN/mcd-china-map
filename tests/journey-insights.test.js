'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JourneyInsights = require('../web/journey-insights.js');

const today = '2026-10-09';
const entry = (id, changes = {}) => ({
  id,
  date: '2026-10-08',
  country_code: 'CN',
  province_code: '310000',
  city: '上海',
  store: '虚构门店',
  source: 'manual',
  confirmed: true,
  ...changes
});
const archive = entries => ({version: 1, data_kind: 'manual', entries});
const metric = (result, key) => result.metrics.find(item => item.key === key);

test('only confirmed manual records count; candidates and unconfirmed pages stay out', () => {
  const result = JourneyInsights.build(archive([
    entry('confirmed'),
    entry('candidate', {source: 'mcp_candidate', confirmed: false, city: '北京', province_code: '110000'}),
    entry('draft', {confirmed: false, city: '广州', province_code: '440000'})
  ]), {today});

  assert.equal(metric(result, 'year-visits').value, 1);
  assert.equal(metric(result, 'month-visits').value, 1);
  assert.equal(metric(result, 'cities').value, 1);
  assert.equal(metric(result, 'provinces').value, 1);
  assert.equal(result.memory.entryId, 'confirmed');
});

test('year and month boundaries use today and ignore future entries', () => {
  const result = JourneyInsights.build(archive([
    entry('this-year', {date: '2026-01-01', city: '北京'}),
    entry('last-year-same-month', {date: '2025-01-01', city: '上海'}),
    entry('previous-month', {date: '2025-12-31', city: '广州'}),
    entry('future', {date: '2026-01-02', city: '深圳'})
  ]), {today: '2026-01-01'});

  assert.equal(result.year, 2026);
  assert.equal(metric(result, 'year-visits').value, 1);
  assert.equal(metric(result, 'month-visits').value, 1);
  assert.equal(result.memory.title, '同月回顾');
  assert.equal(result.memory.entryId, 'last-year-same-month');
  assert.match(result.memory.detail, /2025 年 1 月/);
});

test('missing province data is not guessed from the city', () => {
  const result = JourneyInsights.build(archive([entry('without-province', {province_code: undefined})]), {today});
  assert.equal(metric(result, 'cities').value, 1);
  assert.equal(metric(result, 'provinces').value, 0);
  assert.equal(result.milestones.find(item => item.key === 'provinces-5').reached, false);
});

test('an empty journal gives a gentle first-page prompt and no invented memory', () => {
  const result = JourneyInsights.build(archive([]), {today});
  assert.deepEqual(result, {
    year: 2026,
    metrics: [
      {key: 'year-visits', label: '今年记录', value: 0, detail: '今年本人确认的手账页数。'},
      {key: 'month-visits', label: '本月记录', value: 0, detail: '本月本人确认的手账页数。'},
      {key: 'cities', label: '城市足迹', value: 0, detail: '有记录的不同城市。'},
      {key: 'provinces', label: '省份足迹', value: 0, detail: '有省份信息的不同省份 / 地区。'}
    ],
    milestones: [
      {key: 'cities-3', title: '3 座城市', detail: '有记录时会在这里看到。', reached: false},
      {key: 'cities-6', title: '6 座城市', detail: '有记录时会在这里看到。', reached: false},
      {key: 'provinces-5', title: '5 个省份 / 地区', detail: '有记录时会在这里看到。', reached: false},
      {key: 'provinces-10', title: '10 个省份 / 地区', detail: '有记录时会在这里看到。', reached: false}
    ],
    memory: null,
    foods: [],
    prompt: {title: '从第一站开始', detail: '选一顿你愿意记住的，不必补齐以前的每一餐。'}
  });
});

test('city spellings with width, spaces and 市 suffix collapse to one city', () => {
  const result = JourneyInsights.build(archive([
    entry('city-a', {city: ' 上海市 '}),
    entry('city-b', {date: '2026-10-07', city: '上 海'})
  ]), {today});
  assert.equal(metric(result, 'year-visits').value, 2);
  assert.equal(metric(result, 'cities').value, 1);
  assert.equal(metric(result, 'provinces').value, 1);
});

test('same-month history takes precedence over recent memory and excludes future records', () => {
  const result = JourneyInsights.build(archive([
    entry('older-october', {date: '2024-10-30', city: '成都'}),
    entry('last-october', {date: '2025-10-01', city: '北京'}),
    entry('recent', {date: '2026-09-30', city: '上海'}),
    entry('future-october', {date: '2026-10-10', city: '深圳', store: 'FUTURE_STORE', orderId: 'FUTURE_ORDER'})
  ]), {today});

  assert.equal(result.memory.title, '同月回顾');
  assert.equal(result.memory.entryId, 'last-october');
  assert.match(result.memory.detail, /2025 年 10 月.*北京/);
  assert.doesNotMatch(JSON.stringify(result), /FUTURE_STORE|FUTURE_ORDER|address|token|store/);
});

test('without a same-month match, memory names the first station and recent page by month only', () => {
  const result = JourneyInsights.build(archive([
    entry('first', {date: '2024-03-18', city: '杭州', store: 'PRIVATE_FIRST_STORE'}),
    entry('latest', {date: '2026-10-08', city: '上海', store: 'PRIVATE_LATEST_STORE', address: 'PRIVATE_ADDRESS', orderId: 'PRIVATE_ORDER', token: 'PRIVATE_TOKEN'})
  ]), {today});

  assert.equal(result.memory.title, '首站与最近一页');
  assert.equal(result.memory.entryId, 'latest');
  assert.match(result.memory.detail, /杭州（2024 年 3 月）.*上海（2026 年 10 月）/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIRST_STORE|PRIVATE_LATEST_STORE|PRIVATE_ADDRESS|PRIVATE_ORDER|PRIVATE_TOKEN|2026-10-08/);
});

test('milestones are capped at four and count distinct places rather than pages', () => {
  const provinceCodes = ['110000', '120000', '130000', '140000', '150000', '210000', '220000', '230000', '310000', '320000', '330000'];
  const entries = Array.from({length: 12}, (_, index) => entry('visit-' + index, {
    city: '城市 ' + (index % 7),
    province_code: provinceCodes[index % provinceCodes.length]
  }));
  const result = JourneyInsights.build(archive(entries), {today});
  assert.equal(metric(result, 'year-visits').value, 12);
  assert.equal(metric(result, 'cities').value, 7);
  assert.equal(metric(result, 'provinces').value, 11);
  assert.equal(result.milestones.length, 4);
  assert.ok(result.milestones.every(item => item.reached));
});

test('input archive and dates are bounded', () => {
  assert.throws(() => JourneyInsights.build(archive(Array.from({length: 1001}, (_, index) => entry(String(index)))), {today}), /1000/);
  assert.throws(() => JourneyInsights.build(archive([]), {today: '2026-02-30'}), /calendar date/);
});

test('food insights exclude candidates, unconfirmed pages, overseas entries and future dates', () => {
  const result = JourneyInsights.build(archive([
    entry('valid', {foods: ['薯条']}),
    entry('candidate', {source: 'mcp_candidate', confirmed: false, foods: ['麦辣鸡腿堡']}),
    entry('draft', {confirmed: false, foods: ['麦旋风']}),
    entry('overseas', {country_code: 'US', foods: ['Apple Pie']}),
    entry('future', {date: '2026-10-10', foods: ['未来餐品']})
  ]), {today});
  assert.deepEqual(result.foods, [{name: '薯条', count: 1}]);
  assert.doesNotMatch(JSON.stringify(result.foods), /candidate|future|Apple|id/);
});

test('food insights normalize names, count each item once per page, sort and cap at five', () => {
  const result = JourneyInsights.build(archive([
    entry('page-a', {foods: ['  薯条 ', '薯条', '  Ｃｏｆｆｅｅ   大杯 ', '派', '汉堡', '奶昔', '咖啡', 7]}),
    entry('page-b', {date: '2026-10-07', foods: ['薯条', '咖啡', '派']}),
    entry('page-c', {date: '2026-10-06', foods: ['咖啡', '汉堡']})
  ]), {today});
  assert.deepEqual(result.foods, [
    {name: '咖啡', count: 3},
    {name: '汉堡', count: 2},
    {name: '派', count: 2},
    {name: '薯条', count: 2},
    {name: 'Coffee 大杯', count: 1}
  ]);
  assert.deepEqual(Object.keys(result.foods[0]).sort(), ['count', 'name']);
  assert.ok(result.foods.every(item => item.name.length <= 100));
});

test('food insights are empty when there are no eligible records or food names', () => {
  const result = JourneyInsights.build(archive([
    entry('empty', {foods: []}),
    entry('not-a-string', {date: '2026-10-07', foods: [null, 3, {}]})
  ]), {today});
  assert.deepEqual(result.foods, []);
});
