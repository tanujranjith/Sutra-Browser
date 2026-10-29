/*
 * Shared mock Supabase-shaped sync server for the cloud-sync e2e suite.
 * The semantic model is src/sync/sync-transport.js createMemoryServer —
 * the SAME implementation the unit tests exercise — wrapped here as a
 * Playwright context.route HTTP layer.
 *
 * The origin rides the `*.supabase.co` CSP wildcard already approved in
 * scripts/lib/csp-policy.mjs: in-page CSP is enforced BEFORE Playwright
 * routing, so an unapproved origin would be blocked without ever reaching
 * the route handler.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const transportApi = require('../../../src/sync/sync-transport.js');

export const SYNC_MOCK_ORIGIN = 'https://sync-mock.supabase.co';

export function createSyncMockServer(options) {
  return transportApi.createMemoryServer(options);
}

/*
 * Routes every request for SYNC_MOCK_ORIGIN in the given browser context to
 * the shared in-process server. Returns a `net` handle: set `net.down = true`
 * to simulate a dead network (requests abort like a dropped connection).
 */
export async function routeSyncServer(context, server, net = { down: false }) {
  const seenAuthHeaders = [];
  net.logoutCalls = Number(net.logoutCalls) || 0;
  await context.route(`${SYNC_MOCK_ORIGIN}/**`, async (route) => {
    if (net.down) {
      return route.abort('internetdisconnected');
    }
    const request = route.request();
    const url = new URL(request.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Minimal Supabase GoTrue mock so UI flows can sign in with email OTP
    // and the real createSupabaseTransport path (anon key + bearer headers)
    // is exercised end-to-end against this server.
    if (url.pathname === '/auth/v1/otp' && request.method() === 'POST') return json(200, {});
    if (url.pathname === '/auth/v1/verify' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const accountB = /account-b/i.test(String(body.email || ''));
      return json(200, {
        access_token: accountB ? 'mock-access-token-b' : 'mock-access-token', token_type: 'bearer', expires_in: 3600,
        refresh_token: accountB ? 'mock-refresh-token-b' : 'mock-refresh-token',
        user: { id: accountB ? 'mock-user-2' : 'mock-user-1', email: body.email || 'student@example.com' }
      });
    }
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      return json(200, {
        access_token: 'mock-access-token-2', expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: { id: 'mock-user-1', email: 'student@example.com' }
      });
    }
    if (url.pathname === '/auth/v1/settings') return json(200, {});
    if (url.pathname === '/auth/v1/logout') {
      net.logoutCalls += 1;
      return route.fulfill({ status: 204, body: '' });
    }

    if (request.method() !== 'POST' || !url.pathname.startsWith('/rest/v1/rpc/')) {
      return json(404, { ok: false, code: 'not-found' });
    }
    seenAuthHeaders.push({
      rpc: url.pathname.replace('/rest/v1/rpc/', ''),
      apikey: request.headers().apikey || null,
      authorization: request.headers().authorization || null
    });
    const rpcName = url.pathname.replace('/rest/v1/rpc/', '');
    let body = {};
    try { body = JSON.parse(request.postData() || '{}'); } catch (error) { body = {}; }
    if (typeof net.rpcOverride === 'function') {
      const overridden = net.rpcOverride({ rpcName, body });
      if (overridden) return json(Number(overridden.status) || 200, overridden.body || overridden);
    }
    const { status, body: result } = server.handleRpc(rpcName, body);
    return json(status, result);
  });
  net.seenAuthHeaders = seenAuthHeaders;
  return net;
}
