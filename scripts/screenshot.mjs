#!/usr/bin/env node
// Screenshot the running app and report any console errors. Useful for
// checking layout changes without clicking around.
//
//   npm run dev      # in another terminal
//   npm run shot     # writes shot.png
//
// Needs browsers once: npx playwright install chromium

import { chromium } from "playwright";

const out = process.argv[2] ?? "shot.png";
const url = process.env.FIT_STUDIO_URL ?? "http://localhost:8080";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();

console.log(`wrote ${out}`);
if (errors.length) {
  console.error(`\n${errors.length} console error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
