import type { DatabaseSession } from "./database.port.js";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const option = (suffix: number, code: string, name: string, priceDeltaInCents = 0) => ({
  id: id(suffix),
  code,
  name,
  priceDeltaInCents,
});

const category = {
  pozole: id(700),
  tacosDorados: id(701),
  flautas: id(702),
  enchiladas: id(703),
  tostadas: id(704),
  sopes: id(705),
  quesadillas: id(706),
  platillos: id(707),
  tortas: id(708),
  paquetes: id(709),
  postres: id(710),
  bebidas: id(711),
};

const product = (
  suffix: number,
  categoryId: string,
  code: string,
  name: string,
  shortName: string,
  emoji: string,
  color: string,
  displayOrder: number,
  priceInCents: number,
) => ({
  id: id(suffix),
  priceId: id(suffix + 100),
  categoryId,
  code,
  name,
  shortName,
  emoji,
  color,
  displayOrder,
  priceInCents,
});

const pozoleIds = [id(720), id(721), id(722), id(723), id(724), id(736)];
const bote = (amount: number, index: number) =>
  option(1100 + index, `POZOLE-BOTE-${amount}`, `Bote de $${amount}`, (amount - 150) * 100);

export const pilotCatalog = {
  categories: [
    { id: category.pozole, code: "POZOLE", name: "Pozole", color: "honey", displayOrder: 1, seasonal: false },
    { id: category.tacosDorados, code: "TACOS-DORADOS", name: "Tacos dorados", color: "amber", displayOrder: 2, seasonal: false },
    { id: category.flautas, code: "FLAUTAS", name: "Flautas", color: "coral", displayOrder: 3, seasonal: false },
    { id: category.enchiladas, code: "ENCHILADAS", name: "Enchiladas", color: "clay", displayOrder: 4, seasonal: false },
    { id: category.tostadas, code: "TOSTADAS", name: "Tostadas", color: "sun", displayOrder: 5, seasonal: false },
    { id: category.sopes, code: "SOPES-GORDITAS", name: "Sopes y gorditas", color: "sage", displayOrder: 6, seasonal: false },
    { id: category.quesadillas, code: "QUESADILLAS", name: "Quesadillas", color: "peach", displayOrder: 7, seasonal: false },
    { id: category.platillos, code: "PLATILLOS-DIA", name: "Platillos del día", color: "clay", displayOrder: 8, seasonal: true },
    { id: category.tortas, code: "TORTAS", name: "Tortas y tacos", color: "amber", displayOrder: 9, seasonal: false },
    { id: category.paquetes, code: "PAQUETES", name: "Paquetes", color: "coral", displayOrder: 10, seasonal: false },
    { id: category.postres, code: "POSTRES", name: "Postres", color: "peach", displayOrder: 11, seasonal: false },
    { id: category.bebidas, code: "BEBIDAS", name: "Bebidas", color: "sage", displayOrder: 12, seasonal: false },
  ],
  products: [
    product(720, category.pozole, "POZOLE-CHICO", "Pozole chico", "Chico", "🍲", "honey", 1, 8000),
    product(721, category.pozole, "POZOLE-MEDIANO", "Pozole mediano", "Mediano", "🍲", "sun", 2, 9000),
    product(722, category.pozole, "POZOLE-GRANDE", "Pozole grande", "Grande", "🍲", "amber", 3, 10000),
    product(723, category.pozole, "POZOLE-LLEVAR-MEDIO-LITRO", "Pozole para llevar medio litro", "Medio litro", "🥡", "cream", 4, 8000),
    product(724, category.pozole, "POZOLE-LLEVAR-LITRO", "Pozole para llevar un litro", "Litro", "🥡", "honey", 5, 10000),
    product(736, category.pozole, "POZOLE-BOTE", "Pozole para llevar en bote", "Bote", "🪣", "sun", 6, 15000),
    product(725, category.pozole, "TOSTADA-EXTRA", "Tostada extra", "Tostada extra", "🫓", "cream", 7, 300),
    product(737, category.pozole, "CALDO-EXTRA-MEDIO-LITRO", "Caldo extra medio litro", "Caldo ½ litro", "🥣", "peach", 8, 2000),
    product(738, category.pozole, "CALDO-EXTRA-LITRO", "Caldo extra un litro", "Caldo litro", "🥣", "clay", 9, 3000),
    product(726, category.tacosDorados, "TACO-DORADO-ENROLLADO", "Taco dorado enrollado", "Enrollado", "🌮", "amber", 1, 1000),
    product(727, category.tacosDorados, "TACO-DORADO-CARNE", "Taco dorado de carne, combinado o chicharrón", "Carne o combinado", "🌮", "coral", 2, 1500),
    product(728, category.flautas, "FLAUTA", "Flauta", "Flauta", "🌯", "coral", 1, 3500),
    product(729, category.enchiladas, "ENCHILADAS-ORDEN-4", "Enchiladas, orden de 4", "Orden de 4", "🫔", "clay", 1, 7000),
    product(730, category.enchiladas, "ENCHILADA-PIEZA", "Enchilada por pieza", "Por pieza", "🫔", "peach", 2, 2000),
    product(731, category.tostadas, "TOSTADA", "Tostada", "Tostada", "🥙", "sun", 1, 3500),
    product(732, category.tostadas, "TOSTADA-SENCILLA", "Tostada sencilla", "Sencilla", "🫓", "cream", 2, 2000),
    product(733, category.sopes, "SOPE", "Sope", "Sope", "🥙", "sage", 1, 2500),
    product(734, category.sopes, "GORDITA-SENCILLA", "Gordita sencilla", "Gordita sencilla", "🫓", "cream", 2, 1500),
    product(735, category.quesadillas, "QUESADILLA", "Quesadilla", "Quesadilla", "🧀", "peach", 1, 3500),
    product(739, category.platillos, "CHILE-EN-NOGADA", "Chile en nogada", "Chile en nogada", "🌶️", "coral", 1, 22000),
    product(740, category.platillos, "PECHUGA-RELLENA", "Pechuga rellena con crema de champiñones", "Pechuga rellena", "🍗", "cream", 2, 15000),
    product(741, category.platillos, "CALDO-RES", "Caldo de res", "Caldo de res", "🍲", "honey", 3, 12000),
    product(742, category.platillos, "ESPINAZO", "Espinazo", "Espinazo", "🍖", "clay", 4, 10000),
    product(743, category.platillos, "ENMOLADAS-ARRACHERA", "Enmoladas de arrachera", "Enmoladas", "🫔", "clay", 5, 10000),
    product(744, category.platillos, "COSTILLAS", "Costillas normales", "Costillas", "🍖", "amber", 6, 10000),
    product(745, category.platillos, "COSTILLAS-BBQ", "Costillas BBQ", "Costillas BBQ", "🍖", "coral", 7, 18000),
    product(746, category.platillos, "MOLE", "Mole", "Mole", "🍛", "clay", 8, 10000),
    product(747, category.platillos, "PIPIAN", "Pipián", "Pipián", "🍛", "sage", 9, 10000),
    product(748, category.platillos, "HUARACHE", "Huarache", "Huarache", "🫓", "sun", 10, 10000),
    product(749, category.platillos, "BIRRIA", "Birria", "Birria", "🍲", "coral", 11, 12000),
    product(750, category.tortas, "TORTA", "Torta de carnitas, buche o combinada", "Torta", "🥖", "amber", 1, 6000),
    product(751, category.tortas, "TORTA-LENGUA", "Torta de lengua o combinada con lengua", "Torta de lengua", "🥖", "coral", 2, 6500),
    product(752, category.tortas, "TACO-SENCILLO", "Taco sencillo", "Taco sencillo", "🌮", "cream", 3, 1000),
    product(753, category.tortas, "TACO-CARNE", "Taco de carnitas, buche o combinado", "Taco con carne", "🌮", "amber", 4, 3000),
    product(754, category.tortas, "TACO-LENGUA", "Taco de lengua", "Taco de lengua", "🌮", "coral", 5, 3500),
    product(755, category.tortas, "TACO-BLANDITO", "Taco blandito", "Taco blandito", "🌮", "sun", 6, 3000),
    product(756, category.paquetes, "PAQUETE-1", "Paquete 1: torta y 2 tacos", "Paquete 1", "🎁", "amber", 1, 7500),
    product(757, category.paquetes, "PAQUETE-2", "Paquete 2: torta, 2 tacos y agua", "Paquete 2", "🎁", "sun", 2, 11000),
    product(758, category.paquetes, "PAQUETE-3", "Paquete 3: 5 tortas", "Paquete 3", "🎁", "coral", 3, 29000),
    product(759, category.paquetes, "PAQUETE-4", "Paquete 4: 5 tortas y 5 tacos dorados", "Paquete 4", "🎁", "clay", 4, 34000),
    product(760, category.paquetes, "PAQUETE-5", "Paquete 5: torta y 2 tacos dorados con carne", "Paquete 5", "🎁", "peach", 5, 10000),
    product(761, category.postres, "JERICALLA-CHICA", "Jericalla chica", "Jericalla chica", "🍮", "honey", 1, 2500),
    product(762, category.postres, "JERICALLA-GRANDE", "Jericalla grande", "Jericalla grande", "🍮", "amber", 2, 3500),
    product(763, category.postres, "GELATINA-GALLETA", "Gelatina de galleta", "Gelatina", "🍰", "peach", 3, 4500),
    product(764, category.bebidas, "AGUA-FRESCA-LITRO", "Agua fresca 1 litro", "Agua fresca", "🥤", "sage", 1, 4000),
    product(765, category.bebidas, "REFRESCO-355", "Refresco 355 ml", "Refresco", "🥤", "coral", 2, 3000),
    product(766, category.bebidas, "COCA-TAPARROSCA", "Coca-Cola taparrosca", "Coca taparrosca", "🥤", "clay", 3, 3500),
    product(767, category.bebidas, "COCA-125", "Coca-Cola 1.25 litros", "Coca 1.25 L", "🥤", "clay", 4, 4500),
    product(768, category.bebidas, "AGUA-MINERAL-CHICA", "Agua mineral chica", "Mineral chica", "💧", "cream", 5, 3500),
    product(769, category.bebidas, "AGUA-MINERAL-GRANDE", "Agua mineral grande", "Mineral grande", "💧", "sage", 6, 4500),
    product(770, category.bebidas, "JUGO", "Jugo", "Jugo", "🧃", "peach", 7, 3500),
    product(771, category.bebidas, "CERVEZA", "Cerveza", "Cerveza", "🍺", "honey", 8, 4000),
  ],
  modifierGroups: [
    {
      id: id(1002), code: "POZOLE-BOTE-MONTO", name: "Monto del bote", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(736)],
      options: [150, 200, 250, 300, 350, 400, 450, 500, 550, 600].map(bote),
    },
    {
      id: id(1000), code: "POZOLE-CARNE", name: "Carne", minimumSelections: 1, maximumSelections: 7,
      productIds: pozoleIds,
      options: [
        option(1120, "POZOLE-PIERNA", "Pierna"),
        option(1121, "POZOLE-LENGUA", "Lengua"),
        option(1122, "POZOLE-PATA", "Pata"),
        option(1123, "POZOLE-OREJA", "Oreja"),
        option(1124, "POZOLE-TROMPA", "Trompa"),
        option(1125, "POZOLE-HUESO", "Hueso"),
        option(1126, "POZOLE-SURTIDO", "Surtido"),
      ],
    },
    {
      id: id(1001), code: "POZOLE-EXTRAS", name: "Extras", minimumSelections: 0, maximumSelections: 2,
      productIds: pozoleIds,
      options: [
        option(1127, "POZOLE-HUESO-EXTRA", "Hueso extra", 2000),
        option(1128, "POZOLE-PATA-EXTRA", "Pata extra", 2000),
      ],
    },
    {
      id: id(900), code: "RELLENO-TACO-ENROLLADO", name: "Relleno", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(726)],
      options: [
        option(910, "TACO-PAPA", "Papa"),
        option(911, "TACO-FRIJOL", "Frijol"),
        option(912, "TACO-RAJAS", "Rajas"),
        option(913, "TACO-REQUESON", "Requesón"),
        option(914, "TACO-PICADILLO", "Picadillo"),
      ],
    },
    {
      id: id(901), code: "TIPO-TACO-CARNE", name: "Tipo", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(727)],
      options: [
        option(915, "TACO-CARNE", "Carne"),
        option(916, "TACO-COMBINADO", "Combinado"),
        option(1129, "TACO-CHICHARRON", "Chicharrón"),
      ],
    },
    {
      id: id(902), code: "RELLENO-FLAUTA", name: "Relleno", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(728)],
      options: [
        option(917, "FLAUTA-CARNE", "Carne"),
        option(918, "FLAUTA-PAPA", "Papa"),
        option(919, "FLAUTA-FRIJOL", "Frijol"),
        option(920, "FLAUTA-REQUESON", "Requesón"),
        option(921, "FLAUTA-RAJAS", "Rajas"),
        option(922, "FLAUTA-PICADILLO", "Picadillo"),
      ],
    },
    {
      id: id(903), code: "RELLENO-ENCHILADA", name: "Preparación", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(729), id(730)],
      options: [
        option(923, "ENCHILADA-QUESO", "Queso"),
        option(924, "ENCHILADA-QUESO-CEBOLLA", "Queso con cebolla"),
        option(925, "ENCHILADA-CARNE", "Carne"),
      ],
    },
    {
      id: id(904), code: "TIPO-TOSTADA", name: "Preparación", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(731)],
      options: [
        option(926, "TOSTADA-PIERNA", "Pierna"),
        option(927, "TOSTADA-PATA", "Pata"),
        option(928, "TOSTADA-CABEZA", "Carne de cabeza"),
        option(1130, "TOSTADA-LENGUA", "Lengua"),
        option(1131, "TOSTADA-CUERITO-VINAGRE", "Cuerito en vinagre"),
        option(1132, "TOSTADA-TROMPA-VINAGRE", "Trompa en vinagre"),
        option(1133, "TOSTADA-OREJA-VINAGRE", "Oreja en vinagre"),
      ],
    },
    {
      id: id(905), code: "RELLENO-SOPE", name: "Relleno", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(733)],
      options: [
        option(929, "SOPE-PAPA", "Papa"),
        option(930, "SOPE-FRIJOL", "Frijol"),
        option(931, "SOPE-RAJAS", "Rajas"),
        option(932, "SOPE-REQUESON", "Requesón"),
        option(933, "SOPE-PICADILLO", "Picadillo"),
        option(934, "SOPE-CARNE", "Carne"),
        option(1134, "SOPE-CHICHARRON", "Chicharrón"),
      ],
    },
    {
      id: id(906), code: "RELLENO-QUESADILLA", name: "Preparación", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(735)],
      options: [
        option(935, "QUESADILLA-SENCILLA", "Sencilla"),
        option(936, "QUESADILLA-CARNE", "Carne"),
        option(937, "QUESADILLA-RAJAS", "Rajas"),
        option(938, "QUESADILLA-PAPA", "Papa"),
        option(939, "QUESADILLA-FRIJOL", "Frijol"),
        option(940, "QUESADILLA-PICADILLO", "Picadillo"),
        option(1135, "QUESADILLA-CHICHARRON", "Chicharrón"),
      ],
    },
    {
      id: id(1003), code: "BIRRIA-CARNE", name: "Carne", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(749)],
      options: [
        option(1136, "BIRRIA-CHIVO", "Chivo"),
        option(1137, "BIRRIA-RES", "Res"),
      ],
    },
    {
      id: id(1004), code: "CARNE-TORTA", name: "Carne", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(750), id(753), id(755), id(756), id(757), id(760)],
      options: [
        option(1138, "TORTA-CARNITAS", "Carnitas"),
        option(1139, "TORTA-BUCHE", "Buche"),
        option(1140, "TORTA-COMBINADA", "Combinada"),
      ],
    },
    {
      id: id(1005), code: "CARNE-TORTA-LENGUA", name: "Carne", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(751)],
      options: [
        option(1141, "TORTA-LENGUA", "Lengua"),
        option(1142, "TORTA-COMBINADA-LENGUA", "Combinada con lengua"),
      ],
    },
    {
      id: id(1006), code: "RELLENO-TACO-SENCILLO", name: "Relleno", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(752)],
      options: [
        option(1143, "TACO-SENCILLO-PAPA", "Papa"),
        option(1144, "TACO-SENCILLO-FRIJOL", "Frijol"),
      ],
    },
    {
      id: id(1007), code: "CARNE-TORTAS-PAQUETE", name: "Carne de las tortas", minimumSelections: 1, maximumSelections: 3,
      productIds: [id(758), id(759)],
      options: [
        option(1145, "PAQUETE-TORTAS-CARNITAS", "Carnitas"),
        option(1146, "PAQUETE-TORTAS-BUCHE", "Buche"),
        option(1147, "PAQUETE-TORTAS-COMBINADA", "Combinada"),
      ],
    },
    {
      id: id(1008), code: "RELLENO-TACOS-PAQUETE", name: "Relleno de los tacos", minimumSelections: 1, maximumSelections: 2,
      productIds: [id(756), id(757), id(759)],
      options: [
        option(1148, "PAQUETE-TACOS-PAPA", "Papa"),
        option(1149, "PAQUETE-TACOS-FRIJOL", "Frijol"),
      ],
    },
    {
      id: id(1009), code: "TACOS-DORADOS-PAQUETE", name: "Tacos dorados", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(760)],
      options: [
        option(1150, "PAQUETE-TACOS-CARNE", "Carne"),
        option(1151, "PAQUETE-TACOS-COMBINADO", "Combinado"),
      ],
    },
    {
      id: id(1010), code: "SABOR-AGUA-FRESCA", name: "Sabor del agua", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(764), id(757)],
      options: [
        option(1152, "AGUA-MANGO", "Mango"),
        option(1153, "AGUA-CIRUELA", "Ciruela"),
        option(1154, "AGUA-GUAYABA", "Guayaba"),
        option(1155, "AGUA-GUANABANA", "Guanábana"),
        option(1156, "AGUA-LIMA", "Lima"),
        option(1157, "AGUA-ARROZ", "Arroz"),
        option(1158, "AGUA-TAMARINDO", "Tamarindo"),
        option(1159, "AGUA-JAMAICA", "Jamaica"),
        option(1160, "AGUA-PINA", "Piña"),
        option(1161, "AGUA-TROPICAL", "Tropical"),
        option(1162, "AGUA-TARO", "Taro"),
      ],
    },
    {
      id: id(1011), code: "SABOR-REFRESCO", name: "Refresco", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(765)],
      options: [
        option(1163, "REFRESCO-PEPSI", "Pepsi"),
        option(1164, "REFRESCO-MIRINDA", "Mirinda"),
        option(1165, "REFRESCO-SEVEN", "Seven Up"),
        option(1166, "REFRESCO-MANZANA", "Manzana"),
        option(1167, "REFRESCO-SANGRIA", "Sangría"),
        option(1168, "REFRESCO-JARRITOS-MANDARINA", "Jarritos mandarina"),
        option(1169, "REFRESCO-JARRITOS-TAMARINDO", "Jarritos tamarindo"),
        option(1170, "REFRESCO-JARRITOS-TUTIFRUTI", "Jarritos tutifruti"),
        option(1171, "REFRESCO-JARRITOS-PINA", "Jarritos piña"),
        option(1172, "REFRESCO-COCA-COLA", "Coca-Cola"),
        option(1173, "REFRESCO-SPRITE", "Sprite"),
        option(1174, "REFRESCO-FRESCA", "Fresca"),
        option(1175, "REFRESCO-SIDRAL", "Sidral Mundet"),
        option(1176, "REFRESCO-FANTA", "Fanta"),
      ],
    },
    {
      id: id(1012), code: "TIPO-COCA-TAPARROSCA", name: "Tipo", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(766)],
      options: [
        option(1177, "COCA-ORIGINAL", "Original"),
        option(1178, "COCA-ZERO", "Zero"),
        option(1179, "COCA-LIGHT", "Light"),
      ],
    },
    {
      id: id(1013), code: "SABOR-JUGO", name: "Sabor", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(770)],
      options: [
        option(1180, "JUGO-DURAZNO", "Durazno"),
        option(1181, "JUGO-MANZANA", "Manzana"),
      ],
    },
    {
      id: id(1014), code: "TIPO-CERVEZA", name: "Tipo", minimumSelections: 1, maximumSelections: 1,
      productIds: [id(771)],
      options: [
        option(1182, "CERVEZA-CLARA", "Clara"),
        option(1183, "CERVEZA-OBSCURA", "Obscura"),
      ],
    },
  ],
};

