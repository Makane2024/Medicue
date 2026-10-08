# MediCue Backend — Audit & Reference

Audit date: 2026-10-07 · Scope: everything in `Backend/` (CDK stacks, 24 Lambda handlers, shared helpers, config, tests).
Method: every source file was read in full; `npm run build`, `npm test` and `npx cdk synth` were run; IAM grants were cross-checked against what each handler actually calls.

---

## 1. Executive summary

**The foundation is good. The backend is not ready to use end to end yet.**

What is solid:

- The two-stack CDK layout (data and API), per-function least-privilege IAM, and the isolation of medical notes. Only `record-medical-note` (write) and `get-medical-notes` (read) can touch `medicalNotesTable`.
- Booking is concurrency-safe: it uses a DynamoDB transaction with a conditional update.
- The sparse-GSI design for expiry and reminders.
- Notification delivery is decoupled through EventBridge → SQS → worker, with a DLQ.

What blocks real use:

| # | Blocker | Where |
|---|---|---|
| 1 | **Appointment reminders can never be sent.** The two reminder Lambdas have no write grant on the notifications table, so `sendNotification` fails with `AccessDenied`. | `lib/api-stack.ts:88-118` |
| 2 | **Doctors can never log in.** `AdminCreateUser` leaves them in `FORCE_CHANGE_PASSWORD`. `login` returns `200 {}` and there is no endpoint to set the first password. | `lambda/login.ts`, `lambda/add-doctor.ts` |
| 3 | **Anyone can book a slot for free.** `process-payment` has no caller check, and the client chooses the outcome (`simulateOutcome`, default `SUCCESS`). That is fine for a mock but must not ship. | `lambda/process-payment.ts` |
| 4 | **A doctor can re-open a booked slot and cause a double booking.** `approve-slot` doesn't check the slot's current status or validate `decision`. | `lambda/approve-slot.ts` |
| 5 | **Hospital approval is never enforced.** A `PENDING` or `REJECTED` hospital can add doctors and publish bookable slots. | all hospital/slot handlers |
| 6 | **Waitlist offers can race into double bookings** and can leave slots stuck in `OFFERED` forever. | `lambda/lib/waitlist.ts` |
| 7 | **The core flows are not completable from an API client.** There are no "list my appointments / pending slots / doctors / specialties" endpoints, and the doctor is never told a slot awaits approval. | whole API |
| 8 | **No tests exist.** `npm test` exits 1. | `test/` (empty) |
| 9 | **None of the work is committed.** The git repo holds only the original CDK template commit. | `git status` |

Verification results:

| Check | Result |
|---|---|
| `npm run build` (tsc, strict) | **Pass**, no type errors |
| `npm test` | **Fail**: "No tests found" (exit 1). The `test/` directory is empty. The scaffold's `test/backend.test.ts` and `lib/backend-stack.ts` are deleted in the working tree. |
| `npx cdk synth` | **Pass** (details in §9) |
| Direct esbuild bundle of a handler | Pass (`register-hospital.ts` bundles to 1.9 MB) |

---

## 1b. Fix status (updated after the fixes were applied)

The sections below describe the code **as audited**. Most findings have since been fixed. This table shows the current state.

