import { resolve } from 'node:path';
import { migrate } from './migrate.mjs';

if (!process.env.APP_ORIGIN) throw new Error('APP_ORIGIN must be the browser-facing origin (for example https://announcements.example.com).');
const origin = new URL(process.env.APP_ORIGIN);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== process.env.APP_ORIGIN || origin.username || origin.password) throw new Error('APP_ORIGIN must contain only the protocol, host and optional port, with no trailing slash.');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use HTTPS for non-local deployments.');
if (process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.length < 32) throw new Error('SETUP_TOKEN must be at least 32 characters.');
process.env.NODE_ENV = 'production';
migrate();
const { startProdServer } = await import('vinext/server/prod-server');
await startProdServer({ port: Number(process.env.PORT || 3000), host: '0.0.0.0', outDir: resolve('dist') });
