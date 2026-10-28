-- Completa el menú instalado conservando los precios y ajustes administrativos.
-- Las instalaciones nuevas reciben estos mismos productos desde pilot-catalog.ts.
INSERT INTO product_categories (id, site_id, code, name, color, display_order, seasonal)
SELECT CASE WHEN EXISTS (SELECT 1 FROM product_categories WHERE id = data.id)
            THEN gen_random_uuid() ELSE data.id END,
       sites.id, data.code, data.name, data.color, data.display_order, false
  FROM sites
 CROSS JOIN (VALUES
   ('00000000-0000-4000-8000-000000000712'::uuid, 'CHAMORROS', 'Chamorros', 'clay', 13),
   ('00000000-0000-4000-8000-000000000713'::uuid, 'EXTRAS', 'Extras', 'cream', 14)
 ) AS data(id, code, name, color, display_order)
 WHERE sites.code = 'PILOT'
ON CONFLICT (site_id, code) DO NOTHING;

INSERT INTO products (
  id, site_id, category_id, production_center_id, tax_rule_id,
  code, name, short_name, emoji, color, display_order
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM products WHERE id = data.id)
            THEN gen_random_uuid() ELSE data.id END,
       sites.id, categories.id, centers.id, taxes.id,
       data.code, data.name, data.short_name, data.emoji, data.color, data.display_order
  FROM sites
  JOIN production_centers centers ON centers.site_id = sites.id AND centers.code = 'KITCHEN'
  JOIN tax_rules taxes ON taxes.site_id = sites.id AND taxes.code = 'IVA-16'
 CROSS JOIN (VALUES
   ('00000000-0000-4000-8000-000000000725'::uuid, 'EXTRAS', 'TOSTADA-EXTRA', 'Pieza tostada', 'Pieza tostada', '🫓', 'cream', 1),
   ('00000000-0000-4000-8000-000000000772'::uuid, 'BEBIDAS', 'AGUA-FRESCA-MEDIO-LITRO', 'Agua fresca 1/2 litro', 'Agua ½ litro', '🥤', 'sage', 9),
   ('00000000-0000-4000-8000-000000000773'::uuid, 'EXTRAS', 'PATA-EXTRA', 'Pata', 'Pata', '🍖', 'clay', 2),
   ('00000000-0000-4000-8000-000000000774'::uuid, 'EXTRAS', 'FRIJOLES-ADOBADOS', 'Frijoles Adobados', 'Frijoles Adobados', '🥣', 'honey', 3),
   ('00000000-0000-4000-8000-000000000775'::uuid, 'EXTRAS', 'ARROZ-PORCION', 'Arroz porción', 'Arroz porción', '🍚', 'sun', 4),
   ('00000000-0000-4000-8000-000000000776'::uuid, 'EXTRAS', 'TORTILLAS-EXTRA', 'Tortillas', 'Tortillas', '🫓', 'cream', 5),
   ('00000000-0000-4000-8000-000000000777'::uuid, 'CHAMORROS', 'CHAMORRO-MEDIO', '1/2 chamorro', '½ chamorro', '🍖', 'clay', 1),
   ('00000000-0000-4000-8000-000000000778'::uuid, 'CHAMORROS', 'CHAMORRO-COMPLETO', '1 Chamorro completo', 'Completo', '🍖', 'amber', 2)
 ) AS data(id, category_code, code, name, short_name, emoji, color, display_order)
  JOIN product_categories categories
    ON categories.site_id = sites.id AND categories.code = data.category_code
 WHERE sites.code = 'PILOT'
ON CONFLICT (site_id, code) DO NOTHING;

-- La tostada existente cambia de categoría sin crear otro producto ni otra tarifa.
UPDATE products
   SET category_id = categories.id, display_order = 1,
       name = CASE WHEN products.name = 'Tostada extra' THEN 'Pieza tostada' ELSE products.name END,
       short_name = CASE WHEN products.short_name = 'Tostada extra' THEN 'Pieza tostada' ELSE products.short_name END,
       version = products.version + 1, updated_at = now()
  FROM product_categories categories, sites
 WHERE products.site_id = sites.id AND sites.code = 'PILOT'
   AND products.code = 'TOSTADA-EXTRA'
   AND categories.site_id = sites.id AND categories.code = 'EXTRAS'
   AND (products.category_id <> categories.id OR products.name = 'Tostada extra'
        OR products.short_name = 'Tostada extra');

INSERT INTO product_prices (id, site_id, product_id, price_in_cents)
SELECT CASE WHEN EXISTS (SELECT 1 FROM product_prices WHERE id = data.id)
            THEN gen_random_uuid() ELSE data.id END,
       products.site_id, products.id, data.price_in_cents
  FROM products
  JOIN sites ON sites.id = products.site_id
  JOIN (VALUES
    ('00000000-0000-4000-8000-000000000825'::uuid, 'TOSTADA-EXTRA', 300),
    ('00000000-0000-4000-8000-000000000872'::uuid, 'AGUA-FRESCA-MEDIO-LITRO', 2500),
    ('00000000-0000-4000-8000-000000000873'::uuid, 'PATA-EXTRA', 2000),
    ('00000000-0000-4000-8000-000000000874'::uuid, 'FRIJOLES-ADOBADOS', 3000),
    ('00000000-0000-4000-8000-000000000875'::uuid, 'ARROZ-PORCION', 3000),
    ('00000000-0000-4000-8000-000000000876'::uuid, 'TORTILLAS-EXTRA', 500),
    ('00000000-0000-4000-8000-000000000877'::uuid, 'CHAMORRO-MEDIO', 10000),
    ('00000000-0000-4000-8000-000000000878'::uuid, 'CHAMORRO-COMPLETO', 17000)
  ) AS data(id, code, price_in_cents) ON products.code = data.code
 WHERE sites.code = 'PILOT'
   AND NOT EXISTS (
     SELECT 1 FROM product_prices prices
      WHERE prices.site_id = products.site_id AND prices.product_id = products.id
        AND prices.price_list_code = 'DEFAULT' AND prices.active
   )
