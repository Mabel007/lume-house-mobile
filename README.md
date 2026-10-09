# Lumé House mobile

Expo SDK 57 / React Native / TypeScript / Expo Router app for the existing Lumé House Supabase project. Public browsing, explicit variants/availability, native Google PKCE, persistent sessions and authenticated variant-aware Bag are implemented. Web and mobile share the same account-backed Bag through existing RPCs: mobile Refresh Bag or web reload reveals cross-device changes, not realtime.

## Historical HNG delivery

Owner-confirmed HNG Lesson Three submission completed October 9, 2026. Historical source checkpoint: `0aac0c5acb30debea49f133127a479ded8b8d834`. Submitted artifact: `application-bdc80ef4-8b59-449a-a6c0-ac561235f75a.apk`; demonstration: `2026-10-09 09-36-49.mp4`. Preserve these as historical evidence. Later source changes do not update an installed APK.

Owner-reported physical development launch and production/shared Bag synchronization are historical human evidence. Local typecheck/lint/auth and mocked Bag checks establish source validation. HNG grading and independent complete standalone no-Metro acceptance, current Samsung rendering/TalkBack/performance, signing/provenance and regression against the submitted APK remain separately unverified. Local tests do not certify live OAuth, hosted RLS or Android acceptance.

## Development

For a fresh checkout, run `npm ci` only when dependency installation is approved. Copy `.env.example` to ignored `.env.local`; supply only the existing project's public Supabase URL and publishable key. Expo public values embed in bundles. Never include server/service-role, Google/Resend credentials or signing secrets.

Use the installed native development client for Google login. Expo Go and Expo Web Google login are deliberately unsupported. Serve updated JavaScript with:

```powershell
npm start -- --dev-client
```

Metro must be reachable from the phone. Launch/sign-in/restoration can load the Bag; `load_variant_cart()` can create/promote server state. Do not run authenticated runtime acceptance under a strict no-hosted-writes audit. No server/device action is implied by these instructions.

```powershell
npm run typecheck
npm run lint -- --no-cache
node tests/auth-contract.cjs
node --test tests/bag-contract.cjs tests/product-image-contract.cjs tests/product-media-fallback.cjs
```

Auth checks simulate callback/browser/crypto. Bag has17 mocked contracts; media tests simulate source/JSX/errors, not actual image decoding. Include later approved test files as features land.

## Android build distinction

Package `com.najbuilds.lumehouse`, scheme `lumehousemobile`; EAS project is already associated. Owner historically verified native Supabase base/optional sb_flow_id redirects while preserving web redirects. Do not repeat stale initialization or change Auth settings. iOS delivery remains unverified.

- `development`: internal development client, Metro-served current JavaScript.
- `preview`: internal non-development standalone APK using production EAS environment; embedded JavaScript/assets need no Metro, but backend/media still need internet.

After separate build approval and private verification of both existing public variables in EAS production, the standalone command is:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

This uses EAS cloud, not local Gradle. Ignored `.env.local` is not automatically uploaded. Older missing-EAS-variable evidence is historical, not a current failure diagnosis. Never rebuild/replace the submitted APK for source-only work. Verify signing compatibility before installation; do not automatically uninstall or change package identity.

## Data and safeguards

Existing Supabase is authoritative; web owns backend migrations/admin. Active products/variants use real IDs and integer NLE minor units displayed NLe. Images resolve against `https://lume-house-delta.vercel.app` or safe credential-free HTTPS, supporting reviewed WebP/PNG/JPG/JPEG/SVG and nested paths. Missing/invalid/load-failed images use per-product accessible fallback without relaxing commerce validation.

Native singleton Auth uses PKCE and unencrypted AsyncStorage with AppState refresh; local sign-out preserves independent web sessions. Preserve owner isolation, mutation UUID reuse and expected-quantity conflicts. Guest Bag, mobile checkout/profile/order features and admin duplication are not implied by the historical HNG scope.

Reports stay local under ignored `.codex/`. Environment/signing/credentials/APK/AAB/recordings stay outside Git. `.env.example`, `app.json`, `eas.json` and legitimate JSON remain trackable. Ignore rules do not remove already tracked files or replace exact staged-file inspection.
