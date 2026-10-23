-- Actualiza el piloto existente sin volver a cargar semillas ni alterar comandas.
INSERT INTO service_tables (
  id, site_id, dining_area_id, code, name, capacity, display_order
)
SELECT '00000000-0000-4000-8000-000000000228', areas.site_id, areas.id,
       'TABLE-9', 'Mesa 9', 4, 9
  FROM dining_areas areas
  JOIN sites ON sites.id = areas.site_id
 WHERE sites.code = 'PILOT' AND areas.code = 'MAIN'
ON CONFLICT (site_id, code) DO NOTHING;

-- Los artículos de pedidos conservan su precio capturado al agregarlos.
-- Se cambia únicamente el precio de venta vigente, no el historial inactivo.
WITH updated_prices AS (
  UPDATE product_prices prices
     SET price_in_cents = 3500
    FROM products, sites
   WHERE prices.product_id = products.id
     AND prices.site_id = products.site_id
     AND sites.id = products.site_id
     AND sites.code = 'PILOT'
     AND products.code = 'FLAUTA'
     AND prices.price_list_code = 'DEFAULT'
     AND prices.active
     AND prices.price_in_cents <> 3500
  RETURNING prices.product_id
)
UPDATE products
   SET version = version + 1, updated_at = now()
 WHERE id IN (SELECT product_id FROM updated_prices);
