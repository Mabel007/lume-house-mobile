# Lumé House mobile

Expo SDK 57 / React Native / TypeScript / Expo Router app for the existing Lumé House Supabase project. Public browsing, explicit variants/availability, native Google PKCE, persistent sessions and authenticated variant-aware Bag are implemented. Web and mobile share the same account-backed Bag through existing RPCs: mobile Refresh Bag or web reload reveals cross-device changes, not realtime.

## Historical HNG delivery

Owner-confirmed HNG Lesson Three submission completed October 9, 2026. Historical source checkpoint: `0aac0c5acb30debea49f133127a479ded8b8d834`. Submitted artifact: `application-bdc80ef4-8b59-449a-a6c0-ac561235f75a.apk`; demonstration: `2026-10-09 09-36-49.mp4`. Preserve these as historical evidence. Later source changes do not update an installed APK.

Owner-reported physical development launch and production/shared Bag synchronization are historical human evidence. Local typecheck/lint/auth and mocked Bag checks establish source validation. HNG grading and independent complete standalone no-Metro acceptance, current Samsung rendering/TalkBack/performance, signing/provenance and regression against the submitted APK remain separately unverified. Local tests do not certify live OAuth, hosted RLS or Android acceptance.

## Development

For a fresh checkout, run `npm ci` only when dependency installation is approved. Production `.env.local` remains preserved but must not be used for Development or Staging. Expo public values embed in bundles. Never include server/service-role, Google/Resend credentials or signing secrets.

Use the installed native development client for Google login. Expo Go and Expo Web Google login are deliberately unsupported. Serve updated JavaScript with:

```powershell
node scripts/start-development.cjs --check
# After approved NONPROD setup and installation of a separate .dev client:
adb devices -l
adb -s <authorized-device-serial> reverse tcp:8081 tcp:8081
node scripts/start-development.cjs
```

The controlled launcher uses only ignored `.env.development.local`, allowing exactly `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. It removes inherited public settings, sets APP_VARIANT=development, disables automatic dotenv loading and serves the installed Expo CLI on localhost:8081. It currently refuses launch because the approved NONPROD reference is unset. Do not enter an arbitrary project reference or bypass the launcher with production `.env.local`. `--check` never starts Metro. Open the separately installed Lumé House Dev client using its launcher and localhost:8081 after USB reverse; physical acceptance is pending. The old production-package development APK cannot supply the new independent identity.

Metro must be reachable from the phone. Launch/sign-in/restoration can load the Bag; `load_variant_cart()` can create/promote server state. Do not run authenticated runtime acceptance under a strict no-hosted-writes audit. No server/device action is implied by these instructions.

```powershell
npm run typecheck
$env:APP_VARIANT='production'
$env:EXPO_NO_DOTENV='1'
npm run lint -- --no-cache
node tests/auth-contract.cjs
node --test tests/bag-contract.cjs tests/product-image-contract.cjs tests/product-media-fallback.cjs
```

Auth checks simulate callback/browser/crypto. Bag has17 mocked contracts; media tests simulate source/JSX/errors, not actual image decoding. Include later approved test files as features land.

## Android build distinction

Package `com.najbuilds.lumehouse`, scheme `lumehousemobile`; EAS project is already associated. Owner historically verified native Supabase base/optional sb_flow_id redirects while preserving web redirects. Do not repeat stale initialization or change Auth settings. iOS delivery remains unverified.

- `development`: Lumé House Dev / com.najbuilds.lumehouse.dev / lumehousemobile-dev; EAS development environment; internal development APK using Metro and approved NONPROD.
- `staging`: Lumé House Staging / com.najbuilds.lumehouse.staging / lumehousemobile-staging; EAS preview environment; internal standalone APK using the same approved NONPROD, without Metro.
- `production`: Lumé House / com.najbuilds.lumehouse / lumehousemobile; EAS production environment; store Android App Bundle preparation, not an approved public release.
- Historical `preview`: remains production identity/backend/EAS production environment and internal standalone APK. It is not staging and was not repurposed. Embedded JavaScript/assets need no Metro; backend/media need internet.

All profiles explicitly set APP_VARIANT and disable dotenv. Missing/unknown selectors are refused by dynamic configuration. The existing Expo project association, production identity and static app.json fields remain preserved. Backend/callback guards run before client creation/session restoration; NONPROD remains unapproved/unconfigured. EAS environment variables must be configured separately, public-only for the two client settings. No EAS console/build/update/credentials action is implied here. New identities/schemes need separately approved native builds; JavaScript cannot change installed package identity. Generated ignored native folders must not be reused to build a different package without an approved CNG/build workflow.

Read-only environment preflight (no Supabase client, session, network, Metro or build):

```powershell
$env:APP_VARIANT='production'
node scripts/environment-preflight.cjs --profile production --env-file .env.local
# After separately approved NONPROD configuration:
$env:APP_VARIANT='development'
node scripts/environment-preflight.cjs --profile development --env-file .env.development.local
$env:APP_VARIANT='staging'
node scripts/environment-preflight.cjs --profile staging --env-file .env.staging.local
```

Preflight checks resolved name/package/scheme, Expo association, backend reference and profile/distribution compatibility, and prints only safe identifiers. Missing/wrong configuration exits nonzero. Environment files must contain only the two public client settings. Development/Staging are expected to refuse until the approved NONPROD registry entry is provisioned. A passing preflight does not verify hosted configuration, publishable-key ownership, credentials, native runtime or physical QA.

After separate build approval and private verification of both existing public variables in EAS production, the standalone command is:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

This uses EAS cloud, not local Gradle. Ignored `.env.local` is not automatically uploaded. Older missing-EAS-variable evidence is historical, not a current failure diagnosis. Never rebuild/replace the submitted APK for source-only work. Verify signing compatibility before installation; do not automatically uninstall or change package identity.

## Data and safeguards

### Approved existing local Docker backend

Development can also use the existing Lumé House Docker gateway at exactly `http://127.0.0.1:54321`. Its public key is approved by a source-controlled SHA-256 fingerprint; key values remain in ignored configuration only. Node build configuration validates the fingerprint, then binds the runtime's public key to the approved manifest. Production stays pinned and Staging cannot use this local gateway. Local Development uses a separate Auth storage namespace; production's existing namespace is unchanged. Do not print raw local Expo config: the manifest contains the same public key already embedded by Expo. Use the safe environment preflight instead.

