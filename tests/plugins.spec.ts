import {test,expect} from '@playwright/test';
const manifest={protocol:1,id:'example.notes',name:'Third-party Notes',version:'1.2.3',appIds:['com.example.notes'],capabilities:['thumbnails']};
test('third-party records are dynamic and opt-out survives reimport',async({page})=>{
  await page.goto('/?preview=1');await page.getByRole('button',{name:'Application plugins',exact:true}).click();
  await page.getByText('Add another plugin',{exact:true}).click();
  const file=page.getByLabel('Plugin manifest',{exact:true});
  const upload=()=>file.setInputFiles({name:'beaconhop.plugin.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await upload();const row=page.locator('[data-provider="example.notes"]');
  await expect(row).toContainText('Third-party Notes');await expect(row).toContainText('1.2.3');await expect(row).toContainText('Extension not connected');
  await row.getByRole('checkbox').uncheck();await expect(row).toContainText('Disabled');
  await upload();await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button',{name:'Shortcuts',exact:true}).click();await page.getByRole('button',{name:'Application plugins',exact:true}).click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.setViewportSize({width:760,height:580});await row.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'logs/plugin-kit-20261102/manager.png'});
  await row.getByRole('button',{name:'Remove record'}).click();await expect(row).toHaveCount(0);
});
test('browser registration validates ID, and malformed import surfaces a useful error',async({page})=>{
  await page.goto('/?preview=1');await page.getByRole('button',{name:'Application plugins',exact:true}).click();
  await page.getByText('Advanced: connect a development browser extension',{exact:true}).click();
  const register=page.getByRole('button',{name:'Register',exact:true});await expect(register).toBeDisabled();
  await page.getByLabel('Extension ID',{exact:true}).fill('bad-id');await expect(register).toBeDisabled();
  await page.getByLabel('Extension ID',{exact:true}).fill('a'.repeat(32));await register.click();
  await expect(page.getByText('Registered. Click the browser extension to reconnect.',{exact:true})).toBeVisible();
  await page.getByText('Add another plugin',{exact:true}).click();
  await page.getByLabel('Plugin manifest',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.getByRole('alert')).toContainText('Invalid plugin manifest');
});
