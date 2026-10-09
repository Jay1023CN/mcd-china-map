'use strict';
// Only synthetic fixtures in a fresh browser context; never use a personal profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const url = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765/';
const output = path.join(root, 'test-results');
fs.mkdirSync(output, {recursive: true});
const candidate = {version: 1, data_kind: 'mcp', source: 'Synthetic test fixture, never a real order.', entries: [{id: 'mcp-fixture-only', date: '2026-10-08', country_code: 'CN', city: '', store: '测试门店（虚构）', foods: ['咖啡'], source: 'mcp_candidate', confirmed: false}]};
const upload = (name, value) => ({name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))});
function request(target, method = 'GET', host = new URL(url).host) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {path: target, method, headers: {Host: host}}, response => {
      let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; });
      response.on('end', () => resolve({status: response.statusCode, bytes}));
    });
    req.on('error', reject); req.end();
  });
}
async function main() {
  assert.equal((await request('/')).status, 200);
  assert.deepEqual(await request('/index.html', 'HEAD'), {status: 200, bytes: 0});
  for (const target of ['/private/mcp/global-candidates.json', '/.env', '/assets/../README.md', '/assets/%2e%2e/README.md']) assert.equal((await request(target)).status, 404);
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal((await request('/', 'GET', 'localhost:8765')).status, 400);
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    assert.equal(await page.locator('#count-visits').innerText(), '0');
    await page.getByRole('button', {name: '新增打卡', exact: true}).click();
    await page.locator('[name=date]').fill('2026-10-08');
    await page.locator('[name=province_code]').selectOption('310000');
    await page.locator('[name=city]').fill('上海');
    await page.locator('[name=store]').fill('测试上海门店（虚构）');
    await page.locator('[name=foods]').fill('咖啡，薯条');
    await page.locator('[name=note]').fill('仅用于自动化验收。');
    const photoFixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
      const context = canvas.getContext('2d'); context.fillStyle = '#dd442e'; context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('[name=photo]').setInputFiles({name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(photoFixture, 'base64')});
    await page.locator('#photo-preview').waitFor({state: 'visible'});
    await page.locator('[name=confirmed]').check();
    await page.getByRole('button', {name: '保存这一页'}).click();
    assert.equal(await page.locator('#count-visits').innerText(), '1');
    await page.reload();
    assert.equal(await page.locator('#count-visits').innerText(), '1');
    await page.getByRole('tab', {name: '打卡手账', exact: true}).click();
    await page.getByRole('button', {name: '编辑这一页', exact: true}).click();
    await page.locator('[name=note]').fill('编辑后的测试随记。');
    await page.getByRole('button', {name: '保存这一页'}).click();
    assert.equal(await page.locator('#journal-grid .note').innerText(), '编辑后的测试随记。');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.entries.length, 1);
    assert.equal(backup.entries[0].country_code, 'CN');
    assert.equal(backup.entries[0].province_code, '310000');
    assert.equal(backup.entries[0].location.precision, 'city');
    assert.ok(backup.entries[0].photo.data_url.startsWith('data:image/jpeg;base64,'));
    await page.locator('#import-file').setInputFiles(upload('fixture-candidate.json', candidate));
    await page.locator('#candidate-grid .candidate').waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '1');
    await page.getByRole('button', {name: '补齐并确认本人到店'}).click();
    assert.equal(await page.locator('[name=country_code]').isDisabled(), true);
    await page.locator('[name=province_code]').selectOption('110000');
    await page.locator('[name=city]').fill('北京');
    await page.locator('[name=confirmed]').check();
    await page.getByRole('button', {name: '保存这一页'}).click();
    assert.equal(await page.locator('#count-visits').innerText(), '2');
    assert.equal(await page.locator('#candidate-count').innerText(), '0');
    assert.equal(await page.locator('#count-countries').innerText(), '2');
    await page.locator('#country-filter').selectOption('310000');
    assert.equal(await page.locator('#count-visits').innerText(), '1');
    await page.locator('#country-filter').selectOption('');
    await page.locator('#import-file').setInputFiles(upload('same-candidate.json', candidate));
    await page.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '2');
    assert.equal(await page.locator('#candidate-count').innerText(), '0');
    const conflict = {...backup, entries: [{...backup.entries[0], store: 'conflicting fixture'}]};
    await page.locator('#import-file').setInputFiles(upload('synthetic.json', {...backup, data_kind: 'synthetic'}));
    await page.locator('#toast').filter({hasText: '导入未完成'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '2');
    await page.locator('#import-file').setInputFiles(upload('conflict.json', conflict));
    await page.locator('#toast').filter({hasText: '导入未完成'}).waitFor();
    assert.equal(await page.locator('#count-visits').innerText(), '2');
    const restoreContext = await browser.newContext({timezoneId: 'Asia/Shanghai'});
    const restored = await restoreContext.newPage();
    await restored.goto(url);
    await restored.locator('#import-file').setInputFiles(upload('backup.json', backup));
    await restored.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    assert.equal(await restored.locator('#count-visits').innerText(), '1');
    await restored.getByRole('tab', {name: '打卡手账', exact: true}).click();
    restored.once('dialog', dialog => dialog.accept());
    await restored.getByRole('button', {name: '删除', exact: true}).click();
    assert.equal(await restored.locator('#count-visits').innerText(), '0');
    await restored.reload();
    assert.equal(await restored.locator('#count-visits').innerText(), '0');
    await restoreContext.close();
    const legacyContext=await browser.newContext({timezoneId:'Asia/Shanghai'});
    await legacyContext.addInitScript(value => {localStorage.setItem('mcd-world-passport-personal-v1',JSON.stringify(value));},backup);
    const legacyPage=await legacyContext.newPage();await legacyPage.goto(url);
    assert.equal(await legacyPage.locator('#count-visits').innerText(),'1');
    await legacyPage.getByRole('tab',{name:'打卡手账',exact:true}).click();
    assert.equal(await legacyPage.locator('#journal-grid .note').innerText(),'编辑后的测试随记。');
    await legacyContext.close();
    const limitedContext = await browser.newContext({timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    await limitedContext.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('Synthetic quota fixture', 'QuotaExceededError'); };
    });
    const limited = await limitedContext.newPage();
    await limited.goto(url);
    await limited.locator('#import-file').setInputFiles(upload('quota-backup.json', backup));
    await limited.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    assert.match(await limited.locator('#save-status').innerText(), /请导出备份/);
    const limitedDownload = limited.waitForEvent('download');
    await limited.locator('#export').click();
    const emergency = JSON.parse(fs.readFileSync(await (await limitedDownload).path(), 'utf8'));
    assert.equal(emergency.entries[0].note, '编辑后的测试随记。');
    assert.ok(emergency.entries[0].photo.data_url);
    await limitedContext.close();
    const storeContext = await browser.newContext({timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    const storePage = await storeContext.newPage();
    await storePage.route('**/api/health', route => route.fulfill({json:{store_lookup:true}}));
    await storePage.route('**/api/stores', route => {
      assert.deepEqual(route.request().postDataJSON(), {city:'上海',keyword:'测试地标',be_type:1});
      return route.fulfill({json:{stores:[{name:'官方门店查询测试（虚构）',code:'fixture-store',address:'虚构街道',city:'上海',business_status:true,hours:'07:00–23:00'}]}});
    });
    await storePage.goto(url);
    await storePage.locator('#store-search summary').click();
    await storePage.locator('[name=search_city]').fill('上海');
    await storePage.locator('[name=search_keyword]').fill('测试地标');
    await storePage.locator('#search-stores').click();
    await storePage.getByRole('button',{name:'在这里留一页打卡'}).click();
    assert.equal(await storePage.locator('[name=province_code]').inputValue(),'310000');
    assert.equal(await storePage.locator('[name=store]').inputValue(),'官方门店查询测试（虚构）');
    await storePage.locator('[name=confirmed]').check();
    await storePage.getByRole('button',{name:'保存这一页'}).click();
    const storeDownload = storePage.waitForEvent('download'); await storePage.locator('#export').click();
    const storeBackup = JSON.parse(fs.readFileSync(await (await storeDownload).path(),'utf8'));
    assert.deepEqual(storeBackup.entries[0].store_reference,{source:'mcp_nearby',code:'fixture-store',address:'虚构街道'});
    await storePage.getByRole('button',{name:'编辑这一页',exact:true}).click();
    await storePage.locator('[name=store]').fill('手动修改的门店');
    await storePage.getByRole('button',{name:'保存这一页'}).click();
    const editedDownload=storePage.waitForEvent('download');await storePage.locator('#export').click();
    const editedBackup=JSON.parse(fs.readFileSync(await (await editedDownload).path(),'utf8'));
    assert.equal('store_reference' in editedBackup.entries[0],false);
    await storeContext.close();
    const photoContext = await browser.newContext({timezoneId: 'Asia/Shanghai', acceptDownloads: true});
    await photoContext.route('https://example.com/**', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#dd442e"/></svg>'
    }));
    const photoPage = await photoContext.newPage();
    const defaultPhotoUrl = 'https://example.com/store.jpg';
    const defaultPhotoCandidate = {
      ...candidate,
      entries: [{...candidate.entries[0], id: 'mcp-photo-fixture', province_code: '310000', city: '上海', store: '默认照片测试门店（虚构）', default_photo: {
        url: defaultPhotoUrl,
        source_url: 'https://example.com/photo-source',
        attribution: '虚构照片来源署名',
        caption: '虚构门店环境照'
      }}]
    };
    await photoPage.goto(url);
    await photoPage.locator('#import-file').setInputFiles(upload('synthetic-photo-candidate.json', defaultPhotoCandidate));
    await photoPage.locator('#candidate-grid .candidate img.photo').waitFor({state: 'visible'});
    assert.equal(await photoPage.locator('#candidate-grid .candidate img.photo').getAttribute('src'), defaultPhotoUrl);
    await photoPage.getByRole('button', {name: '补齐并确认本人到店'}).click();
    assert.equal(await photoPage.locator('#photo-preview').getAttribute('src'), defaultPhotoUrl);
    await photoPage.locator('[name=photo]').setInputFiles({name: 'user-fixture.png', mimeType: 'image/png', buffer: Buffer.from(photoFixture, 'base64')});
    await photoPage.locator('#photo-preview').waitFor({state: 'visible'});
    assert.match(await photoPage.locator('#photo-preview').getAttribute('src'), /^data:image\/jpeg;base64,/);
    await photoPage.locator('[name=confirmed]').check();
    await photoPage.getByRole('button', {name: '保存这一页'}).click();
    await photoPage.getByRole('tab', {name: '打卡手账', exact: true}).click();
    assert.match(await photoPage.locator('#journal-grid .entry-card img.photo').getAttribute('src'), /^data:image\/jpeg;base64,/);
    await photoPage.getByRole('button', {name: '编辑这一页', exact: true}).click();
    await photoPage.locator('#remove-photo').click();
    assert.equal(await photoPage.locator('#photo-preview').getAttribute('src'), defaultPhotoUrl);
    await photoPage.getByRole('button', {name: '保存这一页'}).click();
    assert.equal(await photoPage.locator('#journal-grid .entry-card img.photo').getAttribute('src'), defaultPhotoUrl);
    await photoPage.getByRole('button', {name: '翻开', exact: true}).click();
    assert.equal(await photoPage.locator('#detail-body img.photo').getAttribute('src'), defaultPhotoUrl);
    await photoPage.locator('[data-close="detail-dialog"]').click();
    const photoDownload = photoPage.waitForEvent('download');
    await photoPage.locator('#export').click();
    const photoBackup = JSON.parse(fs.readFileSync(await (await photoDownload).path(), 'utf8'));
    assert.equal(photoBackup.entries[0].photo, undefined);
    assert.deepEqual(photoBackup.entries[0].default_photo, defaultPhotoCandidate.entries[0].default_photo);
    await photoPage.evaluate(() => localStorage.clear());
    await photoPage.reload();
    await photoPage.locator('#import-file').setInputFiles(upload('default-photo-backup.json', photoBackup));
    await photoPage.locator('#toast').filter({hasText: '导入完成'}).waitFor();
    await photoPage.getByRole('tab', {name: '打卡手账', exact: true}).click();
    assert.equal(await photoPage.locator('#journal-grid .entry-card img.photo').getAttribute('src'), defaultPhotoUrl);
    await photoContext.close();
    // Capture only the explicitly synthetic public demo.
    await page.goto(url + 'docs/china-demo.html');
    await page.locator('#mode-description').filter({hasText: '示例手账'}).waitFor();
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
    const width = await page.evaluate(() => ({content: document.documentElement.scrollWidth, viewport: innerWidth}));
    assert.ok(width.content <= width.viewport, 'mobile content must fit viewport');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: China map, province filters, official store selection, reference clearing, legacy China migration, create/edit/reload/delete, photo export/restore, candidates/reimport, conflict rejection, desktop/mobile. All fixtures synthetic.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
