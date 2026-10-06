INSERT INTO permissions (code, description) VALUES
  ('catalog.read', 'Consultar catálogo de venta'),
  ('service.account.open', 'Abrir cuentas de servicio'),
  ('service.account.read', 'Consultar cuentas de servicio'),
  ('service.item.add', 'Agregar artículos pendientes'),
  ('service.item.edit', 'Modificar artículos pendientes'),
  ('service.round.send', 'Enviar una ronda a producción')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE production_centers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE dining_areas (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE service_tables (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  dining_area_id uuid NOT NULL REFERENCES dining_areas(id),
  code text NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE tax_rules (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  price_includes_tax boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (site_id, code)
);

CREATE TABLE product_categories (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  color text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (site_id, code)
);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  category_id uuid NOT NULL REFERENCES product_categories(id),
  production_center_id uuid REFERENCES production_centers(id),
  tax_rule_id uuid NOT NULL REFERENCES tax_rules(id),
  code text NOT NULL,
  name text NOT NULL,
  short_name text NOT NULL,
  emoji text,
  color text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  available boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE product_prices (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_list_code text NOT NULL DEFAULT 'DEFAULT',
  price_in_cents integer NOT NULL CHECK (price_in_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_prices_active_idx
  ON product_prices (site_id, product_id, price_list_code)
  WHERE active;

CREATE TABLE modifier_groups (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  minimum_selections integer NOT NULL DEFAULT 0 CHECK (minimum_selections >= 0),
  maximum_selections integer NOT NULL DEFAULT 1 CHECK (maximum_selections > 0),
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  CHECK (maximum_selections >= minimum_selections),
  UNIQUE (site_id, code)
);

CREATE TABLE modifiers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  price_delta_in_cents integer NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  available boolean NOT NULL DEFAULT true,
  UNIQUE (site_id, code)
);

CREATE TABLE product_modifier_groups (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, modifier_group_id)
);

CREATE TABLE service_accounts (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  table_id uuid REFERENCES service_tables(id),
  service_type text NOT NULL CHECK (service_type IN ('table', 'quick', 'takeaway')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_payment', 'paid', 'closed', 'cancelled')),
  reference text,
  guest_count integer NOT NULL DEFAULT 1 CHECK (guest_count > 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  opened_by_user_id uuid NOT NULL REFERENCES app_users(id),
  opened_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (
    (service_type = 'table' AND table_id IS NOT NULL)
    OR (service_type IN ('quick', 'takeaway') AND table_id IS NULL)
  )
);

CREATE UNIQUE INDEX service_accounts_one_open_per_table_idx
  ON service_accounts (site_id, table_id)
  WHERE table_id IS NOT NULL AND status IN ('open', 'awaiting_payment');

CREATE INDEX service_accounts_open_idx
  ON service_accounts (site_id, status, updated_at DESC);

CREATE TABLE order_rounds (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  sent_by_user_id uuid NOT NULL REFERENCES app_users(id),
  sent_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sequence)
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  account_id uuid NOT NULL REFERENCES service_accounts(id),
  round_id uuid REFERENCES order_rounds(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  product_code text NOT NULL,
  production_center_id uuid REFERENCES production_centers(id),
  unit_price_in_cents integer NOT NULL CHECK (unit_price_in_cents >= 0),
  tax_rate_basis_points integer NOT NULL CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
  tax_included boolean NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  note text,
  preparation_state text NOT NULL DEFAULT 'pending'
    CHECK (preparation_state IN ('pending', 'sent', 'fulfilled', 'cancelled')),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_on_terminal_id uuid NOT NULL REFERENCES terminals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_items_account_idx
  ON order_items (account_id, preparation_state, created_at);

CREATE TABLE order_item_modifiers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES modifiers(id),
  modifier_name text NOT NULL,
  price_delta_in_cents integer NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code IN (
     'catalog.read',
     'service.account.open',
     'service.account.read',
     'service.item.add',
     'service.item.edit',
     'service.round.send'
   )
ON CONFLICT DO NOTHING;
