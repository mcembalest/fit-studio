-- The reference set no longer has an on/off state: every photo in Settings is
-- sent on every generation, so curating the set means adding and removing
-- photos rather than toggling them.
ALTER TABLE model_photos DROP COLUMN active;
