/** Human-readable text for each notification type. Used by the delivery worker and the notifications API. */
export function buildMessage(type: string, payload: Record<string, any>): { subject: string; body: string } {
  const when = payload.startTime ? ` on ${new Date(payload.startTime).toUTCString()}` : '';
  switch (type) {
    case 'BOOKING_CONFIRMATION':
      return { subject: 'Appointment confirmed', body: `Your appointment ${payload.appointmentId}${when} is confirmed.` };
    case 'PAYMENT_RESULT':
      return {
        subject: 'Payment update',
        body: `Payment of ${payload.amount} for appointment ${payload.appointmentId}: ${payload.paymentStatus}.`,
      };
    case 'CANCELLATION':
      return { subject: 'Appointment cancelled', body: `Your appointment ${payload.appointmentId}${when} was cancelled.` };
    case 'RESCHEDULE':
      return {
        subject: 'Appointment rescheduled',
        body: `Your appointment has been rescheduled${when}. New appointment: ${payload.newAppointmentId}.`,
      };
    case 'MISSED':
      return { subject: 'Appointment missed', body: `You missed your appointment ${payload.appointmentId}${when}.` };
    case 'WAITLIST_OFFER':
      return {
        subject: 'A slot is available',
        body:
          `A slot${when} has opened up. Claim it before ${payload.offerExpiresAt} ` +
          `using your waitlist entry ${payload.waitlistId}.`,
      };
    case 'APPOINTMENT_REMINDER':
      return {
        subject: 'Upcoming appointment reminder',
        body: `Reminder: your appointment ${payload.appointmentId} starts${when || ` at ${payload.startTime}`}.`,
      };
    case 'SLOT_PROPOSED':
      return {
        subject: 'A new availability slot needs your approval',
        body:
          payload.count > 1
            ? `A hospital proposed ${payload.count} availability slots between ${payload.startTime} and ${payload.endTime}. ` +
              'Open MediCue to approve or reject each one.'
            : `A hospital proposed a slot from ${payload.startTime} to ${payload.endTime}. ` +
              `Approve or reject it (hospitalId ${payload.hospitalId}, slotId ${payload.slotId}).`,
      };
    case 'SESSION_COMPLETED':
      return {
        subject: 'How was your visit?',
        body: `Your session${when} is complete. You can now leave a review of your doctor in MediCue (Appointments, then History). It helps other patients choose.`,
      };
    case 'HOSPITAL_REVIEWED':
      return {
        subject: 'Your hospital registration was reviewed',
        body: `Your registration of ${payload.hospitalName} was ${String(payload.decision).toLowerCase()}.`,
      };
    default:
      return { subject: 'MediCue notification', body: JSON.stringify(payload) };
  }
}