| Finding | Status | What changed |
|---|---|---|
| C1 reminder IAM | Fixed | Both reminder Lambdas now have notifications-table write access. A CDK test fails if any function that publishes notifications lacks it. |
| C2 doctor first login | Fixed | `login` returns a `NEW_PASSWORD_REQUIRED` challenge plus session. New public `POST /auth/new-password` completes it. Doctors keep the emailed temporary password. The invitation email text was customised. `login` also returns a refresh token now. |
| C3 payment | Partly fixed | Caller must own the appointment. The fee comes from the slot, never the client. `simulateOutcome` is limited to `SUCCESS`/`FAILED` and only works while `allowPaymentSimulation` is true (otherwise 501). **Still mock: a real payment provider and webhook are needed.** |
| C4 approve-slot | Fixed | `decision` is validated, and only `PENDING` slots can be decided (conditional write). |
| C5 hospital approval | Fixed | `add-doctor`, `propose-slot` and `browse` require an `APPROVED` hospital. |
| C6 waitlist races | Fixed | `releaseSlot` frees the slot and offers it to the next waiter in one conditional transaction (never publicly bookable in between). Used by cancel, reschedule, payment failure and both expiry jobs. |
| H1 conflict detection | Fixed | Counts `APPROVED`, `BOOKED` and `OFFERED`; query is bounded by time and paginated. Concurrent approvals of two *different* overlapping slots can still race (no per-doctor lock). |
| H2 payment vs expiry race | Fixed | Payment success and failure are conditional on `PENDING_PAYMENT` and on the slot still being `BOOKED`. |
| H3 waitlist fee | Fixed | Appointment inherits the slot's consultation type. |
| H4 doctor/specialty validation | Fixed | `propose-slot` requires an `ACTIVE` affiliation and takes the specialty from it (`specialtyId` is a slug of the specialty name). |
| H5 validation and errors | Fixed | Shared validation, 4xx mapping for Cognito errors, `removeUndefinedValues`, cleanup of the Cognito user when a later step fails. |
| H6 CORS | Fixed | Preflight on all routes, CORS headers on Lambda and gateway errors. |
| H7 Lambda limits | Fixed | 10 s API / 20 s worker / 60 s schedulers, 256 MB, ARM64, one-month log retention, minified bundles. |
| H8 missing endpoints | Mostly fixed | Added `GET /hospitals/approved`, `GET /availability/pending`, `GET /appointments/mine`, doctor notification on slot proposal, hospital notification on review, verification-PDF presigned links, platform-admin bootstrap script. **Still missing:** doctor and hospital appointment lists, doctor listing, leaving the waitlist, forgot/change password. |
| H9 hospital registration | Partly fixed | Size and `%PDF-` checks; Cognito cleanup on failure; API throttling (50 rps, burst 100). No WAF; still base64 in the JSON body. |
| H10 scheduler isolation | Fixed | Per-item try/catch and pagination. |
| H11 lost notifications | Mostly fixed | `FailedEntryCount` is checked (row marked `PUBLISH_FAILED`), and notification errors never fail the business request. No automatic re-drive of `PENDING`/`PUBLISH_FAILED` rows yet. |
| H12 time and abuse checks | Fixed | Future-time checks, ISO/UTC normalisation, `startTime < endTime`, max 12 h, max 2 unpaid holds per patient, no overlapping appointments, patient role required to book. |
| M1 review-hospital | Fixed | Validated decision, no phantom hospitals (404), admin notified. |
| M2 cancel | Partly fixed | Conditional on status; cannot cancel after start. **No refund logic and no cancellation cutoff** (business decisions). |
| M3 reschedule | Fixed | Same-slot rejected, conditional on current status, payment carried over, `rescheduledFrom`/`rescheduledTo` links, same consultation type required, old slot released to the waitlist. |
| M4 attendance | Fixed | Not before the start time; conditional write. |
| M5 existing user as doctor | Fixed | 409 unless the existing account already has role `DOCTOR`. |
| M6 notification text | Improved | Messages include times, claim instructions and new types (`SLOT_PROPOSED`, `HOSPITAL_REVIEWED`). |
| M7 SES config | Partly fixed | Synth warns when `SES_FROM_ADDRESS` is unset; DLQ alarm added (14-day retention). SES/SNS sandbox exit is an AWS-account task. |
| M8 Cognito | Partly fixed | Password complexity, email-only recovery, `preventUserExistenceErrors`. **Still open:** MFA, SES for Cognito email (default limit about 50/day). |
| M9 data protection | Partly fixed | PITR on all tables, deletion protection on medical notes, bucket `enforceSSL` and versioning. **Still open:** customer-managed KMS key, access audit log. |
| M10 unbounded reads | Fixed | `browse` is paginated, time-bounded and uses the new `hospital-time-index`. |
| M11 hot GSI partition | Open | Only matters at large scale. |
| M12 reminder windows | Fixed | Windows start at "now"; sent flags prevent duplicates. |
| M13 waitlist design | Mostly fixed | Most specific preference first (doctor, specialty, hospital); duplicate joins rejected. Expired offers still do not return the patient to `WAITING`. |
| M14 status codes | Fixed | 404 for missing appointments. |
| L1-L5, L8 | Fixed | `esbuild` declared, unused dependency removed, shared `lambda/lib`, real README, tests, API throttling. |
| L6, L7, L9 | Open | X-Ray and structured logging, stage config. (Added a DLQ alarm and an API 5xx alarm.) |

**Deployment notes**

- The data stack gained two GSIs (`hospital-time-index` on availability, `patient-index` on appointments) and point-in-time recovery. CloudFormation allows only **one GSI change per table per update**, which is satisfied because each table gets exactly one new index. If the tables already hold data, `hospital-time-index` backfills automatically (slots without `startTime` do not exist).
- Slots created before this change have no `consultationType` (treated as `GENERAL`) and no `specialtyId` slug, so re-create them.
- New password rule (upper, lower, digit) applies to new passwords only.

---

## 1c. Frontend audit and alignment

The frontend (`../Frontend`) was a Figma Make prototype whose built-in mock API had invented its own routes and payloads, so it could not have worked against this backend. Findings and what was done:

| Mismatch found | Resolution |
|---|---|
| `confirm-signup` sent `code`; backend wants `confirmationCode` | Fixed in `api.confirm` |
| `login` expected a `user` object; backend returns tokens only | Added `GET /users/me` (also returns the hospital name and approval status for hospital admins); the client logs in, then loads the profile |
| Doctors could not sign in (temporary password, no way to set a new one) | Login screen handles `NEW_PASSWORD_REQUIRED`; new "Choose your password" step calls `POST /auth/new-password` |
| `hospitals/register` sent `name`, `adminFirstName`, `verificationDoc`; backend wants `hospitalName`, `firstName`, `documentBase64` | Mapped; also PDF size limit (4 MB) and a confirm-email step for hospital admins |
| Phone numbers entered with spaces; backend requires E.164 | `toE164()` normalises, with validation messages; password policy checked client-side |
| Called ~20 routes that do not exist (`/users/lookup`, `/doctors/create`, `/hospitals/document`, `/availability/general`, `/availability/doctor`, `/medical-notes/mine`, `/reviews/*`, ...) | Replaced with the real routes. Added the backend routes the screens genuinely needed: `GET /doctors/list`, `GET /appointments/mine` (now for patients, doctors and hospital admins, with display names), `GET /waitlist/mine`, `GET /notifications/mine`, `GET /availability/mine`, `GET /availability/hospital`, `GET /users/me` |
| Booking sent `consultationType`/`startTime`; backend books by `slotId` and takes the type (and fee) from the slot | Booking uses the slot; "general consultation" picks the first free general slot at the chosen time (next one if just taken) |
| `pay` sent `simulate: 'FAILURE'`; backend wants `simulateOutcome: 'FAILED'` | Fixed; the failure-simulation link follows `VITE_PAYMENT_SIMULATION` |
| `reschedule` omitted `newHospitalId`; `record-attendance` sent `attendance` instead of `decision`; `approve` omitted `hospitalId`; `waitlist/join` sent `matchType`/`value`/`desiredStart`; `waitlist/claim` sent `entryId` | All fixed to the backend field names; waitlist date/time inputs removed (backend matches on hospital, specialty or doctor only) |
| UI let notes be written once a session started; backend requires `COMPLETED` | UI follows the backend rule |
| UI promised "unmarked sessions become MISSED after 2 h" but nothing did that | New scheduled Lambda `mark-missed-appointments` (every 15 min) |
| Backend features with no UI | Added: first-login password screen, pending-approval banner for hospital admins, doctor notification when a slot is proposed (Notifications page for every role), approved-hospital picker, paginated browse, presigned verification-PDF viewer, "Pay now" for unpaid holds, no-show button, hospital/specialty/doctor waitlist with duplicate rejection, bulk slot proposals with the required buffer |
| Prototype features that used to be mock-only (reviews, reports, profile edit/photo, delete account or hospital, remove doctor, doctor bios) | Implemented in the backend on 2026-10-08 (see README endpoints); `caps` was removed from the frontend |

