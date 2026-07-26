import { useRef, useState } from "react";
import { normalizePhoto } from "@/lib/image";
import type { Photo } from "@/lib/api";
import * as api from "@/lib/api";

interface Props {
  photos: Photo[];
  onChange: () => void;
}

/**
 * The reference set. Every photo here is sent on a generation — there is no
 * on/off state, so removing a photo from the set means deleting it.
 *
 * What is in this set is the strongest lever on likeness. A handful of clear
 * solo shots beats a dozen mixed ones: group photos and distant shots make the
 * subject ambiguous rather than better described, and a photo of a different
 * person actively teaches the model the wrong face.
 */
export function ModelPanel({ photos, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

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

  async function remove(photo: Photo) {
    await api.deletePhoto(photo.id);
    setPending(null);
    onChange();
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* See ClosetPanel for why the aspect ratio sits on the grid item and
          why align-content is set to `start` rather than content-start. */}
      <div className="grid min-h-0 flex-1 grid-cols-3 [align-content:start] gap-2 overflow-y-auto p-3 sm:grid-cols-4">
        {photos.map((photo) => (
          <figure key={photo.id} className="relative">
            <span className="relative block w-full overflow-hidden rounded border border-line pt-[133.333%]">
              <img
                src={photo.src}
                alt={photo.filename}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </span>
            {pending === photo.id ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded bg-ink/80 p-1 text-white">
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  className="min-h-[32px] w-full rounded bg-white px-2 text-[11px] text-ink"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="min-h-[28px] text-[11px] underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPending(photo.id)}
                aria-label={`Remove ${photo.filename}`}
                className="absolute right-1 top-1 min-h-[28px] min-w-[28px] rounded bg-ink/70 text-xs text-white"
              >
                ×
              </button>
            )}
          </figure>
        ))}
      </div>

      <footer className="shrink-0 border-t border-line p-3">
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
          className="min-h-[40px] w-full rounded border border-line text-xs hover:bg-canvas disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add photos"}
        </button>
      </footer>
    </section>
  );
}
