import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
let sonnerPath = '';
try {
  sonnerPath = require.resolve('sonner').replace(/index\.js$/, 'index.mjs');
} catch {
  sonnerPath = resolve(__dirname, 'node_modules/sonner/dist/index.mjs');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      copyPublicDir: true,
      chunkSizeWarningLimit: 1500,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('scheduler')) {
                return 'vendor-react';
              }
              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }
              if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('xlsx')) {
                return 'vendor-export-tools';
              }
              if (id.includes('recharts') || id.includes('d3')) {
                return 'vendor-charts';
              }
              if (id.includes('lucide-react') || id.includes('motion') || id.includes('framer-motion')) {
                return 'vendor-ui-icons';
              }
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, '.'),
        'sonner': sonnerPath,
      },
    },
    optimizeDeps: {
      include: ['sonner'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: false,
    },
  };
});
