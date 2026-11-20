import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL!);
});

test("signed-out visitors are sent to login", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(baseURL + "/calendar");
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});

test("default view: Week on Mac, Day on iPhone", async ({ page }, info) => {
  await page.goto("/calendar");
  const expected = info.project.name === "mac" ? "Week" : "Day";
  await expect(page.getByRole("tab", { name: expected }).first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Demo mode")).toBeVisible();
});

test("Day view shows header, summary, AI-guessed and Blackbaud items", async ({ page }) => {
  await page.goto("/calendar?view=day");
  await expect(page.getByText(/\d+ events?/).first()).toBeVisible();
  await expect(page.getByText("AI-guessed").first()).toBeVisible();
  await expect(page.getByText("Due").first()).toBeVisible();
  await expect(page.getByLabel("Current time")).toBeVisible();
});

test("event detail opens with the AI quote and closes with Esc", async ({ page }) => {
  await page.goto("/calendar?view=day");
  await page.getByRole("button", { name: /Dentist appointment/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Why the AI added this")).toBeVisible();
  await expect(dialog.getByText(/appointment is confirmed/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Open in Gmail/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("keyboard shortcuts switch views and navigate (Mac)", async ({ page }, info) => {
  test.skip(info.project.name !== "mac", "keyboard is a Mac feature");
  await page.goto("/calendar?view=week");
  await expect(page.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true"); // app ready
  await page.keyboard.press("m");
  await expect(page.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  const title = await page.locator("h1").first().textContent();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("h1").first()).not.toHaveText(title!);
  await page.keyboard.press("t");
  await expect(page.locator("h1").first()).toHaveText(title!);
  await page.keyboard.press("y");
  await expect(page.getByRole("tab", { name: "Year" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("d");
  await expect(page.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
});

test("clicking a day in Month opens Day; a week number opens Week", async ({ page }) => {
  await page.goto("/calendar?view=month&date=2026-11-19");
  await page.getByRole("button", { name: "Open week 47" }).click();
  await expect(page.getByRole("tab", { name: "Week" }).first()).toHaveAttribute("aria-selected", "true");
  await page.goto("/calendar?view=month&date=2026-11-19");
  await page.getByRole("button", { name: "Open Friday, November 20" }).click();
  await expect(page.getByRole("tab", { name: "Day" }).first()).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/date=2026-11-20/);
});

test("last-used view is remembered after reload", async ({ page }) => {
  await page.goto("/calendar");
  await page.getByRole("tab", { name: "Month" }).first().click();
  await page.goto("/calendar");
  await expect(page.getByRole("tab", { name: "Month" }).first()).toHaveAttribute("aria-selected", "true");
});

test("hiding a source removes its events and is remembered", async ({ page }, info) => {
  await page.goto("/calendar?view=day");
  await expect(page.getByRole("button", { name: /Dentist appointment/ })).toBeVisible();
  if (info.project.name === "iphone") await page.getByRole("button", { name: "Calendars and filters" }).click();
  await page.getByRole("switch", { name: /Found in email/ }).click();
  if (info.project.name === "iphone") await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Dentist appointment/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/\d+ events?/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Dentist appointment/ })).toHaveCount(0);
});

test("swipe follows your finger and pages between days (iPhone)", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "swipe is an iPhone feature");
  await page.goto("/calendar?view=day&date=2026-11-19");
  await expect(page.getByRole("heading", { name: /Thursday/ })).toBeVisible();
  const area = page.locator("[class*='mc-view-in']").first();
  const box = (await area.boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x === undefined ? [] : [{ x, y, id: 1 }],
    });
  /** Real finger: press, drag in steps (stepMs apart), optionally hold, release. */
  const drag = async (fromX: number, toX: number, { steps = 10, stepMs = 16, release = true } = {}) => {
    await touch("touchStart", fromX);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", fromX + ((toX - fromX) * i) / steps);
      await page.waitForTimeout(stepMs);
    }
    if (release) await touch("touchEnd");
  };

  // Mid-drag: the page follows the finger and tomorrow is already beside it.
  await drag(box.x + box.width - 30, box.x + box.width - 90, { release: false, stepMs: 40 }); // 60px: under 25%
  await expect(page.getByText("Friday, November 20")).toBeAttached();
  await touch("touchEnd");
  // A short slow drag springs back to the same day.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/date=2026-11-19/);

  await drag(box.x + box.width - 20, box.x + 20); // long swipe left → next day
  await expect(page).toHaveURL(/date=2026-11-20/);
  await expect(page.getByRole("heading", { name: /Friday/ }).first()).toBeInViewport();

  await page.waitForTimeout(500);
  await drag(box.x + 40, box.x + 110, { steps: 2, stepMs: 0 }); // quick short flick right → back (2 moves = as fast as the test driver can go)
  await expect(page).toHaveURL(/date=2026-11-19/);
});
