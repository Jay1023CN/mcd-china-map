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

async function publicCatalog(page) {
  const data=await page.locator('#journal-data').evaluate(script=>JSON.parse(script.textContent));
  assert.ok(Array.isArray(data.stores) && data.stores.length>0,'the public store catalog should be present');
  assert.ok(data.stores.length>=18,'the expanded public directory should contain at least 18 real store records');
  assert.ok(new Set(data.stores.map(store=>store.city).filter(Boolean)).size>=12,'the expanded public directory should cover at least 12 cities');
  assert.ok(data.stores.every(store=>store.default_photo?.local_asset),'every public store should identify a checked-in photo mirror');
  return data;
}

function storeSearchTerm(store) {
  return store.aliases?.[0] || store.name;
}

function locatedFeatured(data) {
  const store=data.stores.find(item=>data.national_catalog.stores.some(record=>record.location &&
    (record.featured_name===item.name || record.name===item.name)));
  assert.ok(store,'a sourced featured store with a real point is required for map/photo acceptance');
  return store;
}

async function waitMapFrame(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function assertStoreMarkers(page, data, requirePhoto=false) {
  await waitMapFrame(page);
  const markers=page.locator('#map-store-markers .map-store-marker');
  await markers.first().waitFor({state:'visible'});
  assert.ok(await markers.count()>0,'public catalog should produce map store markers');
  assert.ok(await markers.count()<=data.stores.length,'map markers cannot exceed the matching public store catalog');
  const geometry=await page.locator('#world-map').boundingBox();
  const boxes=await markers.evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {city:item.dataset.city,x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const box of boxes){
    assert.ok(box.x>=geometry.x && box.x+box.w<=geometry.x+geometry.width+1,'marker stays inside the map: '+box.city);
    assert.ok(box.y>=geometry.y && box.y+box.h<=geometry.y+geometry.height+1,'marker stays above the map footer: '+box.city);
  }
  let photoCount=0;
  for(let i=0;i<await markers.count();i++){
    const marker=markers.nth(i);
    assert.ok((await marker.innerText()).trim().length>0,'compact city or photo marker has a visible label');
    if(await marker.locator('img').count()){
      photoCount++;
      await marker.locator('img').evaluate(image=>image.decode());
    }
  }
  if(requirePhoto) assert.ok(photoCount>0,'a city/search-filtered map should use at least one photo marker');
  return markers;
}

async function checkDesktopStores(browser) {
  const {context,apiRequests}=await newMobileContext(browser);
  try {
    const page=await context.newPage();await page.setViewportSize({width:1440,height:1000});
    await page.goto(staticUrl,{waitUntil:'load'});
    const data=await publicCatalog(page);
    const markers=await assertStoreMarkers(page,data);
    assert.equal(await page.locator('#show-store-layer').isChecked(),true,'the public map store layer starts enabled');
    await page.locator('#show-store-layer').uncheck();
    await waitMapFrame(page);
    assert.equal(await markers.count(),0,'hiding the store layer removes the labels');
    await page.locator('#show-store-layer').check();
    const store=locatedFeatured(data);
    const term=storeSearchTerm(store);
    await page.locator('#store-city-filter').selectOption(store.city);
    await page.locator('#store-query').fill(`${store.city} ${term}`);
    await waitMapFrame(page);
    await assertStoreMarkers(page,data,true);
    const mapResults=page.locator('#store-catalog-grid .store-catalog-card');
    assert.equal(await mapResults.count(),1,'city and multi-word keyword filters narrow the map catalog to one store');
    await mapResults.click();
    await page.locator('#store-discovery-dialog').waitFor({state:'visible'});
    const detail=page.locator('#store-discovery-dialog .store-discovery-card');
    assert.equal(await detail.count(),1,'the store card opens a single-store detail view');
    assert.equal(await detail.locator('h3').innerText(),store.name);
    await detail.locator('img.photo').evaluate(image=>image.decode());
    await page.locator('[data-close="store-discovery-dialog"]').click();
    for(const nearbyCity of ['广州','深圳']) {
      const nearby=data.stores.find(item=>item.city===nearbyCity);
      if(!nearby) continue;
      await page.locator('#store-city-filter').selectOption(nearby.city);
      await page.locator('#store-query').fill(nearby.name);
      await waitMapFrame(page);
      const nearbyCard=page.locator('#store-catalog-grid .store-catalog-card');
      assert.equal(await nearbyCard.count(),1,nearbyCity+' remains selectable in the nationwide catalog');
      await nearbyCard.click();
      const nearbyDetail=page.locator('#store-discovery-dialog .store-discovery-card');
      assert.equal(await nearbyDetail.count(),1,nearbyCity+' opens an individual store detail');
      assert.equal(await nearbyDetail.locator('h3').innerText(),nearby.name);
      await page.locator('[data-close="store-discovery-dialog"]').click();
    }
    await page.locator('#store-city-filter').selectOption(store.city);
    await page.locator('#store-query').fill(`${store.city} ${term}`);
    await waitMapFrame(page);
    await page.getByRole('tab',{name:/想去清单/}).click();
    assert.equal(await page.locator('#inspiration-city-filter').inputValue(),store.city,'map and wishlist city filters share state');
    assert.equal(await page.locator('#inspiration-query').inputValue(),`${store.city} ${term}`,'map and wishlist keyword filters share state');
    const alias=store.aliases?.[0] || store.name;
    await page.locator('#inspiration-query').fill(alias);
    assert.equal(await page.locator('#store-query').inputValue(),alias,'keyword edits in the wishlist stay shared with the map');
    await page.locator('#inspiration-query').fill('无此公开门店关键词 fixture-no-store');
    const clearSearch=page.locator('#inspiration-clear');
    await clearSearch.click();
    assert.equal(await page.locator('#inspiration-query').inputValue(),'');
    assert.equal(await page.locator('#store-query').inputValue(),'');
    assert.ok(await page.locator('#inspiration-grid').getByRole('button',{name:'看看这家店',exact:true}).count()>0,'clearing a no-result search restores catalog results');
    assert.equal(await page.locator('#count-visits').innerText(),'0');
    assert.equal(await page.locator('#wishlist-count').innerText(),'0');
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
    const catalog=await publicCatalog(page);
    const store=locatedFeatured(catalog);
    const searchTerm=storeSearchTerm(store);
    await page.locator('#store-city-filter').selectOption(store.city);
    await page.locator('#store-query').fill(`${store.city} ${searchTerm}`);
    const mapStores=await assertStoreMarkers(page,catalog,true);
    const resultButton=page.locator('#store-catalog-grid .store-catalog-card');
    assert.equal(await resultButton.count(),1,'the mobile map catalog supports shared city and multi-word search');
    await assertMobileGeometry(page);
    const catalogGrid=await page.locator('#store-catalog-grid').evaluate(grid=>({scroll:grid.scrollWidth,client:grid.clientWidth}));
    assert.ok(catalogGrid.scroll<=catalogGrid.client+1,'mobile catalog cards must not overflow their container');
    await resultButton.tap();
    const storeDialog=page.locator('#store-discovery-dialog');
    await storeDialog.waitFor({state:'visible'});
    await storeDialog.evaluate(dialog=>Promise.all(dialog.getAnimations().map(animation=>animation.finished)));
    const sheet=await storeDialog.boundingBox();
    assert.ok(Math.abs(sheet.y+sheet.height-844)<=1,'mobile store detail opens as a bottom sheet: '+JSON.stringify(sheet));
    const discoveryCard=page.locator('#store-discovery-dialog .store-discovery-card');
    assert.equal(await discoveryCard.count(),1,'opening one catalog card should show only that store');
    await discoveryCard.waitFor();
    assert.equal(await discoveryCard.locator('h3').innerText(),store.name);
    assert.ok((await discoveryCard.locator('.place').innerText()).length>3,'store address is shown');
    await discoveryCard.locator('img.photo').evaluate(image=>image.decode());
    await discoveryCard.getByRole('button',{name:'想去这家',exact:true}).tap();
    assert.equal(await page.locator('#count-visits').innerText(),'0','opening and collecting a public map store must not create a visit');
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','collecting a public map store should add one plan');
    assert.equal(await discoveryCard.getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true,'collection gives persistent button feedback');
    await page.locator('[data-close="store-discovery-dialog"]').tap();
    await resultButton.tap();
    const reopened=page.locator('#store-discovery-dialog .store-discovery-card');
    assert.equal(await reopened.getByRole('button',{name:'已收藏想去',exact:true}).isDisabled(),true,'reopening retains collection state');
    await reopened.getByRole('button',{name:'我去过，记一餐',exact:true}).tap();
    assert.equal(await page.locator('[name=store]').inputValue(),store.name,'store detail carries the selected store into a journal');
    assert.equal(await page.locator('#photo-preview').isVisible(),true,'store detail carries its photo into a journal');
    await page.locator('#photo-preview').evaluate(image=>image.decode());
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
    const plannedDate=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    await plan.locator('input[type=date]').fill(plannedDate);
    await plan.locator('.wishlist-priority').tap();
    assert.equal(await plan.locator('.wishlist-priority').getAttribute('aria-pressed'),'true');
    await page.locator('#wishlist-city-filter').selectOption(store.city.replace(/市$/, ''));
    await page.locator('#wishlist-when-filter').selectOption('today');
    assert.equal(await page.locator('#wishlist-grid .entry-card').count(),1,'scheduled city plan appears in today view');
    await page.locator('#wishlist-when-filter').selectOption('unplanned');
    assert.equal(await page.locator('#wishlist-grid .entry-card').count(),0,'dated plans do not appear in undated view');
    assert.equal(await page.locator('#wishlist-pick').isDisabled(),true,'empty plan filters cannot pick a store');
    await page.locator('#wishlist-clear').tap();
    await page.locator('#wishlist-query').fill('不存在的计划关键词');
    assert.equal(await page.locator('#wishlist-grid .entry-card').count(),0,'saved plans support search independently from discovery');
    await page.locator('#wishlist-clear').tap();
    await page.locator('#wishlist-pick').tap();
    assert.equal(await plan.evaluate(card=>card===document.activeElement),true,'the chosen plan receives focus');
    assert.ok((await page.locator('#wishlist-pick-status').innerText()).includes(store.name));
    await page.locator('#wishlist-copy').tap();
    const itinerary=await page.evaluate(()=>window.mobileClipboardText);
    assert.ok(itinerary.includes(store.name) && itinerary.includes('计划 '+plannedDate),'copied itinerary carries the chosen date and store');
    await assertMobileGeometry(page);
    const storeRecord=catalog.stores.find(item=>item.name===store.name);
    assert.ok(storeRecord?.default_photo,'the collected public store should retain its catalog photo');
    const mirroredPhoto=catalog.store_images?.[storeRecord.default_photo.url];
    assert.match(mirroredPhoto || '',/^assets\/[a-f0-9]{64}\.(?:jpg|png|webp)$/,'static share should use the same-origin hashed photo mirror');
    await page.evaluate(()=>{
      window.__shareAssetFetches=[];window.__sharePhotoInputs=[];window.__shareRenderCases=[];
      const originalFetch=window.fetch.bind(window);
      window.fetch=(input,...args)=>{const raw=input instanceof Request?input.url:input;const url=new URL(raw,location.href);if(/\/assets\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(url.pathname))window.__shareAssetFetches.push(url.href);return originalFetch(input,...args);};
      const originalRender=window.MemoryCard.render.bind(window.MemoryCard);
      window.MemoryCard.render=(entry,options)=>{window.__sharePhotoInputs.push({kind:entry.kind,hasDataUrl:typeof options.photoDataUrl==='string'&&/^data:image\/(?:jpeg|png|webp);base64,/.test(options.photoDataUrl),length:options.photoDataUrl?.length||0});window.__shareRenderCases.push({entry:JSON.parse(JSON.stringify(entry)),options:{...options,photoDataUrl:null}});return originalRender(entry,options);};
    });
    await plan.getByRole('button',{name:'分享下一站',exact:true}).tap();
    await page.locator('#share-preview img').waitFor();
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    const photoFlow=await page.evaluate(()=>({fetches:window.__shareAssetFetches,inputs:window.__sharePhotoInputs}));
    assert.ok(photoFlow.fetches.includes(new URL(mirroredPhoto,staticUrl).href),'share generation must fetch the same-origin hashed photo mirror');
    assert.ok(photoFlow.inputs.some(item=>item.kind==='plan'&&item.hasDataUrl&&item.length>100),'the plan renderer should receive converted image bytes from the externalized photo mirror');
    const cardTexture=await page.locator('#share-preview img').evaluate(async image=>{
      await image.decode();const actual=document.createElement('canvas');actual.width=1080;actual.height=1440;
      const actualContext=actual.getContext('2d');actualContext.drawImage(image,0,0);
      const cases=window.__shareRenderCases;const latest=cases[cases.length-1];
      const fallback=await window.MemoryCard.render(latest.entry,latest.options);
      const fallbackContext=fallback.getContext('2d');let compared=0,different=0;
      for(let y=420;y<830;y+=12)for(let x=180;x<900;x+=12){
        const a=actualContext.getImageData(x,y,1,1).data,b=fallbackContext.getImageData(x,y,1,1).data;compared++;
        if(Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])>24)different++;
      }
      return {width:image.naturalWidth,height:image.naturalHeight,compared,different};
    });
    assert.deepEqual([cardTexture.width,cardTexture.height],[1080,1440],'plan share preview should be a full PNG card');
    assert.ok(cardTexture.different>100,`generated plan PNG photo area must differ from the no-photo fallback (${cardTexture.different}/${cardTexture.compared} sampled pixels)`);
    assert.ok(await page.locator('#share-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),'share dialog must fit mobile width');
    await page.locator('#copy-share').tap();
    const caption=await page.evaluate(()=>window.mobileClipboardText);
    assert.ok(caption.includes('下一站计划 · 尚未打卡'));
    assert.ok(caption.includes('计划 '+plannedDate),'plan share caption includes the scheduled date');
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
    assert.equal(archive.wishlist[0].planned_date,plannedDate,'backup preserves the plan date');
    assert.equal(archive.wishlist[0].priority,true,'backup preserves priority');

    const restoredInfo=await newMobileContext(browser);
    const restored=await restoredInfo.context.newPage();
    restored.on('pageerror',error=>pageErrors.push(error.message));
    await restored.goto(staticUrl,{waitUntil:'load'});
    await restored.locator('#import-file').setInputFiles({name:'mobile-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await restored.locator('#toast').filter({hasText:'导入完成'}).waitFor();
    assert.equal(await restored.locator('#count-visits').innerText(),'1');
    assert.equal(await restored.locator('#wishlist-count').innerText(),'1');
    await restored.locator('#tab-wishlist').tap();
    assert.equal(await restored.locator('#wishlist-grid input[type=date]').inputValue(),plannedDate,'restoring a backup restores the plan date');
    assert.equal(await restored.locator('#wishlist-grid .wishlist-priority').getAttribute('aria-pressed'),'true');
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
