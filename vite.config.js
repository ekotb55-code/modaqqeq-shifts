import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  // att.html = «تليفون الحضور» (صفحة لوحدها بتفتح على الحضور والانصراف بس)
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), att: resolve(__dirname, 'att.html') } } },
  // رقم النسخة: الجولة الإرشادية بتظهر تاني كاملة مع كل نشر جديد
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
});
