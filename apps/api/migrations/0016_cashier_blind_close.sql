INSERT INTO permissions (code, description) VALUES
  ('cash.shift.reconcile', 'Consultar cortes cerrados y diferencias declaradas por el cajero')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'cash.shift.reconcile' FROM roles WHERE code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, site_id, code, name)
SELECT gen_random_uuid(), id, 'CASHIER', 'Cajero' FROM sites
ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name;

-- A dedicated cashier cannot inherit administrative or reporting capabilities.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code = 'CASHIER');

INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, permissions.code FROM roles CROSS JOIN permissions
WHERE roles.code = 'CASHIER' AND permissions.code IN (
  'catalog.read', 'service.account.open', 'service.account.read',
  'service.item.add', 'service.item.edit', 'service.item.cancel',
  'service.round.send', 'service.account.manage', 'service.precheck.create',
  'customers.read', 'customers.manage',
  'cash.shift.read', 'cash.shift.open', 'cash.shift.close',
  'sales.payment.capture'
)
ON CONFLICT DO NOTHING;

INSERT INTO app_users (id, site_id, employee_code, display_name)
SELECT gen_random_uuid(), id, 'CAJERO', 'Cajero' FROM sites
ON CONFLICT (site_id, employee_code) DO NOTHING;

DELETE FROM user_roles
WHERE user_id IN (SELECT id FROM app_users WHERE employee_code = 'CAJERO');

INSERT INTO user_roles (user_id, role_id)
SELECT users.id, roles.id FROM app_users users
JOIN roles ON roles.site_id = users.site_id AND roles.code = 'CASHIER'
WHERE users.employee_code = 'CAJERO'
ON CONFLICT DO NOTHING;
