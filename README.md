# fit studio

Put clothes from an [are.na](https://www.are.na/sanjana-jagannathan/to-sew-rqyybrm3cee)
channel onto a real model, then restyle them by typing.

Live at **https://fitstudio.macembalest.workers.dev**.

Vite + React + Tailwind on the front, one Cloudflare Worker on the back, R2 for
images and D1 for metadata.

## Running it

```sh
npm install
npm run db:local          # create the D1 tables locally
npm run sync              # mirror production's reference photos into local
npm run dev               # vite + wrangler together
```

Then open http://localhost:8080. Needs a `.dev.vars` with an `OPENAI_API_KEY`
(see `.dev.vars.example`). Wrangler simulates R2 and D1 on disk under
`.wrangler/`, so nothing touches Cloudflare until you deploy.

Local dev and production read the same are.na channel — `ARENA_CHANNEL` in
`wrangler.jsonc` is used by `wrangler dev` and `wrangler deploy` alike — and
`npm run sync` makes the reference set match too, so a local generation is a
fair preview of a real one. Rerun it whenever the set changes in Settings.

`npm run seed` is a different thing: it loads `sanjana_images/` from scratch and
exists to bootstrap an empty deployment, not for everyday local work.

## Deploying

`npm run deploy`. The full recipe — verification commands, migration ordering,
rollback — is in [DEPLOY.md](DEPLOY.md).
