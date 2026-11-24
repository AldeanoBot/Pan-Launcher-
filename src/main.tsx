import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (
  typeof window !== 'undefined' &&
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
  'serviceWorker' in navigator
) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const reg of registrations) {
        void reg.unregister();
      }
    })
    .catch(() => {});

  if ('caches' in window) {
    void caches
      .keys()
      .then((keys) => {
        for (const key of keys) {
          void caches.delete(key);
        }
      })
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(<App />);
