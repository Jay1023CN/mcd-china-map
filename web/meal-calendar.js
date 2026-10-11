(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MealCalendar = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const WEEKDAYS = ['一','二','三','四','五','六','日'];
  let nextId = 0;
  function daysInMonth(year, month) {
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return 0;
    if (month === 2) return year%4===0 && (year%100!==0 || year%400===0) ? 29 : 28;
    return [4,6,9,11].includes(month) ? 30 : 31;
  }
  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year,month,day] = value.split('-').map(Number);
    return day >= 1 && day <= daysInMonth(year,month) ? {year,month,day} : null;
  }
  function dateParts(value) {
    if (typeof value === 'string') return parseDate(value);
    if (!value || !Number.isInteger(value.day) || value.day < 1 || value.day > daysInMonth(value.year,value.month)) return null;
    return {year:value.year,month:value.month,day:value.day};
  }
  function formatDate(value) {
    const date = dateParts(value);
    if (!date) throw new RangeError('日期无效');
    return `${String(date.year).padStart(4,'0')}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`;
  }
  function utcDate(value) {
    const date = dateParts(value);
    if (!date) throw new RangeError('日期无效');
    // setUTCFullYear avoids the special 1900 offset of Date.UTC for years 1–99.
    const instant = new Date(0);
    instant.setUTCHours(12,0,0,0);
    instant.setUTCFullYear(date.year,date.month-1,date.day);
    return instant;
  }
  function addDays(value, amount) {
    if (!Number.isInteger(amount) || Math.abs(amount)>3660000) throw new RangeError('日期偏移无效');
    const instant = utcDate(value);
    instant.setUTCDate(instant.getUTCDate()+amount);
    return formatDate({year:instant.getUTCFullYear(),month:instant.getUTCMonth()+1,day:instant.getUTCDate()});
  }
  function shiftMonth(value, amount) {
    const date = dateParts(value);
    if (!date || !Number.isInteger(amount)) throw new RangeError('日期无效');
    const absolute = (date.year-1)*12+date.month-1+amount;
    if (absolute < 0 || absolute >= 9999*12) throw new RangeError('日期超出范围');
    const year = Math.floor(absolute/12)+1, month=absolute%12+1;
    return formatDate({year,month,day:Math.min(date.day,daysInMonth(year,month))});
  }
  function weekday(value) { return (utcDate(value).getUTCDay()+6)%7; }
  function monthGrid(year, month) {
    if (!daysInMonth(year,month)) throw new RangeError('月份无效');
    const first = formatDate({year,month,day:1}), offset = weekday(first);
    return Array.from({length:42},(_,index)=>{
      try {
        const date = addDays(first,index-offset), parts=parseDate(date);
        return {...parts,date,inMonth:parts.year===year && parts.month===month};
      } catch (error) { if (error instanceof RangeError) return null; throw error; }
    });
  }
  function today(now = new Date()) {
    if (typeof now === 'function') now = now();
    if (typeof now === 'string') return formatDate(now);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('当前日期无效');
    return formatDate({year:now.getFullYear(),month:now.getMonth()+1,day:now.getDate()});
  }
  function create(options) {
    if (!options?.container?.ownerDocument) throw new TypeError('需要日历容器');
    const container = options.container, doc=container.ownerDocument;
    const titleId = `meal-calendar-title-${++nextId}`;
    const currentDay = ()=>today(options.now === undefined ? new Date() : options.now);
    let selected = options.value ? formatDate(options.value) : currentDay();
    let active=selected, opened=false, opener=null, destroyed=false;
    const element=(tag,className,text)=>{
      const result=doc.createElement(tag);
      if(className)result.className=className;
      if(text!==undefined)result.textContent=text;
      return result;
    };
    const button=(text,className,action)=>{
      const result=element('button',className,text);result.type='button';
      result.addEventListener('click',action);return result;
    };
    function close() {
      if(!opened)return;
      opened=false;container.hidden=true;doc.removeEventListener('pointerdown',outside);
      if(opener?.isConnected && typeof opener.focus==='function')opener.focus();
      options.onClose?.();
    }
    function select(value) {
      selected=formatDate(value);
      try { options.onSelect?.(selected); } finally { close(); }
    }
    function changeMonth(amount, control) {
      try { active=shiftMonth(active,amount); } catch (error) { if(error instanceof RangeError)return;throw error; }
      render(false);
      container.querySelector(`[data-calendar-control="${control}"]`)?.focus();
    }
    function render(focusDay) {
      const view=parseDate(active), current=currentDay();
      const currentParts=parseDate(current);
      container.replaceChildren();container.classList.add('meal-calendar');
      container.setAttribute('role','dialog');container.setAttribute('aria-labelledby',titleId);
      const header=element('div','meal-calendar-header');
      const previous=button('‹','meal-calendar-nav',()=>changeMonth(-1,'previous'));
      previous.dataset.calendarControl='previous';previous.setAttribute('aria-label','上一个月');
      previous.disabled=view.year===1 && view.month===1;
      const title=element('h3','meal-calendar-title',`${view.year}年${view.month}月`);
      title.id=titleId;title.setAttribute('aria-live','polite');
      const next=button('›','meal-calendar-nav',()=>changeMonth(1,'next'));
      next.dataset.calendarControl='next';next.setAttribute('aria-label','下一个月');
      next.disabled=(view.year===9999 && view.month===12) || (!options.allowFuture && (view.year>currentParts.year || view.year===currentParts.year && view.month>=currentParts.month));
      header.append(previous,title,next);container.append(header);
      const grid=element('div','meal-calendar-grid');grid.setAttribute('role','grid');grid.setAttribute('aria-label',`${view.year}年${view.month}月，选择${options.dateLabel || '打卡'}日期`);
      const row=()=>{const result=element('div','meal-calendar-week');result.setAttribute('role','row');result.style.display='grid';result.style.gridTemplateColumns='repeat(7,minmax(0,1fr))';return result;};
      const headings=row();
      for(const label of WEEKDAYS){const cell=element('span','meal-calendar-weekday',label);cell.setAttribute('role','columnheader');headings.append(cell);}
      grid.append(headings);
      const cells=monthGrid(view.year,view.month);
      for(let start=0;start<42;start+=7){
        const week=row();
        for(const cell of cells.slice(start,start+7)){
          const holder=element('div','meal-calendar-cell');holder.setAttribute('role','gridcell');
          if(cell){
            holder.setAttribute('aria-selected',String(cell.date===selected));
            const day=button(String(cell.day),'meal-calendar-day',()=>select(cell.date));
            day.dataset.calendarDate=cell.date;day.tabIndex=cell.date===active?0:-1;
            day.disabled=!options.allowFuture && cell.date>current;
            day.style.width='100%';
            if(cell.date===selected)day.classList.add('is-selected');
            if(cell.date===current){day.classList.add('is-today');day.setAttribute('aria-current','date');}
            if(!cell.inMonth)day.classList.add('is-outside');
            day.setAttribute('aria-label',`${cell.year}年${cell.month}月${cell.day}日，星期${WEEKDAYS[weekday(cell.date)]}${cell.date===current?'，今天':''}${cell.date===selected?'，已选择':''}`);
            day.addEventListener('focus',()=>{active=cell.date;for(const item of container.querySelectorAll('[data-calendar-date]'))item.tabIndex=item===day?0:-1;});
            holder.append(day);
          }
          week.append(holder);
        }
        grid.append(week);
      }
      container.append(grid);
      const shortcuts=element('div','meal-calendar-shortcuts');
      const yesterday=button('昨天','meal-calendar-shortcut',()=>select(addDays(currentDay(),-1)));
      yesterday.disabled=current==='0001-01-01';
      shortcuts.append(button('今天','meal-calendar-shortcut',()=>select(currentDay())),yesterday,button('收起','meal-calendar-close',close));
      container.append(shortcuts);
      if(focusDay)container.querySelector(`[data-calendar-date="${active}"]`)?.focus();
    }
    function outside(event) { if(!container.contains(event.target))close(); }
    function keydown(event) {
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      const day=event.target.closest?.('[data-calendar-date]');
      if(!day || !container.contains(day))return;
      let next;
      try {
        if(event.key==='ArrowLeft')next=addDays(day.dataset.calendarDate,-1);
        else if(event.key==='ArrowRight')next=addDays(day.dataset.calendarDate,1);
        else if(event.key==='ArrowUp')next=addDays(day.dataset.calendarDate,-7);
        else if(event.key==='ArrowDown')next=addDays(day.dataset.calendarDate,7);
        else if(event.key==='Home')next=addDays(day.dataset.calendarDate,-weekday(day.dataset.calendarDate));
        else if(event.key==='End')next=addDays(day.dataset.calendarDate,6-weekday(day.dataset.calendarDate));
        else if(event.key==='PageUp')next=shiftMonth(day.dataset.calendarDate,event.shiftKey?-12:-1);
        else if(event.key==='PageDown')next=shiftMonth(day.dataset.calendarDate,event.shiftKey?12:1);
        else if(event.key==='Enter' || event.key===' '){event.preventDefault();select(day.dataset.calendarDate);return;}
        else return;
      } catch(error){if(!(error instanceof RangeError))throw error;event.preventDefault();return;}
      if(!options.allowFuture && next>currentDay()){event.preventDefault();return;}
      event.preventDefault();active=next;render(true);
    }
    container.addEventListener('keydown',keydown);container.hidden=true;
    return {
      open(value) {
        if(destroyed)throw new Error('日历已销毁');
        if(value!==undefined)selected=value ? formatDate(value) : currentDay();
        if(!opened)opener=doc.activeElement;
        active=selected;opened=true;container.hidden=false;render(true);
        doc.addEventListener('pointerdown',outside);
      },
      close,
      setValue(value){selected=formatDate(value);active=selected;if(opened)render(true);},
      getValue(){return selected;},
      isOpen(){return opened;},
      destroy(){close();destroyed=true;container.removeEventListener('keydown',keydown);container.replaceChildren();}
    };
  }
  return {WEEKDAYS,daysInMonth,parseDate,formatDate,addDays,shiftMonth,weekday,monthGrid,today,create};
});
