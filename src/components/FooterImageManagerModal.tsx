import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, X, Image as ImageIcon, CheckCircle, RotateCcw, 
  ShieldAlert, Sparkles, Eye, RefreshCw, FileCheck, ExternalLink
} from 'lucide-react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { compressImage } from '../utils/imageCompressor';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { DeveloperBadge } from './DeveloperBadge';

interface FooterImageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FooterImageManagerModal: React.FC<FooterImageManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [currentFooterImage, setCurrentFooterImage] = useState<string>(() => localStorage.getItem('footerImage') || '');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [webLink, setWebLink] = useState<string>(() => localStorage.getItem('webLink') || 'https://railway-machine-management-system.vercel.app');
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

  // Listen to live database settings
  useEffect(() => {
    if (!isOpen) return;

    const unsubBranding = onSnapshot(doc(db, 'settings', 'app_branding'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.footerImage !== undefined) {
          setCurrentFooterImage(data.footerImage || '');
          if (data.footerImage) {
            localStorage.setItem('footerImage', data.footerImage);
          } else {
            localStorage.removeItem('footerImage');
          }
        }
      }
    });

    const unsubGeneral = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.footerImage !== undefined && !localStorage.getItem('footerImage')) {
          setCurrentFooterImage(data.footerImage || '');
        }
        if (data.webLink) {
          setWebLink(data.webLink);
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

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image file too large! Please choose an image under 5MB.');
      return;
    }

    try {
      setIsUploading(true);
      // High quality compression with suitable dimension ratio for badges
      const compressed = await compressImage(file, 800, 300, 0.85);
      if (compressed) {
        setPreviewImage(compressed);
        toast.info('Footer image preview ready. Click "Save & Sync Footer Image" to apply.');
      }
    } catch (err: any) {
      console.error('Error processing footer image:', err);
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

  const handleSaveFooterImage = async () => {
    if (!isMainAdmin) {
      toast.error('Unauthorized! Footer image management is restricted strictly to the Main ADMIN account.');
      return;
    }

    const imageToSave = previewImage !== null ? previewImage : currentFooterImage;
    if (!imageToSave) {
      toast.error('Please upload an image first.');
      return;
    }

    try {
      setIsUploading(true);

      // Save to 'settings/app_branding' document
      await setDoc(doc(db, 'settings', 'app_branding'), {
        footerImage: imageToSave,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'Main Admin'
      }, { merge: true });

      localStorage.setItem('footerImage', imageToSave);
      setCurrentFooterImage(imageToSave);
      setPreviewImage(null);

      // Broadcast event for instant sync in all open windows/components
      window.dispatchEvent(new CustomEvent('footer-image-updated', { detail: imageToSave }));

      toast.success('Footer Image updated & synced successfully across all devices and users!');
      onClose();
    } catch (err: any) {
      console.error('Error saving footer image:', err);
      toast.error('Failed to save footer image to database: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!isMainAdmin) {
      toast.error('Unauthorized! Reset is restricted strictly to the Main ADMIN account.');
      return;
    }

    if (!confirm('Are you sure you want to reset to the default engineered vector footer badge?')) {
      return;
    }

    try {
      setIsUploading(true);
      await setDoc(doc(db, 'settings', 'app_branding'), {
        footerImage: '',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'Main Admin'
      }, { merge: true });

      localStorage.removeItem('footerImage');
      setCurrentFooterImage('');
      setPreviewImage(null);

      // Broadcast event for all components
      window.dispatchEvent(new CustomEvent('footer-image-updated', { detail: '' }));

      toast.success('Reset to default Vector Footer Badge completed!');
      onClose();
    } catch (err: any) {
      console.error('Error resetting footer image:', err);
      toast.error('Failed to reset footer image: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  const activeDisplayImg = previewImage !== null ? previewImage : currentFooterImage;

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
          <div className="bg-gradient-to-r from-[#020b1a] via-[#051735] to-[#0a2558] px-6 py-4.5 text-white flex items-center justify-between relative overflow-hidden border-b border-cyan-500/20">
            <div className="absolute right-0 top-0 w-48 h-full bg-cyan-400/5 skew-x-12 pointer-events-none" />
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center backdrop-blur-xs">
                <ImageIcon className="text-cyan-400" size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black tracking-tight text-white">
                    Footer Image & Badge Manager
                  </h2>
                  <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-cyan-400 text-slate-950">
                    Main Admin Only
                  </span>
                </div>
                <p className="text-xs text-cyan-100/80 font-medium">
                  फ़ूटर (Footer) की कस्टम इमेज/बैज अपलोड और प्रबंधित करें
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
                  Footer image customization is strictly restricted to the <strong>Main Super Admin</strong> account. Company Admins, Zonal Admins, and Divisional Admins do not have access to change application-wide branding.
                </div>
              </div>
            )}

            {isMainAdmin && (
              <>
                {/* Current Status Pill */}
                <div className="flex items-center justify-between bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden">
                      {activeDisplayImg ? (
                        <img src={activeDisplayImg} alt="Footer Badge Preview" className="h-8 max-w-[160px] object-contain" />
                      ) : (
                        <DeveloperBadge height={28} />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Current Footer Badge
                      </div>
                      <div className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        {previewImage ? (
                          <span className="text-amber-600 flex items-center gap-1">
                            <Sparkles size={14} /> New Footer Image Ready to Save
                          </span>
                        ) : currentFooterImage ? (
                          <span className="text-emerald-700 flex items-center gap-1">
                            <CheckCircle size={14} /> Custom Uploaded Footer Image Active
                          </span>
                        ) : (
                          <span className="text-cyan-700 flex items-center gap-1">
                            <FileCheck size={14} /> Default Engineered Vector Badge (Default)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {currentFooterImage && (
                    <button
                      type="button"
                      onClick={handleResetToDefault}
                      disabled={isUploading}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors flex items-center gap-1.5"
                      title="Reset to default vector badge"
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
                      ? 'border-cyan-600 bg-cyan-50/80 scale-[0.99]'
                      : 'border-slate-300 hover:border-cyan-500 bg-white hover:bg-slate-50/80'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-50 text-cyan-600 border border-cyan-100 flex items-center justify-center mb-3 shadow-xs">
                    <Upload size={26} />
                  </div>
                  <div className="text-sm font-black text-slate-900 mb-1">
                    Click to browse or drag & drop new footer image
                  </div>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Supported: <strong>PNG, JPG, SVG, WebP</strong>. Recommended: High-contrast rectangular badge / banner with transparent or dark background.
                  </p>
                </div>

                {/* Live Previews Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Eye size={14} className="text-cyan-600" />
                      Live Footer Previews (लाइव फ़ूटर पूर्वावलोकन)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Shows how the footer appears in App, Login & Forgot Password
                    </span>
                  </div>

                  {/* 1. In-App Main Layout Footer Preview */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      1. Main App Dashboard Footer Preview
                    </div>
                    <div className="border border-slate-200/80 bg-slate-50/80 rounded-lg p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                      <p className="font-semibold text-slate-400">System version 1.6.0 | © {new Date().getFullYear()} Railway Machinery.</p>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-bold">System Engineered:</span>
                        {activeDisplayImg ? (
                          <img 
                            src={activeDisplayImg} 
                            alt="Footer Badge" 
                            style={{ height: 32 }} 
                            className="max-w-[200px] object-contain drop-shadow-[0_2px_10px_rgba(0,180,255,0.35)]" 
                          />
                        ) : (
                          <DeveloperBadge height={32} href={webLink} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 2. Login Screen Footer Preview */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      2. Login Screen Footer Preview
                    </div>
                    <div className="border border-slate-200/80 bg-slate-900 text-slate-300 rounded-lg p-3 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs">
                      <span>System version 1.6.0 | © {new Date().getFullYear()} Industrial Systems Group</span>
                      <span className="hidden sm:inline text-slate-600">|</span>
                      <span className="flex items-center gap-2 text-xs text-slate-400 font-bold">
                        System Engineered:
                        {activeDisplayImg ? (
                          <img 
                            src={activeDisplayImg} 
                            alt="Footer Badge" 
                            style={{ height: 32 }} 
                            className="max-w-[200px] object-contain drop-shadow-[0_2px_12px_rgba(0,220,255,0.5)]" 
                          />
                        ) : (
                          <DeveloperBadge height={32} href={webLink} />
                        )}
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
                {previewImage && (
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    disabled={isUploading}
                    className="px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    Discard Preview
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveFooterImage}
                  disabled={isUploading || (!previewImage && !currentFooterImage)}
                  className="px-5 py-2 text-xs sm:text-sm font-black text-white bg-cyan-600 hover:bg-cyan-700 active:scale-95 rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Saving & Syncing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Save & Sync Footer Image</span>
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
export default FooterImageManagerModal;
