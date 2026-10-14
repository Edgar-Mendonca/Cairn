// After `vite build`: makes the built page self-contained (script and styles inside the HTML), so the app
// works from a single index.html on any web host, and also writes "Open Cairn.html" to open from disk.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('dist');
// The source page is app.html (the repository's own index.html is the published app).
let html = readFileSync(resolve(output, 'app.html'), 'utf8');
const script = html.match(/<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/);
if (!script) throw new Error('Expected a single bundled JavaScript entry');
const js = readFileSync(resolve(output, script[1]), 'utf8');
if (/<\/script/i.test(js)) throw new Error('Cannot safely inline a script end tag');
html = html.replace(script[0], () => `<script type="module">\n${js}\n</script>`);
for (const css of html.match(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g) || []) {
  const href = /href="([^"]+)"/.exec(css)[1];
  html = html.replace(css, () => `<style>\n${readFileSync(resolve(output, href), 'utf8')}\n</style>`);
}
// The tab icon travels inside the page too.
const icon = readFileSync(resolve(output, 'cairn-icon.svg'));
html = html.replace('href="./cairn-icon.svg"', `href="data:image/svg+xml;base64,${icon.toString('base64')}"`);
writeFileSync(resolve(output, 'index.html'), html);
rmSync(resolve(output, 'app.html'));
writeFileSync(resolve(output, 'Open Cairn.html'), html);
