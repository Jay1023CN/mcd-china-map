(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./chinese-search-normalization.js'));
  else root.NationalStoreSearch=factory(root.ChineseSearchNormalization);
})(typeof globalThis!=='undefined'?globalThis:this,function(chinese){
  'use strict';
  const normalize=value=>typeof value==='string'?chinese.fold(value.normalize('NFKC')).trim().toLowerCase().replace(/\s+/g,' '):'';
  const cityKey=value=>normalize(value).replace(/市$/,'');
  const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  function project(value){
    if(!value || typeof value!=='object' || !clean(value.name,200) || !clean(value.city,120))return null;
    const id=clean(value.id || value.code,160);
    if(!id)return null;
    const item={id,code:id,name:clean(value.name,200),city:clean(value.city,120),country_code:'CN',
      address:clean(value.address,500),source:clean(value.source,60),source_url:clean(value.source_url,1000),featured:value.featured===true};
    if(/^\d{6}$/.test(value.province_code || ''))item.province_code=value.province_code;
    for(const field of ['district','short_description','search_keyword','featured_name','locator_name','official_name','locality_note','record_kind','operator_name','brand_name_source_url']){
      if(typeof value[field]==='string')item[field]=clean(value[field],500);
    }
    for(const field of ['aliases','tags'])item[field]=Array.isArray(value[field])?value[field].filter(v=>typeof v==='string').map(v=>clean(v,200)).slice(0,40):[];
    const location=value.location;
    if(location && location.precision==='store' && Number.isFinite(location.lat) && Number.isFinite(location.lon) &&
      location.lat>=-90 && location.lat<=90 && location.lon>=-180 && location.lon<=180 && typeof location.coordinate_system==='string'){
      item.location={lat:location.lat,lon:location.lon,precision:'store',coordinate_system:clean(location.coordinate_system,80)};
    }
    if(value.default_photo && typeof value.default_photo==='object'){
      item.default_photo={};
      for(const field of ['url','local_asset','source_url','attribution','caption']){
        if(typeof value.default_photo[field]==='string')item.default_photo[field]=clean(value.default_photo[field],2000);
      }
    }
    return item;
  }
  function createIndex(catalog){
    const raw=Array.isArray(catalog)?catalog:catalog?.stores;
    if(!Array.isArray(raw))throw new TypeError('门店目录格式无效');
    const byId=new Map(),cityCounts=new Map(),exactNames=new Map(),rows=[];
    for(const value of raw){
      const store=project(value);
      if(!store || byId.has(store.id))continue;
      byId.set(store.id,store);
      const key=cityKey(store.city),prior=cityCounts.get(key);
      cityCounts.set(key,{city:prior?.city || store.city,province_code:store.province_code || prior?.province_code || '',count:(prior?.count || 0)+1});
      const labels=[store.name,store.featured_name,store.locator_name,...store.aliases].filter(Boolean);
      for(const label of new Set(labels.map(normalize))){
        if(!exactNames.has(label))exactNames.set(label,[]);
        exactNames.get(label).push(store);
      }
      rows.push({store,city:key,text:normalize([store.name,store.city,store.address,store.district,store.short_description,
        store.featured_name,store.locator_name,store.official_name,store.locality_note,store.search_keyword,...store.aliases,...store.tags].filter(Boolean).join(' '))});
    }
    function filtered(options={}){
      if(typeof options==='string')options={query:options};
      const query=normalize(options.query),terms=query.split(' ').filter(Boolean),city=cityKey(options.city);
      const found=rows.filter(row=>(!city || row.city===city) && (!options.province_code || row.store.province_code===options.province_code) &&
        (!options.featured || row.store.featured) && terms.every(term=>row.text.includes(term)));
      // Exact names come first, then featured stores; ties retain official order.
      found.sort((a,b)=>{
        const score=row=>(query && normalize(row.store.name)===query?2:0)+(row.store.featured?1:0);
        return score(b)-score(a);
      });
      return found.map(row=>row.store);
    }
    function search(options={}){
      if(typeof options==='string')options={query:options};
      const limit=Number.isFinite(options.limit)?Math.max(1,Math.min(200,Math.floor(options.limit))):40;
      const offset=Number.isFinite(options.offset)?Math.max(0,Math.floor(options.offset)):0;
      const found=filtered(options);
      return {total:found.length,offset,limit,has_more:offset+limit<found.length,stores:found.slice(offset,offset+limit)};
    }
    function find(name,city,province){
      const matches=(exactNames.get(normalize(name)) || []).filter(store=>(!city || cityKey(store.city)===cityKey(city)) &&
        (!province || store.province_code===province));
      return matches.length===1?matches[0]:null;
    }
    return Object.freeze({size:byId.size,search,filter:filtered,find,get:id=>byId.get(id) || null,
      cities:()=>Array.from(cityCounts.values()).sort((a,b)=>a.city.localeCompare(b.city,'zh-CN')),
      coverage:catalog?.coverage || null});
  }
  function candidate(store){
    const item=project(store);
    if(!item)return null;
    const result={source:'manual',code:item.code,name:item.name,city:item.city,address:item.address,note:''};
    if(item.province_code)result.province_code=item.province_code;
    return result;
  }
  async function load(url,options={}){
    const response=await (options.fetch || globalThis.fetch)(url,{signal:options.signal});
    if(!response.ok)throw new Error('门店目录暂时没载入，请重试。');
    return createIndex(await response.json());
  }
  return Object.freeze({createIndex,project,candidate,load});
});
