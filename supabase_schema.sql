-- Supabase Database Schema Migration File
-- Copy/paste into Supabase SQL Editor and run.
--
-- Final schema for the current MediCore app.
-- This version matches the app's sanitized sync payloads and current UI model:
--   caregivers, patients, medications, medication_logs

-- ==========================================
-- 0. OPTIONAL: WIPE EXISTING APP DATA
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
-- 2. Optional Clean Reset
-- ==========================================
-- Uncomment this section if you want to recreate the 4 app tables from scratch.
/*
DROP POLICY IF EXISTS "Allow anon access for custom auth caregivers" ON public.caregivers;
DROP POLICY IF EXISTS "Allow anon access for custom auth patients" ON public.patients;
DROP POLICY IF EXISTS "Allow anon access for custom auth medications" ON public.medications;
DROP POLICY IF EXISTS "Allow anon access for custom auth medication_logs" ON public.medication_logs;

DROP FUNCTION IF EXISTS public.register_caregiver(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.login_caregiver(TEXT, TEXT);

DROP TABLE IF EXISTS public.medication_logs CASCADE;
DROP TABLE IF EXISTS public.medications CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.caregivers CASCADE;
*/

-- ==========================================
-- 3. Core Tables
-- ==========================================

CREATE TABLE IF NOT EXISTS public.caregivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.caregivers ALTER COLUMN email SET NOT NULL;
ALTER TABLE public.caregivers ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE public.caregivers ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.caregivers ALTER COLUMN created_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caregivers_email_lower ON public.caregivers (lower(email));

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
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

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
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_status_check'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_status_check
      CHECK (status IN ('active', 'archived'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_pin_format_check'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_pin_format_check
      CHECK (pin IS NULL OR pin ~ '^[0-9]{4,6}$');
  END IF;
END $$;

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
    SELECT 1 FROM pg_constraint WHERE conname = 'medications_inventory_count_check'
  ) THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_inventory_count_check
      CHECK (inventory_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medications_refill_reminder_check'
  ) THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_refill_reminder_check
      CHECK (refill_reminder_at >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medications_interval_days_check'
  ) THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_interval_days_check
      CHECK (interval_days IS NULL OR interval_days > 0);
  END IF;
END $$;

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
    SELECT 1 FROM pg_constraint WHERE conname = 'medication_logs_status_check'
  ) THEN
    ALTER TABLE public.medication_logs
      ADD CONSTRAINT medication_logs_status_check
      CHECK (status IN ('taken', 'missed', 'skipped'));
  END IF;
END $$;

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
  normalized_email TEXT := lower(trim(p_email));
  normalized_name TEXT := trim(p_name);
BEGIN
  IF normalized_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF char_length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  IF char_length(normalized_name) < 2 THEN
    RAISE EXCEPTION 'Name must be at least 2 characters';
  END IF;

  INSERT INTO public.caregivers (email, password_hash, name)
  VALUES (normalized_email, crypt(p_password, gen_salt('bf')), normalized_name)
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
  normalized_email TEXT := lower(trim(p_email));
BEGIN
  SELECT id, email, name, photo, password_hash
  INTO cg_record
  FROM public.caregivers
  WHERE lower(email) = normalized_email;

  IF cg_record.password_hash = crypt(p_password, cg_record.password_hash) THEN
    RETURN jsonb_build_object('id', cg_record.id, 'email', cg_record.email, 'name', cg_record.name, 'photo', cg_record.photo);
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
