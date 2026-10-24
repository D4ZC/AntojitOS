-- Agrega el relleno al catálogo instalado sin recargar semillas ni modificar
-- precios, reglas de selección u opciones que el restaurante haya ajustado.
INSERT INTO modifiers (
  id, site_id, modifier_group_id, code, name,
  price_delta_in_cents, display_order, active, available
)
SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM modifiers
            WHERE id = '00000000-0000-4000-8000-000000001184'
         ) THEN gen_random_uuid()
         ELSE '00000000-0000-4000-8000-000000001184'::uuid
       END,
       groups.site_id, groups.id, 'FLAUTA-CHICHARRON', 'Chicharrón', 0,
       COALESCE((
         SELECT max(options.display_order) FROM modifiers options
          WHERE options.modifier_group_id = groups.id
       ), 0) + 1,
       true, true
  FROM modifier_groups groups
  JOIN sites ON sites.id = groups.site_id
 WHERE sites.code = 'PILOT'
   AND groups.code = 'RELLENO-FLAUTA'
   AND EXISTS (
     SELECT 1 FROM product_modifier_groups links
     JOIN products ON products.id = links.product_id
      WHERE links.modifier_group_id = groups.id
        AND products.site_id = groups.site_id
        AND products.code = 'FLAUTA'
   )
ON CONFLICT (site_id, code) DO NOTHING;
