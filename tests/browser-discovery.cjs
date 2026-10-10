'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const dateAtShanghai = value => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const today = () => dateAtShanghai(new Date());

async function stubHealth(page) {
  await page.route('**/api/health', route => route.fulfill({json: {
    capabilities: {connect:false, synced_orders:false}, connected:false, store_lookup:false
  }}));
  await page.route('**/api/stores', route => route.fulfill({json:{stores:[]}}));
  await page.route('https://**/*', route => route.abort());
}

async function addEntry(page, {city, store, province='310000', foods, note='', date=today()}) {
  await page.locator('#add-top').click();
  await page.locator('[name=date]').fill(date);
  await page.locator('[name=city]').fill(city);
  await page.locator('[name=province_code]').selectOption(province);
  await page.locator('[name=store]').fill(store);
  await page.locator('[name=foods]').fill(foods);
  await page.locator('[name=note]').fill(note);
  assert.equal(await page.locator('[name=confirmed]').isChecked(),true,'manual visits are confirmed automatically');
  await page.locator('#save-entry').click();
  await page.locator('#entry-dialog').waitFor({state:'hidden'});
}

async function publicCatalog(page) {
  const data=await page.locator('#journal-data').evaluate(script=>JSON.parse(script.textContent));
  assert.ok(Array.isArray(data.stores) && data.stores.length>0,'public store catalog should be present');
  assert.ok(data.stores.length>=18,'expanded public directory should contain at least 18 real store records');
  assert.ok(new Set(data.stores.map(store=>store.city).filter(Boolean)).size>=12,'expanded public directory should cover at least 12 cities');
  assert.ok(data.stores.every(store=>store.default_photo?.local_asset),'each public store should identify its checked-in photo mirror');
  return data;
}

