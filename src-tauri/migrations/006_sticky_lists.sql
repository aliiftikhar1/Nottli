-- Checklist content is JSON in the existing notes table. NULL means ordinary text mode;
-- an array (including []) means checklist mode. This is additive and preserves old notes.
ALTER TABLE notes ADD COLUMN sticky_list TEXT;
