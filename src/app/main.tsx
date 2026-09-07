import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '../ui/App';
import './styles.css';

registerSW({ immediate: true });
navigator.storage?.persist?.();
createRoot(document.getElementById('root')!).render(<App />);
