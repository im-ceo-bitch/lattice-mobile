-- Additive migration: preserve existing biographies and IDs.
ALTER TABLE team_members ADD COLUMN bio_ru TEXT;
ALTER TABLE team_members ADD COLUMN bio_uz TEXT;
ALTER TABLE team_members ADD COLUMN bio_uz_cyrl TEXT;
ALTER TABLE team_members ADD COLUMN is_head_guide INTEGER NOT NULL DEFAULT 0 CHECK (is_head_guide IN (0,1));
ALTER TABLE team_members ADD COLUMN guide_availability TEXT NOT NULL DEFAULT 'available' CHECK (guide_availability IN ('available','unavailable','busy'));
ALTER TABLE team_members ADD COLUMN public_roles_json TEXT;
