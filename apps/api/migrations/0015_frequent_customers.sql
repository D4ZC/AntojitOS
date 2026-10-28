INSERT INTO permissions (code, description) VALUES
  ('customers.read', 'Consultar clientes frecuentes'),
  ('customers.manage', 'Registrar y actualizar clientes frecuentes')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
FROM roles CROSS JOIN permissions
WHERE roles.code IN ('ADMINISTRATOR', 'WAITER', 'CASHIER')
  AND permissions.code IN ('customers.read', 'customers.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE frequent_customers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  name varchar(80) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  phone varchar(60),
  address varchar(500),
  notes varchar(1000),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)
);

CREATE INDEX frequent_customers_site_idx ON frequent_customers (site_id, active, name);

ALTER TABLE service_accounts
  ADD COLUMN customer_id uuid,
  ADD COLUMN customer_phone varchar(60),
  ADD COLUMN customer_address varchar(500),
  ADD CONSTRAINT service_accounts_customer_site_fk
    FOREIGN KEY (customer_id, site_id) REFERENCES frequent_customers(id, site_id);

CREATE INDEX service_accounts_customer_idx ON service_accounts (site_id, customer_id)
  WHERE customer_id IS NOT NULL;
