import { DurableObject } from "cloudflare:workers";
import { tryOn, remix, isPersonEdit, type ImageInput, type Quality } from "./openai";

interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;
  JOBS: DurableObjectNamespace<GenerationJob>;
  OPENAI_API_KEY: string;
  ARENA_CHANNEL: string;
}

// Portrait, because these are full-body fashion shots.
const OUTPUT_SIZE = "1024x1536";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/**
 * A message worth showing her. Called both by the router and by the background
 * job, since a generation can now fail long after the request that asked for it
 * has been answered — the explanation has to be stored, not just returned.
 */
function explain(err: unknown): { message: string; status: number } {
  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  // OpenAI refuses some garments outright — sheer or lingerie pieces in her
  // channel come back as a safety violation. That is not a failure of the app,
  // and it shouldn't read like one.
  if (/safety system|safety_violations/i.test(message)) {
    return {
      message:
        "OpenAI wouldn't generate this piece — its safety filter blocks sheer " +
        "or revealing garments. Try a different piece.",
      status: 422,
    };
  }
  return { message, status: 500 };
}

// --- are.na -----------------------------------------------------------------

interface ArenaBlock {
  id: number;
  class: string;
  generated_title?: string;
  title?: string;
  description?: string;
  image?: { display?: { url?: string }; thumb?: { url?: string } };
}

/**
 * The closet. are.na channels are public JSON with no auth, so "her closet" is
 * a read of her channel — she adds a block there and it shows up here.
 */
async function closet(env: Env): Promise<Response> {
  const channel = env.ARENA_CHANNEL;
  const res = await fetch(
    `https://api.are.na/v2/channels/${channel}/contents?per=100&direction=desc`,
    { cf: { cacheTtl: 300, cacheEverything: true } },
  );
  if (!res.ok) return fail(`are.na returned ${res.status}`, 502);

  const body = (await res.json()) as { contents?: ArenaBlock[] };
  const garments = (body.contents ?? [])
    .filter((b) => b.class === "Image" && b.image?.display?.url)
    .map((b) => ({
      id: String(b.id),
      title: b.title || b.generated_title || "Untitled",
      description: b.description ?? "",
      url: b.image!.display!.url!,
      thumb: b.image?.thumb?.url ?? b.image!.display!.url!,
    }));

  return json({ garments });
}

// --- storage helpers --------------------------------------------------------

async function load(env: Env, key: string, filename: string): Promise<ImageInput> {
  const obj = await env.BUCKET.get(key);
  if (!obj) throw new Error(`missing image: ${key}`);
  return {
    bytes: await obj.arrayBuffer(),
    filename,
    type: obj.httpMetadata?.contentType ?? "image/jpeg",
  };
}

async function fetchGarment(url: string): Promise<ImageInput> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch garment (${res.status})`);
  return {
    bytes: await res.arrayBuffer(),
    filename: "garment.jpg",
    type: res.headers.get("content-type") ?? "image/jpeg",
  };
}

async function saveLook(
  env: Env,
  png: Uint8Array,
  row: {
    parent_id: string | null;
    prompt: string;
    garment_url: string | null;
    garment_title: string | null;
  },
) {
  const lookId = id();
  const key = `looks/${lookId}.png`;
  await env.BUCKET.put(key, png, {
    httpMetadata: { contentType: "image/png" },
  });
  const created = now();
  await env.DB.prepare(
    `INSERT INTO looks (id, parent_id, r2_key, prompt, garment_url, garment_title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      lookId,
      row.parent_id,
      key,
      row.prompt,
      row.garment_url,
      row.garment_title,
      created,
    )
    .run();

  return { id: lookId, src: `/img/${key}`, ...row, created_at: created };
}

// --- settings ---------------------------------------------------------------

// A starting point only — this is meant to be corrected in Settings. It encodes
// what her sessions kept asking for by hand (longer hair) and pushes against
// the model's habit of idealising a body.
const DEFAULT_DESCRIPTION =
  "Slim build with narrow shoulders and a small frame. Long, dark, tightly curled " +
  "hair falling well below the chest. Warm medium-brown skin with natural texture. " +
  "Dark brown eyes, soft rounded jawline, relaxed natural expression.";

