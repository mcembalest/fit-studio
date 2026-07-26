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
npm run dev               # vite + wrangler together
npm run seed              # load sanjana_images/ as reference photos
```

Then open http://localhost:8080. Needs a `.dev.vars` with an `OPENAI_API_KEY`
(see `.dev.vars.example`). Wrangler simulates R2 and D1 on disk under
`.wrangler/`, so nothing touches Cloudflare until you deploy.

## Deploying

`npm run deploy`. The full recipe — verification commands, migration ordering,
rollback — is in [DEPLOY.md](DEPLOY.md).
