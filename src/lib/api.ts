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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
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

export const tryOn = (garment: Garment, prompt: string) =>
  call<{ look: Look }>("/api/tryon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      garmentUrl: garment.url,
      garmentTitle: garment.title,
      prompt,
    }),
  }).then((r) => r.look);

export type Quality = "low" | "medium";

export const remix = (parentId: string, prompt: string, quality: Quality) =>
  call<{ look: Look }>("/api/remix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId, prompt, quality }),
  }).then((r) => r.look);
