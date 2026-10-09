'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JournalSearch = require('../web/journal-search.js');

test('filter matches every whitespace-separated term across supported fields', () => {
  const first = {confirmed: true, city: '上海', store: '人民广场店 ABC', foods: ['麦辣鸡腿堡'], note: '周末午餐'};
  const second = {confirmed: true, city: '北京', store: '王府井店', foods: ['咖啡'], note: '麦辣鸡腿堡'};
  const entries = [first, second];
  assert.deepEqual(JournalSearch.filter(entries, '  abc  '), [first]);
  assert.deepEqual(JournalSearch.filter(entries, 'ＡＢＣ'), [first]);
  assert.deepEqual(JournalSearch.filter(entries, '麦辣   午餐'), [first]);
  assert.deepEqual(JournalSearch.filter(entries, '王府井 咖啡'), [second]);
});

test('only confirmed entries are returned, and results preserve original entry references', () => {
  const confirmed = {confirmed: true, city: '上海'};
  const candidate = {confirmed: false, city: '上海'};
  const malformed = null;
  const entries = [confirmed, candidate, malformed];
  const result = JournalSearch.filter(entries, '');
  assert.deepEqual(result, [confirmed]);
  assert.equal(result[0], confirmed);
  assert.equal(entries.length, 3);
});

test('supports food objects and safely ignores non-string search values', () => {
  const entry = {confirmed: true, city: {toString: () => 'leak'}, store: '咖啡店',
    foods: [{name: '拿铁'}, {title: '苹果派'}, {name: {toString: () => 'ignored'}}], note: 7};
  assert.deepEqual(JournalSearch.filter([entry], '咖啡店 拿铁'), [entry]);
  assert.deepEqual(JournalSearch.filter([entry], 'leak'), []);
  assert.deepEqual(JournalSearch.filter([entry], {toString: () => '拿铁'}), [entry]);
});

test('handles invalid collection input and returns no matches for unmet terms', () => {
  const entry = {confirmed: true, store: '门店'};
  assert.deepEqual(JournalSearch.filter(null, '门店'), []);
  assert.deepEqual(JournalSearch.filter([entry], '门店 不存在'), []);
});
