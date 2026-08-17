import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, updateDoc, doc, writeBatch, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Send, Search, X, AlertCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { generateIssueNotePDF } from '../utils/pdfGenerator';

interface Part {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
  machineName?: string;
  whetherUse?: string;
  itemCondition?: string;
  unit?: string;
  uom?: string;
}

const getItemCondition = (part?: Partial<Part> | null): string => {
  if (!part) return 'New';
  if (part.itemCondition) return part.itemCondition;
  if (part.whetherUse === 'New' || part.whetherUse === 'Serviceable' || part.whetherUse === 'Released') {
    return part.whetherUse;
  }
  return 'New';
};

import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';
import { motion, AnimatePresence } from 'motion/react';

export default function Issue() {
  const [currentEmployee, setCurrentEmployee] = useState<EmployeeProfile | null>(null);
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessTypeVal = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessTypeVal === 'full' || userAccessTypeVal === 'admin-light';
  });

  const [selectedMachine, setSelectedMachine] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterCondition, setFilterCondition] = useState('all');
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
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });
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

  const [parts, setParts] = useState<Part[]>([]);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [issueData, setIssueData] = useState({
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    receiverName: '',
    remarks: '',
    machineName: '',
  });

  const [issueZone, setIssueZone] = useState('South East Central Railway');
  const [issueDivision, setIssueDivision] = useState('Raipur');

  // Compute machines available in selected Zone & Division in the Issue modal
  const machinesInModalDivision = useMemo(() => {
    if (!issueZone || !issueDivision) return allMachinesList;
    return allMachinesList.filter(m => {
      const pos = machinePositions[m];
      return pos && pos.zone === issueZone && pos.division === issueDivision;
    });
  }, [issueZone, issueDivision, machinePositions, allMachinesList]);

  useEffect(() => {
    const checkAccess = async () => {
      if (!auth.currentUser) return;
      const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      if (emp) {
        setCurrentEmployee(emp);
        const isFull = emp.accessType === 'full' || emp.accessType === 'admin-light';
        localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
        setUserAccessType(emp.accessType || 'limited');
        setIsAdmin(isFull);
        const mName = emp.machineName || '';
        setUserMachine(mName);
        localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
        const cName = emp.companyName || '';
        setCurrentUserCompanyName(cName);
        localStorage.setItem(`companyName_${auth.currentUser.uid}`, cName);
      } else {
        const isEmployee = auth.currentUser.email?.endsWith('@employee.billedapp.com');
        if (!isEmployee) {
          setUserAccessType('full');
        }
      }
    };
    checkAccess();
    fetchParts();
  }, []);

  const fetchParts = async () => {
    setLoading(true);
    try {
      // Fetch all employees to get companies mapping
      const empSnapshot = await getDocs(collection(db, 'employees'));
      const empList = empSnapshot.docs.map(doc => doc.data());
      setEmployeeList(empList);
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      const querySnapshot = await getDocs(collection(db, 'parts'));
      const partList = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Part))
        .filter(p => p.stock > 0);
      
      // Extract custom machines from parts list
      const uniqueMachines = Array.from(new Set(partList.map(p => p.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setParts(partList);
    } catch (error) {
      console.error('Error fetching parts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleIssuePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPart) return;

    if (!issueData.qty || issueData.qty <= 0) {
      toast.error('Issue quantity must be greater than 0.');
      return;
    }

    if (issueData.qty > selectedPart.stock) {
      toast.error(`Issue quantity cannot exceed available stock (${selectedPart.stock} ${selectedPart.unit || 'Nos'}).`);
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);

      // Update stock in parts catalog
      const partRef = doc(db, 'parts', selectedPart.id);
      const newStock = Math.max(0, selectedPart.stock - issueData.qty);
      const newTotalValue = newStock * selectedPart.rate;

      batch.update(partRef, {
        stock: newStock,
        totalValue: newTotalValue,
      });

      // Generate Issue Note PDF Voucher Number
      const generatedIssueNoteNo = `ISS-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;

      // Add to transaction history
      const itemCond = getItemCondition(selectedPart);
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: selectedPart.id,
        type: 'issued',
        qty: issueData.qty,
        unit: selectedPart.unit || 'Nos',
        date: issueData.date,
        remarks: issueData.remarks,
        receiverName: issueData.receiverName,
        details: `Issued to: ${issueData.receiverName}${issueData.machineName ? ` (${issueData.machineName})` : ''} [Condition: ${itemCond}]`,
        machineName: selectedPart.machineName || '',
        voucherNo: generatedIssueNoteNo,
        itemCondition: itemCond,
        whetherUse: selectedPart.whetherUse || 'CS',
      });

      // If one machine issues to another machine, show that quantity in the recipient machine's Inbox
      const isInterMachine = selectedPart.machineName && issueData.machineName && selectedPart.machineName !== issueData.machineName;
      if (isInterMachine) {
        const demandRef = doc(collection(db, 'demands'));
        batch.set(demandRef, {
          demandNo: generatedIssueNoteNo,
          plNo: selectedPart.plNo || '',
          partNo: selectedPart.partNo || '',
          description: selectedPart.description || '',
          qty: issueData.qty,
          giveQty: issueData.qty,
          unit: selectedPart.unit || 'Nos',
          date: issueData.date,
          status: 'approved', // Pre-approved so they can just "Receive" it in the action desk
          isInterMachineIssue: true,
          issuedFromMachine: selectedPart.machineName,
          machineName: issueData.machineName, // Recipient machine name
          remarks: `Inter-Machine Issue: Transfer of ${issueData.qty} ${selectedPart.unit || 'Nos'} from ${selectedPart.machineName} to ${issueData.machineName}. Remarks: ${issueData.remarks}`,
          createdByUid: auth.currentUser?.uid || '',
          createdByEmail: auth.currentUser?.email || '',
          createdByEmployeeName: '',
          createdByPfNo: '',
          createdByCompanyName: currentUserCompanyName || '',
          lastActionByUid: auth.currentUser?.uid || '',
          lastActionByEmail: auth.currentUser?.email || '',
          lastActionByName: auth.currentUser?.email || 'System',
          lastActionByCompanyName: currentUserCompanyName || '',
        });

        const logRef = doc(collection(db, 'demand_logs'));
        batch.set(logRef, {
          demandId: demandRef.id,
          plNo: selectedPart.plNo || '',
          partNo: selectedPart.partNo || '',
          description: selectedPart.description || '',
          action: 'APPROVAL',
          remark: `Inter-Machine Issue: ${issueData.qty} ${selectedPart.unit || 'Nos'} issued from ${selectedPart.machineName} to ${issueData.machineName}.`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: auth.currentUser?.email || 'System',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString()
        });
      }

      await batch.commit();
      toast.success('Part issued successfully');

      // Generate and auto-download Issue Note PDF Voucher
      const targetMachine = issueData.machineName || selectedPart.machineName || '';
      const targetZone = machinePositions[targetMachine]?.zone || 'South East Central Railway';
      const issuerName = currentEmployee?.name || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'DEPOT OFFICIAL';
      const issuerDesignation = currentEmployee?.designation || '';
      try {
        await generateIssueNotePDF({
          issueNoteNo: generatedIssueNoteNo,
          date: issueData.date || format(new Date(), 'yyyy-MM-dd'),
          plNo: selectedPart.plNo,
          partNo: selectedPart.partNo,
          description: selectedPart.description,
          qty: issueData.qty,
          unit: selectedPart.unit || 'Nos',
          rate: selectedPart.rate || 0,
          totalValue: (issueData.qty || 0) * (selectedPart.rate || 0),
          issuingDepot: selectedPart.machineName || 'Depot',
          machineName: targetMachine,
          issuedTo: issueData.receiverName || 'Consignee Officer',
          issuedBy: issuerName,
          officerName: issuerName,
          officerDesignation: issuerDesignation,
          consigneeDepot: issueData.machineName ? `SSE/TM/${issueData.machineName}` : (issueData.receiverName || 'Consignee Officer'),
          remarks: issueData.remarks || '',
          zone: targetZone
        }, true);
        toast.success('Issue Note PDF Voucher downloaded!');
      } catch (pdfErr) {
        console.error('Error generating Issue Note PDF:', pdfErr);
      }

      setShowIssueModal(false);
      fetchParts();
      setIssueData({
        qty: 0,
        date: format(new Date(), 'yyyy-MM-dd'),
        receiverName: '',
        remarks: '',
        machineName: '',
      });
    } catch (error) {
      console.error('Error issuing part:', error);
      toast.error('Failed to issue part. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredParts = parts.filter(p => {
    const plNo = p.plNo || '';
    const description = p.description || '';
    const partNo = p.partNo || '';
    const search = searchTerm.toLowerCase();
    
    const matchesSearch = plNo.toLowerCase().includes(search) || 
                          description.toLowerCase().includes(search) || 
                          partNo.toLowerCase().includes(search);
                          
    if (!matchesSearch) return false;

    // Apply company filter constraint
    if (!isEmployee && selectedCompany !== 'all') {
      const companyEmployees = employeeList.filter(e => e.companyName === selectedCompany);
      const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
      if (!p.machineName || !companyMachines.has(p.machineName)) {
        return false;
      }
    }

    // Apply company and machine filter constraint for non-admin users
    if (isEmployee) {
      const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
        const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
        if (p.machineName && companyMachines.size > 0 && !companyMachines.has(p.machineName)) {
          return false;
        }
      }

      if (userAccessType === 'admin-light') {
        if (selectedMachine !== 'all') {
          if (p.machineName !== selectedMachine) return false;
        }
      } else {
        const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (myMachine && p.machineName && p.machineName !== myMachine) {
          return false;
        }
      }
    } else {
      if (selectedMachine !== 'all') {
        if (p.machineName !== selectedMachine) return false;
      }
    }

    // Item Condition Filter (New / Serviceable / Released)
    if (filterCondition !== 'all') {
      const cond = getItemCondition(p);
      if (cond !== filterCondition) return false;
    }

    // Zone Filter
    if (filterZone !== 'all') {
      const pos = machinePositions[p.machineName || ''];
      if (!pos || pos.zone !== filterZone) return false;
    }

    // Division Filter
    if (filterDivision !== 'all') {
      const pos = machinePositions[p.machineName || ''];
      if (!pos || pos.division !== filterDivision) return false;
    }

    return true;
  });

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
          <h1 className="text-2xl font-bold text-primary">Issue Module</h1>
          {isEmployee && userAccessType === 'full' ? (
            <div className="flex flex-wrap items-center gap-2">
              {currentUserCompanyName && (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-1.5 rounded-full font-bold">
                  Company: {currentUserCompanyName}
                </span>
              )}
              {userMachine && (
                <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1.5 rounded-full font-bold">
                  Machine: {userMachine}
                </span>
              )}
            </div>
          ) : (!isEmployee || isAdmin) && (
            <div className="flex flex-wrap items-center gap-2">
              {!isEmployee && (
                <select
                  className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
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
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
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

              {/* Condition Filter */}
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                value={filterCondition}
                onChange={e => setFilterCondition(e.target.value)}
              >
                <option value="all">All Conditions (सभी)</option>
                <option value="New">✨ New / नया</option>
                <option value="Serviceable">🛠️ Serviceable / सर्विस-योग्य</option>
                <option value="Released">♻️ Released / रिलीज़्ड</option>
              </select>
            </div>
          )}
        </div>
        <div className="relative w-full md:w-64 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
          <input
            type="text"
            placeholder="Search PL No, Part No..."
            className="w-full pl-10 pr-4 py-2 border border-outline/20 rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-surface-container-low p-4 rounded-lg flex items-center gap-3 text-sm text-on-surface-variant border border-outline-variant/20"
      >
        <AlertCircle className="text-primary" size={20} />
        Only items with available stock are displayed here for issuance.
      </motion.div>
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredParts.map((part, idx) => {
            const cond = getItemCondition(part);
            return (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: idx * 0.05 }}
                key={part.id} 
                className="bg-white rounded-lg p-6 shadow-sm border border-outline-variant/10 hover:border-primary/30 transition-all group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-widest text-primary bg-primary/5 px-2 py-0.5 rounded">
                        {part.plNo}
                      </span>
                      <span className={cn(
                        "text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border shadow-2xs flex items-center gap-1",
                        cond === 'Serviceable' ? "bg-blue-50 text-blue-800 border-blue-200" :
                        cond === 'Released' ? "bg-amber-50 text-amber-800 border-amber-200" :
                        "bg-emerald-50 text-emerald-800 border-emerald-200"
                      )}>
                        {cond === 'Serviceable' ? '🛠️ Serviceable' : cond === 'Released' ? '♻️ Released' : '✨ New'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-on-surface mt-2 line-clamp-1">{part.description}</h3>
                    <p className="text-xs text-on-surface-variant font-mono mt-1">{part.partNo}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-primary">
                      {Number.isNaN(part.stock) ? 0 : (part.stock || 0)} <span className="text-xs font-bold text-slate-500">{part.unit || 'Nos'}</span>
                    </div>
                    <div className="text-[10px] uppercase font-bold text-outline">Available Stock</div>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-outline-variant/10">
                  <div className="text-xs font-bold text-on-surface-variant">
                    Loc: <span className="text-on-surface">{part.location || 'N/A'}</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPart(part);
                      const targetMachine = part.machineName || '';
                      setIssueData({
                        qty: 1,
                        date: format(new Date(), 'yyyy-MM-dd'),
                        receiverName: '',
                        remarks: '',
                        machineName: targetMachine,
                      });
                      const pos = machinePositions[targetMachine];
                      if (pos && pos.zone) {
                        setIssueZone(pos.zone);
                        setIssueDivision(pos.division || 'Raipur');
                      } else {
                        setIssueZone('South East Central Railway');
                        setIssueDivision('Raipur');
                      }
                      setShowIssueModal(true);
                    }}
                    className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-5 py-2.5 rounded-lg text-xs font-black shadow-md hover:from-indigo-700 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all transform"
                  >
                    Issue Item <Send size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {filteredParts.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="col-span-full py-20 text-center text-outline italic"
          >
            No items available for issuance matching your search.
          </motion.div>
        )}
      </div>
      </div>

      {/* Issue Modal (Landscape Optimized) */}
      <AnimatePresence>
        {showIssueModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-auto"
            >
              <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-black tracking-tight">Issue Material to Machine (सामग्री इशू फॉर्म)</h2>
                  <p className="text-[11px] text-slate-300 font-medium">
                    Landscape form layout with Zone & Division auto-fill and machine count per division.
                  </p>
                </div>
                <button onClick={() => setShowIssueModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleIssuePart} className="p-6 space-y-5">
                {/* Selected Item Summary Banner */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2 shadow-2xs">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-extrabold text-slate-900 text-base leading-snug">{selectedPart?.description}</div>
                      <div className="text-slate-500 font-mono text-[11px] mt-0.5">Part No: {selectedPart?.partNo}</div>
                    </div>
                    {selectedPart && (
                      <span className={cn(
                        "text-[10px] font-black uppercase px-2.5 py-1 rounded-full border whitespace-nowrap shadow-2xs",
                        getItemCondition(selectedPart) === 'Serviceable' ? "bg-blue-100 text-blue-800 border-blue-300" :
                        getItemCondition(selectedPart) === 'Released' ? "bg-amber-100 text-amber-800 border-amber-300" :
                        "bg-emerald-100 text-emerald-800 border-emerald-300"
                      )}>
                        {getItemCondition(selectedPart) === 'Serviceable' ? '🛠️ Serviceable' : getItemCondition(selectedPart) === 'Released' ? '♻️ Released' : '✨ New'}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center text-slate-600 font-medium pt-2 border-t border-slate-200/80">
                    <span>PL No: <strong className="text-slate-900 font-mono font-bold">{selectedPart?.plNo}</strong></span>
                    <span>Location: <strong className="text-slate-800">{selectedPart?.location || 'Depot'}</strong></span>
                    <span>Available Stock: <strong className="text-emerald-700 font-black text-sm">{selectedPart?.stock} {selectedPart?.unit || 'Nos'}</strong></span>
                  </div>
                </div>

                {/* 2-Column Landscape Form Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Left Column: Transaction Details */}
                  <div className="space-y-3.5">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 border-b pb-1">
                      1. Issue Quantity & Receiver (मात्रा व प्राप्तकर्ता)
                    </h3>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                        Issue Quantity (जारी मात्रा - {selectedPart?.unit || 'Nos'})
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        max={selectedPart?.stock}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueData.qty || ''}
                        onChange={e => setIssueData({ ...issueData, qty: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                        placeholder="e.g. 1 or 0.1"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Date (तिथि)</label>
                      <input
                        type="date"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueData.date}
                        onChange={e => setIssueData({ ...issueData, date: e.target.value })}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Receiver's Details (प्राप्तकर्ता विवरण)</label>
                      <input
                        type="text"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueData.receiverName}
                        onChange={e => setIssueData({ ...issueData, receiverName: e.target.value })}
                        required
                        placeholder="E.g. Rajesh Kumar / SSE / PF No. 49302"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Remarks (रिमार्क्स - Open to type)</label>
                      <textarea
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-900 h-20 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueData.remarks}
                        onChange={e => setIssueData({ ...issueData, remarks: e.target.value })}
                        required
                        placeholder="Type issue remarks, purpose, or work order details..."
                      />
                    </div>
                  </div>

                  {/* Right Column: Zone, Division & Machine Selection */}
                  <div className="space-y-3.5 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900 border-b border-slate-200 pb-1">
                      2. Zone, Division & Machine Location (स्थान व मशीन)
                    </h3>

                    {/* Zone Selector */}
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Railway Zone (जोन)</label>
                      <select
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueZone}
                        onChange={e => {
                          const newZ = e.target.value;
                          setIssueZone(newZ);
                          const firstDiv = RAILWAY_ZONES_DIVISIONS[newZ]?.[0] || 'Raipur';
                          setIssueDivision(firstDiv);
                        }}
                      >
                        {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                    </div>

                    {/* Division Selector */}
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">Railway Division (डिवीजन)</label>
                      <select
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueDivision}
                        onChange={e => setIssueDivision(e.target.value)}
                      >
                        {RAILWAY_ZONES_DIVISIONS[issueZone]?.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>

                    {/* Machines in Selected Division Counter Badge */}
                    <div className="bg-indigo-50 border border-indigo-200/80 p-2.5 rounded-lg flex items-center justify-between text-xs">
                      <span className="font-bold text-indigo-950">
                        {issueDivision} Division Machines:
                      </span>
                      <span className="bg-indigo-600 text-white font-black px-2.5 py-0.5 rounded-full text-[11px]">
                        {machinesInModalDivision.length} Machine{machinesInModalDivision.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Target Machine Selector */}
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                        Issue to Machine (मशीन को जारी करें)
                      </label>
                      <select
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-black text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={issueData.machineName}
                        onChange={e => {
                          const mName = e.target.value;
                          setIssueData({ ...issueData, machineName: mName });
                          // Auto-fill Zone & Division if machine position is known
                          const pos = machinePositions[mName];
                          if (pos && pos.zone) {
                            setIssueZone(pos.zone);
                            setIssueDivision(pos.division || 'Raipur');
                          }
                        }}
                        required
                      >
                        <option value="">-- Select Target Machine --</option>
                        <optgroup label={`Machines in ${issueDivision} (${machinesInModalDivision.length})`}>
                          {machinesInModalDivision.map(m => (
                            <option key={m} value={m}>📍 {m} ({issueDivision})</option>
                          ))}
                        </optgroup>
                        <optgroup label="All Other Machines (अन्य जोन/डिवीजन मशीनें)">
                          {allMachinesList
                            .filter(m => !machinesInModalDivision.includes(m))
                            .map(m => {
                              const pos = machinePositions[m];
                              return (
                                <option key={m} value={m}>
                                  {m} {pos ? `(${pos.division || pos.zone})` : ''}
                                </option>
                              );
                            })}
                        </optgroup>
                      </select>
                      <p className="text-[10px] text-slate-500 italic mt-1">
                        * Selecting a machine auto-fills its Zone & Division. You can also manually change Zone/Division if issuing to a machine in another division.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Form Footer Action Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(false)}
                    className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    Cancel (रद्द करें)
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-xs font-black rounded-xl shadow-lg transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Confirm Issue & Generate Note (जारी करें व रसीद बनाएं)
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
