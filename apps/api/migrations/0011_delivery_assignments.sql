CREATE TABLE delivery_drivers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)
);

CREATE TABLE delivery_assignments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  driver_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'out_for_delivery', 'delivered', 'cancelled')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  account_version integer NOT NULL CHECK (account_version >= 0),
  customer_name text CHECK (customer_name IS NULL OR length(customer_name) <= 80),
  customer_name_follows_account boolean NOT NULL DEFAULT true,
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  address text NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 500),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  snapshot jsonb NOT NULL,
  share_token_hash text UNIQUE,
  share_expires_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (driver_id, site_id) REFERENCES delivery_drivers(id, site_id)
);

CREATE UNIQUE INDEX delivery_assignments_one_active_account_idx
  ON delivery_assignments (site_id, account_id)
  WHERE status IN ('assigned', 'out_for_delivery');

CREATE INDEX delivery_assignments_site_idx
  ON delivery_assignments (site_id, created_at DESC);

INSERT INTO permissions (code, description)
VALUES ('delivery.manage', 'Administrar repartidores y comandas de entrega')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'delivery.manage' FROM roles WHERE code IN ('ADMINISTRATOR', 'WAITER')
ON CONFLICT DO NOTHING;