`Backend/test/stacks.test.ts` now contains a **frontend contract test** that extracts every route from `Frontend/src/api/endpoints.ts` and compares it with the synthesized API Gateway in both directions, so the two sides cannot drift apart silently.

**Deployment note for the new indexes:** besides the two indexes from the first round, the appointments table gets `doctor-index` and `hospital-index` and the affiliations table gets `hospital-index`. CloudFormation allows only one GSI change per table per update; if the tables are already deployed with data, deploy in steps (add one appointments index, deploy, add the next).

---

## 2. Repository state

```
Backend/
├── bin/backend.ts           CDK app entry: DataStack → ApiStack
├── lib/data-stack.ts        8 DynamoDB tables + 1 S3 bucket
├── lib/api-stack.ts         Cognito, EventBridge, SQS(+DLQ), 24 Lambdas, 4 schedules, REST API
├── lambda/                  24 handler files + lib/{notify,waitlist}.ts
├── test/                    EMPTY
├── cdk.json, jest.config.js, tsconfig.json, package.json
└── README.md                still the default `cdk init` template text
```

Git status of `Backend/` (the only commit is the original "Initial commit"):

```
 M bin/backend.ts          D lib/backend-stack.ts     D test/backend.test.ts
 M package.json            ?? lambda/   ?? lib/api-stack.ts   ?? lib/data-stack.ts   ?? package-lock.json
```

**Commit this soon.** Right now all real work exists only in the working directory.

---

## 3. Architecture

```
                         ┌───────────────────────────── API Gateway (REST, stage "prod") ─────────────────────────────┐
 Client ──HTTPS──▶       │  public: signup, confirm, login, hospital register, browse slots                          │
                         │  Cognito authorizer (ID token): everything else                                            │
                         └───────────────┬───────────────────────────────────────────────────────────────────────────┘
                                         ▼
                              Lambda handlers (NodejsFunction, one per file)
                     ┌───────────────────┼─────────────────────────────────────────┐
                     ▼                   ▼                                         ▼
               DynamoDB (8 tables)    S3 bucket (hospital verification PDFs)   sendNotification()
                     ▲                                                              │ 1) PutItem PENDING row
                     │                                                              │ 2) PutEvents (source medicue.notifications)
   EventBridge schedules ──▶ expiry / reminder Lambdas                              ▼
   (1 min, 1 min, 5 min, 1 h)                                             EventBridge bus ─rule─▶ SQS ─▶ notification-worker ─▶ SES / SNS
                                                                                                   └─ after 3 receives ─▶ DLQ
```

Two CDK stacks (`bin/backend.ts`):

- **`MediCueDataStack`** holds the tables and the bucket.
- **`MediCueApiStack`** holds Cognito, the bus, SQS, the Lambdas, the schedules and the API. It receives the tables as props.

### 3.1 DynamoDB tables (all PAY_PER_REQUEST)

| Table | Key (PK / SK) | GSIs | Contents |
|---|---|---|---|
| `users` | `userId` | `email-index` (email) | `PATIENT`, `HOSPITAL_ADMIN`, `DOCTOR`, `PLATFORM_ADMIN` rows. Role lives here, not in Cognito groups. |
| `hospitals` | `hospitalId` / `itemType` | `status-index` (status / createdAt) | `PROFILE` item with name, address, phone, `verificationDocKey`, `status` (PENDING/APPROVED/REJECTED). |
| `affiliations` | `doctorId` / `hospitalId` | none | Doctor↔hospital link (`specialty`, `status: ACTIVE`). |
| `availability` | `hospitalId` / `slotId` | `doctor-index` (doctorId / startTime), `specialty-index` (specialtyId / startTime) | Slots: `PENDING → APPROVED → BOOKED`, plus `OFFERED` for waitlist offers, `REJECTED`. |
| `appointments` | `appointmentId` / `itemType` | `status-index` (status / startTime) | `METADATA` (status, times, parties) and `PAYMENT` items. Only `METADATA` carries `status`, so only it is indexed. |
| `waitlist` | `patientId` / `waitlistId` | `match-index` (matchKey / createdAt), `status-index` (status / offerExpiresAt) | `WAITING → OFFERED → CLAIMED \| EXPIRED`. |
| `notifications` | `recipientId` / `notificationId` | none | Delivery log: `PENDING → SENT \| FAILED`, `retryCount`. |
| `medicalNotes` | `patientId` / `noteId` | none | Doctor-written notes. |

S3: one bucket with `BLOCK_ALL` public access and S3-managed encryption. It is written only by `register-hospital`.

### 3.2 Status lifecycles

- **Slot:** `PENDING` (proposed by a hospital admin) → `APPROVED` (doctor accepts) → `BOOKED` (a patient books). On payment failure, expiry or cancel it returns to `APPROVED`. It may also be `OFFERED` (held for a waitlisted patient) or `REJECTED`.
- **Appointment:** `PENDING_PAYMENT` → `CONFIRMED` | `CANCELLED` (payment failed) | `EXPIRED` (hold timed out after 5 min). Then `CONFIRMED` → `CANCELLED` | `RESCHEDULED` | `COMPLETED` | `MISSED`. `MISSED` → `RESCHEDULED` (doctor only).
- **Waitlist entry:** `WAITING` → `OFFERED` (15-minute claim window) → `CLAIMED` | `EXPIRED`.

