import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClosetPanel } from "@/components/ClosetPanel";
import { Stage } from "@/components/Stage";
import { HistoryStrip } from "@/components/HistoryStrip";
import { Settings } from "@/components/Settings";
import { cn } from "@/lib/utils";
import type { Garment, Job, JobStatus, Look, Photo } from "@/lib/api";
import * as api from "@/lib/api";

type Tab = "look" | "closet";

// Slow enough not to hammer the worker from a phone on cellular, quick enough
// that a finished look doesn't sit there unnoticed. Generations run 20-55s.
const POLL_MS = 2500;

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("look");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A garment chosen from the closet but not yet generated.
  const [staged, setStaged] = useState<Garment | null>(null);

  // What each job looked like on the previous poll. A job is only *reacted* to
  // when it changes status while we are watching — otherwise every reload would
  // re-announce, and re-select, work that finished hours ago.
  const seen = useRef(new Map<string, JobStatus>());
  // The generation she is actually waiting on. Cleared the moment she picks
  // something else, so a background result never yanks the stage out from under
  // her while she is looking at another look.
  const following = useRef<string | null>(null);

  const loadPhotos = useCallback(() => {
    api.getPhotos().then(setPhotos).catch(showError);
  }, []);

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  /**
   * One pass of reconciliation: pull job state, notice what changed since the
   * last pass, and fold any finished work into the looks list. This is the only
   * thing that moves a generation from "running" to on-screen, so it has to be
   * safe to call at any time — on load, on a timer, on returning to the tab.
   */
  const syncJobs = useCallback(async () => {
    let next: Job[];
    try {
      next = await api.getJobs();
    } catch {
      // A dropped poll is not an app error — say nothing and try again.
      return;
    }

    const before = seen.current;
    const finished = next.filter(
      (job) => !api.isPending(job) && before.has(job.id) && before.get(job.id) !== job.status,
    );

    // Fetch the finished work *before* dropping the pending markers. Clearing
    // them first leaves a frame where the placeholder has gone and the look it
    // promised hasn't arrived — the strip blinks and the generation looks lost.
    const done = finished.filter((job) => job.status === "done");
    if (done.length > 0) {
      const fresh = await api.getLooks().catch(() => null);
      // Bail without recording anything: `seen` is what makes a transition
      // visible, so committing it here would mean this pass is the only chance
      // to notice, and a dropped request would strand the look forever.
      if (!fresh) return;
      setLooks(fresh);

      const followed = done.find((job) => job.id === following.current);
      if (followed?.look_id && fresh.some((l) => l.id === followed.look_id)) {
        setCurrentId(followed.look_id);
        following.current = null;
      }
    }

    seen.current = new Map(next.map((job) => [job.id, job.status]));
    setJobs(next);

    const failed = finished.find((job) => job.status === "error");
    if (failed?.error) setError(failed.error);
  }, []);

  useEffect(() => {
    loadPhotos();
    api.getCloset().then(setGarments).catch(showError);
    api
      .getLooks()
      .then((l) => {
        setLooks(l);
        setCurrentId((id) => id ?? l.at(-1)?.id ?? null);
      })
      .catch(showError);
    syncJobs();
  }, [loadPhotos, syncJobs]);

  const pending = useMemo(() => jobs.filter(api.isPending), [jobs]);

  // Only poll while something is actually running, and never behind a hidden
  // tab — a phone left on the closet screen shouldn't burn battery or requests.
  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") syncJobs();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending.length, syncJobs]);

  // Coming back to a phone that was locked mid-generation: catch up at once
  // instead of waiting out a poll interval, or forever if nothing was pending
  // when the tab went away.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible") syncJobs();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [syncJobs]);

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

  async function submit(run: (token: string) => Promise<Job>) {
    setError(null);
    try {
      const job = await run(crypto.randomUUID());
      seen.current.set(job.id, job.status);
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      following.current = job.id;
      // The piece is submitted; the stage is hers again to browse from.
      setStaged(null);
      // A resubmit can come back already finished (same clientToken, work
      // already done) — there is no transition left to observe, so fold it in.
      if (!api.isPending(job)) await syncJobs();
    } catch (err) {
      showError(err);
    }
  }

  function select(look: Look) {
    setStaged(null);
    setCurrentId(look.id);
    following.current = null;
  }

  // Picking from the closet only stages the piece. Nothing is generated until
  // she presses Generate, so browsing costs nothing.
  function onPick(garment: Garment) {
    setStaged(garment);
    setError(null);
    setTab("look");
  }

  function onGenerate(notes: string) {
    if (staged) return submit((token) => api.tryOn(staged, notes, token));
  }

  function onRemix(prompt: string, quality: api.Quality) {
    if (current) return submit((token) => api.remix(current.id, prompt, quality, token));
  }

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
            pending={pending}
            error={error}
            onGenerate={onGenerate}
            onRemix={onRemix}
            onSelect={select}
            onClearStaged={() => setStaged(null)}
            onDismissError={() => setError(null)}
          />
          <HistoryStrip
            looks={[...looks].reverse()}
            pending={pending}
            current={staged ? null : current}
            onSelect={select}
          />
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 lg:block",
            tab === "closet" ? "block" : "hidden",
          )}
        >
          <ClosetPanel garments={garments} onPick={onPick} />
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
            {t === "look" && (staged || pending.length > 0) && (
              <span
                className="ml-1 text-accent"
                aria-label={staged ? "piece staged" : "generating"}
              >
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
