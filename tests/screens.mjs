import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:4174');
await page.getByRole('heading',{name:/Good morning/}).waitFor();
await page.screenshot({path:'preview/phone.png'});
for(const name of ['Home','Discover','My events','Rankings','Community','Athlete passport','Organizer','Rising athletes','Academies','Leagues','Marketplace','Admin']){
 await page.getByRole('button',{name:'Open navigation'}).click();
 await page.locator('.sidebar').getByRole('button',{name:name==='Discover'?/^Discover/:name,exact:name!=='Discover'}).click();
 assert(await page.locator('h1').isVisible(),name+' heading');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');
}
for(const role of ['Athlete','Fan / visitor','Parent','Organizer','Coach / scout','Academy','Sponsor','Admin']){
await page.getByLabel('Explore as').selectOption(role);
assert(await page.locator('h1').isVisible(),role+' view');
}
await page.getByLabel('Explore as').selectOption('Athlete');
await page.getByRole('button',{name:'Open navigation'}).click();
await page.locator('.sidebar').getByRole('button',{name:'Athlete passport',exact:true}).click();
const download=page.waitForEvent('download');
await page.getByRole('button',{name:'Certificate',exact:true}).click();
assert.equal((await download).suggestedFilename(),'Rally-demo-certificate.svg');
assert.equal(errors.length,0,errors.join(';'));
console.log('PASS: 12 mobile pages, 8 role views, no overflow, SVG certificate download, no runtime errors.');
await browser.close();
