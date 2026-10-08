export const HOLD_EXPIRY_MINUTES = 5;
export const OFFER_CLAIM_MINUTES = 15;
export const PATIENT_RESCHEDULE_CUTOFF_HOURS = 2;
export const MAX_PENDING_HOLDS_PER_PATIENT = 2;
export const MAX_SLOT_HOURS = 12;
export const MAX_SLOTS_PER_PROPOSAL = 5;
/** Longest "what are you coming in for" note a patient can add to a specialist appointment. */
export const MAX_VISIT_NOTE_CHARS = 500;

export const CONSULTATION_TYPES = ['GENERAL', 'SPECIALIST'] as const;
export type ConsultationType = (typeof CONSULTATION_TYPES)[number];

const FEES: Record<ConsultationType, number> = { GENERAL: 2000, SPECIALIST: 3000 };

export function getAmount(consultationType: string | undefined): number {
  return FEES[(consultationType as ConsultationType) ?? 'GENERAL'] ?? FEES.GENERAL;
}

/** Roles an account can have. STAFF are hospital employees (reception) who check patients in. */
export const ROLES = ['PATIENT', 'DOCTOR', 'STAFF', 'HOSPITAL_ADMIN', 'PLATFORM_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Largest number of accounts accepted by one bulk-create request (API Gateway allows 29 s per request). */
export const MAX_BULK_USERS = 50;
