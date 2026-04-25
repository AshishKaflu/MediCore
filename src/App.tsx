import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/authStore';

import Landing from './pages/Landing';
import Auth from './pages/Auth';
import CaregiverDashboard from './pages/CaregiverDashboard';
import PatientDashboard from './pages/PatientDashboard';
import PatientDetails from './pages/PatientDetails';
import Settings from './pages/Settings';
import MedicationForm from './pages/MedicationForm';
import { NetworkStatus } from './components/NetworkStatus';

function ProtectedRoute({ children, role }: { children: React.ReactNode, role?: 'caregiver' | 'patient' }) {
  const currentRole = useAuthStore(state => state.role);
  if (!currentRole) return <Navigate to="/auth" />;
  if (role && currentRole !== role) return <Navigate to="/" />;
  return <>{children}</>;
}

export default function App() {
  const role = useAuthStore(state => state.role);

  return (
    <BrowserRouter>
      <Toaster position="top-center" richColors />
      <NetworkStatus />
      <Routes>
        <Route path="/" element={
          !role ? <Landing /> : <Navigate to={role === 'caregiver' ? '/caregiver' : '/patient'} />
        } />
        <Route path="/auth" element={<Auth />} />
        
        <Route path="/caregiver" element={
          <ProtectedRoute role="caregiver"><CaregiverDashboard /></ProtectedRoute>
        } />
        <Route path="/caregiver/patient/:id" element={
          <ProtectedRoute role="caregiver"><PatientDetails /></ProtectedRoute>
        } />
        <Route path="/caregiver/patient/:id/medication/new" element={
          <ProtectedRoute role="caregiver"><MedicationForm /></ProtectedRoute>
        } />
        <Route path="/caregiver/patient/:id/medication/:medId" element={
          <ProtectedRoute role="caregiver"><MedicationForm /></ProtectedRoute>
        } />
        <Route path="/patient" element={
          <ProtectedRoute role="patient"><PatientDashboard /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute><Settings /></ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
