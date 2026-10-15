import { pool } from "@workspace/db";

/** Optional library bootstrap must never block or reject core API startup. */
export function startKnowledgeInitialization(onFailure: () => void, initialize = initializeKnowledge): void {
  void Promise.resolve().then(() => initialize()).catch(onFailure);
}

/** Additive, idempotent client-hosted schema. No uploads are stored as database bytes. */
export async function initializeKnowledge(database: Pick<typeof pool, "query"> = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS cc_knowledge (
      id uuid PRIMARY KEY, owner_id text NOT NULL, title text NOT NULL,
      release text NOT NULL, topics jsonb NOT NULL DEFAULT '[]',
      filename text NOT NULL, version integer NOT NULL DEFAULT 1,
      status text NOT NULL, error text, object_path text,
      replace_id uuid, expected_version integer, size integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cc_knowledge_chunks (
      document_id uuid NOT NULL REFERENCES cc_knowledge(id) ON DELETE CASCADE,
      ordinal integer NOT NULL, section text NOT NULL, text text NOT NULL,
      search tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
      PRIMARY KEY(document_id,ordinal)
    );
    CREATE INDEX IF NOT EXISTS cc_knowledge_search ON cc_knowledge_chunks USING gin(search);
    CREATE INDEX IF NOT EXISTS cc_knowledge_status ON cc_knowledge(status);
    CREATE TABLE IF NOT EXISTS cc_knowledge_epoch (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
    INSERT INTO cc_knowledge_epoch(singleton) VALUES(true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS cc_knowledge_cleanup (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      cursor text, last_run timestamptz, report jsonb
    );
    INSERT INTO cc_knowledge_cleanup(singleton) VALUES(true) ON CONFLICT DO NOTHING;
  `);
}
