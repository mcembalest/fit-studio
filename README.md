# fit studio

Put clothes from an [are.na](https://www.are.na/sanjana-jagannathan/to-sew-rqyybrm3cee)
channel onto a real model, then restyle them by typing.

Same shape as `runway-atlas`: Vite + React + Tailwind on the front, one Cloudflare
Worker on the back, R2 for images. No container and no search index — this app
doesn't need them.

```
src/          React frontend (vite dev server on :8080)
worker/       Cloudflare Worker — API + image serving (:8787)
schema.sql    D1 tables
scripts/      one-off seeding
```

## Running it

```sh
npm install
npm run db:local          # create the D1 tables locally
npm run dev               # vite + wrangler together
npm run seed              # load sanjana_images/ as reference photos
```

Then open http://localhost:8080. `npm run shot` screenshots the running app and
fails on any console error — handy for checking layout changes (needs
`npx playwright install chromium` once).

Local dev needs `.dev.vars` with an
`OPENAI_API_KEY` (see `.dev.vars.example`); wrangler simulates R2 and D1 on disk
under `.wrangler/`, so nothing touches Cloudflare until you deploy.

## How it works

**Closet** — `/api/closet` reads the are.na channel. Public JSON, no auth. She
adds a block there, it appears in the app. Change `ARENA_CHANNEL` in
`wrangler.jsonc` to point somewhere else.

**Try-on** — `/api/tryon` sends every reference photo plus the garment to
`gpt-image-2`, along with the model description from Settings.

**Remix** — `/api/remix` edits the previous look with `gpt-image-1.5` at
`input_fidelity: high`. When the instruction targets *her* rather than the
clothes ("her hair", "the face", "make her smile"), the reference photos are
sent too, so the model corrects drift instead of compounding it.

**Jobs** — neither of those runs inside the request that asks for it. Both write
a row to `jobs`, wake a Durable Object, and return a job id immediately; the
browser polls `/api/jobs`. So a generation survives a locked phone or a closed
tab, browsing and staging stay live while one runs, and several can run at once.

**Settings** — the reference set and a written description of her. Both are
calibration, not per-look choices, so they live outside the studio flow.

Each look records its `parent_id`, so history is a tree. Selecting an older look
and remixing branches from it rather than overwriting — she can go back two steps
and try a different direction.

## Things learned the hard way

**Reference photos must have EXIF rotation baked into the pixels.** iPhone photos
are stored landscape with an orientation flag; the OpenAI API ignores the flag
and sees them sideways, which badly degrades likeness. Browser uploads are fixed
in `src/lib/image.ts`, the seed script uses `magick -auto-orient -strip`. This was
the single largest quality problem found while building.

**Curate the reference set; don't fill it.** Seven clear solo shots produce a far
better likeness than twelve mixed ones. Group photos and back-to-camera shots add
ambiguity about who the subject is rather than adding signal. Of the 23 photos in
`sanjana_images/`, the seed script starts 7 active and leaves the rest off.

**Model choice is not one-dimensional.** gpt-image-2 is the only model that
reliably frames head-to-toe, so try-on uses it. But `input_fidelity: high` —
which exists to preserve identity and which gpt-image-2 *rejects* — makes
gpt-image-1.5 both faster (≈31s vs 41s) and better at holding her face, so
remix uses that. gpt-image-1-mini is fastest (≈23s) and useless: it substitutes
a different woman.

**Identity drifts across a remix chain.** Each remix re-encodes the previous
output, so by the fourth edit the face has visibly changed. Re-sending the
reference photos on person-directed edits is what pulls it back.

**Await your handlers inside try/catch.** `return handler()` (no `await`) in a
Worker resolves after `fetch` has returned, so rejections skip the catch and the
caller gets a raw 1101 error page. Every route here is `return await`.

**OpenAI refuses some garments.** Sheer and lingerie pieces come back as
`safety_violations=[sexual]`. That's surfaced as a 422 with a plain explanation,
not an error.

**Changing `database_id` orphans local D1 state.** Wrangler keys local storage
by database id, so filling in a real id gives you a fresh empty local database —
rerun `npm run db:local` and `npm run seed`.

**Generations take 20–55 seconds, and `ctx.waitUntil()` is cancelled at 30.**
Those two numbers are why generation lives in a Durable Object alarm (15 minute
budget) rather than in the request or in `waitUntil`. Returning 202 and
finishing in `waitUntil` looks right and quietly kills long generations halfway,
after OpenAI has already been paid.

**`input_fidelity` is a gpt-image-1.x parameter.** gpt-image-2 rejects it with
`invalid_input_fidelity_model`.

## Deploying

Live at **https://fitstudio.macembalest.workers.dev**. Everything already
exists, so a redeploy is just `npm run deploy` — full recipe, verification
commands, migration ordering and rollback are in [DEPLOY.md](DEPLOY.md).

The app has no auth. That URL is an open door to the OpenAI key — anyone who
finds it can spend against it. Put Cloudflare Access in front of it before
sharing it anywhere public.
