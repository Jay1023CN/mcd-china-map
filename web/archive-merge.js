/* Three-way merge for independently edited local journal tabs. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArchiveMerge = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonical(value[key]);
    }).join(',') + '}';
  }

  function equal(a, b) {
    return canonical(a) === canonical(b);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function idMap(items) {
    var map = new Map();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id) map.set(item.id, item);
    });
    return map;
  }

  function confirmedManual(item) {
    return !!item && item.source === 'manual' && item.confirmed === true;
  }

  function candidate(item) {
    return !!item && item.source === 'mcp_candidate';
  }

  function mergeList(baseItems, localItems, remoteItems) {
    var base = idMap(baseItems);
    var local = idMap(localItems);
    var remote = idMap(remoteItems);
    var ids = [];
    var seen = new Set();
    [localItems, remoteItems].forEach(function (items) {
      (Array.isArray(items) ? items : []).forEach(function (item) {
        if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) return;
        seen.add(item.id);
        ids.push(item.id);
      });
    });

    var result = [];
    ids.forEach(function (id) {
      var before = base.get(id);
      var ours = local.get(id);
      var theirs = remote.get(id);
      var selected;

      if (ours && !before) selected = ours;
      else if (!ours && before) selected = undefined; // Local deletion wins.
      else if (!ours && !before) selected = theirs;
      else if (equal(ours, before)) selected = theirs; // Follow remote edits or deletion.
      else selected = ours; // Local edit wins a same-entry conflict.

      // A candidate record can never replace an already confirmed manual visit.
      if (candidate(selected)) {
        if (confirmedManual(ours)) selected = ours;
        else if (confirmedManual(theirs)) selected = theirs;
        else if (confirmedManual(before)) selected = before;
      }
      if (selected) result.push(clone(selected));
    });
    return result;
  }

  function merge(base, local, remote) {
    base = base && typeof base === 'object' ? base : {};
    local = local && typeof local === 'object' ? local : {};
    remote = remote && typeof remote === 'object' ? remote : {};
    var output = {
      version: local.version !== undefined ? clone(local.version) :
        remote.version !== undefined ? clone(remote.version) : clone(base.version),
      data_kind: clone(local.data_kind),
      source: clone(local.source),
      entries: mergeList(base.entries, local.entries, remote.entries)
    };
    if (Object.prototype.hasOwnProperty.call(base, 'wishlist') ||
        Object.prototype.hasOwnProperty.call(local, 'wishlist') ||
        Object.prototype.hasOwnProperty.call(remote, 'wishlist')) {
      output.wishlist = mergeList(base.wishlist, local.wishlist, remote.wishlist);
    }
    return output;
  }

  return {merge: merge};
});
