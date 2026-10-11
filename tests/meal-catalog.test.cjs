'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/meal-catalog.js');
const catalog = require('../assets/data/meal-catalog.json');
test('official catalog covers each category with per-product source and images',()=>{
  assert.equal(catalog.categories.length,6);
  for(const category of catalog.categories) assert.ok(M.filter(catalog,category.id).length>0,category.id);
  const ids = new Set();
  for(const item of catalog.items){assert.ok(item.name && !ids.has(item.id));ids.add(item.id);assert.match(item.source_url,/^https:\/\/www\.mcdonalds\.com\.cn\//);if(item.image_url)assert.match(item.image_url,/^https:\/\//);assert.equal(item.price,undefined);}
});
test('frequency counts meals, not quantity or duplicate aliases, and includes order records',()=>{
  const entries=[
    {id:'first',date:'2026-10-09',foods:['麦辣鸡腿堡','麦辣鸡腿汉堡','麦辣鸡腿堡','薯条'],confirmed:true,source:'manual'},
    {id:'first',date:'2026-10-09',foods:['薯条'],confirmed:true},
    {id:'second',date:'2026-10-10',foods:['薯条','上次的限定新品'],origin:'mcp',confirmed:true},
    {id:'candidate',foods:['麦辣鸡腿堡'],confirmed:false},
    {id:'planned',kind:'plan',foods:['巨无霸']}
  ];
  const result=M.personalFrequency(entries,catalog);
  assert.equal(result.find(item=>item.name==='薯条').count,2);
  assert.equal(result.find(item=>item.name==='麦辣鸡腿汉堡').count,1);
  assert.equal(result.find(item=>item.name==='上次的限定新品').is_history_only,true);
  assert.equal(result.some(item=>item.name==='巨无霸'),false);
  assert.equal(result[0].name,'薯条');
  assert.deepEqual(M.personalFrequency({data_kind:'synthetic',entries},catalog),[]);
});
test('category and personal sorting remain separate and deterministic; history is preserved',()=>{
  const engine=M.create(catalog), entries=[{id:'a',date:'2026-10-09',foods:['鲜萃咖啡','记忆中的特别餐品']},{id:'b',date:'2026-10-10',foods:['鲜萃咖啡']}];
  assert.equal(engine.filter('frequent',{entries})[0].name,'鲜萃咖啡');
  assert.equal(engine.filter('drinks',{entries,sort:'frequency'})[0].name,'鲜萃咖啡');
  assert.ok(engine.filter('breakfast').some(item=>item.name==='优品豆浆'));
  assert.ok(engine.filter('drinks').some(item=>item.name==='优品豆浆'));
  const groups=engine.groups(engine.filter('all'));
  assert.deepEqual(groups.map(group=>group.id),catalog.categories.map(category=>category.id));
  assert.equal(engine.groups(engine.filter('frequent',{entries})).at(-1).label,'以前吃过');
  const before=JSON.stringify(catalog);engine.filter('all',{entries,sort:'frequency'});assert.equal(JSON.stringify(catalog),before);
});