async function getSetting(env: Env, key: string, fallback: string) {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

async function readSettings(env: Env) {
  return json({
    modelDescription: await getSetting(env, "model_description", DEFAULT_DESCRIPTION),
  });
}

async function writeSettings(env: Env, request: Request) {
  const { modelDescription } = (await request.json()) as { modelDescription?: string };
  if (typeof modelDescription === "string") {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('model_description', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(modelDescription, now())
      .run();
  }
  return json({ ok: true });
}

/**
 * The frozen reference set — every photo in Settings, loaded and ready to send.
 * There is no on/off state: what is in Settings is what the model sees, so
 * removing a photo from the set means deleting it.
 */
async function referencePhotos(env: Env): Promise<ImageInput[]> {
  const { results } = await env.DB.prepare(
    `SELECT r2_key FROM model_photos ORDER BY created_at`,
  ).all<{ r2_key: string }>();
  return Promise.all(results.map((p, i) => load(env, p.r2_key, `ref-${i + 1}.jpg`)));
}

// --- reference photos -------------------------------------------------------

async function listPhotos(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key, filename, created_at FROM model_photos ORDER BY created_at`,
  ).all<{ id: string; r2_key: string; filename: string; created_at: string }>();

  return json({
    photos: results.map((p) => ({
      id: p.id,
      filename: p.filename,
      src: `/img/${p.r2_key}`,
      created_at: p.created_at,
    })),
  });
}

async function uploadPhoto(env: Env, request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("expected a `file` field");

  const photoId = id();
  const key = `photos/${photoId}.jpg`;
  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "image/jpeg" },
  });
  await env.DB.prepare(
    `INSERT INTO model_photos (id, r2_key, filename, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(photoId, key, file.name || `${photoId}.jpg`, now())
    .run();

  return json({ photo: { id: photoId, filename: file.name, src: `/img/${key}` } });
}

async function deletePhoto(env: Env, photoId: string) {
  const row = await env.DB.prepare(`SELECT r2_key FROM model_photos WHERE id = ?`)
    .bind(photoId)
    .first<{ r2_key: string }>();
  if (row) await env.BUCKET.delete(row.r2_key);
  await env.DB.prepare(`DELETE FROM model_photos WHERE id = ?`).bind(photoId).run();
  return json({ ok: true });
}

// --- generation -------------------------------------------------------------
//
// A generation takes 20-55 seconds, which is far too long to hold a request
// open: on a phone, locking the screen or switching apps drops the connection
// and the image is lost after it has already been paid for. So the request only
// *records* the work and hands back a job id.
//
// The work itself runs in a Durable Object alarm. That is not incidental —
// ctx.waitUntil() is capped at 30 seconds after the response is sent, so
// anything longer gets cancelled halfway through. An alarm gets 15 minutes.

interface TryOnRequest {
  garmentUrl: string;
  garmentTitle: string | null;
  prompt: string;
}

interface RemixRequest {
  parentId: string;
  prompt: string;
  quality: Quality;
}

type JobStatus = "queued" | "running" | "done" | "error";

interface JobRow {
  id: string;
  kind: "tryon" | "remix";
  status: JobStatus;
  request: string;
  prompt: string;
  parent_id: string | null;
  garment_title: string | null;
  look_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const shapeJob = ({ request: _request, ...job }: JobRow) => job;

const getJob = (env: Env, jobId: string) =>
  env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<JobRow>();

/**
 * Record the work and wake something up to do it. Validation that can be done
 * cheaply has already happened in the handler, so she finds out about a missing
 * reference set or a bad garment immediately rather than 40 seconds later.
 */
async function startJob(
  env: Env,
  spec: {
    kind: "tryon" | "remix";
    clientToken: string | null;
    prompt: string;
    parentId: string | null;
    garmentTitle: string | null;
    request: TryOnRequest | RemixRequest;
  },
): Promise<Response> {
  // A resubmitted POST — a double tap, or a retry after the phone dropped
  // signal mid-request — must not buy a second generation.
  if (spec.clientToken) {
    const existing = await env.DB.prepare(`SELECT * FROM jobs WHERE client_token = ?`)
      .bind(spec.clientToken)
      .first<JobRow>();
    if (existing) return json({ job: shapeJob(existing) });
  }

  const jobId = id();
  await env.DB.prepare(
    `INSERT INTO jobs (id, client_token, kind, status, request, prompt, parent_id, garment_title, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
  )
    .bind(
      jobId,
      spec.clientToken,
      spec.kind,
      JSON.stringify(spec.request),
      spec.prompt,
      spec.parentId,
      spec.garmentTitle,
      now(),
    )
    .run();

  try {
    await env.JOBS.get(env.JOBS.idFromName(jobId)).start(jobId);
  } catch (err) {
    // Nothing will ever pick this up, so say so now rather than leaving a
    // spinner running until the stale sweep notices five minutes from now.
    await finishJob(env, jobId, { error: explain(err).message });
    throw err;
  }

  return json({ job: shapeJob((await getJob(env, jobId))!) }, 202);
}

async function finishJob(
  env: Env,
  jobId: string,
  outcome: { lookId?: string; error?: string },
) {
  await env.DB.prepare(
    `UPDATE jobs SET status = ?, look_id = ?, error = ?, finished_at = ?
     WHERE id = ? AND status IN ('queued', 'running')`,
  )
    .bind(
      outcome.error ? "error" : "done",
      outcome.lookId ?? null,
      outcome.error ?? null,
      now(),
      jobId,
    )
    .run();
}

async function generateTryOn(env: Env, req: TryOnRequest) {
  const photos = await referencePhotos(env);
  if (photos.length === 0) throw new Error("No reference photos — add some in Settings.");

  const description = await getSetting(env, "model_description", DEFAULT_DESCRIPTION);
  const garment = await fetchGarment(req.garmentUrl);
  const png = await tryOn(
    env.OPENAI_API_KEY,
    photos,
    garment,
    description,
    req.prompt,
    OUTPUT_SIZE,
  );

  return saveLook(env, png, {
    parent_id: null,
    prompt: req.prompt.trim() || `Wearing ${req.garmentTitle ?? "garment"}`,
    garment_url: req.garmentUrl,
    garment_title: req.garmentTitle,
  });
}

async function generateRemix(env: Env, req: RemixRequest) {
  const parent = await env.DB.prepare(
    `SELECT r2_key, garment_url, garment_title FROM looks WHERE id = ?`,
  )
    .bind(req.parentId)
    .first<{ r2_key: string; garment_url: string | null; garment_title: string | null }>();
  if (!parent) throw new Error("the look being edited no longer exists");

  const previous = await load(env, parent.r2_key, "previous.png");
  const description = await getSetting(env, "model_description", DEFAULT_DESCRIPTION);

  // Edits aimed at her appearance get the reference photos sent along, so the
  // model can correct drift instead of compounding it. Garment edits skip that
  // and stay cheap.
  const grounded = isPersonEdit(req.prompt) ? await referencePhotos(env) : [];

  const png = await remix(
    env.OPENAI_API_KEY,
    previous,
    grounded,
    description,
    req.prompt,
    OUTPUT_SIZE,
    req.quality,
  );

  return saveLook(env, png, {
    parent_id: req.parentId,
    prompt: req.prompt.trim(),
    // Carried down the tree so a remixed look still knows which are.na garment
    // it descends from.
    garment_url: parent.garment_url,
    garment_title: parent.garment_title,
  });
}

async function runJob(env: Env, jobId: string) {
  // Claiming the job *is* the guard against running it twice: only one caller
  // can move the row out of 'queued', so a duplicate start or a retried alarm
  // costs nothing instead of paying OpenAI a second time.
  const claim = await env.DB.prepare(
    `UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`,
  )
    .bind(now(), jobId)
    .run();
  if (claim.meta.changes === 0) return;

  const job = await getJob(env, jobId);
  if (!job) return;

  const request = JSON.parse(job.request);
  const look =
    job.kind === "tryon"
      ? await generateTryOn(env, request as TryOnRequest)
      : await generateRemix(env, request as RemixRequest);

  await finishJob(env, jobId, { lookId: look.id });
}

/**
 * Runs one generation, off the back of a request that has already been
 * answered. One instance per job id, so jobs never queue behind each other.
 */
export class GenerationJob extends DurableObject<Env> {
  async start(jobId: string) {
    await this.ctx.storage.put("jobId", jobId);
    // Fires as soon as this call returns, in a fresh invocation with a 15
    // minute budget — which is the entire reason for this class. waitUntil()
    // would be cancelled at 30 seconds, mid-generation.
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const jobId = await this.ctx.storage.get<string>("jobId");
    // Clear first: this object exists for exactly one job, and dropping the
    // state now means a retry can't start a second generation.
    await this.ctx.storage.deleteAll();
    if (!jobId) return;

    // Deliberately never rethrows. An alarm that throws is retried
    // automatically with backoff, and a retry here means paying for another
    // 40-second generation that will usually fail identically — a safety
    // refusal always will. Failures are recorded, not retried.
    try {
      await runJob(this.env, jobId);
    } catch (err) {
      console.error("job failed", jobId, err);
      await finishJob(this.env, jobId, { error: explain(err).message });
    }
  }
}

// The worst honest case is a ~55 second generation. A job still unfinished
// after five minutes means the Durable Object was evicted mid-run or the alarm
// never fired — without this it would sit in the UI as a spinner forever.
const STALE_MS = 5 * 60 * 1000;

async function listJobs(env: Env) {
  await env.DB.prepare(
    `UPDATE jobs SET status = 'error', error = ?, finished_at = ?
     WHERE status IN ('queued', 'running') AND created_at < ?`,
  )
    .bind(
      "Generation timed out — nothing came back. Try again.",
      now(),
      new Date(Date.now() - STALE_MS).toISOString(),
    )
    .run();

  // Enough history for the client to notice anything that finished while it
  // was closed, without sending the whole table on every poll.
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20`,
  ).all<JobRow>();

  return json({ jobs: results.map(shapeJob) });
}

async function handleTryOn(env: Env, request: Request) {
  const { garmentUrl, garmentTitle, prompt, clientToken } = (await request.json()) as {
    garmentUrl?: string;
    garmentTitle?: string;
    prompt?: string;
    clientToken?: string;
  };
  if (!garmentUrl) return fail("garmentUrl is required");

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM model_photos`,
  ).first<{ n: number }>();
  if (!count?.n) return fail("No reference photos yet — add some in Settings.", 409);

  const title = garmentTitle ?? null;
  return await startJob(env, {
    kind: "tryon",
    clientToken: clientToken ?? null,
    prompt: prompt?.trim() || `Wearing ${title ?? "garment"}`,
    parentId: null,
    garmentTitle: title,
    request: { garmentUrl, garmentTitle: title, prompt: prompt ?? "" },
  });
}

async function handleRemix(env: Env, request: Request) {
  const { parentId, prompt, quality, clientToken } = (await request.json()) as {
    parentId?: string;
    prompt?: string;
    quality?: Quality;
    clientToken?: string;
  };
  if (!parentId) return fail("parentId is required");
  if (!prompt?.trim()) return fail("prompt is required");

  const parent = await env.DB.prepare(`SELECT garment_title FROM looks WHERE id = ?`)
    .bind(parentId)
    .first<{ garment_title: string | null }>();
  if (!parent) return fail("no such look", 404);

  return await startJob(env, {
    kind: "remix",
    clientToken: clientToken ?? null,
    prompt: prompt.trim(),
    parentId,
    garmentTitle: parent.garment_title,
    request: {
      parentId,
      prompt: prompt.trim(),
      quality: quality === "medium" ? "medium" : "low",
    },
  });
}

async function listLooks(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, parent_id, r2_key, prompt, garment_url, garment_title, created_at
     FROM looks ORDER BY created_at`,
  ).all<{
    id: string;
    parent_id: string | null;
    r2_key: string;
    prompt: string;
    garment_url: string | null;
    garment_title: string | null;
    created_at: string;
  }>();

  return json({
    looks: results.map(({ r2_key, ...l }) => ({ ...l, src: `/img/${r2_key}` })),
  });
}

// --- router -----------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path.startsWith("/img/")) {
        const obj = await env.BUCKET.get(path.slice("/img/".length));
        if (!obj) return new Response("not found", { status: 404 });
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType ?? "image/png",
            // Keys are content-addressed by uuid, so these never change.
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }

      // Every handler is awaited here rather than returned. A bare
      // `return handler()` inside try/catch resolves the promise *after* fetch
      // has already returned, so rejections skip this catch entirely and the
      // caller gets a raw Cloudflare 1101 page instead of a JSON error.
      if (path === "/api/closet" && method === "GET") return await closet(env);
      if (path === "/api/settings" && method === "GET") return await readSettings(env);
      if (path === "/api/settings" && method === "PUT")
        return await writeSettings(env, request);
      if (path === "/api/photos" && method === "GET") return await listPhotos(env);
      if (path === "/api/photos" && method === "POST")
        return await uploadPhoto(env, request);
      if (path === "/api/looks" && method === "GET") return await listLooks(env);
      if (path === "/api/jobs" && method === "GET") return await listJobs(env);
      if (path === "/api/tryon" && method === "POST")
        return await handleTryOn(env, request);
      if (path === "/api/remix" && method === "POST")
        return await handleRemix(env, request);

      const photoMatch = path.match(/^\/api\/photos\/([\w-]+)$/);
      if (photoMatch && method === "DELETE") {
        return await deletePhoto(env, photoMatch[1]);
      }

      return fail("not found", 404);
    } catch (err) {
      console.error(err);
      const { message, status } = explain(err);
      return fail(message, status);
    }
  },
};
