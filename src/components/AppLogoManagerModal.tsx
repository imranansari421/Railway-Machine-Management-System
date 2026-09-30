import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, X, Image as ImageIcon, CheckCircle, RotateCcw, 
  ShieldAlert, Sparkles, Eye, Lock, RefreshCw, AlertCircle, FileCheck
} from 'lucide-react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { compressImage } from '../utils/imageCompressor';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { RMMSLogo } from './RMMSLogo';

interface AppLogoManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppLogoManagerModal: React.FC<AppLogoManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [currentAppLogo, setCurrentAppLogo] = useState<string>(() => localStorage.getItem('appLogo') || '');
  const [previewLogo, setPreviewLogo] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'preview'>('upload');
  const [appTitle, setAppTitle] = useState<string>(() => localStorage.getItem('appTitle') || 'Railway Machine Management System');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Authentication & Main Admin Security Check
  const currentUser = auth.currentUser;
  const isEmployee = currentUser?.email?.endsWith('@employee.billedapp.com');
  const accessType = currentUser ? localStorage.getItem(`accessType_${currentUser.uid}`) || 'limited' : 'limited';
  
  // Strictly Main Admin ONLY (Exclude Company Admin, Zonal Admin, Divisional Admin, and standard operators)
  const isMainAdmin = (!isEmployee || currentUser?.email === 'imranansari399605@gmail.com') && 
                      accessType !== 'admin-light' && 
                      accessType !== 'zonal-admin' && 
                      accessType !== 'divisional-admin';

  // Listen to live database settings (dedicated branding document with general fallback)
  useEffect(() => {
    if (!isOpen) return;

    // 1. Listen to dedicated branding doc
    const unsubBranding = onSnapshot(doc(db, 'settings', 'app_branding'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.appLogo !== undefined) {
          setCurrentAppLogo(data.appLogo || '');
          if (data.appLogo) {
            localStorage.setItem('appLogo', data.appLogo);
          } else {
            localStorage.removeItem('appLogo');
          }
        }
      }
    });

    // 2. Also listen to general settings for title
    const unsubGeneral = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.appLogo !== undefined && !localStorage.getItem('appLogo')) {
          setCurrentAppLogo(data.appLogo || '');
        }
        if (data.appTitle) {
          setAppTitle(data.appTitle);
        }
      }
    });

    return () => {
      unsubBranding();
      unsubGeneral();
    };
  }, [isOpen]);

  const processFile = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file (PNG, JPG, SVG, WebP)');
      return;
    }

    // Size limit check (max 5MB raw)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image file too large! Please choose an image under 5MB.');
      return;
    }

    try {
      setIsUploading(true);
      // High-quality compact compression (~20KB-60KB) to ensure rapid loading
      const compressed = await compressImage(file, 260, 260, 0.8);
      if (compressed) {
        setPreviewLogo(compressed);
        toast.info('Logo preview ready. Click "Save & Sync Logo" to apply.');
      }
    } catch (err: any) {
      console.error('Error processing logo image:', err);
      toast.error('Failed to process image: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleSaveLogo = async () => {
    if (!isMainAdmin) {
      toast.error('Unauthorized! Logo management is restricted strictly to the Main ADMIN account.');
      return;
    }

    const logoToSave = previewLogo !== null ? previewLogo : currentAppLogo;
    if (!logoToSave) {
      toast.error('Please upload an image first.');
      return;
    }

    try {
      setIsUploading(true);

      // Save to dedicated 'settings/app_branding' document to avoid any 1MB document limit issues
      await setDoc(doc(db, 'settings', 'app_branding'), {
        appLogo: logoToSave,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'Main Admin'
      }, { merge: true });

      localStorage.setItem('appLogo', logoToSave);
      localStorage.setItem('demandLogo', logoToSave);
      setCurrentAppLogo(logoToSave);
      setPreviewLogo(null);

      // Broadcast event for instant sync in all open windows/components
      window.dispatchEvent(new CustomEvent('app-logo-updated', { detail: logoToSave }));

      toast.success('App Logo updated & synced successfully across all devices and users!');
      onClose();
    } catch (err: any) {
      console.error('Error saving app logo:', err);
      toast.error('Failed to save logo to database: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!isMainAdmin) {
      toast.error('Unauthorized! Logo reset is restricted strictly to the Main ADMIN account.');
      return;
    }

    if (!confirm('Are you sure you want to reset to the default official RMMS Vector Logo?')) {
      return;
    }

    try {
      setIsUploading(true);
      await setDoc(doc(db, 'settings', 'app_branding'), {
        appLogo: '',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'Main Admin'
      }, { merge: true });

      localStorage.removeItem('appLogo');
      setCurrentAppLogo('');
      setPreviewLogo(null);

      // Broadcast event for all components
      window.dispatchEvent(new CustomEvent('app-logo-updated', { detail: '' }));

      toast.success('Reset to default RMMS Vector Logo completed!');
      onClose();
    } catch (err: any) {
      console.error('Error resetting logo:', err);
      toast.error('Failed to reset logo: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#0a2558] via-[#0d2e6b] to-[#1e4e96] px-6 py-4.5 text-white flex items-center justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 w-48 h-full bg-white/5 skew-x-12 pointer-events-none" />
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-xs">
                <ImageIcon className="text-amber-400" size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black tracking-tight text-white">
                    App Logo & Branding Manager
                  </h2>
                  <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-400 text-slate-950">
                    Main Admin Only
                  </span>
                </div>
                <p className="text-xs text-blue-100/90 font-medium">
                  कस्टम लोगो अपलोड करें या डिफ़ॉल्ट RMMS लोगो सेट करें
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors relative z-10"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
            {/* Non-Admin Security Warning */}
            {!isMainAdmin && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
                <ShieldAlert className="text-rose-600 shrink-0 mt-0.5" size={20} />
                <div className="text-xs text-rose-900">
                  <span className="font-bold block text-sm mb-0.5">Permission Denied</span>
                  Logo customization is strictly restricted to the <strong>Main Super Admin</strong> account. Company Admins, Zonal Admins, and Divisional Admins do not have access to change application-wide branding.
                </div>
              </div>
            )}

            {isMainAdmin && (
              <>
                {/* Current Status Pill */}
                <div className="flex items-center justify-between bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center p-1 overflow-hidden">
                      {previewLogo ? (
                        <img src={previewLogo} alt="New Preview" className="w-full h-full object-contain" />
                      ) : currentAppLogo ? (
                        <img src={currentAppLogo} alt="Current Logo" className="w-full h-full object-contain" />
                      ) : (
                        <RMMSLogo variant="icon" className="w-full h-full" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Current System Logo
                      </div>
                      <div className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        {previewLogo ? (
                          <span className="text-amber-600 flex items-center gap-1">
                            <Sparkles size={14} /> New Logo Ready to Save
                          </span>
                        ) : currentAppLogo ? (
                          <span className="text-emerald-700 flex items-center gap-1">
                            <CheckCircle size={14} /> Custom Organization Logo Active
                          </span>
                        ) : (
                          <span className="text-blue-900 flex items-center gap-1">
                            <FileCheck size={14} /> Official RMMS Vector Logo (Default)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {currentAppLogo && (
                    <button
                      type="button"
                      onClick={handleResetToDefault}
                      disabled={isUploading}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors flex items-center gap-1.5"
                      title="Reset to default RMMS vector logo"
                    >
                      <RotateCcw size={13} />
                      <span>Reset to Default</span>
                    </button>
                  )}
                </div>

                {/* Drag and Drop Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-indigo-600 bg-indigo-50/80 scale-[0.99]'
                      : 'border-slate-300 hover:border-indigo-500 bg-white hover:bg-slate-50/80'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center mb-3 shadow-xs">
                    <Upload size={26} />
                  </div>
                  <div className="text-sm font-black text-slate-900 mb-1">
                    Click to browse or drag & drop new logo
                  </div>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Supported: <strong>PNG, JPG, SVG, WebP</strong>. Transparent PNG works best for dark & light backgrounds.
                  </p>
                </div>

                {/* Live Previews Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Eye size={14} className="text-indigo-600" />
                      Live Previews (लाइव पूर्वावलोकन)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Shows how the logo looks across the system
                    </span>
                  </div>

                  {/* 1. Header Navigation Bar Preview */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      1. Top Navigation Bar Preview
                    </div>
                    <div className="bg-white border border-slate-200/80 rounded-lg p-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center p-1">
                          {previewLogo ? (
                            <img src={previewLogo} alt="Logo" className="w-full h-full object-contain" />
                          ) : currentAppLogo ? (
                            <img src={currentAppLogo} alt="Logo" className="w-full h-full object-contain" />
                          ) : (
                            <RMMSLogo variant="icon" className="w-full h-full" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs sm:text-sm font-black tracking-tight text-slate-900 leading-tight">
                            {appTitle}
                          </span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                            RMMS Portal
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                        Live Header Look
                      </div>
                    </div>
                  </div>

                  {/* 2. Login Screen Preview */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      2. Login & Gateway Card Preview
                    </div>
                    <div className="bg-slate-100/70 border border-slate-200/80 rounded-lg p-4 flex flex-col items-center justify-center text-center">
                      <div className="w-24 h-24 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center p-2 mb-2">
                        {previewLogo ? (
                          <img src={previewLogo} alt="Logo" className="w-full h-full object-contain" />
                        ) : currentAppLogo ? (
                          <img src={currentAppLogo} alt="Logo" className="w-full h-full object-contain" />
                        ) : (
                          <RMMSLogo variant="icon" className="w-full h-full" />
                        )}
                      </div>
                      <span className="text-xs font-black text-[#0a2558]">
                        RAILWAY MACHINE MANAGEMENT SYSTEM
                      </span>
                      <span className="text-[10px] font-bold text-amber-600 tracking-widest uppercase mt-0.5">
                        Official Railway Portal
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>

            {isMainAdmin && (
              <div className="flex items-center gap-2.5">
                {previewLogo && (
                  <button
                    type="button"
                    onClick={() => setPreviewLogo(null)}
                    disabled={isUploading}
                    className="px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    Discard Preview
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveLogo}
                  disabled={isUploading || (!previewLogo && !currentAppLogo)}
                  className="px-5 py-2 text-xs sm:text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Saving & Syncing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Save & Sync Logo</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
export default AppLogoManagerModal;
