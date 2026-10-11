(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MealCatalog = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const DEFAULT_CATEGORIES = [
    {id:'combos',label:'套餐'}, {id:'burgers',label:'汉堡和卷'},
    {id:'snacks',label:'小食'}, {id:'drinks',label:'饮品'},
    {id:'breakfast',label:'早餐'}, {id:'desserts',label:'甜品'}
  ];
  const key = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('zh-CN') : '';
  const itemsOf = catalog => Array.isArray(catalog) ? catalog : (catalog?.items || []);
  function indexOf(catalog) {
    const index = new Map();
    for (const item of itemsOf(catalog)) for (const name of [item.name,...(item.aliases || [])]) {
      if (key(name) && !index.has(key(name))) index.set(key(name),item);
    }
    return index;
  }
  function personalFrequency(entries, catalog = []) {
    if (entries?.data_kind === 'synthetic') return [];
    entries = Array.isArray(entries) ? entries : (entries?.entries || []);
    const catalogIndex = indexOf(catalog), meals = new Map(), counts = new Map();
    entries.forEach((entry, position) => {
      if (!entry || entry.confirmed === false || entry.source === 'synthetic' || entry.kind === 'plan') return;
      const mealId = entry.id ? 'id:'+entry.id : 'position:'+position;
      let meal = meals.get(mealId);
      if (!meal) { meal = {date:'',foods:new Map()}; meals.set(mealId,meal); }
      if (typeof entry.date === 'string' && entry.date > meal.date) meal.date = entry.date;
      for (const raw of (Array.isArray(entry.foods) ? entry.foods : [])) {
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (!name) continue;
        const item = catalogIndex.get(key(name));
        const canonical = item?.name || name;
        meal.foods.set(key(canonical), {item,name:canonical});
      }
    });
    for (const meal of meals.values()) for (const [canonical,food] of meal.foods) {
      const existing = counts.get(canonical);
      if (existing) {
        existing.count++;
        if (meal.date > existing.last_date) existing.last_date = meal.date;
      } else counts.set(canonical, {...(food.item || {}), name:food.name,
        id:food.item?.id || 'history:'+canonical,category:food.item?.category || 'history',
        categories:food.item?.categories || [food.item?.category || 'history'],
        count:1,last_date:meal.date,is_history_only:!food.item});
    }
    return sort([...counts.values()], 'frequency');
  }
  function sort(items, mode = 'category', frequencies = [], categories = DEFAULT_CATEGORIES) {
    const frequency = new Map((Array.isArray(frequencies) ? frequencies : []).map(item => [key(item.name),item]));
    const ranks = new Map(categories.map((category,position) => [category.id,position]));
    const indexed = items.map((item,position) => ({item,position}));
    const count = item => Number(frequency.get(key(item.name))?.count ?? item.count ?? 0);
    const date = item => frequency.get(key(item.name))?.last_date || item.last_date || '';
    indexed.sort((a,b) => {
      if (mode === 'frequency') return count(b.item)-count(a.item) || date(b.item).localeCompare(date(a.item)) || a.position-b.position;
      if (mode === 'name') return a.item.name.localeCompare(b.item.name,'zh-CN') || a.position-b.position;
      return (ranks.get(a.item.category) ?? categories.length)-(ranks.get(b.item.category) ?? categories.length) || a.position-b.position;
    });
    return indexed.map(({item}) => ({...item,count:count(item)}));
  }
  function filter(catalog, category = 'all', entries = []) {
    if (category === 'frequent') return personalFrequency(entries,catalog);
    return itemsOf(catalog).filter(item => category === 'all' || item.category === category || item.categories?.includes(category)).map(item=>({...item}));
  }
  function groups(items, categories = DEFAULT_CATEGORIES) {
    const result = categories.map(category=>({...category,items:items.filter(item=>item.category===category.id)})).filter(group=>group.items.length);
    const other = items.filter(item=>!categories.some(category=>category.id===item.category));
    if (other.length) result.push({id:'history',label:'以前吃过',items:other});
    return result;
  }
  function create(catalog) {
    const categories = catalog?.categories || DEFAULT_CATEGORIES;
    return {
      categories:[{id:'frequent',label:'我的常吃'},...categories],
      personalFrequency:entries=>personalFrequency(entries,catalog),
      filter:(category='all',options={})=>sort(filter(catalog,category,options.entries),options.sort || (category==='frequent'?'frequency':'category'),personalFrequency(options.entries,catalog),categories),
      groups:items=>groups(items,categories),
      sort:(items,mode,entries)=>sort(items,mode,personalFrequency(entries,catalog),categories)
    };
  }
  return {DEFAULT_CATEGORIES,personalFrequency,sort,filter,groups,create};
});
