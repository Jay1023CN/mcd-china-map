'use strict';

async function selectMealDate(page, value) {
  const match=/^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if(!match)throw new TypeError('打卡日期必须是 YYYY-MM-DD');
  const target=Number(match[1])*12+Number(match[2])-1;
  await page.locator('#meal-date-value').click();
  for(let attempt=0;attempt<240;attempt++){
    const label=await page.locator('#meal-calendar .meal-calendar-title').innerText();
    const currentMatch=/^(\d{4})年(\d{1,2})月$/.exec(label);
    if(!currentMatch)throw new Error('日历月份标题无效：'+label);
    const current=Number(currentMatch[1])*12+Number(currentMatch[2])-1;
    if(current===target)break;
    const control=page.locator(`#meal-calendar [aria-label="${current<target?'下一个月':'上一个月'}"]`);
    if(await control.isDisabled())throw new RangeError('不能选择晚于今天的打卡日期');
    await control.click();
  }
  await page.locator(`#meal-calendar [data-calendar-date="${value}"]`).click();
  if(await page.locator('#meal-date-value').inputValue()!==value)throw new Error('打卡日期没有写入表单');
}

module.exports={selectMealDate};
