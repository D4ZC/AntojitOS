INSERT INTO permissions (code, description) VALUES
  ('cash.movement.create', 'Registrar entradas y salidas manuales de caja'),
  ('cash.shift.preview', 'Consultar el corte preliminar de caja'),
  ('cash.shift.close', 'Declarar y cerrar un turno de caja'),
  ('sales.receipt.reprint', 'Solicitar la reimpresión de un ticket'),
  ('sales.refund.create', 'Cancelar o devolver un ticket cobrado')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE cash_shift_closes (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  shift_id uuid NOT NULL UNIQUE REFERENCES cash_shifts(id),
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'force_closed')),
  snapshot jsonb NOT NULL,
  closed_by_user_id uuid NOT NULL REFERENCES app_users(id),
  closed_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  closed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_shift_declarations (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  close_id uuid NOT NULL REFERENCES cash_shift_closes(id) ON DELETE CASCADE,
  payment_method_id uuid NOT NULL REFERENCES payment_methods(id),
  theoretical_in_cents integer NOT NULL,
  declared_in_cents integer NOT NULL CHECK (declared_in_cents >= 0),
  difference_in_cents integer NOT NULL,
  UNIQUE (close_id, payment_method_id)
);

CREATE TABLE sales_refunds (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  receipt_id uuid NOT NULL UNIQUE REFERENCES sales_receipts(id),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  kind text NOT NULL CHECK (kind IN ('cancellation', 'refund')),
  sale_in_cents integer NOT NULL CHECK (sale_in_cents > 0),
  tip_in_cents integer NOT NULL DEFAULT 0 CHECK (tip_in_cents >= 0),
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_payments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  refund_id uuid NOT NULL REFERENCES sales_refunds(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  payment_method_id uuid NOT NULL REFERENCES payment_methods(id),
  sale_in_cents integer NOT NULL CHECK (sale_in_cents > 0),
  tip_in_cents integer NOT NULL DEFAULT 0 CHECK (tip_in_cents >= 0),
  total_in_cents integer NOT NULL CHECK (total_in_cents > 0)
);

ALTER TABLE cash_movements
  ADD COLUMN refund_id uuid REFERENCES sales_refunds(id);

CREATE UNIQUE INDEX cash_movements_refund_idx
  ON cash_movements (refund_id)
  WHERE refund_id IS NOT NULL;

CREATE TABLE production_agent_registers (
  agent_id uuid NOT NULL REFERENCES production_agents(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, register_id)
);

INSERT INTO production_agent_registers (agent_id, register_id)
SELECT agents.id, registers.id
  FROM production_agents agents
  JOIN cash_registers registers ON registers.site_id = agents.site_id
 WHERE registers.active
ON CONFLICT DO NOTHING;

ALTER TABLE print_jobs
  ALTER COLUMN ticket_id DROP NOT NULL,
  ADD COLUMN receipt_id uuid REFERENCES sales_receipts(id),
  ADD COLUMN shift_close_id uuid REFERENCES cash_shift_closes(id);

ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN (
    'addition', 'cancellation', 'reprint',
    'receipt', 'receipt_reprint', 'shift_close'
  ));

ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_single_source_check CHECK (
  (CASE WHEN ticket_id IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN receipt_id IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN shift_close_id IS NULL THEN 0 ELSE 1 END) = 1
);

CREATE UNIQUE INDEX print_jobs_receipt_original_idx
  ON print_jobs (receipt_id)
  WHERE kind = 'receipt';

CREATE UNIQUE INDEX print_jobs_shift_close_original_idx
  ON print_jobs (shift_close_id)
  WHERE kind = 'shift_close';

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code IN (
     'cash.movement.create',
     'cash.shift.preview',
     'cash.shift.close',
     'sales.receipt.reprint',
     'sales.refund.create'
   )
ON CONFLICT DO NOTHING;
