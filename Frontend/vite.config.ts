import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@services': path.resolve(__dirname, './src/services'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@assets': path.resolve(__dirname, './src/assets'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (
            id.includes('react/') ||
            id.includes('react-dom/') ||
            id.includes('react-router-dom') ||
            id.includes('@tanstack/react-query') ||
            id.includes('zustand')
          ) {
            return 'vendor-core';
          }

          if (
            id.includes('recharts') ||
            id.includes('chart.js') ||
            id.includes('react-chartjs-2')
          ) {
            return 'vendor-charts';
          }

          if (
            id.includes('@radix-ui') ||
            id.includes('lucide-react')
          ) {
            return 'vendor-ui';
          }

          if (id.includes('jspdf')) {
            return 'vendor-docs';
          }

          return undefined;
        },
      },
    },
  }
});
