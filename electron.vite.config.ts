import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  main: {},
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { plugins: [svelte()], server: { host: '127.0.0.1' } }
});