Populate ignored `.env.development.local` with only the two local public settings from the existing local stack through approved secure handling. Do not copy production `.env.local`. Key rotation requires an inspected, approved fingerprint update. The launcher still refuses missing/wrong keys and unknown gateways; no arbitrary URL override exists.

After separate device/Metro approval, reverse BOTH ports for the selected authorized Samsung: `adb -s <serial> reverse tcp:8081 tcp:8081` and `adb -s <serial> reverse tcp:54321 tcp:54321`. Then run the controlled launcher. On Android, loopback reaches the phone unless the USB reverse exists; do not substitute a LAN address or open firewall ports. Debug-client cleartext access, installed .dev identity and callbacks require physical acceptance. Local Google provider/native redirects are not currently configured; do not substitute production OAuth. Existing local web synthetic fixture login is not a mobile login screen. No local mobile OAuth/device acceptance is implied by configuration support.

Existing Supabase is authoritative; web owns backend migrations/admin. Active products/variants use real IDs and integer NLE minor units displayed NLe. Images resolve against `https://lume-house-delta.vercel.app` or safe credential-free HTTPS, supporting reviewed WebP/PNG/JPG/JPEG/SVG and nested paths. Missing/invalid/load-failed images use per-product accessible fallback without relaxing commerce validation.

Native singleton Auth uses PKCE and unencrypted AsyncStorage with AppState refresh; local sign-out preserves independent web sessions. Preserve owner isolation, mutation UUID reuse and expected-quantity conflicts. Guest Bag, mobile checkout/profile/order features and admin duplication are not implied by the historical HNG scope.

Reports stay local under ignored `.codex/`. Environment/signing/credentials/APK/AAB/recordings stay outside Git. `.env.example`, `app.json`, `eas.json` and legitimate JSON remain trackable. Ignore rules do not remove already tracked files or replace exact staged-file inspection.
