import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy, doc, getDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { Download, Search, Filter, FileText, ArrowUpCircle, ArrowDownCircle, History, Loader2, Edit, Trash2, X, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}

interface Transaction {
  id: string;
  partId: string;
  type: 'received' | 'issued' | 'old_stock';
  qty: number;
  date: string;
  receiverName?: string;
  remarks?: string;
  details?: string;
  voucherNo?: string;
  demandNo?: string;
  partInfo?: {
    plNo: string;
    description: string;
    machineName?: string;
  };
  machineName?: string;
}

import { findEmployeeForUser } from '../utils/employee';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';

export default function Report() {
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessType === 'full' || userAccessType === 'admin-light';
  });
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });

  const [selectedMachine, setSelectedMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      const savedM = localStorage.getItem(`userMachineName_${auth.currentUser.uid}`);
      if (savedM) return savedM;
    }
    return 'all';
  });
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);
  const [customMachines, setCustomMachines] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const allMachinesList = useMemo(() => {
    const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    return Array.from(new Set([...defaultList, ...settingsMachines, ...customMachines])).filter(Boolean).sort();
  }, [settingsMachines, customMachines]);
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const mapping: Record<string, { zone: string; division: string }> = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.machineName) {
          mapping[data.machineName] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setMachinePositions(mapping);
    });
    return () => unsub();
  }, []);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });

  useEffect(() => {
    const checkAccess = async () => {
      if (!auth.currentUser) return;
      const isEmployee = auth.currentUser.email?.endsWith('@employee.billedapp.com');
      if (isEmployee) {
        const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
        if (emp) {
          const isFull = emp.accessType === 'full' || emp.accessType === 'admin-light';
          localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
          setUserAccessType(emp.accessType || 'limited');
          setIsAdmin(isFull);
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
          if (mName) {
            setSelectedMachine(mName);
          }
        }
      }
    };
    checkAccess();
  }, []);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'received' | 'issued'>('all');
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<string | null>(null);
  const [editTransactionData, setEditTransactionData] = useState<Transaction>({
    id: '',
    partId: '',
    type: 'received',
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    remarks: '',
    details: '',
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchTransactions();
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [filterType, dateRange]);

  const fetchTransactions = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      // Fetch all employees to get companies mapping
      const empSnapshot = await getDocs(collection(db, 'employees'));
      const empList = empSnapshot.docs.map(doc => doc.data());
      setEmployeeList(empList);
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      let q = query(
        collection(db, 'transactions'),
        where('date', '>=', dateRange.start),
        where('date', '<=', dateRange.end),
        orderBy('date', 'desc')
      );

      let querySnapshot;
      try {
        querySnapshot = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'transactions');
        return;
      }

      let transList = await Promise.all(querySnapshot.docs.map(async (transDoc) => {
        const data = transDoc.data() as Transaction;
        let partData: any = null;
        if (data.partId) {
          try {
            const partSnap = await getDoc(doc(db, 'parts', data.partId));
            if (partSnap.exists()) {
              partData = partSnap.data();
            }
          } catch (error) {
            console.warn(`Part fetch failed for ${data.partId}:`, error);
          }
        }
        const partMachine = data.machineName || (partData ? partData.machineName || '' : '');
        return {
          id: transDoc.id,
          ...data,
          machineName: partMachine,
          partInfo: partData ? { plNo: partData.plNo, description: partData.description, machineName: partMachine } : undefined
        };
      }));

      // Filter in-memory by type to group 'old_stock' under 'received'
      if (filterType === 'received') {
        transList = transList.filter(t => t.type === 'received' || t.type === 'old_stock');
      } else if (filterType === 'issued') {
        transList = transList.filter(t => t.type === 'issued');
      }

      // Extract custom machines from transactions list
      const uniqueMachines = Array.from(new Set(transList.map(t => t.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setTransactions(transList);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const transRef = doc(db, 'transactions', editTransactionData.id);
      await updateDoc(transRef, {
        qty: editTransactionData.qty,
        date: editTransactionData.date,
        remarks: editTransactionData.remarks || '',
        details: editTransactionData.details || '',
      });
      toast.success('Transaction updated successfully');
      setShowEditModal(false);
      fetchTransactions();
    } catch (error) {
      console.error('Error editing transaction:', error);
      toast.error('Failed to update transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!transactionToDelete) return;
    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'transactions', transactionToDelete));
      toast.success('Transaction deleted successfully');
      setShowDeleteModal(false);
      setTransactionToDelete(null);
      fetchTransactions();
    } catch (error) {
      console.error('Error deleting transaction:', error);
      toast.error('Failed to delete transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredTransactions = transactions.filter(t => {
    // Zone & Division Filters
    if (filterZone !== 'all') {
      const pos = machinePositions[t.machineName || ''];
      if (!pos || pos.zone !== filterZone) return false;
    }

    if (filterDivision !== 'all') {
      const pos = machinePositions[t.machineName || ''];
      if (!pos || pos.division !== filterDivision) return false;
    }

    // Apply company filter constraint
    if (!isEmployee && selectedCompany !== 'all') {
      const companyEmployees = employeeList.filter(e => e.companyName === selectedCompany);
      const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
      if (!t.machineName || !companyMachines.has(t.machineName)) {
        return false;
      }
    }
    if (isEmployee) {
      const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
        const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
        if (t.machineName && companyMachines.size > 0 && !companyMachines.has(t.machineName)) {
          return false;
        }
      }

      if (userAccessType === 'admin-light') {
        if (selectedMachine !== 'all') {
          return t.machineName === selectedMachine;
        }
      } else {
        const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (myMachine) {
          if (!t.machineName || t.machineName !== myMachine) {
            return false;
          }
        } else if (selectedMachine !== 'all') {
          return t.machineName === selectedMachine;
        }
      }
    } else {
      if (selectedMachine !== 'all') {
        return t.machineName === selectedMachine;
      }
    }
    return true;
  });

  const exportToExcel = () => {
    const dataToExport = filteredTransactions.map(t => ({
      Date: t.date,
      Type: t.type.toUpperCase(),
      'PL No.': t.partInfo?.plNo || 'N/A',
      Description: t.partInfo?.description || 'N/A',
      Quantity: t.qty,
      Receiver: t.receiverName || '-',
      Remarks: t.remarks || '-',
      Machine: t.machineName || 'General',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `Transaction_Report_${dateRange.start}_to_${dateRange.end}.xlsx`);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">Report Module</h1>
          {isEmployee ? (
            <div className="flex flex-wrap items-center gap-2">
              {localStorage.getItem(`companyName_${auth.currentUser?.uid}`) && (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-1 rounded-full font-bold">
                  Company: {localStorage.getItem(`companyName_${auth.currentUser?.uid}`)}
                </span>
              )}
              {userAccessType === 'admin-light' ? (
                <select
                  className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                  value={selectedMachine}
                  onChange={e => setSelectedMachine(e.target.value)}
                >
                  <option value="all">All Company Machines</option>
                  {Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean))).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                userMachine && (
                  <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded-full font-bold">
                    Machine: {userMachine}
                  </span>
                )
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(!isEmployee || userAccessType === 'admin-light') && (
                <>
                  <select
                    className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                    value={filterZone}
                    onChange={(e) => {
                      setFilterZone(e.target.value);
                      setFilterDivision('all');
                    }}
                  >
                    <option value="all">All Zones</option>
                    {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>

                  <select
                    className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in disabled:opacity-50"
                    value={filterDivision}
                    disabled={filterZone === 'all'}
                    onChange={(e) => setFilterDivision(e.target.value)}
                  >
                    <option value="all">All Divisions</option>
                    {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </>
              )}

              {(!isEmployee || userAccessType === 'admin-light') && (
                <>
                  {!isEmployee && (
                    <select
                      className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                      value={selectedCompany}
                      onChange={e => setSelectedCompany(e.target.value)}
                    >
                      <option value="all">All Companies</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                  <select
                    className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                    value={selectedMachine}
                    onChange={e => setSelectedMachine(e.target.value)}
                  >
                    <option value="all">All Machines</option>
                    {(isEmployee && userAccessType === 'admin-light'
                      ? Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                      : allMachinesList
                    ).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 active:scale-95"
        >
          <Download size={20} /> Export Excel
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-white p-6 rounded-lg shadow-sm border border-outline-variant/10 space-y-4"
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-bold uppercase text-secondary mb-1">Start Date</label>
            <input
              type="date"
              className="border border-outline/20 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={dateRange.start}
              onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-secondary mb-1">End Date</label>
            <input
              type="date"
              className="border border-outline/20 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={dateRange.end}
              onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-secondary mb-1">Type</label>
            <select
              className="border border-outline/20 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={filterType}
              onChange={e => setFilterType(e.target.value as any)}
            >
              <option value="all">All Transactions</option>
              <option value="received">Inward (Received)</option>
              <option value="issued">Outward (Issued)</option>
            </select>
          </div>
          <button
            onClick={fetchTransactions}
            className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Filter size={18} />}
            Apply Filters
          </button>
        </div>
      </motion.div>
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
      <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-x-auto">
        <table className="w-full text-left min-w-[900px]">
          <thead className="bg-surface-container-highest">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Date</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Voucher No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Type</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">PL No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Description</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Qty</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Receiver/Details</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Machine</th>
              {!isEmployee && <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            <AnimatePresence mode="popLayout">
              {filteredTransactions.map((t, idx) => (
                <motion.tr 
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: idx * 0.03 }}
                  key={t.id} 
                  className="hover:bg-surface-container-low transition-colors"
                >
                  <td className="px-6 py-4 text-sm">{t.date}</td>
                  <td className="px-6 py-4 text-xs font-mono font-bold text-indigo-800">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 inline-block whitespace-nowrap">
                      {t.voucherNo || t.demandNo || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className={cn(
                      "flex items-center gap-2 text-[10px] font-black uppercase",
                      (t.type === 'received' || t.type === 'old_stock') ? "text-green-600" :
                      t.type === 'issued' ? "text-blue-600" : "text-gray-600"
                    )}>
                      {(t.type === 'received' || t.type === 'old_stock') && <ArrowUpCircle size={14} />}
                      {t.type === 'issued' && <ArrowDownCircle size={14} />}
                      {t.type === 'old_stock' ? 'received' : t.type.replace('_', ' ')}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono font-bold text-primary">{t.partInfo?.plNo || 'N/A'}</td>
                  <td className="px-6 py-4 text-sm max-w-xs truncate">{t.partInfo?.description || 'N/A'}</td>
                  <td className="px-6 py-4 text-sm font-bold">{t.qty}</td>
                  <td className="px-6 py-4 text-xs text-on-surface-variant">
                    {t.type === 'issued' ? (
                      <div>
                        <div className="font-bold text-indigo-950">Issue to Remarks: {t.remarks || t.details?.replace('Issued to: ', '') || '-'}</div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {t.details && <div className="font-bold text-indigo-950">{t.details}</div>}
                        {t.remarks && <div className="font-semibold text-slate-600">Remarks: {t.remarks}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-indigo-700">{t.machineName || 'General'}</td>
                  {!isEmployee && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1.5 items-center">
                        <button
                          onClick={() => {
                            setEditTransactionData({
                              id: t.id,
                              partId: t.partId,
                              type: t.type,
                              qty: t.qty,
                              date: t.date,
                              remarks: t.remarks || '',
                              details: t.details || '',
                            });
                            setShowEditModal(true);
                          }}
                          className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center"
                          title="Edit Transaction"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => {
                            setTransactionToDelete(t.id);
                            setShowDeleteModal(true);
                          }}
                          className="p-2 text-red-400 hover:text-red-600 transition-colors flex items-center justify-center"
                          title="Delete Transaction"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              ))}
            </AnimatePresence>
            {filteredTransactions.length === 0 && !loading && (
              <tr>
                <td colSpan={!isEmployee ? 8 : 7} className="px-6 py-20 text-center text-outline italic">No transactions found for the selected criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* Edit Transaction Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Edit Transaction Log</h2>
              <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditTransaction} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity</label>
                <input
                  type="number"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editTransactionData.qty}
                  onChange={e => setEditTransactionData({ ...editTransactionData, qty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                <input
                  type="date"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editTransactionData.date}
                  onChange={e => setEditTransactionData({ ...editTransactionData, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editTransactionData.remarks || ''}
                  onChange={e => setEditTransactionData({ ...editTransactionData, remarks: e.target.value })}
                  placeholder="Enter remarks"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Details</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editTransactionData.details || ''}
                  onChange={e => setEditTransactionData({ ...editTransactionData, details: e.target.value })}
                  placeholder="Transaction details"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Save Changes
                </button>
              </div>
            </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Transaction Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Confirm Delete</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-on-surface-variant">
                Are you sure you want to delete this transaction log? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteTransaction}
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Confirm Delete
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </motion.div>
  );
}
