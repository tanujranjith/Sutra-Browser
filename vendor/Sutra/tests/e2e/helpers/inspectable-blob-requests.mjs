// WebKit omits Blob-backed request bodies from route interception. Preserve
// the exact bytes and Content-Type while making those mocked uploads readable.
export async function installInspectableBlobRequests(page, urlPrefixes) {
  await page.addInitScript(prefixes => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (prefixes.some(prefix => url.startsWith(prefix)) && init?.body instanceof Blob) {
        const headers = new Headers(init.headers);
        if (!headers.has('Content-Type') && init.body.type) headers.set('Content-Type', init.body.type);
        return fetch(input, { ...init, headers, body: await init.body.arrayBuffer() });
      }
      return fetch(input, init);
    };
  }, urlPrefixes);
}
