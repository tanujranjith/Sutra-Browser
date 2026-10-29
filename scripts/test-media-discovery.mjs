import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile('src/Browser.App/Views/MainWindow.Media.cs', 'utf8');
const script = source.match(/private const string MediaDiscoveryScript = """\r?\n([\s\S]*?)\r?\n\s*""";/)?.[1];
assert.ok(script, 'Production media discovery script must exist');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Current video - YouTube</title><div id="movie_player" class="ad-showing"><video class="html5-main-video" id="main"></video></div><video id="preload" hidden></video><ytd-ad-slot-renderer><video id="advert"></video></ytd-ad-slot-renderer>' }));
  await page.goto('https://www.youtube.com/watch?v=local-test');
  await page.evaluate(() => {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Stale previous video', artist: 'Artist' });
    for (const media of document.querySelectorAll('video')) {
      Object.defineProperties(media, { currentSrc: { value: 'blob:' + media.id }, readyState: { value: 4 }, paused: { value: media.id !== 'main' } });
    }
  });
  const youtube = await page.evaluate(script => (0, eval)(script), script);
  assert.equal(youtube.length, 1, 'Only the primary YouTube player should be listed');
  assert.equal(youtube[0].title, 'Current video - YouTube', 'Stale shared metadata must not rename the current player');
  assert.equal(youtube[0].paused, false);
  assert.equal((await page.evaluate(script => (0, eval)(script), script))[0].id, youtube[0].id, 'Controls must keep a stable target');
  await page.route('https://media.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Media</title><video id="live"></video><video id="preload" hidden></video><video id="copy"></video><video title="Second independent video" id="other"></video>' }));
  await page.goto('https://media.example/');
  await page.evaluate(() => {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Shared video title' });
    for (const media of document.querySelectorAll('video')) {
      Object.defineProperties(media, { currentSrc: { value: 'blob:' + media.id }, readyState: { value: 4 }, paused: { value: media.id !== 'live' } });
    }
  });
  const generic = await page.evaluate(script => (0, eval)(script), script);
  assert.equal(generic.length, 2, 'Preloads and redundant copies must be omitted while independent videos remain');
  assert.equal(generic[0].paused, false, 'The active copy must receive controls');
  assert.equal(generic[1].title, 'Second independent video');
  await page.evaluate(() => {
    document.body.replaceChildren();
    navigator.mediaSession.metadata = new MediaMetadata({ artist:'x'.repeat(5000) });
    for(let i=0;i<200;i++){
      const media=document.createElement('audio');media.title='Player '+i+' '+ 'x'.repeat(5000);
      Object.defineProperties(media,{currentSrc:{value:'blob:'+i},readyState:{value:4},paused:{value:false}});
      document.body.append(media);
    }
  });
  const bounded=await page.evaluate(script=>(0,eval)(script),script);
  assert.equal(bounded.length,64,'Discovery must bound work on pages with many media elements');
  assert.ok(bounded.every(media=>media.title.length<=512&&media.artist.length<=256&&media.id.length<=128));
  await page.evaluate(()=>Object.defineProperty(document.querySelector('audio'),'__sutraMediaId',{value:'x'.repeat(100000),configurable:true}));
  const malformed=await page.evaluate(script=>(0,eval)(script),script);
  assert.ok(malformed.every(media=>media!==null&&media.id.length<=128),'Page-supplied oversized IDs must not become native UI records');
  console.log('PASS: primary YouTube player, duplicate/stale metadata, stable controls, independent media, 64-element work cap, bounded text, oversized-ID rejection.');
} finally {
  await browser.close();
}
