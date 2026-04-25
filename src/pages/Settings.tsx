import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import { LogOut, Globe, Fingerprint, Bell, ChevronLeft, Camera, Edit2, Trash2, Download, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { db } from '../lib/db';
import { fileToOptimizedDataUrl } from '../lib/image';
import { removeImageFromStorage, uploadImageToStorage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const user = useAuthStore(state => state.user);
  const role = useAuthStore(state => state.role);
  const logout = useAuthStore(state => state.logout);
  const updateUser = useAuthStore(state => state.updateUser);
  const isBiometricEnabled = useAuthStore(state => state.isBiometricEnabled);
  const toggleBiometric = useAuthStore(state => state.toggleBiometric);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [profilePhotoPreview, setProfilePhotoPreview] = useState(user?.photo || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const getBackupFilename = () => `medicore-backup-${new Date().toISOString().slice(0, 10)}.json`;

  const getFallbackDownloadLocation = () => {
    const ua = navigator.userAgent || '';
    const isIPhoneOrIPad = /iPhone|iPad|iPod/i.test(ua);
    if (isIPhoneOrIPad) {
      return 'Safari usually saves it to the Downloads folder in the Files app unless you choose another location from the share sheet.';
    }
    if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg|Firefox|FxiOS/i.test(ua)) {
      return 'Safari usually saves it to your Downloads folder.';
    }
    return 'Your browser usually saves it to the default Downloads folder.';
  };

  useEffect(() => {
    setEditName(user?.name || '');
    setProfilePhotoPreview(user?.photo || '');
  }, [user?.name, user?.photo]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleResetLocalData = async () => {
    const ok = window.confirm(
      'This will delete ALL local app data on this device (patients, medications, logs) and sign you out. Continue?'
    );
    if (!ok) return;

    try {
      logout();
      localStorage.removeItem('medmanage-auth');
      await db.delete();
      toast.success('Local data cleared');
      window.location.href = '/';
    } catch (e) {
      console.error('Failed to reset local data', e);
      toast.error('Failed to clear local data');
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileToOptimizedDataUrl(file, { maxDimension: 720, quality: 0.72 })
        .then((photo) => {
          setProfilePhotoPreview(photo);
          setPhotoFile(file);
        })
        .catch((error) => {
          console.error('Failed to optimize profile photo', error);
          toast.error('Failed to process photo');
        });
    }
  };

  const handleSaveProfile = async () => {
    if (role !== 'caregiver' || !user?.id) {
      updateUser({ name: editName });
      setIsEditingProfile(false);
      return;
    }

    try {
      let finalPhoto = user.photo;
      if (photoFile) {
        finalPhoto = await uploadImageToStorage(photoFile, 'patients');
      }

      const { error } = await supabase
        .from('caregivers')
        .update({ name: editName, photo: finalPhoto ?? null })
        .eq('id', user.id);

      if (error) {
        throw error;
      }

      if (photoFile && user.photo && user.photo !== finalPhoto) {
        await removeImageFromStorage(user.photo);
      }

      updateUser({ name: editName, photo: finalPhoto });
      setProfilePhotoPreview(finalPhoto || '');
      setPhotoFile(null);
      setIsEditingProfile(false);
      toast.success('Profile updated');
    } catch (error) {
      console.error('Failed to update caregiver profile', error);
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      toast.error(message);
    }
  };

  const handleExportBackup = async () => {
    if (role !== 'caregiver' || !user?.id) {
      toast.error('Backup export is available for caregiver accounts only');
      return;
    }

    try {
      const patients = await db.patients.where('caregiver_id').equals(user.id).toArray();
      const patientIds = patients.map((patient) => patient.id);
      const medications =
        patientIds.length > 0 ? await db.medications.where('patient_id').anyOf(patientIds).toArray() : [];
      const logs =
        patientIds.length > 0 ? await db.medication_logs.where('patient_id').anyOf(patientIds).toArray() : [];

      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        caregiver: {
          id: user.id,
          name: user.name || '',
        },
        patients,
        medications,
        medication_logs: logs,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const fileName = getBackupFilename();
      const file = new File([blob], fileName, { type: 'application/json' });
      const savePicker = (window as typeof window & {
        showSaveFilePicker?: (options?: {
          suggestedName?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob | File) => Promise<void>; close: () => Promise<void> }> }>;
      }).showSaveFilePicker;

      if (savePicker) {
        const handle = await savePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'JSON backup',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
        toast.success(`Backup saved as ${fileName}`);
        return;
      }

      const canShareFile =
        typeof navigator.share === 'function' &&
        typeof (navigator as Navigator & { canShare?: (data?: ShareData) => boolean }).canShare === 'function' &&
        (navigator as Navigator & { canShare?: (data?: ShareData) => boolean }).canShare?.({ files: [file] });

      if (canShareFile) {
        await navigator.share({
          files: [file],
          title: 'MediCore Backup',
          text: `Save or share ${fileName}`,
        });
        toast.success(`Backup ready: ${fileName}`);
        return;
      }

      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success(
        `Backup exported as ${fileName}. ${getFallbackDownloadLocation()}`
      );
    } catch (error) {
      console.error('Failed to export local backup', error);
      toast.error('Failed to export local backup');
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (role !== 'caregiver' || !user?.id) {
      toast.error('Backup import is available for caregiver accounts only');
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        version?: number;
        patients?: any[];
        medications?: any[];
        medication_logs?: any[];
      };

      const patients = Array.isArray(parsed.patients) ? parsed.patients : [];
      const medications = Array.isArray(parsed.medications) ? parsed.medications : [];
      const medicationLogs = Array.isArray(parsed.medication_logs) ? parsed.medication_logs : [];

      if (patients.length === 0 && medications.length === 0 && medicationLogs.length === 0) {
        toast.error('Backup file is empty or invalid');
        return;
      }

      const normalizedPatients = patients.map((patient) => ({
        ...patient,
        caregiver_id: user.id,
      }));

      await db.transaction('rw', db.patients, db.medications, db.medication_logs, async () => {
        if (normalizedPatients.length > 0) await db.patients.bulkPut(normalizedPatients);
        if (medications.length > 0) await db.medications.bulkPut(medications);
        if (medicationLogs.length > 0) await db.medication_logs.bulkPut(medicationLogs);
      });

      toast.success(
        `Backup imported: ${normalizedPatients.length} patients, ${medications.length} medications, ${medicationLogs.length} logs`
      );
    } catch (error) {
      console.error('Failed to import local backup', error);
      toast.error('Failed to import backup file');
    } finally {
      e.target.value = '';
    }
  };

  const languageNames: Record<string, string> = {
    en: 'English',
    es: 'Español',
    ne: 'नेपाली'
  };

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[#FBFBF8] p-6 pt-12 text-[#283618] font-sans">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate(-1)} className="w-10 h-10 border border-[#E5E1D8] bg-[#F2F0E4] rounded-full flex items-center justify-center hover:bg-[#E5E1D8] transition text-[#606C38]">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-3xl font-bold tracking-tight">{t('settings')}</h1>
      </div>

      <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} className="space-y-4">
        
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-[#E5E1D8] relative overflow-hidden">
          {/* Decorative background shape */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#F2F0E4] rounded-bl-full opacity-50 pointer-events-none" />
          
          <div className="flex flex-col items-center relative z-10">
            <div className="relative mb-4 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {(profilePhotoPreview || user?.photo) ? (
                <img src={profilePhotoPreview || user?.photo} alt="Profile" className="h-20 w-20 rounded-2xl object-cover shadow-sm border-2 border-[#E5E1D8]" />
              ) : (
                <div className="h-20 w-20 bg-[#606C38] text-white rounded-2xl flex items-center justify-center text-3xl font-bold shadow-sm">
                  {user?.name?.charAt(0) || role?.charAt(0).toUpperCase()}
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

            {isEditingProfile ? (
              <div className="flex items-center gap-2 w-full mt-2">
                <input 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 text-center font-bold text-lg p-2 bg-[#FBFBF8] border border-[#E5E1D8] rounded-xl focus:border-[#606C38] outline-none"
                  autoFocus
                />
                <button 
                  onClick={handleSaveProfile}
                  className="bg-[#606C38] text-white px-4 py-2.5 rounded-xl font-bold text-xs"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <h2 className="text-xl font-bold">{user?.name || 'User'}</h2>
                <button onClick={() => setIsEditingProfile(true)} className="text-[#606C38] opacity-70 hover:opacity-100 transition p-1">
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
            <p className="text-xs font-bold text-[#606C38] opacity-70 capitalize mt-1 tracking-wider uppercase">{role}</p>
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-2 shadow-sm border border-[#E5E1D8]">
          <div className="flex items-center justify-between p-4 border-b border-[#E5E1D8]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#F2F0E4] rounded-full flex items-center justify-center">
                <Globe className="w-5 h-5 text-[#606C38]" />
              </div>
              <div>
                <p className="font-bold text-sm">Language</p>
                <p className="text-xs font-semibold text-[#606C38] opacity-70 capitalize">{languageNames[i18n.language] || i18n.language}</p>
              </div>
            </div>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="text-xs font-bold text-[#606C38] bg-[#F2F0E4] px-3 py-2 rounded-xl border border-[#E5E1D8] hover:bg-[#E5E1D8] transition outline-none appearance-none cursor-pointer text-center"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="ne">नेपाली</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border-b border-[#E5E1D8]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#F2F0E4] rounded-full flex items-center justify-center">
                <Fingerprint className="w-5 h-5 text-[#606C38]" />
              </div>
              <div>
                <p className="font-bold text-sm">Biometric Login</p>
                <p className="text-xs font-semibold text-[#606C38] opacity-70">Use Touch ID / Face ID</p>
              </div>
            </div>
            <button
              onClick={() => toggleBiometric(!isBiometricEnabled)}
              className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${isBiometricEnabled ? 'bg-[#606C38]' : 'bg-[#E5E1D8]'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${isBiometricEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#F2F0E4] rounded-full flex items-center justify-center">
                <Bell className="w-5 h-5 text-[#606C38]" />
              </div>
              <div>
                <p className="font-bold text-sm">Notifications</p>
                <p className="text-xs font-semibold text-[#606C38] opacity-70">Reminders & Alerts</p>
              </div>
            </div>
            <button className="w-12 h-6 rounded-full bg-[#606C38] flex items-center px-1">
              <div className="w-4 h-4 bg-white rounded-full translate-x-6" />
            </button>
          </div>
        </div>

        <button 
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-4 bg-[#BC6C25]/10 text-[#BC6C25] border border-[#BC6C25]/20 rounded-xl font-bold hover:bg-[#BC6C25]/20 transition mt-8"
        >
          <LogOut className="w-5 h-5" /> {t('log_out')}
        </button>

        <div className="bg-white rounded-[32px] p-2 shadow-sm border border-[#E5E1D8] mt-4">
          <div className="p-4">
            <p className="font-bold text-sm">Data & Testing</p>
            <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-1">
              Clears local IndexedDB data (useful after wiping Supabase).
            </p>
          </div>
          <div className="px-4 pb-4">
            <button
              onClick={handleResetLocalData}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 text-red-700 border border-red-200 rounded-xl font-bold hover:bg-red-100 transition"
            >
              <Trash2 className="w-4 h-4" /> Reset Local Data
            </button>
          </div>
        </div>

        {role === 'caregiver' && (
          <div className="bg-white rounded-[32px] p-2 shadow-sm border border-[#E5E1D8] mt-4">
            <div className="p-4">
              <p className="font-bold text-sm">Local Backup</p>
              <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-1">
                Export patients, medications, and logs from this device to a JSON file, then import it on another caregiver device.
              </p>
              <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-2">
                Export filename: <span className="font-mono">medicore-backup-YYYY-MM-DD.json</span>
              </p>
            </div>
            <div className="px-4 pb-4 space-y-3">
              <button
                onClick={handleExportBackup}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#606C38] text-white border border-[#606C38] rounded-xl font-bold hover:opacity-90 transition"
              >
                <Download className="w-4 h-4" /> Export Local Backup
              </button>
              <button
                onClick={() => backupInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#F2F0E4] text-[#606C38] border border-[#E5E1D8] rounded-xl font-bold hover:bg-[#E5E1D8] transition"
              >
                <Upload className="w-4 h-4" /> Import Backup File
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportBackup}
              />
            </div>
          </div>
        )}

        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-[#E5E1D8]">
          <p className="font-bold text-sm">Diagnostics</p>
          <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-1">
            Use this to confirm both phones are on the same backend/project and account.
          </p>
          <div className="mt-4 space-y-2 text-xs font-bold">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#606C38] opacity-70">Role</span>
              <span className="text-[#283618]">{role || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#606C38] opacity-70">User ID</span>
              <span className="text-[#283618] font-mono truncate max-w-[220px]">{user?.id || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#606C38] opacity-70">Supabase URL</span>
              <span className="text-[#283618] font-mono truncate max-w-[220px]">
                {(import.meta.env.VITE_SUPABASE_URL as string) || '(missing)'}
              </span>
            </div>
          </div>
        </div>

      </motion.div>
    </div>
  );
}
