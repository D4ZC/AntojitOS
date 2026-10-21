# Menú del piloto

Transcripción operativa de las fotografías y ajustes proporcionados el 15 de octubre de 2026. Los importes ya incluyen impuestos y se almacenan en centavos. La fuente de verdad es `apps/api/src/database/pilot-catalog.ts`.

## Pozole

| Producto | Precio |
|---|---:|
| Pozole chico | $80 |
| Pozole mediano | $90 |
| Pozole grande | $100 |
| Pozole para llevar, medio litro | $80 |
| Pozole para llevar, un litro | $100 |
| Pozole para llevar en bote | desde $150, en múltiplos de $50 (hasta $600) |
| Tostada extra | $3 |
| Caldo extra, medio litro | $20 |
| Caldo extra, un litro | $30 |

Todos los pozoles piden la **carne** (una o varias): pierna, lengua, pata, oreja, trompa, hueso o surtido. **Extras** opcionales: hueso extra +$20 y pata extra +$20. El bote pide además el **monto** ($150, $200, … $600).

## Antojitos

| Categoría | Producto | Opciones | Precio |
|---|---|---|---:|
| Tacos dorados | Taco dorado enrollado | Papa, frijol, rajas, requesón o picadillo | $10 |
| Tacos dorados | Taco dorado de carne, combinado o chicharrón | Carne, combinado o chicharrón | $15 |
| Flautas | Flauta | Carne, papa, frijol, requesón, rajas o picadillo | $25 |
| Enchiladas | Orden de 4 enchiladas | Queso, queso con cebolla o carne | $70 |
| Enchiladas | Enchilada por pieza | Queso, queso con cebolla o carne | $20 |
| Tostadas | Tostada | Pierna, pata, carne de cabeza, lengua, cuerito, trompa u oreja en vinagre | $35 |
| Tostadas | Tostada sencilla | — | $20 |
| Sopes y gorditas | Sope | Papa, frijol, rajas, requesón, picadillo, carne o chicharrón | $25 |
| Sopes y gorditas | Gordita sencilla | — | $15 |
| Quesadillas | Quesadilla | Sencilla, carne, rajas, papa, frijol, picadillo o chicharrón | $35 |

## Platillos del día (temporada)

El administrador puede cambiar nombre y precio, marcar "Hoy sí / Hoy no" y agregar platillos nuevos desde el POS (botón **Editar platillos** en la categoría). Recargar el catálogo (`pnpm pilot:catalog`) no revierte esos cambios.

| Platillo | Precio inicial |
|---|---:|
| Chile en nogada | $220 |
| Pechuga rellena con crema de champiñones | $150 |
| Caldo de res | $120 |
| Espinazo | $100 |
| Enmoladas de arrachera | $100 |
| Costillas normales | $100 |
| Costillas BBQ | $180 |
| Mole | $100 |
| Pipián | $100 |
| Huarache | $100 |
| Birria (chivo o res) | $120 |

## Tortas y tacos

| Producto | Opciones | Precio |
|---|---|---:|
| Torta | Carnitas, buche o combinada | $60 |
| Torta de lengua | Lengua o combinada con lengua | $65 |
| Taco sencillo | Papa o frijol | $10 |
| Taco con carne | Carnitas, buche o combinado | $30 |
| Taco de lengua | — | $35 |
| Taco blandito | Carnitas, buche o combinado | $30 |

## Paquetes

| Paquete | Incluye | Precio |
|---|---|---:|
| Paquete 1 | 1 torta sencilla (carnitas, buche o combinada) y 2 tacos sencillos (papa o frijol) | $75 |
| Paquete 2 | Paquete 1 más 1 litro de agua fresca (sabor a elegir) | $110 |
| Paquete 3 | 5 tortas sencillas (hasta 3 carnes; el reparto va en la nota) | $290 |
| Paquete 4 | 5 tortas sencillas y 5 tacos dorados sencillos (papa o frijol) | $340 |
| Paquete 5 | 1 torta sencilla y 2 tacos dorados con carne o combinados | $100 |

## Postres y bebidas

| Producto | Opciones | Precio |
|---|---|---:|
| Jericalla chica | — | $25 |
| Jericalla grande | — | $35 |
| Gelatina de galleta | — | $45 |
| Agua fresca 1 litro | Mango, ciruela, guayaba, guanábana, lima, arroz, tamarindo, jamaica, piña, tropical o taro | $40 |
| Refresco 355 ml | Pepsi, Mirinda, Seven Up, Manzana, Sangría, Jarritos (mandarina, tamarindo, tutifruti, piña), Coca-Cola, Sprite, Fresca, Sidral Mundet o Fanta | $30 |
| Coca-Cola taparrosca | Original, Zero o Light | $35 |
| Coca-Cola 1.25 litros | — | $45 |
| Agua mineral chica | — | $35 |
| Agua mineral grande | — | $45 |
| Jugo | Durazno o manzana | $35 |
| Cerveza | Clara u obscura | $40 |

## Captura en el POS

- Al tocar un producto con opciones se abre el armador de la categoría: se pueden combinar variantes (por ejemplo, 2 tostadas de pierna y 1 sencilla), cada una con su propia cantidad, opciones y observaciones. Cada variante llega a cocina como un artículo independiente.
- Observaciones rápidas: **Sin lácteos**, **Sin salsa** y **Sin cebolla**, además de la nota libre. También aparecen en el botón **+ Nota** de cada artículo.

## Reglas de carga

- Al aplicar el catálogo, los productos anteriores se desactivan; no se borran las ventas ni las comandas históricas.
- Los productos de categorías de temporada no se desactivan ni se sobrescriben al recargar.
- Los cambios de precio de temporada conservan el precio anterior inactivo y quedan en la bitácora de auditoría.
- La tostada extra y el caldo extra se manejan como productos para permitir cualquier cantidad.