### 3.3 Scheduled jobs

| Lambda | Rate | What it does |
|---|---|---|
| `release-expired-payment-holds` | 1 min | Finds `PENDING_PAYMENT` appointments older than 5 min, marks them `EXPIRED`, returns the slot to `APPROVED`, then offers it to the waitlist. |
| `release-expired-waitlist-offers` | 1 min | Expires `OFFERED` entries past `offerExpiresAt`, frees the slot, then offers it to the next person. |
| `check-email-reminders` | 1 h | `CONFIRMED` appointments starting in 47–48 h → EMAIL reminder, then sets `emailReminderSent`. |
| `check-sms-reminders` | 5 min | `CONFIRMED` appointments starting in 25–30 min → SMS reminder, then sets `smsReminderSent`. |

### 3.4 Notification pipeline

`sendNotification` (`lambda/lib/notify.ts`) does the following for each channel:

1. Writes a `PENDING` row to the notifications table.
2. Publishes a `medicue.notifications` event.
3. A rule forwards the event to SQS.
4. `notification-worker` (batch size 1) looks up the user, builds the text, sends via SES (email) or SNS (SMS), and marks the row `SENT`.
5. On error it marks the row `FAILED`, increments `retryCount` and rethrows. After 3 receives SQS moves the message to the DLQ.

---

## 4. API reference

Auth: "Cognito" means the Cognito User Pool authorizer, which expects the **ID token**. Roles are checked in handler code against the `users` table.

| Method & path | Lambda | Auth | Who may call | Purpose |
|---|---|---|---|---|
| POST `/patients/signup` | patient-signup | public | anyone | Cognito `SignUp` plus a `users` row (role `PATIENT`). |
| POST `/patients/confirm-signup` | confirm-signup | public | anyone | Confirms the email code. Also used for hospital admins. |
| POST `/auth/login` | login | public | anyone | `USER_PASSWORD_AUTH`; returns `idToken` and `accessToken`. |
| POST `/hospitals/register` | register-hospital | public | anyone | Creates an admin user, uploads a base64 PDF to S3, creates a `PENDING` hospital. |
| POST `/hospitals/review` | review-hospital | Cognito | `PLATFORM_ADMIN` | Sets hospital status. |
| GET `/hospitals/list?status=` | list-hospitals | Cognito | `PLATFORM_ADMIN` | Lists hospitals by status via the GSI. |
| POST `/doctors/add` | add-doctor | Cognito | `HOSPITAL_ADMIN` | Creates a Cognito doctor (or reuses an existing user) and an affiliation. |
| POST `/availability/propose` | propose-slot | Cognito | `HOSPITAL_ADMIN` | Creates a `PENDING` slot after a conflict check. |
| POST `/availability/approve` | approve-slot | Cognito | the slot's doctor | Approves or rejects a slot. |
| GET `/availability/browse?hospitalId=` | browse-slots | public | anyone | Lists `APPROVED` slots of a hospital. |
| POST `/appointments/book` | book-appointment | Cognito | any user | Transaction: slot `APPROVED→BOOKED` plus a `PENDING_PAYMENT` appointment. |
| POST `/appointments/pay` | process-payment | Cognito | **any user** | Mock payment: `CONFIRMED` on success, `CANCELLED` and slot released otherwise. |
| POST `/appointments/cancel` | cancel-appointment | Cognito | the patient | Cancels a `CONFIRMED` appointment, frees the slot, notifies, offers to the waitlist. |
| POST `/appointments/record-attendance` | record-attendance | Cognito | `HOSPITAL_ADMIN` of that hospital | Marks `COMPLETED` or `MISSED`. |
| POST `/appointments/reschedule` | reschedule-appointment | Cognito | the patient or the doctor | Moves the appointment to a new slot. |
| POST `/waitlist/join` | join-waitlist | Cognito | any user | Joins by `HOSPITAL`, `SPECIALTY` or `DOCTOR`, only if no matching slots exist. |
| POST `/waitlist/claim` | claim-waitlist-offer | Cognito | the offered patient | Claims an offered slot; creates a `PENDING_PAYMENT` appointment. |
| POST `/medical-notes/record` | record-medical-note | Cognito | the appointment's doctor | Stores a note once the appointment is `COMPLETED`. |
| GET `/medical-notes/list` | get-medical-notes | Cognito | patient (own notes) or doctor (notes they wrote, given `patientId`) | Reads notes. |

Business rules found in code:

- **Slot spacing:** 10 minutes between slots at the same hospital, 90 minutes between different hospitals.
- **Payment hold:** 5 minutes.
- **Waitlist offer window:** 15 minutes.
- **Patient reschedule cutoff:** 2 hours before the start.
- **Fees:** 2000 for `GENERAL`, 3000 for `SPECIALIST`. The currency is unspecified.

---

## 5. What was verified as correct

- **IAM matches code** for 22 of the 24 Lambdas: each has the env vars and `grant*` calls its handler needs, and no more than that is broadly granted. The two exceptions are the reminder Lambdas (finding C3).
- **Medical-notes isolation holds.** `medicalNotesTable` appears in exactly two grants (`api-stack.ts:361`, `:371`).
- **Booking, claim and reschedule slot changes use conditional transactions**, so two patients cannot both win the same `APPROVED` slot.
- **Sparse GSIs work as intended.** `PAYMENT` items have no `status`, so they stay out of `appointments/status-index`. `WAITING` items have no `offerExpiresAt`, so they stay out of `waitlist/status-index`.
- **`add-doctor` returns the right id.** With `signInAliases.email`, Cognito's `Username` for `AdminCreateUser` is the `sub` UUID, which matches `claims.sub` used everywhere else.
- **Expired-offer claims are blocked.** `claim-waitlist-offer` checks `offerExpiresAt` itself instead of waiting for the 1-minute sweeper.
- **The notification pipeline reads the right data.** The worker correctly unwraps the EventBridge envelope (`envelope.detail`), and `retryCount = retryCount + 1` works because the row is initialised to 0.
- **Strict TypeScript compiles cleanly.**

