# Deploying and updating fit studio

Everything below assumes you are in the repo root on `main`.

## What exists

| Thing | Value |
|---|---|
| Live URL | https://fitstudio.macembalest.workers.dev |
| Worker | `fitstudio` (no hyphen — the hyphen would change the URL) |
| R2 bucket | `fit-studio` — reference photos under `photos/`, generations under `looks/` |
| D1 database | `fit-studio`, id `de5e6bc7-8767-44cd-8838-f1aed0af08d3` |
| Secret | `OPENAI_API_KEY`, set with `npx wrangler secret put OPENAI_API_KEY` |
| Local secret | `.dev.vars` (gitignored; `.dev.vars.example` shows the shape) |
| Closet source | are.na channel `to-sew-rqyybrm3cee`, `ARENA_CHANNEL` in `wrangler.jsonc` |
| Durable Object | `GenerationJob`, bound as `JOBS` — runs generations in the background |

All of it already exists. Do not re-create the bucket or database.

## Everyday update

```sh
npm run typecheck        # must be clean
npm run deploy           # vite build && wrangler deploy
```

Then verify (see below). Deploys are atomic and take a few seconds; anything
mid-generation finishes on the old version.

## Local development

```sh
npm install
npm run db:local         # applies schema.sql to the simulated local D1
npm run dev              # vite on :8080, wrangler on :8787
npm run seed             # loads the curated reference photos
```

Open http://localhost:8080. Wrangler simulates R2 and D1 under `.wrangler/`, so
local work never touches production.

`npm run shot` screenshots the running app and exits non-zero on any console
error. Needs `npx playwright install chromium` once.

## Schema changes

`schema.sql` is the full current schema for fresh setups. Each change also gets
a numbered file in `migrations/` so existing databases can be moved forward.

```sh
npx wrangler d1 execute fit-studio --local  --file=migrations/00X_thing.sql
npx wrangler d1 execute fit-studio --remote --file=migrations/00X_thing.sql
```

**Order matters when removing something.** Deploy code that no longer uses a
column *before* dropping it, and leave ~30s between the two — the edge serves
the previous version briefly after a deploy, and that old code will error on the
missing column. For additive changes, migrate first so the new code never meets
a table that isn't there yet.

Note the `migrations` key in `wrangler.jsonc` is unrelated: that is wrangler's
Durable Object class registry, and it is applied by `wrangler deploy` itself.

## Reference photos and settings

There is no on/off state. **Every photo in Settings is sent on every
generation**, so curating the set means adding and deleting.

Keep clear solo shots. Group photos and distant shots make the subject
ambiguous, and a photo of someone else teaches the model the wrong face — this
happened and was a real cause of bad likeness. `scripts/seed-photos.mjs` holds
the curated list in `KEEP`.

The written description of her is edited in Settings and stored in D1, so
changing it needs no redeploy. It is added to every prompt — it is the right
place for anything you keep correcting by hand.

To load photos into production:

```sh
FIT_STUDIO_URL=https://fitstudio.macembalest.workers.dev npm run seed
```

## Verify after deploying

```sh
U=https://fitstudio.macembalest.workers.dev
curl -s -o /dev/null -w "index %{http_code}\n" $U/
curl -s "$U/api/settings?cb=$RANDOM"                 # cache-bust: the edge can serve a stale 404
curl -s $U/api/photos  | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["photos"]),"photos")'
curl -s $U/api/closet  | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["garments"]),"garments")'
curl -s $U/api/looks   | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["looks"]),"looks")'
```

```sh
curl -s "$U/api/jobs?cb=$RANDOM" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["jobs"]),"jobs")'
```

For a real end-to-end check, stage a garment in the UI and press Generate, or
submit a job and watch it. The POST should come back in well under a second —
if it blocks for 20s+, generation has been moved back into the request:

```sh
P=$(curl -s $U/api/looks | python3 -c 'import json,sys;print(json.load(sys.stdin)["looks"][-1]["id"])')
time curl -s -X POST $U/api/remix -H 'content-type: application/json' \
  -d "{\"parentId\":\"$P\",\"prompt\":\"make the backdrop pale blue\",\"quality\":\"low\",\"clientToken\":\"check-$RANDOM\"}"

# then poll until status is done or error (15-30s at quality low)
curl -s "$U/api/jobs?cb=$RANDOM" | python3 -c 'import json,sys;j=json.load(sys.stdin)["jobs"][0];print(j["status"],j["look_id"],j["error"])'
```

Live logs: `npx wrangler tail --format pretty`.

## Rolling back

```sh
npx wrangler deployments list      # find the previous version id
npx wrangler rollback [version-id]
```

R2 and D1 are not rolled back by this — only the code.

## Expected failures that are not bugs

- **A job ending in `error` with a message about the safety filter.** OpenAI
  refuses sheer and lingerie garments; her channel has several. The app surfaces
  this as a plain explanation. Nothing to fix.
- **A stale response right after deploying.** The edge caches briefly. Retry
  with a `?cb=$RANDOM` query before concluding something is broken. A brand new
  route will 404 for a few seconds this way.
- **Generations taking 20–55s.** See the timings in `worker/openai.ts`. This no
  longer blocks anything: the POST returns immediately and the work runs in the
  `GenerationJob` Durable Object.
- **A job stuck in `queued`/`running` flipping to `error` after five minutes.**
  That is the stale sweep in `listJobs`, and it means the Durable Object was
  evicted or its alarm never fired. Rare; the fix is to submit again.
