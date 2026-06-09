import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'electron/main.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'electron/preload.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    }
  }
});
