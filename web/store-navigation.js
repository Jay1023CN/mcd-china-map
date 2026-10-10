(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.StoreNavigation=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function clean(value,max){return typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,max):'';}
  function project(store){
    const name=clean(store?.name || store?.store,160),city=clean(store?.city,80);
    const address=clean(store?.address || store?.store_reference?.address,300);
    if(!name)return null;
    const keyword=[name,address].filter(Boolean).join(' ');
    const query=new URLSearchParams({keyword,view:'list',src:'mcd-china-map',callnative:'1'});
    if(city)query.set('city',city);
    return {name,city,address,url:'https://uri.amap.com/search?'+query.toString(),text:[city,name,address].filter(Boolean).join(' · ')};
  }
  return Object.freeze({project});
});
