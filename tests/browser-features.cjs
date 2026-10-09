'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(new URL('docs/china-demo.html',base).href);
    assert.equal(await page.locator('#journey-facts b').first().innerText(),'9');
    await page.locator('#journey-memory').click();
    assert.equal(await page.locator('#detail-dialog').evaluate(dialog=>dialog.open),true);
    await page.getByRole('button',{name:'关闭手账详情',exact:true}).click();
    await page.locator('#open-share').click();
    await page.locator('#share-preview canvas').waitFor();
    fs.mkdirSync('test-results',{recursive:true});
    for(const theme of ['paper','red']) {
      await page.locator('#share-theme').selectOption(theme);
      await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
      const download=page.waitForEvent('download');await page.locator('#save-share').click();
      const file=await download;const bytes=fs.readFileSync(await file.path());
      assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1080);assert.equal(bytes.readUInt32BE(20),1440);
      fs.writeFileSync('test-results/share-'+theme+'.png',bytes);
    }
    await page.locator('#share-cities').check();
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    const facts=await page.evaluate(()=>{
      const data=JSON.parse(document.getElementById('journal-data').textContent);
      return ShareCard.shareFacts(JournalEngine.summarize(data.archive,{today:'2026-10-09'}),{includeCities:true});
    });
    assert.equal(facts.cities.length,9);assert.equal('entries' in facts,false);assert.equal('stores' in facts,false);
    await page.getByRole('button',{name:'关闭分享卡',exact:true}).click();
    await page.setViewportSize({width:390,height:844});await page.locator('#open-share').click();
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    assert.ok(await page.locator('#share-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS: annual memories, paper/red share previews, 1080x1440 PNG download, city option, mobile dialog. Public demonstration only.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
