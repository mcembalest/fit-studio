import { useEffect, useState } from "react";
import { ModelPanel } from "@/components/ModelPanel";
import type { Photo } from "@/lib/api";
import * as api from "@/lib/api";

interface Props {
  photos: Photo[];
  onPhotosChange: () => void;
  onClose: () => void;
}

/**
 * Everything about *her* lives here rather than in the studio: which reference
 * photos are in play, and how she should be described to the model.
 *
 * The reference set is deliberately out of the main flow. Curating photos is a
 * one-time calibration, not something to redo per look — once a batch works it
 * should stay frozen, and the studio should just be clothes.
 */
export function Settings({ photos, onPhotosChange, onClose }: Props) {
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setDescription(s.modelDescription));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings(description);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h1 className="text-sm font-medium">Settings</h1>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line px-3 py-1.5 text-xs hover:bg-canvas"
        >
          Done
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-line bg-surface p-4">
          <h2 className="text-sm font-medium">How she should look</h2>
          <p className="mt-1 text-xs text-muted">
            Added to every generation. This is the place to fix things you keep
            correcting by hand — hair length, build, skin.
          </p>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            rows={5}
            className="mt-3 w-full rounded border border-line bg-canvas p-3 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || saved}
              className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
            {!saved && <span className="text-xs text-muted">unsaved changes</span>}
          </div>
        </section>

        <section className="p-4">
          <h2 className="text-sm font-medium">Reference photos</h2>
          <p className="mt-1 text-xs text-muted">
            All {photos.length} are sent to the model on every generation. Keep
            clear solo shots — group photos and distant shots make it ambiguous
            who the subject is, and a photo of someone else teaches it the wrong
            face.
          </p>
          <div className="mt-3 h-[60vh] overflow-hidden rounded border border-line">
            <ModelPanel photos={photos} onChange={onPhotosChange} />
          </div>
        </section>
      </div>
    </div>
  );
}
