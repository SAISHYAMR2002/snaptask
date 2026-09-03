-- Postgres full-text search.
--
-- Prisma generated three plain `tsvector` columns; they have been rewritten as
-- GENERATED ALWAYS ... STORED so Postgres maintains them itself. That is the
-- whole point: no trigger to write, no application code to remember, and the
-- index can never fall out of step with the row it describes.
--
-- Weighting: a hit in a task title ('A') outranks one in the description ('B').
-- 'english' gives us stemming, so "deploying" finds "deploy" and stop words
-- like "the" are dropped - which plain ILIKE '%...%' could never do.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  ) STORED;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;

-- GIN is the right index for tsvector: it indexes every lexeme in the document,
-- so `searchVector @@ query` is an index lookup rather than a table scan.
CREATE INDEX "Task_searchVector_idx" ON "Task" USING GIN ("searchVector");
CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");
CREATE INDEX "Comment_searchVector_idx" ON "Comment" USING GIN ("searchVector");

-- Trigram index on the title so we can still offer prefix/typo matches for
-- short queries, where full-text search returns nothing ("depl" is not a word).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Task_title_trgm_idx" ON "Task" USING GIN ("title" gin_trgm_ops);
