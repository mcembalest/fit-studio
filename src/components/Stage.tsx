import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { Garment, Look, Quality } from "@/lib/api";

interface Props {
  look: Look | null;
  staged: Garment | null;
  lineage: Look[];
  status: "idle" | "generating";
  error: string | null;
  onGenerate: (notes: string) => void;
  onRemix: (prompt: string, quality: Quality) => void;
  onSelect: (look: Look) => void;
  onClearStaged: () => void;
}

/**
 * Generations take 20-45s, so the wait is the design problem, not an edge case.
 */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{seconds}s</span>;
}

export function Stage({
  look,
  staged,
  lineage,
  status,
  error,
  onGenerate,
  onRemix,
  onSelect,
  onClearStaged,
}: Props) {
  const [text, setText] = useState("");
  const [quality, setQuality] = useState<Quality>("low");
  const generating = status === "generating";

  // Staging a garment is a separate mode from editing a finished look: picking
  // from the closet only loads the piece here, and nothing is generated until
  // she asks for it.
  const staging = staged !== null;

  useEffect(() => setText(""), [staged?.id, look?.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (generating) return;
    if (staging) return onGenerate(text);
    if (look && text.trim()) onRemix(text, quality);
  }

  const canSubmit = generating ? false : staging || (!!look && !!text.trim());

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
          !generating && (
            <p className="max-w-xs text-center text-sm text-muted">
              Pick a piece from the closet to stage it.
            </p>
          )
        )}

        {generating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/80 text-sm text-muted backdrop-blur-sm">
            <span>Generating…</span>
            <Elapsed />
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-t border-line px-4 py-2 text-xs text-accent"
        >
          {error}
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
            disabled={generating || (!staging && !look)}
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
