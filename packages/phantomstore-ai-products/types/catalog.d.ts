export type AiProductDefinition = {
  id: string;
  name: string;
  category: string;
  accent: string;
  tagline: string;
  promise: string;
  primaryModule: string;
  objectType: string;
  artifactLabel: string;
  modules: string[];
  fields: Array<{ id: string; label: string; type: string; help?: string; options?: string[]; required: boolean }>;
  sample: Record<string, string>;
  [key: string]: unknown;
};

export const PRODUCTS: readonly AiProductDefinition[];
export const PRODUCT_IDS: readonly string[];
export function productById(id: string): AiProductDefinition | null;
export function publicProduct(product: AiProductDefinition): AiProductDefinition;
