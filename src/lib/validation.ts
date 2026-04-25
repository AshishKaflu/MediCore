import type { Medication, MedicationLog, Patient } from './db';

const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 80;
const DESIGNATION_MAX_LENGTH = 16;
const DOSAGE_MAX_LENGTH = 80;
const MEDICATION_NAME_MAX_LENGTH = 120;
const NOTES_MAX_LENGTH = 2000;
const PHOTO_URL_MAX_LENGTH = 2048;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeEmail(value: string): string {
  return collapseWhitespace(value).toLowerCase().slice(0, EMAIL_MAX_LENGTH);
}

export function sanitizeShortText(value: string, maxLength: number): string {
  return collapseWhitespace(value).slice(0, maxLength);
}

export function sanitizeMultilineText(value: string, maxLength = NOTES_MAX_LENGTH): string {
  return value.trim().slice(0, maxLength);
}

export function sanitizePin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function isValidIsoDate(value?: string | null): boolean {
  if (!value) return true;
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

export function isValidTime(value: string): boolean {
  return timePattern.test(value);
}

export function validateCaregiverCredentials(input: {
  email: string;
  password: string;
  name?: string;
  isSignUp?: boolean;
}): { email: string; password: string; name: string } {
  const email = normalizeEmail(input.email);
  const password = input.password.trim();
  const name = sanitizeShortText(input.name || '', NAME_MAX_LENGTH);

  if (!email) {
    throw new Error('Please enter your email');
  }

  if (!password) {
    throw new Error('Please enter your password');
  }

  if (input.isSignUp) {
    if (name.length < 2) {
      throw new Error('Please enter your full name');
    }

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
  }

  return { email, password, name };
}

export function validatePatientPin(pin: string): string {
  const normalizedPin = sanitizePin(pin);
  if (normalizedPin.length < 4 || normalizedPin.length > 6) {
    throw new Error('PIN must be 4 to 6 digits');
  }
  return normalizedPin;
}

export function sanitizePatientInput(input: {
  first_name: string;
  last_name: string;
  dob?: string;
  notes?: string;
  pin?: string;
  designation?: string;
  photo?: string;
}): Pick<Patient, 'first_name' | 'last_name' | 'dob' | 'notes' | 'pin' | 'designation' | 'photo'> {
  const firstName = sanitizeShortText(input.first_name, NAME_MAX_LENGTH);
  const lastName = sanitizeShortText(input.last_name, NAME_MAX_LENGTH);
  const dob = (input.dob || '').trim();
  const notes = sanitizeMultilineText(input.notes || '');
  const pin = sanitizePin(input.pin || '');
  const designation = sanitizeShortText(input.designation || '', DESIGNATION_MAX_LENGTH);
  const photo = typeof input.photo === 'string' ? input.photo.slice(0, PHOTO_URL_MAX_LENGTH) : '';

  if (!firstName) {
    throw new Error('First name is required');
  }

  if (!lastName) {
    throw new Error('Last name is required');
  }

  if (!isValidIsoDate(dob)) {
    throw new Error('Date of birth is invalid');
  }

  if (pin && (pin.length < 4 || pin.length > 6)) {
    throw new Error('Patient PIN must be 4 to 6 digits');
  }

  return {
    first_name: firstName,
    last_name: lastName,
    dob,
    notes,
    pin: pin || '',
    designation,
    photo,
  };
}

export function sanitizeMedicationInput(input: {
  name: string;
  dosage: string;
  type: string;
  interval: Medication['interval'];
  intervalDays: number;
  startDate: string;
  timings: string[];
  inventoryCount: number;
  refillReminderAt: number;
  photo: string;
}): {
  name: string;
  dosage: string;
  type: string;
  interval: NonNullable<Medication['interval']>;
  intervalDays?: number;
  startDate: string;
  timings: string[];
  inventoryCount: number;
  refillReminderAt: number;
  photo: string;
} {
  const name = sanitizeShortText(input.name, MEDICATION_NAME_MAX_LENGTH);
  const dosage = sanitizeShortText(input.dosage, DOSAGE_MAX_LENGTH);
  const type = sanitizeShortText(input.type, 32) || 'tablet';
  const startDate = input.startDate.trim();
  const timings = input.timings.map((time) => time.trim()).filter(Boolean);
  const inventoryCount = Number.isFinite(input.inventoryCount) ? Math.max(0, Math.floor(input.inventoryCount)) : 0;
  const refillReminderAt = Number.isFinite(input.refillReminderAt) ? Math.max(0, Math.floor(input.refillReminderAt)) : 0;
  const intervalDays = Number.isFinite(input.intervalDays) ? Math.max(1, Math.floor(input.intervalDays)) : 1;
  const photo = typeof input.photo === 'string' ? input.photo.slice(0, PHOTO_URL_MAX_LENGTH) : '';

  if (!name) {
    throw new Error('Medication name is required');
  }

  if (!dosage) {
    throw new Error('Dosage is required');
  }

  if (!isValidIsoDate(startDate)) {
    throw new Error('Start date is invalid');
  }

  if (timings.length === 0) {
    throw new Error('Add at least one time');
  }

  if (timings.some((time) => !isValidTime(time))) {
    throw new Error('One or more medication times are invalid');
  }

  if (input.interval === 'x_days' && intervalDays < 1) {
    throw new Error('Custom interval must be at least 1 day');
  }

  return {
    name,
    dosage,
    type,
    interval: input.interval || 'daily',
    intervalDays: input.interval === 'x_days' ? intervalDays : undefined,
    startDate,
    timings,
    inventoryCount,
    refillReminderAt,
    photo,
  };
}

export function sanitizeImportedPatient(
  patient: Partial<Patient>,
  caregiverId: string
): Patient | null {
  if (!patient.id || typeof patient.id !== 'string') return null;

  try {
    const sanitized = sanitizePatientInput({
      first_name: patient.first_name || '',
      last_name: patient.last_name || '',
      dob: patient.dob || '',
      notes: patient.notes || '',
      pin: patient.pin || '',
      designation: patient.designation || '',
      photo: patient.photo || '',
    });

    return {
      id: patient.id,
      caregiver_id: caregiverId,
      first_name: sanitized.first_name,
      last_name: sanitized.last_name,
      dob: sanitized.dob,
      notes: sanitized.notes,
      status: patient.status === 'archived' ? 'archived' : 'active',
      pin: sanitized.pin || undefined,
      designation: sanitized.designation || undefined,
      photo: sanitized.photo || undefined,
      created_at: typeof patient.created_at === 'string' ? patient.created_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function sanitizeImportedMedication(medication: Partial<Medication>): Medication | null {
  if (!medication.id || !medication.patient_id) return null;

  try {
    const sanitized = sanitizeMedicationInput({
      name: medication.name || '',
      dosage: medication.dosage || '',
      type: medication.type || medication.form || 'tablet',
      interval: medication.interval || 'daily',
      intervalDays: medication.interval_days || 1,
      startDate: medication.start_date || new Date().toISOString().slice(0, 10),
      timings: (medication.timing || '08:00').split(','),
      inventoryCount: medication.inventory_count ?? 0,
      refillReminderAt: medication.refill_reminder_at ?? 0,
      photo: medication.photo || '',
    });

    return {
      id: medication.id,
      patient_id: medication.patient_id,
      name: sanitized.name,
      dosage: sanitized.dosage,
      frequency:
        medication.frequency ||
        (sanitized.interval === 'daily' ? `${sanitized.timings.length}x daily` : sanitized.interval),
      form: sanitized.type,
      type: sanitized.type,
      timing: sanitized.timings.join(','),
      interval: sanitized.interval,
      interval_days: sanitized.intervalDays,
      start_date: sanitized.startDate,
      photo: sanitized.photo || undefined,
      inventory_count: sanitized.inventoryCount,
      refill_reminder_at: sanitized.refillReminderAt,
      created_at: typeof medication.created_at === 'string' ? medication.created_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function sanitizeImportedMedicationLog(log: Partial<MedicationLog>): MedicationLog | null {
  if (!log.id || !log.patient_id || !log.medication_id || !log.taken_at) return null;
  if (log.status !== 'taken' && log.status !== 'missed' && log.status !== 'skipped') return null;

  return {
    id: log.id,
    patient_id: log.patient_id,
    medication_id: log.medication_id,
    status: log.status,
    taken_at: String(log.taken_at),
    notes: typeof log.notes === 'string' ? sanitizeMultilineText(log.notes, 300) : undefined,
  };
}
