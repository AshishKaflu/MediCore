import { db } from './db';
import { supabase } from './supabase';
import { generateId } from './id';

const hasSupabaseKeys = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

let isSyncing = false;
let caregiverSyncTimer: ReturnType<typeof setTimeout> | null = null;
let patientSyncTimer: ReturnType<typeof setTimeout> | null = null;
let caregiverSyncInFlight: Promise<void> | null = null;
let patientSyncInFlight: Promise<void> | null = null;
let caregiverSyncQueued = false;
let patientSyncQueued = false;

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function normalizeLocalIds(caregiverId?: string) {
  // Supabase uses UUID columns; if local IDs are not UUID-shaped, sync will fail.
  // This migrates local IDs to UUIDs and updates references.
  await db.transaction('rw', db.patients, db.medications, db.medication_logs, async () => {
    const patients = caregiverId
      ? await db.patients.where('caregiver_id').equals(caregiverId).toArray()
      : await db.patients.toArray();

    const patientIdMap = new Map<string, string>();
    for (const p of patients) {
      if (isUuid(p.id)) continue;
      const newId = generateId();
      patientIdMap.set(p.id, newId);
      await db.patients.add({ ...p, id: newId });
      await db.patients.delete(p.id);
    }

    if (patientIdMap.size > 0) {
      for (const [oldId, newId] of patientIdMap) {
        await db.medications.where('patient_id').equals(oldId).modify({ patient_id: newId });
        await db.medication_logs.where('patient_id').equals(oldId).modify({ patient_id: newId });
      }
    }

    const patientIds = caregiverId
      ? (await db.patients.where('caregiver_id').equals(caregiverId).toArray()).map(p => p.id)
      : (await db.patients.toArray()).map(p => p.id);

    const meds =
      patientIds.length > 0 ? await db.medications.where('patient_id').anyOf(patientIds).toArray() : [];

    const medIdMap = new Map<string, string>();
    for (const m of meds) {
      if (isUuid(m.id)) continue;
      const newId = generateId();
      medIdMap.set(m.id, newId);
      await db.medications.add({ ...m, id: newId });
      await db.medications.delete(m.id);
    }

    if (medIdMap.size > 0) {
      for (const [oldId, newId] of medIdMap) {
        await db.medication_logs.where('medication_id').equals(oldId).modify({ medication_id: newId });
      }
    }

    const logs =
      patientIds.length > 0 ? await db.medication_logs.where('patient_id').anyOf(patientIds).toArray() : [];
    for (const l of logs) {
      if (isUuid(l.id)) continue;
      const newId = generateId();
      await db.medication_logs.add({ ...l, id: newId });
      await db.medication_logs.delete(l.id);
    }
  });
}

// Pull all data from Supabase and hydrate local Dexie
export async function pullFromCloud(caregiverId: string): Promise<{ patients: number; medications: number; logs: number; error?: string }> {
  if (!hasSupabaseKeys) return { patients: 0, medications: 0, logs: 0, error: 'Supabase keys missing' };
  if (isSyncing) return { patients: 0, medications: 0, logs: 0 };

  try {
    isSyncing = true;
    
    // 1. Pull Patients
    const { data: patients, error: pErr } = await supabase
      .from('patients')
      .select('*')
      .eq('caregiver_id', caregiverId);
    if (pErr) throw pErr;
    // Merge strategy: do not delete local data when cloud is empty (prevents accidental wipe).
    if (patients && patients.length > 0) await db.patients.bulkPut(patients);

    // 2. Pull Medications
    const tempPatientIds = patients?.map(p => p.id) || [];
    let medicationCount = 0;
    let logCount = 0;
    if (tempPatientIds.length > 0) {
      const { data: medications, error: mErr } = await supabase
        .from('medications')
        .select('*')
        .in('patient_id', tempPatientIds);
      if (mErr) throw mErr;
      if (medications && medications.length > 0) {
         medicationCount = medications.length;
         await db.medications.bulkPut(medications);
      }

      // 3. Pull Logs
      const tempMedIds = medications?.map(m => m.id) || [];
      if (tempMedIds.length > 0) {
          const { data: logs, error: lErr } = await supabase
             .from('medication_logs')
             .select('*')
             .in('medication_id', tempMedIds);
          if (lErr) throw lErr;
          if (logs && logs.length > 0) {
              logCount = logs.length;
              await db.medication_logs.bulkPut(logs);
          }
      }
    }

    return { patients: patients?.length || 0, medications: medicationCount, logs: logCount };
  } catch (error) {
    console.error('Failed to pull from cloud:', error);
    return { patients: 0, medications: 0, logs: 0, error: (error as any)?.message || 'Failed to pull from cloud' };
  } finally {
    isSyncing = false;
  }
}

// Pull a single patient's data (patient + their medications + logs).
// Used for patient PIN login on new devices.
export async function pullPatientFromCloud(patientId: string) {
  if (!hasSupabaseKeys) return;
  if (isSyncing) return;

  try {
    isSyncing = true;

    const { data: patient, error: pErr } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!patient) return;

    const { data: medications, error: mErr } = await supabase
      .from('medications')
      .select('*')
      .eq('patient_id', patientId);
    if (mErr) throw mErr;

    const { data: logs, error: lErr } = await supabase
      .from('medication_logs')
      .select('*')
      .eq('patient_id', patientId);
    if (lErr) throw lErr;
    // Merge strategy to avoid wiping local meds/logs if cloud is empty or out-of-date.
    await db.patients.put(patient);
    if (medications && medications.length > 0) await db.medications.bulkPut(medications);
    if (logs && logs.length > 0) await db.medication_logs.bulkPut(logs);
  } catch (error) {
    console.error('Failed to pull patient from cloud:', error);
  } finally {
    isSyncing = false;
  }
}

