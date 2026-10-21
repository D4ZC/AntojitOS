INSERT INTO permissions (code, description) VALUES
  ('catalog.product.manage', 'Editar platillos de temporada, precios y disponibilidad')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS seasonal boolean NOT NULL DEFAULT false;

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code
  FROM roles
  CROSS JOIN permissions
 WHERE roles.code = 'ADMINISTRATOR'
   AND permissions.code = 'catalog.product.manage'
ON CONFLICT DO NOTHING;
