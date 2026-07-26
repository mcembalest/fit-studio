import { cn } from "@/lib/utils";
import type { Job, Look } from "@/lib/api";

interface Props {
  looks: Look[];
  pending: Job[];
  current: Look | null;
  onSelect: (look: Look) => void;
}

/**
 * Every look ever generated, newest first. Selecting an older one makes it the
 * base for the next remix, which is what makes history a tree: she can go back
 * two steps and branch a different direction instead of only undoing.
 *
 * Anything still generating holds a placeholder at the front, so a background
 * job is visible as a thing in progress rather than as nothing at all.
 */
export function HistoryStrip({ looks, pending, current, onSelect }: Props) {
  if (looks.length === 0 && pending.length === 0) return null;

  return (
    <aside className="shrink-0 border-t border-line bg-surface">
      {/* Deliberately short on a phone: the stage, the controls and the tab bar
          all have to fit above the fold without crowding each other. */}
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {pending.map((job) => (
          <div
            key={job.id}
            title={job.prompt}
            aria-label={`Generating: ${job.prompt}`}
            className="flex h-14 w-10 shrink-0 animate-pulse items-center justify-center rounded border border-dashed border-line bg-canvas text-[10px] text-muted sm:h-20 sm:w-14"
          >
            •••
          </div>
        ))}

        {looks.map((look) => (
          <button
            key={look.id}
            type="button"
            onClick={() => onSelect(look)}
            title={look.prompt}
            className={cn(
              "shrink-0 overflow-hidden rounded border transition",
              look.id === current?.id
                ? "border-accent ring-1 ring-accent"
                : "border-line hover:border-muted",
            )}
          >
            <img
              src={look.src}
              alt={look.prompt}
              className="h-14 w-10 object-cover sm:h-20 sm:w-14"
            />
          </button>
        ))}
      </div>
    </aside>
  );
}
