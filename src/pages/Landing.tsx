import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HeartPulse, ShieldCheck, Globe, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#FBFBF8] text-[#283618] font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[32px] p-8 shadow-sm border border-[#E5E1D8]"
      >
        <div className="w-16 h-16 bg-[#606C38] text-white rounded-xl flex items-center justify-center mx-auto mb-6">
          <HeartPulse className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-bold mb-2 tracking-tight text-[#283618]">{t('welcome')}</h1>
        <p className="text-[#606C38] opacity-70 mb-8 font-medium">
          The HIPAA-compliant platform for caregivers and patients.
        </p>

        <div className="space-y-4">
          <button
            onClick={() => navigate('/auth?role=caregiver')}
            className="w-full py-4 px-6 bg-[#606C38] text-white rounded-xl font-bold hover:opacity-90 transition transform active:scale-95 shadow-sm"
          >
            I am a Caregiver
          </button>
          <button
            onClick={() => navigate('/auth?role=patient')}
            className="w-full py-4 px-6 bg-[#F2F0E4] border border-[#E5E1D8] text-[#606C38] rounded-xl font-bold hover:bg-[#E5E1D8] transition transform active:scale-95 shadow-sm"
          >
            I am a Patient
          </button>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-[#606C38] opacity-60 font-bold tracking-wide align-middle uppercase">
          <div className="flex items-center justify-center gap-1.5"><ShieldCheck className="w-4 h-4"/> HIPAA Secure</div>
          <div className="flex items-center justify-center gap-1.5"><WifiOff className="w-4 h-4"/> Offline Ready</div>
        </div>
      </motion.div>
    </div>
  );
}
