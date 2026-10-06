CREATE TABLE sites (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terminals (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  display_name text NOT NULL,
  profile text NOT NULL DEFAULT 'pos' CHECK (profile IN ('pos', 'admin', 'kds', 'production')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  device_token_hash text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (site_id, code)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  employee_code text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, employee_code)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_pin_credentials (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  terminal_id uuid NOT NULL REFERENCES terminals(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_sessions_active_token_idx
  ON user_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE idempotency_records (
  site_id uuid NOT NULL REFERENCES sites(id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, scope, idempotency_key)
);

CREATE INDEX idempotency_records_expiration_idx ON idempotency_records (expires_at);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  actor_user_id uuid REFERENCES app_users(id),
  terminal_id uuid REFERENCES terminals(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_entity_idx ON audit_events (site_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (site_id, actor_user_id, occurred_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'failed');
