'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const staticRoot=path.resolve(process.env.STATIC_WEB_ROOT || '');
const staticUrl='https://mcd-mobile.test/china-map/';
function crc32(buffer) {
  let crc=0xffffffff;
  for(const byte of buffer) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function pngChunk(type,data=Buffer.alloc(0)) {
  const name=Buffer.from(type,'ascii');
  const body=Buffer.concat([name,data]);
  const size=Buffer.alloc(4);size.writeUInt32BE(data.length);
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size,body,checksum]);
}
const tinyPng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  pngChunk('IHDR',Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0])),
  pngChunk('IDAT',require('node:zlib').deflateSync(Buffer.from([0,220,50,30,255]))),pngChunk('IEND')]);
const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

function mime(file) {
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
    '.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf'})[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function installStaticOrigin(context, apiRequests) {
  const origin=new URL(staticUrl).origin;
  const basePath=new URL(staticUrl).pathname;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.includes('/api/')) apiRequests.push(url.href);
    if(url.origin!==origin) return route.abort();
    if(!url.pathname.startsWith(basePath)) return route.fulfill({status:404,body:'Not found'});
    let relative;
    try { relative=decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html'; }
    catch { return route.fulfill({status:400,body:'Bad path'}); }
    const file=path.resolve(staticRoot,...relative.split('/'));
    if(file!==staticRoot && !file.startsWith(staticRoot+path.sep)) return route.fulfill({status:404,body:'Not found'});
    if(!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:'Not found'});
    return route.fulfill({status:200,contentType:mime(file),body:fs.readFileSync(file)});
  });
}

async function newMobileContext(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,
    timezoneId:'Asia/Shanghai',acceptDownloads:true});
  const apiRequests=[];
  await context.addInitScript(()=>{
    Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{
      window.mobileShare={title:payload.title,text:payload.text,files:payload.files?.map(file=>({name:file.name,type:file.type}))};
    }});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:payload=>!!payload.files?.length});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText:async text=>{window.mobileClipboardText=text;},
      write:async items=>{window.mobileClipboardImage={types:items[0].types,blob:await items[0].getType('image/png')};}
    }});
  });
  await installStaticOrigin(context,apiRequests);
  return {context,apiRequests};
}

async function assertNoConnectionMisleadingUi(page) {
  const text=await page.locator('body').innerText();
  assert.doesNotMatch(text,/Python|启动\.cmd|连接麦当劳|Token/i,'static hosting must not advertise unavailable local API/Token setup');
  assert.equal(await page.locator('#connect-token').isVisible().catch(()=>false),false,'static mode must not expose a connectable Token field');
}

async function assertMobileGeometry(page) {
  const width=await page.evaluate(()=>innerWidth);
  const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);
  assert.ok(scroll<=width,`document overflows mobile viewport: ${scroll} > ${width}`);
  const nav=page.locator('.workspace-nav, .mobile-bottom-nav, [data-mobile-nav], [role=tablist]');
  for(let i=0;i<await nav.count();i++) {
    if(!await nav.nth(i).isVisible()) continue;
    const bounds=await nav.nth(i).boundingBox();
    assert.ok(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1,'bottom/navigation tabs must fit the viewport');
  }
}

async function assertStoreMarkers(page) {
  const markers=page.locator('#map-store-markers .map-store-marker');
  await markers.first().waitFor({state:'visible'});
  assert.equal(await markers.count(),5,'the five public stores should have named photo markers');
  const geometry=await page.locator('#world-map').boundingBox();
  const boxes=await markers.evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {city:item.dataset.city,x:r.x,y:r.y,w:r.width,h:r.height,anchorY:Number(item.dataset.anchorY)};}));
  for(const box of boxes){
    assert.ok(box.x>=geometry.x && box.x+box.w<=geometry.x+geometry.width+1,'marker stays inside the map: '+box.city);
    assert.ok(box.y>=geometry.y && box.y+box.h<=geometry.y+geometry.height+1,'marker stays above the map footer: '+box.city);
    assert.ok(Math.abs(box.y+box.h/2-geometry.y-box.anchorY)<geometry.height/3,'label stays near its city rather than moving across China: '+box.city);
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y,'nearby cities must not have overlapping labels: '+a.city+'/'+b.city);
  }
  for(let i=0;i<await markers.count();i++){
    await markers.nth(i).locator('img').evaluate(image=>image.decode());
    assert.ok((await markers.nth(i).locator('strong').innerText()).length>1,'store name is visible on the map');
  }
  return markers;
}

