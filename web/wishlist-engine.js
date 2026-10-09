/* Stable, local wishlist records for stores the user may visit later. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WishlistEngine = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
      province_code: store.province_code
    });
    var key = identity(item);
    var existingIndex = result.findIndex(function (saved) { return identity(saved) === key; });
    if (existingIndex >= 0) {
      // Official nearby results refresh display details without erasing the
      // note the user added to this saved store.
      item.note = result[existingIndex].note;
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

  return Object.freeze({
    normalize: normalize,
    add: add,
    remove: remove,
    limits: Object.freeze({stores: MAX_STORES})
  });
});