// Push all local data to Supabase (Overwrite strategy)
export async function pushToCloud(caregiverId?: string): Promise<{ patients: number; medications: number; logs: number; error?: string }> {
  if (!hasSupabaseKeys) return { patients: 0, medications: 0, logs: 0, error: 'Supabase keys missing' };
  
  try {
    await normalizeLocalIds(caregiverId);

    let patients = await db.patients.toArray();
    let medications = await db.medications.toArray();
    let logs = await db.medication_logs.toArray();

    // When we don't know the caregiver (e.g. patient portal marking a dose as taken),
    // never upsert patients. Some legacy schemas enforce foreign keys on caregiver columns,
    // and patient devices shouldn't be creating/updating patient identity records anyway.
    if (!caregiverId) {
      patients = [];
    }

    // Optional scoping: only push data for a single caregiver.
    // This prevents one caregiver on a shared device from pushing another caregiver's local data.
    if (caregiverId) {
      patients = patients.filter((p) => p.caregiver_id === caregiverId);
      const patientIds = new Set(patients.map(p => p.id));
      medications = medications.filter(m => patientIds.has(m.patient_id));
      logs = logs.filter(l => patientIds.has(l.patient_id));
    }

    // Upsert Patients
    if (patients.length > 0) {
      const { error } = await supabase.from('patients').upsert(patients);
      if (error) throw error;
    }

    // Upsert Medications
    if (medications.length > 0) {
      const { error } = await supabase.from('medications').upsert(medications);
      if (error) throw error;
    }

    // Upsert Logs
    if (logs.length > 0) {
      const { error } = await supabase.from('medication_logs').upsert(logs);
      if (error) throw error;
    }

    return { patients: patients.length, medications: medications.length, logs: logs.length };
  } catch (error) {
    console.error('Failed to push to cloud:', error);
    return { patients: 0, medications: 0, logs: 0, error: (error as any)?.message || 'Failed to push to cloud' };
  }
}

// Delete helpers to sync removed elements out of the cloud
export async function deletePatientCloud(id: string, caregiverId?: string) {
  if (!hasSupabaseKeys) return;
  try {
    let query = supabase.from('patients').delete().eq('id', id);
    if (caregiverId) query = query.eq('caregiver_id', caregiverId);
    await query;
  } catch (e) {
    console.error('Failed to delete patient cloud', e);
  }
}

export async function deleteMedicationCloud(id: string) {
  if (!hasSupabaseKeys) return;
  try {
    await supabase.from('medications').delete().eq('id', id);
  } catch (e) {
    console.error('Failed to delete medication cloud', e);
  }
}

export async function deleteMedicationLogCloud(id: string) {
  if (!hasSupabaseKeys) return;
  try {
    await supabase.from('medication_logs').delete().eq('id', id);
  } catch (e) {
    console.error('Failed to delete medication log cloud', e);
  }
}

export async function refreshCaregiverData(caregiverId: string) {
  if (!caregiverId) return;
  return pullFromCloud(caregiverId);
}

export async function refreshPatientData(patientId: string) {
  if (!patientId) return;
  return pullPatientFromCloud(patientId);
}

export function scheduleCaregiverSync(caregiverId: string, delayMs = 500) {
  if (!caregiverId || !hasSupabaseKeys) return;
  if (caregiverSyncTimer) clearTimeout(caregiverSyncTimer);

  caregiverSyncTimer = setTimeout(() => {
    caregiverSyncTimer = null;
    if (caregiverSyncInFlight) {
      caregiverSyncQueued = true;
      return;
    }

    caregiverSyncInFlight = (async () => {
      try {
        const pushRes = await pushToCloud(caregiverId);
        if (pushRes.error) {
          console.error('Caregiver sync push failed', pushRes.error);
          return;
        }
        await pullFromCloud(caregiverId);
      } finally {
        caregiverSyncInFlight = null;
        if (caregiverSyncQueued) {
          caregiverSyncQueued = false;
          scheduleCaregiverSync(caregiverId, 150);
        }
      }
    })();
  }, delayMs);
}

export function schedulePatientSync(patientId: string, delayMs = 500) {
  if (!patientId || !hasSupabaseKeys) return;
  if (patientSyncTimer) clearTimeout(patientSyncTimer);

  patientSyncTimer = setTimeout(() => {
    patientSyncTimer = null;
    if (patientSyncInFlight) {
      patientSyncQueued = true;
      return;
    }

    patientSyncInFlight = (async () => {
      try {
        const pushRes = await pushToCloud();
        if (pushRes.error) {
          console.error('Patient sync push failed', pushRes.error);
          return;
        }
        await pullPatientFromCloud(patientId);
      } finally {
        patientSyncInFlight = null;
        if (patientSyncQueued) {
          patientSyncQueued = false;
          schedulePatientSync(patientId, 150);
        }
      }
    })();
  }, delayMs);
}
