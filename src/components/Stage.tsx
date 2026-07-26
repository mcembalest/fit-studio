import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { Garment, Job, Look, Quality } from "@/lib/api";

interface Props {
  look: Look | null;
  staged: Garment | null;
  lineage: Look[];
  pending: Job[];
  error: string | null;
  onGenerate: (notes: string) => Promise<void> | void;
  onRemix: (prompt: string, quality: Quality) => Promise<void> | void;
  onSelect: (look: Look) => void;
  onClearStaged: () => void;
  onDismissError: () => void;
}

/**
 * Generations take 20-55s, so the wait is the design problem, not an edge case.
 * Counts from the job's own start time rather than from mount, so the number
 * survives a reload or a locked phone and still reads true.
 */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Clamped: a phone clock a second ahead of the edge would otherwise count
  // backwards from -1.
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return <span className="tabular-nums">{seconds}s</span>;
}

export function Stage({
  look,
  staged,
  lineage,
  pending,
  error,
  onGenerate,
  onRemix,
  onSelect,
  onClearStaged,
  onDismissError,
}: Props) {
  const [text, setText] = useState("");
  const [quality, setQuality] = useState<Quality>("low");
  // Covers only the moment the POST is in flight. Generation itself no longer
  // blocks anything — but two taps inside that window would start two jobs.
  const [submitting, setSubmitting] = useState(false);

  // Staging a garment is a separate mode from editing a finished look: picking
  // from the closet only loads the piece here, and nothing is generated until
  // she asks for it.
  const staging = staged !== null;

  useEffect(() => setText(""), [staged?.id, look?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (staging) await onGenerate(text);
      else if (look && text.trim()) await onRemix(text, quality);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = submitting ? false : staging || (!!look && !!text.trim());
  // Elapsed reads best off whatever has been waiting longest; `pending` arrives
  // newest first.
  const oldestPending = pending.at(-1);

  return (
    <section className="flex h-full min-h-0 flex-col">
      {!staging && lineage.length > 1 && (
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-2 text-xs text-muted">
          {lineage.map((step, i) => (
            <span key={step.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <button
                type="button"
                onClick={() => onSelect(step)}
                className={cn(
                  // Tall enough to hit with a thumb, not just a cursor.
                  "inline-flex min-h-[32px] max-w-[9rem] items-center truncate px-1",
                  step.id === look?.id ? "text-ink underline" : "hover:text-ink",
                )}
              >
                {step.prompt}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
        {staging ? (
          <figure className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3">
            <img
              src={staged.url}
              alt={staged.title}
              className="min-h-0 w-full flex-1 rounded object-contain"
            />
            <figcaption className="shrink-0 text-center text-xs text-muted">
              Staged — not generated yet
            </figcaption>
          </figure>
        ) : look ? (
          <img
            src={look.src}
            alt={look.prompt}
            className="max-h-full max-w-full rounded object-contain shadow-sm"
          />
        ) : (
          <p className="max-w-xs text-center text-sm text-muted">
            {oldestPending
              ? "Working on it — this takes about half a minute."
              : "Pick a piece from the closet to stage it."}
          </p>
        )}
      </div>

      {/* Nothing here blocks the stage. A generation runs on the server, so she
          can keep browsing, staging and editing while it does — the point is to
          report progress, not to hold the app still. */}
      {oldestPending && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
          />
          <span className="min-w-0 flex-1 truncate">
            {pending.length > 1
              ? `Generating ${pending.length} looks`
              : `Generating — ${oldestPending.prompt}`}
          </span>
          <Elapsed since={oldestPending.created_at} />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex shrink-0 items-start gap-2 border-t border-line px-4 py-2 text-xs text-accent"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss"
            className="shrink-0 px-1 text-muted hover:text-ink"
          >
            ×
          </button>
        </p>
      )}

      {/* Controls stack on a phone and sit on one row from sm up, so the
          toggle and the button never share a cramped line. */}
      <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
        {staging && (
          <div className="mb-2 flex items-center gap-2 rounded border border-line bg-surface p-2">
            <img
              src={staged.thumb}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-xs">{staged.title}</span>
            <button
              type="button"
              onClick={onClearStaged}
              aria-label="Clear staged piece"
              className="min-h-[36px] shrink-0 rounded px-3 text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!staging && !look}
            placeholder={
              staging
                ? "styling notes (optional)"
                : look
                  ? "make the dress blue, make it shorter…"
                  : "nothing staged yet"
            }
            className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50"
          />

          <div className="flex items-center gap-2">
            {!staging && look && (
              <div
                role="group"
                aria-label="Edit quality"
                className="flex shrink-0 overflow-hidden rounded border border-line"
              >
                {(
                  [
                    ["low", "Quick"],
                    ["medium", "Best"],
                  ] as [Quality, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setQuality(value)}
                    aria-pressed={quality === value}
                    className={cn(
                      "px-3 py-2 text-xs",
                      quality === value
                        ? "bg-ink text-white"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 whitespace-nowrap rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-40 sm:flex-none"
            >
              {staging ? "Generate" : "Update"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
