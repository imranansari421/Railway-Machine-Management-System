import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Cpu, Building2, Calendar, Clock, Plus, Trash2, Edit2, Search, ArrowRightLeft, Loader2, FileText, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';

interface MovementRecord {
  id: string;
  machineName: string;
  companyName: string;
  fromDateTime: string;
  toDateTime: string;
  fromType?: string;
  toType?: string;
  fromZone?: string;
  fromDivision?: string;
  toZone?: string;
  toDivision?: string;
  createdAt: string;
  createdBy: string;
  employeeName: string;
}

export default function MachineMovement() {
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Lists for dropdowns
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [machineName, setMachineName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [fromDateTime, setFromDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [fromType, setFromType] = useState('');
  const [toType, setToType] = useState('');
  const [fromZone, setFromZone] = useState('');
  const [fromDivision, setFromDivision] = useState('');
  const [toZone, setToZone] = useState('');
  const [toDivision, setToDivision] = useState('');
  const [originalMachineNameForEdit, setOriginalMachineNameForEdit] = useState<string>('');

  const latestMovementForSelectedMachine = useMemo(() => {
    if (!machineName) return null;
    return movements.find(m => m.machineName === machineName) || null;
  }, [machineName, movements]);

  useEffect(() => {
    if (!editingId) {
      if (latestMovementForSelectedMachine) {
        setFromZone(latestMovementForSelectedMachine.toZone || '');
        setFromDivision(latestMovementForSelectedMachine.toDivision || '');
      } else {
        setFromZone('');
        setFromDivision('');
      }
    }
  }, [latestMovementForSelectedMachine, editingId]);

  const formatCreatorName = (name: string | undefined | null): string => {
    if (!name) return 'Admin';
    const trimmed = name.trim();
    if (trimmed.endsWith('@billedapp.com') || trimmed === '102220971984') {
      return 'Admin';
    }
    return trimmed.replace('@employee.billedapp.com', '');
  };

  // User States
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLightAdmin, setIsLightAdmin] = useState(false);
  const [employeeList, setEmployeeList] = useState<any[]>([]);

  // Filters State
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterCompany, setFilterCompany] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // 1. Check user profile and role
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
            setIsAdmin(true); // default non-employee is admin
            setIsLightAdmin(false);
          }
        } catch (error) {
          console.error("Error checking employee profile:", error);
        }
      }
    });
    return unsubscribeAuth;
  }, []);

  // 2. Fetch machines and companies list
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

  // 3. Listen to real-time machine movements
  useEffect(() => {
    const unsubscribeMovements = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list: MovementRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          fromDateTime: data.fromDateTime || '',
          toDateTime: data.toDateTime || '',
          fromType: data.fromType || 'Block Time',
          toType: data.toType || 'Base Depot',
          fromZone: data.fromZone || '',
          fromDivision: data.fromDivision || '',
          toZone: data.toZone || '',
          toDivision: data.toDivision || '',
          createdAt: data.createdAt || '',
          createdBy: data.createdBy || '',
          employeeName: data.employeeName || 'Unknown'
        });
      });
      // Sort by creation time or start date descending
      list.sort((a, b) => b.fromDateTime.localeCompare(a.fromDateTime));
      setMovements(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading machine movements:", error);
      toast.error("Failed to load machine movements records.");
      setLoading(false);
    });

    return unsubscribeMovements;
  }, []);

  // Synchronize latest machine movement destination with machine_positions and employees collections
  const syncLatestMovementForMachine = async (machine: string) => {
    if (!machine) return;
    try {
      // 1. Fetch all movements for this machine
      const q = query(collection(db, 'machine_movements'), where('machineName', '==', machine));
      const snap = await getDocs(q);
      const machineMovements: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        machineMovements.push({ id: d.id, ...data });
      });

      // 2. Sort by fromDateTime descending to get the latest movement
      machineMovements.sort((a, b) => b.fromDateTime.localeCompare(a.fromDateTime));

      if (machineMovements.length > 0) {
        const latest = machineMovements[0];
        const latestZone = latest.toZone || '';
        const latestDivision = latest.toDivision || '';

        // Update global machine position
        await setDoc(doc(db, 'machine_positions', machine), {
          machineName: machine,
          zone: latestZone,
          division: latestDivision,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // Update all mapped employees
        const empQuery = query(collection(db, 'employees'), where('machineName', '==', machine));
        const empSnap = await getDocs(empQuery);
        for (const docSnap of empSnap.docs) {
          const empData = docSnap.data();
          const currentHist = empData.zoneDivisionHistory || [];
          
          // Append new history entry if different or not present
          const hasThisEntry = currentHist.some((h: any) => h.fromDateTime === latest.fromDateTime && h.toDateTime === latest.toDateTime);
          let updatedHist = currentHist;
          if (!hasThisEntry) {
            updatedHist = [
              ...currentHist,
              {
                zone: latestZone,
                division: latestDivision,
                machineName: machine,
                fromDateTime: latest.fromDateTime,
                toDateTime: latest.toDateTime,
                updatedAt: new Date().toISOString()
              }
            ];
          }

          await updateDoc(docSnap.ref, {
            zone: latestZone,
            division: latestDivision,
            zoneDivisionHistory: updatedHist
          });
        }
      } else {
        // If no movements left for this machine, reset position and employee assignments
        await setDoc(doc(db, 'machine_positions', machine), {
          machineName: machine,
          zone: '',
          division: '',
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const empQuery = query(collection(db, 'employees'), where('machineName', '==', machine));
        const empSnap = await getDocs(empQuery);
        for (const docSnap of empSnap.docs) {
          await updateDoc(docSnap.ref, {
            zone: '',
            division: ''
          });
        }
      }
    } catch (err) {
      console.error("Error synchronizing latest machine movement:", err);
    }
  };

  // 4. Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineName) {
      toast.error("Please select or enter a Machine Name");
      return;
    }
    if (!companyName) {
      toast.error("Please select or enter a Company Name");
      return;
    }
    if (!toZone) {
      toast.error("Please select a destination Railway Zone");
      return;
    }
    if (!toDivision) {
      toast.error("Please select a destination Division");
      return;
    }
    if (!fromDateTime || !toDateTime) {
      toast.error("Please specify both From and To date-times");
      return;
    }
    if (new Date(fromDateTime) >= new Date(toDateTime)) {
      toast.error("To Date/Time must be after From Date/Time");
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      const rawUserName = employeeProfile?.name || user?.displayName || user?.email || 'Admin';
      const userName = formatCreatorName(rawUserName);

      const payload = {
        machineName,
        companyName,
        fromDateTime,
        toDateTime,
        fromType,
        toType,
        fromZone,
        fromDivision,
        toZone,
        toDivision,
        updatedAt: new Date().toISOString(),
        employeeName: userName,
        createdBy: user?.uid || 'Unknown'
      };

      if (editingId) {
        await updateDoc(doc(db, 'machine_movements', editingId), payload);
        toast.success("Machine movement record updated successfully!");
        setEditingId(null);
        // Sync both old and new machines if they differ
        await syncLatestMovementForMachine(machineName);
        if (originalMachineNameForEdit && originalMachineNameForEdit !== machineName) {
          await syncLatestMovementForMachine(originalMachineNameForEdit);
        }
        setOriginalMachineNameForEdit('');
      } else {
        await addDoc(collection(db, 'machine_movements'), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
        toast.success("Machine movement record saved successfully!");
        await syncLatestMovementForMachine(machineName);
      }

      // Reset form (except for static employee inputs)
      if (!isEmployee) {
        setMachineName('');
        setCompanyName('');
      }
      setFromDateTime('');
      setToDateTime('');
      setFromType('');
      setToType('');
      setFromZone('');
      setFromDivision('');
      setToZone('');
      setToDivision('');
    } catch (error) {
      console.error("Error saving machine movement:", error);
      handleFirestoreError(error, OperationType.CREATE, 'machine_movements');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (rec: MovementRecord) => {
    setEditingId(rec.id);
    setOriginalMachineNameForEdit(rec.machineName);
    setMachineName(rec.machineName);
    setCompanyName(rec.companyName);
    setFromDateTime(rec.fromDateTime);
    setToDateTime(rec.toDateTime);
    setFromType(rec.fromType || '');
    setToType(rec.toType || '');
    setFromZone(rec.fromZone || '');
    setFromDivision(rec.fromDivision || '');
    setToZone(rec.toZone || '');
    setToDivision(rec.toDivision || '');
  };

  const handleDelete = async (id: string, recordMachineName: string) => {
    if (!window.confirm("Are you sure you want to delete this movement record?")) return;
    try {
      await deleteDoc(doc(db, 'machine_movements', id));
      toast.success("Record deleted successfully!");
      await syncLatestMovementForMachine(recordMachineName);
    } catch (error) {
      console.error("Error deleting movement record:", error);
      handleFirestoreError(error, OperationType.DELETE, 'machine_movements');
    }
  };

  const handleExportPDF = () => {
    const headers = ["Machine Name", "Company", "From Date/Time", "To Date/Time", "From Zone", "From Division", "To Zone", "To Division", "From Location", "To Location", "Duration (Hours)", "Logged By"];
    const keys = ["machineName", "companyName", "fromDateTime", "toDateTime", "fromZone", "fromDivision", "toZone", "toDivision", "fromType", "toType", "hours", "employeeName"];
    const title = "Railway Machine Movement Report";
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to export to PDF.");
      return;
    }
    
    const rowsHtml = filteredMovements.map(row => {
      const start = new Date(row.fromDateTime);
      const end = new Date(row.toDateTime);
      const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;
      
      const formattedRow = {
        ...row,
        fromDateTime: new Date(row.fromDateTime).toLocaleString(),
        toDateTime: new Date(row.toDateTime).toLocaleString(),
        hours: `${hours} hrs`,
        employeeName: formatCreatorName(row.employeeName)
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
          <div class="meta">Report generated on ${new Date().toLocaleString()} | Total Movements: ${filteredMovements.length}</div>
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
    const headers = ["Machine Name", "Company", "From Date/Time", "To Date/Time", "From Zone", "From Division", "To Zone", "To Division", "From Location", "To Location", "Duration (Hours)", "Logged By"];
    const keys = ["machineName", "companyName", "fromDateTime", "toDateTime", "fromZone", "fromDivision", "toZone", "toDivision", "fromType", "toType", "hours", "employeeName"];
    const filename = `Machine_Movement_Report_${new Date().toISOString().split('T')[0]}`;
    
    const csvRows = [headers.join(",")];
    for (const row of filteredMovements) {
      const start = new Date(row.fromDateTime);
      const end = new Date(row.toDateTime);
      const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;

      const formattedRow = {
        ...row,
        fromDateTime: new Date(row.fromDateTime).toLocaleString(),
        toDateTime: new Date(row.toDateTime).toLocaleString(),
        hours: hours.toString(),
        employeeName: formatCreatorName(row.employeeName)
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

  // Filter records
  const filteredMovements = movements.filter((rec) => {
    if (isEmployee) {
      const myCompany = (employeeProfile && employeeProfile.companyName) || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany && rec.companyName && rec.companyName !== myCompany) return false;

      if (!isLightAdmin) {
        const userMachine = employeeProfile?.machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (userMachine && rec.machineName && rec.machineName !== userMachine) return false;
      }
    }
    if (filterMachine !== 'all' && rec.machineName !== filterMachine) return false;
    if (filterCompany !== 'all' && rec.companyName !== filterCompany) return false;
    if (filterZone !== 'all' && rec.toZone !== filterZone) return false;
    if (filterDivision !== 'all' && rec.toDivision !== filterDivision) return false;
    if (filterDateFrom && rec.fromDateTime.split('T')[0] < filterDateFrom) return false;
    if (filterDateTo && rec.toDateTime.split('T')[0] > filterDateTo) return false;
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-indigo-950 flex items-center gap-2">
              <ArrowRightLeft className="text-primary" size={24} /> Machine Movement Tracker
            </h1>
            <p className="text-xs text-slate-500 font-semibold mt-1">
              Log and track machines' movement schedules, durations, and respective client assignments.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Creation Form */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-slate-50 pb-2">
            {editingId ? "Edit Movement Record" : "Log New Movement"}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                  />
                )}
              </div>
              {latestMovementForSelectedMachine && (
                <div className="mt-2.5 p-3.5 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl space-y-1.5 shadow-sm">
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-950 uppercase tracking-wider">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Latest Recorded Destination:
                  </div>
                  <div className="text-xs font-semibold text-slate-700">
                    <span className="font-extrabold text-indigo-700">{latestMovementForSelectedMachine.toZone}</span>,{" "}
                    <span className="font-extrabold text-indigo-700">{latestMovementForSelectedMachine.toDivision}</span>{" "}
                    <span className="text-slate-500">({latestMovementForSelectedMachine.toType || 'N/A'})</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-bold flex items-center gap-1">
                    <span>📅 End Date:</span>
                    <span>{new Date(latestMovementForSelectedMachine.toDateTime).toLocaleString()}</span>
                  </div>
                </div>
              )}
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
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  From (Origin) Zone
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  <select
                    value={fromZone}
                    onChange={(e) => {
                      setFromZone(e.target.value);
                      setFromDivision('');
                    }}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  >
                    <option value="">Select Origin Railway Zone</option>
                    {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  From (Origin) Division
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  <select
                    value={fromDivision}
                    onChange={(e) => setFromDivision(e.target.value)}
                    disabled={!fromZone}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select Origin Division</option>
                    {fromZone && RAILWAY_ZONES_DIVISIONS[fromZone]?.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  To (Destination) Zone
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  <select
                    value={toZone}
                    onChange={(e) => {
                      setToZone(e.target.value);
                      setToDivision('');
                    }}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  >
                    <option value="">Select Railway Zone</option>
                    {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  To (Destination) Division
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                  <select
                    value={toDivision}
                    onChange={(e) => setToDivision(e.target.value)}
                    disabled={!toZone}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select Division</option>
                    {toZone && RAILWAY_ZONES_DIVISIONS[toZone]?.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  From (Start)
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="datetime-local"
                    value={fromDateTime}
                    onChange={(e) => setFromDateTime(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  To (End)
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="datetime-local"
                    value={toDateTime}
                    onChange={(e) => setToDateTime(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  From Type
                </label>
                <input
                  type="text"
                  value={fromType}
                  onChange={(e) => setFromType(e.target.value)}
                  placeholder="e.g. Block Time, Yard, Workshop..."
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  To Type
                </label>
                <input
                  type="text"
                  value={toType}
                  onChange={(e) => setToType(e.target.value)}
                  placeholder="e.g. Base Depot, Station, Site..."
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-grow flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-indigo-700 text-white py-2.5 rounded-xl font-bold text-sm shadow hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                {editingId ? "Update Record" : "Save Record"}
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
                    setFromDateTime('');
                    setToDateTime('');
                    setFromType('');
                    setToType('');
                    setToZone('');
                    setToDivision('');
                  }}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Side: Movements Directory & Filter */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 text-xs font-black text-slate-700 uppercase tracking-wider">
              <Search size={16} /> Filters:
            </div>

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

            {!isEmployee && (
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700"
              >
                <option value="all">All Companies</option>
                {companiesList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

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

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs bg-white font-bold text-slate-700"
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs bg-white font-bold text-slate-700"
              />
            </div>
          </div>

          {/* Export Action Buttons Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl">
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider block sm:inline">
              Movement logs matched: <strong className="text-indigo-600">{filteredMovements.length}</strong>
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
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-16 text-center text-slate-400">
              <ArrowRightLeft className="mx-auto text-slate-300 mb-2" size={32} />
              <p className="text-sm font-bold">No machine movement records found.</p>
              <p className="text-xs text-slate-400 mt-1">Specify new movement records using the left pane.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Machine</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Company</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Duration / Hours</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider">Attended By</th>
                    <th className="px-5 py-3 text-xs font-black uppercase text-slate-500 tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredMovements.map((rec) => {
                    const start = new Date(rec.fromDateTime);
                    const end = new Date(rec.toDateTime);
                    const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;
                    
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4 text-sm font-bold text-indigo-950">
                          <div>{rec.machineName}</div>
                          {rec.toZone && (
                            <div className="text-[10px] text-indigo-600 bg-indigo-50 font-black px-1.5 py-0.5 rounded-md mt-1 inline-flex items-center gap-1.5 flex-wrap">
                              {rec.fromZone ? (
                                <>
                                  <span>{rec.fromZone} ({rec.fromDivision || 'No Div'})</span>
                                  <span className="text-indigo-400 font-normal">→</span>
                                </>
                              ) : null}
                              <span>📍 {rec.toZone} ({rec.toDivision})</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-xs font-bold text-slate-600">{rec.companyName}</td>
                        <td className="px-5 py-4">
                          <div className="text-xs font-black text-slate-800">
                            {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span>to</span>
                            <span className="font-bold text-slate-500">{end.toLocaleDateString()} {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded-md font-black">{hours} hrs</span>
                          </div>
                          {rec.fromType && rec.toType && (
                            <div className="text-[10px] text-slate-500 font-bold mt-1.5 flex items-center gap-1">
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">{rec.fromType}</span>
                              <span className="text-slate-400 font-normal">→</span>
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">{rec.toType}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-xs font-bold text-slate-500">{formatCreatorName(rec.employeeName)}</td>
                        <td className="px-5 py-4 text-right">
                          {(!isEmployee && (isAdmin || auth.currentUser?.uid === rec.createdBy)) ? (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleEdit(rec)}
                                className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                                title="Edit Record"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(rec.id, rec.machineName)}
                                className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                                title="Delete Record"
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
