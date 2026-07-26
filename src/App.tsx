import { useCallback, useEffect, useMemo, useState } from "react";
import { ClosetPanel } from "@/components/ClosetPanel";
import { Stage } from "@/components/Stage";
import { HistoryStrip } from "@/components/HistoryStrip";
import { Settings } from "@/components/Settings";
import { cn } from "@/lib/utils";
import type { Garment, Look, Photo } from "@/lib/api";
import * as api from "@/lib/api";

type Tab = "look" | "closet";

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("look");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A garment chosen from the closet but not yet generated.
  const [staged, setStaged] = useState<Garment | null>(null);

  const loadPhotos = useCallback(() => {
    api.getPhotos().then(setPhotos).catch(showError);
  }, []);

  useEffect(() => {
    loadPhotos();
    api.getCloset().then(setGarments).catch(showError);
    api
      .getLooks()
      .then((l) => {
        setLooks(l);
        setCurrentId(l.at(-1)?.id ?? null);
      })
      .catch(showError);
  }, [loadPhotos]);

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  const current = useMemo(
    () => looks.find((l) => l.id === currentId) ?? null,
    [looks, currentId],
  );

  // Walk parent links back to the root so the stage can show how this look was
  // arrived at, and let her jump to any step along the way.
  const lineage = useMemo(() => {
    const byId = new Map(looks.map((l) => [l.id, l]));
    const chain: Look[] = [];
    let node = current;
    while (node) {
      chain.unshift(node);
      node = node.parent_id ? byId.get(node.parent_id) ?? null : null;
    }
    return chain;
  }, [looks, current]);

  async function generate(run: () => Promise<Look>) {
    setStatus("generating");
    setError(null);
    try {
      const look = await run();
      setLooks((prev) => [...prev, look]);
      setCurrentId(look.id);
      setStaged(null);
    } catch (err) {
      showError(err);
    } finally {
      setStatus("idle");
    }
  }

  // Picking from the closet only stages the piece. Nothing is generated until
  // she presses Generate, so browsing costs nothing.
  function onPick(garment: Garment) {
    setStaged(garment);
    setError(null);
    setTab("look");
  }

  const onGenerate = (notes: string) =>
    staged && generate(() => api.tryOn(staged, notes));

  const onRemix = (prompt: string, quality: api.Quality) =>
    current && generate(() => api.remix(current.id, prompt, quality));

  const generating = status === "generating";

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
        <h1 className="text-sm font-medium tracking-tight">fit studio</h1>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="rounded border border-line px-3 py-1.5 text-xs hover:bg-canvas"
        >
          Settings
        </button>
      </header>

      {/* One column on a phone with a tab bar; stage beside closet on a laptop. */}
      <main className="grid min-h-0 flex-1 lg:grid-cols-[1fr_340px]">
        {/* min-w-0: grid children size to their content by default, so a wide
            staged image would push the whole column past the viewport. */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col lg:flex",
            tab === "look" ? "flex" : "hidden",
          )}
        >
          <Stage
            look={current}
            staged={staged}
            lineage={lineage}
            status={status}
            error={error}
            onGenerate={onGenerate}
            onRemix={onRemix}
            onSelect={(look) => {
              setStaged(null);
              setCurrentId(look.id);
            }}
            onClearStaged={() => setStaged(null)}
          />
          <HistoryStrip
            looks={[...looks].reverse()}
            current={staged ? null : current}
            onSelect={(look) => {
              setStaged(null);
              setCurrentId(look.id);
            }}
          />
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 lg:block",
            tab === "closet" ? "block" : "hidden",
          )}
        >
          <ClosetPanel garments={garments} disabled={generating} onPick={onPick} />
        </div>
      </main>

      {/* pb-safe keeps the tab bar clear of the iOS home indicator. */}
      <nav className="grid shrink-0 grid-cols-2 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {(["look", "closet"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t}
            className={cn(
              "py-3 text-xs capitalize",
              tab === t ? "font-medium text-ink" : "text-muted",
            )}
          >
            {t}
            {t === "look" && staged && (
              <span className="ml-1 text-accent" aria-label="piece staged">
                •
              </span>
            )}
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <Settings
          photos={photos}
          onPhotosChange={loadPhotos}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
