import { installClientTelemetry, reportClientError, errorLocation } from './telemetry.mjs';
import { initBotId } from 'botid/client/core';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if (import.meta.env.VITE_BOT_PROVIDER === 'vercel') initBotId({ protect: [{ path: '/api/analyze', method: 'POST', advancedOptions: { checkLevel: 'basic' } }] });

installClientTelemetry();
createRoot(document.getElementById('root'), { onUncaughtError: error => reportClientError('react_error', 'unknown', undefined, errorLocation(error)), onCaughtError: error => reportClientError('react_error', 'unknown', undefined, errorLocation(error)) }).render(<React.StrictMode><App /></React.StrictMode>);
