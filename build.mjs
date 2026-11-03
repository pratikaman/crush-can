// Bundles src/ into one self-contained index.html (fonts inlined as data URIs),
// so it opens straight from Finder in Safari — no server needed.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['safari16', 'chrome110'],
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = readFileSync('index.src.html', 'utf8');
html = html.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_, p) => `url(data:font/woff2;base64,${readFileSync(p).toString('base64')})`);
html = html.replace('<script>/*APP*/</script>', () => `<script>${js}</script>`);
writeFileSync('index.html', html);
console.log(`index.html  ${(html.length / 1024).toFixed(0)} KB`);
