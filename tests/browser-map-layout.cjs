'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.APP_URL || 'https://map-layout.test/china-map/';
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const errors=[],api=[];
  try{
    const context=await browser.newContext({viewport:{width:1600,height:1200},timezoneId:'Asia/Shanghai'});
    if(!process.env.APP_URL){
      const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web'),prefix=new URL(base);
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin!==prefix.origin || !url.pathname.startsWith(prefix.pathname))return route.abort();
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.pathname.length)) || 'index.html');
        if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
        const mime={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
      });
    }
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))api.push(r.url());});
    await page.goto(base);await page.evaluate(()=>document.fonts.ready);
    const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await frame();
    const initial=await page.locator('#store-map-points button').evaluateAll(items=>items.map(e=>({key:e.dataset.cityKey,count:Number(e.dataset.storeCount)})));
    assert.ok(initial.length>0);
    const verifyCounts=async()=>{
      const result=await page.evaluate(()=>{
        const buttons=[...document.querySelectorAll('#store-map-points button')];
        return [...document.querySelectorAll('#map-store-markers button')].filter(e=>buttons.some(b=>b.dataset.cityKey===e.dataset.cityKey)).map(e=>({map:Number(e.dataset.storeCount),city:Number(buttons.find(b=>b.dataset.cityKey===e.dataset.cityKey).dataset.storeCount)}));
      });
      assert.ok(result.length>0,'at least one city appears on both the map and city buttons');
      for(const row of result)assert.equal(row.map,row.city,'map and city button must count the same stores');
    };
    await verifyCounts();
    const pane=await page.locator('#pane-map .map-layout').boundingBox(),catalog=await page.locator('#store-catalog-grid').boundingBox(),map=await page.locator('.map-wrap').boundingBox(),finder=await page.locator('#store-finder').boundingBox();
    assert.ok(Math.abs(pane.width-catalog.width)<2,`store list uses the full pane width: pane=${pane.width}, catalog=${catalog.width}`);
    assert.ok(finder.y+finder.height<=map.y,'search and city filters precede the map');
    const columns=await page.locator('#store-catalog-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(columns,3);
    const photos=await page.locator('#store-catalog-grid img').evaluateAll(images=>Promise.all(images.map(async image=>{image.loading='eager';await image.decode();return image.naturalWidth>0;})));
    assert.ok(photos.length>0 && photos.every(Boolean),'all preview photos load');
    const shots=process.env.UI_SCREENSHOT_DIR;if(shots){fs.mkdirSync(shots,{recursive:true});await page.locator('#pane-map').screenshot({path:path.join(shots,'desktop.png')});}
    await page.setViewportSize({width:1920,height:1200});await frame();
    assert.deepEqual(await page.locator('#store-map-points button').evaluateAll(items=>items.map(e=>({key:e.dataset.cityKey,count:Number(e.dataset.storeCount)}))),initial,'city counts remain stable when the viewport changes');
    const marker=page.locator('#map-store-markers .city-marker').first(),key=await marker.getAttribute('data-city-key'),count=Number(await marker.getAttribute('data-store-count'));
    await marker.click();await frame();await verifyCounts();
    assert.equal(await page.locator('#store-map-points button').count(),1);
    assert.equal(Number(await page.locator('#store-map-points button').getAttribute('data-store-count')),count);
    assert.match(await page.locator('#store-catalog-status').innerText(),new RegExp('找到 '+count+' 家'));
    await page.locator('#open-national-catalog').click();assert.match(await page.locator('#national-status').innerText(),new RegExp('找到 '+count+' 条'));
    await page.locator('#national-catalog-dialog .close').click();
    await page.locator('#store-clear').click();await page.locator('#store-query').fill('香港 甜品站');await frame();
    assert.match(await page.locator('#store-catalog-status').innerText(),/找到 80 家/);
    await page.locator('#store-clear').click();await page.setViewportSize({width:390,height:844});await frame();await verifyCounts();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page has no horizontal overflow');
    assert.equal(await page.locator('#store-catalog-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
    await page.locator('#store-query').blur();await page.locator('#store-finder').scrollIntoViewIfNeeded();
    if(shots)await page.screenshot({path:path.join(shots,'mobile.png')});
    await page.locator('#store-catalog-grid .store-catalog-card').first().click();await page.locator('#store-discovery-body h3').waitFor();
    await page.getByRole('button',{name:'想去这家',exact:true}).click();assert.equal(await page.locator('#count-visits').innerText(),'0');
    assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
    console.log(JSON.stringify({desktopColumns:3,mobileColumns:1,fullWidth:true,countsStable:true,filteredCity:key,errors:0,apiCalls:0}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
