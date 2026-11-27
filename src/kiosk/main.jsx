import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import KioskApp from './KioskApp.jsx';
import { ToastProvider } from '../ui.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <KioskApp />
    </ToastProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {}); });
}
