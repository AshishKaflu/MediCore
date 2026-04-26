import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { ChevronLeft, Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateId } from '../lib/id';
import { useAuthStore } from '../store/authStore';
import { format } from 'date-fns';
import { deleteMedicationCloud, scheduleCaregiverSync } from '../lib/sync';
import { fileToOptimizedDataUrl, IMAGE_FILE_ACCEPT } from '../lib/image';
import { removeImageFromStorage, saveImageWithFallback } from '../lib/storage';
import { sanitizeMedicationInput } from '../lib/validation';

const MEDICATION_SCHEDULE_OPTIONS = [
  { value: 'before_breakfast', label: 'Before Breakfast', time: '07:00' },
  { value: 'after_breakfast', label: 'After Breakfast', time: '09:00' },
  { value: 'lunch', label: 'Lunch', time: '13:00' },
  { value: 'dinner', label: 'Dinner', time: '19:00' },
] as const;

const scheduleLabelByValue = new Map<string, string>(MEDICATION_SCHEDULE_OPTIONS.map((option) => [option.value, option.label]));
const scheduleTimeByValue = new Map<string, string>(MEDICATION_SCHEDULE_OPTIONS.map((option) => [option.value, option.time]));
const scheduleValueByTime = new Map<string, string>(MEDICATION_SCHEDULE_OPTIONS.map((option) => [option.time, option.value]));

