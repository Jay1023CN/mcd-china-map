'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chinese=require('../web/chinese-search-normalization.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/national-store-directory.json'),'utf8'));
const store=catalog.stores.find(s=>s.tax_status && !s.brand_name_source_url);
const oldName=store.aliases.find(a=>a.includes(' · ')),city=store.city.replace(/市$/,'');
const base=process.env.APP_URL || 'https://taiwan-names.test/china-map/';
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  await context.addInitScript(({store,oldName,city})=>{if(!localStorage.getItem('mcd-china-map-personal-v1'))localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify({version:1,data_kind:'manual',entries:[],wishlist:[{source:'manual',code:store.code,name:oldName,city,province_code:store.province_code,address:store.address,note:'功能验收公开资料，不是本人真实到访。'}]}));},{store,oldName,city});
  if(!process.env.APP_URL){
   const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web'),urlBase=new URL(base);
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==urlBase.origin || !url.pathname.startsWith(urlBase.pathname))return route.abort();
    const file=path.resolve(root,decodeURIComponent(url.pathname.slice(urlBase.pathname.length)) || 'index.html');
    if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    const mime={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({body:fs.readFileSync(file),contentType:mime});
   });
  }
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await page.locator('#open-national-catalog').click();await page.locator('#directory-query').fill(chinese.fold(store.name));
  const row=page.locator('.national-store-row').filter({hasText:store.name});await row.click();
  assert.equal(await page.locator('#store-discovery-body h3').innerText(),store.name);
  assert.match(await page.locator('#store-discovery-body').innerText(),/本次财政部税籍资料列为营业中/);
  assert.equal(await page.locator('#store-discovery-body').getByRole('link',{name:'查看营业税籍来源 ↗',exact:true}).getAttribute('href'),'https://data.gov.tw/dataset/9400');
  assert.equal(await page.getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true,'previous stable ID still identifies the collected record after renaming');
  await page.locator('[data-close="store-discovery-dialog"]').click();await page.locator('#directory-query').fill(oldName);await row.click();
  assert.equal(await page.locator('#store-discovery-body h3').innerText(),store.name,'old name remains a searchable alias');
  await page.locator('[data-close="store-discovery-dialog"]').click();
  const extra=catalog.stores.find(s=>s.tax_status && !s.brand_name_source_url && s.code!==store.code);
  await page.locator('#directory-query').fill(chinese.fold(extra.name));await page.locator('.national-store-row').filter({hasText:extra.name}).click();
  await page.getByRole('button',{name:'想去这家',exact:true}).click();await page.locator('[data-close="store-discovery-dialog"]').click();
  await page.locator('#directory-query').fill('澳门 银河');const galaxy=page.locator('.national-store-row').filter({hasText:'銀河'});assert.equal(await galaxy.count(),1);await galaxy.click();
  const detail=page.locator('#store-discovery-body');assert.match(await detail.locator('.place').innerText(),/G017/);assert.match(await detail.innerText(),/许可登记地址：.*G35/);
  assert.equal(await detail.getByRole('link',{name:'访客地址来源：官方场地页面 ↗',exact:true}).getAttribute('href'),'https://www.galaxymacau.com/zh-hant/dining/restaurants/mcdonald/');
  const navigation=await detail.getByRole('link',{name:/高德/}).getAttribute('href');assert.ok(decodeURIComponent(navigation).includes('G017'));assert.ok(!decodeURIComponent(navigation).includes('G35'));
  await page.locator('[data-close="store-discovery-dialog"]').click();await page.getByRole('button',{name:'关闭全国门店',exact:true}).click();
  await page.reload();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
  assert.equal(saved.wishlist.length,2);assert.ok(saved.wishlist.some(s=>s.code===extra.code));assert.equal(saved.wishlist[0].code,store.code);assert.equal(saved.wishlist[0].note,'功能验收公开资料，不是本人真实到访。');assert.equal(saved.entries.length,0);
  assert.deepEqual(errors,[]);console.log('PASS: mobile Taiwan new/legacy names, tax source, stable and new collections; Macau visitor G017 navigation and separate G35 registration; reload preserves notes without invented visits.');
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
