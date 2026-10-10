'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const unknownStore={code:'plan-share-unknown-001',name:'虚构海边麦当劳',city:'虚构海城',address:'绝不分享的虚构地址 77 号',business_status:true,hours:'08:00–22:00'};

async function waitForCard(page) {
  await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
  await page.locator('#share-preview img').waitFor();
}

async function downloadPng(page) {
  await waitForCard(page);
  const pending=page.waitForEvent('download');
  await page.locator('#save-share').click();
  const download=await pending;
  assert.ok(download.suggestedFilename().startsWith('麦麦想去-'),'a future plan download should have a plan filename');
  const bytes=fs.readFileSync(await download.path());
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  assert.equal(bytes.readUInt32BE(16),1080);
  assert.equal(bytes.readUInt32BE(20),1440);
  return bytes;
}

async function main() {
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',acceptDownloads:true});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{
        window.planShared={title:payload.title,text:payload.text,files:payload.files?.map(file=>({name:file.name,type:file.type}))};
      }});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:payload=>!!payload.files?.length});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        writeText:async text=>{window.planCopied=text;},
        write:async items=>{window.planCopiedImage={types:items[0].types,blob:await items[0].getType('image/png')};}
      }});
    });
    await page.route('**/api/health',route=>route.fulfill({json:{capabilities:{connect:false,synced_orders:false},connected:false,store_lookup:false}}));
    await page.route('**/api/stores',route=>route.fulfill({json:{stores:[unknownStore]}}));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(base);
    await page.getByRole('tab',{name:/想去清单/}).click();

    const inspiration=page.locator('#inspiration-grid .inspiration-card').filter({hasText:'成都'}).first();
    const store=await inspiration.locator('h3').innerText();
    const city=await inspiration.locator('.date').innerText().then(text=>text.split(' · ')[0]);
    await inspiration.getByRole('button',{name:'想去这家',exact:true}).click();
    assert.equal(await page.locator('#wishlist-count').innerText(),'1');
    assert.equal(await page.locator('#count-visits').innerText(),'0');

    const plan=page.locator('#wishlist-grid .entry-card').first();
    const defaultPhoto=plan.locator('img.photo');
    await defaultPhoto.waitFor();
    await defaultPhoto.evaluate(image=>image.decode());
    assert.ok(await defaultPhoto.evaluate(image=>image.naturalWidth>0 && image.naturalHeight>0),'wishlist card should show its default photo');
    const note=plan.locator('textarea:not([readonly])');
    await note.fill('想和朋友看看黄色旋转楼梯。');
    await plan.getByRole('button',{name:'分享下一站',exact:true}).click();
    assert.equal(await page.locator('#share-heading').innerText(),'分享想去的下一站');
    assert.equal(await page.locator('#share-title').inputValue(),'下一站，想去这家');
    assert.equal(await page.locator('#share-note-label').innerText(),'带上想去的理由');
    assert.equal(await page.locator('#share-cities').isChecked(),true);
    assert.equal(await page.locator('#share-note').isChecked(),true);
    await waitForCard(page);

    await page.locator('#copy-share').click();
    let caption=await page.evaluate(()=>window.planCopied);
    assert.ok(caption.includes('下一站计划 · 尚未打卡'),'plan caption must say this is not a visit');
    assert.ok(caption.includes('想和朋友看看黄色旋转楼梯。'),'sharing immediately after editing should use the latest note');
    assert.ok(caption.includes(city) && caption.includes(store));
    assert.equal(caption.includes('东大街下东大街段169号'),false,'caption must omit the store address');
    assert.equal(caption.includes('catalog%3A'),false,'caption must omit wishlist ids/store codes');
    assert.equal(caption.includes('catalog:'),false);

    await page.locator('#share-cities').uncheck();
    await page.locator('#share-note').uncheck();
    await waitForCard(page);
    await page.locator('#copy-share').click();
    caption=await page.evaluate(()=>window.planCopied);
    assert.ok(caption.includes('下一站计划 · 尚未打卡'));
    assert.equal(caption.includes(city),false,'hiding place should remove both city and store from caption');
    assert.equal(caption.includes(store),false);
    assert.equal(caption.includes('想和朋友看看黄色旋转楼梯。'),false,'hiding note should remove the reason from caption');
    assert.equal(caption.includes('绝不分享的虚构地址 77 号'),false);

    await page.locator('#share-cities').check();
    await page.locator('#share-note').check();
    await waitForCard(page);
    const png=await downloadPng(page);
    assert.ok(png.length>10000,'default-photo plan card should render to a full image');
    await page.locator('#native-share').click();
    const shared=await page.evaluate(()=>window.planShared);
    assert.ok(shared.text.includes('下一站计划 · 尚未打卡'));
    assert.ok(shared.files?.some(file=>file.type==='image/png'));
    assert.equal(shared.text.includes('绝不分享的虚构地址 77 号'),false);
    await page.locator('#copy-share-image').click();
    assert.ok(await page.evaluate(()=>window.planCopiedImage?.types.includes('image/png') && window.planCopiedImage.blob.size>0));
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','sharing and downloading must preserve wishlist membership');
    assert.equal(await page.locator('#count-visits').innerText(),'0','sharing and downloading must not create a visit');
    await page.getByRole('button',{name:'关闭分享卡',exact:true}).click();

    await note.fill('分享后立刻更新的理由。');
    await plan.getByRole('button',{name:'到了，留一页打卡',exact:true}).click();
    assert.equal(await page.locator('[name=note]').inputValue(),'分享后立刻更新的理由。','arrival flow should use the latest unsaved textarea note');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.locator('#wishlist-count').innerText(),'1','canceling arrival should preserve the plan');

    await page.getByRole('tab',{name:'中国地图',exact:true}).click();
    await page.locator('#store-search summary').click();
    await page.locator('[name=search_city]').fill('虚构海城');
    await page.locator('[name=search_keyword]').fill('虚构海边');
    await page.locator('#search-stores').click();
    const unknownResult=page.locator('#store-results .entry-card').filter({hasText:unknownStore.name});
    await unknownResult.getByRole('button',{name:'收藏想去',exact:true}).click();
    await page.getByRole('tab',{name:/想去清单/}).click();
    const unknownPlan=page.locator('#wishlist-grid .entry-card').filter({hasText:unknownStore.name});
    assert.equal(await unknownPlan.locator('img.photo').count(),0,'unknown stores should use the card illustration fallback');
    await unknownPlan.getByRole('button',{name:'分享下一站',exact:true}).click();
    const fallbackPng=await downloadPng(page);
    assert.ok(fallbackPng.length>10000,'unknown-store illustration should still produce a complete share card');
    assert.equal(await page.locator('#wishlist-count').innerText(),'2');
    assert.equal(await page.locator('#count-visits').innerText(),'0');

    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,wishlist:document.getElementById('wishlist-grid').scrollWidth,dialog:document.getElementById('share-dialog').scrollWidth,dialogClient:document.getElementById('share-dialog').clientWidth}));
    assert.ok(mobile.document<=mobile.width,'wishlist page should not overflow horizontally on mobile');
    assert.ok(mobile.wishlist<=mobile.width,'wishlist cards should fit mobile width');
    assert.ok(mobile.dialog<=mobile.dialogClient+1,'plan share dialog should fit 390px viewport');
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS: current wishlist-note sharing, privacy toggles/caption, default-photo plan PNG at 1080x1440, native/clipboard stubs, no visit/list mutation, latest note in share/arrival flow, unknown-store illustration card, and 390px layout. No token or external requests used.');
  } finally {
    await browser.close();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
