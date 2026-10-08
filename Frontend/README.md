# MediCue Frontend

React 19 + Vite + Tailwind v4 (a Figma Make project). It talks to the AWS backend in `../Backend`.

## Run

```
pnpm install
pnpm dev            # mock API, no backend needed (demo accounts on the sign-in screen)
pnpm typecheck      # strict TypeScript, unused code is an error
pnpm build
pnpm format -- src  # Prettier
```

To use the real backend, deploy it, then copy `.env.example` to `.env.local` and set `VITE_API_URL` to the
`ApiUrl` stack output. CORS is enabled on the API; restrict it with `cdk deploy -c allowedOrigin=https://your-site`.

## Structure

```
src/
├── main.tsx · App.tsx           entry point; App chooses the sign-in screen or the shell
├── api/                         everything that talks to the backend
│   ├── endpoints.ts             typed api.* calls (the only API the screens use)
│   ├── client.ts · session.ts   HTTP client, bearer token, 401 handling
│   ├── types.ts · rules.ts      domain types; business rules mirrored from the backend
│   ├── config.ts · errors.ts    build flag (isMock) and ApiError
│   └── mock/                    in-browser backend: routes/ (one file per domain), db, seed, helpers, jobs
├── components/
│   ├── ui/                      design-system kit (Button, Card, Field, Modal, Badge ...)
│   └── ApiConsole · Toasts · ReportButton
├── features/                    one folder per product area
│   ├── auth/                    sign-in, patient sign-up, hospital registration, e-mail code, first-login password
│   ├── shell/                   sidebar, top bar, mobile nav, role -> page routing (nav.ts, views.tsx)
│   ├── patient/ · doctor/ · hospital-admin/ · platform-admin/
│   ├── appointments/            pieces shared by patients and doctors (payment, notes, reschedule)
│   └── notifications/ · profile/ · settings/
├── state/directory.ts           who is who: hospitals, doctors and the names the backend embeds in responses
└── lib/                         hooks, formatting, preferences, toasts, class-name helper
```

Rules of thumb: files stay under 500 lines; folders import each other through `@/…`; screens never call
`call()` directly, they add a function to `api/endpoints.ts`.

## How it matches the backend

`src/api` is the only place that knows the HTTP contract.

- `call()` sends the exact requests of `Backend/lib/api-stack.ts` (real API when `VITE_API_URL` is set).
- The in-browser **mock answers the same routes with the same request and response shapes**, so every screen is written once against the real contract. Only the prototype-only extras listed below differ.
- `Backend/test/stacks.test.ts` ("frontend contract") fails if a route the frontend calls does not exist on the API, or a backend route is not used by the frontend.

Rules the UI mirrors from the backend: fees (2000 general / 3000 specialist, set by the slot), 5-minute payment hold, 15-minute waitlist offer, 2-hour reschedule cutoff, 10/90-minute slot buffers, slots of at most 12 h, E.164 phone numbers, password policy (8+ chars, upper, lower, digit).

## Sign-in flows

- **Patient**: sign up, confirm the emailed 6-digit code, sign in.
- **Hospital admin**: register the hospital with a PDF (max 4 MB), confirm the admin email, sign in. The hospital must be approved by a platform admin before doctors or availability can be added; a banner shows its status.
- **Doctor**: created by a hospital admin. Cognito emails a link that opens the app with the email and temporary password filled in (`features/auth/InviteForm.tsx`); the doctor only chooses a new password and is signed in (`/auth/login` returns `NEW_PASSWORD_REQUIRED`, completed by `/auth/new-password`). The deployed backend needs `-c appUrl=<this site's URL>` so the link points here.
- **Platform admin**: created once with `Backend/scripts/create-platform-admin.ts`.

## Roles and flows

Patients book; **staff** (reception) and the hospital admin check patients in when they arrive (`ARRIVED`); the **doctor** completes the session. Hospital admins also see appointment statistics, manage staff and import accounts from Excel/CSV. The platform admin has an account directory (patients, doctors, staff, hospital admins) with suspend, reinstate and delete, and its own import. When booking a specialist appointment a patient can describe what they are coming in for; only they and the doctor see it. After a doctor completes a session the patient can review that doctor. Weekends are greyed out for specialist appointments but stay bookable for general consultations. "Forgot password?" on the sign-in form emails a code. `pnpm install` is needed once for `read-excel-file`.

## Photos

Profile photos are shrunk in the browser to a 256 px JPEG (`src/lib/image.ts`) and stored on the profile row, so the backend accepts about 100 KB at most.

## Hosting (AWS Amplify)

The repository root holds both apps; `amplify.yml` tells Amplify to build only `Frontend/` (Node 22, pnpm, `pnpm run build`, output `dist/`). Set these environment variables in the Amplify console, because `.env.local` is never committed:

- `VITE_API_URL`: the `ApiUrl` output of `cdk deploy` (ends in `/prod/`)
- `VITE_PAYMENT_SIMULATION`: `true` while the payment provider is the mock

After the first deploy, redeploy the backend with the site's address so invitation emails link to it and CORS is limited to it: `npx cdk deploy --all -c appUrl=https://<your-amplify-domain> -c allowedOrigin=https://<your-amplify-domain>` (run from `Backend/`, with `SES_FROM_ADDRESS` set; no trailing slash).
