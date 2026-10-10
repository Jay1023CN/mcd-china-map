/* Album presentation choices, stored with the journal and merged by collection id. */
(function(root,factory){
  const api=factory();if(typeof module==='object' && module.exports)module.exports=api;if(root)root.CollectionPreferences=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function fail(){throw new Error('invalid collection preferences');}
  function text(value,max){if(typeof value!=='string' || value.length>max || /[\x00-\x1f\x7f]/.test(value))fail();return value.trim();}
  function ids(value,max){if(!Array.isArray(value) || value.length>max)fail();return [...new Set(value.map(id=>{const result=text(id,100);if(!result)fail();return result;}))];}
  function normalize(values){
    if(!Array.isArray(values) || values.length>1000)fail();const seen=new Set();
    return values.map(value=>{
      if(!value || typeof value!=='object' || Array.isArray(value))fail();
      const id=text(value.id,200);if(!/^(city:.+|month:\d{4}-(0[1-9]|1[0-2]))$/.test(id) || seen.has(id))fail();seen.add(id);
      const result={id};
      if(value.cover_id!==undefined){const cover=text(value.cover_id,100);if(cover)result.cover_id=cover;}
      if(value.selected_ids!==undefined)result.selected_ids=ids(value.selected_ids,12);
      if(value.photo_ids!==undefined)result.photo_ids=ids(value.photo_ids,3);
      if(value.caption!==undefined){const caption=text(value.caption,id.startsWith('month:')?100:140);if(caption)result.caption=caption;}
      if(value.layout!==undefined){if(!['strip','feature'].includes(value.layout))fail();result.layout=value.layout;}
      return result;
    });
  }
  function get(values,id){return (values || []).find(value=>value.id===id) || {id};}
  function update(values,id,patch){
    const next=normalize(values || []),index=next.findIndex(value=>value.id===id);
    const row={...(index<0?{id}:next[index]),...patch,id};
    if(index<0)next.push(row);else next[index]=row;return normalize(next);
  }
  return Object.freeze({normalize,get,update});
});
