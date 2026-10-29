import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.chrome=window.chrome||{};window.chrome.webview={postMessage:()=>{},addEventListener:()=>{}}});
  const url=pathToFileURL(path.resolve('Sutra Ultra/index.html')).href;
  await page.goto(url);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#search-input').evaluate(input=>document.activeElement===input),false,'Embedded new tab must leave keyboard focus to the native address bar');
  for(const width of [1150,600]){
    await page.setViewportSize({width,height:750});
    const alignment=await page.locator('.quick-icon').evaluateAll(icons=>icons.map(icon=>{const a=icon.getBoundingClientRect(),b=icon.querySelector('svg').getBoundingClientRect();return {x:Math.abs(a.x+a.width/2-b.x-b.width/2),y:Math.abs(a.y+a.height/2-b.y-b.height/2)}}));
    assert.equal(alignment.length,6);
    for(const icon of alignment)assert.ok(icon.x<=.5&&icon.y<=.5,JSON.stringify(icon));
  }
  await page.setViewportSize({width:1150,height:750});
  await page.screenshot({path:'output/newtab-centered-icons.png'});
  const standalone=await browser.newPage();
  await standalone.goto(url);
  await standalone.waitForTimeout(200);
  assert.equal(await standalone.locator('#search-input').evaluate(input=>document.activeElement===input),true,'Standalone page keeps its own usable search focus');
  console.log('PASS: native focus ownership, standalone search focus, six centered SVG icons at desktop/mobile widths.');
}finally{await browser.close()}
