export type AppVariant = 'development' | 'staging' | 'production';
export type EnvironmentIdentity = {
  variant: AppVariant; name: string; androidPackage: string; scheme: string; callback: string;
};
export type EnvironmentInput = {
  variant: unknown; androidPackage: unknown; scheme: unknown; callback: unknown; url: unknown; key: unknown;
  localBackend?: { origin?: unknown; projectRef?: unknown; publicKey?: unknown };
};
export const productionProjectRef: string;
export const approvedNonprodProjectRef: string | null;
export function identityFor(variant: unknown): EnvironmentIdentity;
export function validateEnvironment(input: EnvironmentInput, trustedNonprodRef?: string | null): EnvironmentIdentity & {
  projectRef: string; url: string; key: string; storageKey?: string;
};
