import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "welcome": "Welcome to MedManage",
      "caregiver": "Caregiver",
      "patient": "Patient",
      "login": "Secure Login",
      "dashboard": "Dashboard",
      "patients": "Patients",
      "add_patient": "Add Patient",
      "medications": "Medications",
      "inventory": "Inventory",
      "settings": "Settings",
      "offline_mode": "Offline Mode",
      "log_out": "Log Out"
    }
  },
  es: {
    translation: {
      "welcome": "Bienvenido a MedManage",
      "caregiver": "Cuidador",
      "patient": "Paciente",
      "login": "Inicio de Sesión Seguro",
      "dashboard": "Panel",
      "patients": "Pacientes",
      "add_patient": "Añadir Paciente",
      "medications": "Medicamentos",
      "inventory": "Inventario",
      "settings": "Ajustes",
      "offline_mode": "Modo sin conexión",
      "log_out": "Cerrar sesión"
    }
  },
  ne: {
    translation: {
      "welcome": "MedManage मा स्वागत छ",
      "caregiver": "स्याहारकर्ता",
      "patient": "बिरामी",
      "login": "सुरक्षित लगइन",
      "dashboard": "ड्यासबोर्ड",
      "patients": "बिरामीहरू",
      "add_patient": "बिरामी थप्नुहोस्",
      "medications": "औषधिहरू",
      "inventory": "स्टक",
      "settings": "सेटिङहरू",
      "offline_mode": "अफलाइन मोड",
      "log_out": "लग आउट गर्नुहोस्"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
