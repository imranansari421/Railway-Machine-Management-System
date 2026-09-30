import React from 'react';
import { User, Building2, MapPin, Camera, Award, ShieldCheck, Briefcase } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ProfileSection = 'personal' | 'identity' | 'address' | 'photo_sig' | 'career' | 'others' | 'security';

interface ProfileSectionTabsProps {
  activeSection: ProfileSection;
  onChangeSection: (section: ProfileSection) => void;
  othersBadgeCount?: number;
  careerBadgeCount?: number;
}

export const PROFILE_SECTIONS: { 
  id: ProfileSection; 
  label: string; 
  hindiLabel: string; 
  icon: any;
}[] = [
  { 
    id: 'personal', 
    label: 'Personal Details', 
    hindiLabel: 'व्यक्तिगत विवरण', 
    icon: User 
  },
  { 
    id: 'career', 
    label: 'Career', 
    hindiLabel: 'करियर (कंपनी, मशीन, जोन/मंडल)', 
    icon: Briefcase 
  },
  { 
    id: 'identity', 
    label: 'Identity & Financial', 
    hindiLabel: 'पहचान एवं वित्तीय', 
    icon: Building2 
  },
  { 
    id: 'address', 
    label: 'Residential Address', 
    hindiLabel: 'आवासीय पता', 
    icon: MapPin 
  },
  { 
    id: 'photo_sig', 
    label: 'Photo & Signature', 
    hindiLabel: 'फोटो एवं हस्ताक्षर', 
    icon: Camera 
  },
  { 
    id: 'others', 
    label: 'Others', 
    hindiLabel: 'अन्य (Award, PME आदि)', 
    icon: Award 
  },
  { 
    id: 'security', 
    label: 'Security', 
    hindiLabel: 'सुरक्षा (पासवर्ड एवं पिन)', 
    icon: ShieldCheck 
  },
];

export function ProfileSectionTabs({
  activeSection,
  onChangeSection,
  othersBadgeCount = 0,
  careerBadgeCount = 0,
}: ProfileSectionTabsProps) {
  return (
    <div className="border-b border-slate-100 pb-3 mb-6">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {PROFILE_SECTIONS.map((sec) => {
          const IconComp = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onChangeSection(sec.id)}
              className={cn(
                "flex items-center gap-2.5 px-4 py-3 rounded-xl font-bold text-xs whitespace-nowrap transition-all duration-200 shrink-0",
                isActive
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20 ring-2 ring-indigo-600/30"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/70"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                isActive ? "bg-white/20 text-white" : "bg-white text-slate-500 shadow-2xs"
              )}>
                <IconComp size={15} />
              </div>
              <div className="flex flex-col text-left">
                <span className="leading-tight">{sec.label}</span>
                <span className={cn(
                  "text-[9px] font-normal leading-none mt-0.5",
                  isActive ? "text-indigo-100" : "text-slate-400"
                )}>
                  {sec.hindiLabel}
                </span>
              </div>
              {sec.id === 'others' && (
                <span className={cn(
                  "ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold",
                  isActive ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-700 border border-indigo-100"
                )}>
                  {othersBadgeCount > 0 ? othersBadgeCount : '4'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
