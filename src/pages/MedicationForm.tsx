import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { ChevronLeft, Camera, Trash2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { generateId } from '../lib/id';
import { useAuthStore } from '../store/authStore';
import { format } from 'date-fns';
import { deleteMedicationCloud, scheduleCaregiverSync } from '../lib/sync';
import { fileToOptimizedDataUrl } from '../lib/image';
import { removeImageFromStorage, uploadImageToStorage } from '../lib/storage';

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
          if (med.timing) setTimings(med.timing.split(','));
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

  const addTiming = () => {
    setTimings([...timings, '12:00']);
  };

  const removeTiming = (index: number) => {
    setTimings(timings.filter((_, i) => i !== index));
  };

  const updateTiming = (index: number, val: string) => {
    const newTimings = [...timings];
    newTimings[index] = val;
    setTimings(newTimings);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!name || timings.length === 0) {
      toast.error('Please provide a name and at least one time');
      return;
    }
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
      let finalPhoto = photo;

      if (photoFile) {
        finalPhoto = await uploadImageToStorage(photoFile, 'medications');
      }

      const medData = {
        patient_id: patientId,
        name,
        dosage,
        frequency: interval === 'daily' ? `${timings.length}x daily` : interval, // legacy compatible
        form: type,
        type,
        timing: timings.join(','),
        interval,
        interval_days: interval === 'x_days' ? intervalDays : undefined,
        start_date: startDate,
        photo: finalPhoto,
        inventory_count: inventoryCount,
        refill_reminder_at: refillReminderAt,
        created_at: new Date().toISOString()
      };

      if (isEditing) {
        await db.medications.update(medId as string, medData);
        if (photoFile && existingMedication?.photo && existingMedication.photo !== finalPhoto) {
          await removeImageFromStorage(existingMedication.photo);
        }
        toast.success('Medication updated');
      } else {
        await db.medications.add({
          id: generateId(),
          ...medData
        });
        toast.success('Medication added');
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
            accept="image/*" 
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
                value={intervalDays} onChange={e => setIntervalDays(parseInt(e.target.value))}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#606C38] mb-1">Times of Day</label>
            <div className="space-y-2">
              {timings.map((time, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input 
                    type="time" 
                    value={time} 
                    onChange={e => updateTiming(idx, e.target.value)}
                    className="flex-1 text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
                  />
                  {timings.length > 1 && (
                    <button onClick={() => removeTiming(idx)} className="w-10 h-10 bg-[#F2F0E4] text-[#BC6C25] rounded-xl flex items-center justify-center hover:bg-[#E5E1D8]">
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addTiming} className="w-full flex items-center justify-center gap-1 text-xs font-bold text-[#606C38] py-3 bg-[#F2F0E4] rounded-xl hover:bg-[#E5E1D8] transition">
                <Plus className="w-4 h-4"/> Add Another Time
              </button>
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
                value={inventoryCount} onChange={e => setInventoryCount(parseInt(e.target.value))}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]" 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#DDA15E] mb-1">Refill Alert At</label>
              <input 
                type="number" min="0"
                value={refillReminderAt} onChange={e => setRefillReminderAt(parseInt(e.target.value))}
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
