'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
async function main() {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent(`<form id="connect-form"><a id="connect-official-login" target="_blank" rel="noopener noreferrer">去麦当劳登录</a><button id="connect-paste" type="button">粘贴并连接</button><details id="connect-manual"><summary>手动粘贴</summary><input id="connect-token" name="token" required><button id="connect-submit" type="submit">连接我的订单</button></details><p id="connect-status" role="status"></p></form>`);
    await page.addScriptTag({path:path.join(__dirname,'../web/connection-onboarding.js')});
    await page.evaluate(() => {
      window.submitted = [];
      window.readCount = 0;
      window.clipboardMode = 'reject';
      window.syntheticValue = 'synthetic-connection-value-only';
      window.onboarding = McdConnectionOnboarding.mount({clipboard:{readText:async()=>{
        window.readCount++;
        if (window.clipboardMode === 'reject') throw new Error('denied');
        return JSON.stringify({mcpServers:{mcd:{url:'https://mcp.mcd.cn',headers:{Authorization:'Bearer '+window.syntheticValue}}}});
      }}});
      document.getElementById('connect-form').addEventListener('submit',event=>{event.preventDefault();window.submitted.push(document.getElementById('connect-token').value);});
    });
    assert.equal(await page.evaluate(()=>window.readCount),0,'opening must not read the clipboard');
    assert.equal(await page.locator('#connect-official-login').getAttribute('href'),'https://open.mcd.cn/mcp/login');
    await page.locator('#connect-paste').click();
    assert.equal(await page.locator('#connect-manual').evaluate(el=>el.open),true);
    assert.match(await page.locator('#connect-status').innerText(),/长按.*粘贴/);
    assert.equal(await page.locator('#connect-token').evaluate(el=>el===document.activeElement),true);
    await page.locator('#connect-token').fill('Authorization: Bearer synthetic-connection-value-only');
    await page.locator('#connect-submit').click();
    assert.deepEqual(await page.evaluate(()=>window.submitted),['synthetic-connection-value-only']);
    await page.locator('#connect-token').fill('这不是连接码');
    await page.locator('#connect-submit').click();
    assert.equal(await page.evaluate(()=>window.submitted.length),1,'invalid paste cannot reach the API submit handler');
    await page.evaluate(()=>window.clipboardMode='ok');
    await page.locator('#connect-paste').click();
    assert.deepEqual(await page.evaluate(()=>window.submitted),['synthetic-connection-value-only','synthetic-connection-value-only']);
    assert.equal(await page.evaluate(()=>window.readCount),2);
    console.log('Mobile connection guidance, clipboard fallback and single-submit acceptance passed.');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
