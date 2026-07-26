import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { normalizePhoto } from "@/lib/image";
import type { Photo } from "@/lib/api";
import * as api from "@/lib/api";

interface Props {
  photos: Photo[];
  onChange: () => void;
}

/**
 * The reference set. Only active photos are sent on a try-on, and which photos
 * are active is the strongest lever on likeness — a handful of clear solo shots
 * beats a dozen group photos, so this is worth curating rather than filling.
 */
export function ModelPanel({ photos, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const activeCount = photos.filter((p) => p.active).length;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await api.uploadPhoto(await normalizePhoto(file));
      }
      onChange();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function toggle(photo: Photo) {
    await api.setPhotoActive(photo.id, !photo.active);
    onChange();
  }

  async function remove(photo: Photo) {
    await api.deletePhoto(photo.id);
    onChange();
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* See ClosetPanel for why the aspect ratio sits on the grid item and
          why align-content is set to `start` rather than content-start. */}
      <div className="grid min-h-0 flex-1 grid-cols-3 [align-content:start] gap-2 overflow-y-auto p-3 sm:grid-cols-4">
        {photos.map((photo) => (
          <figure key={photo.id} className="group relative">
            <button
              type="button"
              onClick={() => toggle(photo)}
              aria-pressed={photo.active}
              className={cn(
                // pt-[133.333%] is a 3:4 tile — see ClosetPanel for why this
                // isn't aspect-[3/4].
                "relative block w-full overflow-hidden rounded border pt-[133.333%] transition",
                photo.active
                  ? "border-accent ring-1 ring-accent"
                  : "border-line opacity-40 hover:opacity-70",
              )}
            >
              <img
                src={photo.src}
                alt={photo.filename}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={() => remove(photo)}
              aria-label={`Delete ${photo.filename}`}
              className="absolute right-1 top-1 hidden rounded bg-ink/70 px-1.5 text-xs text-white group-hover:block"
            >
              ×
            </button>
          </figure>
        ))}
      </div>

      <footer className="border-t border-line p-3">
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="w-full rounded border border-line py-2 text-xs hover:bg-canvas disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add photos"}
        </button>
      </footer>
    </section>
  );
}
