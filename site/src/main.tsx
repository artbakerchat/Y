import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import BeeApp from './BeeApp';
import './styles.css';

const isBeeRoute = window.location.pathname === '/bee' || window.location.pathname.startsWith('/bee/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isBeeRoute ? <BeeApp /> : <App />}</StrictMode>,
);
