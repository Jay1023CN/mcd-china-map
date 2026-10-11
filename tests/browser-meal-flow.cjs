'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const useWebKit=process.env.MEAL_BROWSER==='webkit';
const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web');
const url=process.env.MEAL_LIVE_URL || 'http://127.0.0.1:8779/';
const output=path.resolve('private/meal-ui-preview'+(useWebKit?'/webkit':''));
async function main(){
  const server=process.env.MEAL_LIVE_URL?null:spawn(process.env.PYTHON || 'python',['-m','http.server','8779','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
  let browser;
  try{
    for(let i=0;i<50;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    browser=await (useWebKit?webkit:chromium).launch({headless:true});fs.mkdirSync(output,{recursive:true});
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN',timezoneId:'Asia/Shanghai',geolocation:{latitude:31.222,longitude:121.44},permissions:['geolocation']});
    await context.route('https://ipwho.is/**',route=>route.fulfill({json:{success:true,country_code:'CN',city:'上海',latitude:31.23,longitude:121.47}}));
    if(!process.env.MEAL_LIVE_URL)await context.route('**/api/health',route=>route.fulfill({json:{connected:false,capabilities:{connect:true,synced_orders:false}}}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{timeout:120000});await page.locator('#first-meal').waitFor();
    if(process.env.MEAL_LIVE_URL){
      const info=await context.request.get(new URL('build-info.json',url).href);
      assert.equal(info.status(),200);assert.equal((await info.json()).commit,process.env.EXPECTED_COMMIT);
      const health=await context.request.get(new URL('api/health',url).href);
      assert.equal(health.status(),200);assert.equal((await health.json()).connected,false);
    }
    await page.screenshot({path:path.join(output,'home-mobile.png'),fullPage:false});
    if(await page.locator('#open-connect').isVisible()){
      await page.locator('#open-connect').click();await page.screenshot({path:path.join(output,'connect-mobile.png'),fullPage:false});
      assert.equal(await page.locator('#connect-token').isVisible(),false);
      assert.equal(await page.locator('#connect-official-login').getAttribute('href'),'https://open.mcd.cn/mcp/login');
      await page.locator('[data-close=connect-dialog]').click();
    }
    await page.locator('#first-meal-add').click();
    assert.equal(await page.locator('[name=date]').inputValue(),await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}));
    assert.equal(await page.locator('[name=collaboration]').isVisible(),false);
    assert.equal(await page.locator('[name=photo]').isVisible(),false);
    assert.equal(await page.locator('#camera-input').isVisible(),false);
    await page.locator('#meal-locate').click();await page.locator('#meal-store-results button').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('#meal-location-status').textContent.includes('按直线距离'));
    const labels=await page.locator('#meal-store-results button small').allTextContents();assert.ok(labels.every(text=>text.includes('直线约')));
    await page.locator('#meal-store-results button').first().click();
    assert.ok(await page.locator('[name=store]').inputValue());assert.equal(await page.locator('[name=city]').inputValue(),'上海');
    assert.equal(await page.locator('[name=location_mode]').inputValue(),'store');
    await page.locator('#meal-foods button').filter({hasText:/^薯条$/}).click();await page.locator('#meal-foods button').filter({hasText:/^鲜萃咖啡$/}).click();
    assert.equal(await page.locator('[name=foods]').inputValue(),'薯条，鲜萃咖啡');
    await page.locator('#meal-yesterday').click();assert.equal(await page.locator('#meal-yesterday').getAttribute('aria-pressed'),'true');
    await page.locator('#meal-today').click();
    await page.screenshot({path:path.join(output,'meal-mobile.png'),fullPage:false});
    await page.locator('#meal-menu-open').click();
    await page.locator('#meal-menu-products button').filter({hasText:'板烧鸡腿堡'}).click();
    assert.ok((await page.locator('[name=foods]').inputValue()).includes('板烧鸡腿堡'));
    await page.locator('#meal-menu-products button').filter({hasText:'板烧鸡腿堡'}).click();
    assert.equal(await page.locator('#meal-menu-products').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    await page.waitForFunction(()=>[...document.querySelectorAll('#meal-menu-products img')].some(img=>img.naturalWidth>0),null,{timeout:15000});
    await page.screenshot({path:path.join(output,'menu-mobile.png'),fullPage:false});
    await page.locator('#meal-menu-categories button').filter({hasText:/^套餐$/}).click();
    assert.equal(await page.locator('#meal-menu-products button').count(),2);
    await page.locator('#meal-menu-sort').selectOption('frequency');
    await page.locator('#meal-menu-done').click();

    assert.equal(await page.locator('#entry-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    const chooser=page.waitForEvent('filechooser');await page.locator('#choose-photo').click();await chooser;
    const camera=page.waitForEvent('filechooser');await page.locator('#take-photo').click();assert.equal(await (await camera).element().getAttribute('capture'),'environment');
    await page.locator('#save-entry').click();await page.locator('#entry-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#journal-grid .entry-card').count(),1);
    const foods=await page.locator('#journal-grid .food-tags span').allTextContents();assert.deepEqual(foods,['薯条','鲜萃咖啡']);
    await page.locator('#journal-grid .entry-card').getByRole('button',{name:'分享这一页',exact:true}).click();
    assert.equal(await page.locator('#share-sticker-option').isVisible(),true);
    assert.equal(await page.locator('#share-stickers [data-sticker="food"]').getAttribute('aria-pressed'),'true','the selected menu foods should appear as matching card stickers');
    await page.locator('#share-stickers [data-sticker="heart"]').click();
    await page.locator('#share-custom-sticker-text').fill('第一次来');
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    await page.screenshot({path:path.join(output,'share-stickers-mobile.png'),fullPage:false});
    await page.locator('[data-close="share-dialog"]').click();
    await page.reload();assert.equal(await page.locator('#first-meal').isVisible(),false);
    await page.locator('#add-top').click();
    await page.locator('#meal-food-custom summary').click();await page.locator('[name=foods]').fill('特别餐品，鲜萃咖啡');
    await page.locator('#meal-foods button').filter({hasText:/^薯条$/}).click();assert.equal(await page.locator('[name=foods]').inputValue(),'特别餐品，鲜萃咖啡，薯条');
    await page.locator('[data-close=entry-dialog]').first().click();
    await context.close();
    const denied=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
    await denied.route('https://ipwho.is/**',route=>route.abort());
    await denied.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(success,failure)=>failure({code:1})}}));
    const fallback=await denied.newPage();await fallback.goto(url);await fallback.locator('#add-top').click();await fallback.locator('#meal-locate').click();
    assert.ok(await fallback.locator('#meal-city-details').evaluate(el=>el.open));
    await fallback.locator('[name=province_code]').selectOption('310000');await fallback.locator('[name=city]').fill('上海');await fallback.locator('[name=store]').fill('未收录的测试门店');
    await fallback.locator('#save-entry').click();await fallback.locator('#entry-dialog').waitFor({state:'hidden'});
    assert.equal(await fallback.locator('#journal-grid .entry-card').count(),1);assert.deepEqual(errors,[]);
    console.log('PASS: mobile first-use, IP city hint, GPS distance order, one-tap store/foods, today/yesterday, hidden native file inputs, real chooser gestures, optional fields, reload, custom foods preservation, denied-location manual fallback and no dialog overflow.');
    await denied.close();
  }finally{if(browser)await browser.close();if(server)server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
