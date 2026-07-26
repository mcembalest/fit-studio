import { tryOn, remix, isPersonEdit, type ImageInput } from "./openai";

interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;
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

/** The frozen reference set: every active photo, loaded and ready to send. */
async function activePhotos(env: Env): Promise<ImageInput[]> {
  const { results } = await env.DB.prepare(
    `SELECT r2_key FROM model_photos WHERE active = 1 ORDER BY created_at`,
  ).all<{ r2_key: string }>();
  return Promise.all(results.map((p, i) => load(env, p.r2_key, `ref-${i + 1}.jpg`)));
}

// --- reference photos -------------------------------------------------------

async function listPhotos(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key, filename, active, created_at FROM model_photos ORDER BY created_at`,
  ).all<{ id: string; r2_key: string; filename: string; active: number; created_at: string }>();

  return json({
    photos: results.map((p) => ({
      id: p.id,
      filename: p.filename,
      active: p.active === 1,
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
    `INSERT INTO model_photos (id, r2_key, filename, active, created_at) VALUES (?, ?, ?, 1, ?)`,
  )
    .bind(photoId, key, file.name || `${photoId}.jpg`, now())
    .run();

  return json({
    photo: { id: photoId, filename: file.name, active: true, src: `/img/${key}` },
  });
}

async function setPhotoActive(env: Env, photoId: string, request: Request) {
  const { active } = (await request.json()) as { active?: boolean };
  await env.DB.prepare(`UPDATE model_photos SET active = ? WHERE id = ?`)
    .bind(active ? 1 : 0, photoId)
    .run();
  return json({ ok: true });
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

async function handleTryOn(env: Env, request: Request) {
  const { garmentUrl, garmentTitle, prompt } = (await request.json()) as {
    garmentUrl?: string;
    garmentTitle?: string;
    prompt?: string;
  };
  if (!garmentUrl) return fail("garmentUrl is required");

  const photos = await activePhotos(env);
  if (photos.length === 0) {
    return fail("No reference photos are active — turn some on in Settings.", 409);
  }

  const description = await getSetting(env, "model_description", DEFAULT_DESCRIPTION);
  const garment = await fetchGarment(garmentUrl);
  const png = await tryOn(
    env.OPENAI_API_KEY,
    photos,
    garment,
    description,
    prompt ?? "",
    OUTPUT_SIZE,
  );

  return json({
    look: await saveLook(env, png, {
      parent_id: null,
      prompt: prompt?.trim() || `Wearing ${garmentTitle ?? "garment"}`,
      garment_url: garmentUrl,
      garment_title: garmentTitle ?? null,
    }),
  });
}

async function handleRemix(env: Env, request: Request) {
  const { parentId, prompt, quality } = (await request.json()) as {
    parentId?: string;
    prompt?: string;
    quality?: "low" | "medium";
  };
  if (!parentId) return fail("parentId is required");
  if (!prompt?.trim()) return fail("prompt is required");

  const parent = await env.DB.prepare(
    `SELECT r2_key, garment_url, garment_title FROM looks WHERE id = ?`,
  )
    .bind(parentId)
    .first<{ r2_key: string; garment_url: string | null; garment_title: string | null }>();
  if (!parent) return fail("no such look", 404);

  const previous = await load(env, parent.r2_key, "previous.png");
  const description = await getSetting(env, "model_description", DEFAULT_DESCRIPTION);

  // Edits aimed at her appearance get the reference photos sent along, so the
  // model can correct drift instead of compounding it. Garment edits skip that
  // and stay cheap.
  const grounded = isPersonEdit(prompt) ? await activePhotos(env) : [];

  const png = await remix(
    env.OPENAI_API_KEY,
    previous,
    grounded,
    description,
    prompt,
    OUTPUT_SIZE,
    quality === "medium" ? "medium" : "low",
  );

  return json({
    look: await saveLook(env, png, {
      parent_id: parentId,
      prompt: prompt.trim(),
      // Carried down the tree so a remixed look still knows which are.na
      // garment it descends from.
      garment_url: parent.garment_url,
      garment_title: parent.garment_title,
    }),
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
      if (path === "/api/tryon" && method === "POST")
        return await handleTryOn(env, request);
      if (path === "/api/remix" && method === "POST")
        return await handleRemix(env, request);

      const photoMatch = path.match(/^\/api\/photos\/([\w-]+)$/);
      if (photoMatch) {
        if (method === "PATCH")
          return await setPhotoActive(env, photoMatch[1], request);
        if (method === "DELETE") return await deletePhoto(env, photoMatch[1]);
      }

      return fail("not found", 404);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "unknown error";
      // OpenAI refuses some garments outright — sheer or lingerie pieces in her
      // channel come back as a safety violation. That is not a failure of the
      // app, and it shouldn't read like one.
      if (/safety system|safety_violations/i.test(message)) {
        return fail(
          "OpenAI wouldn't generate this piece — its safety filter blocks sheer " +
            "or revealing garments. Try a different piece.",
          422,
        );
      }
      return fail(message, 500);
    }
  },
};
