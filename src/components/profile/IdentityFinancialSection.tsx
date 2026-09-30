import React from 'react';
import { Building2, Eye, EyeOff, Award, CreditCard, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile } from '../../utils/employee';

interface IdentityFinancialSectionProps {
  profile: EmployeeProfile;
  setProfile: React.Dispatch<React.SetStateAction<EmployeeProfile>>;
  isEditing: boolean;
  showIdentityDetails: boolean;
  setShowIdentityDetails: React.Dispatch<React.SetStateAction<boolean>>;
  shouldShowField: (fieldName: string) => boolean;
}

export function IdentityFinancialSection({
  profile,
  setProfile,
  isEditing,
  showIdentityDetails,
  setShowIdentityDetails,
  shouldShowField,
}: IdentityFinancialSectionProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-indigo-600" />
          <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider">
            Identity & Financial Details <span className="text-slate-400 font-normal lowercase">(पहचान एवं बैंक विवरण)</span>
          </h3>
        </div>

        <button
          type="button"
          onClick={() => setShowIdentityDetails(!showIdentityDetails)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all self-start sm:self-auto"
          id="profile-toggle-financial-details"
        >
          {showIdentityDetails ? (
            <>
              <EyeOff size={14} className="text-slate-500" />
              <span>Hide Sensitive Data (छुपाएं)</span>
            </>
          ) : (
            <>
              <Eye size={14} className="text-slate-500" />
              <span>Show Sensitive Data (दिखाएं)</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ID No. */}
        {shouldShowField('idNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              ID No. (कर्मचारी आईडी संख्या)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. EMP-101"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.idNo || ''}
              onChange={e => setProfile({ ...profile, idNo: e.target.value })}
            />
          </div>
        )}

        {/* PF Number */}
        {shouldShowField('pfNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Award size={14} className="text-slate-400" /> PF Number (भविष्य निधि संख्या)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. MP/JBP/1234567/890"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.pfNo || ''}
              onChange={e => setProfile({ ...profile, pfNo: e.target.value })}
            />
          </div>
        )}

        {/* ESIC Number */}
        {shouldShowField('esicNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <ShieldCheck size={14} className="text-slate-400" /> ESIC Number (ईएसआईसी संख्या)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. 31000123450001001"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.esicNo || ''}
              onChange={e => setProfile({ ...profile, esicNo: e.target.value })}
            />
          </div>
        )}

        {/* Aadhaar No. */}
        {shouldShowField('aadharNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Aadhaar No. (आधार संख्या - 12 अंक)
            </label>
            <input
              type={showIdentityDetails ? "text" : "password"}
              disabled={!isEditing}
              placeholder="12-digit Aadhaar Number"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.aadharNo || ''}
              onChange={e => setProfile({ ...profile, aadharNo: e.target.value })}
            />
          </div>
        )}

        {/* PAN No. */}
        {shouldShowField('panNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              PAN No. (पैन संख्या)
            </label>
            <input
              type={showIdentityDetails ? "text" : "password"}
              disabled={!isEditing}
              placeholder="10-digit PAN (e.g. ABCDE1234F)"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono uppercase",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.panNo || ''}
              onChange={e => setProfile({ ...profile, panNo: e.target.value.toUpperCase() })}
            />
          </div>
        )}

        {/* Bank Name */}
        {shouldShowField('bankName') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <CreditCard size={14} className="text-slate-400" /> Bank Name (बैंक का नाम)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. State Bank of India"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.bankName || ''}
              onChange={e => setProfile({ ...profile, bankName: e.target.value })}
            />
          </div>
        )}

        {/* Branch */}
        {shouldShowField('branch') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Branch Name (शाखा का नाम)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. Jabalpur Main Branch"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.branch || ''}
              onChange={e => setProfile({ ...profile, branch: e.target.value })}
            />
          </div>
        )}

        {/* Account No. */}
        {shouldShowField('accountNo') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Account No. (बैंक खाता संख्या)
            </label>
            <input
              type={showIdentityDetails ? "text" : "password"}
              disabled={!isEditing}
              placeholder="Bank Account Number"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.accountNo || ''}
              onChange={e => setProfile({ ...profile, accountNo: e.target.value })}
            />
          </div>
        )}

        {/* IFSC Code */}
        {shouldShowField('ifscCode') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              IFSC Code (आईएफएससी कोड)
            </label>
            <input
              type={showIdentityDetails ? "text" : "password"}
              disabled={!isEditing}
              placeholder="e.g. SBIN0001234"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono uppercase",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.ifscCode || ''}
              onChange={e => setProfile({ ...profile, ifscCode: e.target.value.toUpperCase() })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
