# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

`MediCue` is a hospital appointment-booking system. The top-level folder is not itself a git repo; `Backend/` is (single "Initial commit"). `Backend/` is the AWS CDK (TypeScript) backend. `Frontend/` is a React 19 + Vite + Tailwind v4 app (Figma Make project, see `Frontend/README.md`); `Design MediCue Frontend/` is an untouched Figma export copy of an older version — don't edit it.

## Frontend ↔ backend contract

`Frontend/src/api/` is the only part of the frontend that knows the HTTP contract (typed calls in `api/endpoints.ts`). `call()` (`api/client.ts`) sends the exact requests of `Backend/lib/api-stack.ts`; `VITE_API_URL` is required (there is no in-browser mock). When you add or change a backend route or payload, update `api/endpoints.ts` in the same change. `Backend/test/stacks.test.ts` ("frontend contract") fails if a route the frontend calls is missing on the API or a backend route is unused by the frontend. Reviews, reports, profile editing, account/hospital deletion and doctor removal exist on both sides (`update-profile`, `report-user`, `reported-users`, `delete-user`, `delete-hospital`, `remove-doctor`, `create-review`, `doctor-reviews`, `my-reviews`); the cascading removals live in `lambda/lib/cleanup.ts` and never touch medical notes. Frontend layout (`api/`, `components/ui`, `features/<area>/`, `state/`, `lib/`) and conventions are in `Frontend/AGENTS.md`; keep every frontend file under 500 lines.

**Passwords and tokens.** The browser never sends a raw password: `Frontend/src/api/passwordHash.ts` derives `Mc1!` + 64 hex (PBKDF2-SHA256, salt = email) inside `api/endpoints.ts`, and `requirePasswordHash` (`lambda/lib/validation.ts`) makes signup, register, new-password and reset-password refuse anything else. Only an invitation's server-generated temporary password goes to `login` as is (`api.login(..., true)`). `login`/`new-password` return the `idToken` only in the body and set the refresh token as an `HttpOnly; Secure; SameSite=None` cookie (`mc_rt`, path `/<stage>/auth`) whose value is encrypted (AES-256-GCM, `lambda/lib/cookie-seal.ts`) with the key in the Secrets Manager secret `medicue/cookie-key` (rotate via `previousKey`); `POST /auth/refresh` (cookie → new `idToken`, 200 with `{}` when there is no session) and `POST /auth/logout` (revokes + clears) are served by `auth-session`. The frontend keeps the ID token in memory, renews it on page load and on a 401, and sends `credentials: 'include'`. Cookies need a real origin list: deploy with `-c allowedOrigin=https://frontend[,http://localhost:5173]`, not `*`. and `/users/me` omits the caller's own `userId` (the frontend fills `''`). Password strength is checked in the browser (`passwordProblem`) because the server only sees the hash.

## Commands (run from `Backend/`)

- `npm run build` — type-check only (`tsc`, `noEmit: true`)
- `npm test` — Jest (via `@swc/jest`); tests are discovered as `test/**/*.test.ts` (`lib.test.ts` for helpers, `stacks.test.ts` for CDK assertions — IAM, CORS, tables — with bundling skipped via `aws:cdk:bundling-stacks: []`; a full run takes ~2 min)
- Single test: `npx jest test/<file>.test.ts` or `npx jest -t "<name>"`
- `npx cdk synth` / `npx cdk diff` / `npx cdk deploy --all` — `cdk.json` runs `npx tsc && npx tsx bin/backend.ts`, so type errors block synth
- `cdk.out/` and `*.js`/`*.d.ts` are gitignored build output; don't edit them

## Architecture

Two CDK stacks, wired in `bin/backend.ts`:

- `DataStack` ([lib/data-stack.ts](Backend/lib/data-stack.ts)) — DynamoDB tables (all PAY_PER_REQUEST) and a private S3 bucket. Tables are passed to `ApiStack` as props; adding a table means editing the stack, `ApiStackProps`, and `bin/backend.ts`.
- `ApiStack` ([lib/api-stack.ts](Backend/lib/api-stack.ts)) — Cognito user pool, EventBridge bus, SQS queue + DLQ, every Lambda, scheduled rules, and the REST API Gateway routes.

### Lambdas

The API runs on **11 Lambdas** (hard cap: 20; `stacks.test.ts` enforces it), one per area: `auth`, `hospitals` (+ stats), `team` (doctors, staff, bulk invitations), `users` (profile, reports, directory, notifications), `removals`, `availability`, `appointments` (+ waitlist), `reviews`, `medical-notes`, `scheduled-jobs` (five EventBridge rules, each passing `{ job }`), and `notification-worker` (SQS). Each area is one file, `Backend/lambda/<area>.ts`: its endpoint handlers are exported consts (`bookAppointment`, `suspendUser`, ... which tests import directly) followed by a table `'METHOD /resource': handler` (`lambda/lib/router.ts`) as `handler`. There is no file per endpoint. Each Lambda is created in `api-stack.ts` with the env vars its handlers read from `process.env` (`USERS_TABLE_NAME`, `EVENT_BUS_NAME`, ...) and the union of its handlers' IAM grants. Handlers are wrapped in `withErrorHandling` (`lambda/lib/http.ts`): they parse/validate input with `parseBody` and `lambda/lib/validation.ts`, identify the caller via `callerId(event)` (`claims.sub`), throw `HttpError` for 4xx, and return `respond(status, body)` (adds CORS headers). Functions are created through the `createFunction` helper in `api-stack.ts` (timeout, memory, ARM64, log group, `ALLOWED_ORIGIN`). Adding an endpoint requires: a handler const in its area's file plus an entry in that file's router table, any new env vars and `grant*` calls on that area's `createFunction` (grant only what the area needs), and a `route(...)` line in `api-stack.ts`; `stacks.test.ts` fails if a route and a router entry do not match. Authenticated routes pass `cognitoAuth`; signup/login/new-password/browse/approved-hospitals/register are public.

