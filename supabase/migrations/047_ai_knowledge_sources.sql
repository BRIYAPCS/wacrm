-- ============================================================
-- 047_ai_knowledge_sources.sql — knowledge base from files + URLs
--
-- The knowledge base was typed text only. This lets an admin also feed it
-- uploaded documents (PDF, DOCX, TXT, MD, CSV, JSON, HTML) and web pages
-- (paste a URL — the server fetches + extracts the readable text). Both
-- reuse the existing chunk + embed pipeline; we only record where each
-- document came from, for display + provenance.
--
--   source_type: 'manual' (typed) | 'file' (upload) | 'url' (web page)
--   source_url : the original URL for 'url' documents (nullable)
--
-- Idempotent.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'file', 'url')),
  ADD COLUMN IF NOT EXISTS source_url text;
