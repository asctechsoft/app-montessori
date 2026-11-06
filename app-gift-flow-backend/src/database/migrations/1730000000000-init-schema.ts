import { MigrationInterface, QueryRunner } from 'typeorm';

/** Schema khởi tạo cho PostgreSQL (khớp entities + SnakeNamingStrategy). */
export class InitSchema1730000000000 implements MigrationInterface {
  name = 'InitSchema1730000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        auth_provider varchar(20) NOT NULL,
        provider_user_id varchar(128) NOT NULL,
        display_name varchar(100),
        plan varchar(20) NOT NULL DEFAULT 'free',
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT uq_users_provider UNIQUE (auth_provider, provider_user_id)
      )`);
    await q.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id varchar(36) NOT NULL,
        token_hash varchar(64) NOT NULL,
        expires_at timestamp NOT NULL,
        revoked_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_refresh_hash ON refresh_tokens (token_hash)`);
    await q.query(`CREATE INDEX idx_refresh_user ON refresh_tokens (user_id)`);
    await q.query(`
      CREATE TABLE events (
        id varchar(36) PRIMARY KEY,
        owner_id varchar(36) NOT NULL,
        name varchar(200) NOT NULL,
        type varchar(30) NOT NULL DEFAULT 'wedding',
        event_date varchar(10) NOT NULL,
        location varchar(300),
        status varchar(20) NOT NULL DEFAULT 'active',
        created_at timestamp NOT NULL,
        updated_at timestamp NOT NULL,
        deleted_at timestamp
      )`);
    await q.query(`CREATE INDEX idx_events_owner_date ON events (owner_id, event_date)`);
    await q.query(`
      CREATE TABLE gifts (
        id varchar(36) PRIMARY KEY,
        event_id varchar(36) NOT NULL,
        owner_id varchar(36) NOT NULL,
        guest_name varchar(200) NOT NULL DEFAULT '',
        relationship_label varchar(100),
        amount_vnd integer NOT NULL DEFAULT 0,
        note varchar(1000),
        status varchar(20) NOT NULL,
        source varchar(10) NOT NULL DEFAULT 'manual',
        transcript varchar(1000),
        client_request_id varchar(36) NOT NULL,
        search_key varchar(1400) NOT NULL DEFAULT '',
        created_at timestamp NOT NULL,
        updated_at timestamp NOT NULL,
        deleted_at timestamp
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_gifts_owner_request ON gifts (owner_id, client_request_id)`);
    await q.query(`CREATE INDEX idx_gifts_event_status ON gifts (event_id, status)`);
    await q.query(`CREATE INDEX idx_gifts_event_created ON gifts (event_id, created_at, id)`);
    await q.query(`
      CREATE TABLE voice_jobs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_id varchar(36) NOT NULL,
        event_id varchar(36) NOT NULL,
        request_id varchar(36) NOT NULL,
        duration_ms integer NOT NULL DEFAULT 0,
        provider varchar(30) NOT NULL DEFAULT 'mock',
        state varchar(20) NOT NULL,
        warning_codes varchar(500) NOT NULL DEFAULT '',
        response_json text,
        token_usage integer,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_voice_owner_request ON voice_jobs (owner_id, request_id)`);
    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        actor_id varchar(36) NOT NULL,
        entity_type varchar(30) NOT NULL,
        entity_id varchar(36) NOT NULL,
        action varchar(30) NOT NULL,
        before_json text,
        after_json text,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_audit_actor ON audit_logs (actor_id, created_at)`);
    await q.query(`
      CREATE TABLE usage_quotas (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_id varchar(36) NOT NULL,
        period varchar(7) NOT NULL,
        quota_limit integer NOT NULL,
        used integer NOT NULL DEFAULT 0
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_quota_owner_period ON usage_quotas (owner_id, period)`);
    await q.query(`
      CREATE TABLE export_jobs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_id varchar(36) NOT NULL,
        event_id varchar(36) NOT NULL,
        file_path varchar(300) NOT NULL,
        file_name varchar(200) NOT NULL,
        rows integer NOT NULL DEFAULT 0,
        confirmed_total integer NOT NULL DEFAULT 0,
        expires_at timestamp NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_export_owner ON export_jobs (owner_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'export_jobs',
      'usage_quotas',
      'audit_logs',
      'voice_jobs',
      'gifts',
      'events',
      'refresh_tokens',
      'users',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