---

## 6. Findings

Severity: **Critical** = broken or exploitable now · **High** = wrong behaviour or a serious gap · **Medium** = should fix before launch · **Low** = polish.

### Critical

**C1. Reminder Lambdas lack IAM on the notifications table.**
`CheckEmailRemindersFunction` and `CheckSmsRemindersFunction` (`api-stack.ts:88-118`) get `NOTIFICATIONS_TABLE_NAME` and EventBridge put permission, but never `notificationsTable.grantWriteData(...)`. `sendNotification` starts with a `PutCommand` on that table, so every reminder fails with `AccessDeniedException`. The failing `await` also comes before the `emailReminderSent` flag update, so the same appointments are retried on every run. `CLAUDE.md` calls out this exact requirement. All other `sendNotification` callers have the grant.
*Fix:* add `props.notificationsTable.grantWriteData(...)` for both functions.

**C2. Doctors cannot complete a first login.**
`add-doctor` uses `AdminCreateUser`, which leaves the user in `FORCE_CHANGE_PASSWORD`. `InitiateAuth` then returns `ChallengeName: NEW_PASSWORD_REQUIRED` with no `AuthenticationResult`. `login.ts` ignores the challenge and returns `200` with `idToken`/`accessToken` undefined (so `{}`). No `RespondToAuthChallenge` endpoint exists.
*Fix:* return the challenge and session from `login`, and add `POST /auth/new-password` using `RespondToAuthChallenge`. Alternatively, send doctors a signup-style invite with a self-set password.

**C3. Payment endpoint is open and client-controlled** (`process-payment.ts`).
- It never checks that the caller owns the appointment. Any authenticated user holding an `appointmentId` can pay or fail someone else's booking.
- `simulateOutcome` comes from the request body and defaults to `SUCCESS`, so a patient can confirm a booking without paying.
- The `PAYMENT` item is written before and independently of the state change, with no condition. Retries overwrite it.
- The amount is derived from the client-supplied `consultationType`, so a patient can pick `GENERAL` with a specialist and pay 2000 instead of 3000.

*Fix:* before production, replace this with a provider checkout plus a verified webhook or callback, with idempotency keys. Derive the fee server-side from doctor, specialty or hospital config. Check `appointment.patientId === caller`. Remove or gate `simulateOutcome` behind a non-prod flag.

**C4. `approve-slot` can re-open a booked slot** (`approve-slot.ts`).
It never checks `slot.status === 'PENDING'` and never validates `decision`. The owning doctor can send `{decision:'APPROVED'}` for a `BOOKED` slot. The overlap check ignores `BOOKED` slots, so it passes, the slot flips to `APPROVED`, and it can be booked a second time while the first appointment stays `CONFIRMED`. Any other string (for example `"BOOKED"` or `"OFFERED"`) is written verbatim.
*Fix:* allow only `APPROVED|REJECTED`. Add `ConditionExpression: '#s = :pending'` to the update. Return 409 otherwise.

**C5. Hospital approval is not enforced anywhere.**
`register-hospital` creates a `PENDING` hospital and an immediately usable admin account after email confirmation. `add-doctor`, `propose-slot` and `browse-slots` never read the hospitals table, and none of them has a grant to do so. A `PENDING` or `REJECTED` hospital can publish bookable slots. The whole review workflow is cosmetic.
*Fix:* load the hospital profile in `add-doctor` and `propose-slot` and require `status === 'APPROVED'`. Have `browse` return slots only for approved hospitals.

**C6. Waitlist handoff races and can lose slots** (`lib/waitlist.ts`, called by cancel, expiry and reschedule).
- The caller first sets the slot to `APPROVED` (publicly bookable) and only afterwards offers it to the waitlist. Anyone can snipe the slot in that window, which defeats the purpose of the waitlist.
- `offerSlotToWaitlist` updates the availability row to `OFFERED` with **no condition**. If someone books in that window (`BOOKED`), it is overwritten to `OFFERED` and the waitlisted patient can then claim it. That produces two appointments for one slot.
- The waitlist update has no `#s = WAITING` condition. If two slots free at once, the same patient is picked for both. The first slot stays `OFFERED` with no waitlist entry pointing at it, and the sweeper (which works through waitlist entries) never releases it.
- The two writes (waitlist entry, then slot) are not transactional.

*Fix:* make "free the slot" and "offer to waiter" a single transaction, going directly from `BOOKED` to `OFFERED` when a waiter exists and to `APPROVED` otherwise. Add conditions on both rows. Pick the next candidate again when a condition fails.

### High

**H1. Conflict detection ignores `BOOKED`/`OFFERED` slots** (`propose-slot.ts:45`, `approve-slot.ts:44`).
Both only consider `status === 'APPROVED'`. Once a slot is booked it no longer counts, so the doctor can be given overlapping or too-close slots that then get approved. `PENDING` slots are also ignored, so two overlapping proposals can both be approved if the second is approved before the first. The check is a read followed by a write with no atomicity.
*Fix:* count `APPROVED`, `BOOKED` and `OFFERED`. Consider a per-doctor lock item, or a transaction, for the check-then-write.

