import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/agent': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/workspace': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/config': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/openapi': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
    cors: true,
  },
})