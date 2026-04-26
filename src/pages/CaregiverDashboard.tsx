import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Settings as SettingsIcon, Plus, AlertCircle, Activity, Users, Pill, Edit2, ChevronRight, RotateCcw, Clock3, Sparkles } from 'lucide-react';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, ResponsiveContainer, XAxis, Tooltip, CartesianGrid } from 'recharts';
import { toast } from 'sonner';
import { refreshCaregiverData, scheduleCaregiverSync, syncCaregiverNow } from '../lib/sync';
import { generateId } from '../lib/id';
import { differenceInCalendarDays, format, formatDistanceToNowStrict, isSameDay, parseISO, subDays } from 'date-fns';

export default function CaregiverDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const caregiverId = user?.id || '';
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  // Keep this device in sync with Supabase without requiring re-login.
  useEffect(() => {
    if (!user?.id) return;

    refreshCaregiverData(user.id);

    const onFocus = () => refreshCaregiverData(user.id);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.id]);
  
  const patients = useLiveQuery(
    () => db.patients.where('caregiver_id').equals(caregiverId).toArray(),
    [caregiverId]
  ) || [];
  const activePatients = patients.filter(p => p.status !== 'archived');
  const archivedPatients = patients.filter(p => p.status === 'archived');

  const trendPatient = useMemo(() => {
    const selected = selectedPatientId ? activePatients.find(p => p.id === selectedPatientId) : undefined;
    return selected || activePatients[0] || patients[0] || null;
  }, [activePatients, patients, selectedPatientId]);

  const trendMeds = useLiveQuery(
    () => (trendPatient?.id ? db.medications.where('patient_id').equals(trendPatient.id).toArray() : []),
    [trendPatient?.id]
  ) || [];

  const trendLogs = useLiveQuery(
    () => (trendPatient?.id ? db.medication_logs.where('patient_id').equals(trendPatient.id).toArray() : []),
    [trendPatient?.id]
  ) || [];

  const patientIds = useMemo(() => activePatients.map(p => p.id), [activePatients]);
  const medicationsTracked = useLiveQuery(
    async () => {
      if (patientIds.length === 0) return 0;
      return db.medications.where('patient_id').anyOf(patientIds).count();
    },
    [patientIds.join('|')]
  ) ?? 0;
  const allLogs = useLiveQuery(
    () => (patientIds.length > 0 ? db.medication_logs.where('patient_id').anyOf(patientIds).toArray() : []),
    [patientIds.join('|')]
  ) || [];
  const allMedications = useLiveQuery(
    () => (patientIds.length > 0 ? db.medications.where('patient_id').anyOf(patientIds).toArray() : []),
    [patientIds.join('|')]
  ) || [];

  const lastActivityByPatientId = useMemo(() => {
    const map = new Map<string, Date>();
    for (const log of allLogs) {
      const d = new Date(log.taken_at);
      if (Number.isNaN(d.getTime())) continue;
      const prev = map.get(log.patient_id);
      if (!prev || d > prev) map.set(log.patient_id, d);
    }
    return map;
  }, [allLogs]);

  const medicationCountByPatientId = useMemo(() => {
    const map = new Map<string, number>();
    for (const med of allMedications) {
      map.set(med.patient_id, (map.get(med.patient_id) || 0) + 1);
    }
    return map;
  }, [allMedications]);

  const computeDueTimesForDay = (med: any, dayDate: Date): string[] => {
    const start = med.start_date ? parseISO(med.start_date) : new Date(med.created_at);
    start.setHours(0, 0, 0, 0);
    const d = new Date(dayDate);
    d.setHours(0, 0, 0, 0);
    const diff = differenceInCalendarDays(d, start);
    if (diff < 0) return [];

    if (med.interval === 'alternate') {
      if (diff % 2 !== 0) return [];
    } else if (med.interval === 'x_days') {
      const intervalDays = med.interval_days && med.interval_days > 0 ? med.interval_days : 1;
      if (diff % intervalDays !== 0) return [];
    }

    const times = med.timing ? String(med.timing).split(',').map((t: string) => t.trim()).filter(Boolean) : ['08:00'];
    return times.length > 0 ? times : ['08:00'];
  };

  const adherenceSeries = useMemo(() => {
    if (!trendPatient) return [];

    const days = Array.from({ length: 7 }, (_, idx) => subDays(new Date(), 6 - idx));
    return days.map((dayDate) => {
      let scheduled = 0;
      let taken = 0;

      // De-dupe on (medication_id + notes) to avoid double counting if logs are re-saved.
      const takenKeys = new Set<string>();

      for (const med of trendMeds) {
        const times = computeDueTimesForDay(med, dayDate);
        if (times.length === 0) continue;
        scheduled += times.length;
      }

      for (const log of trendLogs) {
        if (log.status !== 'taken') continue;
        const logDate = new Date(log.taken_at);
        if (Number.isNaN(logDate.getTime())) continue;
        if (!isSameDay(logDate, dayDate)) continue;
        const key = `${log.medication_id}:${log.notes || ''}`;
        if (takenKeys.has(key)) continue;
        takenKeys.add(key);
        taken += 1;
      }

      const completion = scheduled > 0 ? Math.round((taken / scheduled) * 100) : 0;
      return {
        day: format(dayDate, 'EEE'),
        completion,
        scheduled
      };
    });
  }, [trendMeds, trendLogs, trendPatient]);

  const averageAdherence = useMemo(() => {
    const valid = adherenceSeries.filter(d => d.scheduled > 0);
    if (valid.length === 0) return 0;
    const sum = valid.reduce((acc, d) => acc + d.completion, 0);
    return Math.round(sum / valid.length);
  }, [adherenceSeries]);

  const overdueDosesToday = useMemo(() => {
    if (!trendPatient) return 0;
    const now = new Date();
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build a set of taken keys for today.
    const takenKeys = new Set<string>();
    for (const log of trendLogs) {
      if (log.status !== 'taken') continue;
      const logDate = new Date(log.taken_at);
      if (Number.isNaN(logDate.getTime())) continue;
      if (!isSameDay(logDate, today)) continue;
      takenKeys.add(`${log.medication_id}:${log.notes || ''}`);
    }

    let overdue = 0;
    for (const med of trendMeds) {
      const times = computeDueTimesForDay(med, today);
      if (times.length === 0) continue;
      times.forEach((time: string, idx: number) => {
        const [h, m] = time.split(':').map(Number);
        const dueSec = (Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60;
        if (dueSec >= nowSeconds) return;
        const key = `${med.id}:Dose ${idx + 1}`;
        if (takenKeys.has(key)) return;
        overdue += 1;
      });
    }
    return overdue;
  }, [trendLogs, trendMeds, trendPatient]);

  const handleAddPatient = async () => {
    if (!user?.id) {
      toast.error('Please log in again');
      navigate('/auth?role=caregiver');
      return;
    }
    try {
      const id = generateId();
      await db.patients.add({
        id,
        caregiver_id: caregiverId,
        first_name: '',
        last_name: '',
        dob: '',
        notes: '',
        designation: '',
        status: 'active',
        created_at: new Date().toISOString()
      });
      scheduleCaregiverSync(caregiverId);
      navigate(`/caregiver/patient/${id}?edit=true&new=true`);
    } catch (error) {
      console.error('Failed to add patient', error);
      toast.error('Failed to add patient');
    }
  };

  const handleManualSync = async () => {
    if (!caregiverId || isSyncingNow) return;

    try {
      setIsSyncingNow(true);
      const res = await syncCaregiverNow(caregiverId);
      if (res.error) {
        toast.error(`Sync failed: ${res.error}`);
        return;
      }

      toast.success(
        `Sync complete: ${res.patients} patients, ${res.medications} medications, ${res.logs} logs.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      toast.error(`Sync failed: ${message}`);
    } finally {
      setIsSyncingNow(false);
    }
  };

  // Derive some realistic looking mock stats based on patient count
  const stats = useMemo(() => {
    return {
      activePatients: activePatients.length,
      averageAdherence: activePatients.length > 0 ? averageAdherence : 0,
      medicationsTracked
    };
  }, [activePatients, averageAdherence, medicationsTracked]);

  const recentlyUpdatedLabel = useMemo(() => {
    if (lastActivityByPatientId.size === 0) return 'No recent logs yet';
    const latest = [...lastActivityByPatientId.values()].sort((a, b) => b.getTime() - a.getTime())[0];
    return `Last update ${formatDistanceToNowStrict(latest, { addSuffix: true })}`;
  }, [lastActivityByPatientId]);

  const dashboardTone = overdueDosesToday > 0 ? 'Needs attention today' : 'Steady and on track';

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[#FBFBF8] pb-24 text-[#283618] font-sans">
      <div className="bg-[#F2F0E4] border-b border-[#E5E1D8] rounded-b-[40px] p-6 pt-12 pb-8 shadow-sm relative z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_right,_rgba(221,161,94,0.3),_transparent_55%)] pointer-events-none" />
        <div className="flex justify-between items-start mb-6 relative">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#D9D3C3] bg-white/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#606C38]">
              <Sparkles className="h-3.5 w-3.5" />
              Daily overview
            </div>
            <div>
              <h1 className="text-[28px] font-bold tracking-tight text-[#283618] leading-tight">Caregiver Dashboard</h1>
              <p className="text-sm text-[#606C38] opacity-80 font-semibold mt-1">{user?.name || 'Primary Caregiver'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#606C38]">
              <span className="rounded-full bg-white/80 px-3 py-1 border border-[#E5E1D8]">{dashboardTone}</span>
              <span className="rounded-full bg-white/50 px-3 py-1 border border-[#E5E1D8]">{recentlyUpdatedLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualSync}
              disabled={isSyncingNow}
              className="h-10 px-3 bg-white border border-[#E5E1D8] shadow-sm rounded-full flex items-center justify-center gap-2 hover:bg-[#E5E1D8] transition text-[#606C38] disabled:opacity-60 disabled:cursor-not-allowed"
              title="Sync now"
            >
              <RotateCcw className={`w-4 h-4 ${isSyncingNow ? 'animate-spin' : ''}`} />
              <span className="text-xs font-bold">{isSyncingNow ? 'Syncing' : 'Sync now'}</span>
            </button>
            <button 
              onClick={() => navigate('/settings')}
              className="w-10 h-10 bg-white border border-[#E5E1D8] shadow-sm rounded-full flex items-center justify-center hover:bg-[#E5E1D8] transition text-[#606C38]"
              title="Settings"
            >
              <SettingsIcon className="w-5 h-5 text-[#606C38]" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white border border-[#E5E1D8] rounded-[24px] p-4 shadow-sm flex flex-col items-start justify-center">
            <Users className="w-5 h-5 text-[#DDA15E] mb-2"/>
            <p className="text-2xl font-bold leading-none">{stats.activePatients}</p>
            <p className="text-[10px] uppercase font-bold text-[#606C38] opacity-70 mt-2 tracking-wider">Active Patients</p>
          </div>
          <div className="bg-[#606C38] rounded-[24px] p-4 shadow-sm flex flex-col items-start justify-center text-white">
            <Activity className="w-5 h-5 mb-2 opacity-80"/>
            <p className="text-2xl font-bold leading-none">{stats.averageAdherence}%</p>
            <p className="text-[10px] uppercase font-bold opacity-80 mt-2 tracking-wider">Avg Adherence</p>
          </div>
          <div className="bg-white border border-[#E5E1D8] rounded-[24px] p-4 shadow-sm flex flex-col items-start justify-center">
            <Pill className="w-5 h-5 text-[#BC6C25] mb-2"/>
            <p className="text-2xl font-bold leading-none">{stats.medicationsTracked}</p>
            <p className="text-[10px] uppercase font-bold text-[#606C38] opacity-70 mt-2 tracking-wider">Tracked Meds</p>
          </div>
        </div>

        {patients.length > 0 ? (
          overdueDosesToday > 0 ? (
            <div className="bg-[#BC6C25]/10 border border-[#BC6C25]/20 text-[#BC6C25] p-4 rounded-[24px] flex items-start gap-3 ring-2 ring-[#BC6C25]/10 shadow-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-[#BC6C25]">
                  {overdueDosesToday} Overdue Dose{overdueDosesToday === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-[#BC6C25] opacity-80 mt-0.5 font-bold">
                  Priority: Check {trendPatient?.first_name || 'patient'}'s daily log.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white/60 border border-[#E5E1D8] p-4 rounded-[24px] flex items-center gap-3">
              <Activity className="w-5 h-5 text-[#606C38]" />
              <p className="text-[13px] font-bold text-[#606C38]">No overdue doses right now.</p>
            </div>
          )
        ) : (
          <div className="bg-white/60 border border-[#E5E1D8] p-4 rounded-[24px] flex items-center gap-3">
            <Activity className="w-5 h-5 text-[#606C38]" />
            <p className="text-[13px] font-bold text-[#606C38]">Welcome! Add a patient to begin.</p>
          </div>
        )}
      </div>

      <div className="p-6 space-y-6 relative z-20">
        {trendPatient && (
          <div className="bg-white p-5 rounded-[32px] border border-[#E5E1D8] shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold">
                  {(trendPatient.first_name || 'Patient') + "'s"} Adherence
                </h2>
                <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-1">
                  Daily completion trend for the selected patient.
                </p>
              </div>
              <span className="text-[10px] font-bold text-[#606C38] bg-[#F2F0E4] px-2 py-1 rounded-lg uppercase tracking-wider">Last 7 Days</span>
            </div>
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={adherenceSeries} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E1D8" />
                  <XAxis 
                    dataKey="day" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#606C38', fontSize: 10, fontWeight: 'bold', opacity: 0.7 }}
                    dy={10} 
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                    labelStyle={{ color: '#606C38', fontSize: '10px' }}
                    itemStyle={{ color: '#283618', fontSize: '12px' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="completion" 
                    stroke="#606C38" 
                    strokeWidth={3}
                    dot={{ fill: '#DDA15E', strokeWidth: 2, r: 4, stroke: '#fff' }} 
                    activeDot={{ r: 6, fill: '#BC6C25' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Patients List */}
        <div>
          <div className="flex items-center justify-between mb-4 ml-2">
            <div>
              <h2 className="text-lg font-bold">My Patients</h2>
              <p className="text-xs font-semibold text-[#606C38] opacity-70 mt-1">
                Tap a card to reveal quick actions and status details.
              </p>
            </div>
            <button 
              onClick={handleAddPatient}
              className="text-xs font-bold text-white bg-[#606C38] flex items-center gap-1 hover:opacity-90 px-3 py-2 rounded-xl transition shadow-sm"
            >
              <Plus className="w-4 h-4"/> Add
            </button>
          </div>

          <div className="space-y-4">
            {activePatients.length === 0 ? (
              <div className="bg-white rounded-[32px] p-8 text-center shadow-sm border border-[#E5E1D8]">
                <div className="w-16 h-16 bg-[#F2F0E4] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#E5E1D8]">
                  <Users className="w-8 h-8 text-[#606C38]" />
                </div>
                <p className="text-[#283618] font-bold mb-1">No active patients</p>
                <p className="text-xs text-[#606C38] opacity-70 mb-6 font-semibold">Start building your network by adding your first patient.</p>
                <button 
                  onClick={handleAddPatient}
                  className="bg-[#606C38] text-white px-6 py-3 rounded-xl font-bold active:scale-95 transition shadow-sm w-full"
                >
                  Add Your First Patient
                </button>
              </div>
            ) : (
              activePatients.map((patient, idx) => (
                  <motion.div 
                    initial={{opacity: 0, y: 10}}
                    animate={{opacity: 1, y: 0}}
                    transition={{ delay: idx * 0.05 }}
                    key={patient.id} 
                    onClick={() => { setSelectedPatientId(selectedPatientId === patient.id ? null : patient.id); }}
                    className={`bg-white p-5 rounded-[32px] shadow-sm border ${selectedPatientId === patient.id ? 'border-[#606C38] shadow-md' : 'border-[#E5E1D8]'} flex flex-col cursor-pointer transition-all group relative overflow-hidden`}
                  >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#606C38] opacity-80" />
                  
                  <div className="flex items-start justify-between pl-3 relative z-10 w-full gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                      {patient.photo ? (
                        <img src={patient.photo} alt={patient.first_name} className="w-12 h-12 rounded-full object-cover shrink-0 border border-[#E5E1D8] shadow-sm" />
                      ) : (
                        <div className="w-12 h-12 bg-[#DDA15E] text-white rounded-full flex items-center justify-center font-bold text-lg shadow-sm border-2 border-white shrink-0">
                          {patient.first_name?.[0]}{patient.last_name?.[0]}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-bold text-[#283618] truncate">{patient.designation ? `${patient.designation} ` : ''}{patient.first_name} {patient.last_name}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md ${
                            lastActivityByPatientId.get(patient.id)
                              ? 'text-[#606C38] bg-[#606C38]/10'
                              : 'text-[#BC6C25] bg-[#BC6C25]/10'
                          }`}>
                             <AlertCircle className="w-3 h-3"/>
                             {lastActivityByPatientId.get(patient.id) ? 'Monitoring' : 'Needs first log'}
                          </span>
                          <span className="text-[10px] text-[#606C38] opacity-70 font-bold uppercase">
                             {lastActivityByPatientId.get(patient.id)
                               ? `Updated ${formatDistanceToNowStrict(lastActivityByPatientId.get(patient.id) as Date, { addSuffix: true })}`
                               : 'No logs yet'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 shrink-0 mt-1 text-[#606C38] transition-transform ${selectedPatientId === patient.id ? 'rotate-90' : ''}`} />
                  </div>

                  <div className="mt-4 pl-3 grid grid-cols-3 gap-2 relative z-10">
                    <div className="rounded-2xl border border-[#EDE7D9] bg-[#FBFBF8] px-3 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#606C38] opacity-70">Medications</p>
                      <p className="mt-1 text-base font-bold text-[#283618]">{medicationCountByPatientId.get(patient.id) || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-[#EDE7D9] bg-[#FBFBF8] px-3 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#606C38] opacity-70">Status</p>
                      <p className="mt-1 text-sm font-bold text-[#283618]">{patient.dob ? format(parseISO(patient.dob), 'MMM d, yyyy') : 'DOB missing'}</p>
                    </div>
                    <div className="rounded-2xl border border-[#EDE7D9] bg-[#FBFBF8] px-3 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#606C38] opacity-70">Recent activity</p>
                      <p className="mt-1 text-sm font-bold text-[#283618] flex items-center gap-1">
                        <Clock3 className="w-3.5 h-3.5 text-[#606C38]" />
                        {lastActivityByPatientId.get(patient.id) ? 'Logged' : 'Waiting'}
                      </p>
                    </div>
                  </div>

                  <AnimatePresence>
                    {selectedPatientId === patient.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        className="pl-3 overflow-hidden border-t border-[#E5E1D8] pt-4"
                      >
                         <div className="mb-4 rounded-2xl bg-[#F7F4EB] border border-[#E5E1D8] p-3 flex items-start gap-3">
                           <div className="w-9 h-9 rounded-xl bg-white border border-[#E5E1D8] flex items-center justify-center text-[#606C38] shrink-0">
                             <Activity className="w-4 h-4" />
                           </div>
                           <div>
                             <p className="text-sm font-bold text-[#283618]">Quick care actions</p>
                             <p className="text-xs font-semibold text-[#606C38] opacity-75 mt-1">
                               Jump into editing, add a medication, or open the full patient record.
                             </p>
                           </div>
                         </div>
                         <div className="grid grid-cols-3 gap-2">
                           <button 
                             onClick={(e) => { e.stopPropagation(); navigate(`/caregiver/patient/${patient.id}?mode=edit`); }}
                             className="flex flex-col items-center gap-1.5 text-[#606C38] hover:text-[#283618] transition"
                           >
                             <div className="w-10 h-10 rounded-full bg-[#F2F0E4] flex items-center justify-center"><Edit2 className="w-4 h-4"/></div>
                             <span className="text-[10px] font-bold uppercase tracking-wider">Edit</span>
                           </button>
                           <button 
                             onClick={(e) => { e.stopPropagation(); navigate(`/caregiver/patient/${patient.id}/medication/new`); }}
                             className="flex flex-col items-center gap-1.5 text-[#DDA15E] hover:text-[#BC6C25] transition"
                           >
                             <div className="w-10 h-10 rounded-full bg-[#DDA15E]/10 flex items-center justify-center"><Plus className="w-4 h-4"/></div>
                             <span className="text-[10px] font-bold uppercase tracking-wider">Add Medicine</span>
                           </button>
                           <button 
                             onClick={(e) => { e.stopPropagation(); navigate(`/caregiver/patient/${patient.id}`); }}
                             className="flex flex-col items-center gap-1.5 text-white transition"
                           >
                             <div className="w-10 h-10 rounded-full bg-[#606C38] hover:bg-[#283618] flex items-center justify-center shadow-sm"><ChevronRight className="w-5 h-5"/></div>
                             <span className="text-[10px] text-[#606C38] font-bold uppercase tracking-wider">View</span>
                           </button>
                         </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
          
          {archivedPatients.length > 0 && (
             <div className="mt-8">
               <h3 className="text-sm font-bold opacity-50 mb-3 ml-2 uppercase tracking-wide">Archived Patients ({archivedPatients.length})</h3>
               <div className="space-y-3">
                  {archivedPatients.map(patient => (
                    <div key={patient.id} className="bg-white/50 p-4 border border-[#E5E1D8]/50 rounded-[20px] flex items-center justify-between opacity-80">
                      <div className="flex items-center gap-3">
                         {patient.photo ? (
                           <img src={patient.photo} alt={patient.first_name} className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#E5E1D8] grayscale shadow-sm" />
                         ) : (
                           <div className="w-10 h-10 bg-gray-200 text-gray-500 grayscale rounded-full flex items-center justify-center font-bold text-sm shadow-sm">
                             {patient.first_name?.[0]}{patient.last_name?.[0]}
                           </div>
                         )}
                         <div>
                           <p className="font-bold text-gray-500 text-sm">{patient.designation ? `${patient.designation} ` : ''}{patient.first_name} {patient.last_name}</p>
                         </div>
                      </div>
                      <button 
                         onClick={async (e) => {
                           e.stopPropagation();
                           await db.patients.update(patient.id, { status: 'active' });
                           toast.success('Patient restored');
                           scheduleCaregiverSync(caregiverId);
                         }}
                         className="text-[10px] font-bold text-[#606C38] bg-[#F2F0E4] px-3 py-1.5 rounded-lg uppercase tracking-wider hover:bg-[#E5E1D8]"
                      >
                         Restore
                      </button>
                    </div>
                  ))}
               </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
