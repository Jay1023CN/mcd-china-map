/* Stable, local wishlist records for stores the user may visit later. */
(function (root, factory) {
  'use strict';
  // The browser loads the shared folding table after this module; resolve it at search time.
  var api = factory(typeof module === 'object' && module.exports
    ? function () { return require('./chinese-search-normalization.js'); }
    : function () { return root.ChineseSearchNormalization; });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishlistEngine = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (searchNormalization) {
  'use strict';

  var MAX_STORES = 100;
  var MAX_INPUT_ITEMS = 100;
  var SOURCES = new Set(['mcp_nearby', 'manual']);

  function fail(message) { throw new Error(message); }

  function cleanText(value, field, maximum, required) {
    if (value == null && !required) return '';
    if (typeof value !== 'string') fail(field + ' must be text');
    var result = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (required && !result) fail(field + ' is required');
    if (result.length > maximum) fail(field + ' is too long');
    return result;
  }

  function storeId(source, code) {
    try {
      return 'store-' + encodeURIComponent(source) + '-' + encodeURIComponent(code);
    } catch (_) {
      fail('store code is invalid');
    }
  }

  function dateValue(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) fail('planned_date is invalid');
    var parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('planned_date is invalid');
    return value;
  }

  function searchKey(value) {
    var normalized = (value || '').normalize('NFKC');
    var chinese = searchNormalization();
    return (chinese ? chinese.fold(normalized) : normalized).trim().toLowerCase();
  }
  function cityKey(value) { return searchKey(value).replace(/市$/, ''); }

  function normalizeItem(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('wishlist item must be an object');
    var source = cleanText(input.source, 'source', 32, true);
    if (!SOURCES.has(source)) fail('source is invalid');
    var code = cleanText(input.code, 'store code', 200, true);
    var item = {
      id: storeId(source, code),
      source: source,
      code: code,
      name: cleanText(input.name, 'store name', 200, true),
      city: cleanText(input.city, 'city', 120, false),
      address: cleanText(input.address, 'address', 300, false),
      note: cleanText(input.note, 'note', 1000, false)
    };
    if (input.province_code != null && input.province_code !== '') {
      var province = cleanText(input.province_code, 'province_code', 6, true);
      if (!/^\d{6}$/.test(province)) fail('province_code is invalid');
      item.province_code = province;
    }
    if (input.planned_date != null && input.planned_date !== '') item.planned_date = dateValue(input.planned_date);
    if (input.priority != null && typeof input.priority !== 'boolean') fail('priority must be boolean');
    if (input.priority === true) item.priority = true;
    if (input.aliases != null) {
      if (!Array.isArray(input.aliases) || input.aliases.length > 40) fail('aliases are invalid');
      var aliases = Array.from(new Set(input.aliases.map(function (alias) {
        return cleanText(alias, 'store alias', 200, false);
      }).filter(Boolean)));
      if (aliases.length) item.aliases = aliases;
    }
    return item;
  }

  function identity(item) { return item.source + '\u0000' + item.code; }

  function normalize(items) {
    if (!Array.isArray(items)) fail('wishlist must be an array');
    if (items.length > MAX_INPUT_ITEMS) fail('wishlist cannot contain more than 100 stores');
    var result = [];
    var indices = new Map();
    items.forEach(function (input) {
      var item = normalizeItem(input);
      var key = identity(item);
      if (indices.has(key)) return;
      indices.set(key, result.length);
      result.push(item);
    });
    return result;
  }

  function add(items, store) {
    var result = normalize(items);
    if (!store || typeof store !== 'object' || Array.isArray(store)) fail('store must be an object');
    var source = store.source == null ? 'mcp_nearby' : store.source;
    var item = normalizeItem({
      source: source,
      code: store.code,
      name: store.name,
      city: store.city,
      address: store.address,
      note: store.note,
      province_code: store.province_code,
      planned_date: store.planned_date,
      priority: store.priority,
      aliases: store.aliases
    });
    var key = identity(item);
    var existingIndex = result.findIndex(function (saved) { return identity(saved) === key; });
    if (existingIndex >= 0) {
      // Official nearby results refresh display details without erasing the
      // note the user added to this saved store.
      item.note = result[existingIndex].note;
      if (result[existingIndex].planned_date) item.planned_date = result[existingIndex].planned_date;
      if (result[existingIndex].priority) item.priority = true;
      var aliases = Array.from(new Set((item.aliases || []).concat(result[existingIndex].aliases || []))).slice(0, 40);
      if (aliases.length) item.aliases = aliases;
      result[existingIndex] = item;
      return result;
    }
    if (result.length >= MAX_STORES) fail('wishlist cannot contain more than 100 stores');
    result.push(item);
    return result;
  }

  function remove(items, id) {
    if (typeof id !== 'string') fail('wishlist id must be text');
    return normalize(items).filter(function (item) { return item.id !== id; });
  }

  function select(items, options) {
    options = options || {};
    var normalized = normalize(items);
    var terms = searchKey(options.query).split(/\s+/).filter(Boolean);
    var start, end;
    if (options.when === 'today' || options.when === 'week') {
      start = dateValue(options.today);
      var last = new Date(start + 'T00:00:00Z');
      last.setUTCDate(last.getUTCDate() + (options.when === 'week' ? 6 : 0));
      end = last.toISOString().slice(0, 10);
    }
    return normalized.filter(function (item) {
      if (options.city && cityKey(item.city) !== cityKey(options.city)) return false;
      if (start && (!item.planned_date || item.planned_date < start || item.planned_date > end)) return false;
      if (options.when === 'unplanned' && item.planned_date) return false;
      var haystack = searchKey([item.city, item.name, item.address, item.note].concat(item.aliases || []).join(' '));
      return terms.every(function (term) { return haystack.includes(term); });
    }).sort(function (a, b) {
      return Number(!!b.priority) - Number(!!a.priority) ||
        (a.planned_date || '9999-99-99').localeCompare(b.planned_date || '9999-99-99');
    });
  }

  return Object.freeze({
    normalize: normalize,
    add: add,
    remove: remove,
    select: select,
    limits: Object.freeze({stores: MAX_STORES})
  });
});
