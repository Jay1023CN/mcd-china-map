'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const candidate = {
  version: 1,
  data_kind: 'mcp',
  source: 'Synthetic connection test fixture; never an actual order.',
  entries: [{
    id: 'mcp-0123456789abcdef01234567',
    date: '2026-10-09',
    country_code: 'CN',
    province_code: '310000',
    city: '上海',
    store: '虚构订单测试门店',
    foods: ['咖啡'],
    note: '合成候选，仅用于自动化验收。',
    source: 'mcp_candidate',
    confirmed: false
  }]
};
const wishlist = {
  version: 1,
  data_kind: 'manual',
  entries: [],
  wishlist: [{source: 'mcp_nearby', code: 'wishlist-fixture', name: '虚构想去门店', city: '上海', address: '虚构地址', note: '保留这条合成计划。'}]
};
const file = (name, value) => ({name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))});

async function main() {
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai'});
    const page = await context.newPage();
    const errors = [];
    const connectRequests = [];
    const syncRequests = [];
    let connectionMode = 'success';
    let syncMode = 'success';
    let connected = false;
    let finishSync;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({json: {
      capabilities: {connect: true, synced_orders: true},
      connected,
      store_lookup: connected,
      order_sync: connected
    }}));
    await page.route('**/api/connect', async route => {
      const body = route.request().postDataJSON();
      connectRequests.push(body);
      assert.deepEqual(Object.keys(body).sort(), ['token']);
      if (connectionMode === 'failure') {
        return route.fulfill({status: 401, json: {error: '连接未完成，请检查 Token。'}});
      }
      connected = true;
      return route.fulfill({json: {connected: true, store_lookup: true, order_sync: true}});
    });
    await page.route('**/api/sync-orders', route => {
      const body = route.request().postDataJSON();
      syncRequests.push(body);
      assert.deepEqual(body, {});
      if (syncMode === 'failure') return route.fulfill({status: 502, json: {error: '订单同步失败，之前已保存的订单记录保持不变。'}});
      if (syncMode === 'waiting') {
        return new Promise((resolve, reject) => {
          finishSync = () => route.fulfill({json: {archive: candidate}}).then(resolve, reject);
        });
      }
      return route.fulfill({json: {archive: candidate}});
    });
    await page.route('**/api/disconnect', route => route.fulfill({json: {connected: false, store_lookup: false}}));
    await page.route('**/api/synced-orders', route => route.fulfill({json: candidate}));
    await page.goto(base);

    await page.locator('#import-file').setInputFiles(file('synthetic-wishlist.json', wishlist));
    await page.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');
    assert.equal(await page.locator('#count-visits').innerText(), '0');

    await page.locator('#open-connect').click();
    assert.equal(await page.locator('#connect-dialog').evaluate(dialog => dialog.open), true);
    await page.locator('#connect-token').fill('fixturetoken');
    await page.locator('#connect-submit').click();
    await page.locator('#connect-dialog').waitFor({state: 'hidden'});
    assert.deepEqual(connectRequests[0], {token: 'fixturetoken'});
    assert.equal(await page.locator('#connect-token').inputValue(), '');
    assert.equal(await page.locator('#load-orders').isVisible(), true);
    assert.equal(await page.locator('#disconnect-mcd').isVisible(), true);

    await page.locator('#load-orders').click();
    const importedOrder = page.locator('#journal-grid .entry-card').filter({hasText: '虚构订单测试门店'});
    await importedOrder.waitFor();
    assert.equal(await page.locator('#candidate-count').innerText(), '0', 'completed orders should be materialized directly as journal pages');
    assert.equal(await page.locator('#count-visits').innerText(), '1', 'a completed order should immediately become a confirmed journal page');
    assert.match(await importedOrder.locator('.origin').innerText(), /从麦当劳订单自动整理/);
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');
    await page.locator('#load-orders').click();
    await page.locator('#toast').filter({hasText: '订单已自动整理成手账'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '1', 'loading the same order twice must not add another page');

    assert.equal(await page.locator('#sync-orders').isVisible(), true, 'order sync is available after a successful connection');
    await page.locator('#country-filter').selectOption('110000');
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'the Beijing filter hides the Shanghai journal page while sync is tested');
    syncMode = 'waiting';
    await page.locator('#sync-orders').click();
    await page.locator('#sync-progress').filter({hasText: '正在整理门店和餐品'}).waitFor();
    assert.equal(await page.locator('#sync-orders').isDisabled(), true, 'sync action must be disabled while the request is pending');
    assert.equal(await page.locator('#load-orders').isDisabled(), true);
    assert.deepEqual(syncRequests[0], {});
    assert.equal(typeof finishSync, 'function');
    await finishSync();
    syncMode = 'success';
    await page.locator('#sync-progress').filter({hasText: '已自动整理 1 页订单手账'}).waitFor();
    assert.equal(await page.locator('#sync-orders').isDisabled(), false);
    assert.equal(await page.locator('#country-filter').inputValue(), '', 'sync clears the old province filter');
    assert.equal(await page.locator('#count-visits').innerText(), '1', 'the same synced order remains one confirmed page');
    await page.locator('#country-filter').selectOption('');
    assert.equal(await page.locator('#candidate-count').innerText(), '0');
    assert.equal(await page.locator('#count-visits').innerText(), '1');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');

    await page.getByRole('tab', {name: '打卡手账', exact: true}).click();
    const automaticPage = page.locator('#journal-grid .entry-card').filter({hasText: '虚构订单测试门店'});
    page.once('dialog', dialog => dialog.accept());
    await automaticPage.getByRole('button', {name: '删除', exact: true}).click();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'deleting an automatic order page removes it from the journal');
    let savedArchive = await page.evaluate(() => JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.deepEqual(savedArchive.deleted_order_ids, [candidate.entries[0].id], 'deletion should persist a stable order tombstone');

    await page.locator('#load-orders').click();
    await page.locator('#toast').filter({hasText: '订单已自动整理成手账'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'loading a deleted order must not recreate its page');
    await page.locator('#sync-orders').click();
    await page.locator('#sync-progress').filter({hasText: '已自动整理 1 页订单手账'}).waitFor();
    assert.equal(await page.locator('#candidate-count').innerText(), '0');
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'sync must honor the deletion tombstone');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');

    await page.reload();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'the deleted order remains absent after reload');
    savedArchive = await page.evaluate(() => JSON.parse(localStorage.getItem('mcd-china-map-personal-v1')));
    assert.deepEqual(savedArchive.deleted_order_ids, [candidate.entries[0].id]);
    await page.locator('#load-orders').click();
    await page.locator('#toast').filter({hasText: '订单已自动整理成手账'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'reloading the deleted order after refresh must not recreate it');
    await page.locator('#sync-orders').click();
    await page.locator('#sync-progress').filter({hasText: '已自动整理 1 页订单手账'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '0', 'sync after refresh must still honor the tombstone');

    syncMode = 'failure';
    await page.locator('#sync-orders').click();
    await page.locator('#sync-progress').filter({hasText: '订单同步失败，之前已保存的订单记录保持不变。'}).waitFor();
    assert.equal(await page.locator('#sync-orders').isDisabled(), false);
    assert.equal(await page.locator('#candidate-count').innerText(), '0');
    assert.equal(await page.locator('#count-visits').innerText(), '0');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');
    assert.deepEqual(syncRequests, [{}, {}, {}, {}]);

    await page.locator('#disconnect-mcd').click();
    await page.locator('#toast').filter({hasText: '连接已断开'}).waitFor();
    connected = false;
    assert.equal(await page.locator('#count-visits').innerText(), '0');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');
    await page.getByRole('tab', {name: '打卡手账', exact: true}).click();
    assert.equal(await page.locator('#journal-grid .entry-card').count(), 0, 'disconnecting preserves the prior deletion and its tombstone');

    connectionMode = 'failure';
    await page.locator('#open-connect').click();
    await page.locator('#connect-token').fill('fixturebadtoken');
    await page.locator('#connect-submit').click();
    await page.locator('#connect-status').filter({hasText: '连接未完成，请检查 Token。'}).waitFor();
    assert.equal(await page.locator('#connect-dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#connect-token').inputValue(), '');
    assert.equal(await page.locator('#connect-status').innerText(), '连接未完成，请检查 Token。');
    assert.equal(await page.locator('#count-visits').innerText(), '0');
    assert.equal(await page.locator('#wishlist-count').innerText(), '1');
    assert.deepEqual(connectRequests[1], {token: 'fixturebadtoken'});
    assert.doesNotMatch(await page.locator('#connect-status').innerText(), /fixturebadtoken/);

    await page.setViewportSize({width: 390, height: 844});
    const modalBounds = await page.locator('#connect-dialog').evaluate(dialog => ({scroll: dialog.scrollWidth, client: dialog.clientWidth}));
    assert.ok(modalBounds.scroll <= modalBounds.client + 1, 'mobile connection modal must not overflow horizontally');
    await page.locator('[data-close="connect-dialog"]').click();
    assert.deepEqual(errors, []);
    await context.close();

    const fallbackContext = await browser.newContext({viewport: {width: 390, height: 844}, timezoneId: 'Asia/Shanghai'});
    const fallback = await fallbackContext.newPage();
    fallback.on('pageerror', error => errors.push(error.message));
    await fallback.route('**/api/health', route => route.fulfill({status: 404, json: {error: 'fixture unavailable'}}));
    await fallback.goto(base);
    await fallback.locator('#open-connect').click();
    assert.equal(await fallback.locator('#connect-submit').isDisabled(), true, 'connection must be unavailable when health returns 404');
    await fallback.locator('[data-close="connect-dialog"]').click();
    await fallback.getByRole('button', {name: '新增打卡', exact: true}).click();
    assert.equal(await fallback.locator('#entry-dialog').evaluate(dialog => dialog.open), true, 'manual journal entry must still be available without the connection API');
    const fallbackBounds = await fallback.locator('#entry-dialog').evaluate(dialog => ({scroll: dialog.scrollWidth, client: dialog.clientWidth}));
    assert.ok(fallbackBounds.scroll <= fallbackBounds.client + 1, 'mobile journal dialog must not overflow horizontally');
    assert.deepEqual(errors, []);
    await fallbackContext.close();
    console.log('PASS: local Token connection request/clearing, automatic order materialization and deduplication, deletion tombstone across reload/load/sync, sync pending/success/failure with province filter, wishlist retention, disconnect and health fallback, and mobile dialogs. API responses are synthetic; no official service is contacted.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
