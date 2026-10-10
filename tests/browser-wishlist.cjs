'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(__dirname, '..', 'test-results');
const store = {name: '虚构上海测试门店', code: 'wishlist-fixture-001', address: '虚构路 1 号', city: '上海', business_status: true, hours: '07:00–23:00'};

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

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const backup = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    assert.equal(backup.entries.length, 0);
    assert.equal(backup.wishlist.length, 1);
    assert.equal(backup.wishlist[0].note, '想看看这家虚构门店的设计。');

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
    await restored.getByRole('button', {name: '保存这一页'}).click();
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
    assert.deepEqual(errors, []);
    await restoredContext.close();
    await context.close();
    console.log('PASS: wishlist deduplication, note persistence and backup restore, explicit arrival confirmation, cancel/complete/remove behavior, and mobile tab/dialog sizing. All store data is synthetic and API-stubbed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
