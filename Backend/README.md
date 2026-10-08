# MediCue Backend

Hospital appointment booking on AWS (CDK, TypeScript): Cognito, API Gateway (REST), Lambda, DynamoDB, S3, EventBridge, SQS, SES/SNS.

`BACKEND_AUDIT.md` documents the architecture, the full API and the audit that led to the current code. `CLAUDE.md` (one level up) holds the working conventions.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Type-check only |
| `npm test` | Unit tests (validation, scheduling, HTTP helpers) and CDK assertions (IAM, CORS, tables) |
| `npx cdk synth` | Synthesize (bundles all Lambdas; takes a few minutes on Windows) |
| `npx cdk deploy --all` | Deploy both stacks |

Deploy-time settings: `-c allowedOrigin=https://your-frontend` (default `*`), `-c allowPaymentSimulation=false` (turn the mock payment off), and the `SES_FROM_ADDRESS` environment variable (a verified SES sender).

## First steps after deploying

1. **Create the first platform admin** (no API route can do this):
   `USER_POOL_ID=<UserPoolId output> USERS_TABLE_NAME=<UsersTableName output> npx tsx scripts/create-platform-admin.ts admin@example.com 'Str0ng-Passw0rd' Ada Lovelace`
2. A hospital registers (`POST /hospitals/register`), confirms its email (`POST /patients/confirm-signup`), and the platform admin approves it (`POST /hospitals/review`). Nothing works for a hospital until it is `APPROVED`.
3. The hospital admin adds doctors (`POST /doctors/add`).

## Doctor accounts and first login

Doctors are created by a hospital admin, not through signup:

1. `POST /doctors/add` creates the Cognito user with a generated temporary password (letters and digits); Cognito **emails the doctor a link** `<appUrl>/#/first-login?email=…&tp=…` (set `appUrl` at deploy time: `cdk deploy -c appUrl=https://your-frontend`). The frontend opens with both values filled in; the fragment is read once and removed from the address bar. The email also states the temporary password for manual sign-in.
2. The doctor calls `POST /auth/login` with email and temporary password. The response is `{ "challenge": "NEW_PASSWORD_REQUIRED", "session": "..." }`.
3. The doctor calls `POST /auth/new-password` with `{ email, newPassword, session }` and receives `idToken`, `accessToken` and `refreshToken`.
4. From then on `POST /auth/login` returns tokens directly.

Use the **ID token** as the `Authorization` header for protected routes.

## Endpoints

Public: `POST /patients/signup`, `POST /patients/confirm-signup`, `POST /auth/login`, `POST /auth/new-password`, `POST /hospitals/register`, `GET /hospitals/approved`, `GET /availability/browse?hospitalId=&from=&to=&limit=&nextToken=`.

Authenticated: `POST /hospitals/review`, `GET /hospitals/list?status=` (platform admin); `POST /doctors/add`, `POST /availability/propose`, `POST /appointments/record-attendance` (hospital admin); `POST /availability/approve`, `GET /availability/pending`, `POST /medical-notes/record` (doctor); `POST /appointments/book`, `GET /appointments/mine`, `POST /appointments/pay`, `POST /appointments/cancel`, `POST /appointments/reschedule`, `POST /waitlist/join`, `POST /waitlist/claim`, `GET /medical-notes/list`.

`POST /availability/propose` takes `{ doctorId, consultationType?, slots: [{ startTime, endTime }] }` with 1 to 5 slots whose exact times the hospital admin chooses. The slots must not overlap, or sit within 10 minutes of each other or of any slot the doctor already has at this hospital (including unanswered proposals); the whole batch is accepted or rejected together and the doctor gets one notification.

`POST /appointments/book` takes `{ hospitalId, slotId, note? }`; the optional `note` (what the patient is coming in for, up to 500 characters, specialist appointments only) is visible to the patient and the doctor only.

Staff, check-in and statistics: `POST /staff/add`, `GET /staff/list`, `POST /staff/remove`, `GET /stats/hospital?from=&to=&tzOffsetMinutes=` (hospital admin); `POST /appointments/check-in` (staff or hospital admin: `CONFIRMED` → `ARRIVED`) and `POST /appointments/complete` (doctor: `ARRIVED` → `COMPLETED`); `POST /users/bulk-create` (hospital admin: doctors and staff of their hospital; platform admin: also patients, doctors and staff of any approved hospital; at most 50 per request, each row reported separately); `GET /users/list?role=` and `POST /users/suspend` (platform admin). Public: `POST /auth/forgot-password`, `POST /auth/reset-password`.

Also authenticated: `GET /users/me`, `POST /users/update-profile` (own name, phone, photo, doctor bio), `POST /users/report`, `GET /users/reported` and `POST /users/delete` (platform admin; hospital admins go with their hospital), `POST /hospitals/delete` (platform admin), `POST /doctors/remove` (hospital admin; refused while the doctor has upcoming bookings), `GET /doctors/list`, `POST /reviews/create` (patient, one per completed appointment), `GET /reviews/doctor?doctorId=`, `GET /reviews/mine`.

## Layout

```
bin/backend.ts         app entry
lib/data-stack.ts      DynamoDB tables + S3 bucket
lib/api-stack.ts       Cognito, EventBridge, SQS, Lambdas, REST API, alarms
lambda/*.ts            one handler per file
lambda/lib/            http (CORS, errors), validation, db, scheduling, waitlist, notify, constants, cleanup (cascading removals), profile
scripts/               one-off operational scripts
test/                  jest tests
```

## Rolling out new table indexes

DynamoDB allows only **one index to be created per table per CloudFormation update**. The appointments table gained
three (`patient-index`, `doctor-index`, `hospital-index`), so an already-deployed system is updated in steps. The
data-only entry point (`bin/data.ts`) synthesizes in about a minute because it never bundles Lambdas:

```
npm run deploy:data -- -c gsiStage=1     # + patient-index
npm run deploy:data -- -c gsiStage=2     # + doctor-index
npm run deploy:data                      # + hospital-index (stage 3 is the default)
npx cdk deploy MediCueApiStack           # then the Lambdas and the API (bundling takes several minutes on Windows)
```

A brand-new account can run `npx cdk deploy --all` once; the stages only matter for existing tables.
