'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

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
  await page.locator('[name=confirmed]').check();
  await page.locator('#save-entry').click();
  await page.locator('#entry-dialog').waitFor({state:'hidden'});
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
    await page.getByRole('tab',{name:/想去清单/}).click();
    const inspiration=page.locator('#inspiration-grid .inspiration-card');
    assert.equal(await inspiration.count(),5,'public inspiration catalog should show five stores without a token');
    const photos=await inspiration.evaluateAll(cards=>cards.map(card=>({city:card.querySelector('.date').textContent.split(' · ')[0],src:card.querySelector('img.photo')?.src,complete:card.querySelector('img.photo')?.complete,width:card.querySelector('img.photo')?.naturalWidth,height:card.querySelector('img.photo')?.naturalHeight})));
    for(const city of ['上海','成都','北京','广州','深圳']) {
      const photo=photos.find(item=>item.city===city);
      assert.ok(photo,'expected public inspiration for '+city);
      assert.ok(photo.src.startsWith('data:image/') && photo.complete && photo.width>0 && photo.height>0,city+' default photo should be embedded and decoded locally');
    }

    const first=inspiration.filter({hasText:'成都'});
    const store=await first.locator('h3').innerText();
    const city=await first.locator('.date').innerText().then(value=>value.split(' · ')[0]);
    const yesterday=(()=>{const d=new Date();d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})();
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
    assert.equal(await page.locator('[name=confirmed]').isChecked(),false,'a plan must not become a confirmed visit by itself');
    assert.equal(await page.locator('[name=complete_wishlist]').isChecked(),true);
    await page.locator('[name=date]').fill(yesterday);
    await page.locator('[name=foods]').fill('灵感测试餐品，城市咖啡');
    await page.locator('[name=note]').fill('灵感搜索随记');
    await page.locator('[name=province_code]').selectOption('510000');
    await page.locator('[name=province_code]').dispatchEvent('change');
    assert.equal(await page.locator('[name=complete_wishlist]').isChecked(),true);
    await page.locator('[name=confirmed]').check();
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
    assert.equal(await page.locator('[name=confirmed]').isChecked(),false,'repeat visit must require explicit confirmation');
    assert.equal(await page.locator('[name=note]').inputValue(),'','prior note must not carry into a new visit');
    assert.equal(await page.locator('#photo-preview').isVisible(),true,'default store photo should carry forward');
    assert.equal(await page.locator('#photo-actions').isVisible(),false,'the previous user-uploaded photo must not carry forward');
    await page.locator('[name=confirmed]').check();
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

    const candidateId='mcp-discovery-import-fixture';
    const candidate={id:candidateId,date:today(),country_code:'CN',province_code:'310000',city:'上海',store:'虚构订单候选',foods:['候选餐品不应进入味道回顾'],source:'mcp_candidate',confirmed:false};
    const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    current.entries.push(candidate);
    await page.evaluate(value=>localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify(value)),current);
    await page.reload();
    assert.ok(await page.locator('#journey-tastes').isVisible(),'confirmed foods should provide taste shortcuts');
    assert.ok(await page.locator('#taste-list button').count()<=5,'taste shortcuts should be capped at five foods');
    assert.equal((await page.locator('#taste-list').innerText()).includes('候选餐品不应进入味道回顾'),false,'unconfirmed candidates must not contribute taste memories');
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

    const confirmed={...candidate,source:'manual',confirmed:true,origin:'mcp'};
    const importArchive={version:1,data_kind:'manual',entries:[confirmed]};
    await page.locator('#import-file').setInputFiles({name:'confirmed-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(importArchive))});
    await page.locator('#toast').filter({hasText:'导入完成'}).waitFor();
    const merged=await page.evaluate(()=>JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    const upgraded=merged.entries.filter(entry=>entry.id===candidateId);
    assert.equal(upgraded.length,1,'same-id candidate should be replaced rather than duplicated');
    assert.equal(upgraded[0].source,'manual');
    assert.equal(upgraded[0].confirmed,true);
    assert.equal(merged.entries.some(entry=>entry.store===store),true,'candidate upgrade must preserve prior visits');
    assert.equal(merged.entries.some(entry=>entry.store==='保存后自动恢复可见的新打卡'),true,'candidate upgrade must preserve a newly saved visit');
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
    console.log('PASS: five embedded public inspiration cards, wishlist persistence/deduplication, confirmed manual arrival/default photo/no fake MCP reference, multi-term journal search and reset-on-save, taste shortcuts using confirmed foods only, repeat-visit page flow, confirmed candidate import upgrade, mobile wishlist/search sizing, and two-tab add/delete/merge synchronization. No token or external API calls used.');
  } finally {
    await browser.close();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
