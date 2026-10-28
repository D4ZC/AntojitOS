import type { Product } from "@antojit-os/domain";

export const categories = [
  { id: "favorites", label: "Favoritos", emoji: "★" },
  { id: "Tacos", label: "Tacos", emoji: "🌮" },
  { id: "Antojitos", label: "Antojitos", emoji: "🫓" },
  { id: "Bebidas", label: "Bebidas", emoji: "🥤" },
  { id: "Postres", label: "Postres", emoji: "🍮" },
  { id: "Chamorros", label: "Chamorros", emoji: "🍖" },
  { id: "Extras", label: "Extras", emoji: "🫓" },
] as const;

export const products: Product[] = [
  { id: "taco-pastor", name: "Taco al pastor", category: "Tacos", priceInCents: 2200, color: "coral", emoji: "🌮" },
  { id: "taco-asada", name: "Taco de asada", category: "Tacos", priceInCents: 2600, color: "amber", emoji: "🌮" },
  { id: "taco-campechano", name: "Taco campechano", category: "Tacos", priceInCents: 2800, color: "clay", emoji: "🌮" },
  { id: "quesadilla", name: "Quesadilla", category: "Antojitos", priceInCents: 4200, color: "sun", emoji: "🫓" },
  { id: "gringa", name: "Gringa al pastor", category: "Antojitos", priceInCents: 6200, color: "peach", emoji: "🧀" },
  { id: "sope", name: "Sope especial", category: "Antojitos", priceInCents: 4800, color: "sage", emoji: "🥙" },
  { id: "enchiladas-combinadas", name: "Enchiladas combinadas (2 carne, 2 queso)", category: "Antojitos", priceInCents: 7000, color: "clay", emoji: "🫔" },
  { id: "agua-horchata", name: "Agua de horchata", category: "Bebidas", priceInCents: 3500, color: "cream", emoji: "🥛" },
  { id: "agua-jamaica", name: "Agua de jamaica", category: "Bebidas", priceInCents: 3500, color: "berry", emoji: "🥤" },
  { id: "refresco", name: "Refresco", category: "Bebidas", priceInCents: 3800, color: "mint", emoji: "🧊" },
  { id: "flan", name: "Flan de la casa", category: "Postres", priceInCents: 5200, color: "honey", emoji: "🍮" },
  { id: "agua-fresca-medio-litro", name: "Agua fresca 1/2 litro", category: "Bebidas", priceInCents: 2500, color: "sage", emoji: "🥤" },
  { id: "chamorro-medio", name: "1/2 chamorro", category: "Chamorros", priceInCents: 10000, color: "clay", emoji: "🍖" },
  { id: "chamorro-completo", name: "1 Chamorro completo", category: "Chamorros", priceInCents: 17000, color: "amber", emoji: "🍖" },
  { id: "tostada-extra", name: "Pieza tostada", category: "Extras", priceInCents: 300, color: "cream", emoji: "🫓" },
  { id: "pata-extra", name: "Pata", category: "Extras", priceInCents: 2000, color: "clay", emoji: "🍖" },
  { id: "frijoles-adobados", name: "Frijoles Adobados", category: "Extras", priceInCents: 3000, color: "honey", emoji: "🥣" },
  { id: "arroz-porcion", name: "Arroz porción", category: "Extras", priceInCents: 3000, color: "sun", emoji: "🍚" },
  { id: "tortillas-extra", name: "Tortillas", category: "Extras", priceInCents: 500, color: "cream", emoji: "🫓" },
];

export const favoriteProductIds = new Set([
  "taco-pastor",
  "taco-asada",
  "quesadilla",
  "agua-horchata",
  "refresco",
  "flan",
]);
