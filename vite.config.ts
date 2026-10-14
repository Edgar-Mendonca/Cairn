import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Everything goes into one script so the app also runs as a single file; the logos are small enough to inline.
  build: { assetsInlineLimit: 200000, rollupOptions: { input: 'app.html', output: { codeSplitting: false } } }
});
