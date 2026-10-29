/** Canonical Sutra host-document Content Security Policy. */

export const APPROVED_CONNECT_WILDCARDS = Object.freeze([
  // Sutra Cloud (encrypted backup) targets the user's OWN Supabase project, whose
  // origin is <project-ref>.supabase.co — dynamic per account, so it must be a
  // wildcard rather than a hardcoded (and previously placeholder) origin.
  'https://*.supabase.co',
  'https://*.1drv.com',
  'https://*.sharepoint.com',
  'https://*.microsoftpersonalcontent.com',
  'https://*.dms.live.net'
]);

export const CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  // `unsafe-inline` remains temporarily required by legacy inline handlers.
  // scripts/sutra-csp-check.mjs ratchets their count so this permission can
  // only be removed, never expanded, during modular extraction.
  // The Office document import parsers (Mammoth, SheetJS) are vendored under
  // assets/vendor/office/ and load same-origin, so no CDN script origin is
  // approved anymore.
  'script-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
  'font-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://api.groq.com',
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://generativelanguage.googleapis.com',
    'https://openrouter.ai',
    'https://integrate.api.nvidia.com',
    'https://api.mistral.ai',
    'https://api.together.xyz',
    'https://api.deepseek.com',
    'https://api.x.ai',
    'https://api.perplexity.ai',
    'https://www.googleapis.com',
    'https://accounts.google.com',
    'https://login.microsoftonline.com',
    'https://graph.microsoft.com',
    'https://www.dropbox.com',
    'https://api.dropboxapi.com',
    'https://content.dropboxapi.com',
    ...APPROVED_CONNECT_WILDCARDS,
    'http://localhost:*',
    'http://127.0.0.1:*'
  ],
  'frame-src': [
    "'self'",
    'https://accounts.google.com',
    'https://docs.google.com',
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://open.spotify.com',
    'https://w.soundcloud.com',
    'https://codepen.io',
    'https://www.figma.com',
    'https://embed.figma.com',
    'https://codesandbox.io',
    'data:',
    'blob:'
  ],
  'media-src': ["'self'", 'data:', 'blob:', 'https://open.spotify.com', 'https://w.soundcloud.com'],
  'worker-src': ["'self'", 'blob:'],
  'form-action': ["'self'", 'https://docs.google.com']
});

export const INLINE_CODE_BUDGETS = Object.freeze({
  'index.html': { scripts: 0, styles: 0 },
  'HomePage.html': { scripts: 2, styles: 4 },
  'Sutra.html': { scripts: 7, styles: 4 }
});

export function buildCsp(options = {}) {
  const directives = Object.entries(CSP_DIRECTIVES).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (options.includeFrameAncestors === true) directives.splice(3, 0, "frame-ancestors 'none'");
  return directives.join('; ');
}
