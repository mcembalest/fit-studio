import { useMemo, useState } from "react";
import type { Garment } from "@/lib/api";

interface Props {
  garments: Garment[];
  onPick: (garment: Garment) => void;
}

/**
 * Her are.na channel, read live. Add a block there, it appears here.
 *
 * Sized for browsing on a phone: tiles stay large enough to actually judge a
 * garment by, and the filter matters because the channel is long and block
 * titles are the only thing distinguishing them.
 *
 * Never disabled. Generation runs in the background, so browsing and staging
 * the next piece while one is running is the normal case.
 */
export function ClosetPanel({ garments, onPick }: Props) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return garments;
    return garments.filter(
      (g) =>
        g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q),
    );
  }, [garments, query]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface lg:border-l lg:border-line">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium">Closet</h2>
        <span className="shrink-0 text-xs text-muted">
          {shown.length === garments.length
            ? `${garments.length} pieces`
            : `${shown.length} of ${garments.length}`}
        </span>
      </header>

      <div className="border-b border-line px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter the closet"
          className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 [align-content:start] gap-3 overflow-y-auto p-3">
        {shown.map((garment) => (
          <button
            key={garment.id}
            type="button"
            onClick={() => onPick(garment)}
            className="group text-left"
          >
            {/* Square tiles via percentage padding rather than aspect-ratio:
                aspect-ratio resolves against a definite width only *after* the
                grid row is sized, so it contributes nothing to row sizing and
                the rows collapse while the tiles overflow. Percentage padding
                resolves against the already-definite column width. Likewise
                align-content must be `start` — Tailwind's content-start emits
                the flexbox-only `flex-start`, which grid ignores. */}
            <span className="relative block w-full overflow-hidden rounded border border-line bg-canvas pt-[125%] transition group-hover:border-accent">
              <img
                src={garment.thumb}
                alt={garment.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-contain"
              />
            </span>
            <span className="mt-1 block truncate text-[11px] leading-tight text-muted">
              {garment.title}
            </span>
          </button>
        ))}

        {shown.length === 0 && (
          <p className="col-span-2 py-8 text-center text-sm text-muted">
            Nothing matches “{query}”.
          </p>
        )}
      </div>
    </section>
  );
}
