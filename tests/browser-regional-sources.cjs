'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chinese=require('../web/chinese-search-normalization.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/national-store-directory.json'),'utf8'));
const hk=catalog.stores.find(s=>s.id==='hk:900043');
const ferry=catalog.stores.find(s=>s.directory_phone==='28703031');
const university=catalog.stores.find(s=>s.directory_phone==='28451098');
const base=process.env.APP_URL || 'https://regional-sources.test/china-map/';
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  if(!process.env.APP_URL){
   const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web'),prefix=new URL(base);
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==prefix.origin || !url.pathname.startsWith(prefix.pathname))return route.abort();
    const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.pathname.length)) || 'index.html');
    if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    const mime={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({body:fs.readFileSync(file),contentType:mime});
   });
  }
  const page=await context.newPage(),errors=[],api=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\//.test(r.url()))api.push(r.url());});
  await page.goto(base);await page.locator('#open-national-catalog').click();
  await page.locator('#directory-query').fill('香港 甜品站');
  assert.match(await page.locator('#national-status').innerText(),/找到 80 条/);
  await page.locator('#directory-query').fill(chinese.fold(hk.name));
  await page.locator('.national-store-row').filter({hasText:hk.name}).click();
  const detail=page.locator('#store-discovery-body');
  assert.match(await detail.innerText(),/官方资料列有甜品站/);
  assert.equal(await detail.getByRole('link',{name:'甜品站地址列表 ↗',exact:true}).getAttribute('href'),hk.dessert_station_source_url);
  assert.equal(await detail.locator('.place').innerText(),hk.address);
  await page.getByRole('button',{name:'想去这家',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')).wishlist[0].code),hk.code);
  await page.locator('[data-close="store-discovery-dialog"]').click();
  await page.locator('#directory-query').fill('澳门 外港');await page.locator('.national-store-row').click();
  assert.equal(await detail.locator('h3').innerText(),ferry.name);
  assert.match(await detail.innerText(),/3006/);assert.match(await detail.innerText(),/07:00-19:30/);
  assert.equal(await detail.getByRole('link',{name:'访客地址来源：官方场地页面 ↗',exact:true}).getAttribute('href'),ferry.venue_source_url);
  await page.locator('[data-close="store-discovery-dialog"]').click();
  await page.locator('#directory-query').fill('澳门 科大');await page.locator('.national-store-row').click();
  assert.equal(await detail.locator('h3').innerText(),university.name);
  assert.match(await detail.innerText(),/政府活动资料（2025\/03\/21）/);
  assert.equal(await detail.getByRole('link',{name:'查看这份政府资料 ↗',exact:true}).getAttribute('href'),university.government_service_source_url);
  assert.equal(await detail.getByRole('link',{name:'市政署餐饮登记出处 ↗',exact:true}).count(),0);
  assert.ok(await detail.evaluate(e=>e.scrollWidth<=e.clientWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
  console.log('PASS: mobile dessert search, parent identity collection, ferry visitor source and dated government university alias without API calls.');
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
