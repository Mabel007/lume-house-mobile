import type { ProductVariant } from './variants';

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  color: string;
  description: string;
  variants?: readonly ProductVariant[];
};

// Validate the network boundary; never silently turn malformed prices into zero.
export function parseProducts(data: unknown, currency: string): Product[] {
  if (!Array.isArray(data)) throw new Error("Invalid product response");
  const ids = new Set<string>();
  return data.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid product");
    const row = value as Record<string, unknown>;
    for (const field of [
      "id",
      "name",
      "description",
      "category",
      "image_path",
      "background_color",
    ]) {
      if (typeof row[field] !== "string" || !(row[field] as string).trim()) {
        throw new Error("Invalid product fields");
      }
    }
    if (
      typeof row.price_cents !== "number" ||
      !Number.isSafeInteger(row.price_cents) ||
      row.price_cents < 0 ||
      row.currency !== currency ||
      row.active !== true
    ) {
      throw new Error("Invalid product pricing or availability");
    }
    const id = row.id as string;
    if (ids.has(id)) throw new Error("Duplicate product");
    ids.add(id);
    const image = row.image_path as string;
    const isLocal = image.startsWith("/images/") && !image.includes("\\");
    let isHttps = false;
    try {
      const url = new URL(image);
      isHttps = url.protocol === "https:" && !url.username && !url.password;
    } catch {
      /* Relative image paths are validated above. */
    }
    if (
      (!isLocal && !isHttps) ||
      !/^#[0-9a-fA-F]{6}$/.test(row.background_color as string)
    ) {
      throw new Error("Invalid product presentation");
    }
    return {
      id,
      name: row.name as string,
      description: row.description as string,
      category: row.category as string,
      price: row.price_cents,
      image,
      color: row.background_color as string,
    };
  });
}
