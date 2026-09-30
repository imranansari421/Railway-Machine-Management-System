import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, updateDoc, doc, writeBatch, onSnapshot, addDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Send, Search, X, AlertCircle, Loader2, Package, ClipboardList, CheckCircle2, Clock, ArrowRight, FileDown, Building2, PlusCircle, UserCheck, Shield, Lock, Eye, SendHorizontal, Filter, Inbox, PackageCheck } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { generateIssueNotePDF, generateDemandPDF } from '../utils/pdfGenerator';
import { getCompanyByMachine } from '../utils/contracts';

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

interface StoreItem {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  category?: string;
  unit?: string;
  stock: number;
  rate: number;
  totalValue?: number;
  location?: string;
  companyName?: string;
  itemCondition?: string;
  remarks?: string;
}

interface DemandRequestItem {
  id: string;
  demandNo?: string;
  plNo?: string;
  partNo?: string;
  description?: string;
  qty: number;
  unit?: string;
  rate?: number;
  date: string;
  whetherUse?: string;
  itemCondition?: string;
  remarks?: string;
  status: string;
  giveQty?: number;
  receivedQty?: number;
  createdByUid?: string;
  createdByEmail?: string;
  createdByEmployeeName?: string;
  createdByEmployeeId?: string;
  createdByPfNo?: string;
  createdByCompanyName?: string;
  machineName?: string;
  requestingMachineName?: string;
  targetMachineName?: string;
  issuedFromMachine?: string;
  issueNoteNo?: string;
  forwardedTo?: string;
  forwardedToName?: string;
  forwardedToEmail?: string;
  forwardedToUid?: string;
  forwardedToPfNo?: string;
  forwardedToEmployeeId?: string;
  forwardedToLoginId?: string;
  forwardedToRole?: string;
  forwardedToCompanyName?: string;
  forwardedToAdmin?: boolean;
  forwardedToCompanyAdmin?: boolean;
  forwardedAt?: string;
  lastActionByName?: string;
  lastActionDate?: string;
  lastActionByUid?: string;
  lastActionByEmail?: string;
  lastActionByCompanyName?: string;
}

// Check if a demand is forwarded to the current logged-in user / depot account
export const isDemandForwardedToUser = (
  d: DemandRequestItem,
  employee: any | null,
  user: any | null,
  allEmployees?: any[]
): boolean => {
  return isDemandAssignedToUser(d, user, employee, allEmployees);
};

const getItemCondition = (part?: Partial<Part> | null): string => {
  if (!part) return 'New';
  if (part.itemCondition) return part.itemCondition;
  if (part.whetherUse === 'New' || part.whetherUse === 'Serviceable' || part.whetherUse === 'Released') {
    return part.whetherUse;
  }
  return 'New';
};