export default function MedicationForm() {
  const { id: patientId, medId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const caregiverId = useAuthStore(state => state.user?.id) || '';

  // Form State
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [type, setType] = useState('tablet');
  const [interval, setIntervalVal] = useState<'daily'|'alternate'|'x_days'>('daily');
  const [intervalDays, setIntervalDays] = useState(3);
  const [scheduleLabels, setScheduleLabels] = useState<string[]>(['before_breakfast']);
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [timings, setTimings] = useState<string[]>(['08:00']);
  const [inventoryCount, setInventoryCount] = useState(30);
  const [refillReminderAt, setRefillReminderAt] = useState(5);
  const [photo, setPhoto] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = Boolean(medId);

  const patient = useLiveQuery(
    () => (patientId ? db.patients.get(patientId) : null),
    [patientId]
  );
  const isOwner = Boolean(patientId && patient && patient.caregiver_id === caregiverId);

  // Load existing medication if editing
  useLiveQuery(() => {
    if (isEditing && medId) {
      db.medications.get(medId).then(med => {
        if (med) {
          if (patientId && med.patient_id !== patientId) {
            toast.error('Access denied');
            navigate('/caregiver');
            return;
          }
          setName(med.name);
          setDosage(med.dosage);
          if (med.type || med.form) setType((med.type || med.form) as string);
          if (med.interval) setIntervalVal(med.interval as 'daily'|'alternate'|'x_days');
          if (med.interval_days) setIntervalDays(med.interval_days);
          if (med.start_date) setStartDate(med.start_date);
          else if (med.created_at) setStartDate(format(new Date(med.created_at), 'yyyy-MM-dd'));
          if (med.schedule_labels) {
            const labels = med.schedule_labels.split(',').map((value) => value.trim()).filter(Boolean);
            if (labels.length > 0) {
              setScheduleLabels(labels);
              setTimings(labels.map((value) => scheduleTimeByValue.get(value) || '08:00'));
            }
          } else if (med.timing) {
            const storedTimings = med.timing.split(',').map((value) => value.trim()).filter(Boolean);
            setTimings(storedTimings);
            const inferredLabels = storedTimings
              .map((time) => scheduleValueByTime.get(time) || '')
              .filter(Boolean);
            if (inferredLabels.length > 0) setScheduleLabels(inferredLabels);
          }
          setInventoryCount(med.inventory_count);
          setRefillReminderAt(med.refill_reminder_at);
          if (med.photo) setPhoto(med.photo);
        }
      });
    }
  }, [medId, isEditing]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileToOptimizedDataUrl(file, { maxDimension: 960, quality: 0.7 })
        .then((preview) => {
          setPhoto(preview);
          setPhotoFile(file);
        })
        .catch((error) => {
          console.error('Failed to optimize medication photo', error);
          toast.error('Failed to process photo');
        });
    }
  };

  const toggleScheduleLabel = (value: string) => {
    const nextLabels = scheduleLabels.includes(value)
      ? scheduleLabels.filter((label) => label !== value)
      : [...scheduleLabels, value];

    setScheduleLabels(nextLabels);
    setTimings(nextLabels.map((label) => scheduleTimeByValue.get(label) || '08:00'));
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!patientId || !isOwner) {
      toast.error('Access denied');
      return;
    }
    if (!startDate) {
      toast.error('Please select a start date');
      return;
    }

    try {
      setIsSaving(true);
      const existingMedication = isEditing && medId ? await db.medications.get(medId as string) : null;
      const sanitized = sanitizeMedicationInput({
        name,
        dosage,
        type,
        interval,
        intervalDays,
        startDate,
        scheduleLabels,
        timings,
        inventoryCount,
        refillReminderAt,
        photo,
      });
      let finalPhoto = sanitized.photo;
      let photoWarning = '';

      if (photoFile) {
        const storedPhoto = await saveImageWithFallback(photoFile, 'medications');
        finalPhoto = storedPhoto.photo;
        photoWarning = storedPhoto.warning || '';
      }

      const medData = {
        patient_id: patientId,
        name: sanitized.name,
        dosage: sanitized.dosage,
        frequency: sanitized.interval === 'daily' ? `${sanitized.timings.length}x daily` : sanitized.interval,
        form: sanitized.type,
        type: sanitized.type,
        schedule_labels: sanitized.scheduleLabels.join(','),
        timing: sanitized.timings.join(','),
        interval: sanitized.interval,
        interval_days: sanitized.intervalDays,
        start_date: sanitized.startDate,
        photo: finalPhoto,
        inventory_count: sanitized.inventoryCount,
        refill_reminder_at: sanitized.refillReminderAt,
        created_at: existingMedication?.created_at || new Date().toISOString()
      };

      if (isEditing) {
        await db.medications.update(medId as string, medData);
        if (photoFile && existingMedication?.photo && existingMedication.photo !== finalPhoto) {
          await removeImageFromStorage(existingMedication.photo);
        }
        toast.success(photoWarning || 'Medication updated');
      } else {
        await db.medications.add({
          id: generateId(),
          ...medData
        });
        toast.success(photoWarning || 'Medication added');
      }
      scheduleCaregiverSync(caregiverId);
      navigate(-1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save medication';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner) {
      toast.error('Access denied');
      return;
    }
    if (window.confirm('Are you sure you want to delete this medication?')) {
      const medication = await db.medications.get(medId as string);
      await db.medications.delete(medId as string);
      await removeImageFromStorage(medication?.photo);
      toast.success('Medication deleted');
      deleteMedicationCloud(medId as string);
      navigate(-1);
    }
  };

  if (patient === undefined) return <div className="p-6">Loading...</div>;
  if (patient === null) return <div className="p-6 flex flex-col items-center pt-24"><p className="text-gray-500 mb-4">Patient not found</p><button onClick={() => navigate('/caregiver')} className="text-[#606C38] font-bold">Back to dashboard</button></div>;
  if (!isOwner) return <div className="p-6 flex flex-col items-center pt-24"><p className="text-gray-500 mb-4">Access denied</p><button onClick={() => navigate('/caregiver')} className="text-[#606C38] font-bold">Back to dashboard</button></div>;

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[#FBFBF8] pb-24 text-[#283618] font-sans">
      <div className="bg-white p-6 pt-12 pb-6 shadow-sm border-b border-[#E5E1D8] flex items-center justify-between sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="w-10 h-10 border border-[#E5E1D8] bg-[#F2F0E4] rounded-full flex items-center justify-center hover:bg-[#E5E1D8] transition text-[#606C38]">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tracking-tight truncate flex-1 text-center px-4">
          {isEditing ? 'Edit Medication' : 'Add Medication'}
        </h1>
        {isEditing ? (
          <button onClick={handleDelete} className="w-10 h-10 text-[#BC6C25] hover:bg-[#BC6C25]/10 rounded-full flex items-center justify-center transition">
            <Trash2 className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-10 h-10" />
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Photo Upload Section */}
        <div className="flex flex-col items-center">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="w-32 h-32 bg-[#F2F0E4] rounded-[32px] border-2 border-dashed border-[#606C38]/30 flex flex-col items-center justify-center overflow-hidden cursor-pointer hover:bg-[#E5E1D8] transition relative"
          >
            {photo ? (
              <img src={photo} alt="Medication" className="w-full h-full object-cover" />
            ) : (
              <>
                <Camera className="w-8 h-8 text-[#606C38] opacity-70 mb-2" />
                <span className="text-[10px] font-bold text-[#606C38] uppercase tracking-wider">Tap to Photo</span>
              </>
            )}
          </div>
          <input 
            type="file" 
            accept={IMAGE_FILE_ACCEPT} 
            ref={fileInputRef} 
            onChange={handlePhotoUpload} 
            className="hidden" 
          />
        </div>

        {/* Basic Info */}
        <div className="bg-white p-5 rounded-[32px] border border-[#E5E1D8] shadow-sm space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#606C38] mb-1">Medication Name</label>
            <input 
              value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
              placeholder="e.g. Lisinopril"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Dosage</label>
              <input 
                value={dosage} onChange={e => setDosage(e.target.value)}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
                placeholder="e.g. 10mg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Type</label>
              <select 
                value={type} onChange={e => setType(e.target.value)}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618] appearance-none"
              >
                <option value="tablet">Tablet / Pill</option>
                <option value="liquid">Liquid</option>
                <option value="injection">Injection</option>
                <option value="capsule">Capsule</option>
                <option value="drops">Drops</option>
              </select>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-white p-5 rounded-[32px] border border-[#E5E1D8] shadow-sm space-y-4">
          <h2 className="font-bold text-lg mb-2">Schedule</h2>

          <div>
            <label className="block text-xs font-bold text-[#606C38] mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]"
            />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-[#606C38] mb-1">Frequency</label>
            <div className="flex bg-[#F2F0E4] border border-[#E5E1D8] p-1 rounded-2xl">
              <button 
                onClick={() => setIntervalVal('daily')}
                className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${interval === 'daily' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
              >
                Daily
              </button>
              <button 
                onClick={() => setIntervalVal('alternate')}
                className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${interval === 'alternate' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
              >
                Alt Days
              </button>
              <button 
                onClick={() => setIntervalVal('x_days')}
                className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${interval === 'x_days' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
              >
                Custom
              </button>
            </div>
          </div>

          {interval === 'x_days' && (
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Every X Days</label>
              <input 
                type="number" min="1"
                value={intervalDays} onChange={e => setIntervalDays(Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1))}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#606C38] mb-1">Meal Routine</label>
            <p className="text-xs text-[#606C38] opacity-70 mb-3">
              Choose when this medicine should be taken. These options automatically set the schedule used by reminders and tracking.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {MEDICATION_SCHEDULE_OPTIONS.map((option) => {
                const selected = scheduleLabels.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleScheduleLabel(option.value)}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${
                      selected
                        ? 'bg-[#606C38] text-white border-[#606C38] shadow-sm'
                        : 'bg-[#FBFBF8] text-[#283618] border-[#E5E1D8] hover:bg-[#F2F0E4]'
                    }`}
                  >
                    <p className="text-sm font-bold">{option.label}</p>
                    <p className={`text-[11px] font-semibold mt-1 ${selected ? 'text-white/80' : 'text-[#606C38] opacity-70'}`}>
                      Default time {option.time}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 rounded-2xl border border-[#E5E1D8] bg-[#F8F5ED] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#606C38] opacity-70">Selected schedule</p>
              <p className="mt-1 text-sm font-bold text-[#283618]">
                {scheduleLabels.length > 0
                  ? scheduleLabels.map((value) => scheduleLabelByValue.get(value) || value).join(', ')
                  : 'Select at least one meal routine'}
              </p>
              <p className="mt-1 text-xs text-[#606C38] opacity-75">
                {timings.length > 0 ? timings.join(', ') : 'No reminder times generated yet'}
              </p>
            </div>
          </div>
        </div>

        {/* Inventory & Reminders */}
        <div className="bg-white p-5 rounded-[32px] border border-[#E5E1D8] shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Current Inventory</label>
              <input 
                type="number" min="0"
                value={inventoryCount} onChange={e => setInventoryCount(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#DDA15E] mb-1">Refill Alert At</label>
              <input 
                type="number" min="0"
                value={refillReminderAt} onChange={e => setRefillReminderAt(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#DDA15E] outline-none text-[#283618]" 
              />
            </div>
          </div>
        </div>

        <button 
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full py-4 text-sm font-bold text-white bg-[#606C38] rounded-2xl transition shadow-sm ${isSaving ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
        >
          {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Medication'}
        </button>

      </div>
    </div>
  );
}
