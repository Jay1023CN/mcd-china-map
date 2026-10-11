'use strict';
// PLAYWRIGHT_MODULE may point to the locally installed Playwright package.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const work = path.join(root, 'private/readme-render');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  try {
    for (const board of JSON.parse(fs.readFileSync(path.join(work,'manifest.json'),'utf8'))) {
      const page = await browser.newPage({viewport:{width:board.width,height:board.height},deviceScaleFactor:1.5});
      await page.goto(pathToFileURL(path.join(work,board.name+'.svg')).href);
      await page.locator('svg').first().screenshot({path:path.join(__dirname,board.name+'.png')});
      console.log(board.name+'.png');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
