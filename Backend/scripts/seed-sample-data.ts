/**
 * Fills a deployed MediCue with sample content so the screens have something to show: doctors of every common
 * specialty, a few staff, patients, a week of non-clashing open sessions, booked sessions with a short note, five
 * weeks of appointment history for the statistics, and some reviews. Everything attaches to the first APPROVED
 * hospital and is tagged, so `--remove` takes exactly this content out again and nothing else.
 *
 *   USER_POOL_ID=... USERS_TABLE_NAME=... HOSPITALS_TABLE_NAME=... AFFILIATIONS_TABLE_NAME=... \
 *   AVAILABILITY_TABLE_NAME=... APPOINTMENTS_TABLE_NAME=... REVIEWS_TABLE_NAME=... NOTIFICATIONS_TABLE_NAME=... \
 *   npx tsx scripts/seed-sample-data.ts [--apply | --remove]
 *
 * Without a flag it only prints what it would create. The accounts it creates cannot sign in: they have no
 * password anyone knows, no phone number, and no email invitation is sent (their addresses are at example.com).
 */
import { randomUUID } from 'crypto';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TAG = 'import-2026-10'; // stored on every row this script creates, under the name `origin`
const UTC_OFFSET = '+01:00'; // the hospitals are in Cameroon
const DAYS_AHEAD = 8;
const DAYS_BACK = 35;
const BUFFER_SAME_MIN = 10;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the header of scripts/seed-sample-data.ts.`);
    process.exit(1);
  }
  return v;
};
const T = {
  pool: env('USER_POOL_ID'),
  users: env('USERS_TABLE_NAME'),
  hospitals: env('HOSPITALS_TABLE_NAME'),
  affiliations: env('AFFILIATIONS_TABLE_NAME'),
  availability: env('AVAILABILITY_TABLE_NAME'),
  appointments: env('APPOINTMENTS_TABLE_NAME'),
  reviews: env('REVIEWS_TABLE_NAME'),
  notifications: env('NOTIFICATIONS_TABLE_NAME'),
};

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

// ------------------------------------------------------------------------------------------ the sample people
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const DOCTORS: [string, string, string, string, string][] = [
  ['Jean-Paul', 'Nkoulou', 'jp.nkoulou', 'Cardiology', 'Senior cardiology practitioner. Echocardiography, hypertension clinics and cardiac rehabilitation. Consults in French and English.'],
  ['Emmanuel', 'Ekane', 'e.ekane', 'General Surgery', 'General surgeon with twenty years of experience in abdominal and day-case surgery, including post-operative follow-up.'],
  ['Joseph', 'Nfor', 'j.nfor', 'Infectious Diseases', 'Manages HIV care, tuberculosis, malaria and tropical infections, with a focus on long-term follow-up.'],
  ['Amina', 'Bello', 'a.bello', 'Paediatrics', 'Paediatrician caring for newborns to teenagers: growth checks, vaccinations and childhood illness.'],
  ['Claudine', 'Mbassi', 'c.mbassi', 'Gynaecology', "Antenatal care, family planning and women's health consultations in a calm, unhurried setting."],
  ['Samuel', 'Tchounkeu', 's.tchounkeu', 'Neurology', 'Headache, epilepsy and stroke recovery. Reviews investigations and adjusts treatment plans with the patient.'],
  ['Brenda', 'Atanga', 'b.atanga', 'Ophthalmology', 'Eye examinations, glaucoma screening and cataract assessment for adults and children.'],
  ['Ruth', 'Ngwa', 'r.ngwa', 'Psychiatry', 'Supports patients with anxiety, depression and sleep problems through talking therapy and medication review.'],
  ['Daniel', 'Foncha', 'd.foncha', 'ENT', 'Ear, nose and throat conditions including sinus problems, hearing loss and tonsil disorders.'],
  ['Vanessa', 'Tamba', 'v.tamba', 'Dentistry', 'Dentist for check-ups, fillings, cleaning and whitening, with a gentle approach for nervous patients and children.'],
  ['Esther', 'Manga', 'e.manga', 'General Practice', 'Family doctor for check-ups, minor illness and chronic conditions, with referrals when you need a specialist.'],
  ['Henri', 'Mouelle', 'h.mouelle', 'General Practice', 'General practitioner offering same-week consultations for adults and the whole family.'],
];
const STAFF: [string, string, string][] = [
  ['Joelle', 'Mbarga', 'joelle.mbarga'],
  ['Rodrigue', 'Ateba', 'rodrigue.ateba'],
];
const PATIENTS: [string, string, string][] = [
  ['Nadine', 'Ebong', 'nadine.ebong'],
  ['Kevin', 'Tabi', 'kevin.tabi'],
  ['Gisele', 'Ondoa', 'gisele.ondoa'],
  ['Yvan', 'Kamga', 'yvan.kamga'],
  ['Patience', 'Ngu', 'patience.ngu'],
  ['Armand', 'Fotso', 'armand.fotso'],
  ['Mireille', 'Essomba', 'mireille.essomba'],
  ['Collins', 'Achu', 'collins.achu'],
];
const REASONS: Record<string, string[]> = {
  dentistry: ['Teeth whitening', 'Sharp pain in a lower molar when I drink something cold'],
  cardiology: ['Chest tightness when I climb stairs', 'Follow-up on my blood pressure readings'],
  paediatrics: ['Routine check-up and vaccinations for my daughter'],
  neurology: ['Headaches most mornings for the past month'],
  ophthalmology: ['Blurry vision when reading, possibly need glasses'],
  gynaecology: ['Antenatal check-up, 28 weeks'],
  'infectious-diseases': ['Follow-up on my treatment and blood tests'],
  psychiatry: ['Trouble sleeping and feeling anxious for several weeks'],
  ent: ['Blocked ears and a sore throat that keeps returning'],
  'general-surgery': ['Second opinion before a hernia operation'],
};
const COMMENTS = [
  'Explained my results step by step and answered every question. Very reassuring.',
  'Gentle, thorough and the visit ran on time.',
  'Listened properly and the treatment worked within a week.',
  'Clear advice and a friendly manner. I would come back.',
  'Took the time to go through every option with me.',
  'Quick appointment, friendly and practical.',
];

// ------------------------------------------------------------------------------------------ helpers
let seed = 11;
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];

/** A wall-clock time at the hospital, `day` days from today, as an instant. */
function local(day: number, hour: number, minute = 0): Date {
  const shifted = new Date(Date.now() + 3600_000 + day * 86_400_000);
  const ymd = shifted.toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${UTC_OFFSET}`);
}
const weekdayAtHospital = (d: Date) => new Date(d.getTime() + 3600_000).getUTCDay();
const iso = (d: Date) => d.toISOString();

