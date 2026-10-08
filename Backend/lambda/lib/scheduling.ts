import { queryAll } from './db';
import { MAX_SLOT_HOURS } from './constants';

export const SAME_HOSPITAL_BUFFER_MINUTES = 10;
export const DIFFERENT_HOSPITAL_BUFFER_MINUTES = 90;

/** Slots that occupy the doctor's time. PENDING proposals are resolved at approval time. */
export const ACTIVE_SLOT_STATUSES = ['APPROVED', 'BOOKED', 'OFFERED'];

export function hasConflict(
  newStart: string,
  newEnd: string,
  existingStart: string,
  existingEnd: string,
  bufferMinutes: number
): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  const paddedExistingStart = new Date(new Date(existingStart).getTime() - bufferMs).toISOString();
  const paddedExistingEnd = new Date(new Date(existingEnd).getTime() + bufferMs).toISOString();
  return newStart < paddedExistingEnd && newEnd > paddedExistingStart;
}

export function bufferFor(sameHospital: boolean) {
  return sameHospital ? SAME_HOSPITAL_BUFFER_MINUTES : DIFFERENT_HOSPITAL_BUFFER_MINUTES;
}

/**
 * Returns an existing active slot of the doctor that overlaps or is too close to the given window.
 * With `includePendingOfHospital`, this hospital's own unanswered proposals count as well (used when
 * proposing, so one hospital cannot stack overlapping proposals); other hospitals' proposals never block.
 */
export async function findDoctorConflict(
  availabilityTable: string,
  doctorId: string,
  hospitalId: string,
  startTime: string,
  endTime: string,
  excludeSlotId?: string,
  includePendingOfHospital = false
) {
  const lookAheadMs = DIFFERENT_HOSPITAL_BUFFER_MINUTES * 60 * 1000;
  const from = new Date(new Date(startTime).getTime() - lookAheadMs - MAX_SLOT_HOURS * 3600 * 1000).toISOString();
  const to = new Date(new Date(endTime).getTime() + lookAheadMs).toISOString();

  const nearby = await queryAll({
    TableName: availabilityTable,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d AND startTime BETWEEN :from AND :to',
    ExpressionAttributeValues: { ':d': doctorId, ':from': from, ':to': to },
  });

  return nearby.find((slot) => {
    if (slot.slotId === excludeSlotId) return false;
    const blocks =
      ACTIVE_SLOT_STATUSES.includes(slot.status) ||
      (includePendingOfHospital && slot.status === 'PENDING' && slot.hospitalId === hospitalId);
    if (!blocks) return false;
    return hasConflict(startTime, endTime, slot.startTime, slot.endTime, bufferFor(slot.hospitalId === hospitalId));
  });
}
