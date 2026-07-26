-- Settings live in the database rather than in code so they can be changed
-- without a redeploy. `model_description` is prepended to every generation:
-- it is how her actual proportions, hair length and skin texture get into the
-- prompt instead of being re-typed as a correction on every look.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
