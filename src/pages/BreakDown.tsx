import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { MachineContract, buildMachineContractsMapping, getCompanyByMachine } from '../utils/contracts';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Link } from 'react-router-dom';
import {
  Cpu, Building2, Calendar, Clock, Plus, AlertTriangle,
  Loader2, ListCollapse, FileText, ArrowRight, RotateCcw,
  CheckCircle2, MapPin
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

export default function BreakDown() {
  const [submitting, setSubmitting] = useState(false);

  // Dropdown options lists
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [machineName, setMachineName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [breakdownSection, setBreakdownSection] = useState('');
  const [breakdownReason, setBreakdownReason] = useState('');
  const [preventativeMeasures, setPreventativeMeasures] = useState('');
  const [breakdownType, setBreakdownType] = useState<string>('Block Time');
  const [customBreakdownType, setCustomBreakdownType] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [zone, setZone] = useState('');
  const [division, setDivision] = useState('');

  // User & permissions state
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);
  const [userAccessType, setUserAccessType] = useState<string>('limited');

  const isReadOnlyAdmin = isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');

  // Load current zone and division for selected machine dynamically
  useEffect(() => {
    if (!machineName) {
      setZone('');
      setDivision('');
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'machine_positions', machineName), (docSnap) => {
      if (docSnap.exists()) {
        const pos = docSnap.data();
        setZone(pos.zone || 'No Zone Assigned');
        setDivision(pos.division || 'No Division Assigned');
      } else {
        setZone('Not Assigned (Go to Movement Tracker)');
        setDivision('Not Assigned (Go to Movement Tracker)');
      }
    }, (error) => {
      console.error("Error loading machine position:", error);
      handleFirestoreError(error, OperationType.GET, `machine_positions/${machineName}`);
    });

    return () => unsubscribe();
  }, [machineName]);

  // Authenticate & Profile checking
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isEmp = !!user.email?.endsWith('@employee.billedapp.com');
        setIsEmployee(isEmp);
        try {
          const emp = await findEmployeeForUser(user.uid, user.email);
          if (emp) {
            setEmployeeProfile(emp);
            const access = emp.accessType || 'limited';
            setUserAccessType(access);
            if (isEmp) {
              setMachineName(emp.machineName || '');
              setCompanyName(emp.companyName || '');
            }
          } else {
            setUserAccessType('full');
          }
        } catch (error) {
          console.error("Error loading employee profile:", error);
        }
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Machine to Company & Position maps from machine_contracts & machine_positions
  const [contractCompanyMap, setContractCompanyMap] = useState<Record<string, string>>({});
  const [positionMap, setPositionMap] = useState<Record<string, { zone: string; division: string }>>({});

  // Fetch machines, contracts, and companies lists dynamically
  useEffect(() => {
    let settingsMachines: string[] = [];
    let employeeCompanies: string[] = [];
    let employeeMachines: string[] = [];
    let contractCompanies: string[] = [];
    let contractMachines: string[] = [];

    const recompute = () => {
      const allMachs = Array.from(new Set([...settingsMachines, ...contractMachines, ...employeeMachines])).filter(Boolean).sort();
      const allCos = Array.from(new Set([...employeeCompanies, ...contractCompanies])).filter(Boolean).sort();
      if (allMachs.length > 0) setMachinesList(allMachs);
      if (allCos.length > 0) setCompaniesList(allCos);
    };

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          settingsMachines = data.machines;
          recompute();
        }
      }
    });

    const unsubscribeEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      const cos = new Set<string>();
      const machs = new Set<string>();
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.companyName) cos.add(data.companyName.trim());
        if (data.machineName) machs.add(data.machineName.trim());
      });
      employeeCompanies = Array.from(cos);
      employeeMachines = Array.from(machs);
      recompute();
    });

    // Authoritative machine_contracts listener (handles active, transferred, and expired)
    const unsubscribeContracts = onSnapshot(collection(db, 'machine_contracts'), (snap) => {
      const rawContracts: MachineContract[] = [];
      const cos = new Set<string>();
      const machs = new Set<string>();

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        rawContracts.push({ id: docSnap.id, ...data } as MachineContract);
        if (data.companyName) cos.add(data.companyName.trim());
        if (data.transferredToCompany) cos.add(data.transferredToCompany.trim());
        if (data.machineName) machs.add(data.machineName.trim());
      });

      const mappings = buildMachineContractsMapping(rawContracts);
      const cMap: Record<string, string> = {};
      Object.entries(mappings).forEach(([m, res]) => {
        if (res.companyName) {
          cMap[m.toLowerCase()] = res.companyName;
          cos.add(res.companyName);
        }
      });

      contractCompanies = Array.from(cos);
      contractMachines = Array.from(machs);
      setContractCompanyMap(cMap);
      recompute();
    });

    const unsubscribePositions = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const pMap: Record<string, { zone: string; division: string }> = {};
      snap.forEach(d => {
        const data = d.data();
        const m = data.machineName || d.id;
        if (m) {
          pMap[m.trim().toLowerCase()] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setPositionMap(pMap);
    });

    return () => {
      unsubscribeSettings();
      unsubscribeEmployees();
      unsubscribeContracts();
      unsubscribePositions();
    };
  }, []);

  const handleMachineChange = async (selected: string) => {
    setMachineName(selected);
    if (!selected) {
      if (!isEmployee) setCompanyName('');
      return;
    }

    if (!isEmployee) {
      const key = selected.trim().toLowerCase();
      const autoCo = contractCompanyMap[key];
      if (autoCo) {
        setCompanyName(autoCo);
      } else {
        try {
          const directCo = await getCompanyByMachine(selected);
          if (directCo) {
            setCompanyName(directCo);
          }
        } catch (err) {
          console.error('Error auto-resolving company in BreakDown:', err);
        }
      }

      // Auto-populate zone & division from positions if not set
      const pos = positionMap[key];
      if (pos) {
        if (!zone && pos.zone) setZone(pos.zone);
        if (!division && pos.division) setDivision(pos.division);
      }
    }
  };

  const handleReset = () => {
    setEditingId(null);
    if (!isEmployee) {
      setMachineName('');
      setCompanyName('');
    }
    setBreakdownSection('');
    setBreakdownReason('');
    setPreventativeMeasures('');
    setBreakdownType('Block Time');
    setCustomBreakdownType('');
    setDateTime('');
    setToDateTime('');
    setZone('');
    setDivision('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineName) {
      toast.error("Please select a machine!");
      return;
    }
    if (!companyName) {
      toast.error("Please select a company!");
      return;
    }
    if (!breakdownReason.trim()) {
      toast.error("Please enter a breakdown reason!");
      return;
    }
    if (!dateTime) {
      toast.error("Please enter breakdown start date and time!");
      return;
    }

    const finalBreakdownType = breakdownType === 'Other' ? (customBreakdownType.trim() || 'Other') : breakdownType;

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      const userName = (employeeProfile && (employeeProfile.name || employeeProfile.email)) || user?.email || 'Admin';

      const payload = {
        machineName,
        companyName,
        breakdownSection: breakdownSection.trim(),
        breakdownReason: breakdownReason.trim(),
        preventativeMeasures: preventativeMeasures.trim(),
        breakdownType: finalBreakdownType,
        dateTime,
        toDateTime: toDateTime || '',
        zone,
        division,
        updatedAt: new Date().toISOString(),
        employeeName: userName,
        createdBy: user?.uid || 'Unknown'
      };

      if (editingId) {
        await updateDoc(doc(db, 'breakdowns', editingId), payload);
        toast.success("Breakdown/Failure record updated successfully!");
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'breakdowns'), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
        toast.success("Breakdown/Failure record submitted successfully!");
      }

      handleReset();
    } catch (error) {
      console.error("Error saving breakdown record:", error);
      handleFirestoreError(error, OperationType.CREATE, 'breakdowns');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      {/* Top Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-rose-950 flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100/60">
                <AlertTriangle size={22} className="animate-pulse" />
              </span>
              Machine Breakdown / Failure Log
            </h1>
            <p className="text-xs text-slate-500 font-semibold mt-1">
              Record operational failure, affected machine systems, root causes, and corrective actions taken.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/report?tab=break-down"
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-black rounded-xl border border-rose-200/60 transition-all shadow-xs active:scale-95"
            >
              <FileText size={15} />
              View Breakdown Report & History
              <ArrowRight size={13} className="text-rose-400" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content Area - Full Landscape Form */}
      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
        {isReadOnlyAdmin ? (
          <div className="w-full max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200/80 p-10 shadow-sm text-center space-y-4 my-8">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle size={28} />
            </div>
            <h3 className="text-lg font-black text-slate-800">Read-Only Access</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto font-medium leading-relaxed">
              Your account has view-only permissions for breakdown logging. You can view, search, filter, and export all past failure logs in the Breakdown Report ledger.
            </p>
            <div className="pt-2">
              <Link
                to="/report?tab=break-down"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm active:scale-95"
              >
                <FileText size={16} />
                Open Breakdown History Report
              </Link>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl mx-auto bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm">
            {/* Form Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                  {editingId ? 'Edit Breakdown / Failure Report' : 'Submit Breakdown / Failure Log'}
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Complete machine information, system affected, diagnostic timeline, and corrective actions below.
                </p>
              </div>

              {machineName && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-800">
                  <Cpu size={14} className="text-rose-600" />
                  <span>Selected Machine:</span>
                  <span className="font-extrabold text-slate-900">{machineName}</span>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Row 1: Machine, Enterprise & Geographic Placement (4 Columns Landscape Layout) */}
              <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-slate-600 uppercase tracking-wider">
                  <Cpu size={15} className="text-rose-600" />
                  Machine Identity & Geographic Placement
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Machine Name */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Machine Name <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      {!isEmployee ? (
                        <select
                          value={machineName}
                          onChange={(e) => handleMachineChange(e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                        >
                          <option value="">Select Machine</option>
                          {machinesList.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={machineName}
                          disabled
                          className="w-full pl-9 pr-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-not-allowed"
                        />
                      )}
                    </div>
                  </div>

                  {/* Company Name */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Company Name <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      {!isEmployee ? (
                        <select
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                        >
                          <option value="">Select Company</option>
                          {companyName && !companiesList.includes(companyName) && (
                            <option key={companyName} value={companyName}>{companyName}</option>
                          )}
                          {companiesList.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={companyName}
                          disabled
                          className="w-full pl-9 pr-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-not-allowed"
                        />
                      )}
                    </div>
                  </div>

                  {/* Railway Zone */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      Railway Zone
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="text"
                        value={zone || (machineName ? 'No Zone Assigned' : 'Select machine first')}
                        disabled
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      Railway Division
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="text"
                        value={division || (machineName ? 'No Division Assigned' : 'Select machine first')}
                        disabled
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Category, System Affected & Timings (4 Columns Landscape Layout) */}
              <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-slate-600 uppercase tracking-wider">
                  <ListCollapse size={15} className="text-rose-600" />
                  Failure Category, System & Timings
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Breakdown Type */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Breakdown Type <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={breakdownType}
                      onChange={(e) => setBreakdownType(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    >
                      <option value="Block Time">Block Time</option>
                      <option value="Base Depot">Base Depot</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  {/* Breakdown Section / System */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Breakdown Section / System <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <ListCollapse className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="text"
                        value={breakdownSection}
                        onChange={(e) => setBreakdownSection(e.target.value)}
                        placeholder="e.g. Mechanical / Engine / Hydraulic"
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                      />
                    </div>
                  </div>

                  {/* FROM Date & Time */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Start Date & Time (FROM) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="datetime-local"
                        value={dateTime}
                        onChange={(e) => setDateTime(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                      />
                    </div>
                  </div>

                  {/* TO Date & Time */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      End Date & Time (TO)
                    </label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="datetime-local"
                        value={toDateTime}
                        onChange={(e) => setToDateTime(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                      />
                    </div>
                  </div>
                </div>

                {breakdownType === 'Other' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1.5">
                      Custom Breakdown Type Description <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={customBreakdownType}
                      onChange={(e) => setCustomBreakdownType(e.target.value)}
                      placeholder="Type custom failure category or classification..."
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    />
                  </div>
                )}
              </div>

              {/* Row 3: Diagnostic Details & Preventative Actions (2 Columns Landscape Layout) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                    Breakdown Reason / Problem Details <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={breakdownReason}
                    onChange={(e) => setBreakdownReason(e.target.value)}
                    rows={4}
                    placeholder="Describe what occurred, symptoms observed, error alarms triggered, or root failure causes..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-y"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                    Preventative Measures / Corrective Actions Taken
                  </label>
                  <textarea
                    value={preventativeMeasures}
                    onChange={(e) => setPreventativeMeasures(e.target.value)}
                    rows={4}
                    placeholder="What steps did you perform to safeguard, repair, or prevent future occurrences? (Bachne ke liye kya kye)"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-y"
                  />
                </div>
              </div>

              {/* Form Action Buttons (Horizontal Landscape Bar) */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-7 py-3 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all"
                  >
                    {submitting ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : editingId ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <AlertTriangle size={16} />
                    )}
                    {editingId ? 'Update Breakdown Log' : 'Save Breakdown / Failure Log'}
                  </button>

                  {editingId ? (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50 transition-all"
                    >
                      Cancel Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="inline-flex items-center gap-1.5 px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50 transition-all"
                    >
                      <RotateCcw size={13} />
                      Reset
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-400 font-semibold text-center sm:text-right">
                  Logged breakdown events synchronize directly with machine reliability logs and reports.
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </motion.div>
  );
}
