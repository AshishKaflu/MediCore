import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, ArrowRight, ShieldAlert, Mail, Lock, User as UserIcon, ChevronLeft } from 'lucide-react';
import { useAuthStore, Role } from '../store/authStore';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { refreshCaregiverData, refreshPatientData } from '../lib/sync';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') as Role || 'patient';
  const navigate = useNavigate();
  const login = useAuthStore(state => state.login);
  
  // Caregiver state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  
  // Patient state
  const [pin, setPin] = useState('');
  const [duplicatePatients, setDuplicatePatients] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);

  // If Supabase keys are missing, we throw an alert warning when they try to Auth.
  const hasSupabaseKeys = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  const handleCaregiverAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSupabaseKeys) {
      toast.error('Supabase keys missing. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in settings.');
      return;
    }

    setIsLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.rpc('register_caregiver', {
          p_email: email,
          p_password: password,
          p_name: name
        });
        
        if (error) throw error;
        toast.success('Signup successful! Welcome to MedManage.');
        
        // Data returns the new UUID
        login({ id: data, name: name || email }, 'caregiver');
        await refreshCaregiverData(data);
        navigate('/caregiver');
      } else {
        const { data, error } = await supabase.rpc('login_caregiver', {
          p_email: email,
          p_password: password
        });
        
        if (error) throw error;
        if (!data) throw new Error('Invalid email or password');
        
        toast.success('Welcome back!');
        // Data returns the JSON auth block
        login({ id: data.id, name: data.name || data.email }, 'caregiver');
        await refreshCaregiverData(data.id);
        navigate('/caregiver');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePatientPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) {
      toast.error('PIN must be at least 4 digits');
      return;
    }

    setIsLoading(true);
    try {
      let patientsFound: any[] = [];

      // Query local Dexie test DB since all patient creation/saving occurs locally
      const localPatients = await db.patients.toArray();
      patientsFound = localPatients.filter(p => p.pin === pin);

      // If not found locally, try Supabase (new device / cleared storage)
      if ((!patientsFound || patientsFound.length === 0) && hasSupabaseKeys) {
        const { data, error } = await supabase.from('patients').select('*').eq('pin', pin);
        if (error) throw error;
        patientsFound = data || [];
      }

      if (!patientsFound || patientsFound.length === 0) {
        toast.error(hasSupabaseKeys ? 'No patient found with this PIN.' : 'No patient found locally with this PIN.');
        return;
      }

      if (patientsFound.length === 1) {
        // Exact match
        finishPatientLogin(patientsFound[0]);
      } else {
        // Multiple matches, determine which one
        setDuplicatePatients(patientsFound);
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const finishPatientLogin = async (patientData: any) => {
    try {
      setIsLoading(true);
      // Hydrate local cache from cloud so patient sees data on any device.
      if (hasSupabaseKeys && patientData?.id) {
        await refreshPatientData(patientData.id);
      }
      toast.success(`Welcome, ${patientData.first_name || 'Patient'}!`);
      login({ id: patientData.id, name: `${patientData.first_name} ${patientData.last_name}`, ...patientData }, 'patient');
      navigate('/patient');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load patient data');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#FBFBF8] text-[#283618] font-sans relative">
      <button 
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 md:top-8 md:left-8 w-12 h-12 border border-[#E5E1D8] bg-white rounded-full flex items-center justify-center hover:bg-[#F2F0E4] transition text-[#606C38] shadow-sm z-10 group"
        title="Back to login selection"
      >
        <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
      </button>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-white rounded-[32px] p-8 shadow-sm border border-[#E5E1D8]"
      >
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#606C38] mb-4 text-white shadow-sm ring-4 ring-[#606C38]/10">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#283618]">
            {role === 'caregiver' ? 'Caregiver Portal' : 'Patient Portal'}
          </h2>
          <p className="text-[#606C38] opacity-70 text-sm mt-1 font-semibold">Secure Authentication</p>
        </div>

        {role === 'caregiver' ? (
          <form onSubmit={handleCaregiverAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-[#606C38] mb-2 uppercase tracking-wider">Full Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserIcon className="h-5 w-5 text-[#606C38] opacity-50" />
                  </div>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-10 p-4 bg-[#F2F0E4] border border-[#E5E1D8] rounded-2xl focus:outline-none focus:border-[#606C38] transition-all font-bold text-[#283618]"
                    placeholder="Jane Doe"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-2 uppercase tracking-wider">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-[#606C38] opacity-50" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 p-4 bg-[#F2F0E4] border border-[#E5E1D8] rounded-2xl focus:outline-none focus:border-[#606C38] transition-all font-bold text-[#283618]"
                  placeholder="caregiver@email.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#606C38] mb-2 uppercase tracking-wider">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-[#606C38] opacity-50" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 p-4 bg-[#F2F0E4] border border-[#E5E1D8] rounded-2xl focus:outline-none focus:border-[#606C38] transition-all font-bold text-[#283618]"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-4 mt-2 bg-[#606C38] text-white rounded-xl font-bold hover:opacity-90 shadow-sm transition transform active:scale-95 disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Log In')} <ArrowRight className="w-5 h-5" />
            </button>
            <div className="text-center mt-4">
               <button 
                 type="button" 
                 onClick={() => setIsSignUp(!isSignUp)}
                 className="text-xs font-bold text-[#DDA15E] hover:text-[#BC6C25] transition"
               >
                 {isSignUp ? 'Already have an account? Log In' : 'Need an account? Sign Up'}
               </button>
            </div>
          </form>
        ) : (
          duplicatePatients.length > 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="bg-[#BC6C25]/10 border border-[#BC6C25]/20 p-4 rounded-2xl mb-4">
                <p className="text-sm font-bold text-[#BC6C25] text-center">Multiple accounts found with this PIN.</p>
                <p className="text-xs text-[#BC6C25] opacity-80 text-center mt-1">Please select determining which patient you are.</p>
              </div>
              <div className="space-y-3">
                {duplicatePatients.map((pt) => (
                  <button
                    key={pt.id}
                    onClick={() => finishPatientLogin(pt)}
                    className="w-full bg-white p-4 rounded-2xl shadow-sm border border-[#E5E1D8] flex items-center justify-between hover:border-[#606C38] transition text-left"
                  >
                    <div>
                      <p className="font-bold text-[#283618]">{pt.first_name} {pt.last_name}</p>
                      <p className="text-xs font-semibold text-[#606C38] opacity-70">Caregiver ID: {pt.caregiver_id.substring(0, 8)}...</p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-[#DDA15E]" />
                  </button>
                ))}
              </div>
              <button 
                onClick={() => {setDuplicatePatients([]); setPin('');}}
                className="w-full py-3 text-xs font-bold text-[#606C38] mt-4 hover:bg-[#F2F0E4] rounded-xl transition"
              >
                Back to PIN entry
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handlePatientPinSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-[#606C38] mb-2 uppercase tracking-wider text-center">Enter Your PIN</label>
                <input
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full text-center text-3xl tracking-[1em] p-4 bg-[#F2F0E4] border border-[#E5E1D8] rounded-2xl focus:outline-none focus:border-[#606C38] transition-all font-mono text-[#283618]"
                  placeholder="••••"
                  autoComplete="off"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 py-4 bg-[#606C38] text-white rounded-xl font-bold hover:opacity-90 shadow-sm transition transform active:scale-95 disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Continue'} <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          )
        )}
      </motion.div>
    </div>
  );
}
