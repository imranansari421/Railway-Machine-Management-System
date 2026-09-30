import './utils/console-sanitizer';
import { initSecurityArmor } from './utils/securityArmor';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Initialize client-side security armor and anti-tamper safeguards
initSecurityArmor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
