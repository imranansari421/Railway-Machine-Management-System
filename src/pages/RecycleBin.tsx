import React, { useState, useEffect } from 'react';
import { 
  RotateCcw, Trash2, Search, Filter, ShieldAlert, Calendar, User, 
  Building2, Eye, CheckCircle2, AlertTriangle, RefreshCw, X, Download, 
  ArrowUpDown, Cpu, Layers, FileText, CheckSquare, Square
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { 
  DeletedRecord, 
  restoreDeletedRecord, 
  permanentDeleteRecord, 
  emptyRecycleBin 
} from '../utils/recycleBin';
import { findEmployeeForUser } from '../utils/employee';
import { formatDateToDDMMYYYY } from '../utils/dateUtils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import TrackMachineLoader from '../components/TrackMachineLoader';

export default function RecycleBin() {
  const [records, setRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedRole, setSelectedRole] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Modals & Selection
  const [viewingRecord, setViewingRecord] = useState<DeletedRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmEmptyModal, setConfirmEmptyModal] = useState(false);

  // 1. Auth & Master Admin Verification
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        const isEmpEmail = !!user.email?.endsWith('@employee.billedapp.com');
        const loginPortal = localStorage.getItem(`loginPortal_${user.uid}`) || '';
        const access = localStorage.getItem(`accessType_${user.uid}`) || '';

        let hasEmployeeDoc = false;
        try {
          const emp = await findEmployeeForUser(user.uid, user.email);
          if (emp?.employeeId) {
            hasEmployeeDoc = true;
          }
        } catch {
          // ignore
        }

        const isMaster = user.email === 'imranansari399605@gmail.com' || (
          !isEmpEmail &&
          loginPortal !== 'employee' &&
          !hasEmployeeDoc &&
          access !== 'admin-light' &&
          access !== 'zonal-admin' &&
          access !== 'divisional-admin'
        );

        setIsMasterAdmin(isMaster);
      } else {
        setCurrentUser(null);
        setIsMasterAdmin(false);
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // 2. Real-time Subscription to Deleted Records (Recycle Bin)
  useEffect(() => {
    // If not authenticated or not master admin, do not listen
    if (!currentUser || !isMasterAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'deleted_records'), orderBy('deletedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: DeletedRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          originalCollection: data.originalCollection || '',
          originalId: data.originalId || '',
          data: data.data || {},
          moduleName: data.moduleName || 'General',
          itemSummary: data.itemSummary || 'Deleted Item',
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          deletedAt: data.deletedAt || '',
          deletedByUid: data.deletedByUid || '',
          deletedByName: data.deletedByName || 'Unknown',
          deletedByEmail: data.deletedByEmail || '',
          deletedByRole: data.deletedByRole || 'Admin'
        });
      });
      setRecords(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading recycle bin records:", error);
      toast.error("Failed to load deleted records: " + error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, isMasterAdmin]);

  // Derived lists for filters
  const uniqueModules = Array.from(new Set(records.map(r => r.moduleName).filter(Boolean))).sort();
  const uniqueMachines = Array.from(new Set(records.map(r => r.machineName).filter(Boolean))).sort();
  const uniqueRoles = Array.from(new Set(records.map(r => r.deletedByRole).filter(Boolean))).sort();

  // Filter application
  const filteredRecords = records.filter(r => {
    if (selectedModule !== 'all' && r.moduleName !== selectedModule) return false;
    if (selectedMachine !== 'all' && r.machineName !== selectedMachine) return false;
    if (selectedRole !== 'all' && r.deletedByRole !== selectedRole) return false;

    if (filterStartDate) {
      const recordDate = r.deletedAt.split('T')[0];
      if (recordDate < filterStartDate) return false;
    }
    if (filterEndDate) {
      const recordDate = r.deletedAt.split('T')[0];
      if (recordDate > filterEndDate) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const inSummary = r.itemSummary.toLowerCase().includes(q);
      const inModule = r.moduleName.toLowerCase().includes(q);
      const inMachine = (r.machineName || '').toLowerCase().includes(q);
      const inCompany = (r.companyName || '').toLowerCase().includes(q);
      const inDeletedBy = r.deletedByName.toLowerCase().includes(q);
      const inEmail = r.deletedByEmail.toLowerCase().includes(q);
      const inCollection = r.originalCollection.toLowerCase().includes(q);
      if (!inSummary && !inModule && !inMachine && !inCompany && !inDeletedBy && !inEmail && !inCollection) {
        return false;
      }
    }

    return true;
  });

  // Action: Restore Single Record
  const handleRestore = async (record: DeletedRecord) => {
    setIsProcessing(true);
    try {
      await restoreDeletedRecord(record);
      toast.success(`Successfully restored "${record.itemSummary}" back to ${record.moduleName}!`);
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    } catch (err: any) {
      console.error("Error restoring record:", err);
      toast.error("Failed to restore record: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Action: Permanent Delete Single Record
  const handlePermanentDelete = async (record: DeletedRecord) => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete this record? This action CANNOT be recovered!`)) {
      return;
    }
    setIsProcessing(true);
    try {
      await permanentDeleteRecord(record.id);
      toast.success("Record permanently removed from recycle bin.");
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    } catch (err: any) {
      console.error("Error purging record:", err);
      toast.error("Failed to purge record: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Action: Bulk Restore Selected
  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to restore ${selectedIds.size} selected records back to their original databases?`)) {
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of Array.from(selectedIds)) {
      const record = records.find(r => r.id === id);
      if (record) {
        try {
          await restoreDeletedRecord(record);
          successCount++;
        } catch (err) {
          console.error(`Error restoring record ${id}:`, err);
          failCount++;
        }
      }
    }

    setIsProcessing(false);
    setSelectedIds(new Set());
    if (successCount > 0) {
      toast.success(`Successfully restored ${successCount} record(s)!`);
    }
    if (failCount > 0) {
      toast.error(`Failed to restore ${failCount} record(s).`);
    }
  };

  // Action: Empty Entire Recycle Bin
  const handleEmptyAll = async () => {
    setIsProcessing(true);
    try {
      const count = await emptyRecycleBin();
      toast.success(`Permanently cleared ${count} records from the Recycle Bin.`);
      setConfirmEmptyModal(false);
      setSelectedIds(new Set());
    } catch (err: any) {
      console.error("Error emptying recycle bin:", err);
      toast.error("Failed to clear recycle bin: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Multi-select toggle
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 1. Loading state while verifying Master Admin status
  if (!authChecked || (loading && isMasterAdmin)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <TrackMachineLoader message="Accessing Secure Data Recovery Vault..." />
      </div>
    );
  }

  // 2. Access check: ONLY Master Admin can view or access
  if (!isMasterAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-4 shadow-sm">
          <ShieldAlert size={32} />
        </div>
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-sm text-slate-500 font-semibold max-w-md mt-2">
          The Recycle Bin & Data Recovery Vault is exclusively restricted to the Primary Master Admin. Employee, Company Admin, and Zonal/Divisional accounts cannot access or restore deleted data.
        </p>
      </div>
    );
  }

  // Count stats
  const totalDeleted = records.length;
  const deletedByEmps = records.filter(r => r.deletedByRole.includes('Employee') || r.deletedByRole.includes('Company')).length;
  const totalModulesCount = uniqueModules.length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 pb-12"
    >
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-inner shrink-0">
            <RotateCcw className="stroke-[2.2]" size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Recycle Bin & Data Recovery Center
              </h1>
              <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black uppercase rounded-full border border-rose-200">
                Primary Admin Only
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Live recovery vault for restoring any records deleted by employees, company admins, or staff across all modules.
            </p>
          </div>
        </div>

        {/* Global Bin Actions */}
        <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkRestore}
              disabled={isProcessing}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl border border-emerald-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
            >
              <RotateCcw size={14} /> Restore Selected ({selectedIds.size})
            </button>
          )}

          {records.length > 0 && (
            <button
              onClick={() => setConfirmEmptyModal(true)}
              disabled={isProcessing}
              className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl border border-rose-200 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <Trash2 size={14} /> Empty Recycle Bin
            </button>
          )}
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-black">
            <Trash2 size={18} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Archived In Vault</div>
            <div className="text-xl font-black text-slate-900">{totalDeleted} Records</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 font-black">
            <User size={18} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Deleted By Staff / Admins</div>
            <div className="text-xl font-black text-slate-900">{deletedByEmps} Records</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 font-black">
            <Layers size={18} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Modules Protected</div>
            <div className="text-xl font-black text-slate-900">{totalModulesCount || 'All'} Modules</div>
          </div>
        </div>
      </div>

      {/* Filters & Search Control Center */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Text Search */}
          <div className="relative md:col-span-2">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={14} />
            </span>
            <input
              type="text"
              placeholder="Search by title, machine, staff, email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
            />
          </div>

          {/* Module Filter */}
          <div>
            <select
              value={selectedModule}
              onChange={e => setSelectedModule(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
            >
              <option value="all">All Modules ({records.length})</option>
              {uniqueModules.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Machine Filter */}
          <div>
            <select
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
            >
              <option value="all">All Machines</option>
              {uniqueMachines.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Role Filter */}
          <div>
            <select
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
            >
              <option value="all">All Roles</option>
              {uniqueRoles.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date Range Sub-row */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
          <span className="font-bold text-slate-400 text-[11px] uppercase tracking-wider flex items-center gap-1">
            <Calendar size={13} /> Deletion Date Range:
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterStartDate}
              onChange={e => setFilterStartDate(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-700 outline-none"
              title="Start Date"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={e => setFilterEndDate(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-700 outline-none"
              title="End Date"
            />
            {(filterStartDate || filterEndDate || searchQuery || selectedModule !== 'all' || selectedMachine !== 'all' || selectedRole !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedModule('all');
                  setSelectedMachine('all');
                  setSelectedRole('all');
                  setFilterStartDate('');
                  setFilterEndDate('');
                }}
                className="px-2 py-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 hover:underline"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Table / Data View */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                <th className="p-3.5 w-10 text-center">
                  <button 
                    onClick={toggleSelectAll}
                    className="text-slate-400 hover:text-slate-700"
                    title="Select All"
                  >
                    {selectedIds.size === filteredRecords.length && filteredRecords.length > 0 ? (
                      <CheckSquare size={16} className="text-indigo-600" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th className="p-3.5">Module / Type</th>
                <th className="p-3.5">Item Summary / Key Details</th>
                <th className="p-3.5">Machine / Company</th>
                <th className="p-3.5">Deleted At</th>
                <th className="p-3.5">Deleted By & Role</th>
                <th className="p-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
              {filteredRecords.map((record) => {
                const isSelected = selectedIds.has(record.id);

                return (
                  <tr 
                    key={record.id} 
                    className={`hover:bg-slate-50/60 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}
                  >
                    {/* Checkbox */}
                    <td className="p-3.5 text-center align-top">
                      <button 
                        onClick={() => toggleSelect(record.id)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        {isSelected ? (
                          <CheckSquare size={16} className="text-indigo-600" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    </td>

                    {/* Module Badge */}
                    <td className="p-3.5 align-top whitespace-nowrap">
                      <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg border inline-block uppercase tracking-tight ${
                        record.moduleName === 'PME Records' ? 'bg-cyan-50 text-cyan-800 border-cyan-200' :
                        record.moduleName === 'Award Records' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                        'bg-slate-100 text-slate-800 border-slate-200'
                      }`}>
                        {record.moduleName}
                      </span>
                      <div className="text-[9.5px] font-mono text-slate-400 mt-1">
                        col: {record.originalCollection}
                      </div>
                    </td>

                    {/* Item Summary */}
                    <td className="p-3.5 align-top min-w-[280px]">
                      <div className="font-bold text-slate-900 text-xs leading-snug">
                        {record.itemSummary}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        ID: {record.originalId}
                      </div>
                    </td>

                    {/* Machine / Company */}
                    <td className="p-3.5 align-top whitespace-nowrap">
                      {record.machineName ? (
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-md border border-indigo-100 inline-block uppercase">
                          {record.machineName}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                      {record.companyName && (
                        <div className="text-[10px] text-slate-500 font-bold mt-1">
                          {record.companyName}
                        </div>
                      )}
                    </td>

                    {/* Deleted Date/Time */}
                    <td className="p-3.5 align-top whitespace-nowrap font-mono text-slate-600">
                      <div className="text-slate-900 font-bold text-[11px]">
                        {record.deletedAt ? formatDateToDDMMYYYY(record.deletedAt) : '-'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {record.deletedAt ? new Date(record.deletedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </td>

                    {/* Deleted By & Role */}
                    <td className="p-3.5 align-top whitespace-nowrap">
                      <div className="font-bold text-slate-900 text-xs">
                        {record.deletedByName}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9.5px] font-black px-1.5 py-0.5 rounded ${
                          record.deletedByRole.includes('Primary') || record.deletedByRole.includes('Master')
                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                            : record.deletedByRole.includes('Company')
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {record.deletedByRole}
                        </span>
                        {record.deletedByEmail && (
                          <span className="text-[9.5px] text-slate-400 font-mono truncate max-w-[130px]" title={record.deletedByEmail}>
                            {record.deletedByEmail}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="p-3.5 align-top whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Inspect Snapshot */}
                        <button
                          onClick={() => setViewingRecord(record)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-slate-200/80"
                          title="Inspect Data Snapshot"
                        >
                          <Eye size={14} />
                        </button>

                        {/* One-click Restore */}
                        <button
                          onClick={() => handleRestore(record)}
                          disabled={isProcessing}
                          className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-black rounded-lg border border-emerald-200 transition-all flex items-center gap-1 shadow-2xs active:scale-95 disabled:opacity-50"
                          title="Restore back to original module"
                        >
                          <RotateCcw size={12} /> Restore
                        </button>

                        {/* Permanent Purge */}
                        <button
                          onClick={() => handlePermanentDelete(record)}
                          disabled={isProcessing}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                          title="Permanently Delete (Cannot be undone)"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RotateCcw size={28} className="stroke-[1.5] text-slate-300" />
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        No deleted records found in Recycle Bin
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-sm">
                        Whenever any employee or admin deletes data from any module, it will be safely archived here for instant recovery.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Inspect Data Snapshot Modal */}
      <AnimatePresence>
        {viewingRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                    <Eye size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Deleted Record Snapshot Details
                    </h3>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {viewingRecord.moduleName} • ID: {viewingRecord.originalId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewingRecord(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* Meta summary card */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Target Module</span>
                    <span className="font-bold text-slate-800">{viewingRecord.moduleName}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Target Collection</span>
                    <span className="font-mono font-bold text-indigo-700">{viewingRecord.originalCollection}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Machine Name</span>
                    <span className="font-bold text-slate-800">{viewingRecord.machineName || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Deleted By</span>
                    <span className="font-bold text-slate-800">{viewingRecord.deletedByName}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Role</span>
                    <span className="font-bold text-slate-800">{viewingRecord.deletedByRole}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Deleted Timestamp</span>
                    <span className="font-mono text-slate-700 font-bold">{new Date(viewingRecord.deletedAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Sub-record Details (PME / Award) */}
                {viewingRecord.data?.isSubRecord && viewingRecord.data?.subRecord && (
                  <div className="p-4 bg-purple-50/70 rounded-xl border border-purple-200 space-y-2.5">
                    <h4 className="text-xs font-black text-purple-900 uppercase tracking-wide flex items-center gap-1.5">
                      {viewingRecord.data.subRecordType === 'pme' ? '🩺 PME Entry Details (पी.एम.ई विवरण)' : '🏆 Award Entry Details (पुरस्कार विवरण)'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px] bg-white p-3 rounded-lg border border-purple-100">
                      <div>
                        <span className="text-slate-400 font-bold uppercase block text-[9px]">Employee Name & PF</span>
                        <span className="font-black text-slate-800">{viewingRecord.data.employeeName || 'Staff'} (PF: {viewingRecord.data.pfNo || 'N/A'})</span>
                      </div>
                      {viewingRecord.data.subRecordType === 'pme' ? (
                        <>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Medical Category</span>
                            <span className="font-black text-cyan-800">{viewingRecord.data.subRecord.medicalCategory} ({viewingRecord.data.subRecord.fitnessStatus || 'Fit'})</span>
                          </div>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Exam Date</span>
                            <span className="font-bold text-slate-700">{formatDateToDDMMYYYY(viewingRecord.data.subRecord.examDate) || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Hospital / Place</span>
                            <span className="font-bold text-slate-700">{viewingRecord.data.subRecord.hospital || 'N/A'}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Award Title</span>
                            <span className="font-black text-amber-800">{viewingRecord.data.subRecord.title}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Award Date</span>
                            <span className="font-bold text-slate-700">{formatDateToDDMMYYYY(viewingRecord.data.subRecord.date) || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 font-bold uppercase block text-[9px]">Authority / Occasion</span>
                            <span className="font-bold text-slate-700">{viewingRecord.data.subRecord.authority || viewingRecord.data.subRecord.occasion || 'N/A'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Raw Document Payload */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                    Archived Document JSON Payload (Ready to Restore)
                  </label>
                  <pre className="p-3.5 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-[300px] leading-relaxed border border-slate-800">
                    {JSON.stringify(viewingRecord.data, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handlePermanentDelete(viewingRecord)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors"
                >
                  Purge Permanently
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewingRecord(null)}
                    className="px-4 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(viewingRecord)}
                    disabled={isProcessing}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl border border-emerald-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    <RotateCcw size={14} /> Restore Record Now
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Confirm Empty Bin Modal */}
      <AnimatePresence>
        {confirmEmptyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 font-bold shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Empty Recycle Bin?</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    This will permanently delete all {records.length} archived records. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfirmEmptyModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEmptyAll}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl border border-rose-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                >
                  <Trash2 size={14} /> Yes, Empty Everything
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
