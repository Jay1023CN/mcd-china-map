'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../web/collection-preferences.js'),E=require('../web/journal-engine.js'),M=require('../web/archive-merge.js');
test('album choices preserve order and intentional empty selection while dropping unknown fields',()=>{
  const row=P.normalize([{id:'city:310000|上海',selected_ids:['b','a','b'],photo_ids:[],cover_id:'b',caption:'一座城的麦麦小事',token:'secret'}])[0];
  assert.deepEqual(row.selected_ids,['b','a']);assert.deepEqual(row.photo_ids,[]);assert.equal(row.token,undefined);
  assert.deepEqual(P.update([row],row.id,{selected_ids:[]})[0].selected_ids,[]);
});
test('limits and malformed presentation choices cannot replace a saved archive',()=>{
  assert.throws(()=>P.normalize([{id:'month:2026-13'}]));assert.throws(()=>P.normalize([{id:'month:2026-10',photo_ids:['1','2','3','4']}]));
  assert.throws(()=>P.normalize([{id:'city:上海',selected_ids:Array.from({length:13},(_,i)=>String(i))}]));
  assert.throws(()=>P.normalize([{id:'month:2026-10',caption:'字'.repeat(101)}]));
});
test('old archives remain unchanged and collection choices survive normalization',()=>{
  const archive={version:1,data_kind:'manual',entries:[]};assert.deepEqual(E.normalizeArchive(archive),archive);
  const next={...archive,collection_preferences:[{id:'month:2026-10',caption:'一月的小事',layout:'feature',photo_ids:['a','b']}]};
  assert.deepEqual(E.normalizeArchive(next),next);
});
test('independent album edits merge without discarding journal or another album',()=>{
  const base={version:1,data_kind:'manual',entries:[],collection_preferences:[{id:'city:上海',caption:'旧'}]};
  const local={...base,collection_preferences:[{id:'city:上海',caption:'本地'}]};
  const remote={...base,collection_preferences:[{id:'city:上海',caption:'旧'},{id:'month:2026-10',layout:'feature'}]};
  assert.deepEqual(M.merge(base,local,remote).collection_preferences,[{id:'city:上海',caption:'本地'},{id:'month:2026-10',layout:'feature'}]);
});
