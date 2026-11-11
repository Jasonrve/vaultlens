import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './theme-dark.css';
import './stores/themeStore';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