ON CONFLICT DO NOTHING;

INSERT INTO product_modifier_groups (product_id, modifier_group_id, display_order)
SELECT products.id, groups.id, groups.display_order
  FROM products
  JOIN sites ON sites.id = products.site_id AND sites.code = 'PILOT'
  JOIN modifier_groups groups
    ON groups.site_id = products.site_id AND groups.code = 'SABOR-AGUA-FRESCA'
 WHERE products.code = 'AGUA-FRESCA-MEDIO-LITRO'
ON CONFLICT DO NOTHING;

-- La preparación combinada sólo aplica a la orden de cuatro. La pieza obtiene
-- su propio grupo con las tarifas y opciones originales, incluido cualquier ajuste.
INSERT INTO modifier_groups (
  id, site_id, code, name, minimum_selections, maximum_selections, display_order, active
)
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM modifier_groups WHERE id = '00000000-0000-4000-8000-000000001015'
       ) THEN gen_random_uuid() ELSE '00000000-0000-4000-8000-000000001015'::uuid END,
       groups.site_id, 'RELLENO-ENCHILADA-PIEZA', groups.name,
       groups.minimum_selections, groups.maximum_selections, groups.display_order, groups.active
  FROM modifier_groups groups
  JOIN sites ON sites.id = groups.site_id AND sites.code = 'PILOT'
 WHERE groups.code = 'RELLENO-ENCHILADA'
   AND EXISTS (SELECT 1 FROM products WHERE site_id = groups.site_id AND code = 'ENCHILADA-PIEZA')
ON CONFLICT (site_id, code) DO NOTHING;

INSERT INTO modifiers (
  id, site_id, modifier_group_id, code, name, price_delta_in_cents,
  display_order, active, available
)
SELECT CASE WHEN data.id IS NULL OR EXISTS (SELECT 1 FROM modifiers WHERE id = data.id)
            THEN gen_random_uuid() ELSE data.id END,
       original.site_id, target.id,
       CASE WHEN data.code IS NOT NULL THEN data.code ELSE concat('PIEZA-', original.code) END,
       original.name, original.price_delta_in_cents, original.display_order,
       original.active, original.available
  FROM modifiers original
  JOIN modifier_groups source ON source.id = original.modifier_group_id
  JOIN sites ON sites.id = source.site_id AND sites.code = 'PILOT'
  JOIN modifier_groups target
    ON target.site_id = source.site_id AND target.code = 'RELLENO-ENCHILADA-PIEZA'
  LEFT JOIN (VALUES
    ('ENCHILADA-QUESO', '00000000-0000-4000-8000-000000001185'::uuid, 'ENCHILADA-PIEZA-QUESO'),
    ('ENCHILADA-QUESO-CEBOLLA', '00000000-0000-4000-8000-000000001186'::uuid, 'ENCHILADA-PIEZA-QUESO-CEBOLLA'),
    ('ENCHILADA-CARNE', '00000000-0000-4000-8000-000000001187'::uuid, 'ENCHILADA-PIEZA-CARNE')
  ) AS data(source_code, id, code) ON data.source_code = original.code
 WHERE source.code = 'RELLENO-ENCHILADA' AND original.code <> 'ENCHILADA-COMBINADA'
ON CONFLICT (site_id, code) DO NOTHING;

INSERT INTO product_modifier_groups (product_id, modifier_group_id, display_order)
SELECT products.id, groups.id, groups.display_order
  FROM products
  JOIN sites ON sites.id = products.site_id AND sites.code = 'PILOT'
  JOIN modifier_groups groups
    ON groups.site_id = products.site_id AND groups.code = 'RELLENO-ENCHILADA-PIEZA'
 WHERE products.code = 'ENCHILADA-PIEZA'
ON CONFLICT DO NOTHING;

DELETE FROM product_modifier_groups links
 USING products, modifier_groups groups, sites
 WHERE links.product_id = products.id AND links.modifier_group_id = groups.id
   AND products.site_id = sites.id AND sites.code = 'PILOT'
   AND products.code = 'ENCHILADA-PIEZA' AND groups.code = 'RELLENO-ENCHILADA'
   AND EXISTS (
     SELECT 1 FROM product_modifier_groups replacement
     JOIN modifier_groups target ON target.id = replacement.modifier_group_id
      WHERE replacement.product_id = products.id AND target.code = 'RELLENO-ENCHILADA-PIEZA'
   );

INSERT INTO modifiers (
  id, site_id, modifier_group_id, code, name, price_delta_in_cents, display_order
)
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM modifiers WHERE id = '00000000-0000-4000-8000-000000001188'
       ) THEN gen_random_uuid() ELSE '00000000-0000-4000-8000-000000001188'::uuid END,
       groups.site_id, groups.id, 'ENCHILADA-COMBINADA', 'Combinadas (2 carne, 2 queso)', 0,
       COALESCE((SELECT max(display_order) FROM modifiers WHERE modifier_group_id = groups.id), 0) + 1
  FROM modifier_groups groups
  JOIN sites ON sites.id = groups.site_id AND sites.code = 'PILOT'
 WHERE groups.code = 'RELLENO-ENCHILADA'
   AND EXISTS (
     SELECT 1 FROM product_modifier_groups links
     JOIN products ON products.id = links.product_id
      WHERE links.modifier_group_id = groups.id AND products.code = 'ENCHILADAS-ORDEN-4'
   )
ON CONFLICT (site_id, code) DO NOTHING;
