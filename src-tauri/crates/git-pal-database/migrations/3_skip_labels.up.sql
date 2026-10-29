ALTER TABLE review_templates ADD COLUMN skip_labels TEXT NOT NULL DEFAULT '["do not merge","do not review"]';

ALTER TABLE review_templates ADD COLUMN skip_approved INTEGER NOT NULL DEFAULT 1;
