'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/meal-calendar.js');
test('date validation rejects rollover, unpadded input, invalid centuries and unsupported years',()=>{
  for(const value of ['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','2026-1-1','1900-02-29','0000-01-01','10000-01-01','2026-10-11T00:00:00Z','2026-10-11 ',null])assert.equal(C.parseDate(value),null,String(value));
  assert.deepEqual(C.parseDate('2000-02-29'),{year:2000,month:2,day:29});
  assert.equal(C.formatDate('0001-01-01'),'0001-01-01');
  assert.throws(()=>C.formatDate({year:2026,month:2,day:31}),RangeError);
});
test('month navigation preserves days where possible and clamps only after real input validation',()=>{
  assert.equal(C.shiftMonth('2026-01-31',1),'2026-02-28');
  assert.equal(C.shiftMonth('2024-01-31',1),'2024-02-29');
  assert.equal(C.shiftMonth('2026-12-11',1),'2027-01-11');
  assert.equal(C.shiftMonth('2026-01-11',-1),'2025-12-11');
  assert.throws(()=>C.shiftMonth('2026-02-31',1),RangeError);
  assert.throws(()=>C.shiftMonth('0001-01-01',-1),RangeError);
  assert.throws(()=>C.shiftMonth('9999-12-31',1),RangeError);
});
test('day navigation uses calendar days across leap days, month/year boundaries and DST',()=>{
  assert.equal(C.addDays('2024-03-01',-1),'2024-02-29');
  assert.equal(C.addDays('2026-01-01',-1),'2025-12-31');
  assert.equal(C.addDays('2026-12-31',1),'2027-01-01');
  assert.equal(C.addDays('2026-03-08',1),'2026-03-09');
  assert.equal(C.addDays('0099-12-31',1),'0100-01-01');
  assert.equal(C.weekday('0001-01-01'),0);
  assert.throws(()=>C.addDays('2026-02-31',1),RangeError);
  assert.throws(()=>C.addDays('0001-01-01',-1),RangeError);
  assert.throws(()=>C.addDays('9999-12-31',1),RangeError);
});
test('month grid starts on Monday, contains every real date once, and keeps six stable weeks',()=>{
  const grid=C.monthGrid(2026,10);
  assert.equal(grid.length,42);
  assert.equal(grid[0].date,'2026-09-28');
  assert.equal(C.weekday(grid[0].date),0);
  assert.deepEqual(grid.filter(cell=>cell.inMonth).map(cell=>cell.day),Array.from({length:31},(_,index)=>index+1));
  assert.equal(new Set(grid.map(cell=>cell.date)).size,42);
  for(let index=1;index<42;index++)assert.equal(grid[index].date,C.addDays(grid[index-1].date,1));
  assert.equal(C.monthGrid(2024,2).filter(cell=>cell.inMonth).length,29);
  assert.equal(C.monthGrid(9999,12).some(cell=>cell===null),true);
  assert.throws(()=>C.monthGrid(2026,13),RangeError);
});
test('today shortcuts use the provided local clock instead of UTC ISO truncation',()=>{
  const local=new Date(2026,9,11,0,15);
  assert.equal(C.today(local),'2026-10-11');
  assert.equal(C.today(()=>local),'2026-10-11');
  assert.equal(C.today('2024-03-01'),'2024-03-01');
  assert.equal(C.addDays(C.today('2024-03-01'),-1),'2024-02-29');
  const previousZone=process.env.TZ;
  try {
    process.env.TZ='Asia/Shanghai';
    const midnight=new Date('2026-10-10T16:15:00Z');
    assert.equal(C.today(midnight),'2026-10-11');
    assert.equal(midnight.toISOString().slice(0,10),'2026-10-10');
  } finally {
    if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;
  }
});