async function scanAll(table: string, extra: Record<string, any> = {}) {
  const out: Record<string, any>[] = [];
  let key: Record<string, any> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key, ...extra }));
    out.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  return out;
}

async function batchPut(table: string, items: Record<string, any>[]) {
  for (let i = 0; i < items.length; i += 25) {
    let request: Record<string, any> = { [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) };
    for (let attempt = 0; attempt < 6 && Object.keys(request).length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
      request = (await ddb.send(new BatchWriteCommand({ RequestItems: request }))).UnprocessedItems ?? {};
    }
    if (Object.keys(request).length) throw new Error(`Could not write every item to ${table}`);
  }
}

async function batchDelete(table: string, keys: Record<string, any>[]) {
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({ RequestItems: { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } })
    );
  }
}

// ------------------------------------------------------------------------------------------ what to create
interface Plan {
  hospital: { hospitalId: string; name: string; adminUserId: string };
  people: { role: 'DOCTOR' | 'STAFF' | 'PATIENT'; firstName: string; lastName: string; email: string; specialty?: string; bio?: string }[];
}

async function findHospital(): Promise<Plan['hospital']> {
  const approved = (await scanAll(T.hospitals, {
    FilterExpression: 'itemType = :p AND #s = :a',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':p': 'PROFILE', ':a': 'APPROVED' },
  })) as any[];
  if (!approved.length) {
    console.error('There is no approved hospital to attach the sample content to. Approve one first.');
    process.exit(1);
  }
  const h = approved.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return { hospitalId: h.hospitalId, name: h.name, adminUserId: h.adminUserId };
}

