import { pool } from "@workspace/db";
export async function initializeCollaboration(database: Pick<typeof pool, "query"> = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS cc_shared_assessments (
      id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES cc_accounts(id),
      import_key text NOT NULL, name text NOT NULL, system text NOT NULL,
      target_release text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(owner_id, import_key)
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_members (
      assessment_id uuid NOT NULL REFERENCES cc_shared_assessments(id),
      user_id text NOT NULL REFERENCES cc_accounts(id),
      access text NOT NULL CHECK(access IN ('edit','review','read')),
      PRIMARY KEY(assessment_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_entities (
      id uuid PRIMARY KEY, assessment_id uuid NOT NULL REFERENCES cc_shared_assessments(id),
      entity_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('object','interface')),
      name text NOT NULL, evidence jsonb NOT NULL,
      content jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]',
      version integer NOT NULL DEFAULT 1,
      state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','Submitted','Approved','Changes requested')),
      submitter_id text REFERENCES cc_accounts(id), reviewer_id text REFERENCES cc_accounts(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(assessment_id,kind,entity_key)
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_revisions (
      entity_id uuid NOT NULL REFERENCES cc_assessment_entities(id),
      version integer NOT NULL, content jsonb NOT NULL, sources jsonb NOT NULL,
      actor_id text NOT NULL REFERENCES cc_accounts(id),
      origin text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(entity_id,version)
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_events (
      id bigserial PRIMARY KEY, entity_id uuid REFERENCES cc_assessment_entities(id),
      assessment_id uuid NOT NULL REFERENCES cc_shared_assessments(id),
      actor_id text NOT NULL REFERENCES cc_accounts(id), action text NOT NULL,
      version integer, comment text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_actions (
      entity_id uuid NOT NULL REFERENCES cc_assessment_entities(id),
      actor_id text NOT NULL REFERENCES cc_accounts(id), request_id uuid NOT NULL,
      request_hash text NOT NULL, result jsonb NOT NULL,
      PRIMARY KEY(entity_id,actor_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS cc_assessment_approvals (
      id uuid PRIMARY KEY, entity_id uuid NOT NULL REFERENCES cc_assessment_entities(id),
      version integer NOT NULL, approver_id text NOT NULL REFERENCES cc_accounts(id),
      approved_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL,
      template_id uuid, template_version integer, template_path text,
      report_path text,
      UNIQUE(entity_id,version)
    );
    CREATE INDEX IF NOT EXISTS cc_assessment_members_user ON cc_assessment_members(user_id);
    ALTER TABLE cc_assessment_approvals ADD COLUMN IF NOT EXISTS report_path text;
    CREATE INDEX IF NOT EXISTS cc_assessment_approvals_archive ON cc_assessment_approvals(approved_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS cc_assessment_entities_parent ON cc_assessment_entities(assessment_id);
    CREATE INDEX IF NOT EXISTS cc_assessment_events_parent ON cc_assessment_events(assessment_id,id);
    ALTER TABLE cc_assessment_events ADD COLUMN IF NOT EXISTS recipient_id text REFERENCES cc_accounts(id);
    ALTER TABLE cc_assessment_events ADD COLUMN IF NOT EXISTS notification_processed boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS cc_assessment_events_pending_notifications ON cc_assessment_events(id)
      WHERE recipient_id IS NOT NULL AND NOT notification_processed;
    CREATE TABLE IF NOT EXISTS cc_review_notification_preferences (
      user_id text PRIMARY KEY REFERENCES cc_accounts(id),
      enabled boolean NOT NULL DEFAULT false,
      enabled_since timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cc_review_notifications (
      event_id bigint NOT NULL REFERENCES cc_assessment_events(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES cc_accounts(id) ON DELETE CASCADE,
      read_at timestamptz,
      PRIMARY KEY(event_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS cc_review_notifications_user ON cc_review_notifications(user_id,event_id DESC);
    CREATE INDEX IF NOT EXISTS cc_review_notifications_retention ON cc_review_notifications(read_at,event_id,user_id)
      WHERE read_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS cc_github_connections (
      user_id text PRIMARY KEY REFERENCES cc_accounts(id), connected_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cc_company_templates (
      id uuid PRIMARY KEY, name text NOT NULL, version integer NOT NULL,
      previewed boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT false,
      created_by text NOT NULL REFERENCES cc_accounts(id), created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cc_company_template_default ON cc_company_templates(active) WHERE active;
    CREATE TABLE IF NOT EXISTS cc_company_template_versions (
      template_id uuid NOT NULL REFERENCES cc_company_templates(id), version integer NOT NULL,
      object_path text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(template_id,version)
    );
  `);
}
