import { afterEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { applyPilotCatalog } from "../src/database/pilot-catalog.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { TestDatabase } from "./test-database.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  kitchen: "00000000-0000-4000-8000-000000000201",
  tax: "00000000-0000-4000-8000-000000000230",
  flauta: "00000000-0000-4000-8000-000000000728",
  group: "00000000-0000-4000-8000-000000000902",
  chicharron: "00000000-0000-4000-8000-000000001184",
};
const migration = "0013_flauta_chicharron.sql";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

const prepare = async () => {
  database = new TestDatabase();
  await runMigrations(database);
  await database.query(
    "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
    [ids.site],
  );
  await database.query(
    `INSERT INTO production_centers (id, site_id, code, name)
     VALUES ($1, $2, 'KITCHEN', 'Cocina')`,
    [ids.kitchen, ids.site],
  );
  await database.query(
    `INSERT INTO tax_rules (id, site_id, code, name, rate_basis_points, price_includes_tax)
     VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`,
    [ids.tax, ids.site],
  );
  await database.transaction((transaction) => applyPilotCatalog(transaction, {
    siteId: ids.site,
    kitchenId: ids.kitchen,
    taxRuleId: ids.tax,
  }));
  return database;
};

const markPending = (database: TestDatabase) => database.query(
  "DELETE FROM schema_migrations WHERE filename = $1",
  [migration],
);

const flauta = async (database: TestDatabase) => {
  const catalog = await new CatalogService(database).catalog(ids.site);
  return catalog.categories.flatMap((category) => category.products)
    .find((product) => product.code === "FLAUTA");
};

describe("actualización del relleno de flautas", () => {
  it("agrega chicharrón sin recargo a un catálogo anterior y conserva sus ajustes", async () => {
    const database = await prepare();
    // Recrea el catálogo ya instalado antes de esta actualización.
    await database.query("DELETE FROM modifiers WHERE code = 'FLAUTA-CHICHARRON'");
    await database.query(
      "UPDATE products SET name = 'Flauta de la casa' WHERE id = $1",
      [ids.flauta],
    );
    await database.query(
      "UPDATE product_prices SET price_in_cents = 4200 WHERE product_id = $1 AND active",
      [ids.flauta],
    );
    await database.query(
      `UPDATE modifiers SET available = false, name = 'Carne especial'
        WHERE code = 'FLAUTA-CARNE'`,
    );
    // Un UUID reservado ocupado por una opción ajena no bloquea la actualización.
    await database.query(
      `INSERT INTO modifiers (
         id, site_id, modifier_group_id, code, name, price_delta_in_cents, display_order
       ) VALUES ($1, $2, $3, 'FLAUTA-CASA', 'Relleno de la casa', 700, 10)`,
      [ids.chicharron, ids.site, ids.group],
    );
    const before = await flauta(database);
    await markPending(database);

    await runMigrations(database);
    // Comprueba también la idempotencia del SQL si debe volver a ejecutarse.
    await markPending(database);
    await runMigrations(database);

    const updated = await flauta(database);
    expect(updated).toMatchObject({
      name: "Flauta de la casa",
      priceInCents: 4200,
      version: before!.version,
    });
    expect(updated?.modifierGroups[0]).toMatchObject({
      id: ids.group,
      name: "Relleno",
      minimumSelections: 1,
      maximumSelections: 1,
    });
    const options = updated!.modifierGroups[0]!.options;
    expect(options.filter((option) => option.name === "Chicharrón"))
      .toEqual([expect.objectContaining({ priceDeltaInCents: 0, available: true })]);
    expect(options.find((option) => option.name === "Chicharrón")?.id)
      .not.toBe(ids.chicharron);
    expect(options.filter((option) => option.name !== "Chicharrón"))
      .toEqual(before!.modifierGroups[0]!.options);
  });

  it("conserva la opción existente si ya fue personalizada por el restaurante", async () => {
    const database = await prepare();
    await database.query(
      `UPDATE modifiers
          SET name = 'Chicharrón de la casa', price_delta_in_cents = 500, available = false
        WHERE code = 'FLAUTA-CHICHARRON'`,
    );
    const before = await flauta(database);
    await markPending(database);

    await runMigrations(database);

    expect(await flauta(database)).toEqual(before);
  });
});
