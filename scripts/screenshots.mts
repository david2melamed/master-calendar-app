/**
 * Dev tool: take screenshots of the running app with your installed Chrome.
 *   SESSION_COOKIE=<value> OUT=/some/dir npx tsx scripts/screenshots.mts "/calendar?view=day" mac-light ...
 * Shots: "<path>|<name>|<device>|<scheme>|<text to click>" (device = mac | iphone, scheme = light | dark).
 */
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.env.OUT ?? ".";
const cookie = process.env.SESSION_COOKIE;

const shots = process.argv.slice(2).map((s) => {
  const [path, name, device = "mac", scheme = "light", click] = s.split("|");
  return { path, name, device, scheme, click };
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const s of shots) {
  const ctx = await browser.newContext({
    ...(s.device === "iphone"
      ? { ...devices["iPhone 15"], deviceScaleFactor: 2 }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
    colorScheme: s.scheme as "light" | "dark",
    timezoneId: "America/New_York",
  });
  if (cookie) {
    await ctx.addCookies([{ name: "mc_session", value: cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
  }
  const page = await ctx.newPage();
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (s.click) {
    await page.getByText(s.click, { exact: false }).first().click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log("saved", s.name);
  await ctx.close();
}
await browser.close();
