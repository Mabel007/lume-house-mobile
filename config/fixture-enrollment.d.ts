export const nativeIdentity: Readonly<{ variant: 'development'; androidPackage: string; callback: string; origin: string }>;
export const customerAliases: readonly string[];
export const helperOrigin: string;
export function requireNativeEnrollment(input: { variant: string; androidPackage: string; callback: string; origin: string; alias: string }): void;
