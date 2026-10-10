'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.APP_URL || 'https://national-mcd.test/china-map/';
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai',acceptDownloads:true});
  const errors=[],api=[];
  try{
    if(!process.env.APP_URL){
      const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web'),prefix=new URL(base);
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());if(url.pathname.includes('/api/'))api.push(url.pathname);
        if(url.origin!==prefix.origin || !url.pathname.startsWith(prefix.pathname))return route.abort();
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.pathname.length)) || 'index.html');
        if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
        const mime={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
      });
    }
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
    assert.equal(await page.locator('#count-visits').innerText(),'0');
    const data=await page.evaluate(()=>JSON.parse(document.getElementById('journal-data').textContent));
    assert.ok(data.national_catalog.stores.length>8700);assert.equal(data.national_catalog.coverage.mainland_unique_stores,8448);
    await page.locator('#open-national-catalog').click();
    assert.equal(await page.locator('#national-store-list .national-store-row').count(),30);
    const first=await page.locator('.national-store-row').first().innerText();await page.locator('#national-next').click();
    assert.notEqual(await page.locator('.national-store-row').first().innerText(),first);assert.match(await page.locator('#national-page').innerText(),/^2 /);
    await page.locator('#directory-province-filter').selectOption('650000');await page.locator('#directory-city-filter').selectOption('石河子');
    assert.equal(await page.locator('.national-store-row').count(),2,'a city outside the old 103 reference points is searchable');
    assert.match(await page.locator('#national-status').innerText(),/石河子/);
    const ordinary=data.national_catalog.stores.find(s=>!s.featured && s.location && s.location.coordinate_system==='GCJ-02');assert.ok(ordinary);
    await page.locator('#directory-province-filter').selectOption('');await page.locator('#directory-query').fill(ordinary.name);
    await page.locator('.national-store-row').filter({hasText:ordinary.name}).first().click();
    assert.equal(await page.locator('#store-discovery-body h3').innerText(),ordinary.name);
    assert.equal(await page.locator('#store-discovery-body .store-source').getAttribute('href'),ordinary.source_url);
    await page.locator('#store-discovery-body').getByRole('button',{name:'想去这家',exact:true}).click();
    assert.equal(await page.locator('#count-visits').innerText(),'0','collecting a store is not a visit');
    await page.locator('#store-discovery-body').getByRole('button',{name:'我去过，记一餐',exact:true}).click();
    assert.equal(await page.locator('[name=store]').inputValue(),ordinary.name);
    assert.equal(await page.locator('[name=province_code]').inputValue(),ordinary.province_code);
    assert.equal(await page.locator('[name=location_mode]').inputValue(),'store');
    await page.locator('[name=foods]').fill('薯条');await page.locator('[name=note]').fill('功能验收演示：公开门店资料，非本人真实到访。');await page.locator('#save-entry').click();
    await page.locator('#entry-dialog').waitFor({state:'hidden'});
    const archive=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.equal(archive.entries[0].store_reference.source,'official_catalog');assert.equal(archive.entries[0].store_reference.code,ordinary.code);
    assert.deepEqual(archive.entries[0].location,ordinary.location);assert.equal(archive.wishlist.length,1);
    await page.reload();assert.equal(await page.locator('#count-visits').innerText(),'1');
    await page.locator('#tab-journal').click();await page.locator('#journal-grid').getByRole('button',{name:'编辑这一页',exact:true}).click();
    await page.locator('[name=store]').fill('验收：改成未收录门店');await page.locator('#save-entry').click();await page.locator('#entry-dialog').waitFor({state:'hidden'});
    const changed=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.equal(changed.entries[0].location,undefined,'changing the store must not retain another store location');
    assert.equal(changed.entries[0].store_reference,undefined,'changing the store clears its old source identity');
    await page.evaluate(value=>localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify(value)),archive);await page.reload();
    await page.locator('#tab-map').click();await page.locator('#open-national-catalog').click();
    const unlocated=data.national_catalog.stores.find(s=>!s.featured && !s.location && s.province_code && s.source==='official_publicity');assert.ok(unlocated);
    await page.locator('#directory-query').fill(unlocated.name);await page.locator('.national-store-row').filter({hasText:unlocated.name}).first().click();
    await page.locator('#store-discovery-body').getByRole('button',{name:'我去过，记一餐',exact:true}).click();
    assert.equal(await page.locator('[name=location_mode]').inputValue(),'none');await page.locator('#save-entry').click();await page.locator('#entry-dialog').waitFor({state:'hidden'});
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.equal(saved.entries.length,2);assert.equal(saved.entries.find(s=>s.store_reference.code===unlocated.code).location,undefined);
    await page.locator('#tab-map').click();await page.locator('#open-national-catalog').click();
    await page.locator('#directory-query').fill('麦当劳');await page.locator('#directory-province-filter').selectOption('810000');
    assert.match(await page.locator('#national-status').innerText(),/269/);
    await page.locator('#directory-province-filter').selectOption('710000');await page.locator('#directory-query').fill('');
    assert.match(await page.locator('#national-status').innerText(),/508/);
    assert.match(await page.locator('.national-store-row').first().innerText(),/餐饮登记|税籍营业/);
    await page.locator('#directory-province-filter').selectOption('820000');assert.ok(await page.locator('.national-store-row').count()>=6);
    await page.locator('#directory-query').fill('澳门科学馆');assert.equal(await page.locator('.national-store-row').count(),1);assert.match(await page.locator('.national-store-row').innerText(),/科學館/);
    await page.locator('#directory-province-filter').selectOption('710000');await page.locator('#directory-query').fill('台中学士');assert.equal(await page.locator('.national-store-row').count(),1);assert.match(await page.locator('.national-store-row').innerText(),/台中學士/);
    await page.locator('#directory-clear').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>document.fonts.ready);
    if(process.env.CAPTURE_NATIONAL){await page.locator('#directory-city-filter').selectOption('石河子');await page.locator('#national-catalog-dialog').screenshot({path:'docs/national-store-search-preview.png'});}
    await page.getByRole('button',{name:'关闭全国门店',exact:true}).click();
    if(await page.locator('#store-clear').isVisible())await page.locator('#store-clear').click();await page.locator('#tab-wishlist').click();assert.equal(await page.locator('#inspiration-grid .inspiration-card').count(),28);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
    const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.entries.length,2);assert.equal(backup.entries[0].store_reference.source,'official_catalog');
    assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
    console.log('PASS: mobile national pages/province/city/non-reference city, ordinary detail/source, collect without visit, real store location, unlocated visit, refresh/backup, HK simplified search, TW government labeling, Macau records and 28 featured photos.');
  }catch(error){fs.mkdirSync('test-results',{recursive:true});const page=context.pages()[0];if(page)await page.screenshot({path:'test-results/national-stores-failure.png'}).catch(()=>{});throw error;}
  finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
