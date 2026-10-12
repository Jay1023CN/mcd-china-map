'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(__dirname, '..', 'test-results');
const store = {name: '虚构上海测试门店', code: 'wishlist-fixture-001', address: '虚构路 1 号', city: '上海', business_status: true, hours: '07:00–23:00'};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}

function makeTestPhoto() {
  const width = 8, height = 8, row = Buffer.alloc(1 + width * 4);
  row[0] = 0;
  for (let x = 0; x < width; x++) row.set([220, 68, 46, 255], 1 + x * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({length: height}, () => row)))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

async function stubStoreApi(page) {
  await page.route('**/api/health', route => route.fulfill({json: {store_lookup: true}}));
  await page.route('**/api/stores', route => {
    assert.deepEqual(route.request().postDataJSON(), {city: '上海', keyword: '虚构地标', be_type: 1});
    return route.fulfill({json: {stores: [store]}});
  });
}

async function searchStore(page) {
  await page.getByRole('tab', {name: '中国地图', exact: true}).click();
  if (!await page.locator('#store-search').evaluate(details => details.open)) await page.locator('#store-search summary').click();
  await page.locator('[name=search_city]').fill('上海');
  await page.locator('[name=search_keyword]').fill('虚构地标');
  await page.locator('#search-stores').click();
  await page.locator('#store-results').getByRole('button', {name: '收藏想去'}).waitFor();
}

