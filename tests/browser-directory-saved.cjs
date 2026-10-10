'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chinese=require('../web/chinese-search-normalization.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/national-store-directory.json'),'utf8'));
const first=catalog.stores.find(s=>s.id==='tw:fda:H-112411160-01887-5');
assert.ok(first && first.tax_status,'the newly matched Pingzhen branch has tax evidence');
const second=catalog.stores.find(s=>s.province_code==='710000' && s.city!==first.city && s.tax_status);
const extra=catalog.stores.find(s=>s.province_code==='710000' && s.city===first.city && s.code!==first.code && s.tax_status);
const base=process.env.APP_URL || 'https://directory-saved.test/china-map/';
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  await context.addInitScript(({first,second})=>{
   if(localStorage.getItem('mcd-china-map-personal-v1'))return;
   const wish=s=>({source:'manual',code:s.code,name:s.aliases.find(a=>a.includes(' · ')),city:s.city.replace(/市$/,''),province_code:s.province_code,address:s.address,note:'手机验收公开示例，保留原随记。'});
   localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify({version:1,data_kind:'manual',entries:[],wishlist:[wish(first),wish(second),{...wish(first),source:'mcp_nearby'}]}));
  },{first,second});
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
  const page=await context.newPage(),errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\//.test(r.url()))api.push(r.url());});await page.goto(base);
  await page.locator('#open-national-catalog').click();await page.locator('#directory-province-filter').selectOption('710000');
  await page.locator('#national-next').click();assert.match(await page.locator('#national-page').innerText(),/^2 /);
  await page.locator('#directory-saved').click();assert.equal(await page.locator('#national-page').innerText(),'1 / 1');
  assert.equal(await page.locator('.national-store-row').count(),2,'same code from another source does not collect the catalog record twice');
  assert.equal(await page.locator('#directory-saved').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.national-saved-mark').count(),2);
  const city=first.city.replace(/市$/,'');await page.locator('#directory-city-filter').selectOption(city);
  assert.equal(await page.locator('.national-store-row').count(),1);await page.locator('#directory-query').fill(first.aliases.find(a=>a.includes(' · ')));
  await page.locator('.national-store-row').click();assert.equal(await page.locator('#store-discovery-body h3').innerText(),first.name);
  assert.equal(await page.getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true);
  assert.match(await page.locator('#store-discovery-body').innerText(),/本次财政部税籍资料列为营业中/);
  await page.locator('[data-close="store-discovery-dialog"]').click();await page.locator('#directory-query').fill('');
  await page.locator('#directory-all').click();assert.equal(await page.locator('#directory-city-filter').inputValue(),city);
  await page.locator('#directory-query').fill(chinese.fold(extra.name));await page.locator('.national-store-row').filter({hasText:extra.name}).click();
  await page.getByRole('button',{name:'想去这家',exact:true}).click();await page.locator('[data-close="store-discovery-dialog"]').click();
  assert.match(await page.locator('#directory-saved').innerText(),/1$/);assert.equal(await page.locator('.national-saved-mark').count(),1,'collection updates the directory immediately');
  await page.locator('#directory-query').fill('');await page.locator('#directory-saved').click();assert.equal(await page.locator('.national-store-row').count(),2);
  assert.equal(await page.locator('#directory-city-filter').inputValue(),city);
  assert.ok(await page.locator('#directory-saved').evaluate(e=>e.getBoundingClientRect().height>=44));
  assert.ok(await page.locator('#national-catalog-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
  if(process.env.CAPTURE_SAVED){await page.locator('#national-catalog-dialog').screenshot({path:process.env.CAPTURE_SAVED});}
  await page.locator('#directory-query').fill(chinese.fold(extra.name));await page.locator('.national-store-row').click();
  await page.getByRole('button',{name:'取消收藏',exact:true}).click();await page.locator('[data-close="store-discovery-dialog"]').click();
  assert.equal(await page.locator('.national-store-row').count(),0);assert.match(await page.locator('#directory-saved').innerText(),/0$/);
  await page.getByRole('button',{name:'看看全部门店',exact:true}).click();assert.equal(await page.locator('#directory-query').inputValue(),chinese.fold(extra.name));assert.equal(await page.locator('.national-store-row').count(),1);assert.equal(await page.locator('.national-saved-mark').count(),0);
  await page.locator('#directory-query').fill('');await page.locator('#directory-saved').click();
  await page.locator('#directory-city-filter').selectOption('台北');assert.equal(await page.locator('.national-store-row').count(),0);
  await page.getByRole('button',{name:'看看全部门店',exact:true}).click();assert.ok(await page.locator('.national-store-row').count()>0);assert.equal(await page.locator('#directory-city-filter').inputValue(),'台北');
  await page.getByRole('button',{name:'关闭全国门店',exact:true}).click();await page.reload();
  await page.locator('#open-national-catalog').click();await page.locator('#directory-saved').click();assert.equal(await page.locator('.national-store-row').count(),2);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));assert.equal(saved.wishlist.length,3);assert.equal(saved.entries.length,0);assert.equal(saved.wishlist[0].note,'手机验收公开示例，保留原随记。');assert.equal(saved.wishlist[0].code,first.code);
  // Independently exercise removing the user's final catalog collection.
  await page.evaluate(()=>{const key='mcd-china-map-personal-v1',a=JSON.parse(localStorage.getItem(key));a.wishlist=[a.wishlist[0]];localStorage.setItem(key,JSON.stringify(a));});await page.reload();
  await page.locator('#open-national-catalog').click();await page.locator('#directory-saved').click();await page.locator('.national-store-row').click();await page.getByRole('button',{name:'取消收藏',exact:true}).click();await page.locator('[data-close="store-discovery-dialog"]').click();
  assert.equal(await page.locator('.national-store-row').count(),0);await page.getByRole('button',{name:'看看全部门店',exact:true}).click();assert.ok(await page.locator('.national-store-row').count()>0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')).wishlist.length),0);
  await page.locator('#directory-query').fill('澳门 利新');assert.equal(await page.locator('.national-store-row').count(),1);await page.locator('.national-store-row').click();
  const detail=page.locator('#store-discovery-body');assert.equal(await detail.locator('h3').innerText(),'利新麥當勞餐廳');assert.match(await detail.locator('.place').innerText(),/124-126.*地下A座/);assert.match(await detail.innerText(),/市政署登记地址：.*閣樓/);
  assert.equal(await detail.getByRole('link',{name:'市政署餐饮登记出处 ↗',exact:true}).getAttribute('href'),'https://app.iam.gov.mo/LFBPriceEnquiry/spring/main?lang=cn');
  await page.getByRole('button',{name:'想去这家',exact:true}).click();await page.locator('[data-close="store-discovery-dialog"]').click();assert.equal(await page.locator('.national-saved-mark').count(),1);
  assert.deepEqual(errors,[]);assert.deepEqual(api,[]);console.log('PASS: mobile saved directory, province/city/legacy-name filters, source identity, page reset, immediate new collection, empty recovery and reload preserve notes without visits/API calls.');
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