**H2. Payment success vs. hold expiry race** (`process-payment.ts:53-66`).
The `CONFIRMED` update has no `ConditionExpression`. If the expiry job sets `EXPIRED` and re-opens the slot between the handler's read and write, the appointment is resurrected as `CONFIRMED` while the slot is `APPROVED` and bookable. The failure branch likewise sets the slot to `APPROVED` unconditionally.
*Fix:* condition on `status = PENDING_PAYMENT`, and also on the slot still being `BOOKED`, in the same transaction.

**H3. Waitlist claim loses the consultation type** (`claim-waitlist-offer.ts:69`).
The appointment is created with `consultationType: 'GENERAL'` and a comment "see note below" that points to no note. Specialist patients are charged the general fee.
*Fix:* store `consultationType` on the waitlist entry at join time and copy it.

**H4. Slot proposals don't validate the doctor, hospital affiliation or specialty** (`propose-slot.ts`).
`doctorId` and `specialtyId` come straight from the body, and `affiliationsTable` is never read. A hospital admin can create slots for any user id, including doctors of other hospitals, who then see them in their own `doctor-index`. `specialtyId` is free text. No specialty entity exists, although the hospitals-table comment mentions `SPECIALTY` items that nothing creates. The affiliation stores `specialty` while slots use `specialtyId`, so the names don't line up. One affiliation row per doctor and hospital means a second specialty overwrites the first.
*Fix:* require an `ACTIVE` affiliation for `(doctorId, hospitalId)`. Model specialties explicitly, and use one name for them.

**H5. No input validation, and unhandled errors cause 500s, partial state and orphaned accounts.**
Only 4 of the 24 handlers contain a `try`.
- `JSON.parse(event.body)` throws on a missing or invalid body.
- Cognito errors (`UsernameExistsException`, `InvalidPasswordException`, `CodeMismatchException`, `NotAuthorizedException`) come back as generic 502/500 instead of 400/401/409.
- `DynamoDBDocumentClient` is created without `removeUndefinedValues`. In `patient-signup` a missing `phone` or `dateOfBirth` makes `PutCommand` throw **after** the Cognito account was created, leaving a Cognito user with no profile. `register-hospital` and `add-doctor` have the same problem (`add-doctor` can end up with a Cognito user and a `users` row but no affiliation).
- Enums and formats are never validated: `decision`, `consultationType`, `preferenceType`, ISO times, E.164 phones, `startTime < endTime`.

*Fix:* add a small shared layer in `lambda/lib/` for parsing and validation (zod or hand-rolled), response helpers, and a wrapper that maps known errors to 4xx. Create the DB row first or compensate on failure. Pass `marshallOptions: { removeUndefinedValues: true }`.

**H6. No CORS configuration.** The `RestApi` has no `defaultCorsPreflightOptions` and handlers return no CORS headers. The (still empty) browser frontend will be blocked.
*Fix:* add preflight options and a headers helper used by every handler.

**H7. Lambda timeout and memory are CDK defaults (3 s, 128 MB).**
Bundles are 1.2–1.9 MB. `process-payment` does about ten sequential AWS calls. The scheduled jobs loop sequentially over items, and each notification costs two network calls per channel. Cold starts plus these loops can time out, and a timeout in the middle of a loop leaves partial work.
*Fix:* set `timeout` (about 10 s for API handlers, 60 s for schedulers), `memorySize` (256–512 MB), `architecture: ARM_64`, `logRetention`, and minify.

**H8. Missing endpoints. The core flows can't be driven from a client.**
- Patient: list or get my appointments, list my waitlist entries, leave the waitlist, discover hospitals, doctors and specialties (the only hospital listing is platform-admin-only, and browse needs a `hospitalId`).
- Doctor: list pending slots or my schedule. Proposing a slot sends **no notification**, so the doctor has no way to learn the `slotId` and `hospitalId` that `approve-slot` needs.
- Hospital admin: list doctors, slots and appointments, remove a doctor, add staff, view the uploaded verification document.
- Platform admin: no creation path at all. A `PLATFORM_ADMIN` row must be inserted by hand. No way to view or download the verification PDF either, because no Lambda has `s3:GetObject`.
- Users: refresh token (`login` omits `refreshToken`), forgot or reset password, change password, resend confirmation code.

**H9. Public hospital registration is an unauthenticated upload and abuse surface.**
A base64 PDF travels in the JSON body, which is capped at about 4.5 MB (Lambda sync payload 6 MB, base64 overhead). Content isn't validated as a PDF and the object is written with `ContentType: application/pdf` regardless. There is no throttling or WAF on the signup, login and register routes. A failure after the Cognito signup but before the S3 or DB writes leaves an orphaned Cognito user.
*Fix:* issue a presigned POST (with `content-length-range`) after the admin's email is confirmed, scan the upload, and add API throttling or WAF.

**H10. Scheduled jobs have no per-item error isolation.**
`release-expired-payment-holds` and `release-expired-waitlist-offers` loop without `try/catch`. A single `TransactionCanceledException` or `ConditionalCheckFailedException` (for example a payment succeeding at the same moment, or an offer being claimed) aborts the rest of that run. The reminder jobs behave the same way once C1 is fixed. Queries are also unpaginated (1 MB).
*Fix:* wrap each item, treat conditional-check failures as "already handled", and paginate.

**H11. Notification publishing can silently lose events** (`lib/notify.ts`).
`PutEvents` returns HTTP 200 even when `FailedEntryCount > 0`, and the code never checks it. The `PENDING` row then stays `PENDING` forever and nothing re-drives it. The DB write and the event publish are not atomic. A failure in the middle of a handler, after the state change but before `sendNotification`, also drops the notification (for example in `cancel-appointment`).
*Fix:* check `FailedEntryCount`. Use an outbox pattern (DynamoDB Streams or EventBridge Pipes from the notifications table) or a sweeper for stale `PENDING` rows.

