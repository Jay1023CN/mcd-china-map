(function () {
  'use strict';
  const data = JSON.parse(document.getElementById('journal-data').textContent);
  const webSessions = data.runtime?.web_sessions === true;
  const localApi = webSessions || (data.runtime?.local_api !== false && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname));
  const E = window.JournalEngine;
  const W = window.WishlistEngine;
  const $ = id => document.getElementById(id);
  const names = new Map(data.countries.map(c => [c.code, c.name]));
  const countryName = code => names.get(code) || code;
  const provinces = data.provinces.features.filter(f => typeof f.properties.adcode === 'number');
  const provinceNames = new Map(provinces.map(f => [String(f.properties.adcode), f.properties.name]));
  const provinceName = code => provinceNames.get(code) || '';
  const placeName = entry => [provinceName(entry.province_code), entry.city].filter(Boolean).join(' · ') || '中国';
  let mapRegions = [];
  let selectedStore = null;
  let selectedWishlistId = null;
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const opts = () => ({today: today(), countries: data.countries});
  const guestKey = 'mcd-china-map-personal-v1';
  const accountStorageKey = 'mcd-china-map-last-account';
  let activeAccount = null;
  let lastAccount = null;
  try { if(webSessions)lastAccount=localStorage.getItem(accountStorageKey); } catch(error) {}
  if(!/^[a-f0-9]{32}$/.test(lastAccount || ''))lastAccount=null;
  let personalKey = lastAccount ? `${guestKey}-${lastAccount}` : guestKey;
  const demoKey = 'mcd-china-map-demo-v1';
  let key = data.archive.data_kind === 'synthetic' ? demoKey : personalKey;
  const materialize = value => window.OrderJournal.materialize(value, {cities: data.cities, stores: data.stores});
  const normalizedArchive = value => E.normalizeArchive(materialize(value), opts());
  let archive = normalizedArchive(data.archive);
  let storageBase = JSON.parse(JSON.stringify(archive));
  let persistent = false;
  let view = 'map';
  let currentSummary;
  let currentEntry = null;
  let photo = null;
  let defaultPhoto = null;
  let photoBusy = false;
  let photoRevision = 0;
  let mapPoints = [];
  let storeMapPoints = [];
  let nearbyStores = [];
  let toastTimer;
  const form = $('entry-form');
  const field = name => form.elements.namedItem(name);

  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function empty(title, message) {
    const el = node('div', undefined, 'empty');
    el.append(node('h3', title), node('p', message));
    return el;
  }
  function save() {
    try {
      const latest=localStorage.getItem(key);
      if(latest){
        const remote=normalizedArchive(JSON.parse(latest));
        if((key===demoKey)!==(remote.data_kind==='synthetic'))throw new Error('archive storage kind mismatch');
        archive=E.normalizeArchive(window.ArchiveMerge.merge(storageBase,archive,remote),opts());
      }
      localStorage.setItem(key, JSON.stringify(archive));
      storageBase=JSON.parse(JSON.stringify(archive));
      persistent = true;
    } catch (error) {
      persistent = false;
      toast('浏览器暂时无法保存。记录仍在本页，请立即导出 JSON 备份。');
    }
  }
  try {
    let stored = localStorage.getItem(key);
    if (!stored && key === personalKey) {
      const legacy = localStorage.getItem('mcd-world-passport-personal-v1');
      if (legacy) {
        const old = JSON.parse(legacy);
        if (old.entries?.every(e => e.country_code === 'CN')) stored = legacy;
        else toast('旧版手账仍保留。中国地图请导入中国记录的备份。');
      }
    }
    if (stored) {
      const prior = normalizedArchive(JSON.parse(stored));
      storageBase=JSON.parse(JSON.stringify(prior));
      if ((key === demoKey) !== (prior.data_kind === 'synthetic')) throw new Error('archive storage kind mismatch');
      if (archive.data_kind !== 'synthetic' && prior.data_kind !== 'synthetic') {
        const initialEntries = new Map(archive.entries.map(entry => [entry.id, entry]));
        prior.entries = prior.entries.map(entry => {
          const initial = initialEntries.get(entry.id);
          if (entry.origin !== 'mcp' || !initial || entry.store !== initial.store ||
              entry.city.replace(/市$/, '') !== initial.city.replace(/市$/, '')) return entry;
          return {...entry, ...(!entry.default_photo && initial.default_photo ? {default_photo:initial.default_photo} : {}),
            ...(!entry.province_code && initial.province_code ? {province_code:initial.province_code} : {})};
        });
        const ids = new Set(prior.entries.map(e => e.id));
        const deleted = new Set(prior.deleted_order_ids || []);
        prior.entries.push(...archive.entries.filter(e => !ids.has(e.id) && !deleted.has(e.id)));
      }
      archive = E.normalizeArchive(prior, opts());
      persistent = true;
    }
  } catch (error) {
    toast('未能读取浏览器记录，已打开文件中的初始内容。原浏览器备份未被覆盖。');
  }
  window.addEventListener('storage',event=>{
    if(event.storageArea!==localStorage || event.key!==key || !event.newValue)return;
    if(document.activeElement?.matches('#wishlist-grid textarea'))return;
    try{
      const remote=normalizedArchive(JSON.parse(event.newValue));
      if((key===demoKey)!==(remote.data_kind==='synthetic'))return;
      archive=E.normalizeArchive(window.ArchiveMerge.merge(storageBase,archive,remote),opts());
      storageBase=JSON.parse(JSON.stringify(remote));persistent=true;render();
    }catch(error){toast('另一窗口的记录暂未读取，本页内容仍保留。');}
  });

  function startPersonal() {
    if (archive.data_kind !== 'synthetic') return true;
    if (!window.confirm('当前是纯虚构示例。清空示例，开始你的个人手账？')) return false;
    let personal = {version: 1, data_kind: 'manual', entries: []};
    try {
      const stored = localStorage.getItem(personalKey);
      if (stored) {
        personal = E.normalizeArchive(JSON.parse(stored), opts());
        if (personal.data_kind === 'synthetic') throw new Error('personal storage contains demo');
      }
    } catch (error) {
      toast('暂时无法读取个人手账。请先在主页恢复备份，现有记录未被覆盖。');
      return false;
    }
    key = personalKey;
    archive = personal;
    storageBase=JSON.parse(JSON.stringify(personal));
    save();
    render();
    toast('个人手账已开启。你添加的记录才是你的打卡。');
    return true;
  }
  function setView(next) {
    view = next;
    for (const name of ['map', 'journal', 'candidates', 'wishlist']) {
      $('tab-' + name).setAttribute('aria-selected', String(name === next));
      $('tab-' + name).tabIndex = name === next ? 0 : -1;
      $('pane-' + name).hidden = name !== next;
    }
    if (next === 'map') requestAnimationFrame(drawMap);
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelector('[role=tablist]').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = ['map', 'journal', 'candidates', 'wishlist'].filter(name => !$('tab-' + name).hidden);
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length-1 : (keys.indexOf(view) + delta + keys.length) % keys.length;
    event.preventDefault(); setView(keys[index]); $('tab-' + keys[index]).focus();
  });
  const storeLayer=node('label',undefined,'check map-store-toggle');
  const storeToggle=node('input');storeToggle.type='checkbox';storeToggle.id='show-store-layer';storeToggle.checked=true;
  storeLayer.append(storeToggle,node('span','先看看有哪些门店（不计入足迹）'));
  $('map-points').before(storeLayer);
  const storePointList=node('div',undefined,'map-points');storePointList.id='store-map-points';$('map-points').after(storePointList);
  const storeMarkers=node('div',undefined,'map-store-markers');storeMarkers.id='map-store-markers';
  storeMarkers.setAttribute('aria-label','地图上的门店，点击查看照片和介绍');$('world-map').after(storeMarkers);
  storeToggle.addEventListener('change',drawMap);
  let storeCity='',storeQuery='';
  function catalogControls(prefix) {
    const controls=node('div',undefined,'store-catalog-controls');
    const cityLabel=node('label','在哪座城？');const select=node('select');select.id=prefix+'-city-filter';select.setAttribute('aria-label','按城市找特色门店');cityLabel.append(select);
    const queryLabel=node('label','找一家特别的麦');const input=node('input');input.id=prefix+'-query';input.type='search';input.maxLength=120;input.placeholder='城市、店名、亲子、湖畔…';queryLabel.append(input);
    const clear=node('button','清除筛选','quiet');clear.id=prefix+'-clear';clear.type='button';clear.hidden=true;
    select.addEventListener('change',()=>{storeCity=select.value;updateCatalog();});input.addEventListener('input',()=>{storeQuery=input.value;updateCatalog();});
    clear.addEventListener('click',()=>{storeCity='';storeQuery='';updateCatalog();input.focus();});
    controls.append(cityLabel,queryLabel,clear);return controls;
  }
  $('world-map').parentElement.before(catalogControls('store'));
  $('inspiration-grid').before(catalogControls('inspiration'));
  const catalog=node('section',undefined,'store-catalog');const catalogHeader=node('div',undefined,'store-catalog-heading');
  const catalogStatus=node('p',undefined,'store-catalog-status');catalogStatus.id='store-catalog-status';catalogStatus.setAttribute('role','status');
  const seeAll=node('button','展开特色门店手账 →','quiet');seeAll.type='button';seeAll.addEventListener('click',()=>{setView('wishlist');document.querySelector('.inspiration-heading').scrollIntoView({behavior:'smooth',block:'start'});});
  catalogHeader.append(catalogStatus,seeAll);const catalogGrid=node('div',undefined,'store-catalog-grid');catalogGrid.id='store-catalog-grid';catalog.append(catalogHeader,catalogGrid);storePointList.after(catalog);
  const inspirationStatus=node('p',undefined,'store-catalog-status');inspirationStatus.id='inspiration-status';inspirationStatus.setAttribute('role','status');$('inspiration-grid').before(inspirationStatus);

  function filterStores(stores) {
    const terms=storeQuery.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return stores.filter(store=>(!storeCity || store.city===storeCity) && terms.every(term=>[store.city,store.name,store.search_keyword,store.address,store.short_description,...(store.aliases || []),...(store.tags || [])].filter(Boolean).join(' ').normalize('NFKC').toLowerCase().includes(term)));
  }
  function syncCatalogControls() {
    const cities=[...new Set(knownStores().map(s=>s.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    for(const prefix of ['store','inspiration']) {
      const select=$(prefix+'-city-filter');select.replaceChildren(new Option('全国各地', ''),...cities.map(city=>new Option(city,city)));select.value=storeCity;
      $(prefix+'-query').value=storeQuery;$(prefix+'-clear').hidden=!(storeCity || storeQuery);
    }
  }
  function updateCatalog() {
    syncCatalogControls();renderInspiration();renderStoreCatalog();if(view==='map')drawMap();
  }
  function renderStoreCatalog() {
    const stores=filterStores(knownStores());catalogGrid.replaceChildren();
    catalogStatus.textContent=storeCity || storeQuery?`找到 ${stores.length} 家特色门店`:`${new Set(data.stores.map(s=>s.city)).size} 座城市 · ${data.stores.length} 家特色门店`;
    for(const store of stores.slice(0,6)) {
      const button=node('button',undefined,'store-catalog-card');button.type='button';
      if(store.default_photo){const image=node('img');image.src=data.store_images?.[store.default_photo.url] || store.default_photo.url;image.alt=store.name;image.loading='lazy';image.referrerPolicy='no-referrer';button.append(image);}
      const text=node('span');text.append(node('small',store.city),node('strong',store.name),node('span',store.short_description || store.address,'store-catalog-excerpt'));button.append(text,node('span','↗','store-catalog-arrow'));
      button.addEventListener('click',()=>openStoreDiscovery([store]));catalogGrid.append(button);
    }
    seeAll.textContent=stores.length>6?`还有 ${stores.length-6} 家，展开门店手账 →`:'展开特色门店手账 →';
    if(!stores.length){const message=empty('暂时没找到这家麦','试试换个城市或关键词，或清除筛选看看其他门店。');const clear=node('button','清除筛选','secondary');clear.type='button';clear.addEventListener('click',()=>{storeCity='';storeQuery='';updateCatalog();});message.append(clear);catalogGrid.append(message);}
  }

  function knownStores() {
    const items=[...data.stores.map(s=>({...s,source:'manual',code:'catalog:'+s.name})),
      ...(data.discovery_stores || []).map(s=>({...s,source:'manual',code:s.code || 'map:'+s.name})),
      ...nearbyStores.map(s=>({...s,source:'mcp_nearby'}))];
    return [...new Map(items.map(s=>[s.city+'/'+s.name,s])).values()];
  }
  function openStoreDiscovery(stores) {
    const body=$('store-discovery-body');body.replaceChildren();
    const cities=[...new Set(stores.map(store=>store.city))];
    $('store-discovery-heading').textContent=stores.length===1?'看看这家麦当劳':(cities.length>1?'这一带':cities[0])+' · '+stores.length+' 家门店';
    for(const store of stores) {
      const card=node('article',undefined,'store-discovery-card');
      if(store.default_photo)card.append(photoNode({city:store.city,store:store.name,default_photo:store.default_photo}));
      else card.append(node('div',store.city+' · 麦当劳','store-photo-placeholder'));
      const info=node('div',undefined,'store-discovery-info');
      info.append(node('span',store.city,'store-city'),node('h3',store.name),node('p',store.address || store.city,'place'));
      if(store.short_description)info.append(node('p',store.short_description,'note'));
      if(store.source_url){const source=node('a','查看门店资料 ↗','store-source');source.href=store.source_url;source.target='_blank';source.rel='noopener noreferrer';info.append(source);}
      const actions=node('div',undefined,'wishlist-actions');
      const collected=(archive.wishlist || []).some(item=>item.source===store.source && item.code===store.code);
      const collect=node('button',collected?'已收藏想去':'想去这家','primary');collect.type='button';collect.disabled=collected;collect.addEventListener('click',()=>{
        if(!startPersonal())return;
        try {archive=E.normalizeArchive({...archive,wishlist:W.add(archive.wishlist || [],store)},opts());save();renderWishlist();collect.textContent='已收藏想去';collect.disabled=true;toast('已放进想去清单。');}
        catch(error){toast('这家店暂未收藏，请检查清单是否已满。');}
      });
      const visit=node('button','我去过，记一餐','quiet');visit.type='button';visit.addEventListener('click',()=>{$('store-discovery-dialog').close();openStoreForm(store);});
      actions.append(collect,visit);info.append(actions);card.append(info);body.append(card);
    }
    body.append(node('p','地图标记在城市参考点，具体位置见门店地址。','map-note'));
    $('store-discovery-dialog').showModal();body.scrollTop=0;$('store-discovery-dialog').scrollTop=0;
  }

  function storeMarkerLabel(store) {
    let name=store.name.replace(/^麦当劳/, '');
    if(name.startsWith(store.city))name=name.slice(store.city.length);
    return name.replace(/(?:餐厅|旗舰店)$/, '') || store.name;
  }

  function drawStoreLabels(points,ctx,width,height) {
    const compact=width<500, cityLabels=points.length>6 && !storeCity;
    if(cityLabels){
      // Group close city anchors rather than moving labels to another region of the country.
      const groups=[];
      for(const point of points){
        const group=groups.find(other=>Math.hypot(other.x-point.x,other.y-point.y)<(compact?42:55));
        if(group){group.stores.push(...point.stores);group.cities.push(point.city);}
        else groups.push({...point,stores:[...point.stores],cities:[point.city]});
      }
      points=groups;
    }
    const labelWidth=cityLabels?(compact?82:98):(compact?116:164),labelHeight=cityLabels?44:(compact?46:50),gap=5;
    const placed=[];
    for(const point of [...points].sort((a,b)=>a.y-b.y)) {
      const offsets=[[14,-labelHeight/2],[-labelWidth-24,-labelHeight/2],[14,-labelHeight-12],[-labelWidth-24,-labelHeight-12],[14,12],[-labelWidth-24,12]];
      // Close cities can share a small area; labels move outwards while a leader keeps their map anchor visible.
      for(let step=2;step<7;step++)offsets.push([14,-labelHeight*step],[-labelWidth-24,-labelHeight*step],[14,labelHeight*(step-1)],[-labelWidth-24,labelHeight*(step-1)]);
      let best;
      for(const [dx,dy] of offsets) {
        const box={x:Math.max(gap,Math.min(width-labelWidth-gap,point.x+dx)),y:Math.max(gap,Math.min(height-labelHeight-gap,point.y+dy)),w:labelWidth,h:labelHeight};
        const overlap=placed.reduce((sum,other)=>sum+Math.max(0,Math.min(box.x+box.w+gap,other.x+other.w+gap)-Math.max(box.x,other.x))*Math.max(0,Math.min(box.y+box.h+gap,other.y+other.h+gap)-Math.max(box.y,other.y)),0);
        const distance=Math.hypot(box.x+box.w/2-point.x,box.y+box.h/2-point.y);
        const score=overlap*100+distance;
        if(!best || score<best.score)best={...box,score};
      }
      placed.push(best);
      const edgeX=Math.max(best.x,Math.min(best.x+best.w,point.x)),edgeY=Math.max(best.y,Math.min(best.y+best.h,point.y));
      ctx.beginPath();ctx.moveTo(point.x,point.y);ctx.lineTo(edgeX,edgeY);ctx.strokeStyle='#b29a72';ctx.lineWidth=1;ctx.stroke();
      const first=point.stores[0],button=node('button',undefined,'map-store-marker'+(cityLabels?' city-marker':''));button.type='button';
      button.style.left=best.x+'px';button.style.top=best.y+'px';button.style.width=labelWidth+'px';button.style.height=labelHeight+'px';
      button.dataset.city=point.city;button.dataset.anchorX=point.x;button.dataset.anchorY=point.y;
      button.setAttribute('aria-label',point.city+' · '+point.stores.map(s=>s.name).join('、')+'，查看门店照片和介绍');
      button.title=point.stores.map(s=>s.name).join('\n');
      if(!cityLabels && first.default_photo){const thumbnail=node('img');thumbnail.src=data.store_images?.[first.default_photo.url] || first.default_photo.url;thumbnail.alt='';thumbnail.referrerPolicy='no-referrer';button.append(thumbnail);}
      else if(cityLabels){}
      else button.append(node('span','店','map-store-icon'));
      const label=node('span',undefined,'map-store-marker-text');
      if(cityLabels)label.append(node('strong',point.city+(point.cities.length>1?'等'+point.cities.length+'城':'')),node('small',point.stores.length+' 家特色店'));
      else label.append(node('small',point.city+(point.stores.length>1?' · '+point.stores.length+' 家':'')),node('strong',storeMarkerLabel(first)));
      button.append(label);
      button.addEventListener('click',()=>openStoreDiscovery(point.stores));storeMarkers.append(button);
    }
  }

  function refillFilters() {
    const year = $('year-filter').value;
    const years = [...new Set(archive.entries.map(e => e.date.slice(0, 4)))].sort().reverse();
    $('year-filter').replaceChildren(new Option('全部年份', ''), ...years.map(y => new Option(y + ' 年', y)));
    $('year-filter').value = years.includes(year) ? year : '';
    const province = $('country-filter').value;
    $('country-filter').replaceChildren(new Option('全部省份 / 地区', ''), ...provinces.map(f => new Option(f.properties.name, String(f.properties.adcode))));
    $('country-filter').value = province;
  }
  function render() {
    refillFilters();
    currentSummary = E.summarize(archive, {...opts(), year: $('year-filter').value, province_code: $('country-filter').value});
    renderJourney();
    const s = currentSummary;
    $('count-visits').textContent = s.confirmedCount;
    $('count-countries').textContent = s.distinctProvinces;
    $('count-cities').textContent = s.distinctCities;
    $('count-stores').textContent = s.distinctStores;
    $('candidate-count').textContent = s.candidateCount;
    $('save-status').textContent = persistent ? '已保存在本浏览器 · 导出备份可换设备' : '当前在本页内使用 · 请导出备份';
    $('mode-description').textContent = archive.data_kind === 'synthetic'
      ? '示例手账：日期、餐品和随记为演示数据，公开门店照片注明来源。开始个人手账，记录你的足迹。'
      : localApi ? '订单自动写成手账，也可以添上自己的照片和小事。留下的每一页，都会点亮所在省份。'
      : '先收藏一家想去的店，再把照片和小事写进自己的中国地图。';
    $('start-personal').hidden = archive.data_kind !== 'synthetic';
    renderPassport(s);
    renderRecent(s);
    renderEntries(s);
    renderCandidates(s);
    renderWishlist();
    syncCatalogControls();renderStoreCatalog();
    $('month-list').replaceChildren(...s.months.map(m => {
      const chip = node('span', m.month, 'month-chip'); chip.append(node('b', m.count + ' 页')); return chip;
    }));
    if (!s.months.length) $('month-list').append(node('p', '写下第一条本人打卡，这里就会留下月份记录。', 'map-note'));
    $('tab-candidates').hidden = true;
    setView(view);
  }
  function renderPassport(s) {
    const grid = $('passport-grid'); grid.replaceChildren();
    for (const province of s.provinces) {
      const stamp = node('button', undefined, 'stamp'); stamp.type = 'button';
      stamp.append(node('b', provinceName(province.province_code)), node('strong', province.count + ' 页足迹'), node('small', '从一顿麦当劳开始'));
      stamp.setAttribute('aria-label', '筛选' + provinceName(province.province_code) + '的打卡');
      stamp.addEventListener('click', () => { $('country-filter').value = province.province_code; render(); });
      grid.append(stamp);
    }
    if (!s.provinces.length) grid.append(empty('第一枚足迹，等你来点亮', '写下一条本人打卡，选择省份，开启你的中国地图。'));
  }
  function renderRecent(s) {
    $('recent-list').replaceChildren();
    for (const entry of s.entries.slice(0, 3)) {
      const row = node('li'); const button = node('button'); button.type = 'button';
      if (entry.photo || entry.default_photo) {
        const image = node('img', undefined, 'recent-photo'); image.src = entry.photo?.data_url || data.store_images?.[entry.default_photo.url] || entry.default_photo.url;
        image.alt = entry.store; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; button.append(image);
      }
      button.append(node('strong', entry.store), node('small', `${entry.date} / ${placeName(entry)}`));
      button.addEventListener('click', () => openDetail(entry)); row.append(button); $('recent-list').append(row);
    }
    if (!s.entries.length) $('recent-list').append(empty('从一家麦当劳开始', '记录一顿早餐、一张纸袋，或旅行途中熟悉的味道。'));
  }
  function photoNode(entry) {
    const figure = node('figure', undefined, 'entry-photo');
    const image = node('img', undefined, 'photo'); image.src = entry.photo?.data_url || data.store_images?.[entry.default_photo.url] || entry.default_photo.url;
    image.loading='lazy';
    image.alt = entry.photo ? `${entry.city} ${entry.store}的本人打卡照片` : entry.default_photo.caption || `${entry.store}门店照片`;
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.hidden=true;figure.append(node('p','这张照片暂时没加载出来，来源链接仍可查看。','photo-credit')); });
    figure.append(image);
    if (!entry.photo) {
      const credit = node('figcaption',undefined,'photo-credit');
      const details = node('details', undefined, 'photo-source'); details.append(node('summary','照片来源'));
      const link = node('a', entry.default_photo.attribution || '查看原图'); link.href=entry.default_photo.source_url;link.target='_blank';link.rel='noopener noreferrer';
      details.append(node('span',entry.default_photo.caption || '门店照片'),link); credit.append(details); figure.append(credit);
    }
    return figure;
  }
  function renderJourney() {
    const insights=window.JourneyInsights.build(archive,{today:today()});
    $('journey-heading').textContent=insights.year+' 年的页边注';
    $('journey-prompt').textContent=insights.prompt.detail;
    $('journey-facts').replaceChildren();
    for(const metric of insights.metrics.slice(0,2)) {
      const item=node('div'); item.append(node('b',String(metric.value)),node('span',metric.label));$('journey-facts').append(item);
    }
    const memory=$('journey-memory');memory.hidden=!insights.memory;memory.replaceChildren();
    if(insights.memory) {
      memory.append(node('strong',insights.memory.title),node('span',insights.memory.detail));
      memory.onclick=()=>{const entry=archive.entries.find(e=>e.id===insights.memory.entryId);if(entry)openDetail(entry);};
    }
    $('milestone-list').replaceChildren();
    for(const milestone of insights.milestones) $('milestone-list').append(node('span',milestone.title+(milestone.reached?' · 已点亮':''),'milestone'+(milestone.reached?' reached':'')));
    $('journey-tastes').hidden=!insights.foods.length;$('taste-list').replaceChildren();
    for(const food of insights.foods){
      const button=node('button',food.name+' · '+food.count+' 页','quiet');button.type='button';button.style.fontSize='11px';button.style.padding='5px 10px';button.style.minHeight='32px';
      button.addEventListener('click',()=>{$('year-filter').value='';$('country-filter').value='';$('journal-query').value=food.name;render();setView('journal');$('journal-query').scrollIntoView({behavior:'smooth',block:'center'});});$('taste-list').append(button);
    }
  }
  function foodTags(entry) {
    const tags = node('div', undefined, 'food-tags');
    for (const food of entry.foods) tags.append(node('span', food));
    if (entry.collaboration) tags.append(node('span', '联名 · ' + entry.collaboration));
    return tags;
  }
  function renderWishlist() {
    const items=archive.wishlist || [];
    $('wishlist-count').textContent=items.length;
    const grid=$('wishlist-grid');grid.replaceChildren();
    for(const store of items) {
      const card=node('article',undefined,'entry-card');card.dataset.wishlistId=store.id;
      const defaultPhoto=wishlistPhoto(store);if(defaultPhoto)card.append(photoNode({city:store.city,store:store.name,default_photo:defaultPhoto}));
      card.append(node('span',store.city || '下一站','date'),node('h3',store.name),node('p',store.address || '地址暂未提供','place'));
      const label=node('label','留一句想去的理由','wishlist-note');
      const note=node('textarea');note.maxLength=1000;note.value=store.note;note.placeholder='下次旅行、特别的建筑、约朋友一起去……';
      note.setAttribute('aria-label',store.name+'的想去理由');
      note.addEventListener('change',()=>{
        try {archive=E.normalizeArchive({...archive,wishlist:(archive.wishlist || []).map(item=>item.id===store.id?{...item,note:note.value}:item)},opts());save();toast('想去的理由已保存。');}
        catch(error){toast('备注暂未保存，请缩短后再试。');}
      });label.append(note);card.append(label);
      const actions=node('div',undefined,'wishlist-actions');
      const visit=node('button','到了，留一页打卡','secondary');visit.type='button';visit.addEventListener('click',()=>openStoreForm((archive.wishlist || []).find(item=>item.id===store.id) || store,store.id));
      const share=node('button','分享下一站','quiet');share.type='button';share.addEventListener('click',()=>{
        const current=(archive.wishlist || []).find(item=>item.id===store.id) || store;
        openShare({kind:'plan',date:'',city:current.city,store:current.name,foods:[],note:current.note,default_photo:wishlistPhoto(current)});
      });
      const remove=node('button','移出清单','quiet');remove.type='button';remove.addEventListener('click',()=>{
        archive={...archive,wishlist:W.remove(archive.wishlist || [],store.id)};save();renderWishlist();toast('已移出想去清单。');
      });actions.append(visit,share,remove);card.append(actions);grid.append(card);
    }
    if(!items.length)grid.append(empty('把下一站先放在这里','查找附近门店，收藏想去。下次打开时，你的计划还在。'));
    renderInspiration();
  }
  function wishlistPhoto(store){
    return data.stores.find(item=>item.city===store.city && [item.name,...(item.aliases || [])].includes(store.name))?.default_photo ||
      archive.entries.find(item=>item.city===store.city && item.store===store.name && item.default_photo)?.default_photo || null;
  }
  function renderInspiration() {
    const grid=$('inspiration-grid');grid.replaceChildren();
    const filtered=filterStores(data.stores);inspirationStatus.textContent=`${storeCity || '全国各地'} · ${filtered.length} 家特色门店`;
    for(const store of filtered) {
      const candidate={source:'manual',code:'catalog:'+store.name,name:store.name,city:store.city,province_code:store.province_code,address:store.address,note:''};
      const id=W.normalize([candidate])[0].id;
      const card=node('article',undefined,'entry-card inspiration-card');
      card.append(node('span',store.city+' · 门店灵感','date'));
      if(store.default_photo)card.append(photoNode({city:store.city,store:store.name,default_photo:store.default_photo}));
      card.append(node('h3',store.name),node('p',store.short_description || '人民广场附近的城市旗舰店，逛完市中心，留下一顿熟悉的味道。','note'),node('p',store.address,'place'));
      const source=node('a','门店资料 ↗','store-source');source.href=store.source_url;source.target='_blank';source.rel='noopener noreferrer';card.append(source);
      const actions=node('div',undefined,'wishlist-actions');
      const collect=node('button',(archive.wishlist || []).some(s=>s.id===id)?'已放入想去清单':'想去这家','secondary');collect.type='button';
      collect.addEventListener('click',()=>{try{archive=E.normalizeArchive({...archive,wishlist:W.add(archive.wishlist || [],candidate)},opts());save();renderWishlist();toast('已收藏，下一次打开还在想去清单。');}catch(error){toast('想去清单最多保存 100 家店。');}});
      const check=node('button','查询这家店','quiet');check.type='button';check.addEventListener('click',()=>{
        const search=$('store-search');search.open=true;document.querySelector('[name=search_city]').value=store.city;document.querySelector('[name=search_keyword]').value=store.search_keyword || store.name;search.scrollIntoView({behavior:'smooth',block:'start'});$('search-stores').focus();
      });check.hidden=!localApi;
      const open=node('button','看看这家店','quiet');open.type='button';open.addEventListener('click',()=>openStoreDiscovery([{...store,source:'manual',code:'catalog:'+store.name}]));
      const image=card.querySelector('img.photo');if(image){const photoButton=node('button',undefined,'store-photo-open');photoButton.type='button';photoButton.setAttribute('aria-label','看看'+store.name);image.replaceWith(photoButton);photoButton.append(image);photoButton.addEventListener('click',()=>open.click());}
      actions.append(collect,open,check);card.append(actions);grid.append(card);
    }
    if(!filtered.length)grid.append(empty('这一站还没找到','换个城市或关键词，或者清除筛选看看其他特色门店。'));
  }
  function openStoreForm(store,wishlistId=null) {
    openForm();if(!$('entry-dialog').open)return;
    field('city').value=store.city;field('store').value=store.name;
    const city=data.cities.find(c=>[c.city,c.city+'市',c.city_en].includes(store.city));
    field('province_code').value=store.province_code || city?.province_code || '';
    selectedStore=store.source==='manual'?null:{source:'mcp_nearby',code:store.code,address:store.address || ''};
    selectedWishlistId=wishlistId;
    $('wishlist-complete').hidden=!wishlistId;field('complete_wishlist').checked=!!wishlistId;
    if(wishlistId){field('note').value=store.note || '';$('form-heading').textContent='把下一站写成足迹';}
    applyStoreInfo();updateCitySuggestions();
  }
  function renderEntries(s) {
    const grid = $('journal-grid'); grid.replaceChildren();
    const query=$('journal-query').value;
    const entries=window.JournalSearch.filter(s.entries,query);
    $('clear-journal-query').hidden=!query;
    $('journal-search-status').textContent=query?`找到 ${entries.length} 页 / 当前筛选 ${s.entries.length} 页`:'';
    for (const entry of entries) {
      const card = node('article', undefined, 'entry-card');
      card.append(node('span', entry.date, 'date'));
      if (entry.photo || entry.default_photo) card.append(photoNode(entry));
      card.append(node('h3', entry.store), node('p', `${placeName(entry)}`, 'place'), foodTags(entry));
      if (entry.note) card.append(node('p', entry.note, 'note'));
      card.append(node('p', entry.origin === 'mcp' ? '从麦当劳订单自动整理' : '自己写下的这一页', 'origin'));
      const actions = node('div', undefined, 'entry-buttons');
      const edit = node('button', '编辑这一页'); edit.type = 'button'; edit.addEventListener('click', () => openForm(entry));
      const details = node('button', '翻开'); details.type = 'button'; details.addEventListener('click', () => openDetail(entry));
      const share=node('button','分享这一页');share.type='button';share.addEventListener('click',()=>openShare(entry));
      const remove = node('button', '删除', 'delete'); remove.type = 'button'; remove.addEventListener('click', () => removeEntry(entry));
      actions.append(edit, details, share, remove); card.append(actions); grid.append(card);
    }
    if (!entries.length) grid.append(query?empty('暂时没找到这一页','换个餐品、门店或城市关键词，或清除搜索再翻翻。'):empty('这一页还是空白', '点击“新增打卡”记录一餐，或同步麦当劳订单自动生成手账。'));
  }
  $('journal-query').addEventListener('input',()=>renderEntries(currentSummary));
  $('clear-journal-query').addEventListener('click',()=>{$('journal-query').value='';renderEntries(currentSummary);$('journal-query').focus();});
  function renderCandidates(s) {
    const grid = $('candidate-grid'); grid.replaceChildren();
    for (const entry of s.candidateEntries) {
      const card = node('article', undefined, 'entry-card candidate');
      if (entry.photo || entry.default_photo) card.append(photoNode(entry));
      card.append(node('span', entry.date, 'date'), node('h3', entry.store), node('p', placeName(entry), 'place'), foodTags(entry));
      const confirm = node('button', '编辑这一页', 'primary'); confirm.type = 'button'; confirm.addEventListener('click', () => openForm(entry));
      const skip = node('button', '不计这条线索', 'quiet'); skip.type = 'button'; skip.style.marginTop = '8px'; skip.style.width = '100%'; skip.addEventListener('click', () => removeEntry(entry));
      card.append(confirm, skip); grid.append(card);
    }
    if (!s.candidateEntries.length) grid.append(empty('没有待确认的订单线索', '可导入中国大陆的规范化 MCP 订单文件；也可以用“新增打卡”手动记录。'));
  }

  function drawMap() {
    const canvas = $('world-map'), width = Math.max(1, canvas.clientWidth), height = Math.max(1,canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    ctx.fillStyle = '#f3eddb'; ctx.fillRect(0, 0, width, height);
    const xy = (lon, lat) => [(lon - 72) / 64 * width, (55 - lat) / 38 * height];
    const visited = new Set(currentSummary.provinces.map(p => p.province_code));
    function outline(feature, project) {
      const geometry = feature.geometry, path = new Path2D();
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of polygons) for (const ring of polygon) {
        ring.forEach((coordinate, i) => { const point = project(...coordinate); if (i) path.lineTo(...point); else path.moveTo(...point); });
        path.closePath();
      }
      return path;
    }
    mapRegions = []; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    for (const feature of data.provinces.features) {
      const code = String(feature.properties.adcode), path = outline(feature, xy);
      ctx.fillStyle = visited.has(code) ? '#f3c2a4' : '#e8dfc5'; ctx.strokeStyle = '#b5a786'; ctx.lineWidth = .7;
      ctx.fill(path, 'evenodd'); ctx.stroke(path);
      if (provinceNames.has(code)) mapRegions.push({path, code});
    }
    ctx.restore();
    ctx.fillStyle = '#9a8a6e'; ctx.font = Math.max(8, Math.min(11, width * .016)) + 'px sans-serif'; ctx.textAlign = 'center';
    for (const feature of provinces) {
      const code = String(feature.properties.adcode);
      if (['810000','820000'].includes(code) || (width < 500 && ['110000','120000','310000'].includes(code))) continue;
      const center = feature.properties.centroid || feature.properties.center;
      if (!center) continue;
      const [x,y] = xy(...center);
      const label = feature.properties.name.replace(/壮族自治区|维吾尔自治区|回族自治区|特别行政区|自治区|省|市/g, '');
      ctx.fillText(label, x, y);
    }
    const inset = {x: width * .79, y: height * .60, w: width * .18, h: height * .35};
    ctx.save(); ctx.beginPath(); ctx.rect(inset.x, inset.y, inset.w, inset.h); ctx.clip(); ctx.fillStyle = '#f7f0dd'; ctx.fillRect(inset.x, inset.y, inset.w, inset.h);
    const sea = (lon, lat) => [inset.x + (lon - 105) / 20 * inset.w, inset.y + (25 - lat) / 24 * inset.h];
    for (const feature of data.provinces.features) { const path = outline(feature, sea); ctx.fillStyle = '#e8dfc5'; ctx.strokeStyle = '#b5a786'; ctx.lineWidth = .6; ctx.fill(path, 'evenodd'); ctx.stroke(path); }
    ctx.restore(); ctx.strokeStyle = '#cbbb9c'; ctx.strokeRect(inset.x, inset.y, inset.w, inset.h); ctx.fillStyle = '#7a6e5b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('南海诸岛', inset.x + 6, inset.y + inset.h - 8);
    mapPoints = [];storeMapPoints=[];storePointList.replaceChildren();storeMarkers.replaceChildren();
    if(storeToggle.checked){
      const storeGroups=new Map();
      for(const store of filterStores(knownStores())) {
        const city=data.cities.find(c=>[c.city,c.city+'市',c.city_en].includes(store.city));
        if(!city)continue;
        const [x,y]=xy(city.lon,city.lat);const key=city.province_code+'/'+city.city;
        if(!storeGroups.has(key))storeGroups.set(key,{x,y,city:city.city,stores:[]});
        storeGroups.get(key).stores.push({...store,province_code:store.province_code || city.province_code});
      }
      for(const point of storeGroups.values()) {
        ctx.beginPath();ctx.arc(point.x,point.y,5,0,Math.PI*2);ctx.fillStyle='#fff9eb';ctx.fill();ctx.strokeStyle='#9e7950';ctx.lineWidth=2;ctx.stroke();storeMapPoints.push(point);
        const button=node('button',point.city+' · '+storeMarkerLabel(point.stores[0])+(point.stores.length>1?' 等 '+point.stores.length+' 家':''),'map-point');button.type='button';
        button.addEventListener('click',()=>openStoreDiscovery(point.stores));storePointList.append(button);
      }
      drawStoreLabels(storeMapPoints,ctx,width,height);
    }
    const groups = new Map();
    for (const entry of currentSummary.entries.filter(e => e.location)) {
      const [x, y] = xy(entry.location.lon, entry.location.lat);
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const id = entry.province_code + '/' + entry.city;
      if (!groups.has(id)) groups.set(id, {x, y, entry, count: 0});
      groups.get(id).count++;
    }
    for (const point of groups.values()) {
      ctx.beginPath(); ctx.arc(point.x, point.y, 7, 0, 2 * Math.PI); ctx.fillStyle = '#dc442e'; ctx.fill(); ctx.strokeStyle = '#fff9eb'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffe28c'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('M', point.x, point.y + 3); mapPoints.push(point);
    }
    const pointList = $('map-points'); pointList.replaceChildren();
    for (const point of mapPoints) { const button = node('button', placeName(point.entry) + ' · ' + point.count + ' 页', 'map-point'); button.type = 'button'; button.addEventListener('click', () => openDetail(point.entry)); pointList.append(button); }
    $('map-note').textContent = currentSummary.confirmedCount ? `点亮 ${visited.size} 个省份 / 地区，留下 ${currentSummary.confirmedCount} 页足迹。M 是你的记录，城市标签可以点开看店。` : '点城市标签看照片和介绍；选一座城，找到下一家想去的麦。';
  }
  $('world-map').addEventListener('click', event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX-rect.left, y = event.clientY-rect.top;
    const nearest = mapPoints.map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.d-b.d)[0];
    if(nearest && nearest.d<18) { openDetail(nearest.entry); return; }
    const storePoint=storeMapPoints.map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.d-b.d)[0];
    if(storePoint && storePoint.d<18){openStoreDiscovery(storePoint.stores);return;}
    const canvas = event.currentTarget, ctx = canvas.getContext('2d');
    const region = mapRegions.find(r => ctx.isPointInPath(r.path, x * canvas.width / rect.width, y * canvas.height / rect.height, 'evenodd'));
    if (region) { $('country-filter').value = region.code; render(); }
  });
  window.addEventListener('resize', () => { if(view==='map') requestAnimationFrame(drawMap); });

  function updateCitySuggestions() {
    const matches=data.cities.filter(c=>c.province_code===field('province_code').value);
    $('city-suggestions').replaceChildren(...matches.map(c=>new Option(c.city,c.city)));
    updateLocationHelp();
  }
  function matchCity() {
    const value=field('city').value.normalize('NFKC').trim().toLowerCase();
    return data.cities.find(c=>c.province_code===field('province_code').value && [c.city,c.city+'市',c.city_en].some(n=>n && n.normalize('NFKC').trim().toLowerCase()===value));
  }
  function updateLocationHelp() {
    const mode=field('location_mode').value;
    $('coord-fields').hidden=mode!=='user';
    field('lat').required=mode==='user'; field('lon').required=mode==='user';
    const match=matchCity();
    $('location-help').textContent=mode==='none' ? '只保留文字打卡，不在地图上显示。' : mode==='user' ? '坐标由你填写；不自动查询或读取定位。' : match ? `已匹配${match.city}城市中心；不代表门店精确位置。` : '尚未匹配常用城市中心；仍可保存文字，或改为自己填写坐标。';
  }
  function showPhoto() {
    $('photo-preview').hidden=!(photo || defaultPhoto);
    $('photo-actions').hidden=!photo;
    if(photo || defaultPhoto) $('photo-preview').src=photo?.data_url || data.store_images?.[defaultPhoto.url] || defaultPhoto.url; else $('photo-preview').removeAttribute('src');
    $('photo-preview').referrerPolicy='no-referrer';
    $('photo-caption').replaceChildren();
    if (!photo && defaultPhoto) {
      const link=node('a',defaultPhoto.attribution || '查看来源');link.href=defaultPhoto.source_url;link.target='_blank';link.rel='noopener noreferrer';
      $('photo-caption').append(node('span', defaultPhoto.caption || '门店默认照片'),link);
    } else if(photo) $('photo-caption').append(node('span','你上传的照片'));
    $('remove-photo').textContent=defaultPhoto?'使用门店默认照片':'移除照片';
  }
  function applyStoreInfo() {
    const name=field('store').value.normalize('NFKC').trim();
    const store=(data.stores || []).find(s=>[s.name,...(s.aliases || [])].some(n=>n.normalize('NFKC').trim()===name));
    defaultPhoto=store?.default_photo || null;
    const cityMatches=data.cities.filter(c=>name.startsWith('麦当劳'+c.city));
    const cityInfo=store || (cityMatches.length===1 ? cityMatches[0] : null);
    if(cityInfo && !field('city').value.trim()) field('city').value=cityInfo.city;
    if(cityInfo && field('city').value.replace(/市$/,'')===cityInfo.city && !field('province_code').value) field('province_code').value=cityInfo.province_code;
    if(store && field('city').value.replace(/市$/,'')!==store.city) defaultPhoto=null;
    showPhoto();updateCitySuggestions();
  }
  function openForm(entry=null) {
    if (entry && archive.data_kind === 'synthetic') {
      toast('这条是虚构示例。请用“新增打卡”开始记录你本人的到访。');
      return;
    }
    if(!startPersonal()) return;
    photoRevision++;
    currentEntry=entry; selectedStore=entry?.store_reference || null;
    selectedWishlistId=null;$('wishlist-complete').hidden=true;
    form.reset(); photo=entry && entry.photo ? {...entry.photo} : null;
    defaultPhoto=entry?.default_photo || null;
    photoBusy=false; $('save-entry').disabled=false;
    $('form-heading').textContent=entry ? '修改这一页手账' : '新添一页打卡';
    $('form-note').textContent='门店资料和照片自动带入，想写什么、换哪张照片，都由你决定。';
    field('date').max=today(); field('date').value=entry ? entry.date : today();
    field('country_code').value='CN';
    field('province_code').value=entry?.province_code || data.cities.find(c => [c.city,c.city+'市'].includes(entry?.city))?.province_code || '';
    for (const option of field('province_code').options) option.disabled=!!(entry && (entry.source==='mcp_candidate' || entry.origin==='mcp') && ['710000','810000','820000'].includes(option.value));
    field('country_code').disabled=!!(entry && (entry.source==='mcp_candidate' || entry.origin==='mcp'));
    for (const name of ['city','store','note','collaboration']) field(name).value=entry && entry[name] ? entry[name] : '';
    if(entry?.source==='mcp_candidate' && field('note').value.startsWith('中国大陆订单线索'))field('note').value='';
    field('foods').value=entry ? entry.foods.join('，') : '';
    field('confirmed').checked=true;
    field('city').required=entry?.origin !== 'mcp';
    field('province_code').required=entry?.origin !== 'mcp';
    if(entry && entry.location) {
      field('location_mode').value=entry.location.precision==='user' ? 'user':'city';
      field('lat').value=entry.location.lat; field('lon').value=entry.location.lon;
    } else field('location_mode').value=entry ? 'none':'city';
    $('form-error').hidden=true; showPhoto(); updateCitySuggestions();
    if (!defaultPhoto) applyStoreInfo();
    $('entry-dialog').showModal(); field('date').focus();
  }
  field('province_code').addEventListener('change',updateCitySuggestions);
  field('city').addEventListener('input',updateLocationHelp);
  field('location_mode').addEventListener('change',updateLocationHelp);
  async function readPhoto(file) {
    if(!file) return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>10*1024*1024) { toast('请选择 10 MB 以内的 JPEG、PNG 或 WebP 照片。'); field('photo').value=''; return; }
    const revision=++photoRevision;
    photoBusy=true; $('save-entry').disabled=true;
    try {
      const bitmap=await createImageBitmap(file);
      if (revision !== photoRevision || !$('entry-dialog').open) { bitmap.close(); return; }
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
      let value=canvas.toDataURL('image/jpeg',.78);
      if(value.length>1.8*1024*1024) value=canvas.toDataURL('image/jpeg',.55);
      E.normalizeEntry({id:'photo-check',date:today(),country_code:'CN',city:'临时',store:'临时',foods:[],source:'manual',confirmed:true,photo:{data_url:value}},opts());
      photo={data_url:value}; showPhoto();
    } catch(error) { toast('照片无法读取或缩小后仍过大，请换一张图片。'); }
    finally {if(revision===photoRevision){photoBusy=false; $('save-entry').disabled=false; field('photo').value='';}}
  }
  field('photo').addEventListener('change', event => readPhoto(event.target.files[0]));
  $('take-photo').addEventListener('click', () => $('camera-input').click());
  $('camera-input').addEventListener('change', event => { readPhoto(event.target.files[0]); event.target.value=''; });
  $('remove-photo').addEventListener('click',()=>{photoRevision++;photoBusy=false;$('save-entry').disabled=false;field('photo').value='';photo=null;showPhoto();});
  form.addEventListener('submit',event=>{
    event.preventDefault(); if(photoBusy) return;
    try {
      const entry={id:currentEntry ? currentEntry.id : 'manual-'+(crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2)),
        date:field('date').value,country_code:'CN',province_code:field('province_code').value,city:field('city').value,store:field('store').value,
        foods:field('foods').value,note:field('note').value,collaboration:field('collaboration').value,source:'manual',confirmed:true};
      if(currentEntry && (currentEntry.source==='mcp_candidate' || currentEntry.origin==='mcp')) entry.origin='mcp';
      const mode=field('location_mode').value;
      if(mode==='user') entry.location={lat:Number(field('lat').value),lon:Number(field('lon').value),precision:'user'};
      if(mode==='city') {
        const match=matchCity();
        if(match) entry.location={lat:match.lat,lon:match.lon,precision:'city'};
        else if(currentEntry && currentEntry.location && currentEntry.location.precision==='city' && currentEntry.city===entry.city && currentEntry.country_code===entry.country_code) entry.location=currentEntry.location;
      }
      if(photo) entry.photo=photo;
      if(defaultPhoto) entry.default_photo=defaultPhoto;
      if(selectedStore) entry.store_reference=selectedStore;
      const normalized=E.normalizeEntry(entry,opts());
      const next={...archive,data_kind:'manual',entries:archive.entries.filter(e=>e.id!==normalized.id).concat(normalized)};
      if(selectedWishlistId && field('complete_wishlist').checked) next.wishlist=W.remove(archive.wishlist || [],selectedWishlistId);
      archive=E.normalizeArchive(next,opts()); save(); $('entry-dialog').close(); showImported('journal'); toast(persistent?'这一页已保存在本浏览器。':'这一页已加入；请立即导出备份。');
    } catch(error) { $('form-error').textContent='未能保存：请检查必填内容、日期、坐标和照片大小。'; $('form-error').hidden=false; }
  });
  function removeEntry(entry) {
    if(!window.confirm('删除这一页手账？')) return;
    const deleted = new Set(archive.deleted_order_ids || []);
    if (entry.origin === 'mcp' || entry.source === 'mcp_candidate') deleted.add(entry.id);
    archive={...archive,deleted_order_ids:[...deleted],entries:archive.entries.filter(e=>e.id!==entry.id)}; save(); render(); toast('记录已移除。');
  }
  function openDetail(entry) {
    $('detail-heading').textContent=entry.store;
    const body=$('detail-body');body.replaceChildren();
    body.append(node('p',`${entry.date} / ${placeName(entry)}`,'place'));
    if(entry.photo || entry.default_photo) body.append(photoNode(entry));
    body.append(foodTags(entry));
    if(entry.note) body.append(node('p',entry.note));
    body.append(node('p',entry.location ? (entry.location.precision==='city'?'地图使用城市中心，非门店位置。':'地图使用本人填写的坐标。'):'本页只有文字记录，没有位置标记。','map-note'));
    const edit=node('button','编辑这一页','secondary');edit.type='button';edit.addEventListener('click',()=>{$('detail-dialog').close();openForm(entry);});body.append(edit);
    const share=node('button','分享这一页','secondary');share.type='button';share.style.marginLeft='8px';share.addEventListener('click',()=>{$('detail-dialog').close();openShare(entry);});body.append(share);
    if(archive.data_kind!=='synthetic'){
      const again=node('button','再来这家，记新的一页','quiet');again.type='button';again.addEventListener('click',()=>{
        $('detail-dialog').close();openForm();
        field('city').value=entry.city;field('province_code').value=entry.province_code || '';field('store').value=entry.store;
        field('foods').value=entry.foods.join('，');selectedStore=entry.store_reference || null;
        applyStoreInfo();if(!defaultPhoto && entry.default_photo){defaultPhoto={...entry.default_photo};showPhoto();}
        $('form-heading').textContent='再来这家，留新的一页';$('form-note').textContent='门店和上次餐品已带入。换上这次的照片、写下这次的小事。';
      });body.append(again);
    }
    $('detail-dialog').showModal();
  }
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('store-discovery-dialog').addEventListener('click',event=>{
    if(event.target!==event.currentTarget)return;
    const bounds=event.currentTarget.getBoundingClientRect();
    if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom)event.currentTarget.close();
  });
  $('add-top').addEventListener('click',()=>openForm());
  $('start-personal').addEventListener('click',startPersonal);
  $('year-filter').addEventListener('change',render);$('country-filter').addEventListener('change',render);
  field('province_code').replaceChildren(new Option('请选择省份 / 地区',''), ...provinces.map(f => new Option(f.properties.name,String(f.properties.adcode))));
  function clearStoreSelection(){selectedStore=null;selectedWishlistId=null;$('wishlist-complete').hidden=true;}
  field('store').addEventListener('input', () => { clearStoreSelection(); applyStoreInfo(); });
  field('city').addEventListener('input', () => { clearStoreSelection(); applyStoreInfo(); });
  field('province_code').addEventListener('change', () => { selectedStore = null; });
  $('find-next-store').addEventListener('click',()=>{
    if(!localApi){$('inspiration-grid').scrollIntoView({behavior:'smooth',block:'start'});return;}
    $('store-search').open=true;$('store-search').scrollIntoView({behavior:'smooth',block:'start'});$('store-search-form').elements.search_city.focus();
  });
  let connectionAvailable=false;
  function useAccount(account) {
    if(!webSessions || !/^[a-f0-9]{32}$/.test(account || ''))return;
    activeAccount=account;
    const nextKey=`${guestKey}-${account}`;
    if(nextKey===personalKey)return;
    try {
      const stored=localStorage.getItem(nextKey);
      const next=stored?normalizedArchive(JSON.parse(stored)):
        (!lastAccount && archive.data_kind!=='synthetic'?archive:{version:1,data_kind:'manual',entries:[]});
      if(next.data_kind==='synthetic')throw new Error('account archive contains demo');
      personalKey=nextKey;key=nextKey;archive=next;storageBase=JSON.parse(JSON.stringify(next));
      lastAccount=account;localStorage.setItem(accountStorageKey,account);
      save();render();
    }catch(error){
      personalKey=nextKey;key=nextKey;archive={version:1,data_kind:'manual',entries:[]};
      storageBase=JSON.parse(JSON.stringify(archive));persistent=false;lastAccount=account;render();
      toast('这份手账暂未读取，原记录没有覆盖。请恢复备份，或换回原来的连接。');
    }
    nearbyStores=[];selectedStore=null;$('store-results').replaceChildren();
    if(view==='map')requestAnimationFrame(drawMap);
  }
  function connectionHeaders() {
    return {'Content-Type':'application/json',...(webSessions && activeAccount?{'X-Journal-Account':activeAccount}:{})};
  }
  function showConnection(state) {
    if(!localApi){
      document.querySelector('.connection-bar').hidden=true;$('store-search').hidden=true;$('connect-dialog').hidden=true;
      $('find-next-store').textContent='看看特色门店';
      document.querySelector('.inspiration-heading p').textContent='先从这些公开特色店开始，收藏想去的地方，到了再记一页。';
      return;
    }
    connectionAvailable=!!state?.capabilities?.connect;
    if(webSessions){
      activeAccount=state?.account_id || null;
      if(activeAccount)useAccount(activeAccount);
      $('connection-note').textContent='用你自己的麦当劳中国 MCP Token 连接，就能同步订单、查找门店。';
      $('remember-field').hidden=false;
      $('load-orders').textContent='载入已同步订单';
    }
    const connected=!!(state?.connected || state?.store_lookup);
    $('connection-state').textContent=connected?(webSessions && state.remembered?'麦当劳已连接 · 下次打开可以继续':'麦当劳已连接 · 可以查询附近门店'):connectionAvailable?'手账已准备好。连接麦当劳，再找下一家门店。':webSessions?'网页服务暂未响应，请刷新后重试。':'手账可以直接使用；安装 Python 后重新启动，还能连接麦当劳。';
    document.querySelector('.connection-bar').classList.toggle('connected',connected);
    $('open-connect').textContent=connected?'更换连接':'连接麦当劳';
    $('disconnect-mcd').hidden=!connected || !connectionAvailable;
    $('load-orders').hidden=!state?.capabilities?.synced_orders;
    $('sync-orders').hidden=!(connected && state?.order_sync);
    $('store-api-status').textContent=connected?'官方门店查询已连接。':connectionAvailable?'点击上方“连接麦当劳”，就可以查找附近门店。':webSessions?'网页服务暂未响应，请刷新后重试。':'查询门店请安装 Python 3.10 或更新版本，重新运行“启动.cmd”。';
  }
  if(localApi)fetch('/api/health').then(r=>r.ok?r.json():null).then(showConnection).catch(()=>showConnection(null));
  else showConnection(null);
  if(webSessions)window.addEventListener('storage',event=>{
    if(event.key===accountStorageKey || event.key==='mcd-china-map-connection-change'){
      fetch('/api/health').then(r=>r.ok?r.json():null).then(showConnection).catch(()=>showConnection(null));
    }
  });
  $('open-connect').addEventListener('click',()=>{
    $('connect-status').textContent=connectionAvailable?'':webSessions?'网页服务暂未响应，请刷新后重试。':'当前启动只提供手账功能。安装 Python 3.10 或更新版本后，关闭启动窗口，再运行“启动.cmd”。';
    $('connect-submit').disabled=!connectionAvailable;$('connect-dialog').showModal();$('connect-token').focus();
  });
  $('connect-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!connectionAvailable)return;
    $('connect-submit').disabled=true;$('connect-status').textContent='正在连接官方服务……';
    try {
      const response=await fetch('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:$('connect-token').value,...(webSessions?{remember:$('connect-remember').checked}:{})})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || '连接未完成，请检查 Token。');
      showConnection({...result,capabilities:{connect:true,synced_orders:true}});
      if(webSessions)try{localStorage.setItem('mcd-china-map-connection-change',String(Date.now()));}catch(error){}
      $('connect-dialog').close();toast('麦当劳已连接，可以找下一站了。');
    }catch(error){$('connect-status').textContent=error.message;}
    finally{$('connect-token').value='';$('connect-submit').disabled=false;}
  });
  $('disconnect-mcd').addEventListener('click',async()=>{
    try {
      const response=await fetch('/api/disconnect',{method:'POST',headers:connectionHeaders(),body:'{}'});
      if(!response.ok)throw new Error();showConnection({capabilities:{connect:true,synced_orders:true}});toast('连接已断开，手账和清单仍在。');
      if(webSessions){$('load-orders').hidden=true;try{localStorage.setItem('mcd-china-map-connection-change',String(Date.now()));}catch(error){}}
    }catch(error){toast(webSessions?'暂未断开，请刷新页面后重试。':'暂未断开，关闭启动窗口也可以结束连接。');}
  });
  $('load-orders').addEventListener('click',async()=>{
    $('load-orders').disabled=true;
    try {
      const response=await fetch('/api/synced-orders',{headers:connectionHeaders()});const result=await response.json();
      if(!response.ok)throw new Error(result.error || '请先运行“同步中国订单.cmd”。');
      if(!mergeArchive(E.normalizeArchive(result,opts())))return;showImported('journal');toast('订单已自动整理成手账。');
    }catch(error){toast(error.message);}
    finally{$('load-orders').disabled=false;}
  });
  $('sync-orders').addEventListener('click',async()=>{
    const buttons=['sync-orders','load-orders','open-connect','disconnect-mcd'];
    buttons.forEach(id=>$(id).disabled=true);
    $('sync-progress').hidden=false;$('sync-progress').textContent='正在整理门店和餐品，稍等片刻……';
    try {
      const response=await fetch('/api/sync-orders',{method:'POST',headers:connectionHeaders(),body:'{}'});
      const result=await response.json();if(!response.ok)throw new Error(result.error || '订单暂未同步，请稍后再试。');
      const incoming=E.normalizeArchive(result.archive,opts());if(!mergeArchive(incoming))return;
      showImported('journal');$('sync-progress').textContent=incoming.entries.length?`已自动整理 ${incoming.entries.length} 页订单手账，可以直接编辑、换照片或删除。`:'本次没有完成订单，可以先新增一页自己的打卡。';
    }catch(error){$('sync-progress').textContent=error.message;}
    finally{buttons.forEach(id=>$(id).disabled=false);}
  });
  $('store-search-form').addEventListener('submit', async event => {
    event.preventDefault(); const fields = event.currentTarget.elements;
    $('search-stores').disabled = true; $('store-results').replaceChildren(); $('store-search-status').textContent = '正在查询官方附近门店……';
    try {
      const response = await fetch('/api/stores', {method:'POST',headers:connectionHeaders(),body:JSON.stringify({city:fields.search_city.value,keyword:fields.search_keyword.value,be_type:Number(fields.be_type.value)})});
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error || '请使用“启动门店查询.cmd”连接官方门店查询。'); }
      const result = await response.json();
      if (!Array.isArray(result.stores)) throw new Error('门店响应无法读取，请稍后重试。');
      nearbyStores=result.stores;updateCatalog();
      $('store-search-status').textContent = result.stores.length ? `找到 ${result.stores.length} 家附近门店。` : '本次没有查到门店，试试换一个城市或地标。';
      for (const store of result.stores) {
        const card = node('article',undefined,'entry-card'); card.append(node('h3',store.name),node('p',store.address || '地址暂未提供'));
        card.append(node('p',`${store.business_status===true?'营业中':store.business_status===false?'暂停营业':'营业状态待查询'} · ${store.hours || '营业时间待查询'}`));
        const actions=node('div',undefined,'wishlist-actions');
        const button = node('button','在这里留一页打卡','secondary'); button.type='button'; button.addEventListener('click',()=>openStoreForm(store));
        const collect=node('button','收藏想去','quiet');collect.type='button';
        collect.addEventListener('click',()=>{
          if(!startPersonal())return;
          try {
            const city=data.cities.find(c=>[c.city,c.city+'市',c.city_en].includes(store.city));
            archive=E.normalizeArchive({...archive,wishlist:W.add(archive.wishlist || [],{...store,province_code:city?.province_code})},opts());
            save();renderWishlist();collect.textContent='已收藏想去';toast('已放入想去清单，下次打开也能找到。');
          }catch(error){toast('暂未收藏，请检查门店资料或清单是否已满。');}
        });actions.append(button,collect);card.append(actions); $('store-results').append(card);
      }
    } catch(error) { $('store-search-status').textContent=error.message; }
    finally { $('search-stores').disabled=false; }
  });

  function downloadArchive() {
    const clean=E.normalizeArchive(archive,opts());
    const url=URL.createObjectURL(new Blob([JSON.stringify(clean,null,2)],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='麦麦中国地图-'+(clean.data_kind==='synthetic'?'示例-':'')+today()+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('已发起备份下载，请确认浏览器已保存文件。');
  }
  $('export').addEventListener('click',downloadArchive);$('top-export').addEventListener('click',downloadArchive);
  let shareCanvas=null,shareFile=null,sharePreviewUrl=null,shareRevision=0;
  let shareEntry=null;
  const sharePhotoCache=new Map();
  let footprintTitle='我的麦麦中国足迹';
  function shareText() {
    if(shareEntry) {
      const facts=window.MemoryCard.project(shareEntry,{title:$('share-title').value,includePlace:$('share-cities').checked,includeNote:$('share-note').checked});
      return [facts.title,shareEntry.kind==='plan'?'下一站计划 · 尚未打卡':facts.date,$('share-cities').checked?[facts.city,facts.store].filter(Boolean).join(' · '):'',facts.foods.join(' · '),facts.note || '',
        '用麦当劳，画出自己的中国足迹。','https://github.com/Jay1023CN/mcd-china-map'].filter(Boolean).join('\n');
    }
    const s=currentSummary;
    return `${$('share-title').value || '我的麦麦中国足迹'}：${s.distinctProvinces} 个省份／地区，${s.distinctCities} 座城市，${s.confirmedCount} 页小小停靠。\n用麦当劳，画出自己的中国足迹。\nhttps://github.com/Jay1023CN/mcd-china-map`;
  }
  async function sharePhoto(entry) {
    if(entry.photo?.data_url)return entry.photo.data_url;
    const url=entry.default_photo?.url;if(!url)return null;
    const mirror=data.store_images?.[url];if(mirror?.startsWith('data:image/'))return mirror;
    if(sharePhotoCache.has(url))return sharePhotoCache.get(url);
    if(mirror && /^assets\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(mirror)) {
      try {
        const response=await fetch(new URL(mirror,location.href));if(!response.ok)return null;
        const blob=await response.blob();if(!blob.type.startsWith('image/') || blob.size>1024*1024)return null;
        const value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        if(sharePhotoCache.size>=8)sharePhotoCache.delete(sharePhotoCache.keys().next().value);sharePhotoCache.set(url,value);return value;
      }catch(error){return null;}
    }
    if(!localApi)return null;
    try {
      const response=await fetch('/api/photo-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
      if(!response.ok)return null;const value=(await response.json()).data_url;
      if(typeof value==='string' && value.startsWith('data:image/')){if(sharePhotoCache.size>=8)sharePhotoCache.delete(sharePhotoCache.keys().next().value);sharePhotoCache.set(url,value);return value;}
    }catch(error){}
    return null;
  }
  let snackImagePromise;
  function shareSnackImage() {
    if(snackImagePromise)return snackImagePromise;
    snackImagePromise=(async()=>{
      let uri=data.card_sketch;
      if(typeof uri!=='string')return null;
      if(/^assets\/[a-f0-9]{64}\.png$/.test(uri)) {
        const response=await fetch(new URL(uri,location.href));if(!response.ok)return null;
        const blob=await response.blob();if(blob.type!=='image/png' || blob.size>3*1024*1024)return null;
        uri=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      }
      if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(uri))return null;
      return await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=uri;});
    })().catch(()=>null);
    return snackImagePromise;
  }
  function openShare(entry=null) {
    if(!shareEntry)footprintTitle=$('share-title').value;
    shareEntry=entry;
    const plan=entry?.kind==='plan';
    $('share-heading').textContent=plan?'分享想去的下一站':entry?'分享这一页探店记':'把中国足迹装进一张卡片';
    $('share-description').textContent=plan?'把想去的店和理由装进一张卡，邀请朋友一起出发。计划卡不会计入足迹。':entry?'照片、餐品和随记，装进一张自己的探店卡。预览满意后再分享。':'按当前筛选生成。选好配色，分享给朋友看看。';
    $('share-title').value=plan?'下一站，想去这家':entry?'一页麦麦探店记':footprintTitle;
    $('share-place-label').textContent=entry?'显示城市和门店':'显示城市名称';
    $('share-cities').checked=!!entry;
    $('share-note-option').hidden=!entry;
    $('share-note-label').textContent=plan?'带上想去的理由':'带上这一页随记';
    $('share-photo-option').hidden=!entry;
    $('share-note').checked=!!entry?.note && !entry.note.startsWith('中国大陆订单线索');
    $('share-copy-text').hidden=true;
    $('share-preview').replaceChildren();
    $('share-dialog').showModal();updateShareCard();
  }
  async function updateShareCard() {
    const revision=++shareRevision;$('save-share').disabled=true;$('native-share').disabled=true;$('copy-share-image').disabled=true;$('share-status').textContent='正在画出你的足迹……';
    try {
      const canvas=shareEntry?await window.MemoryCard.render(shareEntry,{title:$('share-title').value,theme:$('share-theme').value,
        kind:shareEntry.kind,snackImage:await shareSnackImage(),
        photoAnnotation:$('share-cities').checked?(data.stores.find(store=>store.name===shareEntry.store)?.tags || []).find(tag=>tag.length<=10):'',
        includePlace:$('share-cities').checked,includeNote:$('share-note').checked,photoDataUrl:await sharePhoto(shareEntry),
        imageFit:$('share-photo-fit').value,photoCredit:shareEntry.photo?'本人上传照片':shareEntry.default_photo?.attribution}):
        await window.ShareCard.render(currentSummary,{provinces:data.provinces,provinceNames,
          title:$('share-title').value,theme:$('share-theme').value,includeCities:$('share-cities').checked,snackImage:await shareSnackImage()});
      if(revision!==shareRevision || !$('share-dialog').open)return;
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('empty image');
      if(revision!==shareRevision || !$('share-dialog').open)return;
      shareCanvas=canvas;shareFile=new File([blob],(shareEntry?.kind==='plan'?'麦麦想去-':shareEntry?'麦麦探店记-':'麦麦中国足迹-')+today()+'.png',{type:'image/png'});
      const oldUrl=sharePreviewUrl;sharePreviewUrl=URL.createObjectURL(blob);
      const preview=node('img');preview.id='share-image';preview.alt='你的中国足迹分享卡预览';preview.src=sharePreviewUrl;
      $('share-preview').replaceChildren(preview);if(oldUrl)URL.revokeObjectURL(oldUrl);
      $('save-share').disabled=false;$('native-share').disabled=false;$('copy-share-image').disabled=false;$('share-copy-text').value=shareText();
      $('share-status').textContent='点“分享给朋友”选择应用，也可以长按图片或保存到相册。';
    }catch(error){if(revision===shareRevision)$('share-status').textContent='暂时没画好，再试一次。';}
  }
  $('open-share').addEventListener('click',()=>openShare());
  $('share-title').addEventListener('input',updateShareCard);$('share-theme').addEventListener('change',updateShareCard);$('share-cities').addEventListener('change',updateShareCard);
  $('share-note').addEventListener('change',updateShareCard);
  $('share-photo-fit').addEventListener('change',updateShareCard);
  $('copy-share-image').addEventListener('click',async()=>{
    if(!shareFile)return;
    try {
      await navigator.clipboard.write([new ClipboardItem({'image/png':shareFile})]);
      $('share-status').textContent='图片已复制，切到微信或 QQ 聊天，粘贴即可发送。';
    }catch(error){$('share-status').textContent='当前浏览器请保存图片或长按卡片，再发给微信好友。';}
  });
  $('native-share').addEventListener('click',async()=>{
    if(!shareFile)return;
    if(typeof navigator.share!=='function') {
      $('share-status').textContent='当前浏览器请长按卡片保存图片，或复制文案后发给微信好友。';return;
    }
    try {
      const payload={title:$('share-title').value || '我的麦麦中国足迹',text:shareText()};
      const withImage=typeof navigator.canShare==='function' && navigator.canShare({files:[shareFile]});
      if(withImage)payload.files=[shareFile];
      else payload.url='https://github.com/Jay1023CN/mcd-china-map';
      const result=navigator.share(payload);$('native-share').disabled=true;await result;
      $('share-status').textContent=withImage?'已打开图片分享，可选择设备上的分享应用。':'已打开文案和链接分享；卡片可以长按保存后一起发送。';
    }catch(error){$('share-status').textContent=error.name==='AbortError'?'分享已取消，卡片还在这里。':'暂时没打开分享，请保存图片或复制文案后发送。';}
    finally{$('native-share').disabled=false;}
  });
  $('copy-share').addEventListener('click',async()=>{
    const content=shareText();$('share-copy-text').value=content;
    try {await navigator.clipboard.writeText(content);$('share-status').textContent='文案已复制，和卡片一起分享吧。';}
    catch(error){$('share-copy-text').hidden=false;$('share-copy-text').select();$('share-status').textContent='文案已选中，复制后即可发给朋友。';}
  });
  $('save-share').addEventListener('click',async()=>{
    if(!shareCanvas)return;$('save-share').disabled=true;
    try {
      const blob=await new Promise(resolve=>shareCanvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('empty image');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;
      link.download=(shareEntry?.kind==='plan'?'麦麦想去-':shareEntry?'麦麦探店记-':'麦麦中国足迹-')+(archive.data_kind==='synthetic'?'示例-':'')+today()+'.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
      $('share-status').textContent='图片已开始下载，去相册或下载文件夹找到它。';
    }catch(error){$('share-status').textContent='图片暂时未保存，请再试一次。';}
    finally{$('save-share').disabled=false;}
  });
  $('print').addEventListener('click',()=>window.print());
  $('import').addEventListener('click',()=>$('import-file').click());
  function showImported(next) {
    if (next === 'candidates') next = 'journal';
    $('journal-query').value='';
    $('year-filter').value='';$('country-filter').value='';render();setView(next);
  }
  function mergeArchive(incoming) {
    incoming = normalizedArchive(incoming);
    if(incoming.data_kind==='synthetic' && archive.data_kind!=='synthetic' && (archive.entries.length || archive.wishlist?.length)) throw new Error('synthetic cannot mix with personal');
    if(archive.data_kind==='synthetic' && incoming.data_kind!=='synthetic' && !startPersonal())return false;
    const entries=archive.entries.slice();
    for(const entry of incoming.entries) {
      const index=entries.findIndex(old=>old.id===entry.id),old=entries[index];
      if (old?.origin === 'mcp' && entry.origin === 'mcp') continue;
      if(old?.source==='manual' && old.confirmed && entry.source==='mcp_candidate')continue;
      if(old?.source==='mcp_candidate' && entry.source==='manual' && entry.confirmed){entries[index]=entry;continue;}
      if(old?.source==='mcp_candidate' && entry.source==='mcp_candidate')entries[index]=entry;
      else entries.push(entry);
    }
    const combined={version:1,data_kind:incoming.data_kind==='synthetic'?'synthetic':'manual',source:incoming.source || archive.source,entries,
      deleted_order_ids:[...new Set([...(archive.deleted_order_ids || []), ...(incoming.deleted_order_ids || [])])]};
    if(archive.wishlist || incoming.wishlist){
      let merged=archive.wishlist || [];
      for(const item of incoming.wishlist || [])if(!merged.some(old=>old.id===item.id))merged=W.add(merged,item);
      combined.wishlist=merged;
    }
    const normalized=E.normalizeArchive(combined,opts());key=normalized.data_kind==='synthetic'?demoKey:personalKey;
    archive=normalized;save();render();return true;
  }
  async function orderCandidates(payload) {
    if(payload.source?.kind!=='mcp' || !Array.isArray(payload.orders)) throw new Error('not actual normalized MCP records');
    if(!crypto.subtle) throw new Error('Web Crypto unavailable');
    const entries=[];
    for(const order of payload.orders) {
      if(order.status!=='completed') continue;
      if(typeof order.created_at!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(order.created_at)) throw new Error('order time offset missing');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(order.id));
      const ref=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
      entries.push({id:'mcp-'+ref,date:order.created_at.slice(0,10),country_code:'CN',city:order.store.city||'',store:order.store.name,
        foods:order.items.map(i=>i.name),note:'中国大陆订单线索；请核对是否本人到店。',source:'mcp_candidate',confirmed:false});
    }
    return {version:1,data_kind:'mcp',source:'只含本次实际取得的中国大陆完成订单线索，不证明全年覆盖或本人到店。',entries};
  }
  $('import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file) return;
    try {
      if(file.size>E.limits.archiveBytes) throw new Error('file too large');
      const parsed=JSON.parse(await file.text());
      const incoming=normalizedArchive(parsed.version===1?parsed:await orderCandidates(parsed));
      if(!mergeArchive(incoming))return;
      showImported(incoming.wishlist?.length && !incoming.entries.length?'wishlist':'journal');toast('导入完成，订单已自动整理成手账。');
    } catch(error) { toast('导入未完成：请使用有效的个人手账或真实规范化 MCP 文件。示例与个人记录不能混合；冲突或超限文件不会覆盖现有内容。'); }
    finally {event.target.value='';}
  });
  render();
  if (archive.entries.some(e => e.origin === 'mcp')) { save(); setView('journal'); }
})();
