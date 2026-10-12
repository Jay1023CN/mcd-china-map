'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.APP_URL || 'https://mcd-collections.test/china-map/';
const captureDir=path.resolve(process.env.COLLECTIONS_CAPTURE_DIR || 'docs');
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai',acceptDownloads:true});
  try{
    if(!process.env.APP_URL){
      const root=path.resolve(process.env.STATIC_WEB_ROOT || 'dist/web');
      await context.route('**/*',route=>{
        const url=new URL(route.request().url()),prefix=new URL(base);
        if(url.origin!==prefix.origin || !url.pathname.startsWith(prefix.pathname))return route.abort();
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.pathname.length)) || 'index.html');
        if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
        const mime={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
      });
    }
    await context.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.collectionCopy=text;}}});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
      Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.collectionShare={text:payload.text,files:payload.files.map(file=>({name:file.name,type:file.type,size:file.size}))};}});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    if(process.env.CAPTURE_COLLECTIONS)fs.mkdirSync(captureDir,{recursive:true});
    await page.goto(base);assert.equal(await page.locator('#city-album-list .city-album').count(),0);
    if(process.env.APP_URL){
      assert.ok(process.env.EXPECTED_COMMIT,'EXPECTED_COMMIT is required when checking the public app');
      const buildInfo=await context.request.get(new URL('build-info.json',base).href,{timeout:120000});
      assert.equal(buildInfo.status(),200,'the deployed app should expose build-info.json');
      assert.equal((await buildInfo.json()).commit,process.env.EXPECTED_COMMIT,'the city album acceptance must run against the exact deployed commit');
    }
    const seed=await page.evaluate(()=>{
      const data=JSON.parse(document.getElementById('journal-data').textContent);if(data.archive.entries.length)throw new Error('blank public build required');
      const day=new Date().toLocaleDateString('sv-SE'),month=day.slice(0,7),previous=new Date(day+'T12:00:00');previous.setDate(1);previous.setMonth(previous.getMonth()-1);
      const prior=previous.toLocaleDateString('sv-SE');
      const stores=['上海','杭州','天津'].map(city=>data.stores.find(store=>store.city===city));
      const row=(id,store,date,foods)=>({id,date,country_code:'CN',province_code:store.province_code,city:store.city,store:store.name,foods,note:'功能演示：照片与公开门店资料；这段手账为演示记录。',source:'manual',confirmed:true,default_photo:store.default_photo});
      const entries=[row('collection-sh-1',stores[0],day,['薯条','薯条（大份） · 无糖可口可乐大杯']),row('collection-sh-2',stores[0],month+'-01',['鲜萃咖啡']),row('collection-hz',stores[1],day,['薯条']),row('collection-tj',stores[2],prior,['汉堡'])];
      localStorage.setItem('mcd-china-map-personal-v1',JSON.stringify({version:1,data_kind:'manual',entries,wishlist:WishlistEngine.add([],{...stores[1],source:'manual',code:'catalog:'+stores[1].name})}));return {month,prior:prior.slice(0,7),stores};
    });
    const monthLabel=seed.month.replace(/^(\d{4})-(\d{2})$/,'$1年$2月'),priorMonthLabel=seed.prior.replace(/^(\d{4})-(\d{2})$/,'$1年$2月');
    await page.reload();await page.locator('#tab-journal').click();assert.equal(await page.locator('#city-album-list .city-album').count(),3);
    await page.locator('.city-album').filter({hasText:'上海'}).click();assert.equal(await page.locator('#collection-grid .collection-page').count(),2);
    await page.locator('#collection-grid img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await page.evaluate(()=>document.fonts.ready);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.CAPTURE_COLLECTIONS)await page.locator('#collection-dialog').screenshot({path:path.join(captureDir,'city-album-preview.png')});
    await page.locator('#collection-grid .collection-page').first().click();
    const nav=new URL(await page.locator('#detail-body .store-navigation a').getAttribute('href'));
    assert.equal(nav.searchParams.get('city'),'上海');assert.ok(nav.searchParams.get('keyword').includes(seed.stores[0].address));assert.equal(nav.searchParams.has('center'),false);
    await page.locator('#detail-body .store-navigation button').click();assert.ok((await page.evaluate(()=>window.collectionCopy)).includes(seed.stores[0].name));
    await page.getByRole('button',{name:'回到城市回忆册',exact:true}).click();
    await page.locator('#collection-grid .collection-page').first().click();
    await page.locator('#detail-body').getByRole('button',{name:'编辑这一页',exact:true}).click();
    await page.locator('#save-entry').click();
    await page.locator('#collection-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#collection-grid .collection-page').count(),2,'saving an album page returns to that album');
    await page.locator('#collection-clear-pages').click();assert.equal(await page.locator('#collection-share').isDisabled(),true);
    await page.locator('.collection-pick input[data-entry-id="collection-sh-2"]').check();
    await page.locator('#collection-cover').selectOption('collection-sh-2');await page.locator('#collection-caption').fill('演示：和朋友沿街散步，顺路吃一顿麦。');
    await page.locator('#collection-share').click();await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    const cityCardSize=await page.locator('#share-image').evaluate(async image=>{await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};});
    assert.deepEqual(cityCardSize,{width:1080,height:1132},'the actual city-album share preview should be a rendered multi-entry PNG');
    await page.locator('#copy-share').click();const cityText=await page.evaluate(()=>window.collectionCopy);
    assert.match(cityText,/选了 1 页 · 这座城共有 2 页回忆/);assert.match(cityText,/咖啡/);assert.ok(!cityText.includes('薯条'));
    await page.locator('#share-cities').uncheck();await page.locator('#share-note').uncheck();await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    await page.locator('#copy-share').click();const hiddenCityText=await page.evaluate(()=>window.collectionCopy);assert.ok(!hiddenCityText.includes('上海'));assert.ok(!hiddenCityText.includes('功能演示：'));
    await page.locator('#share-cities').check();await page.locator('#share-note').check();await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    const cityDownload=page.waitForEvent('download');await page.locator('#save-share').click();const cityFile=await cityDownload;
    const cityPng=fs.readFileSync(await cityFile.path());assert.equal(cityPng.readUInt32BE(16),1080);assert.equal(cityPng.readUInt32BE(20),1132);
    if(process.env.CAPTURE_COLLECTIONS)fs.writeFileSync(path.join(captureDir,'city-album-card-preview.png'),cityPng);
    await page.locator('#share-collection-back').click();assert.equal(await page.locator('.collection-pick input:checked').count(),1);
    await page.locator('#collection-switch').selectOption({label:'杭州 · 浙江省'});assert.equal(await page.locator('#collection-grid .collection-page').count(),1);
    await page.locator('[data-close=collection-dialog]').click();
    await page.locator('.month-chip').filter({hasText:monthLabel}).click();
    assert.match(await page.locator('#collection-summary').innerText(),/3 页回忆 · 2 座城市 · 2 家麦当劳/);
    assert.match(await page.locator('#collection-tastes').innerText(),/薯条 × 2/);
    await page.locator('#collection-cover').selectOption('collection-sh-1');
    await page.locator('#collection-photo-1').selectOption('collection-hz');await page.locator('#collection-photo-2').selectOption('collection-sh-2');
    await page.locator('#collection-photo-0').selectOption('collection-hz');
    assert.equal(await page.locator('#collection-photo-1').inputValue(),'collection-sh-1','selecting an already chosen photo swaps its slot');
    await page.locator('#collection-layout').selectOption('feature');await page.locator('#collection-caption').fill('演示：这个月，吃麦的理由是和朋友见面。');
    await page.locator('#collection-share').click();await page.locator('#save-share').waitFor();
    await page.waitForFunction(()=>!document.getElementById('save-share').disabled);await page.locator('#share-image').evaluate(image=>image.decode());
    await page.locator('#copy-share').click();const copy=await page.evaluate(()=>window.collectionCopy);
    assert.match(copy,/3 页回忆 \/ 2 座城市 \/ 2 家麦当劳/);assert.match(copy,/上海/);assert.ok(!copy.includes(seed.stores[0].address));
    assert.match(copy,/和朋友见面/);
    await page.locator('#share-cities').uncheck();await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    await page.locator('#copy-share').click();assert.ok(!(await page.evaluate(()=>window.collectionCopy)).includes('上海'));
    await page.locator('#share-cities').check();await page.waitForFunction(()=>!document.getElementById('save-share').disabled);
    const downloading=page.waitForEvent('download');await page.locator('#save-share').click();const download=await downloading;
    const png=fs.readFileSync(await download.path());assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1440);assert.ok(png.length>20000);
    if(process.env.CAPTURE_COLLECTIONS)fs.writeFileSync(path.join(captureDir,'monthly-newspaper-preview.png'),png);
    await page.locator('#native-share').click();const share=await page.evaluate(()=>window.collectionShare);
    assert.equal(share.files[0].type,'image/png');assert.match(share.files[0].name,/麦麦月度小报/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#share-collection-back').click();assert.equal(await page.locator('#collection-cover').inputValue(),'collection-hz');await page.locator('[data-close=collection-dialog]').click();
    await page.locator('.month-chip').filter({hasText:priorMonthLabel}).click();assert.match(await page.locator('#collection-summary').innerText(),/1 页回忆 · 1 座城市 · 1 家麦当劳/);
    await page.locator('[data-close=collection-dialog]').click();await page.locator('#year-filter').selectOption(seed.month.slice(0,4));
    await page.locator('#country-filter').selectOption('310000');assert.equal(await page.locator('.city-album').count(),1);
    await page.locator('#tab-wishlist').click();await page.locator('.wishlist-directions summary').click();assert.equal(await page.locator('#wishlist-grid .store-navigation a').count(),1);
    await page.reload();await page.locator('#tab-journal').click();assert.equal(await page.locator('.city-album').count(),3);assert.equal(await page.locator('#count-visits').innerText(),'4');
    await page.locator('.city-album').filter({hasText:'上海'}).click();assert.equal(await page.locator('#collection-cover').inputValue(),'collection-sh-2');assert.equal(await page.locator('.collection-pick input:checked').count(),1);
    assert.match(await page.locator('#collection-caption').inputValue(),/沿街散步/);await page.locator('[data-close=collection-dialog]').click();
    await page.locator('.month-chip').filter({hasText:monthLabel}).click();assert.equal(await page.locator('#collection-layout').inputValue(),'feature');assert.equal(await page.locator('#collection-photo-0').inputValue(),'collection-hz');
    assert.match(await page.locator('#collection-caption').inputValue(),/和朋友见面/);
    await page.locator('[data-close=collection-dialog]').click();
    const [archiveFile]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);
    const exported=JSON.parse(fs.readFileSync(await archiveFile.path(),'utf8'));assert.equal(exported.collection_preferences.length,2);
    const restored=await context.newPage();await restored.goto(base);await restored.evaluate(()=>localStorage.removeItem('mcd-china-map-personal-v1'));await restored.reload();
    await restored.locator('#import-file').setInputFiles({name:'album-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await restored.locator('#toast').filter({hasText:'导入完成'}).waitFor();
    await restored.locator('.month-chip').filter({hasText:monthLabel}).click();assert.equal(await restored.locator('#collection-layout').inputValue(),'feature');assert.equal(await restored.locator('#collection-photo-0').inputValue(),'collection-hz');
    await restored.close();
    const foodCityPreview=await page.evaluate(async()=>{
      const data=JSON.parse(document.getElementById('journal-data').textContent),archive=JSON.parse(localStorage.getItem('mcd-china-map-personal-v1'));
      const source=archive.entries.find(entry=>entry.city==='上海'),foods=[
        '薯条（大份） · 无糖可口可乐大杯','鲜萃咖啡','巨无霸单人餐','奥利奥麦旋风','麦辣鸡腿堡','麦乐鸡（10块）'
      ];
      const rows=foods.map((food,index)=>{const row={...source,id:'city-food-preview-'+index,date:'2026-09-'+String(16-index).padStart(2,'0'),store:'上海虚构门店',foods:[food],note:'虚构手账：和朋友吃完，沿街散步。'};delete row.photo;delete row.default_photo;return row;});
      const menu=MealCatalog.create(data.meal_catalog),foodImages=[];
      for(const entry of rows)for(const item of menu.matchFoods(entry.foods)){
        const sourceUrl=item.image_data_url || item.image_url;if(!sourceUrl)continue;
        let dataUrl=sourceUrl;
        if(!/^data:image\//.test(sourceUrl)){
          const response=await fetch(new URL(sourceUrl,location.href));if(!response.ok)throw new Error('meal image fetch failed: '+sourceUrl);
          const blob=await response.blob();dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        }
        const image=new Image();image.src=dataUrl;await image.decode();foodImages.push({entryId:entry.id,name:item.order_name || item.name,dataUrl,naturalWidth:image.naturalWidth});
      }
      const city=JournalCollections.build(rows).cities[0],canvas=await JournalCollections.renderCity(city,{selectedIds:rows.map(row=>row.id),title:'上海六餐，一城一页',caption:'同一家店，几次不同的停靠。',includeCities:true,includeNote:true,photos:[],foodImages});
      return {width:canvas.width,height:canvas.height,foodNames:foodImages.map(item=>item.name),naturalWidths:foodImages.map(item=>item.naturalWidth),png:canvas.toDataURL('image/png'),personalPhotos:rows.filter(row=>row.photo).length};
    });
    assert.equal(foodCityPreview.personalPhotos,0,'the showcase city album must contain no personal photos');
    assert.ok(foodCityPreview.foodNames.some(name=>name.includes('薯条'))&&foodCityPreview.foodNames.some(name=>name.includes('无糖可口可乐')),'long order text should resolve to separate, accurately named product images');
    assert.ok(foodCityPreview.naturalWidths.length>=6&&foodCityPreview.naturalWidths.every(width=>width>0),'each selected menu image should load before rendering');
    assert.equal(foodCityPreview.width,1080);assert.equal(foodCityPreview.height,2092,'six same-store pages should appear under one store heading');
    const foodCityPng=Buffer.from(foodCityPreview.png.split(',')[1],'base64');assert.deepEqual([...foodCityPng.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(foodCityPng.length>20000);
    if(process.env.CAPTURE_COLLECTIONS)fs.writeFileSync(path.join(captureDir,'city-album-foods-preview.png'),foodCityPng);
    const canvasCases=await page.evaluate(async()=>{
      const archive=JSON.parse(localStorage.getItem('mcd-china-map-personal-v1'));
      const base=archive.entries.find(entry=>entry.city==='上海');
      const rows=Array.from({length:12},(_,index)=>({...base,id:'canvas-case-'+index,note:'长句随记。'.repeat(18)}));
      const city=JournalCollections.build(rows).cities[0];const result=[];
      for(const count of [1,3,12]){
        const canvas=await JournalCollections.renderCity(city,{selectedIds:rows.slice(0,count).map(row=>row.id),title:'一座城里的十二页麦麦回忆',caption:'字'.repeat(140),includeCities:true,includeNote:true});
        result.push({count,width:canvas.width,height:canvas.height});
      }
      return result;
    });
    assert.deepEqual(canvasCases.map(item=>item.height),[1132,1612,3532]);assert.ok(canvasCases.every(item=>item.width===1080 && item.width*item.height<5000000));
    assert.deepEqual(errors,[]);console.log('PASS: mobile city albums/detail/back/selected-page PNG, no-personal-photo six-page city PNG with matched food images, long meal labels, monthly photo order swaps/layout/caption, sharing controls, settings refresh/backup restore, 1/3/12-page geometry, address navigation and filters.');
  }catch(error){
    fs.mkdirSync('test-results',{recursive:true});const failed=context.pages()[0];
    if(failed){await failed.screenshot({path:'test-results/collections-failure.png'}).catch(()=>{});console.error('Collection browser failure state:',await failed.locator('#toast').textContent().catch(()=>''));}
    throw error;
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
