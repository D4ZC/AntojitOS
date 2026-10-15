INSERT INTO permissions (code, description) VALUES
  ('production.ticket.read', 'Consultar comandas de producción'),
  ('production.ticket.update', 'Actualizar el estado de una comanda'),
  ('production.job.reprint', 'Solicitar una reimpresión autorizada'),
  ('production.agent.manage', 'Registrar y administrar agentes de impresión'),
  ('service.item.cancel', 'Cancelar artículos con motivo y trazabilidad')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE production_tickets (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  round_id uuid NOT NULL REFERENCES order_rounds(id),
  production_center_id uuid NOT NULL REFERENCES production_centers(id),
  kind text NOT NULL DEFAULT 'addition'
    CHECK (kind IN ('addition', 'cancellation')),
  round_sequence integer NOT NULL CHECK (round_sequence > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'ready', 'delivered', 'cancelled')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX production_tickets_addition_idx
  ON production_tickets (round_id, production_center_id)
  WHERE kind = 'addition';

CREATE INDEX production_tickets_queue_idx
  ON production_tickets (site_id, production_center_id, status, created_at);

CREATE TABLE production_ticket_items (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  ticket_id uuid NOT NULL REFERENCES production_tickets(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id),
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  note text,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX production_ticket_items_ticket_idx
  ON production_ticket_items (ticket_id, id);

CREATE TABLE production_agents (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  display_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (site_id, code)
);

CREATE TABLE production_agent_centers (
  agent_id uuid NOT NULL REFERENCES production_agents(id) ON DELETE CASCADE,
  production_center_id uuid NOT NULL REFERENCES production_centers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, production_center_id)
);

CREATE TABLE print_jobs (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  ticket_id uuid NOT NULL REFERENCES production_tickets(id),
  kind text NOT NULL CHECK (kind IN ('addition', 'cancellation', 'reprint')),
  original_job_id uuid REFERENCES print_jobs(id),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'completed', 'failed', 'cancelled')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by_agent_id uuid REFERENCES production_agents(id),
  claim_token_hash text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX print_jobs_original_intention_idx
  ON print_jobs (ticket_id)
  WHERE kind IN ('addition', 'cancellation') AND original_job_id IS NULL;

CREATE INDEX print_jobs_claim_idx
  ON print_jobs (site_id, status, available_at, created_at);

CREATE TABLE print_job_attempts (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  job_id uuid NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES production_agents(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL
    CHECK (status IN ('claimed', 'completed', 'failed', 'lease_expired')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (job_id, attempt_number)
);

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code IN (
     'production.ticket.read',
     'production.ticket.update',
     'production.job.reprint',
     'production.agent.manage',
     'service.item.cancel'
   )
ON CONFLICT DO NOTHING;
