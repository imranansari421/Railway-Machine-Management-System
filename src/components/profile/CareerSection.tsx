import React, { useState, useEffect, useMemo } from 'react';
import { 
  Briefcase, Building2, MapPin, Calendar, Trash2, Edit3, 
  CheckCircle2, Clock, Cpu, ArrowRight, ShieldCheck, AlertCircle,
  FileText, History, Loader2, X, RefreshCw, Plus
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmployeeProfile, CareerRecord, buildComprehensiveCareerHistory } from '../../utils/employee';
import { formatDateToDDMMYYYY } from '../../utils/dateUtils';
import { RAILWAY_ZONES_DIVISIONS } from '../../utils/railway';
import { db } from '../../firebase';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface CareerSectionProps {
  profile: EmployeeProfile;
  isEmployee: boolean;
  canManageAdminRecords: boolean;
  isMasterAdmin: boolean;
  onSaveCareerRecord: (record: CareerRecord) => Promise<void>;
  onUpdateCareerRecord: (index: number, record: CareerRecord) => Promise<void>;
  onDeleteCareerRecord: (index: number) => Promise<void>;
}

export function CareerSection({
  profile,
  isEmployee,
  canManageAdminRecords,
  isMasterAdmin,
  onSaveCareerRecord,
  onUpdateCareerRecord,
  onDeleteCareerRecord,
}: CareerSectionProps) {
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [machineName, setMachineName] = useState('');
  const [zone, setZone] = useState('West Central Railway (WCR)');
  const [division, setDivision] = useState('Jabalpur');
  const [fromDateTime, setFromDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [isCurrentlyActive, setIsCurrentlyActive] = useState(false);
  const [designation, setDesignation] = useState('');
  const [remarks, setRemarks] = useState('');

  // Dropdown lists sync
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Sync machine list from settings/general and companies from employees
  useEffect(() => {
    const unsubSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines) && data.machines.length > 0) {
          setMachinesList(data.machines);
        }
      }
    });

    const unsubEmp = onSnapshot(collection(db, 'employees'), (snap) => {
      const compSet = new Set<string>();
      const machSet = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        if (data.companyName) compSet.add(data.companyName.trim());
        if (data.machineName) machSet.add(data.machineName.trim());
      });
      setCompaniesList(Array.from(compSet).filter(Boolean).sort());
      setMachinesList(prev => {
        if (prev && prev.length > 0) return prev;
        return Array.from(machSet).filter(Boolean);
      });
    });

    const unsubMov = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list: any[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() });
      });
      setMachineMovements(list);
    });

    return () => {
      unsubSettings();
      unsubEmp();
      unsubMov();
    };
  }, []);

  const [machineMovements, setMachineMovements] = useState<any[]>([]);

  // Available divisions for selected zone
  const availableDivisions = RAILWAY_ZONES_DIVISIONS[zone] || [];

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setCompanyName(profile.companyName || '');
    setMachineName(profile.machineName || '');
    setZone(profile.zone || 'West Central Railway (WCR)');
    setDivision(profile.division || 'Jabalpur');
    setFromDateTime('');
    setToDateTime('');
    setIsCurrentlyActive(false);
    setDesignation(profile.designation || '');
    setRemarks('');
    setShowModal(true);
  };

  const handleOpenEdit = (index: number, record: CareerRecord) => {
    setEditingIndex(index);
    setCompanyName(record.companyName || '');
    setMachineName(record.machineName || '');
    setZone(record.zone || 'West Central Railway (WCR)');
    setDivision(record.division || '');
    setFromDateTime(record.fromDateTime || '');
    if (record.toDateTime === 'Ongoing' || !record.toDateTime) {
      setToDateTime('');
      setIsCurrentlyActive(true);
    } else {
      setToDateTime(record.toDateTime);
      setIsCurrentlyActive(false);
    }
    setDesignation(record.designation || '');
    setRemarks(record.remarks || '');
    setShowModal(true);
  };

  const handleSubmit = async (e?: React.FormEvent | React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!companyName.trim()) {
      toast.error('Please enter or select Company Name');
      return;
    }
    if (!machineName.trim()) {
      toast.error('Please enter or select Machine Name');
      return;
    }
    if (!fromDateTime) {
      toast.error('Please specify start date (kab se)');
      return;
    }

    setSubmitting(true);
    try {
      const recordData: CareerRecord = {
        companyName: companyName.trim(),
        machineName: machineName.trim(),
        zone: zone.trim(),
        division: division.trim(),
        fromDateTime: fromDateTime,
        toDateTime: isCurrentlyActive ? 'Ongoing' : toDateTime,
        designation: designation.trim() || profile.designation,
        remarks: remarks.trim(),
        status: isCurrentlyActive ? 'active' : 'completed',
        createdAt: new Date().toISOString()
      };

      if (editingIndex !== null) {
        await onUpdateCareerRecord(editingIndex, recordData);
        toast.success('Career record updated successfully!');
      } else {
        await onSaveCareerRecord(recordData);
        toast.success('Career record added successfully!');
      }
      setShowModal(false);
    } catch (err: any) {
      console.error('Error saving career record:', err);
      toast.error(err.message || 'Failed to save career record');
    } finally {
      setSubmitting(false);
    }
  };

  // Compile all career records directly from machine movement history and employee records
  const allCareerRecords: CareerRecord[] = useMemo(() => {
    return buildComprehensiveCareerHistory(profile, machineMovements);
  }, [profile, machineMovements]);

  // Current active posting record
  const currentActiveRecord = useMemo(() => {
    return allCareerRecords.find(r => r.toDateTime === 'Ongoing' || r.status === 'active' || !r.toDateTime);
  }, [allCareerRecords]);

  // "is div tag me current posing show n kare yaha par jo beet chuka hai wah show kare"
  // Past records: strictly completed tenures (excluding current active posting)
  const pastCareerList: CareerRecord[] = useMemo(() => {
    return allCareerRecords
      .filter(r => r.toDateTime !== 'Ongoing' && r.status !== 'active')
      .sort((a, b) => (b.fromDateTime || '').localeCompare(a.fromDateTime || ''));
  }, [allCareerRecords]);

  // Current posting details
  const currentPostingZone = currentActiveRecord?.zone || profile.zone || 'West Central Railway';
  const currentPostingDivision = currentActiveRecord?.division || profile.division || 'Jabalpur';
  const currentStationedSince = currentActiveRecord?.fromDateTime || profile.doj || new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-8">
      {/* Header with Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs shrink-0">
            <Briefcase size={20} />
          </div>
          <div>
            <h3 className="text-base font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
              Career & Deployment Records
              <span className="text-indigo-600 text-xs font-bold lowercase">
                (करियर इतिहास: कंपनी, मशीन, जोन एवं मंडल)
              </span>
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              कर्मचारी कब से कब तक किस कंपनी, मशीन, रेलवे जोन और मंडल में पदस्थ रहे हैं इसका आधिकारिक विवरण
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1. CURRENT ACTIVE POSTING (वर्तमान पदस्थापना) */}
      {/* ============================================================== */}
      <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-teal-500/10 border-2 border-emerald-500/30 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-600"></span>
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800 block">
                Active Stationing • वर्तमान पदस्थापना
              </span>
              <h4 className="text-sm font-black text-emerald-950">
                Current Posting & Machine Details (वर्तमान डेटा)
              </h4>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white self-start sm:self-auto shadow-2xs">
            Currently Working • वर्तमान में कार्यरत
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white/80 p-4 rounded-xl border border-emerald-200/60 shadow-2xs">
          {/* Current Company */}
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <Building2 size={11} className="text-emerald-600" /> Current Company (कंपनी)
            </span>
            <p className="text-xs font-black text-slate-800 break-words">
              {profile.companyName || 'Not Assigned / General'}
            </p>
          </div>

          {/* Current Machine */}
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <Cpu size={11} className="text-indigo-600" /> Assigned Machine (मशीन)
            </span>
            <p className="text-xs font-black text-indigo-700 font-mono break-words">
              {profile.machineName || 'General Machine'}
            </p>
          </div>

          {/* Current Zone */}
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <MapPin size={11} className="text-emerald-600" /> Railway Zone (रेलवे जोन)
            </span>
            <p className="text-xs font-black text-slate-800 break-words">
              {currentPostingZone}
            </p>
          </div>

          {/* Current Division */}
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <MapPin size={11} className="text-emerald-600" /> Division (रेलवे मंडल)
            </span>
            <p className="text-xs font-black text-slate-800 break-words">
              {currentPostingDivision}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-200/50 text-[11px] text-emerald-900 font-semibold">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-emerald-700" />
            <span>Stationed Since: <strong className="font-mono font-bold">{formatDateToDDMMYYYY(currentStationedSince)}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <Briefcase size={13} className="text-emerald-700" />
            <span>Designation: <strong>{profile.designation || 'Staff'}</strong></span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. CHRONOLOGICAL PAST CAREER TIMELINE (पिछली पदस्थापना / बीता हुआ इतिहास) */}
      {/* ============================================================== */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <History size={16} className="text-indigo-600" />
              Past Deployments & Movements (पिछली पदस्थापना एवं बीता हुआ इतिहास)
            </h4>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              मशीन या कर्मचारी के पूर्व रेलवे जोन, मंडल या कंपनी में कार्य करने का बीता हुआ विवरण (कब से कब तक)
            </p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[10px] text-slate-400 font-bold hidden sm:inline">
              Past Records: {pastCareerList.length + (profile.employmentHistory?.length || 0)}
            </span>
          </div>
        </div>

        {/* Past Saved Career Records (excluding current active posting) */}
        {pastCareerList.length > 0 ? (
          <div className="space-y-3">
            {pastCareerList.map((record, idx) => {
              return (
                <motion.div
                  key={record.id || idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all duration-200 shadow-2xs relative"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-mono font-black text-xs shrink-0 bg-slate-100 text-slate-700 border border-slate-200">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black text-slate-900">{record.companyName}</span>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 font-mono font-black px-2 py-0.5 rounded border border-indigo-200">
                            {record.machineName}
                          </span>
                          {record.designation && (
                            <span className="text-[10px] bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded border border-slate-200">
                              {record.designation}
                            </span>
                          )}
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                            {record.status === 'left' ? 'Left Company' : 'पिछली पदस्थापना • Transferred'}
                          </span>
                        </div>

                        {/* Movement route: From Zone/Division ➔ To Zone/Division */}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs bg-slate-50/90 p-2 rounded-lg border border-slate-200/70">
                          <div className="flex items-center gap-1 text-slate-700">
                            <span className="text-[9px] font-black uppercase text-slate-400">From (से):</span>
                            <span className="font-bold text-slate-800">{record.fromZone || record.zone}</span>
                            <span className="text-slate-300 font-normal">/</span>
                            <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/50">
                              {record.fromDivision || record.division}
                            </span>
                          </div>

                          <ArrowRight size={13} className="text-indigo-500 shrink-0 mx-0.5" />

                          <div className="flex items-center gap-1 text-slate-700">
                            <span className="text-[9px] font-black uppercase text-slate-400">To (को):</span>
                            <span className="font-bold text-slate-800">{record.toZone || profile.zone || 'N/A'}</span>
                            <span className="text-slate-300 font-normal">/</span>
                            <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/50">
                              {record.toDivision || profile.division || 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <div className="text-right">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">
                          Duration (कब से कब तक)
                        </span>
                        <span className="text-xs font-mono font-black text-slate-800">
                          {formatDateToDDMMYYYY(record.fromDateTime)} &rarr; {formatDateToDDMMYYYY(record.toDateTime)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {record.remarks && (
                    <div className="mt-2.5 pt-2 text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200/50">
                      <span className="font-bold text-slate-700">Remarks / Order:</span> {record.remarks}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ) : (
          /* Fallback when no previous deployment records exist */
          <div className="bg-slate-50/70 border border-dashed border-slate-300 rounded-2xl p-6 text-center space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <History size={20} />
            </div>
            <div>
              <h5 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                कोई पिछली पदस्थापना या पूर्व स्थानांतरण दर्ज नहीं है
              </h5>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                कर्मचारी नियुक्ति तिथि ({formatDateToDDMMYYYY(profile.doj)}) से वर्तमान पदस्थापना पर ही कार्यरत हैं। यदि मशीन पहले किसी अन्य ज़ोन या मंडल में कार्य कर चुकी है या कर्मचारी पूर्व कंपनी से आए हैं, तो बीता हुआ डेटा यहाँ प्रदर्शित होगा।
              </p>
            </div>
          </div>
        )}

        {/* Previous Employment History (PF records if any) */}
        {profile.employmentHistory && profile.employmentHistory.length > 0 && (
          <div className="pt-4 space-y-3">
            <h5 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-1.5">
              <Building2 size={14} className="text-amber-600" />
              Prior Company Employment History (पूर्व कंपनी रोजगार विवरण)
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {profile.employmentHistory.map((job, jIdx) => (
                <div key={jIdx} className="bg-amber-50/40 border border-amber-200/60 p-3.5 rounded-xl flex items-center justify-between">
                  <div>
                    <h6 className="text-xs font-black text-amber-950">{job.companyName}</h6>
                    <p className="text-[11px] text-slate-600 font-semibold mt-0.5">{job.designation}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-bold uppercase block mb-1">
                      Relieved / Left
                    </span>
                    <p className="text-[10px] text-slate-500 font-mono font-bold">
                      {formatDateToDDMMYYYY(job.doj)} &rarr; {formatDateToDDMMYYYY(job.leftDate) || 'Present'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 3. MODAL: ADD / EDIT CAREER POSTING */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            key="career-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowModal(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-8 border border-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-indigo-50/80 to-blue-50/80">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
                    <Briefcase size={16} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800">
                      {editingIndex !== null ? 'Edit Career Record (करियर रिकॉर्ड संपादित करें)' : 'Add Career Record (करियर रिकॉर्ड जोड़ें)'}
                    </h4>
                    <p className="text-[10px] text-slate-500 font-medium">
                      कंपनी, मशीन, पद, रेलवे जोन और मंडल का संपूर्ण विवरण दर्ज करें
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div 
                className="p-6 space-y-5"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Company Name */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Building2 size={12} className="text-indigo-600" /> Company Name (कंपनी का नाम) *
                    </label>
                    <input
                      type="text"
                      list="career_companies_list"
                      required
                      placeholder="e.g. M/s XYZ Track Machines..."
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                    <datalist id="career_companies_list">
                      {companiesList.map((c, i) => (
                        <option key={i} value={c} />
                      ))}
                    </datalist>
                  </div>

                  {/* Machine Name */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Cpu size={12} className="text-indigo-600" /> Machine Name (मशीन का नाम) *
                    </label>
                    <input
                      type="text"
                      list="career_machines_list"
                      required
                      placeholder="Select or enter Machine..."
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none font-mono"
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                    />
                    <datalist id="career_machines_list">
                      {machinesList.map((m, i) => (
                        <option key={i} value={m} />
                      ))}
                    </datalist>
                  </div>

                  {/* Railway Zone */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <MapPin size={12} className="text-indigo-600" /> Railway Zone (रेलवे जोन) *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none bg-white"
                      value={zone}
                      onChange={(e) => {
                        const newZone = e.target.value;
                        setZone(newZone);
                        const divs = RAILWAY_ZONES_DIVISIONS[newZone] || [];
                        setDivision(divs[0] || '');
                      }}
                    >
                      {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                        <option key={z} value={z}>{z}</option>
                      ))}
                    </select>
                  </div>

                  {/* Railway Division */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <MapPin size={12} className="text-indigo-600" /> Railway Division (रेलवे मंडल) *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none bg-white"
                      value={division}
                      onChange={(e) => setDivision(e.target.value)}
                    >
                      <option value="">Select Division...</option>
                      {availableDivisions.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>

                  {/* Start Date (Kab se) */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Calendar size={12} className="text-indigo-600" /> From Date (कब से) *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none bg-white"
                      value={fromDateTime}
                      onChange={(e) => setFromDateTime(e.target.value)}
                    />
                  </div>

                  {/* End Date (Kab tak) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <Calendar size={12} className="text-indigo-600" /> To Date (कब तक)
                      </label>
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isCurrentlyActive}
                          onChange={(e) => {
                            setIsCurrentlyActive(e.target.checked);
                            if (e.target.checked) setToDateTime('');
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Currently Active (वर्तमान)</span>
                      </label>
                    </div>
                    <input
                      type="date"
                      disabled={isCurrentlyActive}
                      className={cn(
                        "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none bg-white transition-all",
                        isCurrentlyActive && "opacity-50 cursor-not-allowed bg-slate-100"
                      )}
                      value={toDateTime}
                      onChange={(e) => setToDateTime(e.target.value)}
                    />
                  </div>

                  {/* Designation */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Briefcase size={12} className="text-indigo-600" /> Designation (पद)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Machine Operator..."
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none"
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                    />
                  </div>

                  {/* Remarks / Order No */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <FileText size={12} className="text-indigo-600" /> Remarks / Order No. (आदेश क्रमांक)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Order #WCR/TM/2026/04..."
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmit()}
                    disabled={submitting}
                    className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5 disabled:opacity-50 transition-all"
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                    <span>{editingIndex !== null ? 'Update Record' : 'Save Record'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
