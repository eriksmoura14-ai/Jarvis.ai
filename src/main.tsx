import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersonalGate } from './components/PersonalGate';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><PersonalGate /></StrictMode>);
