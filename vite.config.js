import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // رقم النسخة: الجولة الإرشادية بتظهر تاني كاملة مع كل نشر جديد
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
});