async function checkDesktopStores(browser) {
  const {context,apiRequests}=await newMobileContext(browser);
  try {
    const page=await context.newPage();await page.setViewportSize({width:1440,height:1000});
    await page.goto(staticUrl,{waitUntil:'load'});
    const markers=await assertStoreMarkers(page);
    const beijing=markers.filter({has:page.locator('small',{hasText:'北京'})});
    await beijing.click();
    assert.match(await page.locator('#store-discovery-body h3').innerText(),/首钢园/);
    await page.locator('[data-close="store-discovery-dialog"]').click();
    // Click the canvas anchor itself, not a text-list surrogate; CSS ratios used to displace this hit target.
    const anchor=await beijing.evaluate(button=>({x:Number(button.dataset.anchorX),y:Number(button.dataset.anchorY)}));
    const canvas=await page.locator('#world-map').boundingBox();
    await page.mouse.click(canvas.x+anchor.x,canvas.y+anchor.y);
    await page.locator('#store-discovery-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#store-discovery-body h3').innerText(),/首钢园/,'the visible map anchor opens its own store');
    await page.keyboard.press('Escape');
    await page.locator('#show-store-layer').uncheck();
    assert.equal(await markers.count(),0,'hiding the store layer removes the labels');
    await page.locator('#show-store-layer').check();await assertStoreMarkers(page);
    await page.locator('#country-filter').selectOption('440000');await page.locator('#country-filter').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelectorAll('#map-store-markers .map-store-marker').length===2);
    assert.equal(await markers.count(),2,'province filter limits the store markers');
    assert.deepEqual(apiRequests,[]);
  } finally {await context.close();}
}

async function addMobileEntry(page) {
  await page.locator('#add-top').tap();
  const dialog=page.locator('#entry-dialog');
  await dialog.waitFor({state:'visible'});
  await page.locator('[name=date]').fill(todayIso());
  await page.locator('[name=province_code]').selectOption('510000');
  await page.locator('[name=city]').fill('成都');
  await page.locator('[name=store]').fill('成都移动端体验门店');
  await page.locator('[name=foods]').fill('移动端测试套餐');
  await page.locator('[name=note]').fill('公开静态页面上的本机记录。');
  await page.locator('[name=photo]').setInputFiles({name:'mobile-fixture.png',mimeType:'image/png',buffer:tinyPng});
  await page.waitForFunction(()=>!document.getElementById('save-entry').disabled);
  await page.locator('#photo-preview').evaluate(image=>image.decode());
  assert.ok(await page.locator('#photo-preview').evaluate(image=>image.naturalWidth>0),'synthetic mobile upload should decode');
  assert.equal(await page.locator('[name=confirmed]').isChecked(),true,'manual visits are confirmed automatically');
  await page.locator('#save-entry').scrollIntoViewIfNeeded();
  const geometry=await page.locator('#save-entry').evaluate(button=>{
    const r=button.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,
      covered:!!hit && !button.contains(hit) && !hit.contains(button)};
  });
  assert.ok(geometry.left>=0 && geometry.right<=390,'save button must fit mobile form width');
  assert.ok(geometry.top>=0 && geometry.bottom<=geometry.height,'save button must be visible after scrolling the form');
  assert.equal(geometry.covered,false,'save button must not be covered by mobile navigation');
  assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'mobile entry form must not overflow horizontally');
  await page.locator('#save-entry').tap();
  await dialog.waitFor({state:'hidden'});
}

