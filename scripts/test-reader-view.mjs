import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile('src/Browser.App/Views/MainWindow.Reader.cs', 'utf8');
const script = source.match(/private const string ReaderViewScript = """\r?\n([\s\S]*?)\r?\n\s*""";/)?.[1]
  .replace('__SUTRA_READER_OPTIONS__', JSON.stringify({ font:20, width:760, theme:'dark' }));
assert.ok(script, 'Production reader script must be tested');
const browser = await chromium.launch({ channel:process.env.SUTRA_TEST_BROWSER || 'chrome', headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:1100,height:720 } });
  let networkRequests=0;
  await page.route('https://reader.test/**', route => route.fulfill({ contentType:'text/html', body:`
    <style>body{margin:0}article{padding:30px;max-width:740px}p{margin:50px 0}[hidden]{display:none}</style>
    <article><h1>A quieter place to read</h1><p>${'A readable article with useful details. '.repeat(90)}</p>
    <p hidden>HIDDEN CONFIDENTIAL TEXT</p><form><input id="draft" value="secret draft"><textarea>PRIVATE FORM TEXT</textarea></form>
    <p contenteditable>PRIVATE EDITOR TEXT</p><h2>What matters next</h2><p>${'The original page should survive. '.repeat(45)}</p>
    <p>&lt;img src=x onerror=alert(1)&gt;</p><button id="original">Original control</button></article>` }));
  await page.goto('https://reader.test/article');
  page.on('request',request=>{if(/^https?:/.test(request.url()))networkRequests++});
  await page.evaluate(()=>{window.originalDraft=document.querySelector('#draft');window.originalDraft.value='unsaved typed draft';window.originalClicks=0;document.querySelector('#original').addEventListener('click',()=>window.originalClicks++);window.scrollTo(0,200)});
  const originalScroll=await page.evaluate(()=>window.scrollY);
  assert.equal(await page.evaluate(script=>(0,eval)(script),script),'opened');
  const reader=page.locator('#__sutra_reader_view');
  await reader.waitFor();
  assert.equal(await page.locator('body').evaluate(body=>body.inert),true);
  const text=await reader.locator('article').innerText();
  for(const excluded of ['HIDDEN CONFIDENTIAL TEXT','PRIVATE FORM TEXT','PRIVATE EDITOR TEXT','secret draft','unsaved typed draft'])assert.ok(!text.includes(excluded),excluded);
  assert.ok(text.includes('What matters next'));
  assert.equal(await reader.locator('img,script,iframe,input,textarea').count(),0);
  await reader.getByRole('button',{name:'Larger reader text'}).click();
  assert.equal(await reader.locator('article').evaluate(article=>getComputedStyle(article).fontSize),'21px');
  await reader.getByRole('combobox',{name:'Reader appearance'}).selectOption('sepia');
  assert.equal(await reader.locator('.view').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(241, 229, 205)');
  await fs.mkdir('output',{recursive:true});
  await page.screenshot({path:'output/reader-view.png'});
  await page.setViewportSize({width:360,height:640});
  assert.equal(await reader.locator('.view').evaluate(element=>element.scrollWidth<=element.clientWidth),true,'Narrow reader must fit without horizontal scrolling');
  await reader.getByRole('button',{name:'Return to original page'}).click();
  assert.equal(await reader.count(),0);
  assert.deepEqual(await page.evaluate(()=>({same:window.originalDraft===document.querySelector('#draft'),value:document.querySelector('#draft').value,inert:document.body.inert,aria:document.body.getAttribute('aria-hidden')})),{same:true,value:'unsaved typed draft',inert:false,aria:null});
  await page.setViewportSize({width:1100,height:720});
  await page.evaluate(y=>window.scrollTo(0,y),originalScroll);
  assert.equal(await page.evaluate(script=>(0,eval)(script),script),'opened');
  await page.keyboard.press('Escape');
  assert.equal(await reader.count(),0);
  assert.equal(await page.evaluate(()=>window.scrollY),originalScroll);
  await page.locator('#original').click();
  assert.equal(await page.evaluate(()=>window.originalClicks),1,'Original event handlers survive');
  assert.equal(networkRequests,0,'Reader makes no network requests');
  await page.evaluate(()=>{document.querySelector('article').replaceChildren(Object.assign(document.createElement('p'),{textContent:'Long readable text. '.repeat(30000)}));document.body.inert=true;document.body.setAttribute('aria-hidden','false')});
  assert.equal(await page.evaluate(script=>(0,eval)(script),script),'opened');
  assert.ok((await reader.locator('article').innerText()).length<251000,'Reader text copy is bounded');
  assert.equal(await page.evaluate(script=>(0,eval)(script),script),'closed');
  assert.deepEqual(await page.locator('body').evaluate(body=>({inert:body.inert,aria:body.getAttribute('aria-hidden')})),{inert:true,aria:'false'});
  console.log('PASS: bounded reader, no network, literal text, hidden/editable/form exclusion, appearance, narrow layout, Escape, original DOM/scroll/state restoration.');
} finally { await browser.close(); }
