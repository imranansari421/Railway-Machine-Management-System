import React from 'react';
import { MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile } from '../../utils/employee';

interface ResidentialAddressSectionProps {
  profile: EmployeeProfile;
  setProfile: React.Dispatch<React.SetStateAction<EmployeeProfile>>;
  isEditing: boolean;
  shouldShowField: (fieldName: string) => boolean;
}

export function ResidentialAddressSection({
  profile,
  setProfile,
  isEditing,
  shouldShowField,
}: ResidentialAddressSectionProps) {
  if (!shouldShowField('address')) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <MapPin size={18} className="text-indigo-600" />
        <h3 className="text-sm font-black uppercase text-slate-800 tracking-wider">
          Residential Address <span className="text-slate-400 font-normal lowercase">(स्थाई एवं वर्तमान आवासीय पता)</span>
        </h3>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <MapPin size={14} className="text-slate-400" /> Full Residential Address (पूरा आवासीय पता)
        </label>
        <textarea
          rows={5}
          disabled={!isEditing}
          placeholder="Enter house no., street/mohalla, landmark, post office, city, district, state and PIN code..."
          className={cn(
            "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all resize-none leading-relaxed",
            !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
          )}
          value={profile.address || ''}
          onChange={e => setProfile({ ...profile, address: e.target.value })}
        />
        <p className="text-[11px] text-slate-400">
          This address will be printed on official identification cards and service communication records.
        </p>
      </div>
    </div>
  );
}