export const applyPilotCatalog = async (
  transaction: DatabaseSession,
  input: { siteId: string; kitchenId: string; taxRuleId: string },
): Promise<void> => {
  // Los platillos de temporada los administra el restaurante desde el POS;
  // recargar el catálogo no debe revertir sus nombres, precios ni disponibilidad.
  const fixedProducts = `SELECT products.id
      FROM products
      JOIN product_categories categories ON categories.id = products.category_id
     WHERE products.site_id = $1 AND NOT categories.seasonal`;
  await transaction.query(
    `DELETE FROM product_modifier_groups
      WHERE product_id IN (SELECT id FROM products WHERE site_id = $1)`,
    [input.siteId],
  );
  await transaction.query(
    `UPDATE product_prices
        SET active = false
      WHERE site_id = $1 AND product_id IN (${fixedProducts})`,
    [input.siteId],
  );
  await transaction.query(
    `UPDATE products
        SET active = false, available = false, updated_at = now()
      WHERE site_id = $1 AND id IN (${fixedProducts})`,
    [input.siteId],
  );
  await transaction.query(
    `UPDATE product_categories SET active = false WHERE site_id = $1 AND NOT seasonal`,
    [input.siteId],
  );
  await transaction.query(
    `UPDATE modifiers
        SET active = false, available = false
      WHERE site_id = $1`,
    [input.siteId],
  );
  await transaction.query(
    `UPDATE modifier_groups SET active = false WHERE site_id = $1`,
    [input.siteId],
  );

  const seasonalCategories = new Set(
    pilotCatalog.categories
      .filter((category) => category.seasonal)
      .map((category) => category.id),
  );

  for (const category of pilotCatalog.categories) {
    await transaction.query(
      `UPDATE product_categories AS legacy
          SET code = concat(
            legacy.code,
            '-LEGACY-',
            right(replace(legacy.id::text, '-', ''), 8)
          )
        WHERE legacy.site_id = $1
          AND legacy.code = $2
          AND legacy.id <> $3`,
      [input.siteId, category.code, category.id],
    );
    await transaction.query(
      `INSERT INTO product_categories (
         id, site_id, code, name, color, display_order, seasonal, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         color = EXCLUDED.color,
         display_order = EXCLUDED.display_order,
         seasonal = EXCLUDED.seasonal,
         active = true`,
      [
        category.id,
        input.siteId,
        category.code,
        category.name,
        category.color,
        category.displayOrder,
        category.seasonal,
      ],
    );
  }

  for (const product of pilotCatalog.products) {
    const seasonal = seasonalCategories.has(product.categoryId);
    await transaction.query(
      `UPDATE products AS legacy
          SET code = concat(
            legacy.code,
            '-LEGACY-',
            right(replace(legacy.id::text, '-', ''), 8)
          ),
          updated_at = now()
        WHERE legacy.site_id = $1
          AND legacy.code = $2
          AND legacy.id <> $3`,
      [input.siteId, product.code, product.id],
    );
    await transaction.query(
      `INSERT INTO products (
         id, site_id, category_id, production_center_id, tax_rule_id,
         code, name, short_name, emoji, color, display_order,
         active, available
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true)
       ON CONFLICT (id) DO UPDATE SET
         category_id = EXCLUDED.category_id,
         production_center_id = EXCLUDED.production_center_id,
         tax_rule_id = EXCLUDED.tax_rule_id,
         code = EXCLUDED.code,
         name = CASE WHEN $12 THEN products.name ELSE EXCLUDED.name END,
         short_name = CASE WHEN $12 THEN products.short_name ELSE EXCLUDED.short_name END,
         emoji = EXCLUDED.emoji,
         color = EXCLUDED.color,
         display_order = EXCLUDED.display_order,
         active = true,
         available = CASE WHEN $12 THEN products.available ELSE true END,
         version = products.version + 1,
         updated_at = now()`,
      [
        product.id,
        input.siteId,
        product.categoryId,
        input.kitchenId,
        input.taxRuleId,
        product.code,
        product.name,
        product.shortName,
        product.emoji,
        product.color,
        product.displayOrder,
        seasonal,
      ],
    );
    await transaction.query(
      `INSERT INTO product_prices (
         id, site_id, product_id, price_list_code, price_in_cents, active
       ) VALUES ($1, $2, $3, 'DEFAULT', $4, true)
       ON CONFLICT (id) DO UPDATE SET
         price_in_cents = EXCLUDED.price_in_cents,
         active = true
       WHERE NOT $5::boolean`,
      [product.priceId, input.siteId, product.id, product.priceInCents, seasonal],
    );
  }

  for (const [groupIndex, group] of pilotCatalog.modifierGroups.entries()) {
    await transaction.query(
      `UPDATE modifier_groups AS legacy
          SET code = concat(
            legacy.code,
            '-LEGACY-',
            right(replace(legacy.id::text, '-', ''), 8)
          )
        WHERE legacy.site_id = $1
          AND legacy.code = $2
          AND legacy.id <> $3`,
      [input.siteId, group.code, group.id],
    );
    await transaction.query(
      `INSERT INTO modifier_groups (
         id, site_id, code, name, minimum_selections, maximum_selections,
         display_order, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         minimum_selections = EXCLUDED.minimum_selections,
         maximum_selections = EXCLUDED.maximum_selections,
         display_order = EXCLUDED.display_order,
         active = true`,
      [
        group.id,
        input.siteId,
        group.code,
        group.name,
        group.minimumSelections,
        group.maximumSelections,
        groupIndex + 1,
      ],
    );
    for (const [optionIndex, option] of group.options.entries()) {
      await transaction.query(
        `UPDATE modifiers AS legacy
            SET code = concat(
              legacy.code,
              '-LEGACY-',
              right(replace(legacy.id::text, '-', ''), 8)
            )
          WHERE legacy.site_id = $1
            AND legacy.code = $2
            AND legacy.id <> $3`,
        [input.siteId, option.code, option.id],
      );
      await transaction.query(
        `INSERT INTO modifiers (
           id, site_id, modifier_group_id, code, name,
           price_delta_in_cents, display_order, active, available
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
         ON CONFLICT (id) DO UPDATE SET
           modifier_group_id = EXCLUDED.modifier_group_id,
           code = EXCLUDED.code,
           name = EXCLUDED.name,
           price_delta_in_cents = EXCLUDED.price_delta_in_cents,
           display_order = EXCLUDED.display_order,
           active = true,
           available = true`,
        [
          option.id,
          input.siteId,
          group.id,
          option.code,
          option.name,
          option.priceDeltaInCents,
          optionIndex + 1,
        ],
      );
    }
    for (const productId of group.productIds) {
      // El orden del grupo en el catálogo es el orden en que se presenta en la pantalla.
      await transaction.query(
        `INSERT INTO product_modifier_groups (
           product_id, modifier_group_id, display_order
         ) VALUES ($1, $2, $3)`,
        [productId, group.id, groupIndex + 1],
      );
    }
  }
};
