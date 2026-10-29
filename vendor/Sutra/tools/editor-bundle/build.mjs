/*
 * Builds assets/vendor/editor/sutra-editor.min.js from entry.js.
 * Run: npm run build   (inside tools/editor-bundle)
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '..', 'assets', 'vendor', 'editor');
const outFile = resolve(outDir, 'sutra-editor.min.js');

mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: [resolve(here, 'entry.js')],
    outfile: outFile,
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'SutraEditor',
    target: 'es2020',
    platform: 'browser',
    legalComments: 'inline',
    banner: {
        js: '/* SutraEditor — TipTap/ProseMirror bundle. Source: tools/editor-bundle. Do not edit by hand. */',
    },
    logLevel: 'info',
});

const size = statSync(outFile).size;
console.log(`Built ${outFile} (${(size / 1024).toFixed(1)} KB)`);
