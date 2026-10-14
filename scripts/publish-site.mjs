// Copies the built app to the repository root, where GitHub Pages serves it (Settings › Pages › main › / (root)).
import { copyFileSync } from 'node:fs';
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'cairn-icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) copyFileSync('dist/' + f, f);
console.log('Site files copied to the repository root. Commit and push them.');
