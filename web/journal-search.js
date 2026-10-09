/* Small, local-only text filtering for confirmed journal entries. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JournalSearch = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function strings(value) {
    if (typeof value === 'string') return [value];
    if (!Array.isArray(value)) return [];
    return value.reduce(function (result, item) {
      if (typeof item === 'string') result.push(item);
      else if (item && typeof item === 'object') {
        if (typeof item.name === 'string') result.push(item.name);
        else if (typeof item.title === 'string') result.push(item.title);
      }
      return result;
    }, []);
  }

  function searchableText(entry) {
    return [entry.city, entry.store, entry.note]
      .filter(function (value) { return typeof value === 'string'; })
      .concat(strings(entry.foods))
      .join(' ')
      .normalize('NFKC')
      .toLowerCase();
  }

  function filter(entries, query) {
    if (!Array.isArray(entries)) return [];
    var terms = typeof query === 'string' ? query.trim().split(/\s+/).filter(Boolean).map(function (term) {
      return term.normalize('NFKC').toLowerCase();
    }) : [];
    return entries.filter(function (entry) {
      if (!entry || typeof entry !== 'object' || entry.confirmed !== true) return false;
      if (!terms.length) return true;
      var haystack = searchableText(entry);
      return terms.every(function (term) { return haystack.includes(term); });
    });
  }

  return {filter: filter};
});
