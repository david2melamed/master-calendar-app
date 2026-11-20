/**
 * Renders public/icons/icon.svg into the PNG sizes iOS / Chrome need.
 * Run: npx tsx scripts/make-icons.mts   (uses your installed Chrome)
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const targets = [
  { file: "public/icons/icon-192.png", size: 192, pad: 0, rounded: false },
  { file: "public/icons/icon-512.png", size: 512, pad: 0, rounded: false },
  // Android/Chrome "maskable": artwork kept inside the central safe zone.
  { file: "public/icons/maskable-512.png", size: 512, pad: 0.1, rounded: false },
  // iOS home screen: square, no transparency (iOS rounds the corners itself).
  { file: "public/apple-touch-icon.png", size: 180, pad: 0, rounded: false },
  { file: "public/icons/favicon-32.png", size: 32, pad: 0, rounded: true },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  await page.setContent(
    `<html><body style="margin:0;background:#0b1f3a;display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px;${t.rounded ? "border-radius:22%;overflow:hidden;" : ""}">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: t.file, omitBackground: t.rounded });
  console.log("wrote", t.file);
  await page.close();
}
await browser.close();
