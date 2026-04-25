import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import {
  ChevronLeft,
  Plus,
  Edit2,
  Pill,
  CalendarDays,
  PlusCircle,
  MinusCircle,
  RefreshCw,
  Camera,
  Archive,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore';
import { ImageLightbox } from '../components/ImageLightbox';
import { format } from 'date-fns';
import { deletePatientCloud, scheduleCaregiverSync } from '../lib/sync';
import { fileToOptimizedDataUrl } from '../lib/image';
import { removeImageFromStorage, uploadImageToStorage } from '../lib/storage';
import { sanitizePatientInput } from '../lib/validation';

export default function PatientDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const initEdit = mode === 'edit' || searchParams.get('edit') === 'true';
  const isNewUser = searchParams.get('new') === 'true';

  const caregiverId = useAuthStore((state) => state.user?.id) || '';
  const [activeTab, setActiveTab] = useState<'meds' | 'logs'>('meds');
  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);
  const [isEditing, setIsEditing] = useState(initEdit);
  const [editForm, setEditForm] = useState({
    first_name: '',
    last_name: '',
    dob: '',
    notes: '',
    pin: '',
    designation: '',
    photo: '',
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [refillMode, setRefillMode] = useState<string | null>(null);
  const [refillAmount, setRefillAmount] = useState<number>(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const patient = useLiveQuery(() => db.patients.get(id as string), [id]);
  const isOwner = Boolean(patient && patient.caregiver_id === caregiverId);
  const medications = useLiveQuery(
    () => (isOwner ? db.medications.where('patient_id').equals(id as string).toArray() : []),
    [id, isOwner]
  ) || [];
  const logs = useLiveQuery(
    () => (isOwner ? db.medication_logs.where('patient_id').equals(id as string).toArray() : []),
    [id, isOwner]
  ) || [];

  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime());
  }, [logs]);

  const medNameById = useMemo(() => new Map(medications.map((m) => [m.id, m.name])), [medications]);

  useEffect(() => {
    setIsEditing(initEdit);
  }, [initEdit]);

  useEffect(() => {
    if (!patient) return;

    setEditForm({
      first_name: patient.first_name,
      last_name: patient.last_name,
      dob: patient.dob,
      notes: patient.notes || '',
      pin: patient.pin || '',
      designation: patient.designation || '',
      photo: patient.photo || '',
    });
  }, [patient]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    fileToOptimizedDataUrl(file, { maxDimension: 960, quality: 0.72 })
      .then((photo) => {
        setEditForm((current) => ({ ...current, photo }));
        setPhotoFile(file);
      })
      .catch((error) => {
        console.error('Failed to optimize patient photo', error);
        toast.error('Failed to process photo');
      });
  };

  const handleEnterEditMode = () => {
    if (!patient) return;
    setIsEditing(true);
    setIsConfirmingDelete(false);
    navigate(`/caregiver/patient/${patient.id}?mode=edit`, { replace: true });
  };

  const handleSavePatient = async () => {
    if (!id) return;
    if (!isOwner) {
      toast.error('Access denied');
      return;
    }

    try {
      const sanitized = sanitizePatientInput(editForm);
      const existingPhoto = patient?.photo;
      let finalPhoto = sanitized.photo;

      if (photoFile) {
        finalPhoto = await uploadImageToStorage(photoFile, 'patients');
      }

      await db.patients.update(id, {
        ...sanitized,
        photo: finalPhoto || undefined,
      });

      if (photoFile && existingPhoto && existingPhoto !== finalPhoto) {
        await removeImageFromStorage(existingPhoto);
      }

      setPhotoFile(null);
      setIsEditing(false);
      navigate(`/caregiver/patient/${id}`, { replace: true });
      toast.success('Patient details updated');
      scheduleCaregiverSync(caregiverId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update patient details';
      toast.error(message);
    }
  };

  const handleDeletePatientLogic = async (skipConfirm = false) => {
    if (!id) return;
    if (!isOwner) {
      toast.error('Access denied');
      navigate('/caregiver');
      return;
    }

    if (!skipConfirm && !isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    const meds = await db.medications.where('patient_id').equals(id).toArray();
    const medIds = meds.map((m) => m.id);
    const medicationPhotos = meds.map((med) => med.photo).filter(Boolean);
    const patientPhoto = patient?.photo;

    await db.transaction('rw', db.patients, db.medications, db.medication_logs, async () => {
      if (medIds.length > 0) {
        await db.medication_logs.where('medication_id').anyOf(medIds).delete();
        await db.medications.where('patient_id').equals(id).delete();
      }
      await db.patients.delete(id);
    });

    await Promise.all([
      removeImageFromStorage(patientPhoto),
      ...medicationPhotos.map((photo) => removeImageFromStorage(photo)),
    ]);

    if (!skipConfirm) toast.success('Patient deleted');
    deletePatientCloud(id, caregiverId);
    navigate('/caregiver');
  };

  const handleDeletePatient = () => handleDeletePatientLogic();

  const handleCancelEdit = async () => {
    if (isNewUser) {
      await handleDeletePatientLogic(true);
      return;
    }

    setIsEditing(false);
    setIsConfirmingDelete(false);
    setPhotoFile(null);
    navigate(`/caregiver/patient/${id}`, { replace: true });
  };

  const handleArchivePatient = async () => {
    if (!id || !patient) return;
    if (!isOwner) {
      toast.error('Access denied');
      return;
    }

    const nextStatus = patient.status === 'archived' ? 'active' : 'archived';
    await db.patients.update(id, { status: nextStatus });
    toast.success(nextStatus === 'archived' ? 'Patient archived' : 'Patient restored');
    scheduleCaregiverSync(caregiverId);

    if (nextStatus === 'archived') {
      navigate('/caregiver');
    }
  };

  const handleQuickRefill = async (medId: string, currentCount: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOwner) {
      toast.error('Access denied');
      return;
    }

    if (refillMode === medId) {
      const newCount = currentCount + refillAmount;
      await db.medications.update(medId, { inventory_count: newCount });
      toast.success(`Inventory updated to ${newCount}`);
      setRefillMode(null);
      setRefillAmount(0);
      scheduleCaregiverSync(caregiverId);
      return;
    }

    setRefillMode(medId);
    setRefillAmount(30);
  };

  if (patient === undefined) return <div className="p-6">Loading...</div>;
  if (patient === null) {
    return (
      <div className="p-6 flex flex-col items-center pt-24">
        <p className="text-gray-500 mb-4">Patient not found</p>
        <button onClick={() => navigate(-1)} className="text-[#606C38] font-bold">
          Go back
        </button>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="p-6 flex flex-col items-center pt-24">
        <p className="text-gray-500 mb-4">Access denied</p>
        <button onClick={() => navigate('/caregiver')} className="text-[#606C38] font-bold">
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[#FBFBF8] pb-24 text-[#283618] font-sans">
      <div className="bg-white p-6 pt-12 pb-6 shadow-sm border-b border-[#E5E1D8] flex items-center justify-between sticky top-0 z-10">
        <button
          onClick={() => navigate(isEditing && id ? `/caregiver/patient/${id}` : -1)}
          className="w-10 h-10 border border-[#E5E1D8] bg-[#F2F0E4] rounded-full flex items-center justify-center hover:bg-[#E5E1D8] transition text-[#606C38]"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tracking-tight truncate flex-1 text-center px-4">
          {patient.designation ? `${patient.designation} ` : ''}
          {patient.first_name} {patient.last_name}
        </h1>
        {isEditing ? (
          <div className="w-10 h-10" />
        ) : (
          <button
            onClick={handleEnterEditMode}
            className="w-10 h-10 transition flex items-center justify-center rounded-full text-[#606C38] opacity-70 hover:opacity-100 hover:bg-[#F2F0E4]"
          >
            <Edit2 className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {isEditing ? (
          <div className="bg-white rounded-[32px] border border-[#E5E1D8] p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold flex items-center justify-between mb-4">
              {isNewUser ? 'Add New Patient' : 'Edit Patient Details'}
            </h2>

            <div className="flex flex-col items-center mb-6">
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                {editForm.photo ? (
                  <img
                    src={editForm.photo}
                    alt="Profile"
                    className="h-20 w-20 rounded-2xl object-cover shadow-sm border-2 border-[#E5E1D8]"
                  />
                ) : (
                  <div className="h-20 w-20 bg-[#DDA15E] text-white rounded-2xl flex items-center justify-center text-3xl font-bold shadow-sm border-2 border-[#E5E1D8]">
                    {editForm.first_name ? editForm.first_name[0] : <Camera className="w-8 h-8 opacity-50" />}
                  </div>
                )}
                <div className="absolute -bottom-2 -right-2 bg-white p-1.5 rounded-full shadow-sm border border-[#E5E1D8] text-[#606C38] group-hover:scale-110 transition">
                  <Camera className="w-4 h-4" />
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  className="hidden"
                  accept="image/*"
                />
              </div>
              <p className="text-[10px] uppercase font-bold text-[#606C38] opacity-70 mt-3 tracking-wider">
                Patient Photo
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#606C38] mb-1">First Name</label>
                  <div className="flex gap-2">
                    <select
                      value={editForm.designation}
                      onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                      className="w-[72px] shrink-0 text-sm px-2 py-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618] appearance-none"
                    >
                      <option value="">-</option>
                      <option value="Mr.">Mr.</option>
                      <option value="Mrs.">Mrs.</option>
                      <option value="Miss">Miss</option>
                      <option value="Ms.">Ms.</option>
                      <option value="Mx.">Mx.</option>
                      <option value="Dr.">Dr.</option>
                      <option value="Prof.">Prof.</option>
                      <option value="Er.">Er.</option>
                    </select>
                    <input
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                      className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]"
                      placeholder="First"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#606C38] mb-1">Last Name</label>
                  <input
                    value={editForm.last_name}
                    onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                    className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]"
                    placeholder="Last"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Date of Birth</label>
              <input
                type="date"
                value={editForm.dob}
                onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Login PIN (4-6 Digits)</label>
              <input
                type="text"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={6}
                value={editForm.pin || ''}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    pin: e.target.value.replace(/\D/g, '').slice(0, 6),
                  })
                }
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618] font-mono tracking-widest"
                placeholder="Set a PIN for the patient..."
              />
              <p className="text-[10px] text-[#606C38] opacity-70 mt-1 font-bold">
                This PIN is required for the patient to log in.
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-1">Care Notes</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full text-sm p-3 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none text-[#283618] min-h-[80px]"
                placeholder="Allergies, specific needs..."
              />
            </div>
            <div className="flex gap-3 mt-4 pt-4 border-t border-[#E5E1D8]">
              {isConfirmingDelete ? (
                <button
                  onClick={handleDeletePatient}
                  className="py-3 px-4 text-sm font-bold text-white bg-red-600 rounded-xl hover:opacity-90 transition shadow-sm animate-pulse flex-1"
                >
                  Sure? Complete Delete
                </button>
              ) : (
                <button
                  onClick={handleDeletePatient}
                  className="py-3 px-4 text-sm font-bold text-white bg-[#BC6C25] rounded-xl hover:opacity-90 transition shadow-sm"
                >
                  Delete
                </button>
              )}
              <button
                onClick={handleCancelEdit}
                className="flex-1 py-3 text-sm font-bold text-[#606C38] bg-[#F2F0E4] rounded-xl hover:bg-[#E5E1D8] transition"
              >
                Cancel
              </button>
              {!isConfirmingDelete && (
                <button
                  onClick={handleSavePatient}
                  className="flex-1 py-3 text-sm font-bold text-white bg-[#606C38] rounded-xl hover:opacity-90 transition shadow-sm"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-[32px] border border-[#E5E1D8] p-6 shadow-sm">
              <div className="flex gap-4 items-center">
                {patient.photo ? (
                  <img
                    src={patient.photo}
                    alt={patient.first_name}
                    className="w-14 h-14 rounded-full object-cover shadow-sm border-2 border-[#E5E1D8] shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 bg-[#DDA15E] text-white rounded-full flex items-center justify-center text-xl font-bold shadow-sm border-2 border-white shrink-0">
                    {patient.first_name?.[0]}
                    {patient.last_name?.[0]}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-bold tracking-tight">Active Care Plan</p>
                  <p className="text-xs text-[#606C38] opacity-70 mt-1">
                    Managing: <span className="font-bold">{patient.designation ? `${patient.designation} ` : ''}{patient.first_name}</span> • DOB: {patient.dob}
                  </p>
                </div>
              </div>
              {patient.notes && (
                <div className="mt-4 pt-4 border-t border-[#E5E1D8]">
                  <p className="text-xs font-bold text-[#606C38] mb-1 uppercase tracking-wider">Care Notes</p>
                  <p className="text-sm text-[#283618] opacity-90">{patient.notes}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-[32px] border border-[#E5E1D8] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg">Patient Actions</h2>
                <button
                  onClick={handleEnterEditMode}
                  className="text-xs font-bold text-white bg-[#606C38] px-3 py-2 rounded-lg hover:opacity-90 transition shadow-sm"
                >
                  Edit Details
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleArchivePatient}
                  className="flex items-center justify-center gap-2 py-3 bg-[#DDA15E]/10 text-[#BC6C25] border border-[#DDA15E]/30 rounded-2xl font-bold hover:bg-[#DDA15E]/20 transition"
                >
                  <Archive className="w-4 h-4" />
                  {patient.status === 'archived' ? 'Restore Patient' : 'Archive Patient'}
                </button>
                <button
                  onClick={handleDeletePatient}
                  className={`flex items-center justify-center gap-2 py-3 rounded-2xl font-bold transition border ${
                    isConfirmingDelete
                      ? 'bg-red-600 text-white border-red-600 animate-pulse'
                      : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  {isConfirmingDelete ? 'Tap Again To Delete' : 'Delete Patient'}
                </button>
              </div>
            </div>

            <div className="flex bg-[#F2F0E4] border border-[#E5E1D8] p-1 rounded-2xl">
              <button
                onClick={() => setActiveTab('meds')}
                className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition ${
                  activeTab === 'meds'
                    ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]'
                    : 'text-[#606C38] opacity-70 hover:opacity-100'
                }`}
              >
                Medications
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition ${
                  activeTab === 'logs'
                    ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]'
                    : 'text-[#606C38] opacity-70 hover:opacity-100'
                }`}
              >
                History Logs
              </button>
            </div>

            {activeTab === 'meds' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-bold text-lg">Dosed Schedule</h2>
                  <button
                    onClick={() => navigate(`/caregiver/patient/${id}/medication/new`)}
                    className="flex items-center gap-1 xl text-xs text-white bg-[#606C38] px-3 py-2 rounded-lg font-bold hover:opacity-90 transition shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> Add Med
                  </button>
                </div>

                {medications.length === 0 ? (
                  <div className="text-center py-8 text-[#606C38] opacity-70 text-sm font-bold">No medications mapped.</div>
                ) : (
                  medications.map((med) => (
                    <div
                      key={med.id}
                      onClick={() => navigate(`/caregiver/patient/${id}/medication/${med.id}`)}
                      className="bg-white p-5 rounded-[32px] shadow-sm border border-[#E5E1D8] cursor-pointer hover:border-[#606C38] hover:shadow-md transition group relative"
                    >
                      <div className="absolute top-4 right-4 text-[#606C38] opacity-0 group-hover:opacity-100 transition">
                        <Edit2 className="w-4 h-4" />
                      </div>
                      <div className="flex items-center gap-4 mb-4 pr-6">
                        {med.photo ? (
                          <button
                            type="button"
                            className="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-[#E5E1D8] cursor-zoom-in"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox({ src: med.photo as string, alt: med.name });
                            }}
                            aria-label="View medication photo"
                          >
                            <img src={med.photo} alt={med.name} className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div className="w-12 h-12 bg-[#F2F0E4] text-[#606C38] rounded-full flex items-center justify-center shrink-0">
                            <Pill className="w-6 h-6 transform rotate-45" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h3 className="font-bold text-[#283618] text-lg">{med.name}</h3>
                          <p className="text-xs text-[#606C38] opacity-70 font-semibold">
                            {med.dosage} • {med.frequency || 'Daily'} {med.timing ? `(${med.timing.split(',').join(', ')})` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="bg-[#F2F0E4] rounded-2xl p-4 flex items-center justify-between border border-[#E5E1D8]">
                        <div>
                          <p className="text-[10px] text-[#606C38] font-bold uppercase tracking-wider mb-1">Inventory</p>
                          <p className="text-[#283618] font-bold text-sm tracking-tight">{med.inventory_count} Pills Left</p>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          {refillMode === med.id ? (
                            <div className="flex items-center gap-1 bg-white p-1 rounded-xl shadow-sm border border-[#E5E1D8]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRefillAmount((prev) => Math.max(0, prev - 10));
                                }}
                                className="p-1 text-[#606C38] hover:bg-[#F2F0E4] rounded-lg transition"
                              >
                                <MinusCircle className="w-4 h-4" />
                              </button>
                              <span className="font-bold text-sm text-[#283618] w-8 text-center">+{refillAmount}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRefillAmount((prev) => prev + 10);
                                }}
                                className="p-1 text-[#606C38] hover:bg-[#F2F0E4] rounded-lg transition"
                              >
                                <PlusCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="text-right">
                              <p className="text-[10px] text-[#DDA15E] font-bold uppercase tracking-wider mb-1">Refill</p>
                              <p className="text-[#BC6C25] font-bold text-sm tracking-tight">Alert at {med.refill_reminder_at}</p>
                            </div>
                          )}
                          <button
                            onClick={(e) => handleQuickRefill(med.id, med.inventory_count, e)}
                            className={`ml-2 p-2 rounded-xl transition shadow-sm border ${
                              refillMode === med.id
                                ? 'bg-[#606C38] text-white border-[#606C38]'
                                : 'bg-white text-[#606C38] border-[#E5E1D8] hover:bg-[#F2F0E4]'
                            }`}
                          >
                            <RefreshCw className={`w-4 h-4 ${refillMode === med.id ? 'animate-spin-once' : ''}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-bold text-lg">History Logs</h2>
                  <span className="text-[10px] font-bold text-[#606C38] bg-[#F2F0E4] px-2 py-1 rounded-lg uppercase tracking-wider">
                    {sortedLogs.length} entries
                  </span>
                </div>

                {sortedLogs.length === 0 ? (
                  <div className="text-center py-8 text-[#606C38] opacity-70">
                    <CalendarDays className="w-12 h-12 text-[#E5E1D8] mx-auto mb-4" />
                    <p className="font-bold text-sm opacity-70">No recent logs found.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sortedLogs.slice(0, 50).map((log) => {
                      const medName = medNameById.get(log.medication_id) || 'Medication';
                      const statusLabel = (log.status || '').toUpperCase();
                      const badgeClass =
                        log.status === 'taken'
                          ? 'bg-[#606C38]/10 text-[#606C38] border-[#606C38]/20'
                          : log.status === 'missed'
                            ? 'bg-[#BC6C25]/10 text-[#BC6C25] border-[#BC6C25]/20'
                            : 'bg-[#DDA15E]/10 text-[#BC6C25] border-[#DDA15E]/20';

                      return (
                        <div
                          key={log.id}
                          className="bg-white p-4 rounded-[28px] shadow-sm border border-[#E5E1D8] flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-[#283618] truncate">{medName}</p>
                            <p className="text-xs text-[#606C38] opacity-70 font-bold mt-1">
                              {format(new Date(log.taken_at), 'MMM d, h:mm a')}
                              {log.notes ? ` • ${log.notes}` : ''}
                            </p>
                          </div>
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg border ${badgeClass}`}>
                            {statusLabel || 'LOG'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ImageLightbox
        open={Boolean(lightbox)}
        src={lightbox?.src || ''}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