**H12. Booking abuse and time validation gaps.**
- Nothing checks that a slot's `startTime` is in the future in `book`, `reschedule`, `propose` or `browse`.
- `propose-slot` accepts `endTime <= startTime` and non-ISO strings. Times are compared as strings, which only works when they are all UTC ISO-8601 with `Z`. `+01:00` offsets would sort wrongly in the GSIs and in the overlap checks.
- A patient can hold unlimited slots in `PENDING_PAYMENT` by booking and letting each hold expire after 5 minutes (slot hoarding).
- A patient can book overlapping appointments.
- `book` doesn't check that the caller is a patient, and its catch-all `catch` returns 409 for any error, including throttling, instead of inspecting `TransactionCanceledException` reasons.

### Medium

**M1. `review-hospital` accepts any `decision` string and upserts.** `UpdateItem` without `attribute_exists` creates a phantom `{hospitalId, itemType:'PROFILE', status}` if the id doesn't exist. It also doesn't notify the hospital admin.
**M2. Cancel has no time cutoff and no refund logic.** Patients can cancel at any time (reschedule has a 2-hour cutoff). No refund exists anywhere, though one message mentions refunds. The cancel transaction doesn't condition on the appointment still being `CONFIRMED` (race with record-attendance) or on the slot being `BOOKED`.
**M3. Reschedule gaps.**
  - Passing the *same* slot id twice in one transaction makes DynamoDB reject the request, which is reported as "slot was just taken".
  - The freed old slot isn't offered to the waitlist (cancel does offer it).
  - The old payment isn't linked to the new appointment: there is no `PAYMENT` item for the new id and no `rescheduledFrom` field, so refunds and audits can't trace it.
  - The old appointment isn't conditioned on its current status.
  - A doctor can move a patient to a slot of a different doctor or hospital with no consent.
  - No future-time check on the new slot.
**M4. `record-attendance` has no time check.** A hospital admin can mark a future appointment `COMPLETED` or `MISSED`. Only hospital admins can do it, not doctors. `COMPLETED` sends no notification.
**M5. `add-doctor` reuses any existing user with the same email without changing roles.** A `PATIENT` or `HOSPITAL_ADMIN` becomes affiliated as a doctor but keeps the old role, so `get-medical-notes` treats them as a patient. Existing users who haven't confirmed their email are also reused.
**M6. Notification content is minimal.** Messages contain only ids, with no times, doctor, hospital or claim instructions. Booking confirmation has no appointment time, and the waitlist offer says "a slot" without saying which or how to claim it. SMS also carries IDs only (good for privacy), but the user can't act on it.
**M7. Notification delivery config.** `SES_FROM_ADDRESS` silently falls back to `no-reply@example.com`, so deploys succeed but all mail fails. SES and SNS start in sandbox mode (verified recipients only; SMS needs a sender id and spend limit). There's no DLQ alarm or redrive. `ses:SendEmail` is on `*`.
**M8. Cognito settings.** Cognito's built-in email sender is capped at about 50 emails per day, so configure SES for the pool. Also missing: MFA, account recovery config, `preventUserExistenceErrors`, password complexity beyond length 8, and deletion protection.
**M9. Data protection for medical data.**
  - Tables have no point-in-time recovery and no deletion protection.
  - They use AWS-owned encryption keys rather than a customer-managed KMS key.
  - There's no access audit trail for medical-note reads.
  - The S3 bucket has no `enforceSSL`, versioning or lifecycle rules.
  - Removal policies are left at CDK defaults. Decide deliberately (RETAIN for production data).

**M10. Unbounded reads.** `browse-slots` queries a hospital's whole partition (including past and booked slots) with a filter, so cost and latency grow forever. Same for `doctor-index` queries in conflict checks and the waitlist match queries. No pagination, `Limit` or date filter.
**M11. Hot GSI partitions.** `appointments/status-index` uses `status` alone as the partition key, so every `CONFIRMED` appointment shares one partition. That's fine at small scale but caps throughput as volume grows. Consider sharding, for example `status#yyyy-mm-dd`.
**M12. Reminder windows have no overlap.** Email looks at `[now+47h, now+48h]` every hour; SMS at `[now+25m, now+30m]` every 5 minutes. One skipped or delayed invocation misses those appointments permanently. Query `[now, now+48h]` and rely on the sent flag.
**M13. Waitlist design questions.**
  - Match order is HOSPITAL, then SPECIALTY, then DOCTOR, so a patient who wants one specific doctor loses to an earlier hospital-level waiter.
  - A patient can join the same preference many times.
  - An expired offer sends the patient to `EXPIRED` instead of back to `WAITING`.
  - `offerExpiresAt` stays on `EXPIRED` and `CLAIMED` items, so they remain in `waitlist/status-index`, contrary to the sparse-index comment in `data-stack.ts`.

**M14. Inconsistent status codes.** A missing appointment is 403 in cancel and record-attendance but 404 in reschedule. Not-found, forbidden and invalid-state responses should be consistent.

### Low / hygiene

- **L1.** `esbuild` isn't a declared dependency. It exists only transitively through `tsx` (v0.28.2). CDK is invoking it via `npx --no-install esbuild` through PowerShell, which makes synth slow (see §9). Declare `esbuild` as a devDependency.
- **L2.** `@aws-sdk/client-secrets-manager` is installed but unused.
- **L3.** Code duplication:
  - `hasConflict` and the two buffer constants are copied between `propose-slot` and `approve-slot`.
  - The caller-role lookup is repeated in about 8 handlers.
  - The DynamoDB client setup is repeated in every handler.
  - Status strings are magic literals everywhere.
  - Handlers take `event: any`.
