'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ArchiveMerge = require('../web/archive-merge.js');

const archive = (entries = [], extra = {}) => ({version: 1, data_kind: 'journal', source: 'local', entries, ...extra});

test('remote-only additions survive alongside local additions', () => {
  const base = archive([{id: 'base', store: '原有'}]);
  const local = archive([{id: 'base', store: '原有'}, {id: 'local-new', store: '本地新增'}]);
  const remote = archive([{id: 'base', store: '原有'}, {id: 'remote-new', store: '另一标签新增'}]);
  const merged = ArchiveMerge.merge(base, local, remote);
  assert.deepEqual(merged.entries.map(item => item.id), ['base', 'local-new', 'remote-new']);
});

test('local deletion remains deleted while remote deletion applies to unchanged local entries', () => {
  const base = archive([{id: 'locally-removed'}, {id: 'remotely-removed'}, {id: 'kept'}]);
  const local = archive([{id: 'remotely-removed'}, {id: 'kept'}]);
  const remote = archive([{id: 'locally-removed'}, {id: 'kept'}]);
  const merged = ArchiveMerge.merge(base, local, remote);
  assert.deepEqual(merged.entries.map(item => item.id), ['kept']);
});

test('local photo edit wins a same-entry conflict without mutating source archives', () => {
  const base = archive([{id: 'visit', note: '原随记', photo: {data_url: 'data:image/png;base64,YQ=='}}]);
  const local = archive([{id: 'visit', note: '原随记', photo: {data_url: 'data:image/png;base64,Yg=='}}]);
  const remote = archive([{id: 'visit', note: '远端随记', photo: {data_url: 'data:image/png;base64,YQ=='}}]);
  const merged = ArchiveMerge.merge(base, local, remote);
  assert.equal(merged.entries[0].photo.data_url, 'data:image/png;base64,Yg==');
  merged.entries[0].photo.data_url = 'changed result only';
  assert.equal(local.entries[0].photo.data_url, 'data:image/png;base64,Yg==');
  assert.equal(base.entries[0].photo.data_url, 'data:image/png;base64,YQ==');
  assert.equal(remote.entries[0].note, '远端随记');
});

test('wishlist entries merge by id and preserve local note edits', () => {
  const base = archive([], {wishlist: [{id: 'wish-1', note: '待观察'}]});
  const local = archive([], {wishlist: [{id: 'wish-1', note: '想带朋友去'}]});
  const remote = archive([], {wishlist: [{id: 'wish-1', note: '待观察'}, {id: 'wish-2', note: '另一标签新增'}]});
  const merged = ArchiveMerge.merge(base, local, remote);
  assert.deepEqual(merged.wishlist, [
    {id: 'wish-1', note: '想带朋友去'}, {id: 'wish-2', note: '另一标签新增'}
  ]);
});

test('confirmed manual visit is not replaced by an MCP candidate with the same id', () => {
  const confirmed = {id: 'visit', source: 'manual', confirmed: true, store: '已确认门店'};
  const downgraded = {id: 'visit', source: 'mcp_candidate', confirmed: false, store: '候选门店'};
  const base = archive([confirmed]);
  const local = archive([confirmed]);
  const remote = archive([downgraded]);
  assert.deepEqual(ArchiveMerge.merge(base, local, remote).entries, [confirmed]);
});

test('MCP deletion tombstones union across tabs and suppress stale MCP candidates and converted orders', () => {
  const candidateId = 'mcp-aaaaaaaaaaaaaaaaaaaaaaaa';
  const convertedId = 'mcp-bbbbbbbbbbbbbbbbbbbbbbbb';
  const base = archive([], {deleted_order_ids: [candidateId]});
  const local = archive([], {deleted_order_ids: [candidateId, convertedId]});
  const remote = archive([
    {id: candidateId, source: 'mcp_candidate', confirmed: false, store: '已删除候选'},
    {id: convertedId, source: 'manual', confirmed: true, origin: 'mcp', store: '已删除自动手账'},
    {id: 'manual-keep', source: 'manual', confirmed: true, store: '本人手动记录'}
  ], {deleted_order_ids: [convertedId]});
  const merged = ArchiveMerge.merge(base, local, remote);
  assert.deepEqual(merged.deleted_order_ids, [candidateId, convertedId]);
  assert.deepEqual(merged.entries, [{id: 'manual-keep', source: 'manual', confirmed: true, store: '本人手动记录'}]);
});

test('uses local metadata, drops unknown top-level fields and omits absent wishlist', () => {
  const merged = ArchiveMerge.merge(
    {...archive(), private: 'base'},
    {...archive([{id: 'one'}]), data_kind: 'personal', source: 'local-choice', token: 'secret'},
    {...archive([{id: 'one'}]), data_kind: 'other', unknown: true}
  );
  assert.deepEqual(Object.keys(merged).sort(), ['data_kind', 'entries', 'source', 'version']);
  assert.equal(merged.data_kind, 'personal');
  assert.equal(merged.source, 'local-choice');
  assert.equal(Object.hasOwn(merged, 'wishlist'), false);
  assert.doesNotMatch(JSON.stringify(merged), /secret|unknown|private/);
});