async function clickJournalTab(page) {
  await page.locator('#tab-journal').tap();
  await page.locator('#pane-journal').waitFor({state:'visible'});
}

async function runChromium() {
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const contextInfo=await newMobileContext(browser);
  const {context,apiRequests}=contextInfo;
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  try {
    await checkDesktopStores(browser);
    await page.goto(staticUrl,{waitUntil:'load'});
    await assertNoConnectionMisleadingUi(page);
    await assertMobileGeometry(page);
    assert.equal(await page.locator('#count-visits').innerText(),'0','the empty static archive should start with no visits');
    assert.equal(await page.locator('#show-store-layer').isChecked(),true,'public store discovery should be enabled by default');
    const mapStores=await assertStoreMarkers(page);
    await mapStores.first().tap();
    const storeDialog=page.locator('#store-discovery-dialog');
    await storeDialog.waitFor({state:'visible'});
    await storeDialog.evaluate(dialog=>Promise.all(dialog.getAnimations().map(animation=>animation.finished)));
    const sheet=await storeDialog.boundingBox();
    assert.ok(Math.abs(sheet.y+sheet.height-844)<=1,'mobile store detail opens as a bottom sheet: '+JSON.stringify(sheet));
    const discoveryCard=page.locator('#store-discovery-body .store-discovery-card').first();
    await discoveryCard.waitFor();
    assert.match(await discoveryCard.locator('h3').innerText(),/麦当劳/);
    assert.ok((await discoveryCard.locator('.place').innerText()).length>3,'store address is shown');
    await discoveryCard.locator('img.photo').evaluate(image=>image.decode());
    await discoveryCard.getByRole('button',{name:'想去这家',exact:true}).tap();
    assert.equal(await page.locator('#count-visits').innerText(),'0','opening and collecting a public map store must not create a visit');
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','collecting a public map store should add one plan');
    assert.equal(await discoveryCard.getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true,'collection gives persistent button feedback');
    await page.locator('[data-close="store-discovery-dialog"]').tap();
    await mapStores.first().tap();
    assert.equal(await page.locator('#store-discovery-body').getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true,'reopening retains collection state');
    await page.locator('#store-discovery-body').getByRole('button',{name:'我去过，记一餐',exact:true}).tap();
    assert.match(await page.locator('[name=store]').inputValue(),/麦当劳/,'store detail carries the selected store into a journal');
    assert.equal(await page.locator('#photo-preview').isVisible(),true,'store detail carries its photo into a journal');
    await page.locator('[data-close="entry-dialog"]').first().tap();
    await addMobileEntry(page);
    await assertNoConnectionMisleadingUi(page);
    await clickJournalTab(page);
    const card=page.locator('#journal-grid .entry-card').filter({hasText:'成都移动端体验门店'});
    await card.waitFor();
    await card.locator('img.photo').evaluate(image=>image.decode());
    await page.reload({waitUntil:'load'});
    await clickJournalTab(page);
    await page.locator('#journal-grid .entry-card').filter({hasText:'成都移动端体验门店'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(),'1','one confirmed entry should persist through refresh');

    await page.locator('#tab-wishlist').tap();
    await page.locator('#pane-wishlist').waitFor({state:'visible'});
    assert.equal(await page.locator('#count-visits').innerText(),'1','collecting a public store must not add a visit');
    const plan=page.locator('#wishlist-grid .entry-card').first();
    assert.equal(await page.locator('#wishlist-count').innerText(),'1');
    await plan.getByRole('button',{name:'分享下一站',exact:true}).tap();
    await page.locator('#share-preview img').waitFor();
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    assert.ok(await page.locator('#share-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),'share dialog must fit mobile width');
    await page.locator('#copy-share').tap();
    const caption=await page.evaluate(()=>window.mobileClipboardText);
    assert.ok(caption.includes('下一站计划 · 尚未打卡'));
    await page.locator('#native-share').tap();
    const payload=await page.evaluate(()=>window.mobileShare);
    assert.ok(payload.text.includes('下一站计划 · 尚未打卡'));
    assert.ok(payload.files?.some(file=>file.type==='image/png'));
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#save-share').tap();
    const png=fs.readFileSync(await (await downloadPromise).path());
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),1080);
    assert.equal(png.readUInt32BE(20),1440);
    assert.equal(await page.locator('#count-visits').innerText(),'1');
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','share and download should preserve wishlist');
    await page.getByRole('button',{name:'关闭分享卡',exact:true}).tap();
    await assertMobileGeometry(page);

    const exportPromise=page.waitForEvent('download');
    await page.locator('#export').tap();
    const exportFile=await exportPromise;
    const archive=JSON.parse(fs.readFileSync(await exportFile.path(),'utf8'));
    assert.equal(archive.entries.length,1);
    assert.equal(archive.wishlist.length,1);

    const restoredInfo=await newMobileContext(browser);
    const restored=await restoredInfo.context.newPage();
    restored.on('pageerror',error=>pageErrors.push(error.message));
    await restored.goto(staticUrl,{waitUntil:'load'});
    await restored.locator('#import-file').setInputFiles({name:'mobile-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await restored.locator('#toast').filter({hasText:'导入完成'}).waitFor();
    assert.equal(await restored.locator('#count-visits').innerText(),'1');
    assert.equal(await restored.locator('#wishlist-count').innerText(),'1');
    await clickJournalTab(restored);
    const restoredCard=restored.locator('#journal-grid .entry-card').filter({hasText:'成都移动端体验门店'});
    await restoredCard.waitFor();
    await restoredCard.locator('img.photo').evaluate(image=>image.decode());
    await restoredInfo.context.close();
    assert.deepEqual(apiRequests,[],'static page should not call local /api endpoints');
    assert.deepEqual(restoredInfo.apiRequests,[],'restored static page should not call local /api endpoints');
    assert.deepEqual(pageErrors,[],'no browser runtime errors expected');
    await context.close();
    await browser.close();
    return 'Chromium mobile: page/photo/save/refresh/wishlist/share/export/import and layout checks passed';
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWebKitIfAvailable() {
  let browser;
  try { browser=await webkit.launch({headless:true}); }
  catch(error) { return `WebKit skipped (runtime unavailable: ${String(error.message).split('\n')[0]})`; }
  try {
    const info=await newMobileContext(browser);
    try {
      const page=await info.context.newPage();
      await page.goto(staticUrl,{waitUntil:'load'});
      await assertNoConnectionMisleadingUi(page);
      await assertMobileGeometry(page);
      await page.locator('#tab-wishlist').tap();
      await page.locator('#pane-wishlist').waitFor({state:'visible'});
      await assertMobileGeometry(page);
      assert.deepEqual(info.apiRequests,[],'WebKit static page should not call local APIs');
      return 'WebKit mobile: static load, wishlist navigation, no local API calls, and layout checks passed';
    } finally { await info.context.close(); }
  } finally { await browser.close(); }
}

async function main() {
  if(!process.env.STATIC_WEB_ROOT) throw new Error('Set STATIC_WEB_ROOT to the generated public static web directory before running this test.');
  if(!fs.existsSync(path.join(staticRoot,'index.html'))) throw new Error(`No generated public index.html found under STATIC_WEB_ROOT=${staticRoot}`);
  const chromiumResult=await runChromium();
  const webkitResult=await runWebKitIfAvailable();
  console.log(`PASS: ${chromiumResult}; ${webkitResult}. Static origin ${staticUrl}; no local API stubs, token, or real external network.`);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
