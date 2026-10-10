'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../web/national-store-search.js');
const fixtures=[
  {id:'cn:1',name:'麦当劳南京西路餐厅',city:'上海市',province_code:'310000',address:'黄浦区南京西路258号',featured:true,aliases:['南京西路NX258'],tags:['McCafé'],default_photo:{url:'https://example.test/1.jpg'},token:'private'},
  {id:'cn:2',name:'麦当劳南京西路餐厅',city:'南京市',province_code:'320000',address:'鼓楼区'},
  {id:'cn:3',name:'麦当劳幸福餐厅',city:'上海市',province_code:'310000',address:'徐汇区',location:{lat:31.2,lon:121.4,precision:'store',coordinate_system:'GCJ-02'}},
  {id:'cn:4',name:'麦当劳幸福餐厅',city:'上海市',province_code:'310000',address:'虹口区',location:{lat:31.2,lon:121.4,precision:'city',coordinate_system:'GCJ-02'}}
];
test('search supports city, province, multiword, alias and feature filters',()=>{
  const index=S.createIndex({stores:fixtures,coverage:{total_stores:4}});
  assert.equal(index.size,4);
  assert.equal(index.search({city:'上海'}).total,3);
  assert.equal(index.search({query:'上海 南京西路 258'}).total,1);
  assert.equal(index.search({query:'ｎｘ２５８'}).total,1);
  assert.equal(index.search({province_code:'320000'}).stores[0].id,'cn:2');
  assert.equal(index.search({featured:true}).total,1);
  assert.equal(index.cities().find(c=>c.city==='上海市').count,3);
});
test('duplicate names are ambiguous; exact name and city never choose an arbitrary store',()=>{
  const index=S.createIndex(fixtures);
  assert.equal(index.find('麦当劳南京西路餐厅'),null);
  assert.equal(index.find('麦当劳南京西路餐厅','上海').id,'cn:1');
  assert.equal(index.find('麦当劳幸福餐厅','上海'),null);
  assert.equal(index.find('南京西路NX258','上海').id,'cn:1');
});
test('pagination returns full totals and real offsets, even for an empty or exhausted page',()=>{
  const index=S.createIndex(fixtures);
  const page=index.search({limit:2});
  assert.equal(page.total,4);assert.equal(page.has_more,true);assert.equal(page.stores.length,2);
  assert.equal(index.search({offset:2,limit:2}).has_more,false);
  assert.equal(index.search({offset:400}).stores.length,0);
  assert.equal(index.search({query:'不存在'}).total,0);
});
test('unlocated records remain searchable and collectible without invented coordinates or private fields',()=>{
  const index=S.createIndex(fixtures);
  assert.equal(index.get('cn:1').location,undefined);
  assert.equal(index.get('cn:4').location,undefined);
  assert.equal(index.get('cn:3').location.coordinate_system,'GCJ-02');
  assert.equal(JSON.stringify(index.search()).includes('private'),false);
  const candidate=S.candidate(index.get('cn:1'));
  assert.equal(candidate.source,'manual');assert.equal(candidate.name,fixtures[0].name);
  assert.equal(candidate.location,undefined);assert.equal(candidate.confirmed,undefined);
});
test('thousands of stores page without silently limiting the catalog to featured stores',()=>{
  const stores=Array.from({length:9000},(_,i)=>({id:'cn:'+i,name:'麦当劳'+i+'餐厅',city:'上海市',featured:i===0}));
  const index=S.createIndex(stores);assert.equal(index.size,9000);
  assert.equal(index.search().total,9000);assert.equal(index.search({query:'8999'}).stores[0].id,'cn:8999');
});
test('load reports fetch failures and builds an index from valid public JSON',async()=>{
  await assert.rejects(S.load('/catalog',{fetch:async()=>({ok:false})}),/载入/);
  const index=await S.load('/catalog',{fetch:async()=>({ok:true,json:async()=>({stores:fixtures})})});
  assert.equal(index.size,4);
});
test('simplified brand queries find official Hong Kong traditional names without altering displayed names',()=>{
  const index=S.createIndex([{id:'hk:7',name:'麥當勞英皇道',city:'香港',province_code:'810000',address:'北角英皇道353號'}]);
  assert.equal(index.search('香港 麦当劳').total,1);
  assert.equal(index.search('麦当劳').stores[0].name,'麥當勞英皇道');
});


test('simplified and traditional queries retrieve the same real Macau and Taiwan records',()=>{
  const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../assets/data/national-store-directory.json'),'utf8'));
  const index=S.createIndex(catalog);
  for(const [traditional,simplified] of [['澳門科學館','澳门科学馆'],['台中學士','台中学士']]){
    const original=index.search({query:traditional}).stores;
    assert.equal(original.length,1);
    assert.deepEqual(index.search({query:simplified}).stores.map(s=>s.id),original.map(s=>s.id));
    assert.ok(original[0].name.includes(traditional==='台中學士'?'學士':'科學館'));
  }
});
