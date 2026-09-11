import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          catalog: fileURLToPath(
            new URL('./src/main/database/catalog.ts', import.meta.url)
          ),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: { plugins: [svelte()], server: { host: '127.0.0.1' } },
});
