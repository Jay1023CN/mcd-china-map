'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.APP_URL || 'https://mcd-featured.test/china-map/';
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.APP_URL && process.env.BROWSER_PROXY?{proxy:{server:process.env.BROWSER_PROXY}}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
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
    const page=await context.newPage(),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(!request.url().startsWith(new URL(base).origin))external.push(request.url());});
    await page.goto(base);
    const stores=await page.evaluate(()=>{
      const data=JSON.parse(document.getElementById('journal-data').textContent);
      return ['cn:license:3230310','cn:license:6180001','cn:license:6180002'].map(id=>data.national_catalog.stores.find(store=>store.id===id));
    });
    assert.ok(stores.every(store=>store?.featured && store.default_photo && store.short_description));
    await page.locator('#open-national-catalog').click();await page.locator('#directory-photos').click();
    assert.equal(await page.locator('#directory-photos').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#directory-all').getAttribute('aria-pressed'),'false');
    assert.match(await page.locator('#directory-photos').innerText(),/31$/);
    for(const store of stores){
      await page.locator('#directory-city-filter').selectOption(store.city.replace(/市$/,''));await page.locator('#directory-query').fill(store.name);
      const row=page.locator('.national-store-row');assert.equal(await row.count(),1);await row.locator('img').evaluate(image=>image.decode());
      assert.match(await row.locator('img').getAttribute('src'),/^assets\//);assert.equal(await row.locator('.national-description').innerText(),store.short_description);
      await row.click();const detail=page.locator('#store-discovery-body');assert.equal(await detail.locator('h3').innerText(),store.name);
      await detail.locator('img').evaluate(image=>image.decode());assert.equal(await detail.locator('.note').first().innerText(),store.short_description);
      await detail.locator('.photo-source summary').click();assert.equal(await detail.locator('.photo-source a').getAttribute('href'),store.default_photo.source_url);
      await detail.getByRole('button',{name:'想去这家',exact:true}).click();await page.locator('[data-close=store-discovery-dialog]').click();
      assert.equal(await row.locator('.national-saved-mark').count(),1);
      assert.ok(await page.locator('#national-catalog-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
    }
    await page.locator('#directory-query').fill('');await page.locator('#directory-city-filter').selectOption('乌鲁木齐');
    assert.equal(await page.locator('.national-store-row').count(),2);
    if(process.env.CAPTURE_FEATURED){
      await page.setViewportSize({width:1200,height:1050});await page.evaluate(()=>document.fonts.ready);
      await page.locator('#national-store-list img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
      await page.locator('#national-catalog-dialog').screenshot({path:'docs/featured-photo-directory-preview.png'});await page.setViewportSize({width:390,height:844});
    }
    await page.locator('.national-store-row').filter({hasText:stores[1].name}).click();await page.locator('#store-discovery-body img').evaluate(image=>image.decode());
    if(process.env.CAPTURE_FEATURED)await page.locator('#store-discovery-dialog').screenshot({path:'docs/featured-photo-detail-preview.png'});
    await page.getByRole('button',{name:'我去过，记一餐',exact:true}).click();
    assert.equal(await page.locator('[name=store]').inputValue(),stores[1].name);await page.locator('#photo-preview').evaluate(image=>image.decode());
    await page.locator('#save-entry').click();await page.reload();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.equal(saved.wishlist.length,3);assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].default_photo.url,stores[1].default_photo.url);
    await page.locator('#open-national-catalog').click();await page.locator('#directory-saved').click();assert.equal(await page.locator('.national-store-row img').count(),3);
    await page.locator('#directory-city-filter').selectOption('石河子');await page.locator('#directory-photos').click();assert.equal(await page.locator('.national-store-row').count(),0);
    await page.getByRole('button',{name:'看看全部门店',exact:true}).click();assert.equal(await page.locator('#directory-city-filter').inputValue(),'石河子');assert.ok(await page.locator('.national-store-row').count()>0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS: three featured photos/introductions, photo gallery/city filter, source links, collection marks, visit photo, refresh, empty recovery and mobile layout.');
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
