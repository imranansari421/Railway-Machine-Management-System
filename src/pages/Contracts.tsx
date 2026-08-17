import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { MachineContract } from '../utils/contracts';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { findEmployeeForUser } from '../utils/employee';
import { 
  Building2, 
  Cpu, 
  FileText, 
  Plus, 
  ArrowRightLeft, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  History,
  Calendar,
  X,
  Loader2,
  Edit2,
  Trash2,
  Save,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export default function Contracts() {
  const [contracts, setContracts] = useState<MachineContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [allMachines, setAllMachines] = useState<string[]>([]);

  // User & Admin Role State
  const [userRole, setUserRole] = useState<'admin' | 'admin-light' | 'full' | 'limited'>('limited');
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const isAdmin = !isEmployee || userRole === 'admin' || userRole === 'admin-light';

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<MachineContract | null>(null);

  // Edit and Delete Modals for Admin
  const [editingContract, setEditingContract] = useState<MachineContract | null>(null);
  const [contractToDelete, setContractToDelete] = useState<MachineContract | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Form States
  const [newContractForm, setNewContractForm] = useState({
    contractNo: `CNT-${format(new Date(), 'yyyy')}-${Math.floor(1000 + Math.random() * 9000)}`,
    machineName: '',
    companyName: '',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    remarks: ''
  });

  const [transferForm, setTransferForm] = useState({
    newCompanyName: '',
    transferDate: format(new Date(), 'yyyy-MM-dd'),
    newContractNo: `CNT-${format(new Date(), 'yyyy')}-${Math.floor(1000 + Math.random() * 9000)}`,
    newEndDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    remarks: ''
  });

  const [extendForm, setExtendForm] = useState({
    newEndDate: '',
    updatedContractNo: '',
    remarks: ''
  });

  const [editForm, setEditForm] = useState({
    contractNo: '',
    machineName: '',
    companyName: '',
    startDate: '',
    endDate: '',
    status: 'active' as 'active' | 'transferred' | 'expired',
    transferredToCompany: '',
    transferDate: '',
    remarks: ''
  });

  // Fetch Current User Role
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!auth.currentUser) return;
      try {
        if (!isEmployee) {
          setUserRole('admin');
        } else {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          if (emp) {
            setUserRole((emp.accessType as any) || 'limited');
          }
        }
      } catch (err) {
        console.error('Error determining role in Contracts:', err);
      }
    };
    fetchUserRole();
  }, [isEmployee]);

  // Fetch Contracts, Companies, and Machines
  useEffect(() => {
    const unsubContracts = onSnapshot(collection(db, 'machine_contracts'), (snapshot) => {
      const list: MachineContract[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as MachineContract);
      });
      // Sort by createdAt descending
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setContracts(list);
      setLoading(false);
    }, (error) => {
      console.error('Error listening to machine_contracts:', error);
      setLoading(false);
    });

    // Fetch Employees to populate company list
    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      const cos = new Set<string>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.companyName) cos.add(data.companyName);
      });
      setCompaniesList(Array.from(cos).sort());
    });

    // Fetch Machines from settings & parts
    const unsubSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      if (docSnap.exists() && Array.isArray(docSnap.data()?.machines)) {
        setAllMachines(Array.from(new Set([...defaultList, ...docSnap.data().machines])).sort());
      } else {
        setAllMachines(defaultList);
      }
    });

    return () => {
      unsubContracts();
      unsubEmployees();
      unsubSettings();
    };
  }, []);

  // Compute Active Contracts per Company
  const companyActiveMap = useMemo(() => {
    const map: Record<string, MachineContract[]> = {};
    companiesList.forEach(c => { map[c] = []; });
    
    contracts.forEach(c => {
      if (c.status === 'active') {
        if (!map[c.companyName]) map[c.companyName] = [];
        map[c.companyName].push(c);
      }
    });
    return map;
  }, [contracts, companiesList]);

  // List of machines that currently have an active contract
  const activeMachineNames = useMemo(() => {
    const set = new Set<string>();
    contracts.forEach(c => {
      if (c.status === 'active') set.add(c.machineName);
    });
    return set;
  }, [contracts]);

  // Filtered Contracts List
  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      const search = searchTerm.toLowerCase();
      const matchesSearch = (c.contractNo || '').toLowerCase().includes(search) ||
                            (c.machineName || '').toLowerCase().includes(search) ||
                            (c.companyName || '').toLowerCase().includes(search) ||
                            (c.remarks || '').toLowerCase().includes(search);
      if (!matchesSearch) return false;

      if (selectedCompanyFilter !== 'all' && c.companyName !== selectedCompanyFilter) return false;
      if (selectedStatusFilter !== 'all' && c.status !== selectedStatusFilter) return false;

      return true;
    });
  }, [contracts, searchTerm, selectedCompanyFilter, selectedStatusFilter]);

  // Handle Create Contract
  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContractForm.machineName || !newContractForm.companyName || !newContractForm.contractNo) {
      toast.error('Please fill in all required fields.');
      return;
    }

    // Check if machine is ALREADY assigned under an active contract
    if (activeMachineNames.has(newContractForm.machineName)) {
      const activeContract = contracts.find(c => c.machineName === newContractForm.machineName && c.status === 'active');
      toast.error(`Machine "${newContractForm.machineName}" is already actively assigned to "${activeContract?.companyName}" under Contract No. ${activeContract?.contractNo}. Please transfer it instead.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload: Omit<MachineContract, 'id'> = {
        contractNo: newContractForm.contractNo.trim(),
        machineName: newContractForm.machineName.trim(),
        companyName: newContractForm.companyName.trim(),
        startDate: newContractForm.startDate,
        endDate: newContractForm.endDate,
        status: 'active',
        remarks: newContractForm.remarks.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'machine_contracts'), payload);
      toast.success(`Machine ${payload.machineName} contracted to ${payload.companyName} successfully!`);
      setShowCreateModal(false);
      setNewContractForm({
        contractNo: `CNT-${format(new Date(), 'yyyy')}-${Math.floor(1000 + Math.random() * 9000)}`,
        machineName: '',
        companyName: '',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
        remarks: ''
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'machine_contracts');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Transfer Machine
  const handleTransferMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract || !transferForm.newCompanyName) {
      toast.error('Please select the target company for transfer.');
      return;
    }

    if (transferForm.newCompanyName === selectedContract.companyName) {
      toast.error('Target company cannot be the same as the current company.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Mark existing contract as 'transferred'
      if (selectedContract.id) {
        const oldRef = doc(db, 'machine_contracts', selectedContract.id);
        await updateDoc(oldRef, {
          status: 'transferred',
          transferredToCompany: transferForm.newCompanyName.trim(),
          transferDate: transferForm.transferDate,
          endDate: transferForm.transferDate, // Contract ends on transfer date
          updatedAt: new Date().toISOString(),
          remarks: `${selectedContract.remarks ? selectedContract.remarks + ' | ' : ''}Transferred to ${transferForm.newCompanyName} on ${transferForm.transferDate}.`
        });
      }

      // 2. Create new active contract for target company
      const newPayload: Omit<MachineContract, 'id'> = {
        contractNo: transferForm.newContractNo.trim(),
        machineName: selectedContract.machineName,
        companyName: transferForm.newCompanyName.trim(),
        startDate: transferForm.transferDate,
        endDate: transferForm.newEndDate,
        status: 'active',
        remarks: `Transferred from ${selectedContract.companyName} (Prev Contract: ${selectedContract.contractNo}). ${transferForm.remarks}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'machine_contracts'), newPayload);

      toast.success(`Machine ${selectedContract.machineName} transferred from ${selectedContract.companyName} to ${transferForm.newCompanyName}!`);
      setShowTransferModal(false);
      setSelectedContract(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `machine_contracts/${selectedContract?.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Extend / Renew Contract
  const handleExtendContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract || !extendForm.newEndDate) {
      toast.error('Please provide the new contract end date.');
      return;
    }

    setSubmitting(true);
    try {
      if (selectedContract.id) {
        const contractRef = doc(db, 'machine_contracts', selectedContract.id);
        const updates: Partial<MachineContract> = {
          endDate: extendForm.newEndDate,
          status: 'active', // Reactivate if it was expired
          updatedAt: new Date().toISOString()
        };

        if (extendForm.updatedContractNo.trim()) {
          updates.contractNo = extendForm.updatedContractNo.trim();
        }

        if (extendForm.remarks.trim()) {
          updates.remarks = `${selectedContract.remarks ? selectedContract.remarks + ' | ' : ''}Renewed/Extended to ${extendForm.newEndDate}. ${extendForm.remarks}`;
        }

        await updateDoc(contractRef, updates);
        toast.success(`Contract ${selectedContract.contractNo} extended to ${extendForm.newEndDate}!`);
        setShowExtendModal(false);
        setSelectedContract(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `machine_contracts/${selectedContract?.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Admin Edit Contract
  const handleEditContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContract || !editingContract.id) return;
    if (!isAdmin) {
      toast.error('Only Admins have permission to edit contracts.');
      return;
    }

    if (!editForm.contractNo.trim() || !editForm.machineName.trim() || !editForm.companyName.trim()) {
      toast.error('Contract No, Machine Name, and Company Name are required.');
      return;
    }

    // Check if machine is being set to another machine that already has an active contract elsewhere
    if (editForm.status === 'active') {
      const conflictingContract = contracts.find(c => 
        c.id !== editingContract.id && 
        c.machineName.toLowerCase() === editForm.machineName.trim().toLowerCase() && 
        c.status === 'active'
      );
      if (conflictingContract) {
        toast.error(`Machine "${editForm.machineName}" is already actively contracted to "${conflictingContract.companyName}" under ${conflictingContract.contractNo}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const contractRef = doc(db, 'machine_contracts', editingContract.id);
      const updates: Partial<MachineContract> = {
        contractNo: editForm.contractNo.trim(),
        machineName: editForm.machineName.trim(),
        companyName: editForm.companyName.trim(),
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        status: editForm.status,
        remarks: editForm.remarks.trim(),
        updatedAt: new Date().toISOString()
      };

      if (editForm.status === 'transferred') {
        updates.transferredToCompany = editForm.transferredToCompany.trim();
        updates.transferDate = editForm.transferDate || format(new Date(), 'yyyy-MM-dd');
      }

      await updateDoc(contractRef, updates);
      toast.success(`Contract "${updates.contractNo}" updated successfully!`);
      setEditingContract(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `machine_contracts/${editingContract.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Admin Delete Contract
  const handleDeleteContract = async () => {
    if (!contractToDelete || !contractToDelete.id) return;
    if (!isAdmin) {
      toast.error('Only Admins have permission to delete contracts.');
      return;
    }

    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'machine_contracts', contractToDelete.id));
      toast.success(`Contract ${contractToDelete.contractNo} deleted successfully.`);
      setContractToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `machine_contracts/${contractToDelete.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (c: MachineContract) => {
    setEditingContract(c);
    setEditForm({
      contractNo: c.contractNo || '',
      machineName: c.machineName || '',
      companyName: c.companyName || '',
      startDate: c.startDate || '',
      endDate: c.endDate || '',
      status: c.status || 'active',
      transferredToCompany: c.transferredToCompany || '',
      transferDate: c.transferDate || '',
      remarks: c.remarks || ''
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto pb-24"
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 sm:p-6 rounded-2xl shadow-xs border border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
              <FileText size={22} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Machine Contracts & Transfers</h1>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                मशीन अनुबंध प्रबंधन, कंपनी ट्रांसफर एवं समयावधि विस्तार (Renew / Extend)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
          {isAdmin && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-bold">
              <ShieldCheck size={14} className="text-indigo-600" />
              <span>Admin Access</span>
            </span>
          )}
          <button
            onClick={() => {
              setNewContractForm({
                contractNo: `CNT-${format(new Date(), 'yyyy')}-${Math.floor(1000 + Math.random() * 9000)}`,
                machineName: '',
                companyName: '',
                startDate: format(new Date(), 'yyyy-MM-dd'),
                endDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
                remarks: ''
              });
              setShowCreateModal(true);
            }}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl shadow-xs transition-all active:scale-95 text-xs cursor-pointer whitespace-nowrap"
          >
            <Plus size={16} />
            <span>New Contract (नया अनुबंध)</span>
          </button>
        </div>
      </div>

      {/* Companies Overview & Current Machine Counts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
            <Building2 size={16} className="text-indigo-600" /> Company-Wise Active Contracts (वर्तमान में अनुबंधित मशीनें)
          </h2>
          <span className="text-[11px] font-bold text-slate-400">
            {companiesList.length} Companies registered
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {companiesList.length === 0 ? (
            <div className="col-span-full p-6 text-center text-xs text-slate-500 italic bg-white rounded-xl border border-slate-200">
              No companies registered yet.
            </div>
          ) : (
            companiesList.map(comp => {
              const activeCount = companyActiveMap[comp]?.length || 0;
              const activeMachinesList = companyActiveMap[comp]?.map(c => c.machineName) || [];
              const isSelected = selectedCompanyFilter === comp;

              return (
                <div 
                  key={comp}
                  className={`bg-white rounded-xl p-4 border transition-all flex flex-col justify-between ${
                    isSelected 
                      ? 'border-indigo-500 ring-2 ring-indigo-500/10 shadow-sm' 
                      : 'border-slate-200 shadow-2xs hover:border-slate-300 hover:shadow-xs'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-black text-slate-900 text-sm leading-snug break-words flex-1">
                        {comp}
                      </div>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                        activeCount > 0 
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {activeCount} {activeCount === 1 ? 'Machine' : 'Machines'}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Assigned Machines:
                      </div>
                      {activeMachinesList.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {activeMachinesList.map(m => (
                            <span 
                              key={m} 
                              className="bg-indigo-50 text-indigo-700 font-bold text-[10px] px-2 py-0.5 rounded-md border border-indigo-100 whitespace-nowrap"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic">No active contracts</div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={() => {
                        if (selectedCompanyFilter === comp) {
                          setSelectedCompanyFilter('all');
                        } else {
                          setSelectedCompanyFilter(comp);
                          setSelectedStatusFilter('all');
                        }
                      }}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>{selectedCompanyFilter === comp ? 'Clear Filter' : 'Filter Records'}</span>
                      <History size={13} />
                    </button>
                    {selectedCompanyFilter === comp && (
                      <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Active Filter</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Contracts Management Table Section */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {/* Filters & Search Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search Contract No, Machine, Company, Remarks..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium text-slate-800"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <select
              value={selectedCompanyFilter}
              onChange={e => setSelectedCompanyFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 flex-1 md:flex-none cursor-pointer"
            >
              <option value="all">All Companies ({companiesList.length})</option>
              {companiesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={selectedStatusFilter}
              onChange={e => setSelectedStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 flex-1 md:flex-none cursor-pointer"
            >
              <option value="all">All Statuses (सभी)</option>
              <option value="active">Active (सक्रिय)</option>
              <option value="transferred">Transferred (ट्रांसफर)</option>
              <option value="expired">Expired (समाप्त)</option>
            </select>

            {(selectedCompanyFilter !== 'all' || selectedStatusFilter !== 'all' || searchTerm !== '') && (
              <button
                onClick={() => {
                  setSelectedCompanyFilter('all');
                  setSelectedStatusFilter('all');
                  setSearchTerm('');
                }}
                className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-200/70 hover:bg-slate-200 rounded-xl flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Contracts List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-black text-[10px]">
                <th className="p-3.5 whitespace-nowrap">Contract No</th>
                <th className="p-3.5 whitespace-nowrap">Machine</th>
                <th className="p-3.5 min-w-[170px]">Company</th>
                <th className="p-3.5 whitespace-nowrap">Contract Period</th>
                <th className="p-3.5 whitespace-nowrap">Status</th>
                <th className="p-3.5 min-w-[200px] max-w-xs">Remarks / Transfer Details</th>
                <th className="p-3.5 text-right whitespace-nowrap min-w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400">
                    <Loader2 className="animate-spin inline-block mr-2 text-indigo-600" size={20} />
                    <span>Loading machine contracts...</span>
                  </td>
                </tr>
              ) : filteredContracts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400 italic">
                    No machine contracts found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredContracts.map(c => {
                  const isExpired = c.status === 'active' && new Date(c.endDate) < new Date();
                  return (
                    <tr key={c.id || c.contractNo} className="hover:bg-slate-50/90 transition-colors">
                      {/* Contract No */}
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="font-mono font-black text-indigo-950 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100/80 text-xs">
                          {c.contractNo}
                        </span>
                      </td>

                      {/* Machine */}
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg font-bold border border-slate-200/70 inline-flex items-center gap-1 text-xs">
                          <Cpu size={12} className="text-slate-500" />
                          <span>{c.machineName}</span>
                        </span>
                      </td>

                      {/* Company */}
                      <td className="p-3.5 min-w-[170px]">
                        <div className="font-bold text-slate-900 leading-snug break-words">
                          {c.companyName}
                        </div>
                      </td>

                      {/* Period */}
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1 text-[11px]">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-9">From:</span>
                            <span className="font-semibold text-slate-700">{c.startDate || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-9">To:</span>
                            <span className={`font-black ${isExpired ? "text-red-600" : "text-slate-900"}`}>
                              {c.endDate || '—'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-3.5 whitespace-nowrap">
                        {c.status === 'active' ? (
                          isExpired ? (
                            <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase border border-red-200/80">
                              <AlertCircle size={12} className="text-red-600 shrink-0" />
                              <span>Expired</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase border border-emerald-200/80">
                              <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                              <span>Active</span>
                            </span>
                          )
                        ) : c.status === 'transferred' ? (
                          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase border border-blue-200/80">
                            <ArrowRightLeft size={12} className="text-blue-600 shrink-0" />
                            <span>Transferred</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase border border-slate-200">
                            <Clock size={12} className="text-slate-500 shrink-0" />
                            <span>Expired</span>
                          </span>
                        )}
                      </td>

                      {/* Remarks / Transfer Details */}
                      <td className="p-3.5 text-slate-600 min-w-[200px] max-w-xs text-[11px] leading-relaxed break-words">
                        <div>{c.remarks || '—'}</div>
                        {c.transferredToCompany && (
                          <div className="mt-1 p-1.5 bg-blue-50/80 rounded-md border border-blue-100 text-[10px] text-blue-800 font-semibold leading-tight">
                            Transferred to <strong className="font-black text-blue-900">{c.transferredToCompany}</strong> on {c.transferDate || '—'}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-right whitespace-nowrap min-w-[220px]">
                        <div className="flex items-center justify-end gap-1.5">
                          {c.status === 'active' && (
                            <button
                              onClick={() => {
                                setSelectedContract(c);
                                setTransferForm({
                                  newCompanyName: '',
                                  transferDate: format(new Date(), 'yyyy-MM-dd'),
                                  newContractNo: `CNT-${format(new Date(), 'yyyy')}-${Math.floor(1000 + Math.random() * 9000)}`,
                                  newEndDate: format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
                                  remarks: ''
                                });
                                setShowTransferModal(true);
                              }}
                              className="px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold border border-blue-200/70 inline-flex items-center gap-1 transition-all cursor-pointer"
                              title="Transfer machine to another company"
                            >
                              <ArrowRightLeft size={13} />
                              <span>Transfer</span>
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedContract(c);
                              setExtendForm({
                                newEndDate: c.endDate || '',
                                updatedContractNo: c.contractNo || '',
                                remarks: ''
                              });
                              setShowExtendModal(true);
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-bold border border-slate-200 inline-flex items-center gap-1 transition-all cursor-pointer"
                            title="Renew or extend contract end date"
                          >
                            <Clock size={13} />
                            <span>Extend</span>
                          </button>

                          {/* Admin Edit Action */}
                          {isAdmin && (
                            <button
                              onClick={() => openEditModal(c)}
                              className="px-2.5 py-1.5 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded-lg text-xs font-bold border border-amber-200/80 inline-flex items-center gap-1 transition-all cursor-pointer"
                              title="Edit contract details (Admin)"
                            >
                              <Edit2 size={13} />
                              <span>Edit</span>
                            </button>
                          )}

                          {/* Admin Delete Action */}
                          {isAdmin && (
                            <button
                              onClick={() => setContractToDelete(c)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-all cursor-pointer"
                              title="Delete contract (Admin)"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE NEW CONTRACT MODAL */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                    <FileText size={18} />
                  </span>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Assign Machine Contract</h3>
                    <p className="text-[11px] text-slate-500 font-medium">नया मशीन अनुबंध दर्ज करें</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCreateModal(false)} 
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateContract} className="p-5 overflow-y-auto space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Contract No (अनुबंध संख्या) *
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    value={newContractForm.contractNo}
                    onChange={e => setNewContractForm({ ...newContractForm, contractNo: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Machine (मशीन) *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                      value={newContractForm.machineName}
                      onChange={e => setNewContractForm({ ...newContractForm, machineName: e.target.value })}
                    >
                      <option value="">-- Select Machine --</option>
                      {allMachines.map(m => {
                        const isAssigned = activeMachineNames.has(m);
                        return (
                          <option key={m} value={m} disabled={isAssigned}>
                            {m} {isAssigned ? '(Already Assigned)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Company (कंपनी) *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
                      value={newContractForm.companyName}
                      onChange={e => setNewContractForm({ ...newContractForm, companyName: e.target.value })}
                    >
                      <option value="">-- Select Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Start Date (प्रारंभ तिथि) *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      value={newContractForm.startDate}
                      onChange={e => setNewContractForm({ ...newContractForm, startDate: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      End Date (समाप्ति तिथि) *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      value={newContractForm.endDate}
                      onChange={e => setNewContractForm({ ...newContractForm, endDate: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Remarks / Scope (रिमार्क्स)
                  </label>
                  <textarea
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800 h-20 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                    placeholder="Enter contract terms, scope, or notes..."
                    value={newContractForm.remarks}
                    onChange={e => setNewContractForm({ ...newContractForm, remarks: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    <span>Save Contract</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TRANSFER MACHINE MODAL */}
      <AnimatePresence>
        {showTransferModal && selectedContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-blue-50 shrink-0">
                <div className="flex items-center gap-2 text-blue-900">
                  <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                    <ArrowRightLeft size={18} />
                  </span>
                  <div>
                    <h3 className="font-extrabold text-sm sm:text-base">Transfer Machine Contract</h3>
                    <p className="text-[11px] text-blue-700 font-medium">मशीन को दूसरी कंपनी में ट्रांसफर करें</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowTransferModal(false)} 
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleTransferMachine} className="p-5 overflow-y-auto space-y-4 text-xs">
                <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-xl text-blue-900 space-y-1">
                  <div className="font-black text-sm flex items-center gap-1.5">
                    <Cpu size={15} className="text-blue-600" />
                    <span>Machine: {selectedContract.machineName}</span>
                  </div>
                  <div className="text-slate-600 text-[11px]">
                    Current Company: <strong className="text-slate-800 font-bold">{selectedContract.companyName}</strong> (Contract: {selectedContract.contractNo})
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Target Company (नई कंपनी चुनें) *
                  </label>
                  <select
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                    value={transferForm.newCompanyName}
                    onChange={e => setTransferForm({ ...transferForm, newCompanyName: e.target.value })}
                  >
                    <option value="">-- Select New Company --</option>
                    {companiesList
                      .filter(c => c !== selectedContract.companyName)
                      .map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Transfer Date (ट्रांसफर तिथि) *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={transferForm.transferDate}
                      onChange={e => setTransferForm({ ...transferForm, transferDate: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      New Contract No (नया अनुबंध नं.) *
                    </label>
                    <input
                      type="text"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={transferForm.newContractNo}
                      onChange={e => setTransferForm({ ...transferForm, newContractNo: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    New Contract End Date (नयी समाप्ति तिथि) *
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={transferForm.newEndDate}
                    onChange={e => setTransferForm({ ...transferForm, newEndDate: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Transfer Remarks / Reason
                  </label>
                  <textarea
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800 h-20 outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                    placeholder="E.g. Reassigned per new railway work order..."
                    value={transferForm.remarks}
                    onChange={e => setTransferForm({ ...transferForm, remarks: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowTransferModal(false)}
                    className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />}
                    <span>Confirm Transfer</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EXTEND / RENEW CONTRACT MODAL */}
      <AnimatePresence>
        {showExtendModal && selectedContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-2 text-slate-900">
                  <span className="p-1.5 bg-indigo-50 text-indigo-700 rounded-lg">
                    <Clock size={18} />
                  </span>
                  <div>
                    <h3 className="font-extrabold text-sm sm:text-base">Extend / Renew Contract</h3>
                    <p className="text-[11px] text-slate-500 font-medium">अनुबंध की समयावधि बढ़ाएं या नवीनीकृत करें</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowExtendModal(false)} 
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleExtendContract} className="p-5 overflow-y-auto space-y-4 text-xs">
                <div className="p-3 bg-slate-100/90 rounded-xl text-slate-800 space-y-1">
                  <div><strong>Contract No:</strong> <span className="font-mono">{selectedContract.contractNo}</span></div>
                  <div><strong>Machine:</strong> {selectedContract.machineName} | <strong>Company:</strong> {selectedContract.companyName}</div>
                  <div><strong>Current Period:</strong> {selectedContract.startDate} → {selectedContract.endDate}</div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    New End Date (नयी समाप्ति तिथि) *
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={extendForm.newEndDate}
                    onChange={e => setExtendForm({ ...extendForm, newEndDate: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Updated Contract No (यदि नया नंबर मिला हो)
                  </label>
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Leave blank to keep existing number"
                    value={extendForm.updatedContractNo}
                    onChange={e => setExtendForm({ ...extendForm, updatedContractNo: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Remarks / Renewal Notes
                  </label>
                  <textarea
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800 h-20 outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                    placeholder="Reason for extension / renewal terms..."
                    value={extendForm.remarks}
                    onChange={e => setExtendForm({ ...extendForm, remarks: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowExtendModal(false)}
                    className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    <span>Save Extension</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT CONTRACT MODAL (ADMIN ONLY) */}
      <AnimatePresence>
        {editingContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-amber-50 shrink-0">
                <div className="flex items-center gap-2 text-amber-900">
                  <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                    <Edit2 size={18} />
                  </span>
                  <div>
                    <h3 className="font-extrabold text-sm sm:text-base">Edit Machine Contract</h3>
                    <p className="text-[11px] text-amber-800 font-medium">अनुबंध विवरण संपादित करें (Admin Only)</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingContract(null)} 
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleEditContract} className="p-5 overflow-y-auto space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Contract No *
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    value={editForm.contractNo}
                    onChange={e => setEditForm({ ...editForm, contractNo: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Machine Name *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                      value={editForm.machineName}
                      onChange={e => setEditForm({ ...editForm, machineName: e.target.value })}
                    >
                      <option value="">-- Select Machine --</option>
                      {allMachines.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Company Name *
                    </label>
                    <select
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                      value={editForm.companyName}
                      onChange={e => setEditForm({ ...editForm, companyName: e.target.value })}
                    >
                      <option value="">-- Select Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20"
                      value={editForm.startDate}
                      onChange={e => setEditForm({ ...editForm, startDate: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      End Date *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20"
                      value={editForm.endDate}
                      onChange={e => setEditForm({ ...editForm, endDate: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Contract Status *
                  </label>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value as any })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
                  >
                    <option value="active">Active (सक्रिय)</option>
                    <option value="transferred">Transferred (ट्रांसफर)</option>
                    <option value="expired">Expired (समाप्त)</option>
                  </select>
                </div>

                {editForm.status === 'transferred' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                    <div>
                      <label className="block text-[10px] font-black text-blue-900 uppercase tracking-wider mb-1">
                        Transferred To Company
                      </label>
                      <select
                        value={editForm.transferredToCompany}
                        onChange={e => setEditForm({ ...editForm, transferredToCompany: e.target.value })}
                        className="w-full border border-blue-200 rounded-xl px-3 py-1.5 font-bold text-slate-800 bg-white text-xs outline-none"
                      >
                        <option value="">-- Select Company --</option>
                        {companiesList.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-blue-900 uppercase tracking-wider mb-1">
                        Transfer Date
                      </label>
                      <input
                        type="date"
                        value={editForm.transferDate}
                        onChange={e => setEditForm({ ...editForm, transferDate: e.target.value })}
                        className="w-full border border-blue-200 rounded-xl px-3 py-1.5 font-bold text-slate-800 bg-white text-xs outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                    Remarks / Terms
                  </label>
                  <textarea
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800 h-20 outline-none focus:ring-2 focus:ring-amber-500/20 resize-none"
                    placeholder="Enter remarks or updated terms..."
                    value={editForm.remarks}
                    onChange={e => setEditForm({ ...editForm, remarks: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingContract(null)}
                    className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    <span>Update Contract</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONTRACT CONFIRMATION MODAL (ADMIN ONLY) */}
      <AnimatePresence>
        {contractToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-5 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto shadow-2xs">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Delete Machine Contract?</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    क्या आप वाकई अनुबंध संख्या <strong className="text-slate-800 font-mono">{contractToDelete.contractNo}</strong> (Machine: {contractToDelete.machineName}) को हमेशा के लिए हटाना चाहते हैं?
                  </p>
                  <p className="text-[11px] text-red-600 font-semibold mt-2 bg-red-50 p-2 rounded-xl border border-red-100">
                    Warning: यह क्रिया वापस नहीं की जा सकती (irreversible).
                  </p>
                </div>
                <div className="flex gap-2 justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setContractToDelete(null)}
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteContract}
                    disabled={submitting}
                    className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-red-200 cursor-pointer"
                  >
                    {submitting ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Trash2 size={13} />}
                    <span>Confirm Delete</span>
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
