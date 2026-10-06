import { chromium } from 'playwright-core';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || chromium.executablePath(),headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.__TAURI_INTERNALS__={invoke: async (cmd)=>{
  if(cmd==='is_company_setup')return true;
  if(cmd==='current_user')return {id:'review',fullName:'Platform reviewer',email:'review@example.test',role:'super_admin',isSuperAdmin:true,mustChangePassword:false};
  if(cmd==='list_tenant_companies' && window.__reviewMode==='error')throw Error('Fixture unavailable');
  if(cmd==='list_tenant_companies' && window.__reviewMode==='empty')return [];
  if(cmd==='list_tenant_companies')return [{id:'t1',name:'Example Trading',email:'team@example.test',packageName:'Standard',isActive:true,userCount:8,subscriptionStatus:'active',createdAt:'2026-09-01',currencyCode:'PKR'},{id:'t2',name:'Sample Retail',email:'retail@example.test',packageName:'Pro',isActive:false,userCount:3,subscriptionStatus:'past_due',createdAt:'2026-09-15',currencyCode:'PKR'}];
  if(cmd==='get_platform_analytics')return {totalTenants:2,activeTenants:1,totalUsers:11,mrr:1000,subscriptionsByStatus:[{status:'active',count:1},{status:'past_due',count:1}],tenantsByPackage:[{packageId:'p1',packageName:'Standard',count:1},{packageId:'p2',packageName:'Pro',count:1}],monthlyGrowth:[{month:'2026-09',count:2}]};
  if(cmd==='list_packages')return [];
  throw new Error('Unmocked command: '+cmd);
 }};
});
await page.goto(process.env.ADMIN_REVIEW_URL || 'http://127.0.0.1:1420');
await page.getByRole('heading',{name:'Platform overview'}).waitFor();
await page.getByRole('button',{name:'Example Trading',exact:true}).waitFor();
await page.screenshot({path:'/tmp/corbel-admin-light.png',fullPage:true});
await page.getByRole('textbox',{name:'Search tenant directory'}).fill('sample');
if(await page.getByRole('button',{name:'Example Trading',exact:true}).count())throw Error('Search did not filter');
await page.getByRole('textbox',{name:'Search tenant directory'}).fill('');
await page.getByRole('button',{name:'Switch to dark theme'}).click();
await page.screenshot({path:'/tmp/corbel-admin-dark.png',fullPage:true});
await page.reload();await page.getByRole('button',{name:'Switch to light theme'}).waitFor();
for(const name of ['Tenants','Packages','Analytics','Settings']) {
 await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 await page.waitForTimeout(350);
}
await page.getByRole('navigation').getByRole('button').first().click();
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'/tmp/corbel-admin-mobile.png',fullPage:true});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
if(overflow)throw Error('Document overflow on mobile');
await page.evaluate(()=>{window.__reviewMode='error';});
await page.getByRole('button',{name:'Refresh',exact:true}).click();
await page.getByRole('alert').filter({hasText:'Some platform data'}).waitFor();
await page.getByText('Tenant directory unavailable.',{exact:true}).waitFor();
await page.evaluate(()=>{window.__reviewMode='empty';});
await page.getByRole('button',{name:'Refresh',exact:true}).click();
await page.getByText('No tenants yet. Register your first tenant to get started.',{exact:true}).waitFor();
if(errors.length)throw Error(errors.join('\n'));
console.log('PASS: overview, search, both themes, persisted theme, five navigation routes, mobile document width, partial API failure, empty state; screenshots in /tmp/corbel-admin-*.png');
await browser.close();