async function main() {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await stubStoreApi(page);
    await page.goto(base);
    assert.equal(await page.locator('#count-visits').innerText(), '0');

    await searchStore(page);
    const collect = page.locator('#store-results .entry-card').getByRole('button', {name: '收藏想去'});
    await collect.click();
    await collect.click();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'saving a wishlist item must not count as a visit');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1', 'repeated collection must remain one item');

    await page.getByRole('tab', {name: /想去清单/}).click();
    assert.equal(await page.locator('#wishlist-grid .entry-card').count(), 1);
    const note = page.locator('#wishlist-grid textarea:not([readonly])');
    await note.fill('想看看这家虚构门店的设计。');
    await note.press('Tab');
    await page.locator('#toast').filter({hasText: '想去的理由已保存'}).waitFor();
    await page.reload();
    await page.getByRole('tab', {name: /想去清单/}).click();
    assert.equal(await page.locator('#wishlist-grid textarea:not([readonly])').inputValue(), '想看看这家虚构门店的设计。');

    const priority = page.locator('#wishlist-grid .wishlist-priority');
    const priorityBounds = await priority.boundingBox();
    const cardBounds = await page.locator('#wishlist-grid .entry-card').boundingBox();
    assert.ok(Math.abs((priorityBounds.x + priorityBounds.width / 2) - (cardBounds.x + cardBounds.width / 2)) < 2, 'priority action should be centered in the card');
    const plannedDate = '2027-01-17';
    await page.locator('#wishlist-grid .wishlist-date-value').click();
    for (let attempt = 0; attempt < 240; attempt++) {
      const title = await page.locator('#wishlist-grid .meal-calendar-title').innerText();
      if (title === '2027年1月') break;
      await page.locator('#wishlist-grid .meal-calendar-nav[aria-label="下一个月"]').click();
    }
    await page.locator(`#wishlist-grid [data-calendar-date="${plannedDate}"]`).click();
    assert.equal(await page.locator('#wishlist-grid .wishlist-date-value').innerText(), '2027年01月17日', 'date picker should present a Chinese date instead of a browser-native format');
    assert.equal(await page.locator('#wishlist-grid .wishlist-date-hint').innerText(), '计划 2027年01月17日');
    assert.equal(await page.locator('#wishlist-grid .wishlist-date-clear').count(), 1);
    await page.reload();
    await page.getByRole('tab', {name: /想去清单/}).click();
    assert.equal(await page.locator('#wishlist-grid .wishlist-date-value').innerText(), '2027年01月17日', 'planned dates should persist after reload');
    await page.locator('#wishlist-copy').click();
    assert.ok((await page.locator('#wishlist-copy-text').inputValue()).includes('https://mcd-china-map.onrender.com/#store-finder'), 'copied itinerary should link directly to the live store finder');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const backup = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    assert.equal(backup.entries.length, 0);
    assert.equal(backup.wishlist.length, 1);
    assert.equal(backup.wishlist[0].note, '想看看这家虚构门店的设计。');
    assert.equal(backup.wishlist[0].planned_date, plannedDate);

    const restoredContext = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    const restored = await restoredContext.newPage();
    restored.on('pageerror', error => errors.push(error.message));
    await stubStoreApi(restored);
    await restored.goto(base);
    await restored.locator('#import-file').setInputFiles({name: 'wishlist-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))});
    await restored.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    await restored.getByRole('tab', {name: /想去清单/}).click();
    assert.equal(await restored.locator('#wishlist-grid .entry-card').count(), 1);
    assert.equal(await restored.locator('#wishlist-grid textarea:not([readonly])').inputValue(), '想看看这家虚构门店的设计。');
    assert.equal(await restored.locator('#count-visits').innerText(), '0');

    await restored.getByRole('button', {name: '到了，留一页打卡', exact: true}).click();
    assert.equal(await restored.locator('[name=city]').inputValue(), '上海');
    assert.equal(await restored.locator('[name=province_code]').inputValue(), '310000');
    assert.equal(await restored.locator('[name=store]').inputValue(), store.name);
    assert.equal(await restored.locator('[name=confirmed]').isChecked(), true, 'arrival pages are confirmed automatically');
    assert.equal(await restored.locator('[name=confirmed]').isVisible(), false, 'confirmation is not an extra user action');
    assert.equal(await restored.locator('[name=complete_wishlist]').isChecked(), true);
    await restored.getByRole('button', {name: '取消', exact: true}).click();
    assert.equal(await restored.locator('#wishlist-grid .entry-card').count(), 1, 'canceling the arrival form must preserve the wishlist');

    await restored.getByRole('button', {name: '到了，留一页打卡', exact: true}).click();
    assert.equal(await restored.locator('[name=confirmed]').isChecked(), true);
    await restored.getByRole('button', {name: '保存这一餐'}).click();
    assert.equal(await restored.locator('#count-visits').innerText(), '1');
    assert.equal(await restored.locator('#wishlist-count').innerText(), '0');
    await restored.getByRole('tab', {name: '打卡手账', exact: true}).click();
    assert.equal(await restored.locator('#journal-grid .entry-card').count(), 1);
    assert.equal(await restored.locator('#journal-grid h3').innerText(), store.name);

    await searchStore(restored);
    await restored.locator('#store-results .entry-card').getByRole('button', {name: '收藏想去'}).click();
    await restored.getByRole('tab', {name: /想去清单/}).click();
    await restored.getByRole('button', {name: '移出清单', exact: true}).click();
    assert.equal(await restored.locator('#wishlist-count').innerText(), '0');
    assert.equal(await restored.locator('#count-visits').innerText(), '1', 'removing a planned visit must not delete a completed journal entry');
    await restored.getByRole('tab', {name: '打卡手账', exact: true}).click();
    assert.equal(await restored.locator('#journal-grid .entry-card').count(), 1);

    await restored.setViewportSize({width: 390, height: 844});
    await restored.getByRole('tab', {name: /想去清单/}).click();
    const tabBounds = await restored.locator('#tab-wishlist').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {left: rect.left, right: rect.right, viewport: innerWidth, document: document.documentElement.scrollWidth};
    });
    assert.ok(tabBounds.left >= 0 && tabBounds.right <= tabBounds.viewport, 'wishlist tab must fit the mobile viewport');
    assert.ok(tabBounds.document <= tabBounds.viewport, 'mobile page must not overflow horizontally');
    await searchStore(restored);
    await restored.locator('#store-results .entry-card').getByRole('button', {name: '收藏想去'}).click();
    await restored.getByRole('tab', {name: /想去清单/}).click();
    await restored.getByRole('button', {name: '到了，留一页打卡', exact: true}).click();
    const dialogBounds = await restored.locator('#entry-dialog').evaluate(dialog => ({scroll: dialog.scrollWidth, client: dialog.clientWidth}));
    assert.ok(dialogBounds.scroll <= dialogBounds.client + 1, 'arrival dialog must fit the mobile viewport');
    assert.equal(await restored.locator('[name=store]').inputValue(), store.name, 'arrival should carry the collected store into the meal form');
    assert.equal(await restored.locator('[name=city]').inputValue(), store.city);
    await restored.locator('#meal-foods button').filter({hasText: /^薯条$/}).click();
    await restored.locator('[name=note]').fill('刚收藏的这家店，来留一张照片。');
    await restored.locator('[name=photo]').setInputFiles({name: '上海测试餐品.png', mimeType: 'image/png', buffer: makeTestPhoto()});
    await restored.locator('#photo-preview').waitFor({state: 'visible'});
    await restored.waitForFunction(() => {
      const image = document.getElementById('photo-preview');
      return image.complete && image.naturalWidth === 8 && !document.getElementById('save-entry').disabled;
    });
    assert.equal(await restored.locator('#photo-caption').innerText(), '你上传的照片');
    await restored.getByRole('button', {name: '保存这一餐'}).click();
    await restored.locator('#entry-dialog').waitFor({state: 'hidden'});
    assert.equal(await restored.locator('#wishlist-count').innerText(), '0', 'saving the arrival should complete the collected plan');
    await restored.getByRole('tab', {name: '打卡手账', exact: true}).click();
    const savedMeal = restored.locator('#journal-grid .entry-card').filter({has: restored.locator('h3', {hasText: store.name})});
    assert.equal(await savedMeal.count(), 1);
    assert.deepEqual(await savedMeal.locator('.food-tags span').allTextContents(), ['薯条']);
    assert.equal(await savedMeal.locator('.note').innerText(), '刚收藏的这家店，来留一张照片。');
    assert.match(await savedMeal.locator('img.photo').getAttribute('src'), /^data:image\/jpeg;base64,/);
    await savedMeal.getByRole('button', {name: '分享这一页', exact: true}).click();
    assert.equal(await restored.locator('#share-stickers [data-sticker="food"]').getAttribute('aria-pressed'), 'true', 'the card should include a sticker for the meal foods');
    await restored.waitForFunction(() => {
      const image = document.getElementById('share-image');
      return image && image.complete && image.naturalWidth > 0 && !document.getElementById('save-share').disabled;
    });
    const cardDownload = restored.waitForEvent('download');
    await restored.locator('#save-share').click();
    const downloadedCard = await cardDownload;
    assert.match(downloadedCard.suggestedFilename(), /^麦麦探店记-.*\.png$/);
    const cardPath = await downloadedCard.path();
    assert.ok(cardPath, 'the share card should be downloaded to a file');
    const png = fs.readFileSync(cardPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'the downloaded share card should be a real PNG');
    assert.ok(png.length > 1024, 'the downloaded card should contain the rendered meal and photo');
    assert.deepEqual(errors, []);
    await restoredContext.close();
    await context.close();
    console.log('PASS: wishlist deduplication, note persistence and backup restore, explicit arrival confirmation, same-store mobile meal with uploaded photo, matching food sticker, saved PNG share card, cancel/complete/remove behavior, and mobile tab/dialog sizing. All store data is synthetic and API-stubbed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
