# Lumé House mobile

Native catalogue and Google authentication for the existing Lumé House Supabase backend. Expo Router + TypeScript. Public browsing remains available while signed out.

Run `npm ci`, copy `.env.example` to `.env.local`, and supply only the existing Supabase project URL and publishable public key. Expo public values are embedded in the app. Never add server credentials. Run `npm start` with compatible Expo Go or a development build. Validate using `npm run typecheck` and `npm run lint`.

Products mirror the web repository contract: active rows ordered by display_order then id; price_cents stores integer NLE minor units. Images resolve against https://lume-house-delta.vercel.app. Backend migrations remain owned by the web repository.

Native Auth uses the existing singleton, AsyncStorage (unencrypted app storage), PKCE and AuthProvider-owned AppState refresh. The owner has manually added and visually verified `lumehousemobile://auth/callback` and `lumehousemobile://auth/callback?sb_flow_id=*` in the existing Supabase redirect allowlist, preserving web redirects and the production Site URL. Google continues to redirect to Supabase, not directly to the app. No Google secret belongs in this project. Physical-device OAuth remains unverified.

Google sign-in requires an installed native build with the configured scheme; Expo Go and Expo Web sign-in are intentionally unsupported. Android package is `com.najbuilds.lumehouse`; scheme remains `lumehousemobile`. SDK-compatible expo-dev-client is installed and eas.json contains the internal development profile. iOS identifiers are deferred.

Owner's next steps (not executed): `npx eas-cli@latest login`, then `npx eas-cli@latest init` to associate the intended Expo account/project, and `npx eas-cli@latest build:configure --platform android`. Preserve the minimal development profile if configuration offers extra defaults. When ready to upload/build, run `npx eas-cli@latest build --platform android --profile development`, download/install the APK from its build page on the physical Android phone, then run `npx expo start --dev-client` and open the Metro QR in that development client. Project ownership/linking and any EAS-managed signing prompts require owner interaction; no credentials have been created here.

For this Metro-connected development build, keep only the existing public Supabase URL and publishable key in ignored `.env.local` on the computer running Metro. Expo CLI inlines them into the served JavaScript bundle. The cloud build creates the native development client; current app.json does not consume Supabase environment values. No EAS environment variables or secrets are needed for this local Metro strategy. Ignored `.env.local` is not automatically uploaded; future self-contained release bundles will need a separately configured public build environment. Never add service-role keys, Google/Resend secrets or database credentials to public environment variables or eas.json.

Run focused offline auth contracts with `node tests/auth-contract.cjs`. They cover rejection/cancellation and callback parsing, and do not establish successful OAuth evidence. Logout revokes the local mobile session; independent web sessions remain signed in. Cart work is outside this phase.
