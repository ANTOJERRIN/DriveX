// Optional real-browser regression suite: npm run test:ui (Chrome or Playwright Chromium).
import {chromium,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {createFixtureServer} from './browser-server.mjs';
import {navigation} from '../dist/presentation.mjs';

const executablePath=process.env.CHROME_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(path=>existsSync(path));
const fixture=await createFixtureServer({seedPaid:true,paymentsEnabled:false});
let browser;
let screens=0;
await mkdir('artifacts/ui',{recursive:true});
try {
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const context=await browser.newContext({reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Fonts are cosmetic; the suite stays independent of external services.
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,route=>route.abort());
 const fits=async(label)=>{
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{message:label+' overflows viewport'}).toBe(true);
  screens++;
 };
 for(const width of [320,390,768,1440]) {
  await page.setViewportSize({width,height:900});
  await page.goto(fixture.url);
  await expect(page.locator('#auth-form')).toBeVisible();
  await expect(page.locator('#install-app[hidden]')).toBeHidden();
  await fits('Sign in '+width);
  if(width===390||width===1440)await page.screenshot({path:`artifacts/ui/signin-${width}.png`,fullPage:true});
  await page.locator('[data-auth="signup"]').click();
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await fits('Signup '+width);
  await page.locator('[data-auth="login"]').click();
  await page.locator('[data-auth="recover"]').click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await fits('Recovery '+width);
  await page.locator('[data-auth="login"]').click();
  for(const role of ['student','instructor','admin']) {
   await page.locator('input[name="email"]').fill(role+'@example.test');
   await page.locator('input[name="password"]').fill('fixture-password');
   await page.locator('#auth-form button[type="submit"], #auth-form button.primary').click();
   await expect(page.locator('.nav')).toBeVisible();
   for(const [id] of navigation[role]) {
    const button=page.locator(`.nav [data-nav="${id}"]`);
    await button.click();
    await expect(page.locator(`.nav [data-nav="${id}"]`)).toHaveAttribute('aria-current','page');
    await expect(page.locator('#page-title')).toBeVisible();
    await fits(role+' '+id+' '+width);
    if(width<=390) {
     const box=await button.boundingBox();
     expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if(id==='overview'&&(width===390||width===1440))await page.screenshot({path:`artifacts/ui/${role}-${width}.png`,fullPage:true});
   }
   await page.locator('#logout').click();
   await expect(page.locator('#auth-form')).toBeVisible();
  }
 }
 expect(errors).toEqual([]);
 console.log(`Responsive Chrome suite passed: ${screens} screens at 320, 390, 768 and 1440px; all three portals; no page errors.`);
 console.log('Screenshots: artifacts/ui/');
} finally {
 await browser?.close();
 await fixture.close();
}
