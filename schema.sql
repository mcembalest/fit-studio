-- Reference photos of the model. Every row here is sent to the model on every
-- generation; there is no on/off state, so curating the set means adding and
-- removing photos.
CREATE TABLE IF NOT EXISTS model_photos (
  id         TEXT PRIMARY KEY,
  r2_key     TEXT NOT NULL,
  filename   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Generated looks. A look with parent_id IS NULL is a try-on (reference photos
-- + a garment); a look with a parent_id is a remix of that parent. Since a
-- parent can have many children, history is a tree and she can branch off any
-- earlier version rather than only undoing the most recent change.
CREATE TABLE IF NOT EXISTS looks (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES looks(id),
  r2_key        TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  garment_url   TEXT,
  garment_title TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS looks_parent_idx ON looks(parent_id);
CREATE INDEX IF NOT EXISTS looks_created_idx ON looks(created_at);

-- See migrations/002_settings.sql.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Background generation. See migrations/004_jobs.sql for why this exists: the
-- row, not the HTTP request, is what a generation lives in, so the app stays
-- usable while one runs and a closed tab doesn't lose it.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  client_token  TEXT UNIQUE,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  request       TEXT NOT NULL,
  prompt        TEXT NOT NULL,
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
