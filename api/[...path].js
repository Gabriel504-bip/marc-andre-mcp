/**
 * api/[...path].js — wrapper de déploiement Vercel (catch-all sous /api/*).
 *
 * Vercel route tout ce qui commence par /api/ vers cette fonction. On
 * retire le préfixe /api avant de déléguer à l'app Express (dist/src/server.js)
 * pour que ses routes internes restent /healthz et /mcp, identiques à
 * l'usage auto-hébergé (README.md) — un seul comportement, deux façons de
 * le lancer (node dist/src/index.js en local/VM, ou ce fichier sur Vercel).
 */
import { createApp } from '../dist/src/server.js';

let cachedApp;
function getApp() {
  if (!cachedApp) {
    cachedApp = createApp().app;
  }
  return cachedApp;
}

export default function handler(req, res) {
  req.url = req.url.replace(/^\/api/, '') || '/';
  return getApp()(req, res);
}