async function waitMapFrame(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function assertCatalogSearch(page, city, value, storeName, label) {
  await page.locator('#store-city-filter').selectOption(city);
  await page.locator('#store-query').fill(`${city} ${value}`);
  await waitMapFrame(page);
  const names=await page.locator('#store-catalog-grid .store-catalog-card strong').allTextContents();
  assert.ok(names.includes(storeName),`${label} and city terms should find the matching directory store`);
}

async function main() {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await stubHealth(page);
    await page.goto(base);
    const catalog=await publicCatalog(page);
    await page.getByRole('tab',{name:/想去清单/}).click();
    const inspiration=page.locator('#inspiration-grid .inspiration-card');
    assert.equal(await inspiration.count(),catalog.stores.length,'wishlist discovery should show the current public directory, not a hard-coded sample count');
    const photos=await inspiration.locator('img.photo').evaluateAll(images=>Promise.all(images.map(async image=>{image.loading='eager';await image.decode();return {src:image.currentSrc,complete:image.complete,width:image.naturalWidth,height:image.naturalHeight};})));
    assert.equal(photos.length,catalog.stores.length,'every public directory store should have a photo card');
    for(const photo of photos) assert.ok(photo.complete && photo.width>0 && photo.height>0,'checked-in public mirror should decode in the browser: '+photo.src);

    const storeRecord=catalog.stores.find(item=>item.city==='成都') || catalog.stores[0];
    const store=storeRecord.name;
    const city=storeRecord.city;
    const province=storeRecord.province_code;
    const otherProvince=catalog.stores.find(item=>item.province_code && item.province_code!==province)?.province_code;
    assert.ok(otherProvince,'public directory should provide another real province code for filter-change coverage');
    const target=page.locator('#inspiration-grid .inspiration-card').filter({has:page.getByRole('heading',{name:store,exact:true})});

    await page.getByRole('tab',{name:'中国地图',exact:true}).click();
    const cityFilter=page.locator('#store-city-filter');
    const query=page.locator('#store-query');
    const term=storeRecord.aliases?.[0] || storeRecord.name;
    const filteredCatalog=page.locator('#store-catalog-grid .store-catalog-card');
    const shanghaiStore=catalog.stores.find(item=>item.city==='上海');
    if(shanghaiStore) {
      await cityFilter.selectOption(shanghaiStore.city);
      await query.fill(shanghaiStore.aliases?.[0] || shanghaiStore.name);
      await waitMapFrame(page);
      assert.equal(await filteredCatalog.count(),1,'selected Shanghai and keyword filters should isolate one real catalog store');
      const mapMarker=page.locator('#map-store-markers .map-store-marker');
      assert.ok(await mapMarker.count()>0,'a selected Shanghai search should leave its map marker visible');
      assert.ok(await mapMarker.evaluateAll(items=>items.some(item=>item.querySelector('img'))),'filtered Shanghai markers should show photo labels');
      for(let i=0;i<await mapMarker.count();i++) await mapMarker.nth(i).locator('img').evaluate(image=>image.decode());
      await filteredCatalog.locator('img').evaluate(image=>image.decode());
      assert.ok((await filteredCatalog.innerText()).includes(shanghaiStore.name),'Shanghai catalog card should show its real name');
      await filteredCatalog.click();
      const detail=page.locator('#store-discovery-dialog .store-discovery-card');
      await detail.waitFor();
      assert.equal(await detail.count(),1,'a catalog photo opens only the selected store detail');
      assert.equal(await detail.locator('h3').innerText(),shanghaiStore.name);
      await detail.locator('img.photo').evaluate(image=>image.decode());
      await page.locator('[data-close="store-discovery-dialog"]').click();
    }
    for(const nearbyCity of ['广州','深圳']) {
      const nearby=catalog.stores.find(item=>item.city===nearbyCity);
      if(!nearby) continue;
      await cityFilter.selectOption(nearby.city);
      await query.fill(nearby.name);
      await waitMapFrame(page);
      const nearbyCard=page.locator('#store-catalog-grid .store-catalog-card');
      assert.equal(await nearbyCard.count(),1,nearbyCity+' city filter should remain operable');
      await nearbyCard.click();
      assert.equal(await page.locator('#store-discovery-dialog .store-discovery-card').count(),1,nearbyCity+' card should open its own detail');
      await page.locator('[data-close="store-discovery-dialog"]').click();
    }
    const searchFields=[
      ['name',storeRecord.name],
      ['alias',storeRecord.aliases?.[0]],
      ['introduction',storeRecord.short_description],
      ['tag',storeRecord.tags?.[0]]
    ].filter(([,value])=>typeof value==='string'&&value.trim());
    for(const [label,value] of searchFields) await assertCatalogSearch(page,city,value.trim().slice(0,24),store,label);
    const asciiField=searchFields.map(([,value])=>value).find(value=>/[A-Za-z]{2}/.test(value));
    if(asciiField) {
      const token=asciiField.match(/[A-Za-z]{2,}/)[0];
      const fullWidth=token.toUpperCase().replace(/[!-~]/g,char=>String.fromCharCode(char.charCodeAt(0)+0xFEE0));
      await assertCatalogSearch(page,city,fullWidth,store,'NFKC case-insensitive ASCII');
    }

    await page.getByRole('tab',{name:/想去清单/}).click();
    await page.locator('#inspiration-city-filter').selectOption(city);
    assert.equal(await page.locator('#inspiration-city-filter').inputValue(),await page.locator('#store-city-filter').inputValue(),'map and wishlist share city filtering');
    await page.locator('#inspiration-query').fill(`${city} ${term}`);
    assert.equal(await page.locator('#store-query').inputValue(),`${city} ${term}`,'map and wishlist share multi-term keyword filtering');
    assert.equal(await page.locator('#inspiration-grid .inspiration-card').count(),1,'shared filters should apply to the inspiration directory');
    await page.locator('#inspiration-query').fill('没有这家门店 discovery-no-result');
    assert.equal(await page.locator('#inspiration-grid .inspiration-card').count(),0,'unmatched keywords should show no stores');
    await page.locator('#inspiration-clear').click();
    assert.equal(await page.locator('#inspiration-grid .inspiration-card').count(),catalog.stores.length,'clear restores the full public directory');
    assert.equal(await page.locator('#inspiration-city-filter').inputValue(),'','clearing filters resets the shared city selection');
    const first=page.locator('#inspiration-grid .inspiration-card').filter({has:page.getByRole('heading',{name:store,exact:true})});
    const yesterday=dateAtShanghai(new Date(Date.now()-24*60*60*1000));
    const wishlistButton=first.getByRole('button',{name:'想去这家',exact:true});
    await wishlistButton.click();
    assert.equal(await page.locator('#wishlist-count').innerText(),'1');
    assert.equal(await page.locator('#count-visits').innerText(),'0','collecting inspiration must not create a visit');
    await first.getByRole('button',{name:'已放入想去清单',exact:true}).click();
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','repeated collection must remain deduplicated');
    await page.reload();
    await page.getByRole('tab',{name:/想去清单/}).click();
    assert.equal(await page.locator('#wishlist-grid .entry-card').count(),1,'wishlist must persist on reload');
    assert.equal(await page.locator('#wishlist-grid h3').innerText(),store);

    await page.locator('#wishlist-grid').getByRole('button',{name:'到了，留一页打卡',exact:true}).click();
    assert.equal(await page.locator('[name=confirmed]').isChecked(),true,'a saved arrival is automatically confirmed as a visit');
    assert.equal(await page.locator('[name=confirmed]').isVisible(),false,'the confirmation control is hidden from the user');
    assert.equal(await page.locator('[name=complete_wishlist]').isChecked(),true);
    await page.locator('[name=date]').fill(yesterday);
    await page.locator('[name=foods]').fill('灵感测试餐品，城市咖啡');
    await page.locator('[name=note]').fill('灵感搜索随记');
    await page.locator('[name=province_code]').selectOption(otherProvince);
    await page.locator('[name=province_code]').dispatchEvent('change');
    assert.equal(await page.locator('[name=complete_wishlist]').isChecked(),true);
    await page.locator('#save-entry').click();
    await page.locator('#entry-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#wishlist-count').innerText(),'0','confirmed inspiration arrival should leave the wishlist even after changing province');
    assert.equal(await page.locator('#count-visits').innerText(),'1');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    const created=saved.entries.find(entry=>entry.store===store && entry.foods.includes('灵感测试餐品'));
    assert.ok(created,'confirmed inspiration should be in the journal');
    assert.equal(created.source,'manual');
    assert.equal('store_reference' in created,false,'manual inspiration must not invent MCP provenance');
    assert.ok(created.default_photo && created.default_photo.url.startsWith('https://'),'default store photo should be retained');

    await page.getByRole('tab',{name:'打卡手账',exact:true}).click();
    assert.equal(await page.locator('#journal-grid .entry-card').count(),1);
    await page.locator('#journal-query').fill(`${city} 灵感测试餐品 灵感搜索随记`);
    assert.equal(await page.locator('#journal-grid .entry-card').count(),1,'search should combine city, food, and note terms');
    assert.match(await page.locator('#journal-search-status').innerText(),/找到 1 页/);
    await page.locator('#journal-query').fill(`${city} 没有这道餐品`);
    assert.equal(await page.locator('#journal-grid .entry-card').count(),0,'unmatched search should not show a journal entry');
    assert.match(await page.locator('#journal-grid').innerText(),/暂时没找到这一页/);
    assert.equal(await page.locator('#count-visits').innerText(),'1','text search must not change map/stat totals');
    await page.locator('#clear-journal-query').click();
    assert.equal(await page.locator('#journal-grid .entry-card').count(),1,'clearing search restores all journal entries');

    await page.locator('#journal-grid .entry-card').getByRole('button',{name:'翻开',exact:true}).click();
    await page.locator('#detail-body').getByRole('button',{name:'再来这家，记新的一页',exact:true}).click();
    assert.equal(await page.locator('[name=date]').inputValue(),today(),'repeat visit should default to today');
    assert.notEqual(await page.locator('[name=date]').inputValue(),created.date,'repeat visit should use a fresh date');
    assert.equal(await page.locator('[name=city]').inputValue(),created.city);
    assert.equal(await page.locator('[name=store]').inputValue(),created.store);
    assert.equal(await page.locator('[name=foods]').inputValue(),created.foods.join('，'));
    assert.equal(await page.locator('[name=confirmed]').isChecked(),true,'a repeat visit is automatically confirmed when saved');
    assert.equal(await page.locator('[name=confirmed]').isVisible(),false);
    assert.equal(await page.locator('[name=note]').inputValue(),'','prior note must not carry into a new visit');
    assert.equal(await page.locator('#photo-preview').isVisible(),true,'default store photo should carry forward');
    assert.equal(await page.locator('#photo-actions').isVisible(),false,'the previous user-uploaded photo must not carry forward');
    await page.locator('#save-entry').click();
    await page.locator('#entry-dialog').waitFor({state:'hidden'});
    const afterRepeat=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    const visits=afterRepeat.entries.filter(entry=>entry.store===store);
    assert.equal(visits.length,2,'repeat visit should add a distinct page without editing the original');
    assert.equal(new Set(visits.map(entry=>entry.id)).size,2,'repeat visit should use a new id');
    assert.equal(visits.find(entry=>entry.id===created.id).date,created.date);
    const repeated=visits.find(entry=>entry.id!==created.id);
    assert.equal(repeated.confirmed,true);
    assert.equal('origin' in repeated,false,'manual repeat visit must not inherit MCP provenance');
    assert.ok(repeated.default_photo && !repeated.photo,'repeat visit keeps default photo without reusing a personal upload');
    assert.equal(await page.locator('#count-visits').innerText(),'2');

    const draftId='manual-draft-discovery-fixture';
    const draft={id:draftId,date:today(),country_code:'CN',province_code:'310000',city:'上海',store:'虚构未确认草稿',foods:['未确认手动草稿不应进入味道回顾'],source:'manual',confirmed:false};
    const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    current.entries.push(draft);
    await page.evaluate(value=>localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify(value)),current);
    await page.reload();
    assert.ok(await page.locator('#journey-tastes').isVisible(),'confirmed foods should provide taste shortcuts');
    assert.ok(await page.locator('#taste-list button').count()<=5,'taste shortcuts should be capped at five foods');
    assert.equal((await page.locator('#taste-list').innerText()).includes('未确认手动草稿不应进入味道回顾'),false,'unconfirmed manual drafts must not contribute taste memories');
    assert.equal(await page.locator('#count-visits').innerText(),'2','an unconfirmed manual draft must not add a visit');
    await page.locator('#year-filter').selectOption(created.date.slice(0,4));
    await page.locator('#country-filter').selectOption('510000');
    await page.locator('#taste-list').getByRole('button',{name:/灵感测试餐品/}).click();
    assert.equal(await page.locator('#year-filter').inputValue(),'','taste shortcut should clear the year filter');
    assert.equal(await page.locator('#country-filter').inputValue(),'','taste shortcut should clear the province filter');
    assert.equal(await page.locator('#journal-query').inputValue(),'灵感测试餐品');
    assert.equal(await page.locator('#tab-journal').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#journal-grid .entry-card').count(),2,'taste shortcut should find confirmed visits only');

    await page.locator('#year-filter').selectOption(created.date.slice(0,4));
    await page.locator('#country-filter').selectOption('510000');
    await page.locator('#journal-query').fill('没有匹配的新打卡前关键词');
    await addEntry(page,{city:'北京',store:'保存后自动恢复可见的新打卡',province:'110000',foods:'新页测试餐品'});
    assert.equal(await page.locator('#year-filter').inputValue(),'','saving a new entry should clear the year filter');
    assert.equal(await page.locator('#country-filter').inputValue(),'','saving a new entry should clear the province filter');
    assert.equal(await page.locator('#journal-query').inputValue(),'','saving a new entry should clear the text search');
    assert.equal(await page.locator('#journal-grid').getByRole('heading',{name:'保存后自动恢复可见的新打卡'}).count(),1,'the new entry should be visible immediately after saving');

    const orderId='mcp-112233445566778899aabbcc';
    const importedOrder={id:orderId,date:today(),country_code:'CN',province_code:'310000',city:'上海',store:'虚构自动整理订单',foods:['自动订单测试餐品'],note:'中国大陆订单线索；请核对是否本人到店。',source:'mcp_candidate',confirmed:false};
    const importArchive={version:1,data_kind:'mcp',entries:[importedOrder]};
    await page.locator('#import-file').setInputFiles({name:'confirmed-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(importArchive))});
    await page.locator('#toast').filter({hasText:'导入完成，订单已自动整理成手账'}).waitFor();
    let merged=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    const imported=merged.entries.filter(entry=>entry.id===orderId);
    assert.equal(imported.length,1,'an imported order should create one journal page');
    assert.equal(imported[0].source,'manual');
    assert.equal(imported[0].confirmed,true);
    assert.equal(imported[0].origin,'mcp');
    assert.equal(imported[0].note,'','the generated order hint should not become a personal note');
    assert.equal(await page.locator('#count-visits').innerText(),'4');
    await page.locator('#import-file').setInputFiles({name:'same-order-again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(importArchive))});
    await page.locator('#toast').filter({hasText:'导入完成，订单已自动整理成手账'}).waitFor();
    merged=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.equal(merged.entries.filter(entry=>entry.id===orderId).length,1,'reimporting the same order must not duplicate its page');
    assert.equal(await page.locator('#count-visits').innerText(),'4');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('tab',{name:/想去清单/}).click();
    let mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,grid:document.getElementById('inspiration-grid').getBoundingClientRect().right}));
    assert.ok(mobile.scroll<=mobile.width && mobile.grid<=mobile.width,'wishlist and inspiration must not overflow at 390px');
    await page.getByRole('tab',{name:'打卡手账',exact:true}).click();
    mobile=await page.evaluate(()=>{const rect=document.getElementById('journal-query').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:rect.left,right:rect.right};});
    assert.ok(mobile.scroll<=mobile.width && mobile.left>=0 && mobile.right<=mobile.width,'journal search must fit at 390px');
    await context.close();

    const syncContext=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
    const firstPage=await syncContext.newPage(),secondPage=await syncContext.newPage();
    firstPage.on('pageerror',error=>errors.push(error.message));secondPage.on('pageerror',error=>errors.push(error.message));
    await Promise.all([stubHealth(firstPage),stubHealth(secondPage)]);
    await Promise.all([firstPage.goto(base),secondPage.goto(base)]);
    await Promise.all([
      firstPage.getByRole('tab',{name:'打卡手账',exact:true}).click(),
      secondPage.getByRole('tab',{name:'打卡手账',exact:true}).click()
    ]);
    await addEntry(firstPage,{city:'上海',store:'双页同步第一条',foods:'测试汉堡'});
    await secondPage.locator('#journal-grid').getByRole('heading',{name:'双页同步第一条'}).waitFor();
    await addEntry(secondPage,{city:'成都',store:'双页同步第二条',province:'510000',foods:'测试咖啡'});
    await firstPage.locator('#journal-grid').getByRole('heading',{name:'双页同步第二条'}).waitFor();
    assert.equal(await firstPage.locator('#count-visits').innerText(),'2','first tab should receive second tab additions');
    assert.equal(await secondPage.locator('#count-visits').innerText(),'2','saving in the second tab must preserve the first tab record');
    firstPage.once('dialog',dialog=>dialog.accept());
    const secondCard=firstPage.locator('#journal-grid .entry-card').filter({has: firstPage.getByRole('heading',{name:'双页同步第二条'})});
    await secondCard.getByRole('button',{name:'删除',exact:true}).click();
    await secondPage.locator('#journal-grid').getByRole('heading',{name:'双页同步第二条'}).waitFor({state:'detached'});
    assert.equal(await firstPage.locator('#count-visits').innerText(),'1','deletion should update the first tab immediately');
    assert.equal(await secondPage.locator('#count-visits').innerText(),'1','deletion should synchronize to the second tab');
    const finalArchive=await secondPage.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.deepEqual(finalArchive.entries.map(entry=>entry.store),['双页同步第一条']);
    assert.deepEqual(errors,[],'no browser runtime errors expected');
    await syncContext.close();
    console.log(`PASS: ${catalog.stores.length} real public-directory inspiration cards and decoded photos, shared city/keyword searches, wishlist persistence/deduplication, automatic visit confirmation/default photo/no fake MCP reference, multi-term journal search and reset-on-save, taste shortcuts excluding unconfirmed manual drafts, repeat-visit and automatic order import flows, mobile wishlist/search sizing, and two-tab add/delete/merge synchronization. No token or external API calls used.`);
  } finally {
    await browser.close();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
