import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, CheckCircle2, Circle, Clock, Pill, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { refreshPatientData, schedulePatientSync, deleteMedicationLogCloud } from '../lib/sync';
import { generateId } from '../lib/id';
import { ImageLightbox } from '../components/ImageLightbox';

type ScheduleGroup = {
  key: string;
  label: string;
  items: any[];
  order: number;
};

type TimelineSection =
  | { type: 'group'; key: string; label: string; items: any[] }
  | { type: 'divider'; key: string; label: string };

export default function PatientDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore(state => state.user);
  
  const [currentTime, setCurrentTime] = useState(format(new Date(), 'HH:mm:ss'));
  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);
  const [statusTab, setStatusTab] = useState<'overdue' | 'upcoming' | 'completed'>('upcoming');
  const [dayOffset, setDayOffset] = useState<number>(0); // -3..+3

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const viewingDate = useMemo(() => addDays(todayStart, dayOffset), [todayStart, dayOffset]);
  const isViewingToday = useMemo(() => isSameDay(viewingDate, todayStart), [viewingDate, todayStart]);

  const timeToSeconds = (timeStr: string): number | null => {
    const parts = timeStr.split(':').map((p) => Number(p));
    if (parts.length < 2) return null;
    const [hours, minutes, seconds = 0] = parts;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  };

  const formatScheduleTime = (timeStr: string): string => {
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeStr;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return format(date, 'h:mm a');
  };

  const formatScheduleLabel = (value?: string): string => {
    const labelMap: Record<string, string> = {
      before_breakfast: 'Before Breakfast',
      after_breakfast: 'After Breakfast',
      before_lunch: 'Before Lunch',
      after_lunch: 'After Lunch',
      before_snacks: 'Before Snacks',
      after_snacks: 'After Snacks',
      before_dinner: 'Before Dinner',
      after_dinner: 'After Dinner',
    };

    if (!value) return '';
    return labelMap[value] || value;
  };

  const getScheduleOrder = (value?: string): number => {
    const order: Record<string, number> = {
      before_breakfast: 1,
      after_breakfast: 2,
      before_lunch: 3,
      after_lunch: 4,
      before_snacks: 5,
      after_snacks: 6,
      before_dinner: 7,
      after_dinner: 8,
    };

    return value ? (order[value] ?? 99) : 99;
  };

  // Keep time updated every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(format(new Date(), 'HH:mm:ss'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const medications = useLiveQuery(() => user?.id ? db.medications.where('patient_id').equals(user.id).toArray() : [], [user?.id]) || [];
  const logs = useLiveQuery(() => user?.id ? db.medication_logs.where('patient_id').equals(user.id).toArray() : [], [user?.id]) || [];

  // Keep patient data fresh across devices (caregiver may add meds from another device).
  useEffect(() => {
    if (!user?.id) return;
    refreshPatientData(user.id);

    const onFocus = () => refreshPatientData(user.id);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.id]);

  const buildScheduleForDate = (date: Date) => {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    const nowSeconds = isSameDay(dateStart, todayStart) ? (timeToSeconds(currentTime) ?? 0) : null;
    const schedule: any[] = [];

    medications.forEach(med => {
      const start = med.start_date ? parseISO(med.start_date) : new Date(med.created_at);
      start.setHours(0, 0, 0, 0);
      const diff = differenceInCalendarDays(dateStart, start);

      // Don't show meds before their start date
      if (diff < 0) return;

      if (med.interval === 'alternate') {
        if (diff % 2 !== 0) return;
      } else if (med.interval === 'x_days') {
        const intervalDays = med.interval_days && med.interval_days > 0 ? med.interval_days : 1;
        if (diff % intervalDays !== 0) return;
      }

      const times = med.timing ? med.timing.split(',').map(t => t.trim()).filter(Boolean) : ['08:00'];
      const scheduleLabels = med.schedule_labels ? med.schedule_labels.split(',').map((value: string) => value.trim()).filter(Boolean) : [];
      times.forEach((time, index) => {
        const doseId = `${med.id}-${index}`;
        const takenLog = logs.find(
          log =>
            log.medication_id === med.id &&
            log.notes === `Dose ${index + 1}` &&
            isSameDay(new Date(log.taken_at), dateStart)
        );

        const status = takenLog ? 'taken' : 'pending';
        const expectedSeconds = timeToSeconds(time.length === 5 ? `${time}:00` : time) ?? 0;

        const category =
          status === 'taken'
            ? 'completed'
            : nowSeconds === null
              ? dateStart.getTime() < todayStart.getTime()
                ? 'overdue'
                : 'upcoming'
              : expectedSeconds < nowSeconds
                ? 'overdue'
                : 'upcoming';

        schedule.push({
          id: doseId,
          medId: med.id,
          doseIndex: index + 1,
          name: med.name,
          dosage: med.dosage,
          type: med.type,
          time,
          scheduleLabel: scheduleLabels[index] || '',
          photo: med.photo,
          status,
          logId: takenLog?.id,
          takenAt: takenLog?.taken_at,
          inventory: med.inventory_count,
          category
        });
      });
    });

    schedule.sort((a, b) => {
      const aSec = timeToSeconds(a.time.length === 5 ? `${a.time}:00` : a.time) ?? 0;
      const bSec = timeToSeconds(b.time.length === 5 ? `${b.time}:00` : b.time) ?? 0;
      return aSec - bSec;
    });

    return schedule;
  };

  const todaySchedule = useMemo(() => buildScheduleForDate(todayStart), [medications, logs, currentTime, todayStart]);
  const viewingSchedule = useMemo(() => buildScheduleForDate(viewingDate), [medications, logs, currentTime, viewingDate]);

  const handleTakeMed = async (medItem: any) => {
    if (!user?.id) return;
    if (!isViewingToday) {
      toast.error('You can only update today’s schedule');
      return;
    }
    try {
      await db.transaction('rw', db.medications, db.medication_logs, async () => {
         // 1. Create Log
         await db.medication_logs.add({
           id: generateId(),
           medication_id: medItem.medId,
           patient_id: user.id,
           status: 'taken',
           taken_at: new Date().toISOString(),
           notes: `Dose ${medItem.doseIndex}`
         });

         // 2. Decrement inventory
         const med = await db.medications.get(medItem.medId);
         if (med && med.inventory_count > 0) {
            await db.medications.update(medItem.medId, { inventory_count: med.inventory_count - 1 });
         }
      });
      
      toast.success('Medication marked as taken');
      // Fire and forget push to cloud to persist log upstream instantly
      schedulePatientSync(user.id);
    } catch (err) {
      toast.error('Failed to log medication');
    }
  };

  const handleUndoMed = async (medItem: any) => {
    if (!user?.id || !medItem.logId) return;
    if (!isViewingToday) {
      toast.error('You can only update today’s schedule');
      return;
    }
    try {
      await db.transaction('rw', db.medications, db.medication_logs, async () => {
         await db.medication_logs.delete(medItem.logId);
         
         const med = await db.medications.get(medItem.medId);
         if (med) {
            await db.medications.update(medItem.medId, { inventory_count: med.inventory_count + 1 });
         }
      });
      
      toast.success('Restored medication to pending');
      
      // Sync cloud state (delete log and upsert incremented inventory)
      deleteMedicationLogCloud(medItem.logId);
      schedulePatientSync(user.id);
    } catch (err) {
      toast.error('Failed to undo medication state');
    }
  };

  const pendingCount = useMemo(() => todaySchedule.filter(m => m.status === 'pending').length, [todaySchedule]);

  const filteredByStatus = useMemo(() => {
    return {
      overdue: viewingSchedule.filter(m => m.category === 'overdue'),
      upcoming: viewingSchedule.filter(m => m.category === 'upcoming'),
      completed: viewingSchedule.filter(m => m.category === 'completed')
    };
  }, [viewingSchedule]);

  const visibleItems = filteredByStatus[statusTab];
  const groupedVisibleItems = useMemo(() => {
    const groups = new Map<string, ScheduleGroup>();

    visibleItems.forEach((item) => {
      const key = item.scheduleLabel || 'unscheduled';
      const label = item.scheduleLabel ? formatScheduleLabel(item.scheduleLabel) : 'Other';
      const existing = groups.get(key);

      if (existing) {
        existing.items.push(item);
        return;
      }

      groups.set(key, {
        key,
        label,
        items: [item],
        order: getScheduleOrder(item.scheduleLabel),
      });
    });

    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [visibleItems]);
  const timelineSections = useMemo(() => {
    const groupMap = new Map<string, ScheduleGroup>(groupedVisibleItems.map((group) => [group.key, group]));
    const hasAnyForMeal = (keys: string[]) => keys.some((key) => groupMap.has(key));
    const sections: TimelineSection[] = [];

    const orderedMeals = [
      {
        before: 'before_breakfast',
        divider: 'BREAKFAST',
        after: 'after_breakfast',
      },
      {
        before: 'before_lunch',
        divider: 'LUNCH',
        after: 'after_lunch',
      },
      {
        before: 'before_snacks',
        divider: 'SNACKS',
        after: 'after_snacks',
      },
      {
        before: 'before_dinner',
        divider: 'DINNER',
        after: 'after_dinner',
      },
    ] as const;

    orderedMeals.forEach((meal) => {
      const keys = [meal.before, meal.after];
      if (!hasAnyForMeal(keys)) return;

      const beforeGroup = groupMap.get(meal.before);
      if (beforeGroup) {
        sections.push({
          type: 'group',
          key: beforeGroup.key,
          label: beforeGroup.label,
          items: beforeGroup.items,
        });
      }

      sections.push({
        type: 'divider',
        key: meal.divider.toLowerCase(),
        label: meal.divider,
      });

      const afterGroup = groupMap.get(meal.after);
      if (afterGroup) {
        sections.push({
          type: 'group',
          key: afterGroup.key,
          label: afterGroup.label,
          items: afterGroup.items,
        });
      }
    });

    const unscheduled = groupMap.get('unscheduled');
    if (unscheduled) {
      sections.push({
        type: 'group',
        key: unscheduled.key,
        label: unscheduled.label,
        items: unscheduled.items,
      });
    }

    return sections;
  }, [groupedVisibleItems]);

  const getRelativeTime = (medTime: string, isOverdue: boolean) => {
    const [nowH, nowM, nowS = 0] = currentTime.split(':').map(Number);
    const [medH, medM] = medTime.split(':').map(Number);
    
    const diffSecs = (nowH * 3600 + nowM * 60 + nowS) - (medH * 3600 + medM * 60);
    const absSecs = Math.abs(diffSecs);

    if (absSecs === 0) return 'now';

    const hrs = Math.floor(absSecs / 3600);
    const mins = Math.floor((absSecs % 3600) / 60);
    const secs = absSecs % 60;
    
    let str = '';
    if (hrs > 0) str += `${hrs}h `;
    if (mins > 0 || hrs > 0) str += `${mins}m `;
    str += `${secs}s`;
    str = str.trim();
    
    return isOverdue ? `${str} late` : `in ${str}`;
  };

  const renderMedCard = (med: any, category: 'overdue' | 'upcoming' | 'completed') => {
    const isOverdue = category === 'overdue';
    const isCompleted = category === 'completed';
    
    let containerClass = "bg-white border-[#E5E1D8]";
    let iconBgClass = "bg-[#F2F0E4] text-[#606C38]";
    let titleClass = "text-[#283618]";
    let pillIconClass = "w-6 h-6 transform rotate-45";
    
    if (isCompleted) {
       containerClass = "bg-[#606C38]/5 border-[#606C38]/10";
       iconBgClass = "bg-[#606C38] text-white";
       titleClass = "text-[#606C38] line-through opacity-60";
    } else if (isOverdue) {
       containerClass = "bg-[#BC6C25]/5 border-[#BC6C25]/20";
       iconBgClass = "bg-[#BC6C25]/20 text-[#BC6C25]";
    }

    const scheduleBadgeClass = isCompleted
      ? 'bg-[#606C38]/10 text-[#606C38] border-[#606C38]/20'
      : isOverdue
        ? 'bg-[#BC6C25]/10 text-[#BC6C25] border-[#BC6C25]/20'
        : 'bg-[#F2F0E4] text-[#606C38] border-[#E5E1D8]';

    return (
      <motion.div
        key={med.id}
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-[22px] p-4 shadow-sm border ${containerClass}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center mt-0.5 overflow-hidden ${iconBgClass}`}>
              {med.photo ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox({ src: med.photo, alt: med.name });
                  }}
                  className="w-full h-full cursor-zoom-in"
                  aria-label="View medication photo"
                >
                  <img src={med.photo} alt={med.name} className="w-full h-full object-cover" />
                </button>
              ) : (
                <Pill className={pillIconClass} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className={`font-bold text-[15px] leading-5 truncate ${titleClass}`}>
                    {med.name}
                  </h3>
                  <p className="text-[12px] text-[#606C38] opacity-80 font-bold truncate mt-1">
                    {med.dosage}{med.type ? ` • ${med.type}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="flex items-center justify-end gap-1 text-[12px] font-bold text-[#606C38] opacity-80">
                    <Clock className="w-3.5 h-3.5" /> {formatScheduleTime(med.time)}
                  </div>
                  {isCompleted ? (
                    <div className="text-[11px] font-bold text-[#606C38] opacity-60 mt-1">
                      {med.takenAt ? `Taken ${format(new Date(med.takenAt), 'h:mm a')}` : 'Taken'}
                    </div>
                  ) : (
                    isViewingToday ? (
                      <div className={`text-[11px] font-bold mt-1 ${isOverdue ? 'text-[#BC6C25]' : 'text-[#606C38]'}`}>
                        {getRelativeTime(med.time, isOverdue)}
                      </div>
                    ) : (
                      <div className="text-[11px] font-bold text-[#606C38] opacity-60 mt-1">Scheduled</div>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-2xl border px-3 py-3 ${scheduleBadgeClass}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Meal block</p>
              <p className="mt-1 text-sm font-bold">
                {med.scheduleLabel ? formatScheduleLabel(med.scheduleLabel) : 'Scheduled dose'}
              </p>
            </div>
            <div className="rounded-2xl border border-[#E5E1D8] bg-[#FBFBF8] px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#606C38] opacity-70">Today status</p>
              <p className={`mt-1 text-sm font-bold ${isOverdue ? 'text-[#BC6C25]' : 'text-[#283618]'}`}>
                {isCompleted ? 'Completed' : isOverdue ? 'Needs attention' : 'Upcoming'}
              </p>
            </div>
          </div>
          
          <div className="flex justify-end border-t border-[#E5E1D8]/50 pt-3">
            {med.status === 'pending' ? (
              <button 
                onClick={() => handleTakeMed(med)}
                disabled={!isViewingToday}
                className={`px-5 py-2 text-[13px] font-bold rounded-xl shadow-sm transition w-full sm:w-auto ${
                  isViewingToday ? 'bg-[#BC6C25] text-white hover:opacity-90' : 'bg-[#E5E1D8] text-[#606C38] opacity-70 cursor-not-allowed'
                }`}
              >
                Mark Taken
              </button>
            ) : (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5 text-sm font-bold text-[#606C38]">
                  <CheckCircle2 className="w-4 h-4" />
                  COMPLETED
                </div>
                <button 
                   onClick={() => handleUndoMed(med)}
                   disabled={!isViewingToday}
                   className={`text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                     isViewingToday
                       ? 'text-[#DDA15E] hover:text-[#BC6C25] cursor-pointer bg-[#BC6C25]/10'
                       : 'text-[#606C38] opacity-60 cursor-not-allowed bg-[#E5E1D8]'
                   }`}
                >
                   <RotateCcw className="w-3.5 h-3.5" /> Undo Action
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[#FBFBF8] pb-24 text-[#283618] font-sans">
      <div className="bg-[#F2F0E4] border-b border-[#E5E1D8] rounded-b-[40px] p-6 pt-12 pb-12 shadow-sm">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-[#606C38] text-sm mb-1 opacity-70 font-bold">{format(new Date(), 'EEEE, MMMM d')}</p>
            <h1 className="text-2xl font-bold tracking-tight">Hi, {user?.name?.split(' ')[0] || 'Patient'}</h1>
          </div>
          <button 
            onClick={() => navigate('/settings')}
            className="w-10 h-10 bg-white border border-[#E5E1D8] rounded-full flex items-center justify-center hover:bg-[#E5E1D8] shadow-sm transition"
          >
            <SettingsIcon className="w-5 h-5 text-[#606C38]" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#DDA15E] rounded-full flex items-center justify-center shadow-sm">
            <span className="text-xl font-bold text-white">{pendingCount}</span>
          </div>
          <div>
            <p className="font-bold text-lg">Meds Left Today</p>
            <p className="text-sm text-[#606C38] opacity-70">Keep up the good work!</p>
          </div>
        </div>
      </div>

      <div className="p-6 -mt-6">
        <div className="flex items-end justify-between mb-3 ml-2 mr-2">
          <h2 className="text-base font-bold">Today&apos;s Schedule</h2>
          <p className="text-[12px] font-bold text-[#606C38] opacity-70">
            {isViewingToday ? 'Today' : format(viewingDate, 'EEE, MMM d')}
          </p>
	        </div>
	        
	        <div className="space-y-3">
          {/* Day selector */}
          <div className="bg-white rounded-[24px] px-3 py-2.5 border border-[#E5E1D8] shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDayOffset((prev) => Math.max(-3, prev - 1))}
                disabled={dayOffset <= -3}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition ${
                  dayOffset <= -3
                    ? 'bg-[#E5E1D8] text-[#606C38] opacity-50 cursor-not-allowed'
                    : 'bg-[#F2F0E4] text-[#606C38] border-[#E5E1D8] hover:bg-[#E5E1D8]'
                }`}
                aria-label="Previous day"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                <p className="text-sm font-bold text-[#283618] truncate leading-tight">
                  {isViewingToday ? 'Today' : format(viewingDate, 'EEEE')}
                </p>
                <p className="text-[11px] font-bold text-[#606C38] opacity-70 truncate">
                  {format(viewingDate, 'MMM d')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setDayOffset((prev) => Math.min(3, prev + 1))}
                disabled={dayOffset >= 3}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition ${
                  dayOffset >= 3
                    ? 'bg-[#E5E1D8] text-[#606C38] opacity-50 cursor-not-allowed'
                    : 'bg-[#F2F0E4] text-[#606C38] border-[#E5E1D8] hover:bg-[#E5E1D8]'
                }`}
                aria-label="Next day"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setDayOffset(0)}
                disabled={dayOffset === 0}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-xl border transition shrink-0 ${
                  dayOffset === 0
                    ? 'bg-[#E5E1D8] text-[#606C38] opacity-60 cursor-not-allowed'
                    : 'bg-white text-[#606C38] border-[#E5E1D8] hover:bg-[#F2F0E4]'
                }`}
              >
                Today
              </button>
            </div>

            {!isViewingToday && (
              <p className="text-[10px] font-bold text-[#606C38] opacity-60 mt-2">
                You can only mark medicines as taken for today.
              </p>
            )}
          </div>

	          {/* Filters */}
	          <div className="bg-white rounded-[24px] p-3 border border-[#E5E1D8] shadow-sm">
	            <p className="text-[10px] font-bold text-[#606C38] mb-1.5 uppercase tracking-wider">View</p>
	            <div className="flex bg-[#F2F0E4] border border-[#E5E1D8] p-1 rounded-2xl">
	                <button
	                  onClick={() => setStatusTab('overdue')}
	                  className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${statusTab === 'overdue' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
	                >
                  Overdue ({filteredByStatus.overdue.length})
                </button>
                <button
                  onClick={() => setStatusTab('upcoming')}
                  className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${statusTab === 'upcoming' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
                >
                  Upcoming ({filteredByStatus.upcoming.length})
                </button>
                <button
                  onClick={() => setStatusTab('completed')}
                  className={`flex-1 py-2 text-[10px] font-bold rounded-xl uppercase tracking-widest transition ${statusTab === 'completed' ? 'bg-white shadow-sm text-[#283618] border border-[#E5E1D8]' : 'text-[#606C38] opacity-70'}`}
                >
	                  Completed ({filteredByStatus.completed.length})
	                </button>
	              </div>
	          </div>

	          <div className="space-y-3">
	            <AnimatePresence>
	              {timelineSections.length === 0 ? (
	                <motion.div
	                  key={`${statusTab}-empty`}
	                  initial={{ opacity: 0, y: 10 }}
	                  animate={{ opacity: 1, y: 0 }}
	                  className="text-center py-8 px-6 bg-white rounded-[32px] border border-[#E5E1D8] shadow-sm"
	                >
	                  <p className="font-bold text-[#283618]">
	                    {viewingSchedule.length === 0
	                      ? 'No medicines scheduled'
	                      : statusTab === 'overdue'
	                        ? 'No overdue medicines'
	                        : statusTab === 'upcoming'
	                          ? 'No upcoming medicines'
	                          : 'No completed medicines'}
	                  </p>
	                  <p className="text-sm opacity-70 mt-1 text-[#606C38]">
	                    {viewingSchedule.length === 0
	                      ? 'Ask your caregiver if something looks missing.'
	                      : statusTab === 'overdue'
	                        ? "You're all caught up."
	                      : 'Check another tab to see this day’s schedule.'}
	                  </p>
	                </motion.div>
	              ) : (
	                timelineSections.map((section) =>
                    section.type === 'divider' ? (
                      <motion.div
                        key={`${statusTab}-${section.key}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="px-1 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-[#D8D1C3]" />
                          <div className="rounded-full bg-[#283618] px-4 py-1.5 text-[11px] font-bold tracking-[0.28em] text-white">
                            {section.label}
                          </div>
                          <div className="h-px flex-1 bg-[#D8D1C3]" />
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`${statusTab}-${section.key}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-[26px] border border-[#E5E1D8] shadow-sm overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-[#EEE6D7] bg-[#F9F6EE] flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#606C38] opacity-70">Meal block</p>
                            <h3 className="text-sm font-bold text-[#283618] mt-1">{section.label}</h3>
                          </div>
                          <div className="rounded-full bg-white border border-[#E5E1D8] px-2.5 py-1 text-[11px] font-bold text-[#606C38]">
                            {section.items.length}
                          </div>
                        </div>
                        <div className="p-3 space-y-3">
                          {section.items.map((med) => renderMedCard(med, statusTab))}
                        </div>
                      </motion.div>
                    )
                  )
	              )}
	            </AnimatePresence>
	          </div>
	        </div>
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
