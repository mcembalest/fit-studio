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

// Only these are loaded. Everything sent becomes part of the reference set, and
// the rest of sanjana_images/ is group shots, back-to-camera, or her too small
// in frame — those make the subject ambiguous rather than better described. One
// of them is a different person entirely. Add more from Settings if you want.
const KEEP = new Set([
  "IMG_1238",
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
let loaded = 0;
const files = readdirSync(SOURCE).filter((f) => /\.(jpe?g|png|heic)$/i.test(f));

if (files.length === 0) {
  console.error(`no images found in ${SOURCE}/`);
  process.exit(1);
}

for (const file of files) {
  const stem = basename(file, extname(file));
  if (!KEEP.has(stem)) continue;
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

  await res.json();
  loaded++;
  console.log(`  ${stem}`);
}

console.log(
  `\n${loaded} of ${KEEP.size} reference photos loaded.` +
    (failed ? ` ${failed} failed — rerun to retry.` : ""),
);
