import { afterEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/audit/audit.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { SeasonalProductsService } from "../src/catalog/seasonal-products.service.js";
import { applyPilotCatalog, pilotCatalog } from "../src/database/pilot-catalog.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { TestDatabase } from "./test-database.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  kitchen: "00000000-0000-4000-8000-000000000201",
  tax: "00000000-0000-4000-8000-000000000230",
};

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("catálogo real del piloto", () => {
  const prepare = async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      `INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')`,
      [ids.site],
    );
    await database.query(
      `INSERT INTO production_centers (id, site_id, code, name)
       VALUES ($1, $2, 'KITCHEN', 'Cocina')`,
      [ids.kitchen, ids.site],
    );
    await database.query(
      `INSERT INTO tax_rules (
         id, site_id, code, name, rate_basis_points, price_includes_tax
       ) VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`,
      [ids.tax, ids.site],
    );
    const load = () => database!.transaction((transaction) =>
      applyPilotCatalog(transaction, {
        siteId: ids.site,
        kitchenId: ids.kitchen,
        taxRuleId: ids.tax,
      }),
    );
    await load();
    return { load, catalog: () => new CatalogService(database!).catalog(ids.site) };
  };

  it("reemplaza el menú de demostración y conserva una carga idempotente", async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      `INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')`,
      [ids.site],
    );
    await database.query(
      `INSERT INTO production_centers (id, site_id, code, name)
       VALUES ($1, $2, 'KITCHEN', 'Cocina')`,
      [ids.kitchen, ids.site],
    );
    await database.query(
      `INSERT INTO tax_rules (
         id, site_id, code, name, rate_basis_points, price_includes_tax
       ) VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`,
      [ids.tax, ids.site],
    );
    await database.query(
      `INSERT INTO product_categories (id, site_id, code, name)
       VALUES ('00000000-0000-4000-8000-000000000240', $1, 'DEMO', 'Demostración')`,
      [ids.site],
    );
    await database.query(
      `INSERT INTO products (
         id, site_id, category_id, production_center_id, tax_rule_id,
         code, name, short_name
       ) VALUES (
         '00000000-0000-4000-8000-000000000300', $1,
         '00000000-0000-4000-8000-000000000240', $2, $3,
         'SOPE', 'Sope de demostración', 'Sope demo'
       )`,
      [ids.site, ids.kitchen, ids.tax],
    );
    await database.query(
      `INSERT INTO product_prices (
         id, site_id, product_id, price_in_cents
       ) VALUES (
         '00000000-0000-4000-8000-000000000400', $1,
         '00000000-0000-4000-8000-000000000300', 2200
       )`,
      [ids.site],
    );

    for (let run = 0; run < 2; run += 1) {
      await database.transaction((transaction) =>
        applyPilotCatalog(transaction, {
          siteId: ids.site,
          kitchenId: ids.kitchen,
          taxRuleId: ids.tax,
        }),
      );
    }

    const catalog = await new CatalogService(database).catalog(ids.site);
    expect(catalog.categories).toHaveLength(pilotCatalog.categories.length);
    expect(catalog.categories.flatMap((category) => category.products)).toHaveLength(
      pilotCatalog.products.length,
    );
    expect(catalog.categories.map((category) => category.name)).toEqual([
      "Pozole",
      "Tacos dorados",
      "Flautas",
      "Enchiladas",
      "Tostadas",
      "Sopes y gorditas",
      "Quesadillas",
      "Platillos del día",
      "Tortas y tacos",
      "Paquetes",
      "Postres",
      "Bebidas",
      "Chamorros",
      "Extras",
    ]);
    expect(
      catalog.categories.filter((category) => category.seasonal).map((category) => category.code),
    ).toEqual(["PLATILLOS-DIA"]);

    const products = catalog.categories.flatMap((category) => category.products);
    const byCode = (code: string) => products.find((product) => product.code === code);

    const pozole = catalog.categories[0]?.products;
    expect(pozole?.map((product) => [product.shortName, product.priceInCents])).toEqual([
      ["Chico", 8000],
      ["Mediano", 9000],
      ["Grande", 10000],
      ["Medio litro", 8000],
      ["Litro", 10000],
      ["Bote", 15000],
      ["Caldo ½ litro", 2000],
      ["Caldo litro", 3000],
    ]);
    expect(byCode("POZOLE-CHICO")?.modifierGroups.map((group) => [
      group.name,
      group.minimumSelections,
      group.maximumSelections,
    ])).toEqual([
      ["Carne", 1, 7],
      ["Extras", 0, 2],
    ]);
    expect(byCode("POZOLE-CHICO")?.modifierGroups[0]?.options.map((option) => option.name)).toEqual([
      "Pierna", "Lengua", "Pata", "Oreja", "Trompa", "Hueso", "Surtido",
    ]);
    expect(byCode("POZOLE-CHICO")?.modifierGroups[1]?.options.map((option) => [
      option.name,
      option.priceDeltaInCents,
    ])).toEqual([
      ["Hueso extra", 2000],
      ["Pata extra", 2000],
    ]);
    const bote = byCode("POZOLE-BOTE");
    expect(bote?.modifierGroups.map((group) => group.name)).toEqual([
      "Monto del bote",
      "Carne",
      "Extras",
    ]);
    expect(bote?.modifierGroups[0]?.options.slice(0, 3).map((option) => [
      option.name,
      option.priceDeltaInCents,
    ])).toEqual([
      ["Bote de $150", 0],
      ["Bote de $200", 5000],
      ["Bote de $250", 10000],
    ]);

    expect(byCode("FLAUTA")?.priceInCents).toBe(3500);
    expect(byCode("AGUA-FRESCA-MEDIO-LITRO")).toMatchObject({
      name: "Agua fresca 1/2 litro", priceInCents: 2500, available: true,
    });
    expect(byCode("AGUA-FRESCA-MEDIO-LITRO")?.modifierGroups)
      .toEqual(byCode("AGUA-FRESCA-LITRO")?.modifierGroups);
    expect(catalog.categories.find((category) => category.code === "CHAMORROS")?.products)
      .toEqual([
        expect.objectContaining({ code: "CHAMORRO-MEDIO", priceInCents: 10000, available: true }),
        expect.objectContaining({ code: "CHAMORRO-COMPLETO", priceInCents: 17000, available: true }),
      ]);
    expect(catalog.categories.find((category) => category.code === "EXTRAS")?.products
      .map((product) => [product.name, product.priceInCents])).toEqual([
      ["Pieza tostada", 300], ["Pata", 2000], ["Frijoles Adobados", 3000],
      ["Arroz porción", 3000], ["Tortillas", 500],
    ]);
    expect(byCode("ENCHILADAS-ORDEN-4")?.modifierGroups[0]?.options.map((option) => option.name))
      .toEqual(["Queso", "Queso con cebolla", "Carne", "Combinadas (2 carne, 2 queso)"]);
    expect(byCode("ENCHILADA-PIEZA")?.modifierGroups[0]?.options.map((option) => option.name))
      .toEqual(["Queso", "Queso con cebolla", "Carne"]);
    expect(byCode("FLAUTA")?.modifierGroups[0]).toMatchObject({
      name: "Relleno",
      minimumSelections: 1,
      maximumSelections: 1,
    });
    expect(byCode("FLAUTA")?.modifierGroups[0]?.options).toEqual([
      "Carne", "Papa", "Frijol", "Requesón", "Rajas", "Picadillo", "Chicharrón",
    ].map((name) => expect.objectContaining({ name, priceDeltaInCents: 0, available: true })));
    expect(byCode("TOSTADA")?.priceInCents).toBe(3500);
    expect(byCode("TOSTADA-SENCILLA")?.priceInCents).toBe(2000);
    expect(byCode("TOSTADA")?.modifierGroups[0]?.options.map((option) => option.name)).toEqual([
      "Pierna",
      "Pata",
      "Carne de cabeza",
      "Lengua",
      "Cuerito en vinagre",
      "Trompa en vinagre",
      "Oreja en vinagre",
    ]);
    expect(byCode("SOPE")?.priceInCents).toBe(2500);
    expect(byCode("SOPE")?.modifierGroups[0]?.options.map((option) => option.name)).toContain(
      "Chicharrón",
    );
    expect(byCode("TACO-DORADO-CARNE")?.modifierGroups[0]?.options.map((option) => option.name))
      .toContain("Chicharrón");

    const quesadilla = byCode("QUESADILLA");
    expect(quesadilla?.priceInCents).toBe(3500);
    expect(quesadilla?.modifierGroups[0]).toMatchObject({
      name: "Preparación",
      minimumSelections: 1,
      maximumSelections: 1,
    });
    expect(quesadilla?.modifierGroups[0]?.options.map((option) => option.name)).toEqual([
      "Sencilla",
      "Carne",
      "Rajas",
      "Papa",
      "Frijol",
      "Picadillo",
      "Chicharrón",
    ]);
    expect(byCode("PAQUETE-2")?.modifierGroups.map((group) => group.name)).toEqual([
      "Carne",
      "Relleno de los tacos",
      "Sabor del agua",
    ]);
    expect(byCode("BIRRIA")?.modifierGroups[0]?.options.map((option) => option.name)).toEqual([
      "Chivo",
      "Res",
    ]);

    const legacy = await database.query<{
      active: boolean;
      available: boolean;
      code: string;
      name: string;
    }>(
      `SELECT active, available, code, name
         FROM products
        WHERE id = '00000000-0000-4000-8000-000000000300'`,
    );
    expect(legacy.rows[0]).toEqual({
      active: false,
      available: false,
      code: "SOPE-LEGACY-00000300",
      name: "Sope de demostración",
    });
  });

  it("conserva precios administrativos de productos fijos y extras al recargar", async () => {
    const { load, catalog } = await prepare();
    const flauta = pilotCatalog.products.find((product) => product.code === "FLAUTA")!;
    const currentPriceId = "00000000-0000-4000-8000-000000009901";
    await database!.query(
      `UPDATE product_prices SET active = false WHERE product_id = $1`,
      [flauta.id],
    );
    await database!.query(
      `INSERT INTO product_prices (id, site_id, product_id, price_in_cents)
       VALUES ($1, $2, $3, 4200)`,
      [currentPriceId, ids.site, flauta.id],
    );
    await database!.query(
      `UPDATE modifiers SET price_delta_in_cents = 2750
        WHERE site_id = $1 AND code = 'POZOLE-HUESO-EXTRA'`,
      [ids.site],
    );

    await load();
    await load();

    const products = (await catalog()).categories.flatMap((category) => category.products);
    expect(products.find((product) => product.id === flauta.id)?.priceInCents).toBe(4200);
    expect(products.find((product) => product.code === "POZOLE-CHICO")
      ?.modifierGroups.flatMap((group) => group.options)
      .find((option) => option.name === "Hueso extra")?.priceDeltaInCents).toBe(2750);
    const prices = await database!.query<{
      id: string;
      price_in_cents: number;
      active: boolean;
    }>(
      `SELECT id, price_in_cents, active FROM product_prices
        WHERE product_id = $1 ORDER BY active`,
      [flauta.id],
    );
    expect(prices.rows).toEqual([
      { id: flauta.priceId, price_in_cents: 3500, active: false },
      { id: currentPriceId, price_in_cents: 4200, active: true },
    ]);
  });

  it("asigna defaults nuevos sin reactivar un precio histórico ni alterar otras listas", async () => {
    const { load, catalog } = await prepare();
    const flauta = pilotCatalog.products.find((product) => product.code === "FLAUTA")!;
    await database!.query(
      `UPDATE product_prices SET active = false WHERE product_id = $1`,
      [flauta.id],
    );
    await database!.query(
      `INSERT INTO product_prices (id, site_id, product_id, price_list_code, price_in_cents)
       VALUES ('00000000-0000-4000-8000-000000009902', $1, $2, 'WHOLESALE', 3000)`,
      [ids.site, flauta.id],
    );
    await database!.query(
      `DELETE FROM modifiers WHERE site_id = $1 AND code = 'FLAUTA-CHICHARRON'`,
      [ids.site],
    );

    await load();
    await load();

    const prices = await database!.query<{
      id: string;
      price_list_code: string;
      price_in_cents: number;
      active: boolean;
    }>(
      `SELECT id, price_list_code, price_in_cents, active FROM product_prices
        WHERE product_id = $1 ORDER BY active, price_list_code`,
      [flauta.id],
    );
    expect(prices.rows).toEqual([
      { id: flauta.priceId, price_list_code: "DEFAULT", price_in_cents: 3500, active: false },
      {
        id: expect.any(String),
        price_list_code: "DEFAULT",
        price_in_cents: 3500,
        active: true,
      },
      {
        id: "00000000-0000-4000-8000-000000009902",
        price_list_code: "WHOLESALE",
        price_in_cents: 3000,
        active: true,
      },
    ]);
    expect(prices.rows[1]?.id).not.toBe(flauta.priceId);
    const products = (await catalog()).categories.flatMap((category) => category.products);
    expect(products.find((product) => product.id === flauta.id)
      ?.modifierGroups.flatMap((group) => group.options)
      .find((option) => option.name === "Chicharrón"))
      .toMatchObject({ priceDeltaInCents: 0, available: true });
  });
});