import { findEmployeeForUser, EmployeeProfile, getFilterAccessPermissions, isDemandAssignedToUser, isDemandSelfCreated } from '../utils/employee';
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

  const [selectedMachine, setSelectedMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterZone, setFilterZone] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userZone_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterDivision, setFilterDivision] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [currentUserZone, setCurrentUserZone] = useState<string>(() => {
    return localStorage.getItem(`userZone_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserDivision, setCurrentUserDivision] = useState<string>(() => {
    return localStorage.getItem(`userDivision_${auth.currentUser?.uid}`) || '';
  });
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });
  const [filterCondition, setFilterCondition] = useState('all');
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});

  const isEmployeeUser = !!auth.currentUser?.email?.endsWith('@employee.billedapp.com');

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployeeUser, userAccessType, currentEmployee, {
      machineName: userMachine,
      zone: currentUserZone,
      division: currentUserDivision,
    });
  }, [isEmployeeUser, userAccessType, currentEmployee, userMachine, currentUserZone, currentUserDivision]);

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
    if (settingsMachines.length > 0) {
      return Array.from(new Set(settingsMachines)).filter(Boolean).sort();
    }
    return Array.from(new Set([...defaultList, ...customMachines])).filter(Boolean).sort();
  }, [settingsMachines, customMachines]);

  // Helper functions to resolve machine zone and division dynamically
  const getMachineZone = (m?: string): string => {
    if (!m) return '';
    const clean = m.trim();
    if (machinePositions[clean]?.zone) return machinePositions[clean].zone;
    const stripped = clean.replace(/^SSE\/TM\//i, '').trim();
    if (machinePositions[stripped]?.zone) return machinePositions[stripped].zone;
    const empMatch = employeeList.find(e => (e.machineName || '').trim() === clean || (e.machineName || '').trim() === stripped);
    if (empMatch?.zone) return empMatch.zone;
    return 'South East Central Railway';
  };

  const getMachineDivision = (m?: string): string => {
    if (!m) return '';
    const clean = m.trim();
    if (machinePositions[clean]?.division) return machinePositions[clean].division;
    const stripped = clean.replace(/^SSE\/TM\//i, '').trim();
    if (machinePositions[stripped]?.division) return machinePositions[stripped].division;
    const empMatch = employeeList.find(e => (e.machineName || '').trim() === clean || (e.machineName || '').trim() === stripped);
    if (empMatch?.division) return empMatch.division;
    return 'Raipur';
  };

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

  // View Tab: 'inventory' or 'to-user-depot'
  const [issueViewTab, setIssueViewTab] = useState<'inventory' | 'to-user-depot'>('inventory');

  // Demand Requests State for "To user depot"
  const [demandRequests, setDemandRequests] = useState<DemandRequestItem[]>([]);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [demandStatusFilter, setDemandStatusFilter] = useState<'pending' | 'all' | 'issued'>('pending');

  // Modal State for "To user depot" Issue
  const [showDepotIssueModal, setShowDepotIssueModal] = useState(false);
  const [selectedDemandToIssue, setSelectedDemandToIssue] = useState<DemandRequestItem | null>(null);
  const [depotIssueQty, setDepotIssueQty] = useState(1);
  const [depotIssueDate, setDepotIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [depotIssueMachineName, setDepotIssueMachineName] = useState('');
  const [depotIssueZone, setDepotIssueZone] = useState('South East Central Railway');
  const [depotIssueDivision, setDepotIssueDivision] = useState('Raipur');
  const [depotIssueReceiver, setDepotIssueReceiver] = useState('');
  const [depotIssueRemarks, setDepotIssueRemarks] = useState('');
  const [depotSelectedPartId, setDepotSelectedPartId] = useState('');
  const [depotIssuePlNo, setDepotIssuePlNo] = useState('');
  const [depotIssuePartNo, setDepotIssuePartNo] = useState('');
  const [depotIssueRate, setDepotIssueRate] = useState<number>(0);
  const [submittingDepotIssue, setSubmittingDepotIssue] = useState(false);

  // Machine change handler that auto fills zone and division
  const handleDepotMachineChange = (mName: string) => {
    setDepotIssueMachineName(mName);
    if (mName) {
      const autoZone = getMachineZone(mName);
      const autoDiv = getMachineDivision(mName);
      if (autoZone) setDepotIssueZone(autoZone);
      if (autoDiv) setDepotIssueDivision(autoDiv);

      if (selectedDemandToIssue) {
        const requester = selectedDemandToIssue.createdByEmployeeName || selectedDemandToIssue.createdByEmail?.split('@')[0] || 'Depot Official';
        if (requester) {
          setDepotIssueReceiver(`${requester} (${mName})`);
        }
      }
    }
  };

  // Helper to check if PL No or Part No is NA / N/A (allowing edit)
  const isPlEditable = (pl?: string) => {
    if (!pl) return true;
    const clean = pl.trim().toUpperCase();
    return clean === 'NA' || clean === 'N/A' || clean === 'N / A' || clean === 'NONE' || clean === '-';
  };

  const isPartNoEditable = (part?: string) => {
    if (!part) return true;
    const clean = part.trim().toUpperCase();
    return clean === 'NA' || clean === 'N/A' || clean === 'N / A' || clean === 'NONE' || clean === '-';
  };

  // Listen to Demands for "To user depot" requests
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'demands'), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DemandRequestItem[];
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setDemandRequests(list);
    });
    return () => unsub();
  }, []);

  // Listen to Store items for Company Light Admin store issuance
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'store_items'), (snap) => {
      const list: StoreItem[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          plNo: data.plNo || '',
          description: data.description || '',
          partNo: data.partNo || '',
          category: data.category || 'General',
          unit: data.unit || 'Nos',
          stock: Number(data.stock) || 0,
          rate: Number(data.rate) || 0,
          totalValue: (Number(data.stock) || 0) * (Number(data.rate) || 0),
          location: data.location || '',
          companyName: data.companyName || 'General Store',
          itemCondition: data.itemCondition || 'New',
          remarks: data.remarks || '',
        });
      });
      setStoreItems(list);
    });
    return () => unsub();
  }, []);

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
        if (mName) {
          setSelectedMachine(mName);
        }
        const cName = emp.companyName || '';
        setCurrentUserCompanyName(cName);
        localStorage.setItem(`companyName_${auth.currentUser.uid}`, cName);
        if (emp.zone) {
          setCurrentUserZone(emp.zone);
          setFilterZone(emp.zone);
        }
        if (emp.division) {
          setCurrentUserDivision(emp.division);
          setFilterDivision(emp.division);
        }
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
      const empList = empSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
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

  const isTopAdmin = Boolean(
    auth.currentUser?.email === 'imranansari399605@gmail.com' ||
    (!auth.currentUser?.email?.endsWith('@employee.billedapp.com') && (userAccessType === 'full' || isAdmin))
  );

  const isCompanyLightAdmin = Boolean(
    (currentEmployee?.accessType === 'admin-light') || 
    (userAccessType === 'admin-light')
  );

  const normalizeMachineName = (name?: string) => {
    if (!name) return '';
    return name.trim().replace(/^SSE\/TM\//i, '').replace(/[-\s_]/g, '').toLowerCase();
  };

  const canIssueThisPart = (part?: Partial<Part> | null) => {
    if (!part) return false;
    if (isTopAdmin) return true;

    const partMachine = (part.machineName || '').trim();
    if (!partMachine) return false;

    const userAssigned = (userMachine || currentEmployee?.machineName || (auth.currentUser?.uid ? localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) : '') || '').trim();
    if (!userAssigned || userAssigned.toLowerCase() === 'all' || userAssigned.toLowerCase() === 'none' || userAssigned.toLowerCase() === 'n/a') {
      return false;
    }

    if (partMachine.toLowerCase() === userAssigned.toLowerCase()) {
      return true;
    }
    return normalizeMachineName(partMachine) === normalizeMachineName(userAssigned);
  };

  const handleIssuePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPart) return;

    if (!canIssueThisPart(selectedPart)) {
      toast.error(`Item issue is restricted to employees assigned to machine ${selectedPart.machineName || 'this machine'}.`);
      return;
    }

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
          issuingDepot: (selectedPart.machineName || 'Depot').replace(/^SSE\/TM\//i, '').trim(),
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

  // Helper to find matching stock for a demand request
  // Rule: If current user is Company Light Admin -> issue from Store (store_items)
  // Others (machine employees / field depots) -> issue from their own inventory (parts)
  const findStockForDemand = (demand: DemandRequestItem) => {
    const cleanPl = (demand.plNo || '').trim().toLowerCase();
    const cleanPart = (demand.partNo || '').trim().toLowerCase();

    if (isCompanyLightAdmin) {
      return storeItems
        .filter(item => {
          if (item.stock <= 0) return false;
          if (currentUserCompanyName && item.companyName &&
              item.companyName.toLowerCase() !== 'general store' &&
              item.companyName.toLowerCase() !== currentUserCompanyName.toLowerCase()) {
            return false;
          }
          const matchPl = cleanPl && item.plNo && item.plNo.trim().toLowerCase() === cleanPl;
          const matchPart = cleanPart && item.partNo && item.partNo.trim().toLowerCase() === cleanPart;
          return matchPl || matchPart;
        })
        .map(item => ({
          id: item.id,
          plNo: item.plNo,
          partNo: item.partNo,
          description: item.description,
          stock: item.stock,
          rate: item.rate,
          unit: item.unit || 'Nos',
          location: item.location || 'Central Store',
          companyName: item.companyName || 'Store',
          itemCondition: item.itemCondition || 'New',
          isStore: true,
        }));
    } else {
      return parts
        .filter(p => {
          if (p.stock <= 0) return false;
          if (userMachine && p.machineName && p.machineName.trim().toLowerCase() !== userMachine.trim().toLowerCase()) {
            return false;
          }
          const matchPl = cleanPl && p.plNo && p.plNo.trim().toLowerCase() === cleanPl;
          const matchPart = cleanPart && p.partNo && p.partNo.trim().toLowerCase() === cleanPart;
          return matchPl || matchPart;
        })
        .map(p => ({
          id: p.id,
          plNo: p.plNo,
          partNo: p.partNo,
          description: p.description,
          stock: p.stock,
          rate: p.rate,
          unit: p.unit || 'Nos',
          location: p.location || 'Depot',
          companyName: p.machineName || 'Depot',
          itemCondition: getItemCondition(p),
          isStore: false,
        }));
    }
  };

  // Demands forwarded strictly to the current employee / depot user account
  const myPendingDepotDemands = useMemo(() => {
    return demandRequests.filter(d => {
      if (d.status !== 'pending') return false;
      const isForwarded = Boolean(
        d.forwardedTo ||
        d.forwardedToName ||
        d.forwardedToEmail ||
        d.forwardedToUid ||
        d.forwardedToPfNo ||
        d.forwardedToEmployeeId ||
        d.forwardedToAdmin ||
        d.forwardedToCompanyAdmin
      );
      if (!isForwarded) return false;
      const isSelf = isDemandSelfCreated(d, auth.currentUser, currentEmployee);
      if (isSelf) return false;
      return isDemandForwardedToUser(d, currentEmployee, auth.currentUser, employeeList);
    });
  }, [demandRequests, currentEmployee, employeeList]);

  // Pending count for current user account
  const pendingDepotDemands = myPendingDepotDemands;

  const filteredDemandRequests = useMemo(() => {
    return demandRequests.filter((d) => {
      // 1. Demand must have been explicitly forwarded
      const isForwarded = Boolean(
        d.forwardedTo ||
        d.forwardedToName ||
        d.forwardedToEmail ||
        d.forwardedToUid ||
        d.forwardedToPfNo ||
        d.forwardedToEmployeeId ||
        d.forwardedToAdmin ||
        d.forwardedToCompanyAdmin
      );
      if (!isForwarded) return false;

      // 2. Strict Account Isolation Rule:
      // Show ONLY if the demand was explicitly forwarded to the currently logged-in user / employee account
      const isAssignedToMe = isDemandForwardedToUser(d, currentEmployee, auth.currentUser, employeeList);
      if (!isAssignedToMe) return false;

      // 3. Exclude self-created demands
      const isCreatedByMe = isDemandSelfCreated(d, auth.currentUser, currentEmployee);
      if (isCreatedByMe) return false;

      // Status Filter
      if (demandStatusFilter === 'pending' && d.status !== 'pending') return false;
      if (demandStatusFilter === 'issued' && d.status === 'pending') return false;

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matches = 
          (d.demandNo && d.demandNo.toLowerCase().includes(q)) ||
          (d.plNo && d.plNo.toLowerCase().includes(q)) ||
          (d.partNo && d.partNo.toLowerCase().includes(q)) ||
          (d.description && d.description.toLowerCase().includes(q)) ||
          (d.requestingMachineName && d.requestingMachineName.toLowerCase().includes(q)) ||
          (d.machineName && d.machineName.toLowerCase().includes(q)) ||
          (d.createdByEmployeeName && d.createdByEmployeeName.toLowerCase().includes(q)) ||
          (d.createdByCompanyName && d.createdByCompanyName.toLowerCase().includes(q)) ||
          (d.forwardedToName && d.forwardedToName.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [demandRequests, currentEmployee, demandStatusFilter, searchTerm, employeeList]);

  // Open Issue modal for a demand request
  const handleOpenDepotIssue = (demand: DemandRequestItem) => {
    setSelectedDemandToIssue(demand);
    const requestingMachine = demand.requestingMachineName || demand.machineName || '';
    const requester = demand.createdByEmployeeName || demand.createdByEmail?.split('@')[0] || 'Depot Official';
    
    // Machine name auto fill
    setDepotIssueMachineName(requestingMachine);
    
    // Auto fill Zone & Division based on machine
    const autoZ = requestingMachine ? getMachineZone(requestingMachine) : 'South East Central Railway';
    const autoD = requestingMachine ? getMachineDivision(requestingMachine) : 'Raipur';
    setDepotIssueZone(autoZ || 'South East Central Railway');
    setDepotIssueDivision(autoD || 'Raipur');

    // Receiver details: requester name and machine/depot
    setDepotIssueReceiver(requester ? `${requester}${requestingMachine ? ` (${requestingMachine})` : ''}` : '');
    setDepotIssueDate(format(new Date(), 'yyyy-MM-dd'));
    
    // Remarks: Empty by default (remarks me auto fill n rahe)
    setDepotIssueRemarks('');

    // Initialize PL No and Part No from demand
    setDepotIssuePlNo(demand.plNo || '');
    setDepotIssuePartNo(demand.partNo || '');

    // Match parts in stock
    const matchingStockParts = findStockForDemand(demand);
    if (matchingStockParts.length > 0) {
      const bestPart = matchingStockParts[0];
      setDepotSelectedPartId(bestPart.id);
      setDepotIssueQty(Math.min(demand.qty || 1, bestPart.stock || 1));
      setDepotIssueRate(bestPart.rate || demand.rate || 0);
    } else {
      setDepotSelectedPartId('');
      setDepotIssueQty(demand.qty || 1);
      setDepotIssueRate(demand.rate || 0);
    }
    setShowDepotIssueModal(true);
  };

  // Submit Issue for a demand request
  const handleConfirmDepotIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemandToIssue) return;

    if (depotIssueQty <= 0) {
      toast.error('Issue quantity must be greater than 0');
      return;
    }

    const availableStock = findStockForDemand(selectedDemandToIssue);
    const chosenStockItem = availableStock.find(s => s.id === depotSelectedPartId);

    if (chosenStockItem && depotIssueQty > chosenStockItem.stock) {
      toast.error(`Quantity cannot exceed available stock (${chosenStockItem.stock} ${chosenStockItem.unit || 'Nos'}).`);
      return;
    }

    setSubmittingDepotIssue(true);
    try {
      const batch = writeBatch(db);
      const generatedIssueNoteNo = `ISS-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const requestingDepot = depotIssueMachineName || selectedDemandToIssue.requestingMachineName || selectedDemandToIssue.machineName || 'User Depot';
      const finalPlNo = depotIssuePlNo || selectedDemandToIssue.plNo || chosenStockItem?.plNo || '';
      const finalPartNo = depotIssuePartNo || selectedDemandToIssue.partNo || chosenStockItem?.partNo || '';
      const finalRate = depotIssueRate || chosenStockItem?.rate || selectedDemandToIssue.rate || 0;

      // Issuing Depot:
      // Company Light Admin issues from Store (e.g. "Store" or "<Company> Store")
      // Other accounts issue from their Machine inventory
      const rawIssuingDepot = isCompanyLightAdmin
        ? (currentUserCompanyName ? `${currentUserCompanyName} Store` : 'Store')
        : (userMachine || chosenStockItem?.companyName || 'Central Depot');
      const cleanIssuingDepot = rawIssuingDepot.replace(/^SSE\/TM\//i, '').trim();

      // Rule: ISSUED BY / DEPOT OFFICIAL: Show issuing employee's name and designation dynamically
      const issuerName = currentEmployee?.name || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'DEPOT OFFICIAL';
      const issuerDesignation = currentEmployee?.designation || (isCompanyLightAdmin ? 'Store Manager' : '');

      // 1. Deduct Stock
      if (isCompanyLightAdmin) {
        // Company Light Admin: Deduct from STORE (`store_items`)
        const matchedStoreItem = storeItems.find(s => s.id === depotSelectedPartId);
        if (matchedStoreItem) {
          const storeItemRef = doc(db, 'store_items', matchedStoreItem.id);
          const newStock = Math.max(0, matchedStoreItem.stock - depotIssueQty);
          const newTotalVal = newStock * (matchedStoreItem.rate || 0);
          batch.update(storeItemRef, {
            stock: newStock,
            totalValue: newTotalVal,
            updatedAt: new Date().toISOString(),
          });

          // Log in `store_issues`
          const storeIssueRef = doc(collection(db, 'store_issues'));
          batch.set(storeIssueRef, {
            issueNoteNo: generatedIssueNoteNo,
            storeItemId: matchedStoreItem.id,
            plNo: finalPlNo,
            partNo: finalPartNo,
            description: selectedDemandToIssue.description || matchedStoreItem.description,
            qty: depotIssueQty,
            unit: selectedDemandToIssue.unit || matchedStoreItem.unit || 'Nos',
            rate: finalRate,
            totalValue: depotIssueQty * finalRate,
            issuingCompany: currentUserCompanyName || matchedStoreItem.companyName || 'General Store',
            targetType: 'machine',
            targetMachine: requestingDepot,
            receiverName: depotIssueReceiver,
            issuedBy: issuerName,
            officerDesignation: issuerDesignation,
            date: depotIssueDate,
            remarks: depotIssueRemarks,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        // Other users: Deduct from INVENTORY (`parts`)
        const matchedPart = parts.find(p => p.id === depotSelectedPartId);
        if (matchedPart) {
          const partRef = doc(db, 'parts', matchedPart.id);
          const newStock = Math.max(0, matchedPart.stock - depotIssueQty);
          const newTotalVal = newStock * (matchedPart.rate || 0);
          batch.update(partRef, {
            stock: newStock,
            totalValue: newTotalVal,
          });
        }
      }

      // Log in central `issues` for Issue Report (both Company Store and Machine Depot issues)
      const issuesRef = doc(collection(db, 'issues'));
      batch.set(issuesRef, {
        issueNoteNo: generatedIssueNoteNo,
        date: depotIssueDate,
        plNo: finalPlNo,
        partNo: finalPartNo,
        description: selectedDemandToIssue.description || chosenStockItem?.description || (chosenStockItem as any)?.partName || 'Track Machine Consumable Spares',
        qty: depotIssueQty,
        unit: selectedDemandToIssue.unit || chosenStockItem?.unit || 'Nos',
        rate: finalRate,
        totalValue: depotIssueQty * finalRate,
        machineName: requestingDepot,
        targetMachine: requestingDepot,
        targetMachineName: requestingDepot,
        issuingMachine: cleanIssuingDepot,
        issuingDepot: cleanIssuingDepot,
        companyName: currentUserCompanyName || (chosenStockItem?.companyName || ''),
        zone: depotIssueZone || getMachineZone(requestingDepot) || 'South East Central Railway',
        division: depotIssueDivision || getMachineDivision(requestingDepot) || 'Raipur',
        location: isCompanyLightAdmin ? (chosenStockItem?.location || 'Store') : (chosenStockItem?.location || cleanIssuingDepot),
        receivedBy: depotIssueReceiver,
        issuedBy: issuerName,
        issuedByDesignation: issuerDesignation,
        remarks: depotIssueRemarks || `Issued to user depot ${requestingDepot}`,
        demandNo: selectedDemandToIssue.demandNo || '',
        isUserDepotIssue: true,
        createdAt: new Date().toISOString(),
      });

      // 2. Update Demand document
      const demandRef = doc(db, 'demands', selectedDemandToIssue.id);
      batch.update(demandRef, {
        status: 'approved',
        giveQty: depotIssueQty,
        plNo: finalPlNo,
        partNo: finalPartNo,
        rate: finalRate,
        issuedFromMachine: cleanIssuingDepot,
        requestingMachineName: requestingDepot,
        issueNoteNo: generatedIssueNoteNo,
        lastActionByUid: auth.currentUser?.uid || '',
        lastActionByEmail: auth.currentUser?.email || '',
        lastActionByName: issuerName,
        lastActionByCompanyName: currentUserCompanyName || '',
        lastActionDate: depotIssueDate,
        isInterMachineIssue: Boolean(cleanIssuingDepot && requestingDepot && cleanIssuingDepot !== requestingDepot),
        issuedToEmployeeId: selectedDemandToIssue.createdByEmployeeId || '',
        issuedToEmployeeName: selectedDemandToIssue.createdByEmployeeName || '',
        issuedToUid: selectedDemandToIssue.createdByUid || '',
        issuedToEmail: selectedDemandToIssue.createdByEmail || '',
        issuedToPfNo: selectedDemandToIssue.createdByPfNo || '',
      });

      // 3. Add to Transactions
      const transRef = doc(collection(db, 'transactions'));
      const itemCond = chosenStockItem?.itemCondition || (selectedDemandToIssue.whetherUse || 'New');
      batch.set(transRef, {
        partId: chosenStockItem?.id || selectedDemandToIssue.id,
        plNo: finalPlNo,
        partNo: finalPartNo,
        rate: finalRate,
        totalValue: depotIssueQty * finalRate,
        type: 'issued',
        qty: depotIssueQty,
        unit: selectedDemandToIssue.unit || chosenStockItem?.unit || 'Nos',
        date: depotIssueDate,
        remarks: depotIssueRemarks,
        receiverName: depotIssueReceiver,
        details: isCompanyLightAdmin
          ? `Issued from Store to User Depot (${requestingDepot}) against Demand ${selectedDemandToIssue.demandNo || selectedDemandToIssue.id} [Condition: ${itemCond}]`
          : `Issued to User Depot (${requestingDepot}) against Demand ${selectedDemandToIssue.demandNo || selectedDemandToIssue.id} [Condition: ${itemCond}]`,
        machineName: cleanIssuingDepot,
        targetMachineName: requestingDepot,
        voucherNo: generatedIssueNoteNo,
        demandNo: selectedDemandToIssue.demandNo || '',
        zone: depotIssueZone || getMachineZone(requestingDepot) || 'South East Central Railway',
        division: depotIssueDivision || getMachineDivision(requestingDepot) || 'Raipur',
        companyName: currentUserCompanyName || '',
        isUserDepotIssue: true,
        itemCondition: itemCond,
        whetherUse: itemCond,
        createdByUid: selectedDemandToIssue.createdByUid || '',
        createdByEmail: selectedDemandToIssue.createdByEmail || '',
        createdByPfNo: selectedDemandToIssue.createdByPfNo || '',
        createdByEmployeeName: selectedDemandToIssue.createdByEmployeeName || '',
        issuedToEmployeeId: selectedDemandToIssue.createdByEmployeeId || '',
        issuedToPfNo: selectedDemandToIssue.createdByPfNo || '',
        issuedToName: selectedDemandToIssue.createdByEmployeeName || depotIssueReceiver || '',
      });

      // Recipient Notification for the creator so they know it is available in their Account section
      if (selectedDemandToIssue.createdByEmail) {
        const notifRef = doc(collection(db, 'notifications'));
        batch.set(notifRef, {
          targetEmail: selectedDemandToIssue.createdByEmail,
          title: 'Item Issued for Your Demand! (सामग्री जारी कर दी गई है)',
          message: `Your demand (${selectedDemandToIssue.demandNo || selectedDemandToIssue.id}) for ${selectedDemandToIssue.description || finalPlNo} has been issued (${depotIssueQty} ${selectedDemandToIssue.unit || 'Nos'}) by ${issuerName} from ${cleanIssuingDepot}. It is now ready to be received in your Account (खाता / Accountal) section.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'demand_issued',
          demandId: selectedDemandToIssue.id,
          voucherNo: generatedIssueNoteNo,
        });
      }

      // Note: User Depot issues are strictly reported in Issue Report and excluded from Inbox Report per user requirement.

      await batch.commit();
      toast.success(isCompanyLightAdmin ? `Demand successfully issued from Store to user depot ${requestingDepot}!` : `Demand successfully issued to user depot ${requestingDepot}!`);

      // 5. Generate & download Issue Note PDF
      const targetZone = depotIssueZone || machinePositions[requestingDepot]?.zone || 'South East Central Railway';
      try {
        await generateIssueNotePDF({
          issueNoteNo: generatedIssueNoteNo,
          date: depotIssueDate || format(new Date(), 'yyyy-MM-dd'),
          plNo: finalPlNo,
          partNo: finalPartNo,
          description: selectedDemandToIssue.description || chosenStockItem?.description || '',
          qty: depotIssueQty,
          unit: selectedDemandToIssue.unit || chosenStockItem?.unit || 'Nos',
          rate: finalRate,
          totalValue: depotIssueQty * finalRate,
          issuingDepot: cleanIssuingDepot,
          machineName: requestingDepot,
          issuedTo: depotIssueReceiver || 'Consignee Officer',
          issuedBy: issuerName,
          officerName: issuerName,
          officerDesignation: issuerDesignation,
          consigneeDepot: requestingDepot.startsWith('SSE/TM/') ? requestingDepot : `SSE/TM/${requestingDepot}`,
          remarks: depotIssueRemarks || '',
          zone: targetZone,
          demandRefNo: selectedDemandToIssue.demandNo || '',
          demandDate: selectedDemandToIssue.date || '',
        }, true);
        toast.success('Issue Note PDF Voucher downloaded!');
      } catch (pdfErr) {
        console.error('Error generating Issue Note PDF:', pdfErr);
      }

      setShowDepotIssueModal(false);
      setSelectedDemandToIssue(null);
      fetchParts();
    } catch (error) {
      console.error('Error issuing to user depot:', error);
      toast.error('Failed to issue to user depot.');
    } finally {
      setSubmittingDepotIssue(false);
    }
  };

  // Download Issue Note PDF for existing issued demand
  const handleDownloadDepotIssuePDF = async (demand: DemandRequestItem) => {
    const requestingDepot = demand.requestingMachineName || demand.machineName || 'User Depot';
    const targetZone = machinePositions[requestingDepot]?.zone || 'South East Central Railway';
    const cleanIssuingDepot = (demand.issuedFromMachine || userMachine || 'Depot').replace(/^SSE\/TM\//i, '').trim();
    const issuerName = demand.lastActionByName || currentEmployee?.name || 'DEPOT OFFICIAL';

    try {
      await generateIssueNotePDF({
        issueNoteNo: demand.issueNoteNo || `ISS-${format(new Date(), 'yy')}-0000`,
        date: demand.lastActionDate || demand.date || format(new Date(), 'yyyy-MM-dd'),
        plNo: demand.plNo || '',
        partNo: demand.partNo || '',
        description: demand.description || '',
        qty: demand.giveQty || demand.qty || 0,
        unit: demand.unit || 'Nos',
        rate: demand.rate || 0,
        totalValue: (demand.giveQty || demand.qty || 0) * (demand.rate || 0),
        issuingDepot: cleanIssuingDepot,
        machineName: requestingDepot,
        issuedTo: demand.createdByEmployeeName || 'Consignee Officer',
        issuedBy: issuerName,
        officerName: issuerName,
        officerDesignation: currentEmployee?.designation || '',
        consigneeDepot: requestingDepot.startsWith('SSE/TM/') ? requestingDepot : `SSE/TM/${requestingDepot}`,
        remarks: demand.remarks || '',
        zone: targetZone,
        demandRefNo: demand.demandNo || '',
        demandDate: demand.date || '',
      }, true);
      toast.success('Issue Note PDF downloaded!');
    } catch (err) {
      console.error('PDF error:', err);
      toast.error('Failed to generate PDF.');
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
          
          {/* View Tab Switcher: Issue from Stock vs To User Depot */}
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200/70 shadow-2xs">
            <button
              onClick={() => setIssueViewTab('inventory')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                issueViewTab === 'inventory' 
                  ? "bg-white text-primary shadow-xs" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Package size={14} />
              Issue from Stock
            </button>
            <button
              onClick={() => setIssueViewTab('to-user-depot')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative",
                issueViewTab === 'to-user-depot' 
                  ? "bg-white text-indigo-700 shadow-xs" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Send size={14} />
              To user depot
              {pendingDepotDemands.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-600 text-white font-black animate-pulse">
                  {pendingDepotDemands.length}
                </span>
              )}
            </button>
          </div>

          {(!isEmployee || isAdmin) && (
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
                className={cn(
                  "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in",
                  !filterPerms.canChangeMachine && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                )}
                value={selectedMachine}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedMachine(val);
                  if (val !== 'all') {
                    const pos = machinePositions[val];
                    if (pos) {
                      if (pos.zone && filterPerms.canChangeZone) setFilterZone(pos.zone);
                      if (pos.division && filterPerms.canChangeDivision) setFilterDivision(pos.division);
                    }
                    if (!isEmployee) {
                      getCompanyByMachine(val).then(c => {
                        if (c) {
                          setSelectedCompany(c);
                        } else {
                          const empMatch = employeeList.find(emp => emp.machineName === val && emp.companyName);
                          if (empMatch?.companyName) {
                            setSelectedCompany(empMatch.companyName);
                          }
                        }
                      }).catch(() => {
                        const empMatch = employeeList.find(emp => emp.machineName === val && emp.companyName);
                        if (empMatch?.companyName) {
                          setSelectedCompany(empMatch.companyName);
                        }
                      });
                    }
                  }
                }}
                disabled={!filterPerms.canChangeMachine}
                title={!filterPerms.canChangeMachine ? "Machine filter locked to your assigned machine" : "Select Machine"}
              >
                <option value="all">All Machines</option>
                {(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'divisional-admin' || userAccessType === 'full')
                  ? Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                  : allMachinesList
                ).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              <select
                className={cn(
                  "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in",
                  !filterPerms.canChangeZone && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                )}
                value={filterZone}
                onChange={(e) => {
                  if (!filterPerms.canChangeZone) return;
                  const newZ = e.target.value;
                  setFilterZone(newZ);
                  setFilterDivision('all');
                  if (newZ !== 'all' && selectedMachine !== 'all' && filterPerms.canChangeMachine) {
                    const pos = machinePositions[selectedMachine];
                    if (pos && pos.zone && pos.zone !== newZ) {
                      setSelectedMachine('all');
                    }
                  }
                }}
                disabled={!filterPerms.canChangeZone}
                title={!filterPerms.canChangeZone ? "Zone filter locked to your assigned zone" : "Select Zone"}
              >
                <option value="all">All Zones</option>
                {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>

              <select
                className={cn(
                  "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in disabled:opacity-50",
                  (!filterPerms.canChangeDivision || filterZone === 'all') && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                )}
                value={filterDivision}
                disabled={!filterPerms.canChangeDivision || filterZone === 'all'}
                onChange={(e) => {
                  if (!filterPerms.canChangeDivision) return;
                  const newD = e.target.value;
                  setFilterDivision(newD);
                  if (newD !== 'all' && selectedMachine !== 'all' && filterPerms.canChangeMachine) {
                    const pos = machinePositions[selectedMachine];
                    if (pos && pos.division && pos.division !== newD) {
                      setSelectedMachine('all');
                    }
                  }
                }}
                title={!filterPerms.canChangeDivision ? "Division filter locked to your assigned division" : "Select Division"}
              >
                <option value="all">All Divisions</option>
                {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

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

      {issueViewTab === 'inventory' && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-surface-container-low p-4 rounded-lg flex items-center gap-3 text-sm text-on-surface-variant border border-outline-variant/20"
        >
          <AlertCircle className="text-primary" size={20} />
          Only items with available stock are displayed here for issuance.
        </motion.div>
      )}
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
        {issueViewTab === 'inventory' ? (
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
                      {canIssueThisPart(part) ? (
                        <button
                          id={`issue-btn-${part.id}`}
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
                          className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-5 py-2.5 rounded-lg text-xs font-black shadow-md hover:from-indigo-700 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all transform cursor-pointer"
                        >
                          Issue Item <Send size={14} />
                        </button>
                      ) : (
                        <button
                          id={`issue-btn-${part.id}`}
                          disabled
                          title={`यह सामान मशीन ${part.machineName || 'N/A'} को आवंटित है। केवल इस मशीन के कर्मचारी ही इसे जारी कर सकते हैं।`}
                          className="flex items-center gap-1.5 bg-slate-100 text-slate-400 cursor-not-allowed px-4 py-2.5 rounded-lg text-xs font-bold border border-slate-200 shadow-2xs select-none opacity-80"
                        >
                          <Lock size={13} /> Machine Locked
                        </button>
                      )}
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
        ) : (
          /* TO USER DEPOT DEMAND REQUESTS VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {filteredDemandRequests.map((demand, idx) => {
                const requestingDepot = demand.requestingMachineName || demand.machineName || 'User Depot';
                const requester = demand.createdByEmployeeName || demand.createdByEmail?.split('@')[0] || 'User';
                const matchedStock = findStockForDemand(demand);
                const totalStockAvailable = matchedStock.reduce((acc, p) => acc + (p.stock || 0), 0);
                const isPending = demand.status === 'pending';
                const isIssued = ['approved', 'completed'].includes(demand.status);

                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: idx * 0.04 }}
                    key={demand.id}
                    className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 hover:border-indigo-400/50 hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div>
                      {/* Top Header of Demand Card */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-mono font-black bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200/60">
                              {demand.demandNo || demand.id.slice(0, 10)}
                            </span>
                            <span className={cn(
                              "text-[10px] font-black uppercase px-2 py-0.5 rounded-full border shadow-2xs flex items-center gap-1",
                              isPending ? "bg-amber-50 text-amber-800 border-amber-200" :
                              isIssued ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                              "bg-slate-100 text-slate-700 border-slate-200"
                            )}>
                              {isPending ? '⏳ Pending Issue' : isIssued ? '✅ Issued' : demand.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-semibold mt-1">
                            📅 {demand.date}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-black text-slate-900 bg-slate-100 px-2 py-1 rounded-md block">
                            To: {requestingDepot}
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium">
                            By {requester}
                          </span>
                        </div>
                      </div>

                      {/* Part Details */}
                      <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 mb-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono font-bold text-slate-700">PL: {demand.plNo || 'N/A'}</span>
                          <span className="text-[11px] font-mono text-slate-500">Part: {demand.partNo || 'N/A'}</span>
                        </div>
                        <h4 className="text-xs font-black text-slate-800 line-clamp-2 leading-snug">
                          {demand.description || 'No description provided'}
                        </h4>
                        {demand.remarks && (
                          <p className="text-[10px] text-slate-500 italic line-clamp-1">
                            Note: {demand.remarks}
                          </p>
                        )}
                      </div>

                      {/* Stock & Demand Quantities */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                          <div className="text-[10px] uppercase font-bold text-indigo-600">Demanded Qty</div>
                          <div className="text-base font-black text-indigo-950">
                            {demand.qty} <span className="text-xs font-semibold text-indigo-700">{demand.unit || 'Nos'}</span>
                          </div>
                        </div>
                        <div className={cn(
                          "p-2.5 rounded-xl border",
                          totalStockAvailable >= demand.qty
                            ? "bg-emerald-50/60 border-emerald-200 text-emerald-950"
                            : totalStockAvailable > 0
                            ? "bg-amber-50/60 border-amber-200 text-amber-950"
                            : "bg-red-50/60 border-red-200 text-red-950"
                        )}>
                          <div className="text-[10px] uppercase font-bold text-slate-600">Depot In-Stock</div>
                          <div className="text-base font-black">
                            {totalStockAvailable} <span className="text-xs font-semibold text-slate-600">{demand.unit || 'Nos'}</span>
                          </div>
                        </div>
                      </div>

                      {demand.issueNoteNo && (
                        <div className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200/80 mb-3 flex items-center justify-between">
                          <span>Voucher No:</span>
                          <span className="font-black">{demand.issueNoteNo}</span>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      {isPending ? (
                        <button
                          onClick={() => handleOpenDepotIssue(demand)}
                          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-md hover:shadow-lg active:scale-95 transition-all"
                        >
                          Issue to User Depot <ArrowRight size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownloadDepotIssuePDF(demand)}
                          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs active:scale-95 transition-all"
                        >
                          <FileDown size={14} /> Download Issue Note (PDF)
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {filteredDemandRequests.length === 0 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="col-span-full py-16 px-6 text-center bg-white rounded-3xl border-2 border-dashed border-indigo-100 flex flex-col items-center justify-center shadow-xs"
              >
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 shadow-2xs">
                  <Inbox size={32} />
                </div>
                <h3 className="text-base font-black text-slate-800 mb-1">
                  No Demands Forwarded to Your Account
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mb-2 leading-relaxed">
                  Only demands forwarded specifically to your account ({currentEmployee?.name || auth.currentUser?.email}) appear here. Items forwarded to other machine employees or depot officials are protected and kept isolated.
                </p>
              </motion.div>
            )}
          </div>
        )}
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

      {/* To User Depot Issue Modal */}
      <AnimatePresence>
        {showDepotIssueModal && selectedDemandToIssue && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl my-auto border border-slate-200"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex justify-between items-center border-b border-indigo-950/50">
                <div>
                  <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                    Issue Material to User Depot (उपयोगकर्ता डिपो को सामग्री जारी करें)
                    {isCompanyLightAdmin ? (
                      <span className="text-xs bg-purple-500/20 text-purple-200 border border-purple-400/40 px-2.5 py-0.5 rounded-full font-bold">
                        From Store
                      </span>
                    ) : (
                      <span className="text-xs bg-blue-500/20 text-blue-200 border border-blue-400/40 px-2.5 py-0.5 rounded-full font-bold">
                        From Inventory
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-indigo-200 mt-1">
                    To Machine / Depot: <strong>{selectedDemandToIssue.requestingMachineName || selectedDemandToIssue.machineName || 'User Depot'}</strong> • Demanded By: {selectedDemandToIssue.createdByEmployeeName || selectedDemandToIssue.createdByEmail}
                    {isCompanyLightAdmin ? ' • Fulfilling from Store Inventory' : ` • Fulfilling from ${userMachine || 'Machine'} Inventory`}
                  </p>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setShowDepotIssueModal(false);
                    setSelectedDemandToIssue(null);
                  }}
                  className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleConfirmDepotIssue} className="p-6 space-y-4 max-h-[84vh] overflow-y-auto">
                {/* Landscape Layout Grid: 2 Columns for spacious horizontal arrangement */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  
                  {/* Left Column: Stock Selection, Item Identifiers (PL / Part), Rate, Total Value */}
                  <div className="space-y-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                    {/* Stock Matching & Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-black text-slate-700">
                          {isCompanyLightAdmin 
                            ? 'Select Store Item to Deduct From (स्टोर स्टॉक चुनें):' 
                            : 'Select Depot Stock Item to Deduct From (डिपो स्टॉक चुनें):'}
                        </label>
                        {isCompanyLightAdmin ? (
                          <span className="text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 px-2 py-0.5 rounded-md border border-purple-200 flex items-center gap-1">
                            <Building2 size={11} /> Store Stock
                          </span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md border border-blue-200 flex items-center gap-1">
                            <Package size={11} /> Depot Stock
                          </span>
                        )}
                      </div>
                      {findStockForDemand(selectedDemandToIssue).length > 0 ? (
                        <div className="space-y-1.5">
                          <select
                            value={depotSelectedPartId}
                            onChange={(e) => {
                              const chosenId = e.target.value;
                              setDepotSelectedPartId(chosenId);
                              const chosen = findStockForDemand(selectedDemandToIssue).find(p => p.id === chosenId);
                              if (chosen) {
                                setDepotIssueQty(Math.min(selectedDemandToIssue.qty || 1, chosen.stock || 1));
                                setDepotIssueRate(chosen.rate || 0);
                                if (isPlEditable(selectedDemandToIssue.plNo) && chosen.plNo) {
                                  setDepotIssuePlNo(chosen.plNo);
                                }
                                if (isPartNoEditable(selectedDemandToIssue.partNo) && chosen.partNo) {
                                  setDepotIssuePartNo(chosen.partNo);
                                }
                              }
                            }}
                            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                            required
                          >
                            {findStockForDemand(selectedDemandToIssue).map(item => (
                              <option key={item.id} value={item.id}>
                                PL: {item.plNo} | {item.description.slice(0, 30)}... | {item.isStore ? 'Store Stock' : 'Depot Stock'}: {item.stock} {item.unit || 'Nos'} | Rate: ₹{item.rate || 0} {item.location ? `| Loc: ${item.location}` : ''}
                              </option>
                            ))}
                          </select>
                          {depotSelectedPartId && (
                            <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold">
                              <CheckCircle2 size={14} className="shrink-0" />
                              Available in {isCompanyLightAdmin ? 'Store' : 'Depot'}: {findStockForDemand(selectedDemandToIssue).find(p => p.id === depotSelectedPartId)?.stock || 0} {selectedDemandToIssue.unit || 'Nos'} (Rate: ₹{findStockForDemand(selectedDemandToIssue).find(p => p.id === depotSelectedPartId)?.rate || 0})
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2.5 rounded-xl text-xs flex items-center gap-2">
                          <AlertCircle size={15} className="shrink-0" />
                          {isCompanyLightAdmin
                            ? `No matching item found in Store for PL ${selectedDemandToIssue.plNo || 'N/A'}. Direct issuance will be recorded.`
                            : `No matching item found in ${userMachine || 'depot'} inventory for PL ${selectedDemandToIssue.plNo || 'N/A'}. Direct issuance will be recorded.`}
                        </div>
                      )}
                    </div>

                    {/* PL Number & Part Number - Editable if NA / N/A, otherwise read-only */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          PL No. (पीएल नंबर)
                        </label>
                        <input
                          type="text"
                          value={depotIssuePlNo}
                          onChange={(e) => setDepotIssuePlNo(e.target.value)}
                          disabled={!isPlEditable(selectedDemandToIssue.plNo)}
                          placeholder="Enter PL Number"
                          className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none transition-all ${
                            isPlEditable(selectedDemandToIssue.plNo)
                              ? 'bg-white border-indigo-300 text-indigo-900 focus:ring-2 focus:ring-indigo-500 shadow-sm'
                              : 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Part No. (पार्ट नंबर)
                        </label>
                        <input
                          type="text"
                          value={depotIssuePartNo}
                          onChange={(e) => setDepotIssuePartNo(e.target.value)}
                          disabled={!isPartNoEditable(selectedDemandToIssue.partNo)}
                          placeholder="Enter Part Number"
                          className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none transition-all ${
                            isPartNoEditable(selectedDemandToIssue.partNo)
                              ? 'bg-white border-indigo-300 text-indigo-900 focus:ring-2 focus:ring-indigo-500 shadow-sm'
                              : 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Rate and Total Rate (Value) Display & Input */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Item Rate (दर प्रति इकाई ₹) *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                            ₹
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={depotIssueRate || ''}
                            onChange={(e) => setDepotIssueRate(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="w-full border border-slate-300 rounded-xl pl-7 pr-3 py-2 text-xs font-black text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Total Rate / Value (कुल मूल्य ₹)
                        </label>
                        <div className="w-full border border-emerald-300 bg-emerald-50/80 rounded-xl px-3 py-2 text-xs font-black text-emerald-900 shadow-sm">
                          ₹{(depotIssueQty * depotIssueRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Right Column: Machine Name Auto-fill, Receiver's Details, Qty, Date, Remarks */}
                  <div className="space-y-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                    {/* Quantity & Date Row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Issue Quantity (जारी मात्रा) *
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            max={depotSelectedPartId ? (findStockForDemand(selectedDemandToIssue).find(p => p.id === depotSelectedPartId)?.stock || selectedDemandToIssue.qty) : undefined}
                            value={depotIssueQty}
                            onChange={(e) => setDepotIssueQty(parseInt(e.target.value) || 1)}
                            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                            required
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                            {selectedDemandToIssue.unit || 'Nos'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 mt-0.5 block">
                          Demanded: {selectedDemandToIssue.qty} {selectedDemandToIssue.unit || 'Nos'}
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Issue Date (जारी करने की तिथि) *
                        </label>
                        <input
                          type="date"
                          value={depotIssueDate}
                          onChange={(e) => setDepotIssueDate(e.target.value)}
                          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                          required
                        />
                      </div>
                    </div>

                    {/* Machine Name: Direct Dropdown Selector */}
                    <div>
                      <label className="block text-xs font-black text-slate-700 mb-1">
                        Machine Name (मशीन का नाम) *
                      </label>
                      <select
                        value={depotIssueMachineName}
                        onChange={(e) => handleDepotMachineChange(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer"
                        required
                      >
                        <option value="">-- Select Machine (मशीन चुनें) --</option>
                        {depotIssueMachineName && !allMachinesList.includes(depotIssueMachineName) && (
                          <option value={depotIssueMachineName}>{depotIssueMachineName}</option>
                        )}
                        {allMachinesList.map(m => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Railway Zone & Division */}
                    <div className="grid grid-cols-2 gap-3 bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Railway Zone
                        </label>
                        <input
                          type="text"
                          value={depotIssueZone}
                          onChange={(e) => setDepotIssueZone(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1">
                          Railway Division
                        </label>
                        <input
                          type="text"
                          value={depotIssueDivision}
                          onChange={(e) => setDepotIssueDivision(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Receiver's Details: Receiver Name & Depot, filled after Machine Name */}
                    <div>
                      <label className="block text-xs font-black text-slate-700 mb-1">
                        Receiver Name & Depot (प्राप्तकर्ता का नाम व डिपो) *
                      </label>
                      <input
                        type="text"
                        value={depotIssueReceiver}
                        onChange={(e) => setDepotIssueReceiver(e.target.value)}
                        placeholder="e.g. Rahul Sharma (SSE/TM/BCM-012)"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                        required
                      />
                    </div>

                    {/* Remarks: No auto-fill, kept clean for custom input */}
                    <div>
                      <label className="block text-xs font-black text-slate-700 mb-1">
                        Remarks / Issue Note Details
                      </label>
                      <textarea
                        rows={2}
                        value={depotIssueRemarks}
                        onChange={(e) => setDepotIssueRemarks(e.target.value)}
                        placeholder="Enter remarks, challan reference or note here..."
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none shadow-sm"
                      />
                    </div>

                  </div>

                </div>

                {/* Form Footer Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <div className="text-xs font-bold text-slate-700">
                    Total: ₹{(depotIssueQty * depotIssueRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₹{depotIssueRate || 0} / {selectedDemandToIssue.unit || 'Nos'})
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDepotIssueModal(false);
                        setSelectedDemandToIssue(null);
                      }}
                      className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                    >
                      Cancel (रद्द करें)
                    </button>
                    <button
                      type="submit"
                      disabled={submittingDepotIssue}
                      className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-xs font-black rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 disabled:opacity-50"
                    >
                      {submittingDepotIssue ? <Loader2 className="animate-spin" size={16} /> : null}
                      Issue to {depotIssueMachineName || selectedDemandToIssue.requestingMachineName || selectedDemandToIssue.machineName || 'Depot'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