- **L4.** `README.md` is still the default `cdk init` text and doesn't describe the system.
- **L5.** `jest.config.js` sets `roots: ['<rootDir>/test']`. With no tests, `npm test` exits 1. Add tests, or at least `--passWithNoTests` in CI.
- **L6.** No structured logging, no alarms (Lambda errors, API 5xx, DLQ depth), no X-Ray tracing and no API access logs. `cdk.json` sets `disableCloudWatchRole: true`, so API Gateway access logging needs an explicit account-level role first.
- **L7.** No environment or stage separation (fixed stack names, no tags, no config object).
- **L8.** No usage plan, throttling or request validation on API Gateway.
- **L9.** `confirm-signup` lives under `/patients/` but is also needed by hospital admins. Consider `/auth/confirm-signup`.

---

## 7. Suggested improvements (prioritised)

**Phase 1: make it correct and safe (do first)**

1. Fix C1 (reminder IAM), a two-line change. Fix C2 (doctor first login).
2. Fix C4 (validate `decision` and state in `approve-slot`), and H1 (conflict check must include `BOOKED`/`OFFERED`).
3. Enforce hospital approval (C5), and verify doctor affiliation on `propose-slot` (H4).
4. Rework the payment endpoint (C3, H2) behind a provider-callback design. Remove `simulateOutcome` from production.
5. Make the waitlist handoff atomic (C6). Add conditions to every "free the slot" write.
6. Add the shared `lambda/lib` layer: parse and validate input, map errors to 4xx, add CORS headers, set `removeUndefinedValues`. Add `try/catch` per scheduled item.
7. Set Lambda timeout, memory and log retention. Add CORS preflight to the API.

**Phase 2: make the flows completable**

8. Add the missing read endpoints (H8), starting with "my appointments", "pending slots for a doctor", "list approved hospitals/doctors/specialties", and a presigned URL for viewing verification documents.
9. Notify the doctor when a slot is proposed and the hospital admin when a hospital is reviewed.
10. Add a platform-admin bootstrap, for example a seed script or a CDK custom resource that creates the first `PLATFORM_ADMIN`.
11. Define fees per doctor or specialty in data, not constants. Add refunds on cancel and reschedule.
12. Add pagination everywhere, and a date-range filter on browse. Consider a sparse GSI for open slots.

**Phase 3: production readiness**

13. Tests: unit tests per handler with mocked DynamoDB (`aws-sdk-client-mock`), and CDK assertion tests for IAM, such as "only these two functions can access medical notes" and "every function that calls `sendNotification` has the three required grants". The second would have caught C1.
14. Observability: alarms on DLQ depth, Lambda errors and API 5xx; structured JSON logs; X-Ray.
15. Security: WAF and throttling, MFA for staff, customer-managed KMS for medical data, PITR and deletion protection, SES for Cognito email, `enforceSSL` on the bucket, audit logging of medical-note reads.
16. Notification redesign: build richer messages (time, doctor, hospital, link), use an outbox for reliability, and consider publishing domain events (`AppointmentConfirmed`, `SlotFreed`, and so on) that a separate consumer turns into notifications.
17. Housekeeping: commit the work, write a real README, declare `esbuild`, remove unused deps, add stage configuration.

---

## 8. Quick-reference: environment variables per Lambda

| Lambda | Env vars (besides `EVENT_BUS_NAME` where listed) |
|---|---|
| notification-worker | `USERS_TABLE_NAME`, `NOTIFICATIONS_TABLE_NAME`, `SES_FROM_ADDRESS` |
| check-email-reminders, check-sms-reminders | `APPOINTMENTS_TABLE_NAME`, `NOTIFICATIONS_TABLE_NAME`, `EVENT_BUS_NAME` |
| release-expired-payment-holds | appointments, availability, waitlist, notifications tables, `EVENT_BUS_NAME` |
| release-expired-waitlist-offers | waitlist, availability, notifications tables, `EVENT_BUS_NAME` |
| patient-signup | `USER_POOL_CLIENT_ID`, `USERS_TABLE_NAME` |
| confirm-signup, login | `USER_POOL_CLIENT_ID` |
| register-hospital | `USER_POOL_CLIENT_ID`, users, hospitals tables, `BUCKET_NAME` |
| review-hospital, list-hospitals | users, hospitals tables |
| add-doctor | `USER_POOL_ID`, users, affiliations tables |
| propose-slot | users, availability tables |
| approve-slot, browse-slots | availability table |
| book-appointment | availability, appointments tables |
| process-payment | availability, appointments, notifications tables, `EVENT_BUS_NAME` |
| cancel-appointment | appointments, availability, waitlist, notifications tables, `EVENT_BUS_NAME` |
| record-attendance | users, appointments, notifications tables, `EVENT_BUS_NAME` |
| reschedule-appointment | appointments, availability, notifications tables, `EVENT_BUS_NAME` |
| join-waitlist | waitlist, availability tables |
| claim-waitlist-offer | waitlist, availability, appointments tables |
| record-medical-note | appointments, medical-notes tables |
| get-medical-notes | users, medical-notes tables |

---

## 9. Synth result

`npx cdk synth` **succeeds** (exit 0): 2 stacks, 24 Lambdas bundled. It takes several minutes on this Windows machine because CDK launches `npx esbuild` through PowerShell once per function (see L1). A first attempt appeared to fail only because it was killed by a timeout mid-bundle.

The synthesized template confirms these findings:

- **C1:** the `CheckEmailReminders` and `CheckSmsReminders` roles contain only the appointments-table DynamoDB statement and `events:PutEvents`. There is no statement for the notifications table.
- **H6:** the API has 0 `OPTIONS` methods, so no CORS preflight.
- **H7:** the Lambdas have no `Timeout` or `MemorySize`, so the 3 s / 128 MB defaults apply. The runtime is `nodejs24.x`.

Synth only proves the infrastructure definition is valid. No handler has been executed, since there are no tests and nothing is deployed. The behavioural findings come from reading the code.
