#!/usr/bin/env node
// Renderiza scripts/icon/icon.svg a los PNG del PWA en frontend/public/ con Chromium
// (bordes suaves, sin transparencia). Requiere Playwright instalado en algún lado:
//   npm i --no-save playwright && node scripts/icon/render.mjs
// Si ya tienes Chromium, puedes indicarlo con CHROMIUM_PATH=/ruta/al/chrome.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "frontend", "public");
const svg = readFileSync(join(here, "icon.svg"), "utf8");
const sizes = { "icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180 };

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
for (const [name, n] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${n}" height="${n}" `)}</body>`);
  await page.screenshot({ path: join(out, name) });
  await page.close();
  console.log(`${name} (${n}×${n})`);
}
await browser.close();
