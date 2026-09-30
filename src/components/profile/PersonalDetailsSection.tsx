import React from 'react';
import { 
  User as UserIcon, Mail, Phone, Calendar, Briefcase, 
  Building2, Award, ShieldAlert, Lock, Sparkles
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile } from '../../utils/employee';
import { isBirthdayToday } from '../../utils/birthdayAndPmeService';

interface PersonalDetailsSectionProps {
  profile: EmployeeProfile;
  setProfile: React.Dispatch<React.SetStateAction<EmployeeProfile>>;
  isEditing: boolean;
  isEmployee: boolean;
  shouldShowField: (fieldName: string) => boolean;
  onOpenBirthdayModal?: () => void;
}

export function PersonalDetailsSection({
  profile,
  setProfile,
  isEditing,
  isEmployee,
  shouldShowField,
  onOpenBirthdayModal,
}: PersonalDetailsSectionProps) {
  const isSelfDisabled = !isEditing || isEmployee || Boolean(profile.employeeId && profile.accessType !== 'full');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <UserIcon size={18} className="text-indigo-600" />
        <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider">
          Personal Details <span className="text-slate-400 font-normal lowercase">(व्यक्तिगत एवं सेवा विवरण)</span>
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Full Name */}
        {shouldShowField('name') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <UserIcon size={14} className="text-slate-400" /> Full Name (पूरा नाम) *
            </label>
            <input
              type="text"
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.name}
              onChange={e => setProfile({ ...profile, name: e.target.value })}
              required
            />
          </div>
        )}

        {/* Father's Name */}
        {shouldShowField('fatherName') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Father's Name (पिता का नाम)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. Late Shri Ram..."
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.fatherName || ''}
              onChange={e => setProfile({ ...profile, fatherName: e.target.value })}
            />
          </div>
        )}

        {/* Date of Birth (DOB) */}
        {shouldShowField('dob') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Calendar size={14} className="text-slate-400" /> Date of Birth (DOB / जन्म तिथि)
              </label>
              {isBirthdayToday(profile.dob) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-xs animate-pulse">
                  🎂 Birthday Today!
                </span>
              )}
            </div>
            <input
              type="date"
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40",
                isBirthdayToday(profile.dob) && "border-amber-400 bg-amber-50/30"
              )}
              value={profile.dob || ''}
              onChange={e => setProfile({ ...profile, dob: e.target.value })}
            />
            {isBirthdayToday(profile.dob) && (
              <div className="p-3 rounded-xl bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 border border-amber-300 flex items-center justify-between gap-3 text-amber-950">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎉</span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-amber-900">
                      Happy Birthday! • जन्मदिन की हार्दिक शुभकामनाएं
                    </p>
                    <p className="text-[11px] text-amber-800 font-medium">
                      Official celebration certificate is ready in your account.
                    </p>
                  </div>
                </div>
                {onOpenBirthdayModal && (
                  <button
                    type="button"
                    onClick={onOpenBirthdayModal}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors shrink-0 flex items-center gap-1"
                  >
                    <Sparkles size={12} />
                    <span>View Certificate</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Age */}
        {shouldShowField('age') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Age (उम्र - वर्ष में)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. 32"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.age || ''}
              onChange={e => setProfile({ ...profile, age: e.target.value })}
            />
          </div>
        )}

        {/* Gender / Sex */}
        {shouldShowField('gender') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Gender (लिंग)
            </label>
            <select
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.gender || 'Male'}
              onChange={e => setProfile({ ...profile, gender: e.target.value as any })}
            >
              <option value="Male">Male (पुरुष)</option>
              <option value="Female">Female (महिला)</option>
              <option value="Other">Other (अन्य)</option>
            </select>
          </div>
        )}

        {/* Mobile Number */}
        {shouldShowField('mobile') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Phone size={14} className="text-slate-400" /> Mobile Number (मोबाइल नंबर)
            </label>
            <input
              type="tel"
              disabled={!isEditing}
              placeholder="10-digit mobile number"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.mobile}
              onChange={e => setProfile({ ...profile, mobile: e.target.value })}
            />
          </div>
        )}

        {/* Email Address */}
        {shouldShowField('email') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Mail size={14} className="text-slate-400" /> Email Address (ईमेल पता)
            </label>
            <input
              type="email"
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.email}
              onChange={e => setProfile({ ...profile, email: e.target.value })}
            />
          </div>
        )}

        {/* Designation */}
        {shouldShowField('designation') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Briefcase size={14} className="text-slate-400" /> Designation (पद)
            </label>
            <input
              type="text"
              disabled={isSelfDisabled}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                isSelfDisabled && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.designation}
              onChange={e => setProfile({ ...profile, designation: e.target.value })}
            />
          </div>
        )}

        {/* Company Name */}
        {shouldShowField('companyName') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Building2 size={14} className="text-slate-400" /> Company Name (कंपनी का नाम)
            </label>
            <input
              type="text"
              disabled={isSelfDisabled}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                isSelfDisabled && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.companyName || ''}
              onChange={e => setProfile({ ...profile, companyName: e.target.value })}
            />
          </div>
        )}

        {/* Department */}
        {shouldShowField('department') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Department (विभाग)
            </label>
            <input
              type="text"
              disabled={!isEditing}
              placeholder="e.g. Track Machine / Civil Engineering"
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.department || ''}
              onChange={e => setProfile({ ...profile, department: e.target.value })}
            />
          </div>
        )}

        {/* Date of Joining (DOJ) */}
        {shouldShowField('doj') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Calendar size={14} className="text-slate-400" /> Date of Joining (DOJ / कार्यभार ग्रहण तिथि)
            </label>
            <input
              type="date"
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.doj || ''}
              onChange={e => setProfile({ ...profile, doj: e.target.value })}
            />
          </div>
        )}

        {/* Validity Date of I-Card */}
        {shouldShowField('validityDate') && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Calendar size={14} className="text-slate-400" /> Validity Date of I-Card (आई-कार्ड वैधता तिथि)
            </label>
            <input
              type="date"
              disabled={!isEditing}
              className={cn(
                "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
              )}
              value={profile.validityDate || ''}
              onChange={e => setProfile({ ...profile, validityDate: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