function buildPeople(): Plan['people'] {
  return [
    ...DOCTORS.map(([firstName, lastName, mail, specialty, bio]) => ({ role: 'DOCTOR' as const, firstName, lastName, email: `${mail}@example.com`, specialty, bio })),
    ...STAFF.map(([firstName, lastName, mail]) => ({ role: 'STAFF' as const, firstName, lastName, email: `${mail}@example.com` })),
    ...PATIENTS.map(([firstName, lastName, mail]) => ({ role: 'PATIENT' as const, firstName, lastName, email: `${mail}@example.com` })),
  ];
}

async function apply(dryRun: boolean) {
  const hospital = await findHospital();
  const people = buildPeople();

  const existing = (await scanAll(T.users, { FilterExpression: 'origin = :t', ExpressionAttributeValues: { ':t': TAG } })) as any[];
  if (existing.length) {
    console.error(`This content is already there (${existing.length} accounts). Run with --remove first to start over.`);
    process.exit(1);
  }
  const taken = (await scanAll(T.users, { ProjectionExpression: 'email' })).map((u) => u.email);
  const clash = people.find((p) => taken.includes(p.email));
  if (clash) {
    console.error(`An account with ${clash.email} already exists. Nothing was created.`);
    process.exit(1);
  }

  // ---- accounts: Cognito users nobody can sign in as, and their profile rows
  const ids = new Map<string, string>(); // email -> userId
  const createdAt = iso(new Date(Date.now() - 40 * 86_400_000));
  if (!dryRun) {
    for (const p of people) {
      const r = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: T.pool,
          Username: p.email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: p.email },
            { Name: 'email_verified', Value: 'true' },
          ],
        })
      );
      ids.set(p.email, r.User!.Attributes!.find((a) => a.Name === 'sub')!.Value!);
    }
  } else people.forEach((p) => ids.set(p.email, randomUUID()));

  const userRows = people.map((p) => ({
    userId: ids.get(p.email)!,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    role: p.role,
    ...(p.role !== 'PATIENT' ? { hospitalId: hospital.hospitalId } : {}),
    ...(p.role === 'DOCTOR' ? { bio: p.bio } : {}),
    createdAt,
    origin: TAG,
  }));
  const affiliationRows = people
    .filter((p) => p.role === 'DOCTOR')
    .map((p) => ({
      doctorId: ids.get(p.email)!,
      hospitalId: hospital.hospitalId,
      specialty: p.specialty,
      specialtyId: slug(p.specialty!),
      status: 'ACTIVE',
      createdAt,
      origin: TAG,
    }));

  const doctors = people.filter((p) => p.role === 'DOCTOR').map((p) => ({ id: ids.get(p.email)!, specialty: p.specialty!, general: p.specialty === 'General Practice' }));
  const patientIds = people.filter((p) => p.role === 'PATIENT').map((p) => ids.get(p.email)!);

  // ---- open sessions for the coming days: never closer to another session of the same doctor than the booking rule
  const STARTS: [number, number][] = [[8, 30], [9, 30], [10, 30], [11, 30], [14, 0], [15, 0], [16, 0]];
  const slots: Record<string, any>[] = [];
  const clashes = (doctorId: string, start: number, end: number) =>
    slots.some((s) => s.doctorId === doctorId && start < +new Date(s.endTime) + BUFFER_SAME_MIN * 6e4 && end > +new Date(s.startTime) - BUFFER_SAME_MIN * 6e4);
  for (let d = 0; d < DAYS_AHEAD; d++)
    doctors.forEach((doc, i) => {
      STARTS.forEach(([h, m], j) => {
        if ((d + i + j) % 7 > 3) return; // about four of the seven, a different four each day
        const start = local(d, h, m + (i % 3) * 10);
        const end = new Date(+start + (doc.general ? 20 : 30) * 6e4);
        const weekend = [0, 6].includes(weekdayAtHospital(start));
        if (!doc.general && weekend) return; // specialists do not consult at weekends
        if (+start < Date.now() + 45 * 6e4 || clashes(doc.id, +start, +end)) return;
        slots.push({
          hospitalId: hospital.hospitalId,
          slotId: randomUUID(),
          doctorId: doc.id,
          specialtyId: slug(doc.specialty),
          consultationType: doc.general ? 'GENERAL' : 'SPECIALIST',
          startTime: iso(start),
          endTime: iso(end),
          status: 'APPROVED',
          proposedBy: hospital.adminUserId,
          createdAt: iso(new Date(Date.now() - 86_400_000)),
          decidedAt: iso(new Date(Date.now() - 80_000_000)),
          origin: TAG,
        });
      });
    });

  // ---- booked sessions: some of the open ones are taken, with a confirmed (and paid) appointment
  const appointments: Record<string, any>[] = [];
  const payments: Record<string, any>[] = [];
  const reasonOf = (specialtyId: string) => (REASONS[specialtyId] && rnd() < 0.75 ? pick(REASONS[specialtyId]) : undefined);
  const record = (slot: { hospitalId: string; slotId: string; doctorId: string; specialtyId: string; consultationType: string; startTime: string; endTime: string }, patientId: string, status: string, createdAt: string) => {
    const appointmentId = randomUUID();
    const fee = slot.consultationType === 'GENERAL' ? 2000 : 3000;
    const note = slot.consultationType === 'SPECIALIST' ? reasonOf(slot.specialtyId) : undefined;
    appointments.push({
      appointmentId,
      itemType: 'METADATA',
      patientId,
      doctorId: slot.doctorId,
      hospitalId: slot.hospitalId,
      slotId: slot.slotId,
      consultationType: slot.consultationType,
      specialtyId: slot.specialtyId,
      fee,
      status,
      startTime: slot.startTime,
      endTime: slot.endTime,
      ...(note ? { note } : {}),
      // nobody is waiting for these reminders, so the reminder jobs must leave them alone
      emailReminderSent: true,
      smsReminderSent: true,
      createdAt,
      origin: TAG,
    });
    if (status !== 'CANCELLED') {
      payments.push({
        appointmentId,
        itemType: 'PAYMENT',
        paymentId: randomUUID(),
        amount: fee,
        paymentStatus: 'SUCCESS',
        provider: 'MOCK_MTN',
        transactionRef: randomUUID(),
        createdAt,
        updatedAt: createdAt,
        origin: TAG,
      });
    }
    return appointmentId;
  };
  let turn = 0;
  for (const slot of slots) {
    const days = (+new Date(slot.startTime) - Date.now()) / 86_400_000;
    if (days < 0.5 || days > 7 || rnd() > 0.13) continue; // about one in eight, from tomorrow on, so today stays open for real bookings
    slot.status = 'BOOKED';
    record(slot as any, patientIds[turn++ % patientIds.length], 'CONFIRMED', iso(new Date(Date.now() - 3600_000 * (2 + (turn % 20)))));
  }

  // ---- history, for the statistics and the doctors' ratings
  const finished: { appointmentId: string; doctorId: string; patientId: string; startTime: string }[] = [];
  for (let d = -DAYS_BACK; d <= 0; d++) {
    const n = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const doc = pick(doctors);
      const start = local(d, 8 + Math.floor(rnd() * 9), pick([0, 20, 40]));
      if (weekdayAtHospital(start) === 0 || (!doc.general && weekdayAtHospital(start) === 6)) continue;
      if (+start > Date.now() - 3 * 3600_000) continue;
      const r = rnd();
      const status = r < 0.7 ? 'COMPLETED' : r < 0.83 ? 'MISSED' : 'CANCELLED';
      const patientId = pick(patientIds);
      const slot = {
        hospitalId: hospital.hospitalId,
        slotId: `past-${randomUUID()}`,
        doctorId: doc.id,
        specialtyId: slug(doc.specialty),
        consultationType: doc.general ? 'GENERAL' : 'SPECIALIST',
        startTime: iso(start),
        endTime: iso(new Date(+start + (doc.general ? 20 : 30) * 6e4)),
      };
      const id = record(slot, patientId, status, iso(new Date(+start - 3 * 86_400_000)));
      if (status === 'COMPLETED') finished.push({ appointmentId: id, doctorId: doc.id, patientId, startTime: slot.startTime });
    }
  }
  const reviews = finished
    .filter(() => rnd() < 0.3)
    .map((f) => ({
      reviewId: randomUUID(),
      doctorId: f.doctorId,
      patientId: f.patientId,
      appointmentId: f.appointmentId,
      rating: rnd() < 0.75 ? 5 : 4,
      comment: pick(COMMENTS),
      createdAt: iso(new Date(+new Date(f.startTime) + 6 * 3600_000)),
      origin: TAG,
    }));

  const booked = slots.filter((s) => s.status === 'BOOKED').length;
  const upcoming = appointments.filter((a) => a.status === 'CONFIRMED').length;
  console.log(`${dryRun ? 'Would create' : 'Creating'} for ${hospital.name}:`);
  console.log(`  ${doctors.length} doctors (${new Set(doctors.map((d) => d.specialty)).size} specialties), ${STAFF.length} staff, ${PATIENTS.length} patients`);
  console.log(`  ${slots.length} open sessions (${booked} of them booked), ${upcoming} upcoming appointments`);
  console.log(`  ${appointments.length - upcoming} past appointments, ${reviews.length} reviews`);
  if (dryRun) return console.log('\nNothing was written. Run again with --apply to create it.');

  await batchPut(T.users, userRows);
  await batchPut(T.affiliations, affiliationRows);
  await batchPut(T.availability, slots);
  await batchPut(T.appointments, [...appointments, ...payments]);
  await batchPut(T.reviews, reviews);
  console.log('\nDone.');
}

