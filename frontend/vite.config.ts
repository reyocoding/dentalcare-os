import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Production-only Content-Security-Policy: injected into index.html during
// `vite build` so the shipped SPA is protected even though the dev server
// (inline HMR scripts) can't run under a strict policy.
// connect-src covers the API origin used by src/services/api.ts: 'self'
// (same-origin "/api" proxy, the recommended production setup) plus any
// absolute VITE_API_URL.
const cspMeta = (apiUrl: string): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html: string) {
    const connectSrc = ["'self'"];
    if (/^https?:\/\//.test(apiUrl)) {
      connectSrc.push(apiUrl);
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(' ')}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ');
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
    );
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), cspMeta(apiUrl)],
    resolve: {
      alias: {
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
    },
  };
});