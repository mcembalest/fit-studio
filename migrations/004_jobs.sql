-- Generation runs as a background job instead of inside the request that asks
-- for it, so browsing, the closet and Settings stay usable while an image is
-- being made — and so a locked phone or a closed tab no longer kills a
-- generation that has already been paid for.
--
-- The row is the source of truth for progress. The Durable Object in
-- worker/index.ts is only the thing that runs the work; it writes here.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  -- Set by the browser, one per submit. A retried POST (double tap, flaky
  -- mobile connection) hands back the original job instead of buying a second
  -- generation.
  client_token  TEXT UNIQUE,
  kind          TEXT NOT NULL,          -- 'tryon' | 'remix'
  status        TEXT NOT NULL,          -- 'queued' | 'running' | 'done' | 'error'
  request       TEXT NOT NULL,          -- JSON: everything needed to run it
  prompt        TEXT NOT NULL,          -- denormalised for display while pending
  parent_id     TEXT,
  garment_title TEXT,
  look_id       TEXT REFERENCES looks(id),
  error         TEXT,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT
);

CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
