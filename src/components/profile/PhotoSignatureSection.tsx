import React from 'react';
import { Camera, Edit3, Upload, UserCircle, X, ShieldAlert, CheckCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile } from '../../utils/employee';

interface PhotoSignatureSectionProps {
  profile: EmployeeProfile;
  setProfile: React.Dispatch<React.SetStateAction<EmployeeProfile>>;
  isEditing: boolean;
  handlePhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSignatureUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sigDimensions: { width: number; height: number } | null;
  setSigDimensions: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
  shouldShowField: (fieldName: string) => boolean;
}

export function PhotoSignatureSection({
  profile,
  setProfile,
  isEditing,
  handlePhotoUpload,
  handleSignatureUpload,
  sigDimensions,
  setSigDimensions,
  shouldShowField,
}: PhotoSignatureSectionProps) {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <Camera size={18} className="text-indigo-600" />
        <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider">
          Photo & Signature <span className="text-slate-400 font-normal lowercase">(पासपोर्ट फोटो एवं अधिकृत डिजिटल हस्ताक्षर)</span>
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ============================================================== */}
        {/* 1. PASSPORT PHOTO CARD */}
        {/* ============================================================== */}
        <div className="border border-slate-200/80 rounded-2xl p-6 bg-white shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-800">
              <Camera size={16} className="text-indigo-600" /> Passport Photo (पासपोर्ट फोटो)
            </label>
            {profile.photoUrl ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <CheckCircle size={10} /> Active
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                Not Uploaded
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="w-28 h-28 rounded-2xl bg-slate-100 border-2 border-slate-200/80 flex items-center justify-center overflow-hidden shadow-inner relative group shrink-0">
              {profile.photoUrl ? (
                <>
                  <img 
                    src={profile.photoUrl} 
                    alt={profile.name} 
                    className="w-full h-full object-cover" 
                  />
                  {isEditing && (
                    <button
                      type="button"
                      onClick={() => setProfile(prev => ({ ...prev, photoUrl: '' }))}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                    >
                      Remove Photo
                    </button>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center text-slate-400">
                  <UserCircle size={48} className="text-slate-300" />
                  <span className="text-[9px] font-black uppercase tracking-wider mt-1 text-slate-400">No Photo</span>
                </div>
              )}
            </div>

            <div className="flex-1 w-full space-y-2">
              {isEditing ? (
                <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-all bg-slate-50/60 hover:bg-slate-50 flex flex-col items-center justify-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <Upload size={18} className="text-indigo-600 mb-1" />
                  <p className="text-xs font-bold text-slate-700">Click or Drag Photo</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">JPG, PNG or WEBP (Passport size)</p>
                </div>
              ) : (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-700">Profile Identity Photo</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Used for Identity Cards, Service Dossiers, and Official Attendance Logs. Click "Edit Profile" above to replace or update.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* 2. AUTHORIZED SIGNATURE CARD */}
        {/* ============================================================== */}
        {shouldShowField('employeeSigUrl') && (
          <div className="border border-slate-200/80 rounded-2xl p-6 bg-white shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-800">
                <Edit3 size={16} className="text-indigo-600" /> Digital Signature (अधिकृत हस्ताक्षर)
              </label>
              {profile.employeeSigUrl ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle size={10} /> Active
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Required
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <div className={cn(
                  "border border-slate-200/80 rounded-xl bg-slate-50/50 flex items-center justify-center p-3 overflow-hidden shadow-inner relative group shrink-0 min-h-[90px] min-w-[150px] max-w-[240px]",
                  profile.employeeSigUrl ? "h-auto" : "h-24 w-full sm:w-44"
                )}>
                  {profile.employeeSigUrl ? (
                    <div className="relative flex items-center justify-center w-full">
                      <img 
                        src={profile.employeeSigUrl} 
                        alt="Signature Preview" 
                        className="max-w-full max-h-24 object-contain"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setSigDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                        }}
                      />
                      {isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setProfile(prev => ({ ...prev, employeeSigUrl: '' }));
                            setSigDimensions(null);
                          }}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider rounded-lg"
                        >
                          Remove Signature
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-slate-400">
                      <Edit3 size={24} className="mx-auto mb-1 text-slate-300" />
                      <span className="text-[10px] font-black uppercase tracking-wider block">No Signature</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 w-full space-y-2">
                  {isEditing ? (
                    <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-all bg-slate-50/60 hover:bg-slate-50 flex flex-col items-center justify-center">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSignatureUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload size={18} className="text-indigo-600 mb-1" />
                      <p className="text-xs font-bold text-slate-700">Click or Drag Signature</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">PNG (recommended transparent) / JPG under 50KB</p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                      <p className="text-xs font-bold text-slate-700">Signature Usage Note</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        Affixed automatically to maintenance sheets, breakdown vouchers, and issue register approvals.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {sigDimensions && profile.employeeSigUrl && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-indigo-700">
                  <span>Image Dimensions:</span>
                  <span className="font-bold bg-indigo-50 px-2 py-0.5 rounded">
                    {sigDimensions.width} × {sigDimensions.height} px (Ratio: {(sigDimensions.width / sigDimensions.height).toFixed(2)})
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
