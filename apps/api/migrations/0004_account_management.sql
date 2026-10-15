INSERT INTO permissions (code, description) VALUES
  ('service.account.manage', 'Cambiar responsable, mesa, dividir, unir y transferir cuentas'),
  ('service.account.discount', 'Aplicar o anular descuentos y cortesías'),
  ('service.precheck.create', 'Generar precuentas inmutables')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

ALTER TABLE service_accounts
  ADD COLUMN responsible_user_id uuid REFERENCES app_users(id),
  ADD COLUMN account_group_id uuid,
  ADD COLUMN is_primary boolean NOT NULL DEFAULT true;

UPDATE service_accounts
   SET responsible_user_id = opened_by_user_id,
       account_group_id = id;

ALTER TABLE service_accounts
  ALTER COLUMN responsible_user_id SET NOT NULL,
  ALTER COLUMN account_group_id SET NOT NULL;

DROP INDEX service_accounts_one_open_per_table_idx;

CREATE UNIQUE INDEX service_accounts_one_primary_per_table_idx
  ON service_accounts (site_id, table_id)
  WHERE table_id IS NOT NULL
    AND is_primary
    AND status IN ('open', 'awaiting_payment');

CREATE INDEX service_accounts_group_idx
  ON service_accounts (site_id, account_group_id, status, opened_at);

CREATE TABLE account_adjustments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  kind text NOT NULL CHECK (kind IN ('discount', 'courtesy')),
  calculation text NOT NULL CHECK (calculation IN ('percentage', 'fixed')),
  value integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  applied_by_user_id uuid NOT NULL REFERENCES app_users(id),
  applied_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by_user_id uuid REFERENCES app_users(id),
  voided_on_terminal_id uuid REFERENCES terminals(id),
  void_reason text,
  voided_at timestamptz,
  CHECK (
    (calculation = 'percentage' AND value BETWEEN 1 AND 10000)
    OR (calculation = 'fixed' AND value > 0)
  )
);

CREATE INDEX account_adjustments_active_idx
  ON account_adjustments (account_id, created_at, id)
  WHERE status = 'active';

CREATE TABLE account_prechecks (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  account_version integer NOT NULL CHECK (account_version >= 0),
  snapshot jsonb NOT NULL,
  generated_by_user_id uuid NOT NULL REFERENCES app_users(id),
  generated_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sequence)
);

CREATE TABLE account_item_transfers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  source_account_id uuid NOT NULL REFERENCES service_accounts(id),
  destination_account_id uuid NOT NULL REFERENCES service_accounts(id),
  source_item_id uuid NOT NULL REFERENCES order_items(id),
  destination_item_id uuid NOT NULL REFERENCES order_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  transferred_by_user_id uuid NOT NULL REFERENCES app_users(id),
  transferred_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_account_id <> destination_account_id)
);

CREATE INDEX account_item_transfers_accounts_idx
  ON account_item_transfers (source_account_id, destination_account_id, transferred_at);

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code IN (
     'service.account.manage',
     'service.account.discount',
     'service.precheck.create'
   )
ON CONFLICT DO NOTHING;
