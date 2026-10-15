INSERT INTO permissions (code, description) VALUES
  ('cash.shift.read', 'Consultar el turno de caja activo'),
  ('cash.shift.open', 'Abrir un turno de caja y registrar fondo inicial'),
  ('sales.payment.capture', 'Cobrar y cerrar una cuenta'),
  ('sales.receipt.read', 'Consultar tickets emitidos')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE cash_registers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE cash_shifts (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  register_id uuid NOT NULL REFERENCES cash_registers(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'counting', 'closed', 'force_closed')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  opening_float_in_cents integer NOT NULL DEFAULT 0
    CHECK (opening_float_in_cents >= 0),
  opened_by_user_id uuid NOT NULL REFERENCES app_users(id),
  opened_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by_user_id uuid REFERENCES app_users(id),
  closed_on_terminal_id uuid REFERENCES terminals(id),
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cash_shifts_one_active_per_register_idx
  ON cash_shifts (register_id)
  WHERE status IN ('open', 'counting');

CREATE INDEX cash_shifts_site_status_idx
  ON cash_shifts (site_id, status, opened_at DESC);

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  supports_change boolean NOT NULL DEFAULT false,
  requires_reference boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (site_id, code)
);

CREATE TABLE document_sequences (
  site_id uuid NOT NULL REFERENCES sites(id),
  document_type text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (site_id, document_type)
);

CREATE TABLE sales_receipts (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL UNIQUE REFERENCES service_accounts(id),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  folio_number bigint NOT NULL CHECK (folio_number > 0),
  folio text NOT NULL,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'cancelled', 'refunded')),
  subtotal_in_cents integer NOT NULL CHECK (subtotal_in_cents >= 0),
  discount_in_cents integer NOT NULL CHECK (discount_in_cents >= 0),
  tax_in_cents integer NOT NULL CHECK (tax_in_cents >= 0),
  total_in_cents integer NOT NULL CHECK (total_in_cents > 0),
  tip_in_cents integer NOT NULL DEFAULT 0 CHECK (tip_in_cents >= 0),
  change_in_cents integer NOT NULL DEFAULT 0 CHECK (change_in_cents >= 0),
  snapshot jsonb NOT NULL,
  issued_by_user_id uuid NOT NULL REFERENCES app_users(id),
  issued_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, folio_number),
  UNIQUE (site_id, folio)
);

CREATE INDEX sales_receipts_shift_idx
  ON sales_receipts (shift_id, issued_at, id);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  receipt_id uuid NOT NULL REFERENCES sales_receipts(id),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  payment_method_id uuid NOT NULL REFERENCES payment_methods(id),
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('initiated', 'authorized', 'captured', 'failed', 'refunded')),
  amount_in_cents integer NOT NULL CHECK (amount_in_cents > 0),
  tendered_in_cents integer CHECK (tendered_in_cents > 0),
  change_in_cents integer NOT NULL DEFAULT 0 CHECK (change_in_cents >= 0),
  reference text,
  captured_by_user_id uuid NOT NULL REFERENCES app_users(id),
  captured_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_shift_idx
  ON payments (shift_id, captured_at, id);

CREATE TABLE payment_allocations (
  payment_id uuid NOT NULL REFERENCES payments(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  amount_in_cents integer NOT NULL CHECK (amount_in_cents > 0),
  PRIMARY KEY (payment_id, account_id)
);

CREATE TABLE payment_tips (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  amount_in_cents integer NOT NULL CHECK (amount_in_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  type text NOT NULL CHECK (type IN ('opening_float', 'sale', 'cash_in', 'cash_out')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount_in_cents integer NOT NULL CHECK (amount_in_cents > 0),
  payment_id uuid REFERENCES payments(id),
  reason text,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cash_movements_payment_idx
  ON cash_movements (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX cash_movements_shift_idx
  ON cash_movements (shift_id, created_at, id);

INSERT INTO cash_registers (id, site_id, code, name)
SELECT '00000000-0000-4000-8000-000000000600', id, 'MAIN', 'Caja principal'
  FROM sites
 WHERE code = 'PILOT'
ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name, active = true;

INSERT INTO payment_methods (
  id, site_id, code, name, supports_change, requires_reference, display_order
)
SELECT methods.id::uuid, sites.id, methods.code, methods.name,
       methods.supports_change, methods.requires_reference, methods.display_order
  FROM sites
  CROSS JOIN (VALUES
    ('00000000-0000-4000-8000-000000000610', 'CASH', 'Efectivo', true, false, 1),
    ('00000000-0000-4000-8000-000000000611', 'CARD', 'Tarjeta', false, true, 2),
    ('00000000-0000-4000-8000-000000000612', 'TRANSFER', 'Transferencia', false, true, 3)
  ) AS methods(id, code, name, supports_change, requires_reference, display_order)
 WHERE sites.code = 'PILOT'
ON CONFLICT (site_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  supports_change = EXCLUDED.supports_change,
  requires_reference = EXCLUDED.requires_reference,
  display_order = EXCLUDED.display_order,
  active = true;

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code IN (
     'cash.shift.read',
     'cash.shift.open',
     'sales.payment.capture',
     'sales.receipt.read'
   )
ON CONFLICT DO NOTHING;
