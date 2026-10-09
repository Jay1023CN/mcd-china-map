(function () {
  'use strict';
  const data = JSON.parse(document.getElementById('journal-data').textContent);
  const E = window.JournalEngine;
  const $ = id => document.getElementById(id);
  const names = new Map(data.countries.map(c => [c.code, c.name]));
  const countryName = code => names.get(code) || code;
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const opts = () => ({today: today(), countries: data.countries});
  const personalKey = 'mcd-world-passport-personal-v1';
  const demoKey = 'mcd-world-passport-demo-v1';
  let key = data.archive.data_kind === 'synthetic' ? demoKey : personalKey;
  let archive = E.normalizeArchive(data.archive, opts());
  let persistent = false;
  let view = 'map';
  let currentSummary;
  let currentEntry = null;
  let photo = null;
  let photoBusy = false;
  let photoRevision = 0;
  let mapPoints = [];
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
      localStorage.setItem(key, JSON.stringify(archive));
      persistent = true;
    } catch (error) {
      persistent = false;
      toast('浏览器暂时无法保存。记录仍在本页，请立即导出 JSON 备份。');
    }
  }
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const prior = E.normalizeArchive(JSON.parse(stored), opts());
      if ((key === demoKey) !== (prior.data_kind === 'synthetic')) throw new Error('archive storage kind mismatch');
      if (archive.data_kind !== 'synthetic' && prior.data_kind !== 'synthetic') {
        const ids = new Set(prior.entries.map(e => e.id));
        prior.entries.push(...archive.entries.filter(e => !ids.has(e.id)));
      }
      archive = E.normalizeArchive(prior, opts());
      persistent = true;
    }
  } catch (error) {
    toast('未能读取浏览器记录，已打开文件中的初始内容。原浏览器备份未被覆盖。');
  }

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
    save();
    render();
    toast('个人手账已开启。你添加的记录才是你的打卡。');
    return true;
  }
  function setView(next) {
    view = next;
    for (const name of ['map', 'journal', 'candidates']) {
      $('tab-' + name).setAttribute('aria-selected', String(name === next));
      $('tab-' + name).tabIndex = name === next ? 0 : -1;
      $('pane-' + name).hidden = name !== next;
    }
    if (next === 'map') requestAnimationFrame(drawMap);
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelector('[role=tablist]').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = ['map', 'journal', 'candidates'];
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (keys.indexOf(view) + delta + 3) % 3;
    event.preventDefault(); setView(keys[index]); $('tab-' + keys[index]).focus();
  });

  function refillFilters() {
    const year = $('year-filter').value;
    const country = $('country-filter').value;
    const years = [...new Set(archive.entries.map(e => e.date.slice(0, 4)))].sort().reverse();
    $('year-filter').replaceChildren(new Option('全部年份', ''), ...years.map(y => new Option(y + ' 年', y)));
    $('year-filter').value = years.includes(year) ? year : '';
    const codes = [...new Set(archive.entries.map(e => e.country_code))].sort((a,b) => countryName(a).localeCompare(countryName(b), 'zh'));
    $('country-filter').replaceChildren(new Option('全部国家 / 地区', ''), ...codes.map(c => new Option(countryName(c), c)));
    $('country-filter').value = codes.includes(country) ? country : '';
  }
  function render() {
    refillFilters();
    currentSummary = E.summarize(archive, {...opts(), year: $('year-filter').value, country_code: $('country-filter').value});
    const s = currentSummary;
    $('count-visits').textContent = s.confirmedCount;
    $('count-countries').textContent = s.distinctCountries;
    $('count-cities').textContent = s.distinctCities;
    $('count-stores').textContent = s.distinctStores;
    $('candidate-count').textContent = s.candidateCount;
    $('save-status').textContent = persistent ? '已保存在本浏览器 · 导出备份可换设备' : '当前在本页内使用 · 请导出备份';
    $('mode-description').textContent = archive.data_kind === 'synthetic'
      ? '示例手账：下方门店、旅行和餐品记录均为虚构，地图点只示意城市中心，不是你的记录。'
      : '个人手账：只统计你确认的本人打卡。中国大陆订单是待确认线索，全球其他地区由你手动记录。';
    $('start-personal').hidden = archive.data_kind !== 'synthetic';
    renderPassport(s);
    renderRecent(s);
    renderEntries(s);
    renderCandidates(s);
    $('month-list').replaceChildren(...s.months.map(m => {
      const chip = node('span', m.month, 'month-chip'); chip.append(node('b', m.count + ' 页')); return chip;
    }));
    if (!s.months.length) $('month-list').append(node('p', '写下第一条本人打卡，这里就会留下月份记录。', 'map-note'));
    setView(view);
  }
  function renderPassport(s) {
    const grid = $('passport-grid'); grid.replaceChildren();
    for (const country of s.countries) {
      const stamp = node('button', undefined, 'stamp'); stamp.type = 'button';
      stamp.append(node('b', country.country_code), node('strong', countryName(country.country_code)), node('small', `${country.count} 页 · ${country.cityCount} 城市`));
      stamp.setAttribute('aria-label', `筛选${countryName(country.country_code)}的打卡`);
      stamp.addEventListener('click', () => { $('country-filter').value = country.country_code; render(); });
      grid.append(stamp);
    }
    if (!s.countries.length) grid.append(empty('第一枚印章，等你来盖', '新增并确认一条本人打卡，就会留下国家 / 地区印章。'));
  }
  function renderRecent(s) {
    $('recent-list').replaceChildren();
    for (const entry of s.entries.slice(0, 3)) {
      const row = node('li'); const button = node('button'); button.type = 'button';
      button.append(node('strong', entry.store), node('small', `${entry.date} / ${countryName(entry.country_code)} · ${entry.city}`));
      button.addEventListener('click', () => openDetail(entry)); row.append(button); $('recent-list').append(row);
    }
    if (!s.entries.length) $('recent-list').append(empty('从一家麦当劳开始', '记录一顿早餐、一张纸袋，或旅行途中熟悉的味道。'));
  }
  function photoNode(entry) {
    const image = node('img', undefined, 'photo'); image.src = entry.photo.data_url;
    image.alt = `${entry.city} ${entry.store}的本人打卡照片`;
    image.addEventListener('error', () => { image.hidden = true; });
    return image;
  }
  function foodTags(entry) {
    const tags = node('div', undefined, 'food-tags');
    for (const food of entry.foods) tags.append(node('span', food));
    if (entry.collaboration) tags.append(node('span', '联名 · ' + entry.collaboration));
    return tags;
  }
  function renderEntries(s) {
    const grid = $('journal-grid'); grid.replaceChildren();
    for (const entry of s.entries) {
      const card = node('article', undefined, 'entry-card');
      card.append(node('span', entry.date, 'date'));
      if (entry.photo) card.append(photoNode(entry));
      card.append(node('h3', entry.store), node('p', `${countryName(entry.country_code)} / ${entry.city}`, 'place'), foodTags(entry));
      if (entry.note) card.append(node('p', entry.note, 'note'));
      card.append(node('p', entry.origin === 'mcp' ? '中国订单线索 → 本人确认到店' : '本人手动记录', 'origin'));
      const actions = node('div', undefined, 'entry-buttons');
      const edit = node('button', '编辑这一页'); edit.type = 'button'; edit.addEventListener('click', () => openForm(entry));
      const details = node('button', '翻开'); details.type = 'button'; details.addEventListener('click', () => openDetail(entry));
      const remove = node('button', '删除', 'delete'); remove.type = 'button'; remove.addEventListener('click', () => removeEntry(entry));
      actions.append(edit, details, remove); card.append(actions); grid.append(card);
    }
    if (!s.entries.length) grid.append(empty('这一页还是空白', '点击右上角“新增打卡”，或到“待确认订单”补齐一条本人到店记录。'));
  }
  function renderCandidates(s) {
    const grid = $('candidate-grid'); grid.replaceChildren();
    for (const entry of s.candidateEntries) {
      const card = node('article', undefined, 'entry-card candidate');
      card.append(node('span', entry.date, 'date'), node('h3', entry.store), node('p', entry.city || '城市未提供 · 确认时补齐', 'place'), foodTags(entry), node('p', '订单线索，尚未计入打卡或印章。', 'origin'));
      const confirm = node('button', '补齐并确认本人到店', 'primary'); confirm.type = 'button'; confirm.addEventListener('click', () => openForm(entry));
      const skip = node('button', '不计这条线索', 'quiet'); skip.type = 'button'; skip.style.marginTop = '8px'; skip.style.width = '100%'; skip.addEventListener('click', () => removeEntry(entry));
      card.append(confirm, skip); grid.append(card);
    }
    if (!s.candidateEntries.length) grid.append(empty('没有待确认的订单线索', '可导入中国大陆的规范化 MCP 订单文件；海外旅行用“新增打卡”记录。'));
  }

  function drawMap() {
    const canvas = $('world-map');
    const width = Math.max(1, canvas.clientWidth);
    const height = width / 2;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const xy = (lon,lat) => [(lon + 180) / 360 * width, (90 - lat) / 180 * height];
    ctx.fillStyle = '#f3eddb'; ctx.fillRect(0,0,width,height);
    ctx.fillStyle = '#dfd6bb'; ctx.strokeStyle = '#b8a985'; ctx.lineWidth = .6;
    for (const feature of data.land.features) {
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of polygons) {
        ctx.beginPath();
        for (const ring of polygon) {
          let previous = null;
          ring.forEach((coordinate,i) => {
            const point = xy(coordinate[0],coordinate[1]);
            if (i===0 || (previous && Math.abs(previous[0]-coordinate[0])>180)) ctx.moveTo(...point); else ctx.lineTo(...point);
            previous = coordinate;
          });
          ctx.closePath();
        }
        ctx.fill('evenodd'); ctx.stroke();
      }
    }
    mapPoints=[];
    for (const entry of currentSummary.entries.filter(e => e.location)) {
      const [x,y] = xy(entry.location.lon,entry.location.lat);
      ctx.beginPath(); ctx.arc(x,y,4.5,0,2*Math.PI); ctx.fillStyle='#dc442e'; ctx.fill(); ctx.strokeStyle='#fff9eb'; ctx.lineWidth=1.5; ctx.stroke();
      mapPoints.push({x,y,entry});
    }
    const pointList = $('map-points'); pointList.replaceChildren();
    const cities = new Map();
    for (const point of mapPoints) {
      const id = point.entry.country_code + ' / ' + point.entry.city;
      if (!cities.has(id)) cities.set(id,point.entry);
    }
    for (const entry of cities.values()) {
      const button=node('button', countryName(entry.country_code)+' · '+entry.city, 'map-point'); button.type='button'; button.addEventListener('click',()=>openDetail(entry)); pointList.append(button);
    }
    const noLocation = currentSummary.confirmedCount - mapPoints.length;
    $('map-note').textContent = mapPoints.length
      ? `${mapPoints.length} 条打卡有位置标记；${noLocation} 条仅记文字。点城市标签或地图圆点，翻开手账。`
      : '还没有可绘制的位置。填写常用城市或自行提供坐标即可标记，文字记录仍可收集印章。';
  }
  $('world-map').addEventListener('click', event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX-rect.left, y = event.clientY-rect.top;
    const nearest = mapPoints.map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.d-b.d)[0];
    if(nearest && nearest.d<18) openDetail(nearest.entry);
  });
  window.addEventListener('resize', () => { if(view==='map') requestAnimationFrame(drawMap); });

  function updateCitySuggestions() {
    const matches=data.cities.filter(c=>c.country_code===field('country_code').value);
    $('city-suggestions').replaceChildren(...matches.map(c=>new Option(c.city,c.city)));
    updateLocationHelp();
  }
  function matchCity() {
    const value=field('city').value.normalize('NFKC').trim().toLowerCase();
    return data.cities.find(c=>c.country_code===field('country_code').value && [c.city,c.city_en].some(n=>n && n.normalize('NFKC').trim().toLowerCase()===value));
  }
  function updateLocationHelp() {
    const mode=field('location_mode').value;
    $('coord-fields').hidden=mode!=='user';
    field('lat').required=mode==='user'; field('lon').required=mode==='user';
    const match=matchCity();
    $('location-help').textContent=mode==='none' ? '只保留文字打卡，不在地图上显示。' : mode==='user' ? '坐标由你填写；不自动查询或读取定位。' : match ? `已匹配${match.city}城市中心；不代表门店精确位置。` : '尚未匹配常用城市中心；仍可保存文字，或改为自己填写坐标。';
  }
  function showPhoto() {
    $('photo-preview').hidden=!photo;
    $('photo-actions').hidden=!photo;
    if(photo) $('photo-preview').src=photo.data_url; else $('photo-preview').removeAttribute('src');
  }
  function openForm(entry=null) {
    if (entry && archive.data_kind === 'synthetic') {
      toast('这条是虚构示例。请用“新增打卡”开始记录你本人的到访。');
      return;
    }
    if(!startPersonal()) return;
    photoRevision++;
    currentEntry=entry;
    form.reset(); photo=entry && entry.photo ? {...entry.photo} : null;
    photoBusy=false; $('save-entry').disabled=false;
    $('form-heading').textContent=entry && entry.source==='mcp_candidate' ? '把订单线索写成打卡' : entry ? '修改这一页手账' : '新添一页打卡';
    $('form-note').textContent=entry && entry.source==='mcp_candidate' ? '这条中国大陆订单可能是外送或替别人点单。请确认本人确曾到店，并补齐城市。' : '记录你本人到过的麦当劳。世界各地都可以手动添加。';
    field('date').max=today(); field('date').value=entry ? entry.date : today();
    field('country_code').value=entry ? entry.country_code : 'CN';
    field('country_code').disabled=!!(entry && (entry.source==='mcp_candidate' || entry.origin==='mcp'));
    for (const name of ['city','store','note','collaboration']) field(name).value=entry && entry[name] ? entry[name] : '';
    field('foods').value=entry ? entry.foods.join('，') : '';
    field('confirmed').checked=!!(entry && entry.confirmed);
    if(entry && entry.location) {
      field('location_mode').value=entry.location.precision==='user' ? 'user':'city';
      field('lat').value=entry.location.lat; field('lon').value=entry.location.lon;
    } else field('location_mode').value=entry ? 'none':'city';
    $('form-error').hidden=true; showPhoto(); updateCitySuggestions();
    $('entry-dialog').showModal(); field('date').focus();
  }
  field('country_code').addEventListener('change',updateCitySuggestions);
  field('city').addEventListener('input',updateLocationHelp);
  field('location_mode').addEventListener('change',updateLocationHelp);
  field('photo').addEventListener('change', async event => {
    const file=event.target.files[0]; if(!file) return;
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
  });
  $('remove-photo').addEventListener('click',()=>{photoRevision++;photoBusy=false;$('save-entry').disabled=false;field('photo').value='';photo=null;showPhoto();});
  form.addEventListener('submit',event=>{
    event.preventDefault(); if(photoBusy) return;
    try {
      const entry={id:currentEntry ? currentEntry.id : 'manual-'+(crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2)),
        date:field('date').value,country_code:field('country_code').value,city:field('city').value,store:field('store').value,
        foods:field('foods').value,note:field('note').value,collaboration:field('collaboration').value,source:'manual',confirmed:field('confirmed').checked};
      if(currentEntry && (currentEntry.source==='mcp_candidate' || currentEntry.origin==='mcp')) entry.origin='mcp';
      const mode=field('location_mode').value;
      if(mode==='user') entry.location={lat:Number(field('lat').value),lon:Number(field('lon').value),precision:'user'};
      if(mode==='city') {
        const match=matchCity();
        if(match) entry.location={lat:match.lat,lon:match.lon,precision:'city'};
        else if(currentEntry && currentEntry.location && currentEntry.location.precision==='city' && currentEntry.city===entry.city && currentEntry.country_code===entry.country_code) entry.location=currentEntry.location;
      }
      if(photo) entry.photo=photo;
      const normalized=E.normalizeEntry(entry,opts());
      const next={...archive,data_kind:'manual',entries:archive.entries.filter(e=>e.id!==normalized.id).concat(normalized)};
      archive=E.normalizeArchive(next,opts()); save(); $('entry-dialog').close(); render(); setView('journal'); toast(persistent?'这一页已保存在本浏览器。':'这一页已加入；请立即导出备份。');
    } catch(error) { $('form-error').textContent='未能保存：请检查必填内容、日期、坐标和照片大小。'; $('form-error').hidden=false; }
  });
  function removeEntry(entry) {
    if(!window.confirm(entry.source==='mcp_candidate' ? '移除这条未确认线索？不会改变麦当劳订单。' : '删除这一页手账？原麦当劳订单不会受到影响。')) return;
    archive={...archive,entries:archive.entries.filter(e=>e.id!==entry.id)}; save(); render(); toast('记录已移除。');
  }
  function openDetail(entry) {
    $('detail-heading').textContent=entry.store;
    const body=$('detail-body');body.replaceChildren();
    body.append(node('p',`${entry.date} / ${countryName(entry.country_code)} · ${entry.city}`,'place'));
    if(entry.photo) body.append(photoNode(entry));
    body.append(foodTags(entry));
    if(entry.note) body.append(node('p',entry.note));
    body.append(node('p',entry.location ? (entry.location.precision==='city'?'地图使用城市中心，非门店位置。':'地图使用本人填写的坐标。'):'本页只有文字记录，没有位置标记。','map-note'));
    const edit=node('button','编辑这一页','secondary');edit.type='button';edit.addEventListener('click',()=>{$('detail-dialog').close();openForm(entry);});body.append(edit);
    $('detail-dialog').showModal();
  }
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('add-top').addEventListener('click',()=>openForm());
  $('start-personal').addEventListener('click',startPersonal);
  $('year-filter').addEventListener('change',render);$('country-filter').addEventListener('change',render);
  field('country_code').replaceChildren(...data.countries.slice().sort((a,b)=>a.name.localeCompare(b.name,'zh')).map(c=>new Option(c.name+' / '+c.code,c.code)));

  function downloadArchive() {
    const clean=E.normalizeArchive(archive,opts());
    const url=URL.createObjectURL(new Blob([JSON.stringify(clean,null,2)],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='麦麦世界护照-'+(clean.data_kind==='synthetic'?'示例-':'')+today()+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('已发起备份下载，请确认浏览器已保存文件。');
  }
  $('export').addEventListener('click',downloadArchive);$('top-export').addEventListener('click',downloadArchive);
  $('print').addEventListener('click',()=>window.print());
  $('import').addEventListener('click',()=>$('import-file').click());
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
      const incoming=E.normalizeArchive(parsed.version===1?parsed:await orderCandidates(parsed),opts());
      if(incoming.data_kind==='synthetic' && archive.data_kind!=='synthetic' && archive.entries.length) throw new Error('synthetic cannot mix with personal');
      if(archive.data_kind==='synthetic' && incoming.data_kind!=='synthetic') {
        if(!startPersonal()) return;
      }
      const combined={version:1,data_kind:incoming.data_kind==='synthetic'?'synthetic':'manual',source:incoming.source||archive.source,
        entries:archive.entries.concat(incoming.entries.filter(e=>!archive.entries.some(old=>old.id===e.id&&old.source==='manual'&&old.confirmed&&e.source==='mcp_candidate')))};
      const normalized=E.normalizeArchive(combined,opts());
      key=normalized.data_kind==='synthetic'?demoKey:personalKey;
      archive=normalized;save();render();setView(incoming.entries.some(e=>e.source==='mcp_candidate')?'candidates':'journal');toast('导入完成；候选订单仍需逐条确认本人到店。');
    } catch(error) { toast('导入未完成：请使用有效的个人手账或真实规范化 MCP 文件。示例与个人记录不能混合；冲突或超限文件不会覆盖现有内容。'); }
    finally {event.target.value='';}
  });
  render();
})();
