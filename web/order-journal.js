/* Convert completed-order imports into editable journal pages. No network or storage. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderJournal = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  const cityName = value => clean(value).replace(/市$/, '');
  function materialize(input, options = {}) {
    const archive = JSON.parse(JSON.stringify(input));
    if (archive.data_kind === 'synthetic') return archive;
    const cities = options.cities || [], stores = options.stores || [];
    const deleted = new Set(archive.deleted_order_ids || []);
    archive.entries = archive.entries.filter(entry => !(deleted.has(entry.id) &&
      (entry.source === 'mcp_candidate' || entry.origin === 'mcp'))).map(entry => {
      if (entry.source !== 'mcp_candidate' && entry.origin !== 'mcp') return entry;
      const store = stores.find(store => [store.name, ...(store.aliases || [])].some(name => clean(name) === clean(entry.store)));
      let city = cities.find(city => cityName(city.city) === cityName(entry.city) &&
        (!entry.province_code || entry.province_code === city.province_code));
      if (!clean(entry.city)) {
        if (store?.city) entry.city = store.city;
        else {
          const suffix = clean(entry.store).replace(/^麦当劳\s*/, '');
          const matches = cities.filter(city => suffix.startsWith(city.city));
          if (matches.length === 1) entry.city = matches[0].city;
        }
        city = cities.find(city => cityName(city.city) === cityName(entry.city));
      }
      if (!entry.province_code) entry.province_code = city?.province_code || store?.province_code || '';
      if (!entry.location && city) entry.location = {lat: city.lat, lon: city.lon, precision: 'city'};
      if (!entry.default_photo && store?.default_photo && cityName(entry.city) === cityName(store.city))
        entry.default_photo = {...store.default_photo};
      if (entry.source === 'mcp_candidate') {
        entry.source = 'manual'; entry.confirmed = true; entry.origin = 'mcp';
        if ((entry.note || '').startsWith('中国大陆订单线索')) entry.note = '';
      }
      return entry;
    });
    return archive;
  }
  return Object.freeze({materialize});
});
