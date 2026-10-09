import type { Product } from './products';

// Same pure text matching contract as the web catalogue; no additional query.
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
export function productCategories(products: readonly Product[]): string[] {
  return [...new Set(products.map(product => product.category))].sort((a, b) => a.localeCompare(b, 'en'));
}
export function filterProducts(products: readonly Product[], query: string, category: string | null): Product[] {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return products.filter(product => (category === null || product.category === category) &&
    terms.every(term => normalize(`${product.name} ${product.category} ${product.description}`).includes(term)));
}
