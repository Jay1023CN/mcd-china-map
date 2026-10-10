'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const N=require('../web/store-navigation.js');
test('navigation carries named store and address without treating city coordinates as store coordinates',()=>{
  const result=N.project({city:'上海',store:'麦当劳人民广场餐厅',store_reference:{address:'南京西路 & 100号'},location:{lat:31,lon:121,precision:'city'},token:'private'});
  const url=new URL(result.url);
  assert.equal(url.origin,'https://uri.amap.com');assert.equal(url.searchParams.get('city'),'上海');
  assert.equal(url.searchParams.get('keyword'),'麦当劳人民广场餐厅 南京西路 & 100号');
  assert.equal(url.searchParams.get('callnative'),'1');assert.equal(url.searchParams.has('center'),false);
  assert.equal(JSON.stringify(result).includes('private'),false);
});
test('name-only records work; missing store name has no navigation link',()=>{
  assert.equal(N.project({name:'麦当劳'}).address,'');assert.equal(N.project({city:'上海'}),null);
});