Shared helpers live in `lambda/lib/`: `http`, `validation`, `db` (DynamoDB client with `removeUndefinedValues`, `queryAll`, role/hospital guards), `guards` (`requireAnyRole`), `scheduling` (doctor conflict check), `waitlist` (`releaseSlot`), `notify`, `constants`, `cognito`, `accounts` (invite an account), `bulk` (validate a spreadsheet row), `stats`, `cleanup`, `profile`.

The API stack is well below CloudFormation's 500 resources (it was at about 455 before the Lambdas were merged) (`allowTestInvoke: false` on every integration saves one permission per route); `stacks.test.ts` fails at 485. Before adding more routes, split the API into two stacks.

Accounts somebody else creates (doctors, `STAFF`, and patients from a bulk import) all go through `inviteAccount` in `lambda/lib/accounts.ts` (`add-doctor`, `add-staff`, `bulk-create-users`): Cognito emails a link `<appUrl>/#/first-login?email=…&tp=…` with a generated temporary password, and first login goes `login` → `NEW_PASSWORD_REQUIRED` challenge → `new-password`. Roles are `PATIENT`, `DOCTOR`, `STAFF` (hospital reception, has `hospitalId`), `HOSPITAL_ADMIN`, `PLATFORM_ADMIN`. A suspended account (`suspend-user`: Cognito disabled + `suspended` on the users row) is refused by `getUser` in `lambda/lib/db.ts`; admin tools that must still see it pass `includeSuspended`. Password recovery is public (`forgot-password` answers the same for unknown accounts, `reset-password` confirms the emailed code). The users table has a `role-index` (platform admin directory, a hospital's staff).

### Booking flow and concurrency

Slots (`availabilityTable`, keyed `hospitalId`+`slotId`) move through statuses such as `APPROVED` → `BOOKED`. Booking uses a DynamoDB `TransactWriteCommand` with a conditional update (`status = APPROVED`) plus creating an appointment in `PENDING_PAYMENT`; a failed condition means someone else took the slot (409). After payment an appointment is `CONFIRMED`; when the patient arrives hospital staff or the hospital admin call `check-in-appointment` (→ `ARRIVED`, from 2 hours before the start), and the doctor ends the consultation with `complete-appointment` (`ARRIVED` → `COMPLETED`; only then can notes be written and a review left). `mark-missed-appointments` turns `CONFIRMED` sessions nobody checked in into `MISSED`. A patient can add a private note (`note`, at most 500 characters) when booking a **specialist** appointment; `my-appointments` returns it only to that patient and their doctor, never to hospital admins or staff, and `reschedule-appointment` carries it over. `complete-appointment` also emails the patient an invitation to review the doctor (`SESSION_COMPLETED`). `hospital-stats` counts a hospital's appointments per status and day for the admin's charts. Payment holds expire via a 1‑minute scheduled Lambda (`release-expired-payment-holds`), which frees the slot and feeds the waitlist.

Every path that frees a `BOOKED`/`OFFERED` slot (cancel, reschedule, payment failure, both expiry jobs) goes through `releaseSlot` in `lambda/lib/waitlist.ts`: one conditional transaction that combines the caller's own writes with either offering the slot to the next waiting patient (`OFFERED`) or returning it to `APPROVED`. Never set a slot to `APPROVED` and offer it in two steps — that reopens a race. Fees come from the slot's `consultationType`, never from the request. Hospitals must be `APPROVED` before they can add doctors, propose slots or appear in browse.

The appointments table uses a composite key (`appointmentId` + `itemType`): `METADATA` items carry `status`/`startTime` and are the only ones in the sparse `status-index` GSI (used by reminder and expiry checks); other item types (e.g. `PAYMENT`) are excluded from it. The waitlist table's `status-index` is sparse the same way (only `OFFERED` entries have `offerExpiresAt`). Preserve this when changing item shapes.

### Notifications pipeline

Handlers don't send email/SMS directly. `sendNotification` (`lambda/lib/notify.ts`) writes a `PENDING` row to the notifications table and publishes to EventBridge (`source: medicue.notifications`); a rule forwards to the SQS queue, and `notification-worker` (batch size 1, DLQ after 3 receives) delivers via SES/SNS. Any Lambda that calls `sendNotification` needs `EVENT_BUS_NAME`, `grantPutEventsTo`, and notifications-table write access. Reminders are scheduled Lambdas (`check-email-reminders` hourly, `check-sms-reminders` every 5 min). Sender address comes from the `SES_FROM_ADDRESS` env var at synth time.

### Access control

Medical notes are deliberately isolated: only the `medical-notes` Lambda (`record-medical-note` and `get-medical-notes`) is granted the `medicalNotesTable`; every other Lambda is labeled "no medical notes access" in `api-stack.ts` and must stay that way. Role checks (hospital admin / doctor / patient) are done in handler code by reading the `users` table, not by Cognito groups.
