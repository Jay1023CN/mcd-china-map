'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+n0N8AAAAASUVORK5CYII=';
const testResults = path.resolve(__dirname, '..', 'test-results');

function assertCardPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 1080);
  assert.equal(bytes.readUInt32BE(20), 1440);
}

async function waitForShare(page) {
  await page.locator('#share-preview img').waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.getElementById('save-share').disabled);
}

async function copyCaption(page) {
  await page.locator('#copy-share').click();
  return page.evaluate(() => window.__memoryCopiedCaption);
}

async function main() {
  fs.mkdirSync(testResults, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {window.__memoryCopiedCaption = text;}}});
    });
    const page = await context.newPage();
    const errors = [];
    const photoDataRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/photo-data', route => {
      const request = route.request().postDataJSON();
      photoDataRequests.push(request);
      assert.equal(typeof request.url, 'string');
      return route.fulfill({json: {data_url: tinyPng}});
    });
    await page.goto(new URL('docs/china-demo.html', base).href);

    const demoEntry = await page.evaluate(() => {
      const archive = JSON.parse(document.getElementById('journal-data').textContent).archive;
      return archive.entries.find(entry => entry.city === '上海');
    });
    assert.ok(demoEntry, 'public demo must include the synthetic Shanghai page');
    assert.ok(demoEntry.default_photo, 'public demo page must exercise a default photo');
    await page.getByRole('tab', {name: '打卡手账', exact: true}).click();
    const shanghaiCard = page.locator('#journal-grid .entry-card').filter({has: page.locator('h3').filter({hasText: demoEntry.store})});
    await shanghaiCard.getByRole('button', {name: '分享这一页', exact: true}).click();
    await waitForShare(page);
    assert.equal(await page.locator('#share-note-option').isVisible(), true);
    assert.equal(await page.locator('#share-photo-option').isVisible(), true);

    for (const fit of ['contain', 'cover']) {
      await page.locator('#share-photo-fit').selectOption(fit);
      await waitForShare(page);
      assert.equal(await page.locator('#share-photo-fit').inputValue(), fit);
    }

    for (const theme of ['paper', 'red']) {
      await page.locator('#share-theme').selectOption(theme);
      await waitForShare(page);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#save-share').click();
      const download = await downloadPromise;
      const bytes = fs.readFileSync(await download.path());
      assertCardPng(bytes);
      if (theme === 'paper') fs.writeFileSync(path.join(testResults, 'memory-card.png'), bytes);
    }

    const fullCaption = await copyCaption(page);
    assert.ok(fullCaption.includes(demoEntry.date));
    for (const food of demoEntry.foods) assert.ok(fullCaption.includes(food));
    assert.ok(fullCaption.includes(demoEntry.city));
    assert.ok(fullCaption.includes(demoEntry.store));
    assert.ok(demoEntry.note && fullCaption.includes(demoEntry.note));
    assert.ok(!fullCaption.includes(demoEntry.id));
    for (const privateValue of [demoEntry.address, demoEntry.store_reference?.address, demoEntry.store_reference?.code]) {
      if (privateValue) assert.ok(!fullCaption.includes(privateValue));
    }

    await page.locator('#share-cities').uncheck();
    await page.locator('#share-note').uncheck();
    await waitForShare(page);
    const limitedCaption = await copyCaption(page);
    assert.ok(limitedCaption.includes(demoEntry.date));
    for (const food of demoEntry.foods) assert.ok(limitedCaption.includes(food));
    assert.ok(!limitedCaption.includes(demoEntry.city));
    assert.ok(!limitedCaption.includes(demoEntry.store));
    assert.ok(!limitedCaption.includes(demoEntry.note));

    await page.locator('[data-close="share-dialog"]').click();
    const firstEntry = await page.evaluate(() => JSON.parse(document.getElementById('journal-data').textContent).archive.entries[0]);
    const firstCard = page.locator('#journal-grid .entry-card').filter({has: page.locator('h3').filter({hasText: firstEntry.store})});
    await firstCard.getByRole('button', {name: '翻开', exact: true}).click();
    await page.locator('#detail-body').getByRole('button', {name: '分享这一页', exact: true}).click();
    await waitForShare(page);
    const nextCaption = await copyCaption(page);
    assert.ok(nextCaption.includes(firstEntry.date));
    for (const food of firstEntry.foods) assert.ok(nextCaption.includes(food));
    assert.ok(!nextCaption.includes(demoEntry.store), 'opening another page must not retain the previous page caption');
    assert.ok(!nextCaption.includes(demoEntry.note));
    assert.ok(!nextCaption.includes(demoEntry.id));
    await page.locator('[data-close="share-dialog"]').click();

    await page.setViewportSize({width: 390, height: 844});
    const mobileEntryCard = page.locator('#journal-grid .entry-card').filter({has: page.locator('h3').filter({hasText: demoEntry.store})});
    await mobileEntryCard.getByRole('button', {name: '分享这一页', exact: true}).click();
    await waitForShare(page);
    const mobileOptions = await page.locator('.share-options').evaluate(element => ({scroll: element.scrollWidth, client: element.clientWidth}));
    const mobileDialog = await page.locator('#share-dialog').evaluate(element => ({scroll: element.scrollWidth, client: element.clientWidth}));
    assert.ok(mobileOptions.scroll <= mobileOptions.client + 1, 'single-page share options must fit on mobile');
    assert.ok(mobileDialog.scroll <= mobileDialog.client + 1, 'single-page share dialog must fit on mobile');
    await page.locator('[data-close="share-dialog"]').click();
    await page.locator('#open-share').click();
    await waitForShare(page);
    assert.equal(await page.locator('#share-note-option').isVisible(), false, 'footprint share mode must hide the single-entry note option');
    assert.equal(await page.locator('#share-photo-option').isVisible(), false);
    const footprintOptions = await page.locator('.share-options').evaluate(element => ({scroll: element.scrollWidth, client: element.clientWidth}));
    assert.ok(footprintOptions.scroll <= footprintOptions.client + 1, 'footprint share options must fit on mobile');
    assert.deepEqual(errors, []);
    await context.close();

    const journalContext = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai'});
    const journalPage = await journalContext.newPage();
    journalPage.on('pageerror', error => errors.push(error.message));
    await journalPage.goto(base);
    await journalPage.getByRole('button', {name: '新增打卡', exact: true}).click();
    await journalPage.locator('[name=store]').fill('麦当劳成都锦江区东大街旗舰店餐厅');
    const chengduPhoto = await journalPage.locator('#photo-preview').getAttribute('src');
    assert.match(chengduPhoto, /^data:image\//, 'Chengdu default photo should be embedded without an external image request');
    await journalPage.waitForFunction(() => document.getElementById('photo-preview').naturalWidth > 0);
    assert.match(await journalPage.locator('#photo-caption').innerText(), /麦当劳官网新闻配图/);

    await journalPage.locator('[name=city]').fill('北京');
    await journalPage.locator('[name=province_code]').selectOption('');
    await journalPage.locator('[name=store]').fill('麦当劳北京首钢园得来速餐厅');
    const shougangPhoto = await journalPage.locator('#photo-preview').getAttribute('src');
    assert.match(shougangPhoto, /^data:image\//, 'Shougang default photo should be embedded without an external image request');
    await journalPage.waitForFunction(() => document.getElementById('photo-preview').naturalWidth > 0);
    assert.match(await journalPage.locator('#photo-caption').innerText(), /麦当劳官网新闻配图/);
    assert.equal(await journalPage.locator('[name=city]').inputValue(), '北京');
    assert.equal(await journalPage.locator('[name=province_code]').inputValue(), '110000');
    await journalPage.locator('[name=foods]').fill('咖啡，薯条');
    assert.equal(await journalPage.locator('[name=confirmed]').isChecked(), true, 'saved manual pages are confirmed automatically');
    await journalPage.getByRole('button', {name: '保存这一页'}).click();
    assert.equal(await journalPage.locator('#count-visits').innerText(), '1');
    const savedStoreCard = journalPage.locator('#journal-grid .entry-card').filter({has: journalPage.locator('h3').filter({hasText: '麦当劳北京首钢园得来速餐厅'})});
    const savedPhoto = savedStoreCard.locator('.entry-photo img.photo');
    await journalPage.waitForFunction(() => {
      const image = document.querySelector('#journal-grid .entry-photo img.photo');
      return !!image && image.naturalWidth > 0;
    });
    assert.match(await savedPhoto.getAttribute('src'), /^data:image\//);
    assert.match(await savedStoreCard.locator('.photo-credit').innerText(), /麦当劳官网新闻配图/);

    await journalPage.getByRole('button', {name: '新增打卡', exact: true}).click();
    await journalPage.locator('[name=province_code]').selectOption('310000');
    await journalPage.locator('[name=city]').fill('上海');
    await journalPage.locator('[name=store]').fill('合成上传照片测试门店');
    await journalPage.locator('[name=foods]').fill('咖啡');
    const uploadData = await journalPage.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 6;
      const context = canvas.getContext('2d'); context.fillStyle = '#dd442e'; context.fillRect(0, 0, 8, 6);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await journalPage.locator('[name=photo]').setInputFiles({name: 'synthetic-upload.png', mimeType: 'image/png', buffer: Buffer.from(uploadData, 'base64')});
    await journalPage.locator('#photo-preview').waitFor({state: 'visible'});
    await journalPage.waitForFunction(() => !document.getElementById('save-entry').disabled);
    assert.equal(await journalPage.locator('[name=confirmed]').isChecked(), true, 'saved manual pages are confirmed automatically');
    await journalPage.getByRole('button', {name: '保存这一页'}).click();
    const uploadedCard = journalPage.locator('#journal-grid .entry-card').filter({has: journalPage.locator('h3').filter({hasText: '合成上传照片测试门店'})});
    assert.match(await uploadedCard.locator('img.photo').getAttribute('src'), /^data:image\/jpeg;base64,/);
    await uploadedCard.getByRole('button', {name: '分享这一页', exact: true}).click();
    await waitForShare(journalPage);
    const uploadDownloadPromise = journalPage.waitForEvent('download');
    await journalPage.locator('#save-share').click();
    assertCardPng(fs.readFileSync(await (await uploadDownloadPromise).path()));
    assert.deepEqual(errors, []);
    await journalContext.close();

    console.log('PASS: public single-page share, privacy toggles/caption isolation, two 1080x1440 themes, embedded Chengdu/Shougang default photos and attribution, uploaded-photo card, and mobile share options. Synthetic upload only; no private data or official API calls.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
