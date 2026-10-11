'use strict';
// Run in an isolated cloud environment with the user's injected MCP credential.
// This test reads official orders through the deployed UI. It emits aggregate
// results only; no tracing, screenshots, exported orders or persistent profile.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base='https://mcd-china-map.onrender.com/';
let phase='cloud-credential',browser;
const result={url:base,viewport:{width:390,height:844},realOrderTest:true};
function check(value,message){if(!value)throw new Error(message);}

async function main(){
  check(process.platform!=='win32' && process.env.LIVE_ORDER_TEST_CLOUD==='1','CLOUD_ENVIRONMENT_REQUIRED');
  const variable=process.env.MCD_TOKEN_VARIABLE || 'MCD_MCP_TOKEN';
  check(/^[A-Z][A-Z0-9_]*$/.test(variable),'INVALID_CREDENTIAL_VARIABLE');
  const token=(process.env[variable] || '').trim();
  check(token && !token.startsWith('${'),'INJECTED_MCP_TOKEN_REQUIRED');
  phase='browser';
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:result.viewport,isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
  const page=await context.newPage();
  let pageErrors=0;
  page.on('pageerror',()=>{pageErrors++;});
  phase='service-wakeup';
  const wakeDeadline=Date.now()+180000;
  let ready=false;
  while(Date.now()<wakeDeadline){
    try{
      const health=await context.request.get(base+'api/health',{timeout:20000});
      result.healthStatus=health.status();
      const payload=await health.json().catch(()=>null);
      if(health.ok() && payload?.project==='mcd-china-map' && payload.capabilities?.connect){ready=true;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  check(ready,'SERVICE_DID_NOT_WAKE');
  phase='open';
  result.pageStatus=(await page.goto(base,{timeout:120000})).status();
  check(result.pageStatus===200,'PAGE_UNAVAILABLE');
  await page.waitForFunction(()=>document.getElementById('connection-state').textContent.includes('手账已准备好'));
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');
  phase='connect';
  await page.locator('#open-connect').tap();
  await page.locator('#connect-token').fill(token);
  const [connection]=await Promise.all([
    page.waitForResponse(r=>r.url()===base+'api/connect' && r.request().method()==='POST',{timeout:180000}),
    page.locator('#connect-submit').tap()
  ]);
  result.connectStatus=connection.status();
  check(connection.ok(),'REAL_CONNECTION_FAILED');
  const state=await connection.json();
  check(state.connected && state.order_sync,'ORDER_ACCESS_NOT_AVAILABLE');
  await page.locator('#connect-dialog').waitFor({state:'hidden'});
  check((await page.locator('#connect-token').inputValue())==='','TOKEN_FIELD_NOT_CLEARED');
  phase='sync';
  const [sync]=await Promise.all([
    page.waitForResponse(r=>r.url()===base+'api/sync-orders' && r.request().method()==='POST',{timeout:300000}),
    page.locator('#sync-orders').tap()
  ]);
  result.syncStatus=sync.status();
  check(sync.ok(),'REAL_SYNC_FAILED');
  const payload=await sync.json(),entries=payload.archive?.entries;
  check(Array.isArray(entries),'ORDER_ARCHIVE_MISSING');
  result.completedOrders=entries.length;
  check(entries.length>0,'NO_COMPLETED_ORDERS_TO_VERIFY_FOOTPRINTS');
  await page.waitForFunction(n=>Number(document.getElementById('count-visits').textContent)===n,entries.length);
  check(await page.locator('#pane-journal').isVisible(),'JOURNAL_NOT_OPENED');
  const journal=await page.locator('#pane-journal').innerText();
  check(entries.every(e=>typeof e.store==='string' && journal.includes(e.store)),'ORDER_STORE_NOT_RENDERED');
  const displayedFoods=await page.locator('#journal-grid .food-tags span').allTextContents();
  const expectedFoods=entries.flatMap(e=>e.foods || []);
  result.orderFoods=expectedFoods.length;result.displayedFoodTags=displayedFoods.length;
  check(expectedFoods.every(food=>displayedFoods.includes(food.trim())),'ORDER_FOODS_NOT_RENDERED');
  result.journalMatchesOrders=true;
  phase='footprints';
  await page.locator('#tab-map').tap();
  result.locatedFootprintGroups=await page.locator('#map-points .map-point').count();
  result.provinces=Number(await page.locator('#count-countries').innerText());
  check(result.locatedFootprintGroups>0,'SYNCED_ORDERS_HAVE_NO_MAPPABLE_LOCATION');
  await page.locator('#open-share').tap();
  await page.waitForFunction(()=>!!document.querySelector('#share-preview canvas') && !document.getElementById('save-share').disabled);
  check(await page.locator('#share-preview canvas').evaluate(c=>c.width>0 && c.height>0),'FOOTPRINT_CARD_NOT_GENERATED');
  result.footprintCardGenerated=true;
  await page.locator('[data-close="share-dialog"]').tap();
  phase='reload';
  await page.reload({timeout:120000});
  await page.locator('#disconnect-mcd').waitFor({state:'visible'});
  check(Number(await page.locator('#count-visits').innerText())===entries.length,'JOURNAL_NOT_PRESERVED');
  result.connectionAndJournalSurviveReload=true;
  phase='cached-orders';
  await page.locator('#load-orders').tap();
  await page.waitForFunction(()=>!document.getElementById('load-orders').disabled);
  check(Number(await page.locator('#count-visits').innerText())===entries.length,'CACHED_IMPORT_DUPLICATED_ORDERS');
  result.cachedImportDoesNotDuplicate=true;
  phase='isolation';
  const other=await browser.newContext({viewport:result.viewport,isMobile:true,hasTouch:true});
  const unauthorized=await other.request.get(base+'api/synced-orders');
  result.otherBrowserOrdersStatus=unauthorized.status();
  check(unauthorized.status()===401,'ORDER_SESSION_ISOLATION_FAILED');
  check(pageErrors===0,'BROWSER_SCRIPT_ERROR');
  result.pageErrors=pageErrors;
  phase='disconnect';
  await page.locator('#disconnect-mcd').tap();
  await page.locator('#disconnect-mcd').waitFor({state:'hidden'});
  check((await context.request.get(base+'api/synced-orders')).status()===401,'DISCONNECT_FAILED');
  check(Number(await page.locator('#count-visits').innerText())===entries.length,'DISCONNECT_REMOVED_JOURNAL');
  result.disconnectPreservesJournal=true;
  result.status='passed';
}

main().catch(error=>{
  // Playwright call logs can contain input values. Never print the error/stack.
  result.status='failed';result.phase=phase;
  result.reason=/^[A-Z_]+$/.test(error.message)?error.message:'OPERATION_FAILED';
  process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  console.log(JSON.stringify(result));
});
