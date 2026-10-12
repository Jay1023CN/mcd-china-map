'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/meal-catalog.js');
const catalog = require('../assets/data/meal-catalog.json');
test('official catalog covers each category with per-product source and images',()=>{
  assert.equal(catalog.categories.length,8);
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
  assert.deepEqual(groups.map(group=>group.id),catalog.categories.filter(category=>category.id!=='new').map(category=>category.id));
  assert.equal(engine.groups(engine.filter('frequent',{entries})).at(-1).label,'以前吃过');
  const before=JSON.stringify(catalog);engine.filter('all',{entries,sort:'frequency'});assert.equal(JSON.stringify(catalog),before);
});

test('menu matching resolves official aliases without rewriting unmatched order names',()=>{
  const engine=M.create(catalog);
  assert.equal(engine.match('麦辣鸡腿堡').name,'麦辣鸡腿汉堡');
  assert.equal(engine.match('无糖可口可乐').name,'无糖可口可乐');
  assert.equal(engine.match('门店自定义新品'),null);
});

test('current launch items and combo offers are searchable in their own tabs',()=>{
  const engine=M.create(catalog);
  assert.ok(engine.filter('combos').length>=10);
  assert.ok(engine.filter('new').length>=8);
  assert.ok(engine.filter('new').some(item=>item.name==='龙焰鸡腿堡'));
  assert.ok(engine.filter('combos').some(item=>item.name==='龙焰鸡腿堡三件套'));
  assert.ok(engine.filter('burgers').some(item=>item.name==='龙焰鸡腿堡'));
  assert.ok(engine.filter('combos').every(item=>item.source_url.startsWith('https://www.mcdonalds.com.cn/')));
});

test('order pictures handle size labels while keeping sugar and flavour distinctions',()=>{
  const engine=M.create(catalog);
  assert.equal(engine.match('无糖可口可乐大杯').name,'无糖可口可乐');
  assert.equal(engine.match('无糖可乐（中杯）').name,'无糖可口可乐');
  assert.equal(engine.match('可乐小杯').name,'可口可乐');
  assert.equal(engine.match('薯条（大份）').name,'薯条');
  assert.equal(engine.match('麦乐鸡 (5块)').name,'麦乐鸡 (5块)');
  assert.equal(engine.match('麦乐鸡 (10块)'),null,'a different pack size is not relabelled as five pieces');
  assert.equal(engine.match('奥利奥麦旋风').name,'奥利奥麦旋风');
  assert.equal(engine.match('限定大米风味麦旋风'),null);
  assert.equal(engine.match('麦旋风'),null,'an unspecified flavour does not pick an arbitrary photo');
  assert.equal(engine.match('百事可乐'),null);
});

test('share picture matching returns explicit components without changing the original order',()=>{
  const foods=['薯条（大份） · 无糖可口可乐大杯','奥利奥麦旋风','薯条','巨无霸单人餐','未知五件套（麦金卡免配）'];
  const before=JSON.stringify(foods),result=M.create(catalog).matchFoods(foods);
  assert.deepEqual(result.map(item=>item.name),['薯条','无糖可口可乐','奥利奥麦旋风','巨无霸']);
  assert.equal(result[1].order_name,'无糖可口可乐大杯');
  assert.equal(JSON.stringify(foods),before);
  assert.ok(result.every(item=>item.image_url));
  assert.deepEqual(M.matchFoods(catalog,['未知五件套']),[]);
  assert.deepEqual(M.matchFoods(catalog,null),[]);
});

test('ambiguous image aliases never choose the first food',()=>{
  const items=[{id:'one',name:'第一种',aliases:['重名餐品']},{id:'two',name:'第二种',aliases:['重名餐品']}];
  assert.equal(M.match(items,'重名餐品'),null);
});
