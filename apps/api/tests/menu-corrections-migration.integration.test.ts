import { afterEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { applyPilotCatalog } from "../src/database/pilot-catalog.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { TestDatabase } from "./test-database.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  kitchen: "00000000-0000-4000-8000-000000000201",
  tax: "00000000-0000-4000-8000-000000000230",
};
const migration = "0014_menu_corrections.sql";
let database: TestDatabase | undefined;

afterEach(async () => { await database?.close(); database = undefined; });

const prepare = async () => {
  database = new TestDatabase();
  await runMigrations(database);
  await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')", [ids.site]);
  await database.query(
    "INSERT INTO production_centers (id, site_id, code, name) VALUES ($1, $2, 'KITCHEN', 'Cocina')",
    [ids.kitchen, ids.site],
  );
  await database.query(
    `INSERT INTO tax_rules (id, site_id, code, name, rate_basis_points, price_includes_tax)
     VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`, [ids.tax, ids.site],
  );
  const reload = () => database!.transaction((transaction) => applyPilotCatalog(transaction, {
    siteId: ids.site, kitchenId: ids.kitchen, taxRuleId: ids.tax,
  }));
  await reload();
  return { database, reload };
};

const runAgain = async (database: TestDatabase) => {
  await database.query("DELETE FROM schema_migrations WHERE filename = $1", [migration]);
  await runMigrations(database);
};

describe("correcciones del menú instalado", () => {
  it("actualiza un catálogo anterior y conserva sus precios y preparaciones personalizadas", async () => {
    const { database, reload } = await prepare();
    // Recrea la versión anterior: tostada en pozole, agua de un litro y preparación compartida.
    await database.query("DELETE FROM modifiers WHERE code = 'ENCHILADA-COMBINADA'");
    await database.query("DELETE FROM modifier_groups WHERE code = 'RELLENO-ENCHILADA-PIEZA'");
    await database.query(
      `INSERT INTO product_modifier_groups (product_id, modifier_group_id, display_order)
       SELECT products.id, groups.id, groups.display_order FROM products
       JOIN modifier_groups groups ON groups.site_id = products.site_id
       WHERE products.code = 'ENCHILADA-PIEZA' AND groups.code = 'RELLENO-ENCHILADA'`,
    );
    await database.query(
      `UPDATE products SET category_id = categories.id, name = 'Tostada extra', short_name = 'Tostada extra'
       FROM product_categories categories WHERE products.code = 'TOSTADA-EXTRA' AND categories.code = 'POZOLE'`,
    );
    await database.query(
      `DELETE FROM products WHERE code IN ('CHAMORRO-MEDIO', 'CHAMORRO-COMPLETO',
        'AGUA-FRESCA-MEDIO-LITRO', 'PATA-EXTRA', 'FRIJOLES-ADOBADOS', 'ARROZ-PORCION', 'TORTILLAS-EXTRA')`,
    );
    await database.query("DELETE FROM product_categories WHERE code IN ('CHAMORROS', 'EXTRAS')");
    await database.query(
      `UPDATE product_prices SET price_in_cents = 450 WHERE active
       AND product_id = (SELECT id FROM products WHERE code = 'TOSTADA-EXTRA')`,
    );
    await database.query(
      `UPDATE modifiers SET price_delta_in_cents = 700, name = 'Carne de la casa', available = false
       WHERE code = 'ENCHILADA-CARNE'`,
    );

    await runAgain(database);
    await runAgain(database);

    const catalog = await new CatalogService(database).catalog(ids.site);
    const products = catalog.categories.flatMap((category) => category.products);
    const byCode = (code: string) => products.find((product) => product.code === code)!;
    expect(catalog.categories.find((category) => category.code === "EXTRAS")?.products.map((product) => product.code))
      .toEqual(["TOSTADA-EXTRA", "PATA-EXTRA", "FRIJOLES-ADOBADOS", "ARROZ-PORCION", "TORTILLAS-EXTRA"]);
    expect(byCode("TOSTADA-EXTRA")).toMatchObject({ name: "Pieza tostada", priceInCents: 450 });
    expect(byCode("CHAMORRO-MEDIO")).toMatchObject({ priceInCents: 10000, available: true });
    expect(byCode("CHAMORRO-COMPLETO")).toMatchObject({ priceInCents: 17000, available: true });
    expect(byCode("AGUA-FRESCA-MEDIO-LITRO")).toMatchObject({ priceInCents: 2500, available: true });
    expect(byCode("AGUA-FRESCA-MEDIO-LITRO").modifierGroups)
      .toEqual(byCode("AGUA-FRESCA-LITRO").modifierGroups);
    const order = byCode("ENCHILADAS-ORDEN-4").modifierGroups[0]!;
    const piece = byCode("ENCHILADA-PIEZA").modifierGroups[0]!;
    expect(order.options.filter((option) => option.name === "Combinadas (2 carne, 2 queso)"))
      .toEqual([expect.objectContaining({ priceDeltaInCents: 0, available: true })]);
    expect(piece.options.map((option) => option.name)).toEqual(["Queso", "Queso con cebolla", "Carne de la casa"]);
    expect(piece.options[2]).toMatchObject({ priceDeltaInCents: 700, available: false });
    expect(order.options[2]).toMatchObject({ priceDeltaInCents: 700, available: false });
    expect(piece.id).not.toBe(order.id);

    await reload();
    const reloaded = (await new CatalogService(database).catalog(ids.site)).categories.flatMap((category) => category.products);
    expect(reloaded.find((product) => product.code === "TOSTADA-EXTRA")?.priceInCents).toBe(450);
    expect(reloaded.find((product) => product.code === "ENCHILADA-PIEZA")?.modifierGroups[0]?.options[2]?.priceDeltaInCents).toBe(700);
  });

  it("no reemplaza precios de productos nuevos que ya fueron configurados", async () => {
    const { database } = await prepare();
    await database.query(
      `UPDATE product_prices SET price_in_cents = 11500 WHERE active
       AND product_id = (SELECT id FROM products WHERE code = 'CHAMORRO-MEDIO')`,
    );
    await database.query(
      `UPDATE modifiers SET price_delta_in_cents = 500, available = false
       WHERE code = 'ENCHILADA-COMBINADA'`,
    );
    const before = await new CatalogService(database).catalog(ids.site);
    await runAgain(database);
    expect(await new CatalogService(database).catalog(ids.site)).toEqual(before);
  });
});
