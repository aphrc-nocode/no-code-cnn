import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_API_URL || 'http://localhost:8000';
  
  return {
    plugins: [react()],
    server: {
      allowedHosts: ['aphrc-deeplens.atekervoices.com'],
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/datasets': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/pipelines': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/upload-dataset': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/upload-detection-dataset': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/responsible-ai': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/mlflow': {
          target: backendTarget,
          changeOrigin: true,
        },
      }
    }
  }
})
