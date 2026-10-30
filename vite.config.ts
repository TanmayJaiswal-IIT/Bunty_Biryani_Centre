import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev proxy follows PORT from .env, so a busy port 3000 only needs one change. Read the file
// directly: Vite's loadEnv() would pick up NODE_ENV=development from it and make `vite build`
// ship React's development build.
const dotenv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const apiPort = process.env.PORT || dotenv.PORT || '3000';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    target: 'es2022',
    // Never inline assets as data: URIs: the CSP is `font-src 'self'` (Batch 1 §9.5).
    assetsInlineLimit: 0,
  },
});
