import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { Cpu, Building2, Calendar, Clock, Plus, Trash2, Edit2, Search, AlertTriangle, ShieldCheck, Loader2, ListCollapse, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface BreakdownRecord {
  id: string;
  machineName: string;
  companyName: string;
  breakdownSection: string;
  breakdownReason: string;
  preventativeMeasures: string;
  breakdownType: string;
  dateTime: string;
  toDateTime?: string;
  createdAt: string;
  createdBy: string;
  employeeName: string;
  zone?: string;
  division?: string;
}

// Utility to format Date to DD-MM-YYYY format
const formatToDDMMYYYY = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

// Format helper for display names/emails to fulfill user requirements
const formatCreatorName = (name: string | undefined | null) => {
  if (!name) return 'Admin';
  const trimmed = name.trim();
  if (trimmed === '102220971984@billedapp.com' || trimmed.endsWith('@billedapp.com') || trimmed === '102220971984') {
    return 'Admin';
  }
  if (trimmed.endsWith('@employee.billedapp.com')) {
    return trimmed.split('@')[0];
  }
  return trimmed;
};

export default function BreakDown() {
  const [breakdowns, setBreakdowns] = useState<BreakdownRecord[]>([]);
  const [loading, setLoading] = useState(true);
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

  // User States
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLightAdmin, setIsLightAdmin] = useState(false);
  const [employeeList, setEmployeeList] = useState<any[]>([]);

  // Filter States
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Authenticate & Profile checking
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
            setIsAdmin(access === 'full' || access === 'admin-light');
            setIsLightAdmin(access === 'admin-light');
            if (isEmp) {
              setMachineName(emp.machineName || '');
              setCompanyName(emp.companyName || '');
            }
          } else {
            setIsAdmin(true);
            setIsLightAdmin(false);
          }
        } catch (error) {
          console.error("Error loading employee profile:", error);
        }
      }
    });
    return unsubscribeAuth;
  }, []);

  // 2. Fetch machines and companies lists dynamically
  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
      }
    });

    const unsubscribeEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      const companiesSet = new Set<string>();
      const machinesSet = new Set<string>();
      const empList: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        empList.push({ id: docSnap.id, ...data });
        if (data.companyName) companiesSet.add(data.companyName.trim());
        if (data.machineName) machinesSet.add(data.machineName.trim());
      });
      setEmployeeList(empList);
      setCompaniesList(Array.from(companiesSet).filter(Boolean).sort());
      setMachinesList(prev => {
        const combined = new Set([...prev, ...Array.from(machinesSet).filter(Boolean)]);
        return Array.from(combined);
      });
    });

    return () => {
      unsubscribeSettings();
      unsubscribeEmployees();
    };
  }, []);

  // 3. Listen to Breakdown records real-time
  useEffect(() => {
    const unsubscribeBreakdowns = onSnapshot(collection(db, 'breakdowns'), (snap) => {
      const list: BreakdownRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          breakdownSection: data.breakdownSection || '',
          breakdownReason: data.breakdownReason || '',
          preventativeMeasures: data.preventativeMeasures || '',
          breakdownType: data.breakdownType || 'Block Time',
          dateTime: data.dateTime || '',
          toDateTime: data.toDateTime || '',
          createdAt: data.createdAt || '',
          createdBy: data.createdBy || '',
          employeeName: data.employeeName || 'Unknown',
          zone: data.zone || '',
          division: data.division || ''
        });
      });
      list.sort((a, b) => b.dateTime.localeCompare(a.dateTime));
      setBreakdowns(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading breakdowns:", error);
      toast.error("Failed to load breakdown records.");
      setLoading(false);
    });

    return unsubscribeBreakdowns;
  }, []);

  // 4. Submit Breakdown Report
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineName) {
      toast.error("Please specify a Machine Name");
      return;
    }
    if (!companyName) {
      toast.error("Please specify a Company Name");
      return;
    }
    if (!breakdownSection) {
      toast.error("Please specify the Breakdown Section");
      return;
    }
    if (!breakdownReason) {
      toast.error("Please provide a Breakdown Reason");
      return;
    }
    if (!preventativeMeasures) {
      toast.error("Please fill 'What was done to prevent' field");
      return;
    }
    if (breakdownType === 'Other' && !customBreakdownType.trim()) {
      toast.error("Please specify the other Breakdown Type");
      return;
    }
    if (!dateTime) {
      toast.error("Please specify FROM Breakdown Date & Time");
      return;
    }
    if (!toDateTime) {
      toast.error("Please specify TO Breakdown Date & Time");
      return;
    }

    if (new Date(toDateTime) < new Date(dateTime)) {
      toast.error("'TO Breakdown Date & Time' must be after or equal to 'FROM Breakdown Date & Time'");
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      const userName = employeeProfile?.name || user?.email || 'Unknown';

      const finalBreakdownType = breakdownType === 'Other' ? customBreakdownType.trim() : breakdownType;

      const payload = {
        machineName,
        companyName,
        breakdownSection,
        breakdownReason,
        preventativeMeasures,
        breakdownType: finalBreakdownType,
        dateTime,
        toDateTime,
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

      // Reset form variables (non-employee inputs)
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
    } catch (error) {
      console.error("Error saving breakdown record:", error);
      handleFirestoreError(error, OperationType.CREATE, 'breakdowns');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (rec: BreakdownRecord) => {
    setEditingId(rec.id);
    setMachineName(rec.machineName);
    setCompanyName(rec.companyName);
    setBreakdownSection(rec.breakdownSection);
    setBreakdownReason(rec.breakdownReason);
    setPreventativeMeasures(rec.preventativeMeasures);
    if (rec.breakdownType === 'Block Time' || rec.breakdownType === 'Base Depot') {
      setBreakdownType(rec.breakdownType);
      setCustomBreakdownType('');
    } else {
      setBreakdownType('Other');
      setCustomBreakdownType(rec.breakdownType);
    }
    setDateTime(rec.dateTime);
    setToDateTime(rec.toDateTime || '');
    setZone(rec.zone || '');
    setDivision(rec.division || '');
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this breakdown log?")) return;
    try {
      await deleteDoc(doc(db, 'breakdowns', id));
      toast.success("Breakdown record deleted!");
    } catch (error) {
      console.error("Error deleting breakdown record:", error);
      handleFirestoreError(error, OperationType.DELETE, 'breakdowns');
    }
  };

  const handleExportPDF = () => {
    const headers = ["Machine Name", "Company", "Failure Section/System", "Failure Reason", "Preventative Measures", "Type", "FROM Date/Time", "TO Date/Time", "Logged By"];
    const keys = ["machineName", "companyName", "breakdownSection", "breakdownReason", "preventativeMeasures", "breakdownType", "dateTime", "toDateTime", "employeeName"];
    const title = "Railway Machine Breakdown/Failure Report";
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to export to PDF.");
      return;
    }
    
    const rowsHtml = filteredBreakdowns.map(row => {
      const formattedRow = {
        ...row,
        dateTime: row.dateTime ? new Date(row.dateTime).toLocaleString() : '',
        toDateTime: row.toDateTime ? new Date(row.toDateTime).toLocaleString() : 'N/A',
        employeeName: formatCreatorName(row.employeeName),
      };

      return `<tr>${keys.map(k => {
        let val = formattedRow[k as keyof typeof formattedRow];
        return `<td>${String(val || '')}</td>`;
      }).join('')}</tr>`;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Inter', system-ui, sans-serif; padding: 25px; color: #1e293b; }
            h1 { font-size: 22px; font-weight: 800; margin-bottom: 5px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
            .meta { font-size: 11px; color: #64748b; margin-bottom: 20px; font-weight: 500; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 10px; text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; }
            td { border: 1px solid #cbd5e1; padding: 10px; font-size: 11px; color: #334155; line-height: 1.5; vertical-align: top; }
            tr:nth-child(even) td { background-color: #f8fafc; }
            @page { size: A4 landscape; margin: 15mm; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">Report generated on ${new Date().toLocaleString()} | Total Breakdowns: ${filteredBreakdowns.length}</div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.close();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportExcel = () => {
    const headers = ["Machine Name", "Company", "Failure Section/System", "Failure Reason", "Preventative Measures", "Type", "FROM Date/Time", "TO Date/Time", "Logged By"];
    const keys = ["machineName", "companyName", "breakdownSection", "breakdownReason", "preventativeMeasures", "breakdownType", "dateTime", "toDateTime", "employeeName"];
    const filename = `Breakdown_Failure_Report_${new Date().toISOString().split('T')[0]}`;
    
    const csvRows = [headers.join(",")];
    for (const row of filteredBreakdowns) {
      const formattedRow = {
        ...row,
        dateTime: row.dateTime ? new Date(row.dateTime).toLocaleString() : '',
        toDateTime: row.toDateTime ? new Date(row.toDateTime).toLocaleString() : 'N/A',
        employeeName: formatCreatorName(row.employeeName),
      };

      const values = keys.map(k => {
        let val = formattedRow[k as keyof typeof formattedRow];
        const stringVal = String(val || '').replace(/"/g, '""');
        return `"${stringVal}"`;
      });
      csvRows.push(values.join(","));
    }
    const csvString = csvRows.join("\n");
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Excel/CSV report downloaded successfully!");
  };

  // Filter record listings
  const filteredBreakdowns = breakdowns.filter((rec) => {
    if (isEmployee) {
      const myCompany = (employeeProfile && employeeProfile.companyName) || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany && rec.companyName && rec.companyName !== myCompany) return false;

      if (!isLightAdmin) {
        const userMachine = employeeProfile?.machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (userMachine && rec.machineName && rec.machineName !== userMachine) return false;
      }
    }
    if (filterMachine !== 'all' && rec.machineName !== filterMachine) return false;
    if (filterType !== 'all' && rec.breakdownType !== filterType) return false;
    if (filterZone !== 'all' && rec.zone !== filterZone) return false;
    if (filterDivision !== 'all' && rec.division !== filterDivision) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inSection = rec.breakdownSection.toLowerCase().includes(q);
      const inReason = rec.breakdownReason.toLowerCase().includes(q);
      const inMeasures = rec.preventativeMeasures.toLowerCase().includes(q);
      const inEmployee = rec.employeeName.toLowerCase().includes(q);
      if (!inSection && !inReason && !inMeasures && !inEmployee) return false;
    }
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
        <div>
          <h1 className="text-2xl font-black text-red-950 flex items-center gap-2">
            <AlertTriangle className="text-red-600 animate-pulse" size={24} /> Machine Breakdown/Failure Log
          </h1>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            Record details about operational failure, machine system affected, and measures deployed to mitigate further breakdown/failure.
          </p>
        </div>
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left pane: Logging Form */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-slate-50 pb-2">
            {editingId ? "Edit Breakdown/Failure Report" : "Submit Breakdown/Failure Log"}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Machine Name
                </label>
                <div className="relative">
                  <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  {!isEmployee ? (
                    <select
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
                      className="w-full pl-10 pr-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Company Name
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  {!isEmployee ? (
                    <select
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    >
                      <option value="">Select Company</option>
                      {companiesList.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={companyName}
                      disabled
                      className="w-full pl-10 pr-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Railway Zone
                </label>
                <input
                  type="text"
                  value={zone || 'Select a machine first'}
                  disabled
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Division
                </label>
                <input
                  type="text"
                  value={division || 'Select a machine first'}
                  disabled
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Breakdown Type
                </label>
                <select
                  value={breakdownType}
                  onChange={(e) => setBreakdownType(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="Block Time">Block Time</option>
                  <option value="Base Depot">Base Depot</option>
                  <option value="Other">Other</option>
                </select>
                {breakdownType === 'Other' && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={customBreakdownType}
                      onChange={(e) => setCustomBreakdownType(e.target.value)}
                      placeholder="Type Breakdown Type here..."
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Breakdown Section
                </label>
                <div className="relative">
                  <ListCollapse className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={breakdownSection}
                    onChange={(e) => setBreakdownSection(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="e.g. Mechanical / Engine"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                Breakdown Reason / Problem details
              </label>
              <textarea
                value={breakdownReason}
                onChange={(e) => setBreakdownReason(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                rows={3}
                placeholder="Describe what occurred, alarms triggered, or symptoms observed..."
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                What was done to prevent / fix it (Bachne ke liye kya kye)
              </label>
              <textarea
                value={preventativeMeasures}
                onChange={(e) => setPreventativeMeasures(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                rows={3}
                placeholder="What steps did you perform to safeguard or work around?"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  First Breakdown Date & Time (FROM)
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="datetime-local"
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Second Breakdown Date & Time (TO)
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="datetime-local"
                    value={toDateTime}
                    onChange={(e) => setToDateTime(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-grow flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-700 text-white py-2.5 rounded-xl font-bold text-sm shadow hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <AlertTriangle size={16} />}
                {editingId ? "Update Breakdown/Failure Log" : "Save Breakdown/Failure Log"}
              </button>

              {editingId && (
                <button
                  type="button"
                  onClick={() => {
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
                  }}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right pane: Search & List Directory */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 text-xs font-black text-slate-700 uppercase tracking-wider">
              <Search size={16} /> Search & Filters:
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search section, reason..."
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 w-44"
            />

            <select
              value={filterMachine}
              onChange={(e) => setFilterMachine(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700"
            >
              <option value="all">All Machines</option>
              {(isEmployee && isLightAdmin
                ? machinesList.filter(m => {
                    const myCompany = (employeeProfile && employeeProfile.companyName) || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
                    if (!myCompany) return true;
                    const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
                    const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
                    return companyMachines.has(m);
                  })
                : machinesList
              ).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700"
            >
              <option value="all">All Types</option>
              <option value="Block Time">Block Time</option>
              <option value="Base Depot">Base Depot</option>
              <option value="Other">Other</option>
            </select>

            {(!isEmployee || isLightAdmin) && (
              <>
                <select
                  value={filterZone}
                  onChange={(e) => {
                    setFilterZone(e.target.value);
                    setFilterDivision('all');
                  }}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700"
                >
                  <option value="all">All Zones</option>
                  {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>

                <select
                  value={filterDivision}
                  onChange={(e) => setFilterDivision(e.target.value)}
                  disabled={filterZone === 'all'}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 disabled:opacity-50"
                >
                  <option value="all">All Divisions</option>
                  {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* Export Action Buttons Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl">
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider block sm:inline">
              Breakdown/Failure logs matched: <strong className="text-red-600">{filteredBreakdowns.length}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportPDF}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-black rounded-xl border border-rose-200 transition-all active:scale-95 shadow-sm"
                title="Export current filtered data to PDF"
              >
                <FileText size={13} />
                Export PDF
              </button>
              <button
                onClick={handleExportExcel}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-black rounded-xl border border-emerald-200 transition-all active:scale-95 shadow-sm"
                title="Export current filtered data to Excel/CSV"
              >
                <FileText size={13} />
                Export Excel
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-20 bg-white border border-slate-100 rounded-2xl">
              <Loader2 className="animate-spin text-red-600" size={32} />
            </div>
          ) : filteredBreakdowns.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-16 text-center text-slate-400">
              <ShieldCheck className="mx-auto text-emerald-500 mb-2" size={36} />
              <p className="text-sm font-bold text-slate-700">No breakdowns/failures logged!</p>
              <p className="text-xs text-slate-400 mt-1">Machine operational statuses are green and healthy.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Machine / Type</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Section & Date</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Problem / Mitigations</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Reporter</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBreakdowns.map((rec) => {
                    const dt = new Date(rec.dateTime);
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="text-sm font-bold text-red-950">{rec.machineName}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{rec.companyName}</div>
                          {rec.zone && (
                            <div className="text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 mt-1 inline-block">
                              📍 {rec.zone} - {rec.division}
                            </div>
                          )}
                          <div className="mt-1">
                            <span className={`inline-block text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              rec.breakdownType === 'Block Time' ? 'bg-red-50 text-red-700 border border-red-200' :
                              rec.breakdownType === 'Base Depot' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                              'bg-slate-50 text-slate-700 border border-slate-200'
                            }`}>
                              {rec.breakdownType}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="text-xs font-black text-slate-800">{rec.breakdownSection}</div>
                          <div className="text-[10px] text-slate-500 font-bold mt-1.5 flex flex-col gap-1.5">
                            <div className="flex items-center gap-1">
                              <span className="text-red-600 font-black shrink-0">FROM:</span>
                              <span className="text-slate-700">{formatToDDMMYYYY(rec.dateTime)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-indigo-600 font-black shrink-0">TO:</span>
                              <span className="text-slate-700">{rec.toDateTime ? formatToDDMMYYYY(rec.toDateTime) : 'N/A'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 max-w-xs">
                          <div className="text-xs font-bold text-slate-800 line-clamp-2">
                            <span className="font-black text-red-700">Problem:</span> {rec.breakdownReason}
                          </div>
                          <div className="text-[10px] text-slate-500 line-clamp-2 mt-1">
                            <span className="font-black text-emerald-700">Mitigation:</span> {rec.preventativeMeasures}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs font-bold text-slate-500">{formatCreatorName(rec.employeeName)}</td>
                        <td className="px-5 py-4 text-right">
                          {(!isEmployee && (isAdmin || auth.currentUser?.uid === rec.createdBy)) ? (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleEdit(rec)}
                                className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                                title="Edit Log"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(rec.id)}
                                className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                                title="Delete Log"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Limited</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
