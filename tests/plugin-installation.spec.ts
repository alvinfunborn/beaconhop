import { test, expect } from '@playwright/test';
const setup=async(page:any,fixture='')=>{
  await page.goto('/?preview=1'+(fixture?'&plugins='+fixture:''));
  await page.getByRole('button',{name:'Application plugins',exact:true}).click();
};
test('new users can reach setup; unpublished Edge is not presented as installable',async({page})=>{
  await setup(page);
  const edge=page.locator('[data-installer="edge"]');
  await expect(edge).toContainText('Store installation is not available yet');
  await expect(edge.getByRole('button',{name:'Install and connect',exact:true})).toBeDisabled();
  const vscode=page.locator('[data-installer="vscode"]');
  await vscode.getByRole('button',{name:'One-click install',exact:true}).click();
  await expect(vscode).toContainText('Installed · waiting for VS Code');
  await expect(vscode).not.toContainText('Connected ·');
  await page.getByRole('button',{name:'Shortcuts',exact:true}).click();
  await page.getByRole('button',{name:'Application plugins',exact:true}).click();
  await expect(vscode).toContainText('Installed · waiting for VS Code');
  await page.evaluate(async()=>{const api=await import('/src/api.ts' as string);await api.call('save_settings',{config:{...await api.call('get_settings'),language:'zh'}});});
  await expect(page.getByRole('heading',{name:'应用插件',exact:true})).toBeVisible();
  await page.screenshot({path:'logs/plugin-onboarding-20261102/setup-zh.png'});
  await page.setViewportSize({width:760,height:580});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await vscode.scrollIntoViewIfNeeded();
  await page.screenshot({path:'logs/plugin-onboarding-20261102/setup-small.png'});
});
test('store installation waits for a real connection; retry is available',async({page})=>{
  await setup(page,'store');
  const edge=page.locator('[data-installer="edge"]');
  await edge.getByRole('button',{name:'Install and connect',exact:true}).click();
  await expect(edge).toContainText('Waiting for Edge to connect');
  await expect(edge).not.toContainText('Connected ·');
  await expect(edge.getByRole('button',{name:'Open installation page again'})).toBeEnabled();
});
test('missing apps and installer failures have actionable states',async({page})=>{
  await setup(page,'missing');
  await expect(page.locator('[data-installer="vscode"]')).toContainText('VS Code was not detected');
  await expect(page.getByRole('button',{name:'One-click install',exact:true})).toBeDisabled();
  await setup(page,'failure');
  await page.getByRole('button',{name:'One-click install',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('VS Code installation failed');
  await expect(page.getByRole('button',{name:'One-click install',exact:true})).toBeEnabled();
});
test('a live connection updates the card and preserves the user opt-out',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nexport function connectTestCode(){pluginEntries=pluginEntries.map(p=>p.provider==="vscode"?{...p,instances:2,connected:true}:p);}'});
  });
  await setup(page);
  await page.locator('[data-provider="vscode"]').getByRole('checkbox').uncheck();
  await page.getByRole('button',{name:'One-click install',exact:true}).click();
  await page.evaluate(async()=>{const api=await import('/src/api.ts' as string);api.connectTestCode();});
  await expect(page.locator('[data-installer="vscode"]')).toContainText('Connected · 2 instances',{timeout:8000});
  await expect(page.locator('[data-provider="vscode"]').getByRole('checkbox')).not.toBeChecked();
});
