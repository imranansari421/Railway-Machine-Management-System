import React from 'react';
import { Lock, KeyRound, CheckCircle, ShieldCheck, Loader2 } from 'lucide-react';

interface SecuritySectionProps {
  oldPassword: string;
  setOldPassword: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  confirmNewPassword: string;
  setConfirmNewPassword: (val: string) => void;
  handleUpdatePassword: (e?: React.FormEvent | React.MouseEvent) => void;
  updatingPassword: boolean;
  isEmployee: boolean;
  oldPin: string;
  setOldPin: (val: string) => void;
  newPin: string;
  setNewPin: (val: string) => void;
  confirmNewPin: string;
  setConfirmNewPin: (val: string) => void;
  handleUpdatePin: (e?: React.FormEvent | React.MouseEvent) => void;
  updatingPin: boolean;
}

export function SecuritySection({
  oldPassword,
  setOldPassword,
  newPassword,
  setNewPassword,
  confirmNewPassword,
  setConfirmNewPassword,
  handleUpdatePassword,
  updatingPassword,
  isEmployee,
  oldPin,
  setOldPin,
  newPin,
  setNewPin,
  confirmNewPin,
  setConfirmNewPin,
  handleUpdatePin,
  updatingPin,
}: SecuritySectionProps) {
  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
            <ShieldCheck className="text-indigo-600" size={18} />
            <span>Account Security & Credentials</span>
            <span className="text-slate-400 font-normal lowercase">(सुरक्षा, पासवर्ड एवं पिन)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your account password and security PIN to ensure protected access to your portal.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* ============================================================== */}
        {/* 1. CHANGE ACCOUNT PASSWORD */}
        {/* ============================================================== */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-5 bg-gradient-to-r from-slate-50 to-indigo-50/30 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <KeyRound size={18} />
            </div>
            <div>
              <h4 className="text-sm font-black text-slate-900">Change Account Password (पासवर्ड बदलें)</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Keep your account protected. Enter your current password, then specify a new password.
              </p>
            </div>
          </div>

          <div 
            className="p-6 sm:p-8 space-y-6"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                handleUpdatePassword(e);
              }
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Old Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Lock size={14} className="text-slate-400" /> Current / Old Password *
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono"
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  required
                  id="old-password-input"
                />
              </div>

              {/* New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <KeyRound size={14} className="text-slate-400" /> New Password (Min 6 Chars) *
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  id="new-password-input"
                />
              </div>

              {/* Confirm New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <CheckCircle size={14} className="text-slate-400" /> Confirm New Password *
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  id="confirm-password-input"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={handleUpdatePassword}
                disabled={updatingPassword}
                className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3 px-7 rounded-xl text-xs transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                id="update-password-btn"
              >
                {updatingPassword ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : (
                  <KeyRound size={15} />
                )}
                <span>Update Password (पासवर्ड बदलें)</span>
              </button>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* 2. CHANGE SECURITY PIN (AVAILABLE FOR EMPLOYEES) */}
        {/* ============================================================== */}
        {isEmployee && (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-5 bg-gradient-to-r from-slate-50 to-indigo-50/30 border-b border-slate-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Lock size={18} />
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-900">Change Security PIN (सुरक्षा पिन बदलें)</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update your 6-digit access PIN for fast and secure verification.
                </p>
              </div>
            </div>

            <div 
              className="p-6 sm:p-8 space-y-6"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                  e.preventDefault();
                  handleUpdatePin(e);
                }
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {/* Old PIN */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Lock size={14} className="text-slate-400" /> Current PIN *
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    pattern="\d*"
                    placeholder="••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono tracking-widest"
                    value={oldPin}
                    onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
                    required
                    id="current-pin-input"
                  />
                </div>

                {/* New PIN */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <KeyRound size={14} className="text-slate-400" /> New 6-Digit PIN *
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    pattern="\d*"
                    placeholder="••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono tracking-widest"
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                    required
                    id="new-pin-input"
                  />
                </div>

                {/* Confirm New PIN */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <CheckCircle size={14} className="text-slate-400" /> Confirm New PIN *
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    pattern="\d*"
                    placeholder="••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300 font-mono tracking-widest"
                    value={confirmNewPin}
                    onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
                    required
                    id="confirm-pin-input"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={handleUpdatePin}
                  disabled={updatingPin}
                  className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3 px-7 rounded-xl text-xs transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                  id="update-pin-btn"
                >
                  {updatingPin ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : (
                    <KeyRound size={15} />
                  )}
                  <span>Update Security PIN (पिन बदलें)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
