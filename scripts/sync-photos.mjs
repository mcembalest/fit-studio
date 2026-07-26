#!/usr/bin/env node
// Mirrors the *production* reference set into local dev: the same photos and
// the same written description of her, so a local generation looks like a real
// one instead of like whatever happened to be seeded months ago.
//
//   npm run sync
//
// This talks to D1 and R2 through wrangler, not over HTTPS, so it needs no
// Cloudflare Access service token — the hostname is guarded, the API is not.
//
// It replaces the local reference set rather than adding to it. That is the
// point: every photo in the set is sent on every generation, so a local set
// that merely overlaps production would produce different results.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB = "fit-studio";
const BUCKET = "fit-studio";

const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** wrangler --json wraps results as [{ results: [...], success, meta }]. */
function query(where, sql) {
  const out = wrangler(["d1", "execute", DB, where, "--json", "--command", sql]);
  // Wrangler prints a banner before the JSON when the version is stale.
  const json = out.slice(out.indexOf("["));
  return JSON.parse(json)[0].results;
}

const photos = query(
  "--remote",
  "SELECT id, r2_key, filename, created_at FROM model_photos ORDER BY created_at",
);
if (photos.length === 0) {
  console.error("production has no reference photos — nothing to mirror");
  process.exit(1);
}

const [description] = query(
  "--remote",
  "SELECT value FROM settings WHERE key = 'model_description'",
);

console.log(`mirroring ${photos.length} reference photos from production`);

const work = mkdtempSync(join(tmpdir(), "fit-studio-sync-"));
for (const photo of photos) {
  const file = join(work, photo.id);
  wrangler(["r2", "object", "get", `${BUCKET}/${photo.r2_key}`, "--file", file, "--remote"]);
  wrangler(["r2", "object", "put", `${BUCKET}/${photo.r2_key}`, "--file", file, "--local"]);
  console.log(`  ${photo.filename}`);
}

// One transaction-ish file rather than a command per row: the description can
// contain quotes, and building SQL by hand string-by-string is how that breaks.
const sql = [
  "DELETE FROM model_photos;",
  ...photos.map(
    (p) =>
      `INSERT INTO model_photos (id, r2_key, filename, created_at) VALUES (${[
        p.id,
        p.r2_key,
        p.filename,
        p.created_at,
      ]
        .map(quote)
        .join(", ")});`,
  ),
  description?.value
    ? `INSERT INTO settings (key, value, updated_at) VALUES ('model_description', ${quote(
        description.value,
      )}, ${quote(new Date().toISOString())})
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
    : "",
]
  .filter(Boolean)
  .join("\n");

const sqlFile = join(work, "sync.sql");
writeFileSync(sqlFile, sql);
wrangler(["d1", "execute", DB, "--local", "--file", sqlFile]);

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

console.log(
  `\nlocal dev now matches production: ${photos.length} photos` +
    (description?.value ? " and her description" : ""),
);
