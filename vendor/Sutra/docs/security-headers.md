# Production security headers

Sutra keeps a meta CSP in Sutra.html as a defense for file:// and simple
static-server use. Production deployments must also send response headers:
some directives, especially frame-ancestors, are not enforceable from a meta
element.

- **Canonical source:** `scripts/lib/csp-policy.mjs`; `npm run csp:generate`
  updates all HTML entry points and `vercel.json`, while the local server imports
  the same builder directly.

## Supported targets

- **Vercel:** vercel.json applies CSP, frame-ancestors, MIME sniffing,
  referrer, permissions, opener/resource isolation, and HSTS headers. COEP is
  intentionally omitted because Sutra supports approved cross-origin embeds,
  OAuth popups, and provider APIs. The service worker is served with
  no-cache, no-store, must-revalidate so update checks reach the deployment.
- **GitHub Pages:** Pages publishes static files and does not provide a
  repository-level response-header configuration surface. The meta CSP still
  protects directives supported in meta, but frame-ancestors and the other
  HTTP-only protections cannot be guaranteed. Use Vercel or a header-capable
  reverse proxy/custom host when those protections are required.
- **Local/file use:** no HSTS or cross-origin isolation is attempted. This
  preserves offline startup, local provider endpoints, and OAuth callback
  compatibility.

Run npm run check:headers to validate the checked-in Vercel policy. To inspect
what a deployment actually sends:

    npm run check:headers -- https://your-deployment.example/Sutra.html

The deployed check uses an HTTPS `HEAD` request and fails closed when a required
header or directive is absent. It is intended for a header-capable deployment;
running it against the current GitHub Pages host is expected to fail because
those headers cannot be configured there.

## Current GitHub Pages verification

Sutra deliberately retains GitHub Pages as its production host. A read-only
HTTPS `HEAD` check of `https://tanujranjith.github.io/Sutra/Sutra.html` on
2026-09-13 returned `200` and:

- present: `Strict-Transport-Security: max-age=31556952`;
- absent: response-header `Content-Security-Policy`,
  `X-Content-Type-Options`, `Referrer-Policy`, and framing protection.

This is an accepted hosting limitation, not evidence that `vercel.json` applies
to GitHub Pages. The HTML entry points therefore retain the canonical meta CSP
for directives supported in markup, while `frame-ancestors` and the other
HTTP-only protections remain unavailable on this host. Moving production to a
header-capable host requires a separate hosting/deployment decision.
