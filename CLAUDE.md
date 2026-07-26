# fit studio

Puts clothes from an are.na channel onto a real model (Sanjana), then restyles
them from a text prompt. Vite + React + Tailwind front end, one Cloudflare
Worker back end, R2 for images, D1 for metadata.

**Live at https://fitstudio.macembalest.workers.dev — deploy and verify steps are
in [DEPLOY.md](DEPLOY.md). Read that before deploying or touching the schema.**

```
src/            React app (:8080 in dev)
worker/index.ts routes + the GenerationJob Durable Object; worker/openai.ts generation
schema.sql      full schema for fresh setups
migrations/     numbered forward migrations for existing databases
scripts/        seed-photos.mjs, screenshot.mjs
```

Generation is a **background job**, not a request. `POST /api/tryon` and
`/api/remix` write a row to `jobs`, wake a Durable Object, and return a job id
in well under a second. The client polls `GET /api/jobs` and folds finished work
into the looks list. Nothing in the UI blocks while a generation runs.

## Things that are easy to get wrong

**`ctx.waitUntil()` is cancelled 30 seconds after the response is sent.** A
generation takes 20–55s, so the obvious "return 202 and finish in the
background" shape silently kills generations halfway — after OpenAI has been
paid. That is the whole reason `GenerationJob` is a Durable Object: an alarm
gets 15 minutes. Do not move this work back into `waitUntil`.

**A Durable Object alarm that throws is retried automatically** (six times,
exponential backoff). Here that would mean paying for another 40-second
generation that usually fails identically — a safety refusal always will. So
`alarm()` catches everything and records the failure instead of rethrowing, and
`runJob` claims the row with `UPDATE ... WHERE status = 'queued'` so a duplicate
start can't double-charge.

**Reference photos must have EXIF rotation baked into the pixels.** iPhone
photos are stored landscape with an orientation flag; the OpenAI API ignores the
flag, sees them sideways, and likeness degrades badly. Browser uploads are
normalized in `src/lib/image.ts`; the seed script uses `magick -auto-orient
-strip`. This was the single largest quality bug found.

**Curate the reference set; don't fill it.** Every photo in Settings is sent on
every generation — there is no on/off state. A handful of clear solo shots beats
a dozen mixed ones. Group shots and distant shots make the subject ambiguous,
and at one point the set contained a photo of a *different person*, which was a
real cause of bad faces.

**The two models are not interchangeable, and the fast lever is `quality`.**
Try-on uses `gpt-image-2` (the only one that reliably frames head-to-toe).
Remix uses `gpt-image-1.5` with `input_fidelity: high` — faster *and* better at
holding her face. `gpt-image-2` rejects `input_fidelity` outright.
`gpt-image-1-mini` and `chatgpt-image-latest` substitute a different woman and
are unusable. Quality low ≈18–20s vs medium ≈28–31s; exposed as Quick/Best.

**Identity drifts across a remix chain.** Each remix re-encodes the previous
output, so by the fourth edit the face has visibly changed. When an instruction
targets *her* (`isPersonEdit` in `worker/openai.ts`), the reference photos are
re-sent so the model corrects drift instead of compounding it.

**`return await` every handler inside try/catch.** A bare `return handler()`
resolves after `fetch` has returned, so rejections skip the catch and the caller
gets a raw Cloudflare 1101 page instead of a JSON error.

**CSS traps this layout already hit.** `aspect-*` on a grid item contributes
nothing to row sizing (it resolves against a definite width only *after* the row
is sized), so square tiles use percentage padding instead. Tailwind's
`content-start` emits the flexbox-only `flex-start`, which grid ignores — use
`[align-content:start]`. Grid children need `min-w-0` or wide content pushes the
column past the viewport.

**Job state is the source of truth, and the client only reacts to
*transitions*.** `App.tsx` keeps a `seen` map of job id → status and acts only
when a status changes while it is watching, so a reload doesn't re-announce work
that finished hours ago. Two ordering rules there are load-bearing: fetch the
new looks *before* clearing the pending placeholders (otherwise the strip blinks
with the generation apparently gone), and don't commit `seen` until that fetch
succeeds (otherwise a dropped poll strands the look forever).

**Check mobile at 360px, not just 390px.** Overflow and cramping show up there
first. `npm run shot` catches console errors; layout problems need a real look.

## Working style for this repo

Verify against the real thing rather than reasoning about it — this project has
produced several confident-but-wrong diagnoses that a single screenshot or
`curl` settled in seconds. Generations cost money and 20–55s, so batch
experiments rather than iterating one at a time.

The UI is deliberately plain: semantic markup, no component library, all colour
routed through CSS custom properties at the top of `src/index.css`. Sanjana does
the visual design — keep logic and styling separable and don't impose a look.