async function remove() {
  const users = (await scanAll(T.users, { FilterExpression: 'origin = :t', ExpressionAttributeValues: { ':t': TAG } })) as any[];
  const byTag = (table: string) => scanAll(table, { FilterExpression: 'origin = :t', ExpressionAttributeValues: { ':t': TAG } });

  const appts = await byTag(T.appointments);
  const ids = [...new Set(appts.map((a) => a.appointmentId))];
  await batchDelete(T.appointments, ids.flatMap((appointmentId) => [{ appointmentId, itemType: 'METADATA' }, { appointmentId, itemType: 'PAYMENT' }]));

  const slots = await byTag(T.availability);
  await batchDelete(T.availability, slots.map((s) => ({ hospitalId: s.hospitalId, slotId: s.slotId })));
  const reviews = await byTag(T.reviews);
  await batchDelete(T.reviews, reviews.map((r) => ({ doctorId: r.doctorId, appointmentId: r.appointmentId })));
  const affs = await byTag(T.affiliations);
  await batchDelete(T.affiliations, affs.map((a) => ({ doctorId: a.doctorId, hospitalId: a.hospitalId })));

  let notices = 0;
  for (const u of users) {
    const rows = (await ddb.send(new QueryCommand({ TableName: T.notifications, KeyConditionExpression: 'recipientId = :r', ExpressionAttributeValues: { ':r': u.userId } }))).Items ?? [];
    await batchDelete(T.notifications, rows.map((n) => ({ recipientId: n.recipientId, notificationId: n.notificationId })));
    notices += rows.length;
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: T.pool, Username: u.email })).catch((e) => {
      if (e.name !== 'UserNotFoundException') throw e;
    });
  }
  await batchDelete(T.users, users.map((u) => ({ userId: u.userId })));
  console.log(`Removed ${users.length} accounts, ${ids.length} appointments, ${slots.length} sessions, ${reviews.length} reviews and ${notices} notifications.`);
}

const flag = process.argv[2];
(flag === '--remove' ? remove() : apply(flag !== '--apply')).catch((e) => {
  console.error(e);
  process.exit(1);
});
