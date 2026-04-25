-- Supabase Database Schema Migration File
-- Copy/paste into Supabase SQL Editor and run.
--
-- Canonical schema used by the app:
--   caregivers, patients, medications, medication_logs
--
-- This version intentionally removes legacy compatibility layers so the
-- application and database both rely on one clean structure.

-- ==========================================
-- 0. OPTIONAL: WIPE EXISTING DATA
-- ==========================================
-- Run ONLY if you want to delete all rows:
/*
TRUNCATE TABLE public.medication_logs CASCADE;
TRUNCATE TABLE public.medications CASCADE;
TRUNCATE TABLE public.patients CASCADE;
TRUNCATE TABLE public.caregivers CASCADE;
*/

-- ==========================================
-- 1. Extensions
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 2. Cleanup Legacy Objects
-- ==========================================
-- Older versions used `patient` or `primary_caregiver_id`.
-- We drop those legacy paths so sync logic stays predictable.

DROP TRIGGER IF EXISTS trg_sync_patient_caregiver_ids ON public.patients;
DROP FUNCTION IF EXISTS public.sync_patient_caregiver_ids();

DO $$
BEGIN
  IF to_regclass('public.patient') IS NOT NULL AND to_regclass('public.patients') IS NULL THEN
    ALTER TABLE public.patient RENAME TO patients;
  END IF;
END $$;

-- ==========================================
-- 3. Core Tables
-- ==========================================

CREATE TABLE IF NOT EXISTS public.caregivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES public.caregivers(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  dob TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  pin TEXT,
  designation TEXT DEFAULT '',
  photo TEXT,
  allergies TEXT,
  emergency_notes TEXT,
  timezone TEXT,
  photo_url TEXT,
  pin_enabled BOOLEAN,
  pin_hash TEXT,
  date_of_birth TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS caregiver_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS dob TEXT DEFAULT '';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS pin TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS designation TEXT DEFAULT '';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS emergency_notes TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS pin_enabled BOOLEAN;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Migrate any leftover legacy column into the canonical caregiver_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patients'
      AND column_name = 'primary_caregiver_id'
  ) THEN
    EXECUTE '
      UPDATE public.patients
      SET caregiver_id = COALESCE(caregiver_id, primary_caregiver_id)
      WHERE caregiver_id IS NULL
    ';
    EXECUTE 'ALTER TABLE public.patients DROP COLUMN primary_caregiver_id';
  END IF;
END $$;

ALTER TABLE public.patients ALTER COLUMN caregiver_id SET NOT NULL;
ALTER TABLE public.patients ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE public.patients ALTER COLUMN last_name SET NOT NULL;
ALTER TABLE public.patients ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.patients ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_caregiver_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_caregiver_id_fkey
      FOREIGN KEY (caregiver_id) REFERENCES public.caregivers(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_caregiver_id ON public.patients(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_patients_pin ON public.patients(pin);

CREATE TABLE IF NOT EXISTS public.medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  frequency TEXT DEFAULT '',
  type TEXT,
  form TEXT,
  timing TEXT,
  interval TEXT,
  interval_days INTEGER,
  start_date TEXT,
  photo TEXT,
  prn BOOLEAN,
  generic_name TEXT,
  condition_reason TEXT,
  strength_value TEXT,
  strength_unit TEXT,
  created_by UUID,
  updated_by UUID,
  updated_at TIMESTAMPTZ,
  photo_url TEXT,
  inventory_count INTEGER NOT NULL DEFAULT 0,
  refill_reminder_at INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS patient_id UUID;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS dosage TEXT DEFAULT '';
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT '';
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS form TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS timing TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS interval TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS interval_days INTEGER;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS start_date TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS prn BOOLEAN;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS generic_name TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS condition_reason TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS strength_value TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS strength_unit TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS inventory_count INTEGER DEFAULT 0;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS refill_reminder_at INTEGER DEFAULT 0;
ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.medications ALTER COLUMN patient_id SET NOT NULL;
ALTER TABLE public.medications ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.medications ALTER COLUMN dosage SET NOT NULL;
ALTER TABLE public.medications ALTER COLUMN inventory_count SET NOT NULL;
ALTER TABLE public.medications ALTER COLUMN refill_reminder_at SET NOT NULL;
ALTER TABLE public.medications ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medications_patient_id_fkey'
  ) THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_patient_id_fkey
      FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medications_patient_id ON public.medications(patient_id);

CREATE TABLE IF NOT EXISTS public.medication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  notes TEXT
);

ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS medication_id UUID;
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS patient_id UUID;
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS taken_at TEXT;
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.medication_logs ALTER COLUMN medication_id SET NOT NULL;
ALTER TABLE public.medication_logs ALTER COLUMN patient_id SET NOT NULL;
ALTER TABLE public.medication_logs ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.medication_logs ALTER COLUMN taken_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medication_logs_medication_id_fkey'
  ) THEN
    ALTER TABLE public.medication_logs
      ADD CONSTRAINT medication_logs_medication_id_fkey
      FOREIGN KEY (medication_id) REFERENCES public.medications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medication_logs_patient_id_fkey'
  ) THEN
    ALTER TABLE public.medication_logs
      ADD CONSTRAINT medication_logs_patient_id_fkey
      FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medication_logs_patient_id ON public.medication_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_logs_medication_id ON public.medication_logs(medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_logs_taken_at ON public.medication_logs(taken_at);

-- ==========================================
-- 4. RPCs (Custom Auth)
-- ==========================================

CREATE OR REPLACE FUNCTION public.register_caregiver(p_email TEXT, p_password TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO public.caregivers (email, password_hash, name)
  VALUES (p_email, crypt(p_password, gen_salt('bf')), p_name)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.login_caregiver(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cg_record RECORD;
BEGIN
  SELECT id, email, name, password_hash
  INTO cg_record
  FROM public.caregivers
  WHERE email = p_email;

  IF cg_record.password_hash = crypt(p_password, cg_record.password_hash) THEN
    RETURN jsonb_build_object('id', cg_record.id, 'email', cg_record.email, 'name', cg_record.name);
  END IF;

  RETURN NULL;
END;
$$;

-- ==========================================
-- 5. RLS (Open anon access, app-enforced ownership)
-- ==========================================

ALTER TABLE public.caregivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon access for custom auth caregivers" ON public.caregivers;
DROP POLICY IF EXISTS "Allow anon access for custom auth patients" ON public.patients;
DROP POLICY IF EXISTS "Allow anon access for custom auth medications" ON public.medications;
DROP POLICY IF EXISTS "Allow anon access for custom auth medication_logs" ON public.medication_logs;

CREATE POLICY "Allow anon access for custom auth caregivers"
  ON public.caregivers FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access for custom auth patients"
  ON public.patients FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access for custom auth medications"
  ON public.medications FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon access for custom auth medication_logs"
  ON public.medication_logs FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ==========================================
-- 6. Refresh Supabase Schema Cache
-- ==========================================

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;
