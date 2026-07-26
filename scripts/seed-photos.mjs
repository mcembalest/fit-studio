#!/usr/bin/env node
// Loads the photos in sanjana_images/ into the app as reference photos.
//
// Browser uploads are normalized client-side (src/lib/image.ts); this script is
// the command-line equivalent and needs ImageMagick, because these files are
// iPhone originals: stored landscape with an EXIF rotation flag. -auto-orient
// bakes the rotation into the pixels and -strip drops the flag. Skipping this
// step sends sideways references to the model and wrecks the likeness.
//
//   npm run dev        # in another terminal
//   npm run seed

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename } from "node:path";

const SOURCE = "sanjana_images";
const BASE = process.env.FIT_STUDIO_URL ?? "http://localhost:8080";

// Only these start out active. The rest are group shots, back-to-camera, or she
// is too small in frame — feeding them in adds ambiguity about who the subject
// is rather than adding signal. They still get uploaded so she can audition
// them in the UI; they just begin switched off.
const ACTIVE = new Set([
  "IMG_2586",
  "IMG_3261",
  "IMG_3266",
  "IMG_4102",
  "IMG_4720",
  "IMG_7467",
  "IMG_8259",
]);

try {
  execFileSync("magick", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ImageMagick is required: brew install imagemagick");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "fit-studio-seed-"));
let failed = 0;
const files = readdirSync(SOURCE).filter((f) => /\.(jpe?g|png|heic)$/i.test(f));

if (files.length === 0) {
  console.error(`no images found in ${SOURCE}/`);
  process.exit(1);
}

for (const file of files) {
  const stem = basename(file, extname(file));
  const out = join(work, `${stem}.jpg`);
  execFileSync("magick", [
    join(SOURCE, file),
    "-auto-orient",
    "-resize",
    "1024x1024>",
    "-strip",
    "-quality",
    "90",
    out,
  ]);

  const bytes = readFileSync(out);
  const upload = async () => {
    const form = new FormData();
    form.set("file", new File([bytes], `${stem}.jpg`, { type: "image/jpeg" }));
    return fetch(`${BASE}/api/photos`, { method: "POST", body: form });
  };

  // Seeding a remote deployment fires 20+ multipart POSTs back to back, which
  // can draw a transient rejection (an HTML error page rather than the API's
  // JSON). One retry after a pause clears it; report the status either way
  // rather than dumping a page of HTML.
  let res = await upload();
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await upload();
  }
  if (!res.ok) {
    const detail = res.headers.get("content-type")?.includes("json")
      ? (await res.json()).error
      : `${res.status} ${res.statusText}`;
    console.error(`  ${stem}: FAILED — ${detail}`);
    failed++;
    continue;
  }

  const { photo } = await res.json();
  const active = ACTIVE.has(stem);
  if (!active) {
    await fetch(`${BASE}/api/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
  }
  console.log(`  ${stem}${active ? "  (active)" : ""}`);
}

console.log(
  `\n${files.length - failed} of ${files.length} photos loaded, ${ACTIVE.size} active.` +
    (failed ? ` ${failed} failed — rerun to retry.` : ""),
);
