import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 构建配置——质量原则第 5 原则（性能预算）
// 路由级代码分割由 React.lazy 实现（见 src/App.tsx）；这里配置 manualChunks 拆分 vendor。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发期代理 /api 与 /ws 到后端 3000，避免跨域（生产由反向代理/同源处理）
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    // 单 chunk gzip 后 < 200KB（质量原则第 5 原则）
    chunkSizeWarningLimit: 200,
  },
});