describe("platillos de temporada", () => {
  const actor: AuthContext = {
    sessionId: "00000000-0000-4000-8000-000000000050",
    siteId: ids.site,
    userId: "00000000-0000-4000-8000-000000000051",
    terminalId: "00000000-0000-4000-8000-000000000052",
    displayName: "Administrador",
    permissions: ["catalog.product.manage"],
  };

  const prepare = async () => {
    database = new TestDatabase();
    await runMigrations(database);
    await database.query(
      `INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')`,
      [ids.site],
    );
    await database.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name)
       VALUES ($1, $2, 'ADMIN', 'Administrador')`,
      [actor.userId, ids.site],
    );
    await database.query(
      `INSERT INTO terminals (id, site_id, code, display_name, profile, device_token_hash)
       VALUES ($1, $2, 'POS-01', 'Tablet', 'pos', 'hash')`,
      [actor.terminalId, ids.site],
    );
    await database.query(
      `INSERT INTO production_centers (id, site_id, code, name)
       VALUES ($1, $2, 'KITCHEN', 'Cocina')`,
      [ids.kitchen, ids.site],
    );
    await database.query(
      `INSERT INTO tax_rules (
         id, site_id, code, name, rate_basis_points, price_includes_tax
       ) VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`,
      [ids.tax, ids.site],
    );
    const load = () =>
      database!.transaction((transaction) =>
        applyPilotCatalog(transaction, {
          siteId: ids.site,
          kitchenId: ids.kitchen,
          taxRuleId: ids.tax,
        }),
      );
    await load();
    return {
      load,
      service: new SeasonalProductsService(
        new AuditService(),
        new IdempotencyService(database),
      ),
      catalog: () => new CatalogService(database!).catalog(ids.site),
    };
  };

  it("edita precio, nombre y disponibilidad y los conserva al recargar el catálogo", async () => {
    const { load, service, catalog } = await prepare();
    const seasonal = (await catalog()).categories.find((category) => category.seasonal);
    const mole = seasonal?.products.find((product) => product.code === "MOLE");
    expect(mole).toMatchObject({ priceInCents: 10000, available: true });

    const updated = await service.update(
      mole!.id,
      { expectedVersion: mole!.version, priceInCents: 11500, name: "Mole poblano", available: false },
      "edit-mole",
      actor,
    );
    expect(updated.body.product).toMatchObject({
      name: "Mole poblano",
      priceInCents: 11500,
      available: false,
      version: mole!.version + 1,
    });
    await expect(
      service.update(mole!.id, { expectedVersion: mole!.version, priceInCents: 9000 }, "stale", actor),
    ).rejects.toThrow("cambió");

    const created = await service.create(
      { categoryId: seasonal!.id, name: "Pozole verde", priceInCents: 13000 },
      "create-verde",
      actor,
    );

    await load();
    const reloaded = (await catalog()).categories.find((category) => category.seasonal);
    expect(reloaded?.products.find((product) => product.id === mole!.id)).toMatchObject({
      name: "Mole poblano",
      priceInCents: 11500,
      available: false,
    });
    expect(reloaded?.products.find((product) => product.id === created.body.product.id))
      .toMatchObject({ name: "Pozole verde", priceInCents: 13000, available: true });

    const prices = await database!.query<{ price_in_cents: number; active: boolean }>(
      `SELECT price_in_cents, active FROM product_prices
        WHERE product_id = $1 ORDER BY active, price_in_cents`,
      [mole!.id],
    );
    expect(prices.rows).toEqual([
      { price_in_cents: 10000, active: false },
      { price_in_cents: 11500, active: true },
    ]);
  });

  it("no permite editar productos del menú fijo desde el POS", async () => {
    const { service, catalog } = await prepare();
    const sope = (await catalog()).categories
      .flatMap((category) => category.products)
      .find((product) => product.code === "SOPE");
    await expect(
      service.update(sope!.id, { expectedVersion: sope!.version, priceInCents: 100 }, "sope", actor),
    ).rejects.toThrow("temporada");
  });
});
