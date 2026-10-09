/* Small, private-by-construction summaries for a local journal. */
(function (root, factory) {
  'use strict';
  var insights = factory();
  if (typeof module === 'object' && module.exports) module.exports = insights;
  if (root) root.JourneyInsights = insights;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function localToday() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function validDate(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(label + ' must use YYYY-MM-DD');
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    var date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new TypeError(label + ' must be a calendar date');
    }
    return value;
  }

  function cityKey(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').trim().replace(/\s+/g, '').replace(/市$/, '').toLowerCase();
  }

  function monthLabel(date) {
    return Number(date.slice(5, 7)) + ' 月';
  }

  function yearMonth(date) {
    return date.slice(0, 4) + ' 年 ' + monthLabel(date);
  }

  function build(archive, options) {
    options = options || {};
    if (!archive || typeof archive !== 'object' || Array.isArray(archive) || !Array.isArray(archive.entries)) {
      throw new TypeError('archive.entries must be an array');
    }
    if (archive.entries.length > 1000) throw new RangeError('archive may contain at most 1000 entries');
    var today = validDate(options.today || localToday(), 'today');
    var year = Number(today.slice(0, 4));
    var month = today.slice(0, 7);
    var todayMonthNumber = Number(today.slice(5, 7));
    var eligibleCount = 0;
    var cities = new Set();
    var provinces = new Set();
    var yearCount = 0;
    var monthCount = 0;
    var first = null;
    var latest = null;
    var sameMonthLastYear = null;

    archive.entries.forEach(function (entry) {
      if (!entry || entry.confirmed !== true || entry.source !== 'manual' || entry.country_code !== 'CN') return;
      var date;
      try { date = validDate(entry.date, 'entry.date'); } catch (_) { return; }
      if (date > today) return;
      eligibleCount += 1;
      if (date.slice(0, 4) === String(year)) yearCount += 1;
      if (date.slice(0, 7) === month) monthCount += 1;

      var key = cityKey(entry.city);
      if (key) cities.add(key);
      if (typeof entry.province_code === 'string' && entry.province_code.trim()) provinces.add(entry.province_code.trim());

      if (!first || date < first.date || (date === first.date && String(entry.id || '').localeCompare(String(first.entry.id || '')) < 0)) {
        first = {entry: entry, date: date};
      }
      if (!latest || date > latest.date || (date === latest.date && String(entry.id || '').localeCompare(String(latest.entry.id || '')) > 0)) {
        latest = {entry: entry, date: date};
      }
      if (date.slice(5, 7) === String(todayMonthNumber).padStart(2, '0') && Number(date.slice(0, 4)) < year &&
          (!sameMonthLastYear || date > sameMonthLastYear.date || (date === sameMonthLastYear.date && String(entry.id || '').localeCompare(String(sameMonthLastYear.entry.id || '')) > 0))) {
        sameMonthLastYear = {entry: entry, date: date};
      }
    });

    var cityCount = cities.size;
    var provinceCount = provinces.size;
    var milestones = [
      {key: 'cities-3', threshold: 3, count: cityCount, unit: '座城市', reached: cityCount >= 3},
      {key: 'cities-6', threshold: 6, count: cityCount, unit: '座城市', reached: cityCount >= 6},
      {key: 'provinces-5', threshold: 5, count: provinceCount, unit: '个省份 / 地区', reached: provinceCount >= 5},
      {key: 'provinces-10', threshold: 10, count: provinceCount, unit: '个省份 / 地区', reached: provinceCount >= 10}
    ].map(function (item) {
      return {
        key: item.key,
        title: item.threshold + ' ' + item.unit,
        detail: item.reached ? '已留下这段足迹。' : '有记录时会在这里看到。',
        reached: item.reached
      };
    });

    var memory = null;
    if (sameMonthLastYear) {
      var recallCity = typeof sameMonthLastYear.entry.city === 'string' ? sameMonthLastYear.entry.city.trim() : '';
      memory = {
        title: '同月回顾',
        detail: yearMonth(sameMonthLastYear.date) + (recallCity ? '，' + recallCity + ' 留下过一页手账。' : '，你留过一页手账。'),
        entryId: String(sameMonthLastYear.entry.id || '')
      };
    } else if (first && latest && first.date === latest.date && first.entry.id === latest.entry.id) {
      var firstCity = typeof first.entry.city === 'string' ? first.entry.city.trim() : '';
      memory = {
        title: '第一站',
        detail: yearMonth(first.date) + (firstCity ? '，从 ' + firstCity + ' 开始留下手账。' : '，你开始留下手账。'),
        entryId: String(first.entry.id || '')
      };
    } else if (latest && first) {
      var latestCity = typeof latest.entry.city === 'string' ? latest.entry.city.trim() : '';
      var firstCityName = typeof first.entry.city === 'string' ? first.entry.city.trim() : '';
      var multiplePages = first.entry.id !== latest.entry.id || first.date !== latest.date;
      memory = {
        title: multiplePages ? '首站与最近一页' : '最近一页',
        detail: multiplePages
          ? '第一站在 ' + (firstCityName ? firstCityName + '（' : '') + yearMonth(first.date) + (firstCityName ? '）' : '') + '；最近一页在 ' + (latestCity ? latestCity + '（' : '') + yearMonth(latest.date) + (latestCity ? '）。' : '。')
          : yearMonth(latest.date) + (latestCity ? '，最近在 ' + latestCity + ' 留下一页手账。' : '，最近留下一页手账。'),
        entryId: String(latest.entry.id || '')
      };
    }

    return {
      year: year,
      metrics: [
        {key: 'year-visits', label: '今年记录', value: yearCount, detail: '今年本人确认的手账页数。'},
        {key: 'month-visits', label: '本月记录', value: monthCount, detail: '本月本人确认的手账页数。'},
        {key: 'cities', label: '城市足迹', value: cityCount, detail: '有记录的不同城市。'},
        {key: 'provinces', label: '省份足迹', value: provinceCount, detail: '有省份信息的不同省份 / 地区。'}
      ],
      milestones: milestones,
      memory: memory,
      prompt: eligibleCount ? {
        title: '随时再留一页',
        detail: '想记录时再回来就好，不必赶进度。'
      } : {
        title: '从第一站开始',
        detail: '选一顿你愿意记住的，不必补齐以前的每一餐。'
      }
    };
  }

  return Object.freeze({build: build});
});
