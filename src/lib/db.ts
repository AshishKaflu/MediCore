import Dexie, { type EntityTable } from 'dexie';

export interface Patient {
  id: string;
  caregiver_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  notes: string;
  status?: 'active' | 'archived';
  pin?: string;
  designation?: string;
  photo?: string;
  created_at: string;
}

export interface Medication {
  id: string;
  patient_id: string;
  name: string;
  dosage: string;
  frequency: string; // Legacy, keep for compatibility or just keep around
  type?: string; // 'tablet', 'liquid', 'injection', etc.
  timing?: string; // comma-joined times, e.g., '08:00,20:00'
  interval?: 'daily' | 'alternate' | 'x_days'; 
  interval_days?: number; // used if interval === 'x_days'
  start_date?: string; // YYYY-MM-DD anchor for interval schedules
  photo?: string; // base64 representation of the image
  inventory_count: number;
  refill_reminder_at: number;
  created_at: string;
}

export interface MedicationLog {
  id: string;
  medication_id: string;
  patient_id: string;
  status: 'taken' | 'missed' | 'skipped';
  taken_at: string; // ISO string
  notes?: string;
}

const db = new Dexie('MedManageDB') as Dexie & {
  patients: EntityTable<Patient, 'id'>;
  medications: EntityTable<Medication, 'id'>;
  medication_logs: EntityTable<MedicationLog, 'id'>;
};

// Schema definition
db.version(1).stores({
  patients: 'id, caregiver_id',
  medications: 'id, patient_id',
  medication_logs: 'id, patient_id, medication_id, taken_at'
});

export { db };
