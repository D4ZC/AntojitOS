INSERT INTO permissions (code, description) VALUES
  ('accounting.manage', 'Administrar proveedores, cuentas por pagar y contabilidad')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'accounting.manage' FROM roles WHERE code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;

CREATE TABLE accounting_suppliers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  contact_name text,
  phone text,
  tax_id text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)
);

CREATE INDEX accounting_suppliers_site_idx ON accounting_suppliers (site_id, active, name);

CREATE TABLE accounting_bills (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  supplier_id uuid,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
  amount_in_cents integer NOT NULL CHECK (amount_in_cents BETWEEN 1 AND 100000000),
  issued_on date NOT NULL,
  due_on date,
  reference text,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (supplier_id, site_id) REFERENCES accounting_suppliers(id, site_id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES app_users(id),
  void_reason text,
  CHECK ((voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND length(trim(void_reason)) > 0)),
  CHECK (due_on IS NULL OR due_on >= issued_on),
  UNIQUE (id, site_id)
);

CREATE INDEX accounting_bills_site_idx ON accounting_bills (site_id, issued_on DESC, id);

CREATE TABLE accounting_supplier_payments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  bill_id uuid NOT NULL,
  amount_in_cents integer NOT NULL CHECK (amount_in_cents BETWEEN 1 AND 100000000),
  method_code text NOT NULL CHECK (method_code IN ('CASH', 'CARD', 'TRANSFER')),
  source text NOT NULL CHECK (source IN ('business_cash', 'external')),
  paid_on date NOT NULL,
  reference text,
  cash_movement_id uuid UNIQUE REFERENCES cash_movements(id),
  reversal_cash_movement_id uuid UNIQUE REFERENCES cash_movements(id),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES app_users(id),
  void_reason text,
  FOREIGN KEY (bill_id, site_id) REFERENCES accounting_bills(id, site_id),
  CHECK (
    (source = 'business_cash' AND method_code = 'CASH' AND cash_movement_id IS NOT NULL)
    OR (source = 'external' AND cash_movement_id IS NULL AND reversal_cash_movement_id IS NULL)
  ),
  CHECK ((voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND length(trim(void_reason)) > 0)),
  CHECK (reversal_cash_movement_id IS NULL OR voided_at IS NOT NULL)
);

CREATE INDEX accounting_supplier_payments_bill_idx
  ON accounting_supplier_payments (bill_id, created_at, id);
CREATE INDEX accounting_supplier_payments_date_idx
  ON accounting_supplier_payments (site_id, paid_on) WHERE voided_at IS NULL;
