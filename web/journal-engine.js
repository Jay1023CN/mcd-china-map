/* Global journal data engine. No network, DOM, credentials or browser storage. */
(function (root, factory) {
  'use strict';
  var engine = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.JournalEngine = engine;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var wishlistEngine = root && root.WishlistEngine;
  var collectionPreferences = root && root.CollectionPreferences;
  if (!collectionPreferences && typeof module === 'object' && module.exports && typeof require === 'function') collectionPreferences = require('./collection-preferences.js');
  if (!wishlistEngine && typeof module === 'object' && module.exports && typeof require === 'function') {
    wishlistEngine = require('./wishlist-engine.js');
  }

  var ISO_CODES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
  var MAX_ENTRIES = 1000;
  var MAX_PHOTO_BYTES = 1572864;
  var MAX_ARCHIVE_BYTES = 8388608;
  var PROVINCES = new Set('110000 120000 130000 140000 150000 210000 220000 230000 310000 320000 330000 340000 350000 360000 370000 410000 420000 430000 440000 450000 460000 500000 510000 520000 530000 540000 610000 620000 630000 640000 650000 710000 810000 820000'.split(' '));

  function fail(message) { throw new Error(message); }
  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' must be an object');
    return value;
  }
  function text(value, name, maximum, required) {
    if (typeof value !== 'string') fail(name + ' must be text');
    var result = value.trim();
    if (required && !result) fail(name + ' is required');
    if (result.length > maximum) fail(name + ' is too long');
    return result;
  }
  function localToday() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function validDate(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(name + ' must use YYYY-MM-DD');
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    if (year < 1) fail(name + ' is not a calendar date');
    var date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(name + ' is not a calendar date');
    return value;
  }
  function allowedCountries(countries) {
    if (countries == null) return ISO_CODES;
    var values;
    if (countries instanceof Set) values = Array.from(countries);
    else if (Array.isArray(countries)) values = countries;
    else fail('countries must be an array or Set');
    return new Set(values.map(function (value) {
      var code = typeof value === 'string' ? value : value && (value.country_code || value.code);
      if (typeof code !== 'string') fail('countries contain an invalid code');
      code = code.trim().toUpperCase();
      if (!ISO_CODES.has(code)) fail('countries contain an unassigned ISO code');
      return code;
    }));
  }
  function identity(value) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function utf8Bytes(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }

  function normalizeEntry(input, options) {
    options = options || {};
    object(input, 'entry');
    var today = validDate(options.today || localToday(), 'today');
    var date = validDate(input.date, 'date');
    if (date > today) fail('date cannot be in the future');
    var country = text(input.country_code, 'country_code', 2, true).toUpperCase();
    if (country !== 'CN') fail('this China map only accepts CN records; keep overseas records in their original backup');
    if (!/^[A-Z]{2}$/.test(country) || !ISO_CODES.has(country) || !allowedCountries(options.countries).has(country)) fail('country_code must be an assigned ISO alpha-2 code');
    if (input.source !== 'manual' && input.source !== 'mcp_candidate') fail('source must be manual or mcp_candidate');
    if (typeof input.confirmed !== 'boolean') fail('confirmed must be a boolean');
    if (input.source === 'mcp_candidate' && input.confirmed) fail('MCP candidates must remain unconfirmed; confirming a visit requires a manual entry');
    if (input.source === 'mcp_candidate' && country !== 'CN') fail('the connected McDonald’s MCP only supplies mainland China candidates');
    var foods = input.foods == null ? [] : input.foods;
    if (typeof foods === 'string') foods = foods.split(/[,，\n]+/).map(function (food) { return food.trim(); }).filter(Boolean);
    if (!Array.isArray(foods) || foods.length > 50) fail('foods must be an array of at most 50 names');
    var output = {
      id: text(input.id, 'id', 100, true),
      date: date,
      country_code: country,
      city: text(input.city == null && (input.source === 'mcp_candidate' || input.origin === 'mcp') ? '' : input.city, 'city', 120, input.source !== 'mcp_candidate' && input.origin !== 'mcp'),
      store: text(input.store, 'store', 200, true),
      foods: foods.map(function (food) { return text(food, 'food', 120, true); }),
      source: input.source,
      confirmed: input.confirmed
    };
    if (input.note != null) output.note = text(input.note, 'note', 1000, false);
    if (input.province_code != null && input.province_code !== '') {
      var province = text(input.province_code, 'province_code', 6, true);
      if (!PROVINCES.has(province)) fail('province_code is invalid');
      if ((input.source === 'mcp_candidate' || input.origin === 'mcp') && ['710000', '810000', '820000'].includes(province)) fail('official MCP order candidates only cover mainland China');
      output.province_code = province;
    }
    if (input.store_reference != null) {
      var reference = object(input.store_reference, 'store_reference');
      if (!['mcp_nearby','official_catalog'].includes(reference.source)) fail('invalid store reference source');
      output.store_reference = {source: reference.source, code: text(reference.code, 'store code', 100, true), address: text(reference.address || '', 'store address', 500, false)};
      if(reference.source_url!=null){
        var referenceUrl=text(reference.source_url,'store reference URL',2048,false);
        if(referenceUrl && !/^https:\/\//.test(referenceUrl))fail('store reference URL must use HTTPS');
        if(referenceUrl)output.store_reference.source_url=referenceUrl;
      }
    }
    if (input.origin != null) {
      if (input.origin !== 'mcp' || input.source !== 'manual' || !input.confirmed) fail('origin mcp is only valid for a confirmed manual entry');
      if (country !== 'CN') fail('entries originating from the connected McDonald’s MCP must use CN');
      output.origin = 'mcp';
    }
    if (input.location != null) {
      var location = object(input.location, 'location');
      if (typeof location.lat !== 'number' || !Number.isFinite(location.lat) || location.lat < -90 || location.lat > 90 || typeof location.lon !== 'number' || !Number.isFinite(location.lon) || location.lon < -180 || location.lon > 180) fail('location coordinates are invalid');
      if (!['city','user','store'].includes(location.precision)) fail('location precision must be city, user or store');
      output.location = { lat: location.lat, lon: location.lon, precision: location.precision };
      if(location.precision==='store'){
        if(!['GCJ-02','WGS84','official_google_maps_unverified'].includes(location.coordinate_system))fail('store coordinates require a known source coordinate system');
        output.location.coordinate_system=location.coordinate_system;
      }
    }
    if (input.photo != null) {
      var photo = object(input.photo, 'photo');
      if (typeof photo.data_url !== 'string') fail('photo data_url must be text');
      var match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.data_url);
      if (!match || match[2].length % 4 !== 0) fail('photo must be a JPEG, PNG or WebP base64 data URL');
      var byteCount = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
      if (byteCount > MAX_PHOTO_BYTES) fail('photo exceeds 1.5 MiB');
      output.photo = { data_url: photo.data_url };
    }
    if (input.default_photo != null) {
      var fallback = object(input.default_photo, 'default_photo');
      var imageUrl = text(fallback.url, 'default photo URL', 2048, true);
      var sourceUrl = text(fallback.source_url, 'default photo source', 2048, true);
      for (var url of [imageUrl, sourceUrl]) {
        try { if (new URL(url).protocol !== 'https:' || new URL(url).username || new URL(url).password) fail('default photo URLs must use HTTPS'); }
        catch (error) { fail('default photo URLs must use HTTPS'); }
      }
      output.default_photo = {url: imageUrl, source_url: sourceUrl,
        attribution: text(fallback.attribution || '', 'photo attribution', 300, false),
        caption: text(fallback.caption || '', 'photo caption', 500, false)};
    }
    if (input.collaboration != null) {
      var collaboration = text(input.collaboration, 'collaboration', 120, false);
      if (collaboration && input.confirmed) {
        output.collaboration = collaboration;
        output.collaboration_source = 'user_confirmed';
      }
    }
    // Constructing a new object intentionally discards credentials, order IDs and payment URLs.
    return output;
  }

  function normalizeArchive(input, options) {
    object(input, 'archive');
    if (input.version !== 1) fail('unsupported archive version');
    if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) fail('archive must contain at most 1000 entries');
    var dataKind = input.data_kind || 'manual';
    if (!['manual', 'synthetic', 'mcp'].includes(dataKind)) fail('data_kind is invalid');
    var deletedOrderIds = null;
    var deletedOrderIdSet = new Set();
    if (Object.prototype.hasOwnProperty.call(input, 'deleted_order_ids')) {
      if (!Array.isArray(input.deleted_order_ids) || input.deleted_order_ids.length > MAX_ENTRIES) fail('deleted_order_ids must contain at most 1000 ids');
      deletedOrderIds = input.deleted_order_ids.map(function (id) {
        if (typeof id !== 'string' || !/^mcp-[a-f0-9]{24}$/.test(id)) fail('deleted_order_ids contain an invalid MCP id');
        if (deletedOrderIdSet.has(id)) fail('deleted_order_ids contain a duplicate id');
        deletedOrderIdSet.add(id);
        return id;
      });
    }
    var ids = new Map();
    var entries = [];
    input.entries.forEach(function (entry) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.id === 'string' && deletedOrderIdSet.has(entry.id) && (entry.source === 'mcp_candidate' || entry.origin === 'mcp')) return;
      var normalized = normalizeEntry(entry, options);
      var value = JSON.stringify(normalized);
      if (ids.has(normalized.id)) {
        if (ids.get(normalized.id) !== value) fail('conflicting duplicate entry id');
        return;
      }
      ids.set(normalized.id, value);
      entries.push(normalized);
    });
    var archive = { version: 1, data_kind: dataKind, entries: entries };
    if (input.source != null) archive.source = text(input.source, 'archive source', 1000, false);
    if (deletedOrderIds !== null) archive.deleted_order_ids = deletedOrderIds;
    if (Object.prototype.hasOwnProperty.call(input, 'wishlist')) {
      if (!wishlistEngine || typeof wishlistEngine.normalize !== 'function') fail('wishlist support is unavailable');
      archive.wishlist = wishlistEngine.normalize(input.wishlist);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'collection_preferences')) {
      if (!collectionPreferences) fail('collection preferences support is unavailable');
      archive.collection_preferences = collectionPreferences.normalize(input.collection_preferences);
    }
    if (utf8Bytes(JSON.stringify(archive)) > MAX_ARCHIVE_BYTES) fail('archive exceeds 8 MiB');
    return archive;
  }

  function summarize(input, options) {
    options = options || {};
    var archive = normalizeArchive(Array.isArray(input) ? { version: 1, entries: input } : input, options);
    var year = options.year == null || options.year === '' ? null : String(options.year);
    if (year && !/^\d{4}$/.test(year)) fail('year filter must have four digits');
    var month = options.month == null || options.month === '' ? null : String(options.month);
    if (month && /^\d{1,2}$/.test(month)) {
      if (!year || Number(month) < 1 || Number(month) > 12) fail('numeric month requires a year and must be 1–12');
      month = year + '-' + month.padStart(2, '0');
    }
    if (month && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (year && month.slice(0, 4) !== year))) fail('month filter must use YYYY-MM and match year');
    var countryFilter = options.country_code == null || options.country_code === '' ? null : String(options.country_code).trim().toUpperCase();
    if (countryFilter && !ISO_CODES.has(countryFilter)) fail('country filter is invalid');
    var provinceFilter = options.province_code || null;
    if (provinceFilter && !PROVINCES.has(provinceFilter)) fail('province filter is invalid');
    var filtered = archive.entries.filter(function (entry) {
      return (!year || entry.date.slice(0, 4) === year) && (!month || entry.date.slice(0, 7) === month) && (!countryFilter || entry.country_code === countryFilter) && (!provinceFilter || entry.province_code === provinceFilter);
    });
    var entries = filtered.filter(function (entry) { return entry.confirmed && entry.source === 'manual'; });
    var provinces = new Map();
    var countries = new Map();
    var cities = new Map();
    var stores = new Map();
    var months = new Map();
    var years = new Map();
    var foods = new Map();
    var collaborations = new Map();
    function count(map, key, create) {
      if (!map.has(key)) map.set(key, create());
      map.get(key).count += 1;
      return map.get(key);
    }
    entries.forEach(function (entry) {
      if (entry.province_code) count(provinces, entry.province_code, function () { return {province_code: entry.province_code, count: 0}; });
      var cityKey = entry.country_code + '\u0000' + (entry.province_code || '') + '\u0000' + identity(entry.city);
      var storeKey = cityKey + '\u0000' + (entry.store_reference?.source === 'official_catalog' ? entry.store_reference.code : identity(entry.store));
      var country = count(countries, entry.country_code, function () { return { country_code: entry.country_code, count: 0, cityKeys: new Set(), storeKeys: new Set() }; });
      if (entry.city) {
        country.cityKeys.add(cityKey);
        count(cities, cityKey, function () { return { country_code: entry.country_code, city: entry.city, count: 0 }; });
      }
      country.storeKeys.add(storeKey);
      count(stores, storeKey, function () { return { country_code: entry.country_code, city: entry.city, store: entry.store, count: 0 }; });
      count(months, entry.date.slice(0, 7), function () { return { month: entry.date.slice(0, 7), count: 0 }; });
      count(years, entry.date.slice(0, 4), function () { return { year: entry.date.slice(0, 4), count: 0 }; });
      var seenFoods = new Set();
      entry.foods.forEach(function (food) {
        var key = identity(food);
        if (seenFoods.has(key)) return;
        seenFoods.add(key);
        count(foods, key, function () { return { name: food, count: 0 }; });
      });
      if (entry.collaboration && entry.collaboration_source === 'user_confirmed') count(collaborations, identity(entry.collaboration), function () { return { name: entry.collaboration, source: 'user_confirmed', count: 0 }; });
    });
    function values(map) { return Array.from(map.values()); }
    function ranking(map) { return values(map).sort(function (a, b) { return b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)); }); }
    return {
      data_kind: archive.data_kind,
      confirmedCount: entries.length,
      candidateCount: filtered.filter(function (entry) { return entry.source === 'mcp_candidate'; }).length,
      unconfirmedCount: filtered.filter(function (entry) { return entry.source === 'manual' && !entry.confirmed; }).length,
      distinctCountries: countries.size,
      distinctProvinces: provinces.size,
      provinces: ranking(provinces),
      distinctCities: cities.size,
      distinctStores: stores.size,
      countries: values(countries).map(function (country) { return { country_code: country.country_code, count: country.count, cityCount: country.cityKeys.size, storeCount: country.storeKeys.size }; }).sort(function (a, b) { return b.count - a.count || a.country_code.localeCompare(b.country_code); }),
      cities: ranking(cities),
      stores: ranking(stores),
      months: values(months).sort(function (a, b) { return a.month.localeCompare(b.month); }),
      years: values(years).sort(function (a, b) { return a.year.localeCompare(b.year); }),
      foods: ranking(foods),
      collaborations: ranking(collaborations),
      entries: entries.slice().sort(function (a, b) { return b.date.localeCompare(a.date) || a.id.localeCompare(b.id); }),
      candidateEntries: filtered.filter(function (entry) { return entry.source === 'mcp_candidate'; }).sort(function (a, b) { return b.date.localeCompare(a.date) || a.id.localeCompare(b.id); }),
      latestDate: entries.length ? entries.reduce(function (latest, entry) { return entry.date > latest ? entry.date : latest; }, '') : null,
      storeIdentity: 'user-entered country + normalized city + normalized store name; not an official store identity',
      coverage: 'Counts describe user-confirmed journal entries, not verified visits or a complete global order history.'
    };
  }

  return Object.freeze({
    normalizeEntry: normalizeEntry,
    normalizeArchive: normalizeArchive,
    summarize: summarize,
    limits: Object.freeze({ entries: MAX_ENTRIES, photoBytes: MAX_PHOTO_BYTES, archiveBytes: MAX_ARCHIVE_BYTES })
  });
});
