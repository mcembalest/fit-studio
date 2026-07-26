export interface Garment {
  id: string;
  title: string;
  description: string;
  url: string;
  thumb: string;
}

export interface Photo {
  id: string;
  filename: string;
  src: string;
}

export interface Look {
  id: string;
  parent_id: string | null;
  src: string;
  prompt: string;
  garment_url: string | null;
  garment_title: string | null;
  created_at: string;
}

const UNREACHABLE =
  "Can't reach fit studio. Check your connection, or reload the page to sign in again.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    // Offline — or a Cloudflare Access session that has expired, which bounces
    // to a login host a same-origin fetch isn't allowed to read. Both look like
    // a bare network error from here, and reloading fixes both.
    throw new Error(UNREACHABLE);
  }

  // Access can also answer with the login page itself, which would otherwise
  // blow up as a JSON parse error somewhere unhelpful.
  if (!res.headers.get("content-type")?.includes("json")) throw new Error(UNREACHABLE);

  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
  return body;
}

export const getCloset = () =>
  call<{ garments: Garment[] }>("/api/closet").then((r) => r.garments);

export const getPhotos = () =>
  call<{ photos: Photo[] }>("/api/photos").then((r) => r.photos);

export const getLooks = () => call<{ looks: Look[] }>("/api/looks").then((r) => r.looks);

export const getSettings = () =>
  call<{ modelDescription: string }>("/api/settings");

export const saveSettings = (modelDescription: string) =>
  call<{ ok: true }>("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelDescription }),
  });

export function uploadPhoto(file: File) {
  const form = new FormData();
  form.set("file", file);
  return call<{ photo: Photo }>("/api/photos", { method: "POST", body: form }).then(
    (r) => r.photo,
  );
}

export const deletePhoto = (id: string) =>
  call<{ ok: true }>(`/api/photos/${id}`, { method: "DELETE" });

export type Quality = "low" | "medium";

export type JobStatus = "queued" | "running" | "done" | "error";

/**
 * A generation in progress. Generation is a background job rather than a long
 * request: it outlives the tab that asked for it, so locking the phone or
 * closing the app doesn't lose an image that has already been paid for.
 */
export interface Job {
  id: string;
  kind: "tryon" | "remix";
  status: JobStatus;
  prompt: string;
  parent_id: string | null;
  garment_title: string | null;
  look_id: string | null;
  error: string | null;
  created_at: string;
}

export const isPending = (job: Job) =>
  job.status === "queued" || job.status === "running";

export const getJobs = () => call<{ jobs: Job[] }>("/api/jobs").then((r) => r.jobs);

const post = (path: string, body: unknown) =>
  call<{ job: Job }>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.job);

// clientToken makes a submit idempotent: if the request is retried after a
// dropped connection, the server hands back the job the first attempt created
// instead of starting — and charging for — a second generation.
export const tryOn = (garment: Garment, prompt: string, clientToken: string) =>
  post("/api/tryon", {
    garmentUrl: garment.url,
    garmentTitle: garment.title,
    prompt,
    clientToken,
  });

export const remix = (
  parentId: string,
  prompt: string,
  quality: Quality,
  clientToken: string,
) => post("/api/remix", { parentId, prompt, quality, clientToken });
