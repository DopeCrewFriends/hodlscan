import '@fontsource/geist-sans/latin-400.css';
import '@fontsource/geist-sans/latin-500.css';
import '@fontsource/geist-sans/latin-600.css';
import '@fontsource/geist-sans/latin-700.css';
import '@fontsource/geist-sans/latin-800.css';

import { createRoot } from 'react-dom/client';

import App from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
