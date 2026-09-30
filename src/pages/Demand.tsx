import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDoc, getDocs, updateDoc, setDoc, doc, query, where, writeBatch, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Plus, Search, CheckCircle, XCircle, Clock, X, Loader2, Edit, Trash2, ArrowUpRight, Camera, Upload, Download, Eye, Image as ImageIcon, FileText, Printer, PackageCheck } from 'lucide-react';
import { compressImage } from '../utils/imageCompressor';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { generateDemandPDF } from '../utils/pdfGenerator';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { getCompanyByMachine } from '../utils/contracts';

export interface Demand {
  id: string;
  demandNo?: string;
  plNo: string;
  partNo?: string;
  description?: string;
  qty: number;
  unit?: string;
  date: string;
  status: 'pending' | 'completed' | 'rejected' | 'returned' | 'approved';
  giveQty?: number;
  approvedRate?: number;
  rate?: number;
  location?: string;
  issueNoteNo?: string;
  receivedQty?: number;
  receivedDate?: string;
  receipts?: Array<{
    qty: number;
    date: string;
    remarks?: string;
  }>;
  whetherUse?: string;
  remarks?: string;
  forwardedTo?: string;
  forwardedToName?: string;
  forwardedToEmail?: string;
  createdByUid?: string;
  createdByEmail?: string;
  createdByEmployeeName?: string;
  createdByPfNo?: string;
  createdByCompanyName?: string;
  rejectReason?: string;
  machineName?: string;
  imageUrl?: string;
  forwardedToAdmin?: boolean;
  forwardedToAdminAt?: string;
  forwardedToCompanyAdmin?: boolean;
  forwardedToCompanyAdminAt?: string;
  forwardedAt?: string;
  forwardedByCompanyName?: string;
  isOtherMachineDemand?: boolean;
  requestingMachineName?: string;
  targetMachineName?: string;
  requestingZone?: string;
  requestingDivision?: string;
  requestingCompanyName?: string;
  issuedFromMachine?: string;
  issuedToMachine?: string;
  isInterMachineIssue?: boolean;
  customLogo?: string;
}

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
  category?: string;
  unit?: string;
}

import { findEmployeeForUser, getFilterAccessPermissions } from '../utils/employee';

export default function Demand() {
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const isPrimaryAdmin = !isEmployee;
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessType === 'full' || userAccessType === 'admin-light';
  });
  const [isLightAdmin, setIsLightAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return isEmployee && userAccessType === 'admin-light';
  });
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });

  // Demand PDF Logo is strictly restricted to Master Admin accounts only
  const isMasterAdmin = (!isEmployee || auth.currentUser?.email === 'imranansari399605@gmail.com') &&
                        userAccessType !== 'admin-light' &&
                        userAccessType !== 'zonal-admin' &&
                        userAccessType !== 'divisional-admin' &&
                        userAccessType !== 'limited';

  const [selectedMachine, setSelectedMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      const savedM = localStorage.getItem(`userMachineName_${auth.currentUser.uid}`);
      if (savedM) return savedM;
    }
    return 'all';
  });

  // 4 Radio Buttons Filter State: All, Pending, Received, Reject
  const [demandStatusFilter, setDemandStatusFilter] = useState<'all' | 'pending' | 'received' | 'rejected'>('all');

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
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const hasAssignedMachine = Boolean(
    userMachine &&
    userMachine.toLowerCase() !== 'all' &&
    userMachine.toLowerCase() !== 'none' &&
    userMachine.toLowerCase() !== 'n/a'
  );
  const [currentUserZone, setCurrentUserZone] = useState<string>(() => {
    return localStorage.getItem(`userZone_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserDivision, setCurrentUserDivision] = useState<string>(() => {
    return localStorage.getItem(`userDivision_${auth.currentUser?.uid}`) || '';
  });

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, userAccessType, null, {
      machineName: userMachine,
      zone: currentUserZone,
      division: currentUserDivision,
    });
  }, [isEmployee, userAccessType, userMachine, currentUserZone, currentUserDivision]);
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
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [settingsMachines, setSettingsMachines] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');

  const [fullAccessEmployees, setFullAccessEmployees] = useState<any[]>([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingDemand, setForwardingDemand] = useState<Demand | null>(null);
  const [selectedForwardEmployeeId, setSelectedForwardEmployeeId] = useState('');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingDemandId, setRejectingDemandId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  // States for demand tracking/details (eye button)
  const [trackingDemand, setTrackingDemand] = useState<Demand | null>(null);
  const [trackingLogs, setTrackingLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showTrackingModal, setShowTrackingModal] = useState(false);

  const handleShowTrackingDetails = async (demand: Demand) => {
    setTrackingDemand(demand);
    setShowTrackingModal(true);
    setLoadingLogs(true);
    try {
      const q = query(
        collection(db, 'demand_logs'),
        where('demandId', '==', demand.id)
      );
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort logs by timestamp ascending
      logs.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setTrackingLogs(logs);
    } catch (error) {
      console.error('Error fetching demand logs:', error);
      toast.error('Failed to load tracking details.');
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchFullAccessEmployees = async (compName?: string, myEmpId?: string) => {
    try {
      const snap = await getDocs(collection(db, 'employees'));
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      const myCompany = compName || currentEmployeeCompanyName || (auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) : '') || '';
      const curId = myEmpId || currentEmployeeId;

      const filtered = list.filter(emp => {
        const isNotMe = emp.id !== curId && emp.id !== auth.currentUser?.uid;
        if (!isNotMe) return false;

        // Exclude top-level / master admin
        if (emp.accessType === 'full' || emp.isTopAdmin || emp.id === 'admin') return false;

        // Only show employees of the SAME company
        if (myCompany) {
          return emp.companyName === myCompany;
        }
        return true;
      });
      setFullAccessEmployees(filtered);
    } catch (error) {
      console.error("Error fetching full access employees:", error);
    }
  };

  const [currentEmployeeName, setCurrentEmployeeName] = useState<string>('');
  const [currentEmployeePfNo, setCurrentEmployeePfNo] = useState<string>('');
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');
  const [currentEmployeeCompanyName, setCurrentEmployeeCompanyName] = useState<string>('');

  const checkIsIssued = useCallback((d: Demand | null | undefined): boolean => {
    if (!d) return false;
    const targetGiven = d.giveQty !== undefined ? d.giveQty : (d.qty || 0);
    const currentRecv = Number(d.receivedQty || 0);
    return d.status === 'completed' || 
           (currentRecv >= targetGiven && targetGiven > 0) ||
           (d.receivedQty !== undefined && Number(d.receivedQty) > 0) ||
           (d.giveQty !== undefined && Number(d.giveQty) > 0) ||
           d.status === 'approved';
  }, []);

  const checkIsCreator = useCallback((d: Demand | null | undefined): boolean => {
    if (!d) return false;
    const myUid = auth.currentUser?.uid || '';
    const myEmail = (auth.currentUser?.email || '').trim().toLowerCase();
    const myPf = (currentEmployeePfNo || '').trim().toLowerCase();
    const myEmpId = (currentEmployeeId || '').trim();

    const dUid = (d.createdByUid || '').trim();
    const dEmail = (d.createdByEmail || '').trim().toLowerCase();
    const dPf = (d.createdByPfNo || '').trim().toLowerCase();
    const dEmpId = ((d as any).createdByEmployeeId || '').trim();

    return Boolean(
      (myUid && dUid && myUid === dUid) ||
      (myEmail && dEmail && myEmail === dEmail) ||
      (myPf && dPf && myPf === dPf) ||
      (myEmpId && dEmpId && myEmpId === dEmpId)
    );
  }, [currentEmployeePfNo, currentEmployeeId]);

  useEffect(() => {
    const checkAccess = async () => {
      if (!auth.currentUser) return;
      const isEmployee = auth.currentUser.email?.endsWith('@employee.billedapp.com');
      if (isEmployee) {
        const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
        if (emp) {
          const isFull = emp.accessType === 'full' || emp.accessType === 'admin-light';
          localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
          localStorage.setItem(`companyName_${auth.currentUser.uid}`, emp.companyName || '');
          if (emp.zone) localStorage.setItem(`userZone_${auth.currentUser.uid}`, emp.zone);
          if (emp.division) localStorage.setItem(`userDivision_${auth.currentUser.uid}`, emp.division);
          
          setUserAccessType(emp.accessType || 'limited');
          setIsAdmin(isFull || emp.accessType === 'zonal-admin' || emp.accessType === 'divisional-admin');
          setIsLightAdmin(emp.accessType === 'admin-light');
          setCurrentEmployeeName(emp.name || '');
          setCurrentEmployeePfNo(emp.pfNo || '');
          setCurrentEmployeeId(emp.employeeId || '');
          setCurrentEmployeeCompanyName(emp.companyName || '');
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
          if (mName) {
            setSelectedMachine(mName);
          }
          if (emp.zone) {
            setCurrentUserZone(emp.zone);
            setFilterZone(emp.zone);
          }
          if (emp.division) {
            setCurrentUserDivision(emp.division);
            setFilterDivision(emp.division);
          }

          fetchFullAccessEmployees(emp.companyName, emp.employeeId);
        }
      } else {
        fetchFullAccessEmployees();
      }
    };
    checkAccess();
  }, []);

  const [demandLogo, setDemandLogo] = useState<string>(() => localStorage.getItem('demandLogo') || '');
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    const unsubscribeBranding = onSnapshot(doc(db, 'settings', 'app_branding'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.demandLogo !== undefined || data.appLogo !== undefined) {
          const l = data.demandLogo || data.appLogo || '';
          setDemandLogo(l);
          if (l) {
            localStorage.setItem('demandLogo', l);
          } else {
            localStorage.removeItem('demandLogo');
          }
        }
      }
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
        if (data.demandLogo !== undefined && !localStorage.getItem('demandLogo')) {
          setDemandLogo(data.demandLogo || '');
        }
      }
    });

    return () => {
      unsubscribeBranding();
      unsubscribeSettings();
    };
  }, []);

  const [demands, setDemands] = useState<Demand[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [parts, setParts] = useState<Record<string, number>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<Demand | null>(null);
  const [demandToDelete, setDemandToDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [newDemand, setNewDemand] = useState({
    plNo: '',
    partNo: '',
    description: '',
    qty: 0,
    unit: 'Nos',
    date: format(new Date(), 'yyyy-MM-dd'),
    whetherUse: 'CS',
    remarks: '',
    forwardedToId: '',
    machineName: '',
    imageUrl: '',
  });

  const [newDemandCustomUnit, setNewDemandCustomUnit] = useState('');

  // Demand from Other Machine states
  const [isOtherMachine, setIsOtherMachine] = useState(false);
  const [otherZone, setOtherZone] = useState('');
  const [otherDivision, setOtherDivision] = useState('');
  const [otherMachineName, setOtherMachineName] = useState('');

  // Auto-fill logic for PL No / Part No across all inventory & demands
  const findMatchingPartOrDemand = (plVal?: string, partVal?: string) => {
    const cleanPl = plVal?.trim().toLowerCase();
    const cleanPart = partVal?.trim().toLowerCase();

    if (!cleanPl && !cleanPart) return null;

    // 1. Search in fullPartsList (server inventory)
    const foundPart = fullPartsList.find(p => {
      if (cleanPl && p.plNo && p.plNo.trim().toLowerCase() === cleanPl) return true;
      if (cleanPart && p.partNo && p.partNo.trim().toLowerCase() === cleanPart) return true;
      return false;
    });

    if (foundPart) {
      return {
        plNo: foundPart.plNo || '',
        partNo: foundPart.partNo || '',
        description: foundPart.description || '',
        whetherUse: foundPart.whetherUse || foundPart.category || 'CS',
        unit: foundPart.unit || 'Nos'
      };
    }

    // 2. Search in demands state (server demands)
    const foundDemand = demands.find(d => {
      if (cleanPl && d.plNo && d.plNo.trim().toLowerCase() === cleanPl) return true;
      if (cleanPart && d.partNo && d.partNo.trim().toLowerCase() === cleanPart) return true;
      return false;
    });

    if (foundDemand) {
      return {
        plNo: foundDemand.plNo || '',
        partNo: foundDemand.partNo || '',
        description: foundDemand.description || '',
        whetherUse: foundDemand.whetherUse || 'CS',
        unit: foundDemand.unit || 'Nos'
      };
    }

    return null;
  };

  const handleNewDemandPlChange = (plVal: string) => {
    const match = findMatchingPartOrDemand(plVal, undefined);
    setNewDemand(prev => ({
      ...prev,
      plNo: plVal,
      partNo: match?.partNo || prev.partNo,
      description: match?.description || prev.description,
      whetherUse: match?.whetherUse || prev.whetherUse,
      unit: match?.unit || prev.unit,
    }));
  };

  const handleNewDemandPartNoChange = (partVal: string) => {
    const match = findMatchingPartOrDemand(undefined, partVal);
    setNewDemand(prev => ({
      ...prev,
      partNo: partVal,
      plNo: match?.plNo || prev.plNo,
      description: match?.description || prev.description,
      whetherUse: match?.whetherUse || prev.whetherUse,
      unit: match?.unit || prev.unit,
    }));
  };

  const [editDemandData, setEditDemandData] = useState<Demand>({
    id: '',
    plNo: '',
    partNo: '',
    description: '',
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'pending',
    whetherUse: 'CS',
    remarks: '',
    forwardedTo: '',
    forwardedToName: '',
    forwardedToEmail: '',
    createdByUid: '',
    createdByEmail: '',
    rejectReason: '',
    machineName: '',
    imageUrl: '',
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only JPG, JPEG, and PNG formats are allowed.');
      return;
    }

    if (file.size > 50 * 1024) {
      toast.error('Image size must be less than 50KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (isEdit) {
        setEditDemandData(prev => ({ ...prev, imageUrl: base64 }));
      } else {
        setNewDemand(prev => ({ ...prev, imageUrl: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  const [receiveData, setReceiveData] = useState({
    receivedQty: 0,
    receivedDate: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    rate: 0,
    remarks: '',
  });

  const [activeTab, setActiveTab] = useState<'demands' | 'unconnected'>('demands');
  const [fullPartsList, setFullPartsList] = useState<Part[]>([]);
  const [storeItemsList, setStoreItemsList] = useState<any[]>([]);

  // Map of inventory Unit of Measure (इकाई) from Catalog/Inventory (parts) & Store
  const inventoryUnitsMap = useMemo(() => {
    const map = new Map<string, string>();

    // 1. Process global parts catalog (primary inventory source)
    for (const p of fullPartsList) {
      if (!p.unit || !p.unit.trim()) continue;
      const u = p.unit.trim();
      const pMach = (p.machineName || '').trim().toLowerCase();
      const pPl = (p.plNo || '').trim().toLowerCase();
      const pPart = (p.partNo || '').trim().toLowerCase();
      const pDesc = (p.description || '').trim().toLowerCase();

      if (pMach && pPl && pPl !== 'n/a' && pPl !== '-') map.set(`${pMach}::pl::${pPl}`, u);
      if (pMach && pPart && pPart !== 'n/a' && pPart !== '-') map.set(`${pMach}::part::${pPart}`, u);
      if (pPl && pPl !== 'n/a' && pPl !== '-' && !map.has(`pl::${pPl}`)) map.set(`pl::${pPl}`, u);
      if (pPart && pPart !== 'n/a' && pPart !== '-' && !map.has(`part::${pPart}`)) map.set(`part::${pPart}`, u);
      if (pDesc && pDesc !== '-' && !map.has(`desc::${pDesc}`)) map.set(`desc::${pDesc}`, u);
    }

    // 2. Supplement with company store items if available
    for (const s of storeItemsList) {
      if (!s.unit || !s.unit.trim()) continue;
      const u = s.unit.trim();
      const sPl = (s.plNo || '').trim().toLowerCase();
      const sPart = (s.partNo || '').trim().toLowerCase();
      const sDesc = (s.description || '').trim().toLowerCase();

      if (sPl && sPl !== 'n/a' && sPl !== '-' && !map.has(`pl::${sPl}`)) map.set(`pl::${sPl}`, u);
      if (sPart && sPart !== 'n/a' && sPart !== '-' && !map.has(`part::${sPart}`)) map.set(`part::${sPart}`, u);
      if (sDesc && sDesc !== '-' && !map.has(`desc::${sDesc}`)) map.set(`desc::${sDesc}`, u);
    }

    return map;
  }, [fullPartsList, storeItemsList]);

  // Lookup function to return the Inventory Unit of Measure (इकाई) for a demand
  const getDemandDisplayUnit = useCallback((demand: Demand) => {
    const dMach = (demand.machineName || '').trim().toLowerCase();
    const dPl = (demand.plNo || '').trim().toLowerCase();
    const dPart = (demand.partNo || '').trim().toLowerCase();
    const dDesc = (demand.description || '').trim().toLowerCase();

    // Try machine-specific inventory match first
    if (dMach && dPl && inventoryUnitsMap.has(`${dMach}::pl::${dPl}`)) {
      return inventoryUnitsMap.get(`${dMach}::pl::${dPl}`)!;
    }
    if (dMach && dPart && inventoryUnitsMap.has(`${dMach}::part::${dPart}`)) {
      return inventoryUnitsMap.get(`${dMach}::part::${dPart}`)!;
    }

    // Try global inventory matches
    if (dPl && inventoryUnitsMap.has(`pl::${dPl}`)) {
      return inventoryUnitsMap.get(`pl::${dPl}`)!;
    }
    if (dPart && inventoryUnitsMap.has(`part::${dPart}`)) {
      return inventoryUnitsMap.get(`part::${dPart}`)!;
    }
    if (dDesc && inventoryUnitsMap.has(`desc::${dDesc}`)) {
      return inventoryUnitsMap.get(`desc::${dDesc}`)!;
    }

    return demand.unit || 'Nos';
  }, [inventoryUnitsMap]);

  // Background sync: updates pending demands in Firestore if their unit differs from inventory's Unit of Measure
  const syncedDemandUnitsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (demands.length === 0 || inventoryUnitsMap.size === 0) return;

    const syncDemands = async () => {
      const toUpdate: { id: string; unit: string }[] = [];
      for (const d of demands) {
        const isPending = d.status === 'pending' || d.status === 'approved' || (d.receivedQty !== undefined && d.receivedQty < (d.qty || 0));
        if (!isPending || syncedDemandUnitsRef.current.has(d.id)) continue;

        const invUnit = getDemandDisplayUnit(d);
        if (invUnit && invUnit !== d.unit) {
          toUpdate.push({ id: d.id, unit: invUnit });
          syncedDemandUnitsRef.current.add(d.id);
        }
      }

      if (toUpdate.length > 0) {
        try {
          const batch = writeBatch(db);
          toUpdate.slice(0, 50).forEach(item => {
            batch.update(doc(db, 'demands', item.id), { unit: item.unit });
          });
          await batch.commit();
        } catch (err) {
          console.error('Error auto-syncing demand units:', err);
        }
      }
    };

    syncDemands();
  }, [demands, inventoryUnitsMap, getDemandDisplayUnit]);

  // Collect all unique created machines from settings (authoritative) or defaults
  const allCreatedMachines = useMemo(() => {
    if (settingsMachines && settingsMachines.length > 0) {
      return Array.from(new Set(settingsMachines)).filter(Boolean).sort();
    }
    return ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"].sort();
  }, [settingsMachines]);
  const [allMovements, setAllMovements] = useState<any[]>([]);
  const [unconnectedReceipts, setUnconnectedReceipts] = useState<any[]>([]);
  const [showAddReceiptModal, setShowAddReceiptModal] = useState(false);
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('');

  const STANDARD_RECEIPT_UOMS = ["Nos", "Sets", "Mtr", "Kg", "Ltr", "Pairs", "Box", "Pkt", "Roll", "Foot", "Quintal", "Other"];

  const [receiptForm, setReceiptForm] = useState({
    voucherNo: '',
    zone: '',
    division: '',
    machineName: '',
    companyName: '',
    selectMode: 'machine' as 'machine' | 'employee',
    employeeId: '',
    employeeName: '',
    partNo: '',
    plNo: '',
    description: '',
    returnedDate: format(new Date(), 'yyyy-MM-dd'),
    qtyReturned: 0,
    unit: 'Nos',
    customUnit: '',
    location: '',
    remarks: '',
  });

  const [receiptSubmitting, setReceiptSubmitting] = useState(false);

  const [showEditReceiptModal, setShowEditReceiptModal] = useState(false);
  const [editReceiptForm, setEditReceiptForm] = useState<any>({
    id: '',
    voucherNo: '',
    zone: '',
    division: '',
    machineName: '',
    companyName: '',
    selectMode: 'machine' as 'machine' | 'employee',
    employeeId: '',
    employeeName: '',
    partNo: '',
    plNo: '',
    description: '',
    returnedDate: format(new Date(), 'yyyy-MM-dd'),
    qtyReturned: 0,
    unit: 'Nos',
    customUnit: '',
    location: '',
    remarks: '',
  });

  // Auto-population side-effect on Edit Date/Machine/Employee changes
  useEffect(() => {
    if (!showEditReceiptModal) return;
    const activeMachine = editReceiptForm.employeeId
      ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
      : editReceiptForm.machineName;

    if (activeMachine && editReceiptForm.returnedDate) {
      const machMovements = allMovements.filter(m => m.machineName === activeMachine);
      const stableLoc = findStableLocation(machMovements, editReceiptForm.returnedDate);
      const fallbackPos = machinePositions[activeMachine];

      setEditReceiptForm((prev: any) => ({
        ...prev,
        zone: stableLoc?.zone || fallbackPos?.zone || prev.zone || '',
        division: stableLoc?.division || fallbackPos?.division || prev.division || ''
      }));
    }
  }, [editReceiptForm.machineName, editReceiptForm.employeeId, editReceiptForm.returnedDate, allMovements, machinePositions, employeeList, showEditReceiptModal]);

  const handleEditPartNoChange = (selectedPartNo: string) => {
    const activeMachine = editReceiptForm.employeeId
      ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
      : (editReceiptForm.machineName || '');

    const matchedPart = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      return machMatch && p.partNo?.trim().toLowerCase() === selectedPartNo.trim().toLowerCase();
    });

    const rawUnit = (matchedPart as any)?.unit || editReceiptForm.unit || 'Nos';
    const isStd = STANDARD_RECEIPT_UOMS.includes(rawUnit);

    setEditReceiptForm((prev: any) => ({
      ...prev,
      partNo: selectedPartNo,
      plNo: matchedPart ? matchedPart.plNo : prev.plNo,
      description: matchedPart ? matchedPart.description : prev.description,
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
      location: matchedPart ? (matchedPart.location || prev.location) : prev.location,
    }));
  };

  const handleEditPlNoChange = (selectedPlNo: string) => {
    const activeMachine = editReceiptForm.employeeId
      ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
      : (editReceiptForm.machineName || '');

    const matchedPart = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      return machMatch && p.plNo?.trim().toLowerCase() === selectedPlNo.trim().toLowerCase();
    });

    const rawUnit = (matchedPart as any)?.unit || editReceiptForm.unit || 'Nos';
    const isStd = STANDARD_RECEIPT_UOMS.includes(rawUnit);

    setEditReceiptForm((prev: any) => ({
      ...prev,
      plNo: selectedPlNo,
      partNo: matchedPart ? matchedPart.partNo : prev.partNo,
      description: matchedPart ? matchedPart.description : prev.description,
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
      location: matchedPart ? (matchedPart.location || prev.location) : prev.location,
    }));
  };

  const handleEditEmployeeIdChange = (empId: string) => {
    const emp = employeeList.find(e => e.id === empId || e.pfNo === empId);
    if (emp) {
      setEditReceiptForm((prev: any) => ({
        ...prev,
        employeeId: empId,
        employeeName: emp.name || '',
        machineName: emp.machineName || prev.machineName,
      }));
    } else {
      setEditReceiptForm((prev: any) => ({
        ...prev,
        employeeId: empId,
        employeeName: '',
        machineName: '',
        companyName: '',
      }));
    }
  };

  const handleEditMachineNameChange = async (machName: string) => {
    let resolvedCo = '';
    try {
      resolvedCo = await getCompanyByMachine(machName);
    } catch (e) {
      console.warn("Contract resolution warning in Demand edit:", e);
    }
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = resolvedCo || (matchedEmp ? matchedEmp.companyName || '' : '');
    setEditReceiptForm((prev: any) => ({
      ...prev,
      machineName: machName,
      companyName: matchedCompany || prev.companyName,
    }));
  };

  // Load unconnected material receipts
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'unconnected_material_receipts'), (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      list.sort((a, b) => new Date(b.returnedDate).getTime() - new Date(a.returnedDate).getTime());
      setUnconnectedReceipts(list);
    }, (err) => {
      console.error("Error loading unconnected receipts:", err);
    });
    return () => unsub();
  }, []);

  // Load machine movements
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setAllMovements(list);
    }, (err) => {
      console.error("Error loading machine movements:", err);
    });
    return () => unsub();
  }, []);

  // Stable location finder (returns zone & division based on date)
  const findStableLocation = (movementsList: any[], targetDateStr: string) => {
    if (!targetDateStr || movementsList.length === 0) return null;
    const targetDate = new Date(targetDateStr);
    if (isNaN(targetDate.getTime())) return null;

    const sorted = [...movementsList].sort((a, b) => {
      const dateA = a.fromDateTime ? new Date(a.fromDateTime).getTime() : 0;
      const dateB = b.fromDateTime ? new Date(b.fromDateTime).getTime() : 0;
      return dateA - dateB;
    });

    const firstMov = sorted[0];
    const firstStart = firstMov.fromDateTime ? new Date(firstMov.fromDateTime) : null;
    if (firstStart && targetDate < firstStart) {
      return {
        zone: firstMov.fromZone || firstMov.toZone || '',
        division: firstMov.fromDivision || firstMov.toDivision || ''
      };
    }

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const currentStart = current.fromDateTime ? new Date(current.fromDateTime) : null;
      const currentEnd = current.toDateTime ? new Date(current.toDateTime) : null;
      const next = sorted[i + 1];
      const nextStart = next && next.fromDateTime ? new Date(next.fromDateTime) : null;

      if (currentStart && currentEnd && targetDate >= currentStart && targetDate <= currentEnd) {
        return {
          zone: current.fromZone || current.toZone || '',
          division: current.fromDivision || current.toDivision || ''
        };
      }

      if (currentEnd && targetDate > currentEnd && (!nextStart || targetDate < nextStart)) {
        return {
          zone: current.toZone || '',
          division: current.toDivision || ''
        };
      }
    }

    const lastMov = sorted[sorted.length - 1];
    return {
      zone: lastMov.toZone || '',
      division: lastMov.toDivision || ''
    };
  };

  // Dynamic Zone lookup for machine/date based on movement history
  const getZoneForMachine = (mName?: string, dateStr?: string) => {
    if (!mName) return 'South East Central Railway';
    if (dateStr && allMovements && allMovements.length > 0) {
      const machMovements = allMovements.filter(m => m.machineName === mName);
      const loc = findStableLocation(machMovements, dateStr);
      if (loc && loc.zone) return loc.zone;
    }
    if (machinePositions[mName]?.zone) {
      return machinePositions[mName].zone;
    }
    return 'South East Central Railway';
  };

  // Auto-population side-effect on Date/Machine/Employee changes
  useEffect(() => {
    const activeMachine = receiptForm.employeeId
      ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
      : receiptForm.machineName;

    if (activeMachine && receiptForm.returnedDate) {
      const machMovements = allMovements.filter(m => m.machineName === activeMachine);
      const stableLoc = findStableLocation(machMovements, receiptForm.returnedDate);
      const fallbackPos = machinePositions[activeMachine];

      setReceiptForm(prev => ({
        ...prev,
        zone: stableLoc?.zone || fallbackPos?.zone || prev.zone || '',
        division: stableLoc?.division || fallbackPos?.division || prev.division || ''
      }));
    }
  }, [receiptForm.machineName, receiptForm.employeeId, receiptForm.returnedDate, allMovements, machinePositions, employeeList]);

  // Handle machine change: sets machine and auto-fills mapped company from contracts or employee
  const handleMachineNameChange = async (machName: string) => {
    let resolvedCo = '';
    try {
      resolvedCo = await getCompanyByMachine(machName);
    } catch (e) {
      console.warn("Contract resolution warning in Demand:", e);
    }
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = resolvedCo || (matchedEmp ? matchedEmp.companyName || '' : '');
    setReceiptForm(prev => ({
      ...prev,
      machineName: machName,
      companyName: matchedCompany || prev.companyName,
    }));
  };

  // Handle saving Unconnected Material Receipt to Firestore and updating stock
  const handleSaveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptForm.partNo) {
      toast.error("Please enter/select a Part No.");
      return;
    }
    if (!receiptForm.returnedDate) {
      toast.error("Please enter a Returned Date.");
      return;
    }
    if (receiptForm.qtyReturned <= 0) {
      toast.error("Quantity Returned must be greater than 0.");
      return;
    }

    const activeMachine = receiptForm.employeeId 
      ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName)
      : receiptForm.machineName;

    const matchedPart = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      const partMatch = (receiptForm.partNo && p.partNo?.trim().toLowerCase() === receiptForm.partNo.trim().toLowerCase()) ||
                        (receiptForm.plNo && p.plNo?.trim().toLowerCase() === receiptForm.plNo.trim().toLowerCase());
      return machMatch && partMatch;
    });

    if (!matchedPart) {
      toast.error("The entered Part No / PL No does not match any item in the Inventory. Only existing inventory items can be received.");
      return;
    }

    const itemName = matchedPart.description || matchedPart.partNo;
    const qty = Number(receiptForm.qtyReturned);

    // Prompt user with confirmation notification dialog
    const confirmed = window.confirm(`Confirm Material Receipt Log:\n\nItem Name: ${itemName}\nReceived Qty: ${qty}\n\nClick OK to add this received quantity to the Inventory Stock.`);
    if (!confirmed) {
      return;
    }

    setReceiptSubmitting(true);
    try {
      const user = auth.currentUser;
      const isRestrictedEmp = Boolean(hasAssignedMachine);
      const activeMachine = isRestrictedEmp
        ? userMachine
        : (receiptForm.employeeId 
          ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName)
          : receiptForm.machineName);

      const receiptVoucherNo = receiptForm.voucherNo?.trim() || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const finalUnit = receiptForm.unit === 'Other' ? (receiptForm.customUnit.trim() || 'Nos') : (receiptForm.unit || 'Nos');

      const payload = {
        voucherNo: receiptVoucherNo,
        zone: receiptForm.zone,
        division: receiptForm.division,
        machineName: activeMachine,
        companyName: receiptForm.companyName,
        selectMode: receiptForm.employeeId ? 'employee' : 'machine',
        employeeId: receiptForm.employeeId || '',
        employeeName: receiptForm.employeeId ? receiptForm.employeeName : '',
        partNo: receiptForm.partNo,
        plNo: receiptForm.plNo,
        description: receiptForm.description,
        returnedDate: receiptForm.returnedDate,
        qtyReturned: Number(receiptForm.qtyReturned),
        unit: finalUnit,
        location: receiptForm.location,
        remarks: receiptForm.remarks,
        transactionQty: Number(receiptForm.qtyReturned), // same as Quantity Returned, read-only
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || 'Unknown',
        createdByEmail: user?.email || '',
      };

      // 1. Add unconnected material receipt record
      const receiptRef = await addDoc(collection(db, 'unconnected_material_receipts'), payload);

      // 2. Fetch part and update stock & location
      if (matchedPart) {
        const partRef = doc(db, 'parts', matchedPart.id);
        const oldStock = matchedPart.stock || 0;
        const newStock = oldStock + Number(receiptForm.qtyReturned);
        const newTotalValue = newStock * (matchedPart.rate || 0);

        await updateDoc(partRef, {
          stock: newStock,
          totalValue: newTotalValue,
          location: receiptForm.location || matchedPart.location || '',
        });

        // Add to transaction history
        await addDoc(collection(db, 'transactions'), {
          partId: matchedPart.id,
          receiptId: receiptRef.id,
          type: 'received',
          qty: Number(receiptForm.qtyReturned),
          date: receiptForm.returnedDate || format(new Date(), 'yyyy-MM-dd'),
          details: `Received via Unconnected Material Receipt (Old Stock: ${oldStock}, New Stock: ${newStock})`,
          remarks: receiptForm.remarks || '',
          receiverName: receiptForm.employeeName || '',
          machineName: receiptForm.machineName || '',
          companyName: receiptForm.companyName || '',
          zone: receiptForm.zone || '',
          division: receiptForm.division || '',
          voucherNo: receiptVoucherNo,
        });

        toast.success(`Unconnected Material Receipt logged! Voucher No: ${receiptVoucherNo}. Stock of ${matchedPart.partNo} increased to ${newStock} at ${receiptForm.location || 'N/A'}`);
        await fetchParts();
      } else {
        toast.success(`Unconnected Material Receipt logged! Voucher No: ${receiptVoucherNo}`);
      }

      setShowAddReceiptModal(false);
      
      // Reset form
      setReceiptForm({
        voucherNo: '',
        zone: '',
        division: '',
        machineName: '',
        companyName: '',
        selectMode: 'machine',
        employeeId: '',
        employeeName: '',
        partNo: '',
        plNo: '',
        description: '',
        unit: 'Nos',
        customUnit: '',
        returnedDate: format(new Date(), 'yyyy-MM-dd'),
        qtyReturned: 0,
        location: '',
        remarks: '',
      });
    } catch (error) {
      console.error("Error saving unconnected receipt:", error);
      toast.error("Failed to save receipt. Please try again.");
    } finally {
      setReceiptSubmitting(false);
    }
  };

  const handlePartNoChange = (selectedPartNo: string) => {
    const activeMachine = receiptForm.employeeId
      ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
      : (receiptForm.machineName || '');

    const matchedPart = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      return machMatch && p.partNo?.trim().toLowerCase() === selectedPartNo.trim().toLowerCase();
    });

    const rawUnit = (matchedPart as any)?.unit || receiptForm.unit || 'Nos';
    const isStd = STANDARD_RECEIPT_UOMS.includes(rawUnit);

    setReceiptForm(prev => ({
      ...prev,
      partNo: selectedPartNo,
      plNo: matchedPart ? matchedPart.plNo : prev.plNo,
      description: matchedPart ? matchedPart.description : prev.description,
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
      location: matchedPart ? (matchedPart.location || prev.location) : prev.location,
    }));
  };

  const handlePlNoChange = (selectedPlNo: string) => {
    const activeMachine = receiptForm.employeeId
      ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
      : (receiptForm.machineName || '');

    const matchedPart = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      return machMatch && p.plNo?.trim().toLowerCase() === selectedPlNo.trim().toLowerCase();
    });

    const rawUnit = (matchedPart as any)?.unit || receiptForm.unit || 'Nos';
    const isStd = STANDARD_RECEIPT_UOMS.includes(rawUnit);

    setReceiptForm(prev => ({
      ...prev,
      plNo: selectedPlNo,
      partNo: matchedPart ? matchedPart.partNo : prev.partNo,
      description: matchedPart ? matchedPart.description : prev.description,
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
      location: matchedPart ? (matchedPart.location || prev.location) : prev.location,
    }));
  };

  const handleEmployeeIdChange = (empId: string) => {
    const emp = employeeList.find(e => e.id === empId || e.pfNo === empId);
    if (emp) {
      setReceiptForm(prev => ({
        ...prev,
        employeeId: empId,
        employeeName: emp.name || '',
        companyName: emp.companyName || prev.companyName,
        machineName: emp.machineName || prev.machineName,
      }));
    } else {
      setReceiptForm(prev => ({
        ...prev,
        employeeId: empId,
        employeeName: '',
        machineName: '',
        companyName: '',
      }));
    }
  };

  const handleDeleteReceipt = async (id: string) => {
    if (!isPrimaryAdmin) {
      toast.error("Only ADMIN accounts can delete unconnected material receipts.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this receipt record? This will also revert the stock of the part and remove its transaction history.")) return;
    try {
      // 1. Fetch original receipt
      const receiptDocRef = doc(db, 'unconnected_material_receipts', id);
      const receiptSnap = await getDoc(receiptDocRef);
      if (receiptSnap.exists()) {
        const originalReceipt = receiptSnap.data();
        const originalQty = Number(originalReceipt.qtyReturned || 0);
        const originalPartNo = originalReceipt.partNo || '';
        const originalPlNo = originalReceipt.plNo || '';

        // Find part in fullPartsList
        const matchedPartOld = fullPartsList.find(p => 
          (originalPartNo && p.partNo?.trim().toLowerCase() === originalPartNo.trim().toLowerCase()) ||
          (originalPlNo && p.plNo?.trim().toLowerCase() === originalPlNo.trim().toLowerCase())
        );

        // Revert stock (subtract the received qty)
        if (matchedPartOld) {
          const partRefOld = doc(db, 'parts', matchedPartOld.id);
          const oldStockReverted = (matchedPartOld.stock || 0) - originalQty;
          const oldTotalValue = oldStockReverted * (matchedPartOld.rate || 0);
          await updateDoc(partRefOld, {
            stock: oldStockReverted,
            totalValue: oldTotalValue,
          });
        }
      }

      // 2. Delete linked transaction history
      const transQuery = query(
        collection(db, 'transactions'),
        where('receiptId', '==', id)
      );
      const transSnap = await getDocs(transQuery);
      for (const tDoc of transSnap.docs) {
        await deleteDoc(doc(db, 'transactions', tDoc.id));
      }

      // 3. Archive and Delete unconnected receipt
      if (receiptSnap && receiptSnap.exists()) {
        const rData = receiptSnap.data();
        await archiveDeletedRecord({
          originalCollection: 'receipts',
          originalId: id,
          data: rData,
          moduleName: 'Store / Spare Receipt',
          itemSummary: `Receipt: ${rData.partNo || rData.plNo || 'Item'} (${rData.qty || 0} ${rData.unit || 'Nos'}) • ${rData.machineName || 'Depot'}`,
          machineName: rData.machineName,
          companyName: (rData as any).companyName,
        });
      }
      await deleteDoc(receiptDocRef);

      toast.success("Receipt record, inventory stock, and transaction history deleted successfully.");
      await fetchParts();
    } catch (error) {
      console.error("Error deleting receipt:", error);
      toast.error("Failed to delete receipt record");
    }
  };

  const handleOpenEditReceipt = (r: any) => {
    if (!isPrimaryAdmin) {
      toast.error("Only ADMIN accounts can edit unconnected material receipts.");
      return;
    }
    const rawUnit = r.unit || 'Nos';
    const isStd = STANDARD_RECEIPT_UOMS.includes(rawUnit);

    setEditReceiptForm({
      id: r.id,
      voucherNo: r.voucherNo || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`,
      zone: r.zone || '',
      division: r.division || '',
      machineName: r.machineName || '',
      companyName: r.companyName || '',
      selectMode: r.selectMode || 'machine',
      employeeId: r.employeeId || '',
      employeeName: r.employeeName || '',
      partNo: r.partNo || '',
      plNo: r.plNo || '',
      description: r.description || '',
      returnedDate: r.returnedDate || format(new Date(), 'yyyy-MM-dd'),
      qtyReturned: r.qtyReturned || 0,
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
      location: r.location || '',
      remarks: r.remarks || '',
    });
    setShowEditReceiptModal(true);
  };

  const handleUpdateReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrimaryAdmin) {
      toast.error("Only ADMIN accounts can edit unconnected material receipts.");
      return;
    }
    if (!editReceiptForm.returnedDate) {
      toast.error("Please enter a Returned Date.");
      return;
    }
    if (editReceiptForm.qtyReturned <= 0) {
      toast.error("Quantity Returned must be greater than 0.");
      return;
    }

    const activeMachine = editReceiptForm.employeeId 
      ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName)
      : editReceiptForm.machineName;

    // 1. Find the new matched part based on edited partNo/plNo
    const matchedPartNew = fullPartsList.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      const partMatch = (editReceiptForm.partNo && p.partNo?.trim().toLowerCase() === editReceiptForm.partNo.trim().toLowerCase()) ||
                        (editReceiptForm.plNo && p.plNo?.trim().toLowerCase() === editReceiptForm.plNo.trim().toLowerCase());
      return machMatch && partMatch;
    });

    if (!matchedPartNew) {
      toast.error("The entered Part No / PL No does not match any item in the Inventory. Only existing inventory items can be received.");
      return;
    }

    setReceiptSubmitting(true);
    try {
      // 2. Fetch the original receipt from unconnected_material_receipts
      const receiptDocRef = doc(db, 'unconnected_material_receipts', editReceiptForm.id);
      const receiptSnap = await getDoc(receiptDocRef);
      if (!receiptSnap.exists()) {
        toast.error("Original receipt record not found.");
        setReceiptSubmitting(false);
        return;
      }
      const originalReceipt = receiptSnap.data();
      const originalQty = Number(originalReceipt.qtyReturned || 0);
      const originalPartNo = originalReceipt.partNo || '';
      const originalPlNo = originalReceipt.plNo || '';

      // Find original part in fullPartsList
      const matchedPartOld = fullPartsList.find(p => 
        (originalPartNo && p.partNo?.trim().toLowerCase() === originalPartNo.trim().toLowerCase()) ||
        (originalPlNo && p.plNo?.trim().toLowerCase() === originalPlNo.trim().toLowerCase())
      );

      // Revert original stock
      if (matchedPartOld) {
        const partRefOld = doc(db, 'parts', matchedPartOld.id);
        const oldStockReverted = (matchedPartOld.stock || 0) - originalQty;
        const oldTotalValue = oldStockReverted * (matchedPartOld.rate || 0);
        await updateDoc(partRefOld, {
          stock: oldStockReverted,
          totalValue: oldTotalValue,
        });
      }

      // Refresh parts list so we have updated stock for the new part calculation
      await fetchParts();

      // Find new part again with latest stock (in case they are the same part)
      const latestPartsSnapshot = await getDocs(collection(db, 'parts'));
      const latestPartsList = latestPartsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const matchedPartNewLatest = latestPartsList.find(p => 
        (editReceiptForm.partNo && p.partNo?.trim().toLowerCase() === editReceiptForm.partNo.trim().toLowerCase()) ||
        (editReceiptForm.plNo && p.plNo?.trim().toLowerCase() === editReceiptForm.plNo.trim().toLowerCase())
      ) || matchedPartNew;

      // Add new stock to the edited part
      const partRefNew = doc(db, 'parts', matchedPartNewLatest.id);
      const oldStockNew = matchedPartNewLatest.stock || 0;
      const newStockNew = oldStockNew + Number(editReceiptForm.qtyReturned);
      const newTotalValueNew = newStockNew * (matchedPartNewLatest.rate || 0);

      await updateDoc(partRefNew, {
        stock: newStockNew,
        totalValue: newTotalValueNew,
        location: editReceiptForm.location || matchedPartNewLatest.location || '',
      });

      // Update unconnected material receipt record
      const activeMachine = editReceiptForm.employeeId 
        ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName)
        : editReceiptForm.machineName;

      const receiptVoucherNo = editReceiptForm.voucherNo?.trim() || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const finalUnit = editReceiptForm.unit === 'Other' ? (editReceiptForm.customUnit?.trim() || 'Nos') : (editReceiptForm.unit || 'Nos');

      const updatedPayload = {
        voucherNo: receiptVoucherNo,
        zone: editReceiptForm.zone,
        division: editReceiptForm.division,
        machineName: activeMachine,
        companyName: editReceiptForm.companyName,
        selectMode: editReceiptForm.employeeId ? 'employee' : 'machine',
        employeeId: editReceiptForm.employeeId || '',
        employeeName: editReceiptForm.employeeId ? editReceiptForm.employeeName : '',
        partNo: editReceiptForm.partNo,
        plNo: editReceiptForm.plNo,
        description: editReceiptForm.description,
        returnedDate: editReceiptForm.returnedDate,
        qtyReturned: Number(editReceiptForm.qtyReturned),
        unit: finalUnit,
        location: editReceiptForm.location,
        remarks: editReceiptForm.remarks,
        transactionQty: Number(editReceiptForm.qtyReturned),
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.uid || 'Unknown',
        updatedByEmail: auth.currentUser?.email || '',
      };

      await updateDoc(receiptDocRef, updatedPayload);

      // Find existing transaction and update it, or create if not found
      const transQuery = query(
        collection(db, 'transactions'),
        where('receiptId', '==', editReceiptForm.id)
      );
      const transSnap = await getDocs(transQuery);

      if (!transSnap.empty) {
        const transDocRef = doc(db, 'transactions', transSnap.docs[0].id);
        await updateDoc(transDocRef, {
          partId: matchedPartNewLatest.id,
          qty: Number(editReceiptForm.qtyReturned),
          date: editReceiptForm.returnedDate || format(new Date(), 'yyyy-MM-dd'),
          details: `Received via Unconnected Material Receipt (Old Stock: ${oldStockNew}, New Stock: ${newStockNew}) [EDITED]`,
          remarks: editReceiptForm.remarks || '',
          receiverName: editReceiptForm.employeeName || '',
          machineName: editReceiptForm.machineName || '',
          companyName: editReceiptForm.companyName || '',
          zone: editReceiptForm.zone || '',
          division: editReceiptForm.division || '',
          voucherNo: receiptVoucherNo,
        });
      } else {
        // Fallback: search by partId, type received, and approximate qty
        const fallbackQuery = query(
          collection(db, 'transactions'),
          where('partId', '==', matchedPartOld?.id || ''),
          where('type', '==', 'received'),
          where('qty', '==', originalQty)
        );
        const fallbackSnap = await getDocs(fallbackQuery);
        if (!fallbackSnap.empty) {
          const transDocRef = doc(db, 'transactions', fallbackSnap.docs[0].id);
          await updateDoc(transDocRef, {
            partId: matchedPartNewLatest.id,
            receiptId: editReceiptForm.id,
            qty: Number(editReceiptForm.qtyReturned),
            date: editReceiptForm.returnedDate || format(new Date(), 'yyyy-MM-dd'),
            details: `Received via Unconnected Material Receipt (Old Stock: ${oldStockNew}, New Stock: ${newStockNew}) [EDITED]`,
            remarks: editReceiptForm.remarks || '',
            receiverName: editReceiptForm.employeeName || '',
            machineName: editReceiptForm.machineName || '',
            companyName: editReceiptForm.companyName || '',
            zone: editReceiptForm.zone || '',
            division: editReceiptForm.division || '',
            voucherNo: receiptVoucherNo,
          });
        } else {
          // If not found at all, create a new transaction record linked to this receipt
          await addDoc(collection(db, 'transactions'), {
            partId: matchedPartNewLatest.id,
            receiptId: editReceiptForm.id,
            type: 'received',
            qty: Number(editReceiptForm.qtyReturned),
            date: editReceiptForm.returnedDate || format(new Date(), 'yyyy-MM-dd'),
            details: `Received via Unconnected Material Receipt (Old Stock: ${oldStockNew}, New Stock: ${newStockNew})`,
            remarks: editReceiptForm.remarks || '',
            receiverName: editReceiptForm.employeeName || '',
            machineName: editReceiptForm.machineName || '',
            companyName: editReceiptForm.companyName || '',
            zone: editReceiptForm.zone || '',
            division: editReceiptForm.division || '',
            voucherNo: receiptVoucherNo,
          });
        }
      }

      toast.success("Unconnected Material Receipt updated and inventory updated successfully!");
      setShowEditReceiptModal(false);
      await fetchParts();
    } catch (error) {
      console.error("Error updating receipt:", error);
      toast.error("Failed to update receipt record.");
    } finally {
      setReceiptSubmitting(false);
    }
  };

  const exportUnconnectedReceipts = () => {
    if (filteredUnconnectedReceipts.length === 0) {
      toast.error("No unconnected receipts found to export.");
      return;
    }

    const dataToExport = filteredUnconnectedReceipts.map((r, index) => ({
      'Sr No.': index + 1,
      'Voucher No': r.voucherNo || '-',
      'Returned Date': r.returnedDate,
      'Zone': r.zone || '-',
      'Division': r.division || '-',
      'Machine Name': r.machineName || '-',
      'Company': r.companyName || '-',
      'Mode': r.selectMode === 'machine' ? 'Machine-wise' : 'Employee ID-wise',
      'Employee ID': r.employeeId || '-',
      'Employee Name': r.employeeName || '-',
      'Part No.': r.partNo || '-',
      'PL No.': r.plNo || '-',
      'Description': r.description || '-',
      'Quantity Returned': r.qtyReturned,
      'Transaction Qty': r.transactionQty,
      'Location': r.location || '-',
      'Remarks': r.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Unconnected Receipts`);
    XLSX.writeFile(wb, `unconnected_material_receipts_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success("Unconnected material receipts exported successfully");
  };

  useEffect(() => {
    fetchDemands();
    fetchParts();
    fetchStoreItems();
  }, []);

  const fetchStoreItems = async () => {
    try {
      const snap = await getDocs(collection(db, 'store_items'));
      setStoreItemsList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('Error fetching store items:', e);
    }
  };

  const fetchParts = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'parts'));
      const stockMap: Record<string, number> = {};
      const fullList: Part[] = [];
      querySnapshot.docs.forEach(doc => {
        const data = doc.data();
        const partItem = { id: doc.id, ...data } as Part;
        fullList.push(partItem);
        if (data.plNo) stockMap[data.plNo] = data.stock || 0;
        if (data.partNo) stockMap[data.partNo] = data.stock || 0;
      });
      setParts(stockMap);
      setFullPartsList(fullList);
    } catch (error) {
      console.error('Error fetching parts:', error);
    }
  };

  const fetchDemands = async () => {
    setLoading(true);
    try {
      // Fetch all employees to get companies mapping
      const empSnapshot = await getDocs(collection(db, 'employees'));
      const empList = empSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      setEmployeeList(empList);
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      const querySnapshot = await getDocs(collection(db, 'demands'));
      const demandList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Demand));
      
      // Extract custom machines from demands list
      const uniqueMachines = Array.from(new Set(demandList.map(d => d.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setDemands(demandList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      console.error('Error fetching demands:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isMasterAdmin) {
      toast.error('Only Master Admin account can upload the Demand PDF logo.');
      return;
    }

    setUploadingLogo(true);
    try {
      const base64Logo = await compressImage(file, 260, 260, 0.8);
      if (base64Logo) {
        await Promise.all([
          setDoc(doc(db, 'settings', 'app_branding'), { 
            demandLogo: base64Logo,
            appLogo: base64Logo,
            updatedAt: new Date().toISOString()
          }, { merge: true }),
          setDoc(doc(db, 'settings', 'general'), { 
            demandLogo: base64Logo,
            updatedAt: new Date().toISOString()
          }, { merge: true })
        ]);
        setDemandLogo(base64Logo);
        localStorage.setItem('demandLogo', base64Logo);
        localStorage.setItem('appLogo', base64Logo);
        window.dispatchEvent(new CustomEvent('app-logo-updated', { detail: base64Logo }));
        toast.success('Demand Voucher PDF Logo updated & synced to all machines!');
      }
    } catch (err: any) {
      console.error('Error uploading demand logo:', err);
      toast.error('Failed to save logo to database: ' + (err?.message || 'Unknown error'));
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleResetLogo = async () => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin account can modify the Demand PDF logo.');
      return;
    }

    setUploadingLogo(true);
    try {
      await Promise.all([
        setDoc(doc(db, 'settings', 'app_branding'), { 
          demandLogo: '', 
          appLogo: '',
          updatedAt: new Date().toISOString()
        }, { merge: true }),
        setDoc(doc(db, 'settings', 'general'), { 
          demandLogo: '',
          updatedAt: new Date().toISOString()
        }, { merge: true })
      ]);
      setDemandLogo('');
      localStorage.removeItem('demandLogo');
      localStorage.removeItem('appLogo');
      window.dispatchEvent(new CustomEvent('app-logo-updated', { detail: '' }));
      toast.success('Demand Voucher PDF Logo reset to default Railway logo.');
    } catch (err) {
      console.error('Error resetting demand logo:', err);
      toast.error('Failed to reset logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleAddDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isOtherMachine && (!otherZone || !otherDivision || !otherMachineName)) {
        toast.error('Please select Zone, Division, and Machine Name for Other Machine Demand.');
        setSubmitting(false);
        return;
      }

      const machineToAssign = isOtherMachine 
        ? otherMachineName 
        : (isEmployee ? userMachine : newDemand.machineName);

      let selectedEmp = fullAccessEmployees.find(emp => emp.id === newDemand.forwardedToId);

      // Auto-route to the Full Access Admin of the selected machine
      if (machineToAssign) {
        const machineAdmin = fullAccessEmployees.find(emp => 
          emp.machineName === machineToAssign && 
          (emp.accessType === 'full' || emp.accessType === 'admin-light')
        );
        if (machineAdmin) {
          selectedEmp = machineAdmin;
        }
      }

      const derivedZone = isOtherMachine ? otherZone : getZoneForMachine(machineToAssign, newDemand.date);
      const derivedDivision = isOtherMachine ? otherDivision : (machinePositions[machineToAssign]?.division || '');
      const resolvedDemandUnit = (newDemand.unit === 'Other' || !STANDARD_RECEIPT_UOMS.filter(u => u !== 'Other').includes(newDemand.unit || ''))
        ? (newDemandCustomUnit.trim() || 'Nos')
        : (newDemand.unit || 'Nos');

      const generatedDemandNo = `DEM-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const docRef = await addDoc(collection(db, 'demands'), {
        demandNo: generatedDemandNo,
        plNo: newDemand.plNo || '',
        partNo: newDemand.partNo,
        description: newDemand.description,
        qty: Number(newDemand.qty) || 0,
        unit: resolvedDemandUnit,
        date: newDemand.date,
        whetherUse: newDemand.whetherUse,
        remarks: newDemand.remarks,
        status: 'pending',
        createdByUid: auth.currentUser?.uid || '',
        createdByEmail: auth.currentUser?.email || '',
        createdByEmployeeName: currentEmployeeName || '',
        createdByPfNo: currentEmployeePfNo || '',
        createdByCompanyName: currentEmployeeCompanyName || '',
        forwardedTo: selectedEmp ? selectedEmp.id : (newDemand.forwardedToId || ''),
        forwardedToName: selectedEmp ? selectedEmp.name : '',
        forwardedToEmail: selectedEmp ? selectedEmp.email || '' : '',
        machineName: machineToAssign || '',
        imageUrl: newDemand.imageUrl || '',
        isOtherMachineDemand: isOtherMachine,
        requestingMachineName: isEmployee ? userMachine : (newDemand.machineName || userMachine || ''),
        requestingZone: getZoneForMachine(userMachine || newDemand.machineName, newDemand.date),
        requestingDivision: machinePositions[userMachine]?.division || '',
        requestingCompanyName: currentEmployeeCompanyName || '',
        targetMachineName: isOtherMachine ? otherMachineName : '',
        targetZone: isOtherMachine ? otherZone : '',
        targetDivision: isOtherMachine ? otherDivision : '',
        zone: derivedZone,
        division: derivedDivision,
        forwardedToCompanyAdmin: selectedEmp ? (selectedEmp.accessType === 'admin-light') : false,
        forwardedToAdmin: selectedEmp ? (selectedEmp.accessType === 'full') : false,
        customLogo: demandLogo || '',
      });

      // Auto-save item into global parts inventory catalog if it doesn't exist yet
      if (newDemand.plNo || newDemand.partNo) {
        const cleanPl = (newDemand.plNo || '').trim().toLowerCase();
        const cleanPart = (newDemand.partNo || '').trim().toLowerCase();

        const existingInParts = fullPartsList.find(p => 
          (cleanPl && p.plNo && p.plNo.trim().toLowerCase() === cleanPl) ||
          (cleanPart && p.partNo && p.partNo.trim().toLowerCase() === cleanPart)
        );

        if (!existingInParts) {
          try {
            await addDoc(collection(db, 'parts'), {
              plNo: newDemand.plNo || '',
              partNo: newDemand.partNo || '',
              description: newDemand.description || '',
              whetherUse: newDemand.whetherUse || 'CS',
              unit: resolvedDemandUnit,
              stock: 0,
              rate: 0,
              machineName: machineToAssign || '',
              createdAt: new Date().toISOString()
            });
            fetchParts();
          } catch (partSaveErr) {
            console.error('Error auto-saving item to parts collection:', partSaveErr);
          }
        }
      }

      // Log to demand_logs for complete history
      await addDoc(collection(db, 'demand_logs'), {
        demandId: docRef.id,
        plNo: newDemand.plNo || '',
        partNo: newDemand.partNo || '',
        description: newDemand.description || '',
        action: 'CREATE',
        remark: `Demand created (${generatedDemandNo}). Note: ${newDemand.remarks || 'No remarks'}`,
        performedByUid: auth.currentUser?.uid || '',
        performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
        performedByEmail: auth.currentUser?.email || '',
        timestamp: new Date().toISOString()
      });
      
      if (selectedEmp && selectedEmp.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: selectedEmp.email,
          title: 'Demand Forwarded to You',
          message: `A new demand (${generatedDemandNo}) for PL No. ${newDemand.plNo} has been forwarded to you by ${auth.currentUser?.email || 'an employee'}.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });
      }

      toast.success('Demand created successfully');

      setShowAddModal(false);
      fetchDemands();
      setNewDemand({
        plNo: '',
        partNo: '',
        description: '',
        qty: 0,
        unit: 'Nos',
        date: format(new Date(), 'yyyy-MM-dd'),
        whetherUse: 'CS',
        remarks: '',
        forwardedToId: '',
        machineName: '',
        imageUrl: '',
      });
      setIsOtherMachine(false);
      setNewDemandCustomUnit('');
      setOtherZone('');
      setOtherDivision('');
      setOtherMachineName('');
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
    } catch (error) {
      console.error('Error adding demand:', error);
      toast.error('Failed to create demand. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const exportDemands = (type: 'pending' | 'completed') => {
    // Filter demands by status
    const filtered = demands.filter(d => {
      const matchesSearch = d.plNo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesMachine = selectedMachine === 'all' || d.machineName === selectedMachine;
      const matchesStatus = type === 'completed' ? (d.status === 'completed') : (d.status !== 'completed');
      
      const creator = employeeList.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : '';
      const matchesCompany = selectedCompany === 'all' || demandCompany === selectedCompany;

      return matchesSearch && matchesMachine && matchesStatus && matchesCompany;
    });

    if (filtered.length === 0) {
      toast.error(`No ${type} demands found to export.`);
      return;
    }

    const dataToExport = filtered.map(d => ({
      'Date': d.date,
      'PL No.': d.plNo,
      'Part No.': d.partNo || '-',
      'Description': d.description || '-',
      'Quantity': d.qty,
      'Unit of Measure (इकाई)': getDemandDisplayUnit(d),
      'Status': d.status.toUpperCase(),
      'Machine': d.machineName || 'General',
      'Whether Use': d.whetherUse || 'CS',
      'Created By Name': d.createdByEmployeeName || '-',
      'PF No.': d.createdByPfNo || (d.createdByEmail ? d.createdByEmail.split('@')[0] : '-'),
      'Assigned/Forwarded To': d.forwardedToName || '-',
      'Received Qty': d.receivedQty !== undefined ? d.receivedQty : '-',
      'Received Date': d.receivedDate || '-',
      'Remarks': d.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${type.toUpperCase()} Demands`);
    XLSX.writeFile(wb, `${type}_demands_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(`${type.toUpperCase()} demands exported successfully`);
  };

  const handleExportAll = () => {
    const filtered = demands.filter(d => {
      const matchesSearch = d.plNo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesMachine = selectedMachine === 'all' || d.machineName === selectedMachine;
      
      const creator = employeeList.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : '';
      const matchesCompany = selectedCompany === 'all' || demandCompany === selectedCompany;

      return matchesSearch && matchesMachine && matchesCompany;
    });

    if (filtered.length === 0) {
      toast.error('No demands found to export.');
      return;
    }

    const dataToExport = filtered.map(d => ({
      'Date': d.date,
      'PL No.': d.plNo,
      'Part No.': d.partNo || '-',
      'Description': d.description || '-',
      'Quantity': d.qty,
      'Unit of Measure (इकाई)': getDemandDisplayUnit(d),
      'Status': d.status.toUpperCase(),
      'Machine': d.machineName || 'General',
      'Whether Use': d.whetherUse || 'CS',
      'Created By Name': d.createdByEmployeeName || '-',
      'PF No.': d.createdByPfNo || (d.createdByEmail ? d.createdByEmail.split('@')[0] : '-'),
      'Assigned/Forwarded To': d.forwardedToName || '-',
      'Received Qty': d.receivedQty !== undefined ? d.receivedQty : '-',
      'Received Date': d.receivedDate || '-',
      'Remarks': d.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `All Demands`);
    XLSX.writeFile(wb, `all_demands_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('All demands exported successfully');
  };

  const handleReceiveDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemand) return;

    if (receiveData.receivedQty <= 0) {
      toast.error('Received quantity must be greater than 0');
      return;
    }

    setSubmitting(true);
    try {
      // First, find the part
      let partsQuery;
      if (selectedDemand.plNo) {
        partsQuery = query(collection(db, 'parts'), where('plNo', '==', selectedDemand.plNo));
      } else if (selectedDemand.partNo) {
        partsQuery = query(collection(db, 'parts'), where('partNo', '==', selectedDemand.partNo));
      }

      if (!partsQuery) {
        toast.error('Demand has no PL No. or Part No.');
        setSubmitting(false);
        return;
      }

      const partsSnap = await getDocs(partsQuery);
      
      const currentUserMachine = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      const targetMachineName = (selectedDemand.machineName || currentUserMachine || '').trim();

      const matchingPartDoc = !partsSnap.empty ? partsSnap.docs.find(docSnap => {
        const mName = ((docSnap.data() as any).machineName || '').trim();
        if (targetMachineName) {
          return mName.toLowerCase() === targetMachineName.toLowerCase();
        }
        return true;
      }) : null;

      const batch = writeBatch(db);
      let partId = '';
      const newRate = receiveData.rate || selectedDemand.approvedRate || selectedDemand.rate || 0;
      const newLocation = receiveData.location || '';

      if (matchingPartDoc) {
        partId = matchingPartDoc.id;
        const partData = matchingPartDoc.data() as any;
        const newStock = (partData.stock || 0) + receiveData.receivedQty;
        const effectiveRate = newRate > 0 ? newRate : (partData.rate || 0);
        const effectiveLocation = newLocation || partData.location || '';
        const newTotalValue = newStock * effectiveRate;

        batch.update(doc(db, 'parts', partId), {
          stock: newStock,
          rate: effectiveRate,
          location: effectiveLocation,
          totalValue: newTotalValue,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const newPartRef = doc(collection(db, 'parts'));
        partId = newPartRef.id;
        batch.set(newPartRef, {
          plNo: selectedDemand.plNo || '',
          partNo: selectedDemand.partNo || '',
          description: selectedDemand.description || '',
          stock: receiveData.receivedQty,
          rate: newRate,
          totalValue: receiveData.receivedQty * newRate,
          unit: selectedDemand.unit || 'Nos',
          location: newLocation || 'Main Depot',
          machineName: targetMachineName,
          whetherUse: selectedDemand.whetherUse || 'CS',
          itemCondition: selectedDemand.whetherUse || 'New',
          createdAt: new Date().toISOString(),
        });
      }

      // Calculate accumulated received quantity and updated status
      const previouslyReceived = selectedDemand.receivedQty || 0;
      const currentReceived = receiveData.receivedQty;
      const totalReceived = previouslyReceived + currentReceived;
      const targetGiven = selectedDemand.giveQty !== undefined ? selectedDemand.giveQty : selectedDemand.qty;

      const newStatus = totalReceived >= targetGiven ? 'completed' : 'approved';

      const existingReceipts = selectedDemand.receipts || [];
      const newReceipt = {
        qty: currentReceived,
        date: receiveData.receivedDate,
        rate: newRate,
        location: newLocation,
        remarks: receiveData.remarks || '',
        receiverName: currentEmployeeName || auth.currentUser?.email || 'Employee',
        receivedFrom: selectedDemand.issuedFromMachine || selectedDemand.forwardedToName || 'Depot',
        itemCondition: selectedDemand.whetherUse || 'New',
        timestamp: new Date().toISOString(),
      };
      const updatedReceipts = [...existingReceipts, newReceipt];

      // Update demand status & receipt records
      const demandRef = doc(db, 'demands', selectedDemand.id);
      batch.update(demandRef, {
        status: newStatus,
        receivedQty: totalReceived,
        receivedDate: receiveData.receivedDate,
        receipts: updatedReceipts,
        lastReceivedDate: receiveData.receivedDate,
      });

      // Add to transaction history (formatted for Accountal Register)
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: partId,
        plNo: selectedDemand.plNo || '',
        partNo: selectedDemand.partNo || '',
        description: selectedDemand.description || '',
        type: 'received',
        qty: receiveData.receivedQty,
        unit: selectedDemand.unit || 'Nos',
        rate: newRate,
        totalValue: receiveData.receivedQty * newRate,
        date: receiveData.receivedDate,
        details: `Accountal Receipt: ${receiveData.receivedQty} ${selectedDemand.unit || 'Nos'} received from demand ${selectedDemand.demandNo || selectedDemand.id}${receiveData.remarks ? ` (${receiveData.remarks})` : ''}`,
        remarks: receiveData.remarks || `Received against demand ${selectedDemand.demandNo || ''}`,
        machineName: targetMachineName,
        voucherNo: selectedDemand.issueNoteNo || selectedDemand.demandNo || `VR-${format(new Date(), 'yy')}-${selectedDemand.id.slice(-6).toUpperCase()}`,
        demandNo: selectedDemand.demandNo || '',
        receiverName: currentEmployeeName || auth.currentUser?.email || 'Employee',
        receivedBy: currentEmployeeName || auth.currentUser?.email || 'Employee',
        receivedFrom: selectedDemand.issuedFromMachine || selectedDemand.forwardedToName || 'Depot',
        itemCondition: selectedDemand.whetherUse || 'New',
        whetherUse: selectedDemand.whetherUse || 'CS',
        companyName: selectedDemand.createdByCompanyName || currentEmployeeCompanyName || '',
        createdAt: new Date().toISOString(),
      });

      await batch.commit();

      // Log receive/complete action to demand_logs
      try {
        await addDoc(collection(db, 'demand_logs'), {
          demandId: selectedDemand.id,
          plNo: selectedDemand.plNo || '',
          partNo: selectedDemand.partNo || '',
          description: selectedDemand.description || '',
          action: newStatus === 'completed' ? 'COMPLETE' : 'RECEIVE',
          remark: `Received ${currentReceived} pcs on ${receiveData.receivedDate}. Total Received: ${totalReceived}/${targetGiven}. Status: ${newStatus.toUpperCase()}.${receiveData.remarks ? ` Note: ${receiveData.remarks}` : ''}`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.error('Error logging receive action to demand_logs:', logErr);
      }

      toast.success(newStatus === 'completed' 
        ? `Demand fully received and completed! Stock updated and accounted.` 
        : `Partially received: ${totalReceived} of ${targetGiven} (Status: Approved). Received: ${currentReceived} pcs.`
      );
      setShowReceiveModal(false);
      fetchDemands();
      fetchParts();
    } catch (error) {
      console.error('Error receiving demand:', error);
      toast.error('Failed to receive demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmployee) {
      toast.error('Only the Super Admin has permission to edit demands.');
      return;
    }
    setSubmitting(true);
    try {
      const demandRef = doc(db, 'demands', editDemandData.id);
      const machineToAssign = isEmployee ? userMachine : editDemandData.machineName;
      await updateDoc(demandRef, {
        plNo: editDemandData.plNo || '',
        partNo: editDemandData.partNo || '',
        description: editDemandData.description || '',
        qty: editDemandData.qty,
        date: editDemandData.date,
        status: editDemandData.status,
        whetherUse: editDemandData.whetherUse || 'CS',
        remarks: editDemandData.remarks || '',
        machineName: machineToAssign || '',
        imageUrl: editDemandData.imageUrl || '',
      });
      toast.success('Demand updated successfully');
      setShowEditModal(false);
      fetchDemands();
    } catch (error) {
      console.error('Error editing demand:', error);
      toast.error('Failed to update demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDemand = async () => {
    if (!demandToDelete) return;
    const demandObj = demands.find(d => d.id === demandToDelete);
    if (!demandObj) return;

    // Check if item has already been issued:
    const isIssued = checkIsIssued(demandObj);

    // User rule: "after issue item wah item ko delete n kar sake"
    if (isIssued) {
      toast.error('Cannot delete: This item has already been issued or received (जारी या प्राप्त आइटम को डिलीट नहीं किया जा सकता).');
      setShowDeleteModal(false);
      setDemandToDelete(null);
      return;
    }

    const isCreator = checkIsCreator(demandObj);

    const isMasterOrRootAdmin = Boolean(
      (!isEmployee || auth.currentUser?.email === 'imranansari399605@gmail.com' || isMasterAdmin) &&
      userAccessType !== 'admin-light' &&
      userAccessType !== 'zonal-admin' &&
      userAccessType !== 'divisional-admin'
    );

    // User rule: "jo demand kare wah item ko jab tak issue n hoye wah item jab tak wah item ko delete kar sake"
    if (!isCreator && !isMasterOrRootAdmin) {
      toast.error('You can only delete demands that were created by you (आप केवल अपनी बनाई हुई मांग डिलीट कर सकते हैं).');
      setShowDeleteModal(false);
      setDemandToDelete(null);
      return;
    }

    setSubmitting(true);
    try {
      await archiveDeletedRecord({
        originalCollection: 'demands',
        originalId: demandToDelete,
        data: demandObj,
        moduleName: 'Demand / Requisition',
        itemSummary: `Demand #${demandObj.demandNo || demandToDelete.slice(0, 6)}: ${demandObj.plNo || demandObj.partNo || 'Item'} (${demandObj.qty || 0} ${demandObj.unit || 'Nos'}) • ${demandObj.machineName || 'Depot'}`,
        machineName: demandObj.machineName,
        companyName: (demandObj as any).companyName,
      });

      await deleteDoc(doc(db, 'demands', demandToDelete));
      toast.success('Demand deleted successfully');
      setShowDeleteModal(false);
      setDemandToDelete(null);
      fetchDemands();
    } catch (error) {
      console.error('Error deleting demand:', error);
      toast.error('Failed to delete demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForwardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forwardingDemand || !selectedForwardEmployeeId) return;
    setSubmitting(true);
    try {
      const selectedEmp = employeeList.find(emp => emp.id === selectedForwardEmployeeId);
      const recipientName = selectedEmp?.name || selectedEmp?.email || 'Designated Official';
      const recipientEmail = selectedEmp?.email || '';
      const isCompanyAdmin = selectedEmp ? (selectedEmp.accessType === 'admin-light' || selectedEmp.accessType === 'zonal-admin' || selectedEmp.accessType === 'divisional-admin') : false;
      const isFullAdmin = selectedEmp ? (selectedEmp.accessType === 'full') : false;

      // 1. Update demand in Firestore
      await updateDoc(doc(db, 'demands', forwardingDemand.id), {
        forwardedTo: selectedForwardEmployeeId,
        forwardedToName: recipientName,
        forwardedToEmail: recipientEmail,
        forwardedToCompanyAdmin: isCompanyAdmin ? true : false,
        forwardedToAdmin: isFullAdmin ? true : false,
        forwardedToRole: selectedEmp?.accessType || 'limited',
        forwardedToAdminAt: isFullAdmin ? new Date().toISOString() : '',
        forwardedToCompanyAdminAt: isCompanyAdmin ? new Date().toISOString() : '',
        forwardedByUid: auth.currentUser?.uid || '',
        forwardedByEmail: auth.currentUser?.email || '',
        forwardedByName: currentEmployeeName || auth.currentUser?.email || 'Demand Initiator',
        forwardedByCompanyName: currentEmployeeCompanyName || '',
        forwardedAt: new Date().toISOString(),
      });

      // 2. Log to demand_logs for complete tracking history
      try {
        await addDoc(collection(db, 'demand_logs'), {
          demandId: forwardingDemand.id,
          plNo: forwardingDemand.plNo || '',
          partNo: forwardingDemand.partNo || '',
          description: forwardingDemand.description || '',
          action: 'FORWARD',
          remark: `Forwarded to ${recipientName}${selectedEmp?.designation ? ` (${selectedEmp.designation})` : ''}`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString(),
          newForwardedToName: recipientName
        });
      } catch (logErr) {
        console.warn('Could not add forward log:', logErr);
      }

      // 3. Send notification to the forwarded employee
      if (recipientEmail) {
        try {
          await addDoc(collection(db, 'notifications'), {
            targetEmail: recipientEmail,
            title: 'Demand Forwarded to You',
            message: `A demand for PL No. ${forwardingDemand.plNo || '-'} has been forwarded to you by ${currentEmployeeName || auth.currentUser?.email || 'an employee'}.`,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'announcement',
          });
        } catch (notifErr) {
          console.warn('Could not add forward notification:', notifErr);
        }
      }

      toast.success(`Demand forwarded to ${recipientName} successfully!`);

      // Keep a reference for background PDF generation
      const demandCopy = { ...forwardingDemand };

      // Immediately dismiss modal & stop button spinner to prevent infinite spinning
      setShowForwardModal(false);
      setSubmitting(false);
      fetchDemands();

      setTimeout(() => {
        setForwardingDemand(null);
        setSelectedForwardEmployeeId('');
      }, 350);

      // 4. Generate Demand PDF Voucher asynchronously in background without freezing UI
      setTimeout(async () => {
        try {
          const dNum = demandCopy.demandNo || `DEM-${format(new Date(demandCopy.date || Date.now()), 'yy')}-${demandCopy.id.slice(-6).toUpperCase()}`;
          const isComp = Boolean(!demandCopy.machineName || demandCopy.createdByCompanyName);
          const derivedZone = getZoneForMachine(demandCopy.machineName, demandCopy.date);
          await generateDemandPDF({
            demandNo: dNum,
            date: demandCopy.date || format(new Date(), 'yyyy-MM-dd'),
            plNo: demandCopy.plNo,
            partNo: demandCopy.partNo,
            description: demandCopy.description,
            qty: demandCopy.qty,
            machineName: demandCopy.machineName || '',
            companyName: demandCopy.createdByCompanyName || currentEmployeeCompanyName || '',
            isCompanyDemand: isComp,
            zone: derivedZone,
            remarks: demandCopy.remarks || '',
            forwardedTo: recipientName,
            forwardedBy: isComp
              ? `Company Administrator (${demandCopy.createdByCompanyName || currentEmployeeCompanyName || 'Admin'})`
              : (currentEmployeeName || auth.currentUser?.email || 'Demand Initiator'),
            status: 'FORWARDED',
            customLogo: demandCopy.customLogo || demandLogo || localStorage.getItem('demandLogo') || ''
          }, true);
          toast.success('Forward Voucher PDF generated & downloaded!');
        } catch (pdfErr) {
          console.error('Error generating PDF voucher:', pdfErr);
        }
      }, 100);

    } catch (error) {
      console.error('Error forwarding demand:', error);
      toast.error('Failed to forward demand.');
      setSubmitting(false);
    }
  };

  const handleRejectClick = (demandId: string) => {
    const demandObj = demands.find(d => d.id === demandId);
    if (demandObj) {
      if (checkIsCreator(demandObj)) {
        toast.error('You cannot reject a demand created by yourself (आप अपनी स्वयं की बनाई मांग को अस्वीकृत नहीं कर सकते).');
        return;
      }
    }
    setRejectingDemandId(demandId);
    setRejectReasonInput('');
    setShowRejectModal(true);
  };

  const submitRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDemandId) return;

    const dObj = demands.find(d => d.id === rejectingDemandId);
    if (dObj) {
      if (checkIsCreator(dObj)) {
        toast.error('You cannot reject a demand created by yourself (आप अपनी स्वयं की बनाई मांग को अस्वीकृत नहीं कर सकते).');
        setShowRejectModal(false);
        setRejectingDemandId(null);
        return;
      }
    }

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'demands', rejectingDemandId), {
        status: 'rejected',
        rejectReason: rejectReasonInput,
      });

      // Send notification and log to demand_logs
      const dObj = demands.find(d => d.id === rejectingDemandId);
      if (dObj) {
        // Log rejection action
        await addDoc(collection(db, 'demand_logs'), {
          demandId: rejectingDemandId,
          plNo: dObj.plNo || '',
          partNo: dObj.partNo || '',
          description: dObj.description || '',
          action: 'REJECT',
          remark: `Rejected with reason: ${rejectReasonInput}`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString()
        });

        if (dObj.createdByEmail) {
          await addDoc(collection(db, 'notifications'), {
            targetEmail: dObj.createdByEmail,
            title: 'Demand Rejected',
            message: `Your demand for PL No. ${dObj.plNo} has been rejected. Reason: ${rejectReasonInput}`,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'announcement',
          });
        }
      }

      toast.success('Demand rejected with reason');
      setShowRejectModal(false);
      setRejectingDemandId(null);
      setRejectReasonInput('');
      fetchDemands();
    } catch (error) {
      console.error('Error rejecting demand:', error);
      toast.error('Failed to reject demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForwardDemandToAdmin = async (demandId: string) => {
    try {
      const dObj = demands.find(d => d.id === demandId);
      const dRef = doc(db, 'demands', demandId);
      await updateDoc(dRef, {
        forwardedToAdmin: true,
        forwardedToAdminAt: new Date().toISOString(),
        forwardedAt: new Date().toISOString(),
        forwardedByName: currentEmployeeName || '',
        forwardedByEmail: auth.currentUser?.email || '',
        forwardedByUid: auth.currentUser?.uid || '',
      });

      // Log to demand_logs
      if (dObj) {
        await addDoc(collection(db, 'demand_logs'), {
          demandId: demandId,
          plNo: dObj.plNo || '',
          partNo: dObj.partNo || '',
          description: dObj.description || '',
          action: 'FORWARD_TO_ADMIN',
          remark: `Forwarded/Escalated to Master Admin`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString(),
          newForwardedToName: 'Master Admin'
        });
      }

      toast.success('Demand forwarded to Super Admin successfully!');

      fetchDemands();

      if (dObj) {
        setTimeout(async () => {
          try {
            const dNum = dObj.demandNo || `DEM-${format(new Date(dObj.date || Date.now()), 'yy')}-${dObj.id.slice(-6).toUpperCase()}`;
            const isComp = Boolean(!dObj.machineName || dObj.createdByCompanyName);
            const derivedZone = getZoneForMachine(dObj.machineName, dObj.date);
            await generateDemandPDF({
              demandNo: dNum,
              date: dObj.date || format(new Date(), 'yyyy-MM-dd'),
              plNo: dObj.plNo,
              partNo: dObj.partNo,
              description: dObj.description,
              qty: dObj.qty,
              machineName: dObj.machineName || '',
              companyName: dObj.createdByCompanyName || currentEmployeeCompanyName || '',
              isCompanyDemand: isComp,
              zone: derivedZone,
              remarks: dObj.remarks || '',
              forwardedTo: 'Master Super Admin',
              forwardedBy: isComp
                ? `Company Administrator (${dObj.createdByCompanyName || 'Admin'})`
                : (currentEmployeeName || auth.currentUser?.email || 'Employee'),
              status: 'FORWARDED TO SUPER ADMIN',
              customLogo: dObj.customLogo || demandLogo || localStorage.getItem('demandLogo') || ''
            }, true);
            toast.success('Forward Voucher PDF generated & downloaded!');
          } catch (err) {
            console.error('Error generating PDF:', err);
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error forwarding demand to admin:', error);
      toast.error('Failed to forward demand to Super Admin.');
    }
  };

  const handleForwardDemandToCompanyAdmin = async (demandId: string) => {
    try {
      const dObj = demands.find(d => d.id === demandId);
      const dRef = doc(db, 'demands', demandId);
      await updateDoc(dRef, {
        forwardedToCompanyAdmin: true,
        forwardedToCompanyAdminAt: new Date().toISOString(),
        forwardedAt: new Date().toISOString(),
        forwardedByUid: auth.currentUser?.uid || '',
        forwardedByEmail: auth.currentUser?.email || '',
        forwardedByName: currentEmployeeName || '',
        forwardedByCompanyName: currentEmployeeCompanyName || '',
      });

      // Log to demand_logs
      if (dObj) {
        await addDoc(collection(db, 'demand_logs'), {
          demandId: demandId,
          plNo: dObj.plNo || '',
          partNo: dObj.partNo || '',
          description: dObj.description || '',
          action: 'FORWARD_TO_COMPANY_ADMIN',
          remark: `Forwarded to Company Admin`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString(),
          newForwardedToName: 'Company Admin'
        });
      }

      toast.success('Demand forwarded to Company Admin successfully!');
      fetchDemands();

      if (dObj) {
        setTimeout(async () => {
          try {
            const dNum = dObj.demandNo || `DEM-${format(new Date(dObj.date || Date.now()), 'yy')}-${dObj.id.slice(-6).toUpperCase()}`;
            const isComp = Boolean(!dObj.machineName || dObj.createdByCompanyName);
            const derivedZone = getZoneForMachine(dObj.machineName, dObj.date);
            await generateDemandPDF({
              demandNo: dNum,
              date: dObj.date || format(new Date(), 'yyyy-MM-dd'),
              plNo: dObj.plNo,
              partNo: dObj.partNo,
              description: dObj.description,
              qty: dObj.qty,
              machineName: dObj.machineName || '',
              companyName: dObj.createdByCompanyName || currentEmployeeCompanyName || '',
              isCompanyDemand: isComp,
              zone: derivedZone,
              remarks: dObj.remarks || '',
              forwardedTo: 'Company Admin',
              forwardedBy: isComp
                ? `Company Administrator (${dObj.createdByCompanyName || 'Admin'})`
                : (currentEmployeeName || auth.currentUser?.email || 'Employee'),
              status: 'FORWARDED TO COMPANY ADMIN',
              customLogo: dObj.customLogo || demandLogo || localStorage.getItem('demandLogo') || ''
            }, true);
            toast.success('Forward Voucher PDF generated & downloaded!');
          } catch (err) {
            console.error('Error generating PDF:', err);
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error forwarding demand to company admin:', error);
      toast.error('Failed to forward demand to Company Admin.');
    }
  };

  const isMasterOrRootAdmin = Boolean(
    (!isEmployee || auth.currentUser?.email === 'imranansari399605@gmail.com' || isMasterAdmin) &&
    userAccessType !== 'admin-light' &&
    userAccessType !== 'zonal-admin' &&
    userAccessType !== 'divisional-admin'
  );

  const baseFilteredDemands = useMemo(() => {
    return demands.filter(d => {
      const plNo = d.plNo || '';
      const partNo = d.partNo || '';
      const demandNoStr = d.demandNo || `DEM-${format(new Date(d.date || Date.now()), 'yy')}-${d.id.slice(-6).toUpperCase()}`;
      const search = searchTerm.toLowerCase();
      
      const matchesSearch = plNo.toLowerCase().includes(search) || 
                            partNo.toLowerCase().includes(search) ||
                            demandNoStr.toLowerCase().includes(search) ||
                            (d.description && d.description.toLowerCase().includes(search)) ||
                            (d.machineName && d.machineName.toLowerCase().includes(search));
                            
      if (!matchesSearch) return false;

      if (!isMasterOrRootAdmin) {
        // User rule: "demand me jo create kiya hai only us machine ya jo create kiya hai use ke account me show kare other kisi ke account me show n kare but ADMIN MASTER ke account me show kare sabhi ka"
        const myEmail = (auth.currentUser?.email || '').trim().toLowerCase();
        const myMachine = (userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '').trim().toLowerCase();
        const hasAssignedMachine = myMachine && myMachine !== 'all' && myMachine !== 'none' && myMachine !== 'n/a';

        const isCreator = checkIsCreator(d);
        
        const isForMyMachine = Boolean(hasAssignedMachine) && (
          (Boolean(d.machineName) && d.machineName.trim().toLowerCase() === myMachine) ||
          (Boolean(d.requestingMachineName) && d.requestingMachineName.trim().toLowerCase() === myMachine)
        );

        // Hide if neither creator nor for this user's machine
        if (!isCreator && !isForMyMachine) {
          return false;
        }

        // If this demand was issued from another machine, hide from issuing machine's active demand view if not requesting machine
        if (d.issuedFromMachine && myMachine && d.issuedFromMachine.trim().toLowerCase() === myMachine && !isCreator && (d.requestingMachineName || d.machineName) !== myMachine) {
          return false;
        }
      } else {
        // For ADMIN MASTER account: show all demands, respecting selected filters
        if (selectedMachine !== 'all' && d.machineName !== selectedMachine && d.requestingMachineName !== selectedMachine) {
          return false;
        }

        if (selectedCompany !== 'all') {
          const creator = employeeList.find(e => 
            (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
            (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
            (e.id && d.createdByUid && e.id === d.createdByUid)
          );
          const demandCompany = d.createdByCompanyName || (creator ? creator.companyName || '' : '');
          if (demandCompany !== selectedCompany) {
            return false;
          }
        }
      }

      // Zone Filter
      if (filterZone !== 'all') {
        const pos = machinePositions[d.machineName || d.requestingMachineName || ''];
        if (!pos || pos.zone !== filterZone) return false;
      }

      // Division Filter
      if (filterDivision !== 'all') {
        const pos = machinePositions[d.machineName || d.requestingMachineName || ''];
        if (!pos || pos.division !== filterDivision) return false;
      }

      return true;
    });
  }, [demands, searchTerm, isMasterOrRootAdmin, userMachine, checkIsCreator, selectedMachine, selectedCompany, employeeList, filterZone, filterDivision, machinePositions]);

  // Counts for the 4 Radio Buttons: All, Pending, Received, Reject
  const statusCounts = useMemo(() => {
    let pending = 0;
    let received = 0;
    let rejected = 0;

    baseFilteredDemands.forEach(d => {
      if (d.status === 'rejected') {
        rejected++;
      } else if (checkIsIssued(d)) {
        received++;
      } else {
        pending++;
      }
    });

    return {
      all: baseFilteredDemands.length,
      pending,
      received,
      rejected,
    };
  }, [baseFilteredDemands, checkIsIssued]);

  // Data displayed according to the active radio filter
  const filteredDemands = useMemo(() => {
    if (demandStatusFilter === 'all') return baseFilteredDemands;
    return baseFilteredDemands.filter(d => {
      if (demandStatusFilter === 'pending') {
        return !checkIsIssued(d) && d.status !== 'rejected';
      }
      if (demandStatusFilter === 'received') {
        return checkIsIssued(d) && d.status !== 'rejected';
      }
      if (demandStatusFilter === 'rejected') {
        return d.status === 'rejected';
      }
      return true;
    });
  }, [baseFilteredDemands, demandStatusFilter, checkIsIssued]);

  const handleExportExcelByFilter = () => {
    if (filteredDemands.length === 0) {
      toast.error(`No ${demandStatusFilter} demands found to export.`);
      return;
    }

    const dataToExport = filteredDemands.map((d, idx) => {
      const dNum = d.demandNo || `DEM-${format(new Date(d.date || Date.now()), 'yy')}-${d.id.slice(-6).toUpperCase()}`;
      const isIssued = checkIsIssued(d);
      const isRejected = d.status === 'rejected';
      const statusLabel = isRejected ? 'REJECTED' : isIssued ? 'RECEIVED / COMPLETED' : 'PENDING';
      const pendingQty = Math.max(0, (d.qty || 0) - (d.receivedQty || 0));

      return {
        'Sr No.': idx + 1,
        'Demand No.': dNum,
        'Date': d.date || '-',
        'Machine': d.machineName || 'General',
        'PL No.': d.plNo || '-',
        'Part No.': d.partNo || '-',
        'Description': d.description || '-',
        'Whether Use': d.whetherUse || 'CS',
        'Requisition Qty': d.qty || 0,
        'Unit': getDemandDisplayUnit(d),
        'Received Qty': d.receivedQty !== undefined ? d.receivedQty : 0,
        'Pending Qty': pendingQty,
        'Status': statusLabel,
        'Created By': d.createdByEmployeeName || d.createdByEmail || '-',
        'PF No.': d.createdByPfNo || '-',
        'Forwarded To': d.forwardedToName || '-',
        'Reject Reason': d.rejectReason || '-',
        'Remarks': d.remarks || '-',
      };
    });

    const filterName = demandStatusFilter === 'all' ? 'All' :
                       demandStatusFilter === 'pending' ? 'Pending' :
                       demandStatusFilter === 'received' ? 'Received' : 'Rejected';

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${filterName} Demands`);
    XLSX.writeFile(wb, `demands_${demandStatusFilter}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(`${filterName} demands exported to Excel successfully!`);
  };

  const handleExportPDFByFilter = () => {
    if (filteredDemands.length === 0) {
      toast.error(`No ${demandStatusFilter} demands found to export.`);
      return;
    }

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const filterTitle = demandStatusFilter === 'all' ? 'ALL MATERIAL DEMANDS' :
                          demandStatusFilter === 'pending' ? 'PENDING MATERIAL DEMANDS' :
                          demandStatusFilter === 'received' ? 'RECEIVED / COMPLETED MATERIAL DEMANDS' : 'REJECTED MATERIAL DEMANDS';

      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('INDIAN RAILWAYS - TRACK MACHINE REQUISITIONS (DEMAND REPORT)', 14, 12);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const subInfo = `Filter: ${filterTitle}  |  Total Demands: ${filteredDemands.length}  |  Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')}`;
      doc.text(subInfo, 14, 17);

      const tableData = filteredDemands.map((d, idx) => {
        const dNum = d.demandNo || `DEM-${format(new Date(d.date || Date.now()), 'yy')}-${d.id.slice(-6).toUpperCase()}`;
        const isIssued = checkIsIssued(d);
        const isRejected = d.status === 'rejected';
        const statusLabel = isRejected ? 'REJECTED' : isIssued ? 'RECEIVED' : 'PENDING';
        const pendingQty = Math.max(0, (d.qty || 0) - (d.receivedQty || 0));

        return [
          idx + 1,
          dNum,
          d.date ? format(new Date(d.date), 'dd-MM-yyyy') : '-',
          d.machineName || 'General',
          d.plNo || '-',
          d.partNo || '-',
          (d.description || '-').substring(0, 32),
          d.whetherUse || 'CS',
          `${d.qty || 0} ${getDemandDisplayUnit(d)}`,
          `${d.receivedQty || 0} ${getDemandDisplayUnit(d)}`,
          `${pendingQty} ${getDemandDisplayUnit(d)}`,
          statusLabel,
          d.createdByEmployeeName || d.createdByPfNo || '-',
          (d.rejectReason || d.remarks || '-').substring(0, 24),
        ];
      });

      autoTable(doc, {
        startY: 21,
        head: [['#', 'DEMAND NO', 'DATE', 'MACHINE', 'PL NO', 'PART NO', 'DESCRIPTION', 'TYPE', 'REQ', 'RECV', 'PENDING', 'STATUS', 'BY', 'REMARKS']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 26 },
          2: { cellWidth: 18 },
          3: { cellWidth: 16 },
          4: { cellWidth: 20 },
          5: { cellWidth: 20 },
          6: { cellWidth: 42 },
          7: { cellWidth: 12, halign: 'center' },
          8: { cellWidth: 16, halign: 'right' },
          9: { cellWidth: 16, halign: 'right' },
          10: { cellWidth: 16, halign: 'right' },
          11: { cellWidth: 18, halign: 'center' },
          12: { cellWidth: 22 },
          13: { cellWidth: 25 },
        },
        margin: { left: 10, right: 10 },
      });

      doc.save(`Demands_${demandStatusFilter}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('Demands PDF exported successfully!');
    } catch (err) {
      console.error('PDF export error:', err);
      handleExportPendingPDF();
    }
  };

  const filteredUnconnectedReceipts = unconnectedReceipts.filter(r => {
    if (isEmployee) {
      const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        if (r.companyName && r.companyName !== myCompany) return false;

        const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
        const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
        if (r.machineName && companyMachines.size > 0 && !companyMachines.has(r.machineName)) {
          return false;
        }
      }

      if (userAccessType === 'admin-light') {
        if (selectedMachine !== 'all' && r.machineName && r.machineName !== selectedMachine) {
          return false;
        }
      } else {
        const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (myMachine && r.machineName && r.machineName !== myMachine) {
          return false;
        }
      }
    } else {
      if (selectedCompany !== 'all' && r.companyName && r.companyName !== selectedCompany) {
        return false;
      }
      if (selectedMachine !== 'all' && r.machineName && r.machineName !== selectedMachine) {
        return false;
      }
      if (filterZone !== 'all' && r.zone && r.zone !== filterZone) {
        return false;
      }
      if (filterDivision !== 'all' && r.division && r.division !== filterDivision) {
        return false;
      }
    }

    if (receiptSearchTerm) {
      const s = receiptSearchTerm.toLowerCase();
      const matchSearch =
        (r.partNo && r.partNo.toLowerCase().includes(s)) ||
        (r.plNo && r.plNo.toLowerCase().includes(s)) ||
        (r.description && r.description.toLowerCase().includes(s)) ||
        (r.machineName && r.machineName.toLowerCase().includes(s)) ||
        (r.employeeName && r.employeeName.toLowerCase().includes(s)) ||
        (r.employeeId && r.employeeId.toLowerCase().includes(s)) ||
        (r.location && r.location.toLowerCase().includes(s));
      if (!matchSearch) return false;
    }

    return true;
  });

  const handleOpenAddReceiptModal = () => {
    const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
    const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
    setReceiptForm({
      voucherNo: '',
      zone: '',
      division: '',
      machineName: (isEmployee && userAccessType !== 'admin-light' && myMachine) ? myMachine : '',
      companyName: myCompany || '',
      selectMode: 'machine',
      employeeId: '',
      employeeName: '',
      partNo: '',
      plNo: '',
      description: '',
      unit: 'Nos',
      customUnit: '',
      returnedDate: format(new Date(), 'yyyy-MM-dd'),
      qtyReturned: 0,
      location: '',
      remarks: '',
    });
    setShowAddReceiptModal(true);
  };

  const activeReceiptMachine = receiptForm.employeeId
    ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
    : (receiptForm.machineName || '');

  const availablePartsForReceipt = fullPartsList.filter(p => {
    if (!activeReceiptMachine) return true;
    return p.machineName && p.machineName.trim().toLowerCase() === activeReceiptMachine.trim().toLowerCase();
  });

  const activeEditReceiptMachine = editReceiptForm.employeeId
    ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
    : (editReceiptForm.machineName || '');

  const availablePartsForEditReceipt = fullPartsList.filter(p => {
    if (!activeEditReceiptMachine) return true;
    return p.machineName && p.machineName.trim().toLowerCase() === activeEditReceiptMachine.trim().toLowerCase();
  });

  const currentStockInModal = (() => {
    if (!selectedDemand) return 0;
    const key = selectedDemand.plNo || selectedDemand.partNo || '';
    const st = key && parts[key] !== undefined ? parts[key] : 0;
    return Number.isNaN(st) ? 0 : st;
  })();

  const handleExportPendingPDF = () => {
    const formatToDDMMYYYY = (dateStr: string | undefined | null) => {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    };

    const formatCreatorName = (name: string | undefined | null): string => {
      if (!name) return '-';
      const trimmed = name.trim();
      return trimmed.replace('@employee.billedapp.com', '');
    };

    const pendingList = filteredDemands.filter(d => {
      const isCompleted = d.status === 'completed' || (d.receivedQty !== undefined && d.receivedQty >= (d.qty || 0));
      return !isCompleted;
    });

    if (pendingList.length === 0) {
      toast.error('No pending demands found to export.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup blocked! Please allow popups to export to PDF.');
      return;
    }

    const headers = [
      "Sr.",
      "Demand No.",
      "Date",
      "Machine",
      "PL No.",
      "Part No.",
      "Description",
      "Type",
      "Req Qty",
      "Recv Qty",
      "Pending Qty",
      "Status",
      "Forwarded To",
      "Remarks"
    ];

    const totalPendingQty = pendingList.reduce((acc, d) => acc + Math.max(0, (d.qty || 0) - (d.receivedQty || 0)), 0);

    const rowsHtml = pendingList.map((d, idx) => {
      const dNum = d.demandNo || `DEM-${format(new Date(d.date || Date.now()), 'yy')}-${d.id.slice(-6).toUpperCase()}`;
      const pendingQty = Math.max(0, (d.qty || 0) - (d.receivedQty || 0));
      const isPartiallyReceived = (d.receivedQty || 0) > 0 && pendingQty > 0;

      return `
        <tr>
          <td style="text-align: center; font-weight: bold; color: #64748b; font-family: monospace;">${idx + 1}</td>
          <td style="font-family: monospace; font-weight: 700; color: #4338ca; font-size: 7.5px;">${dNum}</td>
          <td style="font-family: monospace; font-weight: 600;">${formatToDDMMYYYY(d.date)}</td>
          <td style="font-weight: 700; color: #0f172a;">${d.machineName || 'General'}</td>
          <td style="font-family: monospace; font-weight: 700; color: #0f766e;">${d.plNo || '-'}</td>
          <td style="font-family: monospace; color: #334155;">${d.partNo || '-'}</td>
          <td style="font-weight: 500; color: #1e293b; font-size: 7.5px;">${d.description || '-'}</td>
          <td style="text-align: center; font-weight: 700; color: #0369a1; font-size: 7.5px;">${d.whetherUse || 'CS'}</td>
          <td style="font-family: monospace; text-align: right; font-weight: 600;">${d.qty || 0} <span style="font-size: 6.5px; color: #64748b;">${getDemandDisplayUnit(d)}</span></td>
          <td style="font-family: monospace; text-align: right; color: #047857; font-weight: 600;">${d.receivedQty || 0} <span style="font-size: 6.5px; color: #64748b;">${getDemandDisplayUnit(d)}</span></td>
          <td style="font-family: monospace; text-align: right; font-weight: 800; color: #b91c1c; background-color: #fef2f2;">${pendingQty} <span style="font-size: 6.5px; color: #991b1b;">${getDemandDisplayUnit(d)}</span></td>
          <td style="text-align: center; font-weight: 700; font-size: 7px; color: ${isPartiallyReceived ? '#d97706' : '#b45309'}; text-transform: uppercase;">
            ${isPartiallyReceived ? 'PARTIAL' : (d.status || 'PENDING').toUpperCase()}
          </td>
          <td style="font-size: 7.5px; font-weight: 600; color: #4338ca;">${d.forwardedToName || '-'}</td>
          <td style="font-size: 7px; color: #475569; line-height: 1.25;">${d.remarks || '-'}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Indian Railways - Pending Material Demands Report</title>
          <style>
            *, *:before, *:after {
              box-sizing: border-box;
            }
            @page {
              size: A4 landscape;
              margin: 8mm 10mm;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .no-print { display: none !important; }
              tr { page-break-inside: avoid; break-inside: avoid; }
              thead { display: table-header-group; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background-color: #fff;
              -webkit-print-color-adjust: exact;
            }
            .report-header {
              border-bottom: 2px solid #0f172a;
              padding-bottom: 8px;
              margin-bottom: 12px;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .report-title {
              font-size: 15px;
              font-weight: 800;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 4px 0;
            }
            .report-subtitle {
              font-size: 10px;
              color: #b91c1c;
              font-weight: 700;
              letter-spacing: 0.3px;
              margin-bottom: 4px;
            }
            .report-meta {
              font-size: 8.5px;
              color: #475569;
              font-weight: 600;
              line-height: 1.4;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 4px;
              table-layout: fixed;
              border: 1.5px solid #64748b;
            }
            th, td {
              box-sizing: border-box;
              overflow-wrap: break-word;
              word-wrap: break-word;
              word-break: break-word;
              white-space: normal !important;
              vertical-align: top;
            }
            th {
              background-color: #1e293b !important;
              color: #ffffff !important;
              border: 1px solid #334155;
              padding: 5px 4px;
              text-align: left;
              font-size: 7.5px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              line-height: 1.25;
            }
            td {
              border: 1px solid #94a3b8;
              padding: 4.5px 4px;
              font-size: 7.5px;
              color: #1e293b;
              line-height: 1.3;
              vertical-align: top;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 3%; }
            th:nth-child(2), td:nth-child(2) { width: 7.5%; }
            th:nth-child(3), td:nth-child(3) { width: 6.5%; }
            th:nth-child(4), td:nth-child(4) { width: 7%; }
            th:nth-child(5), td:nth-child(5) { width: 7%; }
            th:nth-child(6), td:nth-child(6) { width: 6.5%; }
            th:nth-child(7), td:nth-child(7) { width: 14%; }
            th:nth-child(8), td:nth-child(8) { width: 4.5%; }
            th:nth-child(9), td:nth-child(9) { width: 5%; }
            th:nth-child(10), td:nth-child(10) { width: 4.5%; }
            th:nth-child(11), td:nth-child(11) { width: 5%; }
            th:nth-child(12), td:nth-child(12) { width: 5.5%; }
            th:nth-child(13), td:nth-child(13) { width: 7.5%; }
            th:nth-child(14), td:nth-child(14) { width: 8%; }
            th:nth-child(15), td:nth-child(15) { width: 8.5%; }
          </style>
        </head>
        <body>
          <div class="report-header">
            <div>
              <h1 class="report-title">Indian Railways - Material Demands Report</h1>
              <div class="report-subtitle">EXCLUSIVELY SHOWING PENDING / UNFULFILLED DEMANDS (लंबित सामग्री माँग विवरण)</div>
              <div class="report-meta">
                Generated: <strong>${new Date().toLocaleString()}</strong> | 
                Machine Filter: <strong>${selectedMachine === 'all' ? 'All Machines' : selectedMachine}</strong>
                ${selectedCompany !== 'all' ? ` | Company: <strong>${selectedCompany}</strong>` : ''}
                ${filterZone !== 'all' ? ` | Zone: <strong>${filterZone}${filterDivision !== 'all' ? ` / ${filterDivision}` : ''}</strong>` : ''}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="background-color: #fee2e2; border: 1px solid #f87171; border-radius: 6px; padding: 6px 10px; display: inline-block;">
                <div style="font-size: 8px; font-weight: 700; color: #991b1b; text-transform: uppercase;">Total Pending Demands</div>
                <div style="font-size: 14px; font-weight: 900; color: #b91c1c; font-family: monospace;">${pendingList.length} items <span style="font-size: 10px; font-weight: 700; color: #7f1d1d;">(${totalPendingQty} qty)</span></div>
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="15" style="text-align: center; padding: 15px; color: #64748b;">No pending demands found.</td></tr>'}
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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-3xl font-black text-primary tracking-tight">Demand Module</h1>

          <div className="flex flex-wrap items-center gap-2">
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

            {/* Machine Filter */}
            <select
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm",
                !filterPerms.canChangeMachine && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
              )}
              value={selectedMachine}
              onChange={e => {
                const val = e.target.value;
                setSelectedMachine(val);
                if (val !== 'all') {
                  const pos = machinePositions[val];
                  if (pos) {
                    if (pos.zone && filterPerms.canChangeZone) {
                      setFilterZone(pos.zone);
                    }
                    if (pos.division && filterPerms.canChangeDivision) {
                      setFilterDivision(pos.division);
                    }
                  }
                  if (!isEmployee) {
                    const empMatch = employeeList.find(emp => emp.machineName === val && emp.companyName);
                    if (empMatch?.companyName) {
                      setSelectedCompany(empMatch.companyName);
                    }
                  }
                }
              }}
              disabled={!filterPerms.canChangeMachine}
              title={!filterPerms.canChangeMachine ? "Machine filter locked to your assigned machine" : "Select Machine"}
            >
              <option value="all">All Machines</option>
              {(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'divisional-admin' || userAccessType === 'full')
                ? Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                : allCreatedMachines
              ).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {/* Zone Filter */}
            <select
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm",
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

            {/* Division Filter */}
            <select
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm disabled:opacity-50",
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
          </div>
        </div>

        {/* Tab specific Action Buttons */}
        {activeTab === 'demands' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
              <input
                type="text"
                placeholder="Search PL No, Part No, Demand No..."
                className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-60"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            {/* 4 Radio Buttons Filter: All, Pending, Received, Reject */}
            <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200 shadow-inner">
              {/* All */}
              <label
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all select-none",
                  demandStatusFilter === 'all'
                    ? "bg-white text-indigo-700 shadow-sm border border-indigo-100"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <input
                  type="radio"
                  name="demandStatusFilter"
                  value="all"
                  checked={demandStatusFilter === 'all'}
                  onChange={() => setDemandStatusFilter('all')}
                  className="w-3.5 h-3.5 text-indigo-600 accent-indigo-600 cursor-pointer"
                />
                <span>All</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-black",
                  demandStatusFilter === 'all' ? "bg-indigo-100 text-indigo-800" : "bg-slate-200/80 text-slate-600"
                )}>
                  {statusCounts.all}
                </span>
              </label>

              {/* Pending */}
              <label
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all select-none",
                  demandStatusFilter === 'pending'
                    ? "bg-amber-50 text-amber-900 shadow-sm border border-amber-200"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <input
                  type="radio"
                  name="demandStatusFilter"
                  value="pending"
                  checked={demandStatusFilter === 'pending'}
                  onChange={() => setDemandStatusFilter('pending')}
                  className="w-3.5 h-3.5 text-amber-600 accent-amber-600 cursor-pointer"
                />
                <span>Pending</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-black",
                  demandStatusFilter === 'pending' ? "bg-amber-200 text-amber-900" : "bg-slate-200/80 text-slate-600"
                )}>
                  {statusCounts.pending}
                </span>
              </label>

              {/* Received */}
              <label
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all select-none",
                  demandStatusFilter === 'received'
                    ? "bg-emerald-50 text-emerald-900 shadow-sm border border-emerald-200"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <input
                  type="radio"
                  name="demandStatusFilter"
                  value="received"
                  checked={demandStatusFilter === 'received'}
                  onChange={() => setDemandStatusFilter('received')}
                  className="w-3.5 h-3.5 text-emerald-600 accent-emerald-600 cursor-pointer"
                />
                <span>Received</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-black",
                  demandStatusFilter === 'received' ? "bg-emerald-200 text-emerald-900" : "bg-slate-200/80 text-slate-600"
                )}>
                  {statusCounts.received}
                </span>
              </label>

              {/* Reject */}
              <label
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all select-none",
                  demandStatusFilter === 'rejected'
                    ? "bg-rose-50 text-rose-900 shadow-sm border border-rose-200"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                )}
              >
                <input
                  type="radio"
                  name="demandStatusFilter"
                  value="rejected"
                  checked={demandStatusFilter === 'rejected'}
                  onChange={() => setDemandStatusFilter('rejected')}
                  className="w-3.5 h-3.5 text-rose-600 accent-rose-600 cursor-pointer"
                />
                <span>Reject</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-black",
                  demandStatusFilter === 'rejected' ? "bg-rose-200 text-rose-900" : "bg-slate-200/80 text-slate-600"
                )}>
                  {statusCounts.rejected}
                </span>
              </label>
            </div>

            {/* Export PDF Button */}
            <button
              type="button"
              onClick={handleExportPDFByFilter}
              className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 px-3 py-2 rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              title={`Export ${demandStatusFilter.toUpperCase()} Demands to PDF Report`}
            >
              <FileText size={16} className="text-rose-600" />
              <span>Export PDF ({demandStatusFilter === 'all' ? 'All' : demandStatusFilter === 'pending' ? 'Pending' : demandStatusFilter === 'received' ? 'Received' : 'Reject'})</span>
            </button>

            {/* Export Excel Button */}
            <button
              type="button"
              onClick={handleExportExcelByFilter}
              className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-2 rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              title={`Export ${demandStatusFilter.toUpperCase()} Demands to Excel`}
            >
              <Download size={16} className="text-emerald-600" />
              <span>Export Excel ({demandStatusFilter === 'all' ? 'All' : demandStatusFilter === 'pending' ? 'Pending' : demandStatusFilter === 'received' ? 'Received' : 'Reject'})</span>
            </button>

            {isMasterAdmin && (
              <button
                type="button"
                onClick={() => setShowLogoModal(true)}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-3 py-2 rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
                title="Upload & Manage Demand PDF Logo"
              >
                <ImageIcon className="w-4 h-4 text-primary" />
                <span>PDF Logo</span>
              </button>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer ml-auto"
              title="Create New Demand (नई माँग बनाएँ)"
            >
              <Plus size={18} /> Create Demand
            </button>
          </div>
        )}

        {activeTab === 'unconnected' && (
          <div className="flex flex-wrap gap-2">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
              <input
                type="text"
                placeholder="Search Receipts..."
                className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-64"
                value={receiptSearchTerm}
                onChange={e => setReceiptSearchTerm(e.target.value)}
              />
            </div>
            
            <button
              type="button"
              onClick={exportUnconnectedReceipts}
              className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              title="Export Unconnected Material Receipts"
            >
              <Download size={16} /> Export Excel
            </button>

            {!(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin')) && (
              <button
                onClick={handleOpenAddReceiptModal}
                className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <Plus size={20} /> Log Unconnected Receipt
              </button>
            )}
          </div>
        )}
      </div>
      </div>

      {activeTab === 'demands' && (
      <div className="flex-grow flex flex-col min-h-0 pb-16">
      <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-auto flex-grow min-h-0">
        <table className="w-full text-left min-w-[800px] border-collapse">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Sr No.</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Demand No.</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Date</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">PL No.</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Part No.</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Description</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Whether Use</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Remarks</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Current Stock</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Demand Qty</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Status</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Received Qty</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Received Date</th>
              <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {filteredDemands.map((demand, index) => {
              const dNum = demand.demandNo || `DEM-${format(new Date(demand.date || Date.now()), 'yy')}-${demand.id.slice(-6).toUpperCase()}`;
              const isItemReceived = checkIsIssued(demand);
              const isCreator = checkIsCreator(demand);
              const canDelete = !isItemReceived && (isCreator || isMasterOrRootAdmin);

              return (
              <tr key={demand.id} className={cn(
                "transition-colors",
                isItemReceived
                  ? "bg-emerald-50/70 hover:bg-emerald-100/60 border-l-4 border-l-emerald-500 font-medium"
                  : demand.status === 'rejected'
                    ? "bg-rose-50/40 hover:bg-rose-50/60 border-l-4 border-l-rose-400"
                    : "hover:bg-surface-container-low"
              )}>
                <td className="px-6 py-4 text-xs font-bold text-slate-500">{index + 1}</td>
                <td className="px-6 py-4 text-xs font-mono font-bold text-indigo-700 bg-indigo-50/50 rounded-md whitespace-nowrap">{dNum}</td>
                <td className="px-6 py-4 text-sm">{demand.date}</td>
                <td className="px-6 py-4 text-xs font-mono font-bold text-primary">{demand.plNo}</td>
                 <td className="px-6 py-4 text-xs font-mono">{demand.partNo || '-'}</td>
                <td className="px-6 py-4 text-sm font-medium">
                  <div className="flex items-center gap-3">
                    {demand.imageUrl && (
                      <div className="w-10 h-10 rounded border border-slate-200/60 overflow-hidden flex-shrink-0 bg-slate-50 flex items-center justify-center">
                        <img src={demand.imageUrl} alt={demand.description} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className={cn("font-semibold", isItemReceived ? "text-emerald-950 font-bold" : "text-slate-800")}>
                      {demand.description || '-'}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={cn(
                    "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm",
                    demand.whetherUse === 'CS' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                    demand.whetherUse === 'MS' ? "bg-indigo-50 text-indigo-700 border border-indigo-200" :
                    demand.whetherUse === 'T&P' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                    "bg-amber-50 text-amber-700 border border-amber-200"
                  )}>
                    {demand.whetherUse || 'CS'}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-on-surface-variant max-w-xs truncate" title={demand.remarks}>
                  {demand.remarks || '-'}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-indigo-600">
                  {(() => {
                    const key = demand.plNo || demand.partNo || '';
                    const st = key && parts[key] !== undefined ? parts[key] : 0;
                    return Number.isNaN(st) ? 0 : st;
                  })()}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-slate-900">
                  {demand.qty || 0} <span className="text-[11px] font-semibold text-slate-500">{getDemandDisplayUnit(demand)}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    {(() => {
                      if (isItemReceived) {
                        return (
                          <span className="px-2.5 py-1 rounded text-[10px] font-black uppercase flex items-center gap-1 w-fit bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-xs">
                            <CheckCircle size={11} className="text-emerald-600" /> Received
                          </span>
                        );
                      }
                      
                      if (demand.status === 'rejected') {
                        return (
                          <span className="px-2 py-1 rounded text-[10px] font-black uppercase flex items-center gap-1 w-fit bg-red-100 text-red-700">
                            <XCircle size={10} /> Rejected
                          </span>
                        );
                      }

                      return (
                        <span className="px-2.5 py-1 rounded text-[10px] font-black uppercase flex items-center gap-1 w-fit bg-yellow-100 text-yellow-700">
                          <Clock size={10} /> Pending
                        </span>
                      );
                    })()}
                    {demand.status === 'rejected' && demand.rejectReason && (
                      <div className="text-[11px] text-red-600 font-bold bg-red-50 p-1 rounded border border-red-100 max-w-[150px] break-words" title={demand.rejectReason}>
                        Reason: {demand.rejectReason}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">
                  <div className={cn(isItemReceived ? "font-bold text-emerald-700" : "")}>
                    {demand.receivedQty !== undefined && demand.receivedQty !== null && Number(demand.receivedQty) > 0
                      ? `${demand.receivedQty} ${getDemandDisplayUnit(demand)}`
                      : (demand.giveQty !== undefined && Number(demand.giveQty) > 0 ? `${demand.giveQty} ${getDemandDisplayUnit(demand)}` : (demand.receivedQty || '-'))}
                  </div>
                  {demand.receipts && demand.receipts.length > 1 && (
                    <div className="text-[9px] text-slate-400 font-medium leading-tight mt-1 max-w-[120px] whitespace-normal">
                      History: {demand.receipts.map(r => `${r.qty} ${getDemandDisplayUnit(demand)}`).join(' + ')}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  <div className={cn(isItemReceived ? "font-bold text-emerald-800" : "")}>
                    {demand.receivedDate || (isItemReceived ? demand.date : '-')}
                  </div>
                  {demand.receipts && demand.receipts.length > 1 && (
                    <div className="text-[9px] text-slate-400 font-medium leading-tight mt-1 max-w-[120px] whitespace-normal">
                      Dates: {demand.receipts.map(r => r.date).join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1.5 items-center">
                    <button
                      onClick={() => handleShowTrackingDetails(demand)}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-all"
                      title="View Demand Tracking Details (मांग ट्रैकिंग विवरण)"
                    >
                      <Eye size={18} />
                    </button>

                    <button
                      onClick={async () => {
                        if (!demand.forwardedTo && !demand.forwardedAt && !demand.forwardedToName) {
                          toast.warning('PDF Voucher is downloaded upon forwarding the demand. Please forward this demand first (कृपया पहले डिमांड को फॉरवर्ड करें).');
                          return;
                        }
                        try {
                          toast.info('Generating PDF Voucher...');
                          const isComp = Boolean(!demand.machineName || demand.createdByCompanyName);
                          const derivedZone = getZoneForMachine(demand.machineName, demand.date);
                          await generateDemandPDF({
                            demandNo: dNum,
                            date: demand.date || format(new Date(), 'yyyy-MM-dd'),
                            plNo: demand.plNo,
                            partNo: demand.partNo,
                            description: demand.description,
                            qty: demand.qty,
                            machineName: demand.machineName || '',
                            companyName: demand.createdByCompanyName || currentEmployeeCompanyName || '',
                            isCompanyDemand: isComp,
                            zone: derivedZone,
                            remarks: demand.remarks || '',
                            forwardedTo: demand.forwardedToName || 'Master / Company Admin',
                            forwardedBy: isComp 
                              ? `Company Administrator (${demand.createdByCompanyName || 'Admin'})` 
                              : (demand.createdByEmployeeName || demand.createdByEmail || 'Demand Initiator'),
                            status: demand.status ? demand.status.toUpperCase() : 'PENDING',
                            customLogo: demand.customLogo || demandLogo || localStorage.getItem('demandLogo') || ''
                          }, true);
                          toast.success('PDF Voucher Downloaded!');
                        } catch (err) {
                          console.error(err);
                          toast.error('Failed to generate PDF voucher');
                        }
                      }}
                      className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-all"
                      title={demand.forwardedTo || demand.forwardedAt || demand.forwardedToName ? "Download Voucher PDF (माँग पत्र पीडीएफ)" : "PDF Voucher available once forwarded (फॉरवर्ड करने के बाद पीडीएफ उपलब्ध होगी)"}
                    >
                      <Download size={18} />
                    </button>
                    {(() => {
                      if (isItemReceived) {
                        return (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 shadow-xs">
                            <CheckCircle size={12} className="text-emerald-600" /> Received
                          </span>
                        );
                      }

                      if (demand.status === 'pending') {
                        return (
                          <>
                            {isAdmin ? (
                              <>
                                {isEmployee && userAccessType === 'full' && !demand.forwardedToCompanyAdmin && (
                                  <button
                                    onClick={() => {
                                      setForwardingDemand(demand);
                                      setSelectedForwardEmployeeId('');
                                      setShowForwardModal(true);
                                    }}
                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center justify-center animate-pulse"
                                    title="Forward to Company Admin"
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                )}
                                {isEmployee && userAccessType === 'admin-light' && !demand.forwardedToAdmin && (
                                  <button
                                    onClick={() => {
                                      setForwardingDemand(demand);
                                      setSelectedForwardEmployeeId('');
                                      setShowForwardModal(true);
                                    }}
                                    className="p-2 text-purple-600 hover:bg-purple-50 rounded transition-colors flex items-center justify-center animate-pulse"
                                    title="Forward to Super Admin"
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                )}
                                {!isCreator && (
                                  <button
                                    onClick={() => handleRejectClick(demand.id)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                                    title="Reject Demand"
                                  >
                                    <XCircle size={18} />
                                  </button>
                                )}
                              </>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {demand.forwardedTo ? (
                                  <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold border border-slate-200 cursor-not-allowed">
                                    Forwarded
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setForwardingDemand(demand);
                                      setSelectedForwardEmployeeId('');
                                      setShowForwardModal(true);
                                    }}
                                    className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all border border-indigo-200 animate-pulse"
                                    title="Forward to Full Access Employee"
                                  >
                                    Forward
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        );
                      }

                      return <span className="text-[10px] font-bold text-outline uppercase mr-2">Locked</span>;
                    })()}

                    {/* Edit Demand: Admins or Creator (if not issued) */}
                    {(!isEmployee || (isCreator && !isItemReceived)) && (
                      <button
                        onClick={() => {
                          setEditDemandData({
                            id: demand.id,
                            plNo: demand.plNo,
                            partNo: demand.partNo || '',
                            description: demand.description || '',
                            qty: demand.qty,
                            date: demand.date,
                            status: demand.status,
                            whetherUse: demand.whetherUse || 'CS',
                            remarks: demand.remarks || '',
                            forwardedTo: demand.forwardedTo || '',
                            forwardedToName: demand.forwardedToName || '',
                            forwardedToEmail: demand.forwardedToEmail || '',
                            createdByUid: demand.createdByUid || '',
                            createdByEmail: demand.createdByEmail || '',
                            rejectReason: demand.rejectReason || '',
                            machineName: demand.machineName || '',
                            imageUrl: demand.imageUrl || '',
                          });
                          const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
                          const mName = demand.machineName || '';
                          if (mName && !standardMachines.includes(mName)) {
                            setIsCustomMachineEdit(true);
                            setCustomMachineEditInput(mName);
                          } else {
                            setIsCustomMachineEdit(false);
                            setCustomMachineEditInput('');
                          }
                          setShowEditModal(true);
                        }}
                        className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center"
                        title="Edit Demand"
                      >
                        <Edit size={18} />
                      </button>
                    )}

                    {/* Delete Demand: Creator or Master Admin can delete UNTIL issued; after issue, cannot delete */}
                    {canDelete && (
                      <button
                        onClick={() => {
                          setDemandToDelete(demand.id);
                          setShowDeleteModal(true);
                        }}
                        className="p-2 text-red-400 hover:text-red-600 transition-colors flex items-center justify-center"
                        title="Delete Demand (माँग हटाएं)"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                    {isItemReceived && (isCreator || isMasterOrRootAdmin) && (
                      <span
                        className="p-2 text-slate-300 cursor-not-allowed flex items-center justify-center"
                        title="Cannot delete: Item has been issued/received (जारी या प्राप्त सामग्री डिलीट नहीं की जा सकती)"
                      >
                        <Trash2 size={18} className="opacity-30" />
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
            {filteredDemands.length === 0 && (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FileText size={32} className="text-slate-300 stroke-[1.5]" />
                    <p className="text-sm font-bold text-slate-700">No Demands Found</p>
                    <p className="text-xs text-slate-400">
                      You can create a new demand by clicking "Create Demand" below or in the toolbar.
                    </p>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-gradient-to-br from-primary to-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer"
                    >
                      <Plus size={16} /> Create Demand
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
      )}

      {activeTab === 'unconnected' && (
        <div className="flex-grow flex flex-col min-h-0 pb-16">
          <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-auto flex-grow min-h-0">
            <table className="w-full text-left min-w-[1000px] border-collapse">
              <thead className="bg-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Sr No.</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Voucher No</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Returned Date</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Zone / Division</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Machine</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Company</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Part No / PL No</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Description</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Returned Qty (Transaction Qty)</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Location</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Remarks</th>
                  <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {filteredUnconnectedReceipts
                  .map((r, index) => (
                    <tr key={r.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-4 text-xs font-bold text-slate-500">{index + 1}</td>
                      <td className="px-6 py-4 text-xs font-mono font-bold text-indigo-700 bg-indigo-50/50 rounded-lg px-2.5 py-1 w-max">
                        {r.voucherNo || '-'}
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-700">
                        {r.returnedDate ? format(new Date(r.returnedDate), 'dd-MM-yyyy') : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-600">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700">{r.zone || '-'}</span>
                          <span className="text-[10px] text-slate-400">{r.division || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-indigo-700">{r.machineName || '-'}</td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-600">{r.companyName || '-'}</td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">Part: {r.partNo || '-'}</span>
                          <span className="text-[10px] text-slate-500">PL: {r.plNo || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600 max-w-xs truncate" title={r.description}>
                        {r.description || '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-full">{r.qtyReturned} {r.unit || 'Nos'}</span>
                          <span className="text-[10px] text-slate-400">Total Count: {r.transactionQty}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-600">{r.location || '-'}</td>
                      <td className="px-6 py-4 text-xs text-slate-500 max-w-xs truncate" title={r.remarks}>
                        {r.remarks || '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-right">
                        {isPrimaryAdmin ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEditReceipt(r)}
                              className="p-2 text-indigo-500 hover:text-indigo-700 hover:bg-slate-50 rounded transition-colors inline-flex items-center justify-center"
                              title="Edit Receipt Record"
                            >
                              <Edit size={18} />
                            </button>
                            <button
                              onClick={() => handleDeleteReceipt(r.id)}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-slate-50 rounded transition-colors inline-flex items-center justify-center"
                              title="Delete Receipt Record"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400 italic">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                {filteredUnconnectedReceipts.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-8 text-sm text-slate-400 font-bold">
                      No unconnected material receipts logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Demand Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div 
            key="add-demand-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="p-5 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-extrabold text-primary">Create New Demand</h2>
              <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface p-1 rounded-full hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddDemand} className="p-6 space-y-4">
              {/* Datalists for global PL No and Part No auto-fill suggestions */}
              <datalist id="pl-no-autocomplete">
                {Array.from(new Set([
                  ...fullPartsList.map(p => p.plNo).filter(Boolean),
                  ...demands.map(d => d.plNo).filter(Boolean)
                ])).map(pl => (
                  <option key={pl} value={pl} />
                ))}
              </datalist>

              <datalist id="part-no-autocomplete">
                {Array.from(new Set([
                  ...fullPartsList.map(p => p.partNo).filter(Boolean),
                  ...demands.map(d => d.partNo).filter(Boolean)
                ])).map(pn => (
                  <option key={pn} value={pn} />
                ))}
              </datalist>

              {/* Demand for Other Machine Toggle Section */}
              <div className="bg-gradient-to-r from-indigo-50/80 to-slate-50 border border-indigo-100 rounded-xl p-3.5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black uppercase text-indigo-950 block">
                      Demand for Other Machine (अन्य मशीन के लिए मांग)
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {isOtherMachine 
                        ? 'Select target Zone, Division, and Machine Name' 
                        : 'OFF (Normal demand for assigned machine)'}
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOtherMachine}
                      onChange={(e) => {
                        setIsOtherMachine(e.target.checked);
                        if (!e.target.checked) {
                          setOtherZone('');
                          setOtherDivision('');
                          setOtherMachineName('');
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    <span className="ml-2.5 text-xs font-black text-slate-800">
                      {isOtherMachine ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>

                {isOtherMachine && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-indigo-100">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase text-indigo-900 mb-1">
                        ZONE (जोन चुनें) *
                      </label>
                      <select
                        value={otherZone}
                        onChange={(e) => {
                          setOtherZone(e.target.value);
                          setOtherDivision('');
                          setOtherMachineName('');
                        }}
                        className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs font-bold bg-white text-indigo-950 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        required={isOtherMachine}
                      >
                        <option value="">-- Select Zone --</option>
                        {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase text-indigo-900 mb-1">
                        DIVISION (डिवीजन चुनें) *
                      </label>
                      <select
                        value={otherDivision}
                        onChange={(e) => {
                          setOtherDivision(e.target.value);
                          setOtherMachineName('');
                        }}
                        disabled={!otherZone}
                        className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs font-bold bg-white text-indigo-950 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-50"
                        required={isOtherMachine}
                      >
                        <option value="">-- Select Division --</option>
                        {otherZone && RAILWAY_ZONES_DIVISIONS[otherZone]?.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase text-indigo-900 mb-1">
                        MACHINE NAME (मशीन चुनें) *
                      </label>
                      <select
                        value={otherMachineName}
                        onChange={(e) => {
                          const selectedM = e.target.value;
                          setOtherMachineName(selectedM);
                          if (selectedM && machinePositions[selectedM]) {
                            const pos = machinePositions[selectedM];
                            if (pos.zone) setOtherZone(pos.zone);
                            if (pos.division) setOtherDivision(pos.division);
                          }
                        }}
                        className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs font-bold bg-white text-indigo-950 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        required={isOtherMachine}
                      >
                        <option value="">-- Select Machine (मशीन चुनें) --</option>
                        {(() => {
                          const zoneDivMatched = allCreatedMachines.filter(m => {
                            const pos = machinePositions[m];
                            return pos && pos.zone === otherZone && pos.division === otherDivision;
                          });

                          const otherMachs = allCreatedMachines.filter(m => !zoneDivMatched.includes(m));

                          if (zoneDivMatched.length > 0) {
                            return (
                              <>
                                <optgroup label="📍 Matched for Selected Zone & Division">
                                  {zoneDivMatched.map(m => (
                                    <option key={m} value={m}>{m} (Matched)</option>
                                  ))}
                                </optgroup>
                                <optgroup label="🚜 All Other Created Machines">
                                  {otherMachs.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </optgroup>
                              </>
                            );
                          }

                          return allCreatedMachines.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ));
                        })()}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      list="pl-no-autocomplete"
                      className="flex-1 border border-outline/20 rounded px-3 py-1.5 text-sm font-medium"
                      value={newDemand.plNo}
                      onChange={e => handleNewDemandPlChange(e.target.value)}
                      placeholder="Enter or select PL No."
                    />
                    {newDemand.plNo && parts[newDemand.plNo] !== undefined && (
                      <div className="bg-indigo-50 px-3 py-1.5 rounded border border-indigo-100 flex flex-col justify-center">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase leading-none">Stock</span>
                        <span className="text-sm font-black text-indigo-700 leading-none">
                          {Number.isNaN(parts[newDemand.plNo]) ? 0 : parts[newDemand.plNo]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    list="part-no-autocomplete"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm font-medium"
                    value={newDemand.partNo}
                    onChange={e => handleNewDemandPartNoChange(e.target.value)}
                    placeholder="Enter or select Part No."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={newDemand.description}
                    onChange={e => setNewDemand({ ...newDemand, description: e.target.value })}
                    placeholder="Item description (auto-filled if available)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold"
                    value={newDemand.whetherUse}
                    onChange={e => setNewDemand({ ...newDemand, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {!isEmployee && !isOtherMachine && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold text-slate-700"
                      value={newDemand.machineName}
                      onChange={(e) => {
                        setNewDemand({ ...newDemand, machineName: e.target.value });
                      }}
                    >
                      <option value="">None / General</option>
                      {allCreatedMachines.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity</label>
                    <input
                      type="number"
                      step="any"
                      min={0.001}
                      className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm font-bold text-slate-800"
                      value={newDemand.qty}
                      onChange={e => setNewDemand({ ...newDemand, qty: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                      placeholder="e.g. 1 or 0.1"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Unit (UOM / इकाई)</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold text-slate-700"
                      value={STANDARD_RECEIPT_UOMS.filter(u => u !== 'Other').includes(newDemand.unit || '') ? newDemand.unit : 'Other'}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'Other') {
                          setNewDemand({ ...newDemand, unit: 'Other' });
                        } else {
                          setNewDemand({ ...newDemand, unit: val });
                          setNewDemandCustomUnit('');
                        }
                      }}
                    >
                      {STANDARD_RECEIPT_UOMS.map(u => (
                        <option key={u} value={u}>{u === 'Other' ? 'Other (अन्य - Custom Unit)' : u}</option>
                      ))}
                    </select>
                    {(newDemand.unit === 'Other' || !STANDARD_RECEIPT_UOMS.filter(u => u !== 'Other').includes(newDemand.unit || '')) && (
                      <input
                        type="text"
                        required
                        placeholder="Type custom unit (e.g. Barrel, Litre...)"
                        className="w-full mt-2 border border-amber-300 rounded px-3 py-1 text-xs font-bold text-slate-800 bg-amber-50/80 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={newDemandCustomUnit}
                        onChange={e => setNewDemandCustomUnit(e.target.value)}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={newDemand.date}
                    onChange={e => setNewDemand({ ...newDemand, date: e.target.value })}
                    required
                  />
                </div>

                 {!isAdmin && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-indigo-600 mb-1">Forward to (Recipient Employee / Operator)</label>
                    <select
                      className="w-full border border-indigo-200 focus:ring-indigo-500 rounded px-3 py-1.5 text-sm bg-white font-medium"
                      value={newDemand.forwardedToId}
                      onChange={e => setNewDemand({ ...newDemand, forwardedToId: e.target.value })}
                    >
                      <option value="">-- Select Recipient (Same Company) --</option>
                      {fullAccessEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.accessType === 'admin-light'
                            ? `${emp.companyName || emp.name.replace(' Admin', '')} (Company Administrator)`
                            : `${emp.name} (${emp.designation || 'Employee'}) - ${emp.companyName || 'Same Company'}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={newDemand.remarks}
                    onChange={e => setNewDemand({ ...newDemand, remarks: e.target.value })}
                    placeholder="Enter remarks (if any)"
                  />
                </div>

                {/* Demand PDF Voucher Logo Section - only for Master Admin */}
                {isMasterAdmin && (
                  <div className="bg-gradient-to-r from-amber-50/90 to-orange-50/80 border border-amber-200 rounded-xl p-3.5 space-y-2.5 shadow-sm md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-amber-700" />
                        <span className="text-xs font-black uppercase text-amber-950">
                          Demand PDF Voucher Logo (वाउचर हेडर लोगो)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowLogoModal(true)}
                        className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg transition-colors shadow-xs"
                      >
                        Manage Logo
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-lg bg-white border border-amber-200 p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
                        {demandLogo ? (
                          <img src={demandLogo} alt="Demand Logo" className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-[9px] font-black text-amber-700 text-center uppercase leading-tight">Default Railway</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-800 truncate">
                          {demandLogo ? 'Custom Header Logo Active' : 'Default Indian Railways Emblem'}
                        </p>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                          Wah logo Demand PDF ke top header me print hoga.
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded cursor-pointer shadow-xs transition-colors">
                            <Upload size={12} />
                            <span>{demandLogo ? 'Change Logo' : 'Upload Logo'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleLogoUpload}
                              disabled={uploadingLogo}
                              className="hidden"
                            />
                          </label>
                          {demandLogo && (
                            <button
                              type="button"
                              onClick={handleResetLogo}
                              disabled={uploadingLogo}
                              className="text-[10px] font-bold text-rose-600 hover:underline"
                            >
                              Reset to Railway
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-1.5 text-xs font-bold text-secondary hover:bg-surface-container-low rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-bold rounded shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={14} /> : null}
                  Save Demand
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log Unconnected Material Receipt Modal */}
      <AnimatePresence>
        {showAddReceiptModal && (
          <motion.div 
            key="add-receipt-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddReceiptModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <h2 className="text-lg font-extrabold text-primary">Unconnected Material Receipt</h2>
                <button 
                  onClick={() => setShowAddReceiptModal(false)} 
                  className="text-outline hover:text-on-surface p-1 rounded-full hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveReceipt} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Voucher No. */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Voucher No.</label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed select-none"
                      placeholder=""
                      value={receiptForm.voucherNo}
                    />
                  </div>

                  {/* Returned Date */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Returned Date</label>
                    <input
                      type="date"
                      required
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.returnedDate}
                      onChange={e => setReceiptForm(prev => ({ ...prev, returnedDate: e.target.value }))}
                    />
                  </div>

                  {/* Machine Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      required
                      disabled={hasAssignedMachine}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                      value={hasAssignedMachine ? userMachine : receiptForm.machineName}
                      onChange={e => handleMachineNameChange(e.target.value)}
                    >
                      {hasAssignedMachine ? (
                        <option value={userMachine}>{userMachine}</option>
                      ) : (
                        <>
                          <option value="">-- Select Machine --</option>
                          {allCreatedMachines.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>

                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">
                      Company Name
                    </label>
                    <select
                      required
                      disabled={!!receiptForm.machineName}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      value={receiptForm.companyName}
                      onChange={e => setReceiptForm(prev => ({ ...prev, companyName: e.target.value }))}
                    >
                      <option value="">-- Select Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* Zone */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Zone</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={receiptForm.zone}
                    />
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Division</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={receiptForm.division}
                    />
                  </div>

                  {/* Part No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                    <input
                      list="partNo-options"
                      type="text"
                      required
                      placeholder="Type or select Part No."
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.partNo}
                      onChange={e => handlePartNoChange(e.target.value)}
                    />
                    <datalist id="partNo-options">
                      {availablePartsForReceipt.map(p => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* PL No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No.</label>
                    <input
                      list="plNo-options-demand"
                      type="text"
                      placeholder="Type or select PL No."
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.plNo}
                      onChange={e => handlePlNoChange(e.target.value)}
                    />
                    <datalist id="plNo-options-demand">
                      {availablePartsForReceipt.filter(p => p.plNo).map(p => (
                        <option key={p.id} value={p.plNo}>{p.plNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* Part Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                    <textarea
                      rows={2}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter part description..."
                      value={receiptForm.description}
                      onChange={e => setReceiptForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      placeholder="e.g. Rack A1"
                      value={receiptForm.location}
                      onChange={e => setReceiptForm(prev => ({ ...prev, location: e.target.value }))}
                    />
                  </div>

                  {/* Old Qty (Current Stock) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Old Qty (Current Stock)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={(() => {
                        const activeMachine = receiptForm.employeeId 
                          ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
                          : (receiptForm.machineName || '');
                        const matchedPart = fullPartsList.find(p => {
                          const matchMach = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
                          const matchPart = (receiptForm.partNo && p.partNo?.trim().toLowerCase() === receiptForm.partNo.trim().toLowerCase()) ||
                                            (receiptForm.plNo && p.plNo?.trim().toLowerCase() === receiptForm.plNo.trim().toLowerCase());
                          return matchMach && matchPart;
                        });
                        return matchedPart ? matchedPart.stock : 0;
                      })()}
                    />
                  </div>

                  {/* Quantity Returned */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity Returned</label>
                    <input
                      type="number"
                      required
                      min={1}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      value={receiptForm.qtyReturned || ''}
                      onChange={e => setReceiptForm(prev => ({ ...prev, qtyReturned: Number(e.target.value) }))}
                    />
                  </div>

                  {/* Unit of Measure */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Unit of Measure</label>
                    <select
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.unit}
                      onChange={e => setReceiptForm(prev => ({ ...prev, unit: e.target.value }))}
                    >
                      {STANDARD_RECEIPT_UOMS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    {receiptForm.unit === 'Other' && (
                      <input
                        type="text"
                        required
                        placeholder="Type custom unit (e.g. Barrel, Litre...)"
                        className="w-full mt-2 border border-outline/20 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-800 bg-amber-50/50"
                        value={receiptForm.customUnit}
                        onChange={e => setReceiptForm(prev => ({ ...prev, customUnit: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Transaction Qty (Disabled, read-only showing total count) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Transaction Qty (Total Count)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={receiptForm.qtyReturned || 0}
                    />
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                    <textarea
                      rows={2}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter any additional remarks..."
                      value={receiptForm.remarks}
                      onChange={e => setReceiptForm(prev => ({ ...prev, remarks: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Form Footer Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowAddReceiptModal(false)}
                    className="px-5 py-2.5 rounded-xl border border-outline/20 text-slate-700 font-bold hover:bg-slate-50 transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={receiptSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-br from-primary to-indigo-700 text-white font-bold shadow-md shadow-primary/10 hover:shadow-primary/30 transition-all text-sm disabled:opacity-50"
                  >
                    {receiptSubmitting ? "Logging..." : "Log Receipt"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Unconnected Material Receipt Modal */}
      <AnimatePresence>
        {showEditReceiptModal && (
          <motion.div 
            key="edit-receipt-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowEditReceiptModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <h2 className="text-lg font-extrabold text-primary">Edit Unconnected Material Receipt</h2>
                <button 
                  onClick={() => setShowEditReceiptModal(false)} 
                  className="text-outline hover:text-on-surface p-1 rounded-full hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleUpdateReceipt} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Voucher No. */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Voucher No.</label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      placeholder=""
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono font-bold text-slate-600 bg-slate-100 cursor-not-allowed select-none"
                      value={editReceiptForm.voucherNo}
                    />
                  </div>

                  {/* Returned Date */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Returned Date</label>
                    <input
                      type="date"
                      required
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.returnedDate}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, returnedDate: e.target.value }))}
                    />
                  </div>

                  {/* Machine Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      required
                      disabled={hasAssignedMachine}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                      value={hasAssignedMachine ? userMachine : editReceiptForm.machineName}
                      onChange={e => handleEditMachineNameChange(e.target.value)}
                    >
                      {hasAssignedMachine ? (
                        <option value={userMachine}>{userMachine}</option>
                      ) : (
                        <>
                          <option value="">-- Select Machine --</option>
                          {allCreatedMachines.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>

                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">
                      Company Name
                    </label>
                    <select
                      required
                      disabled={!!editReceiptForm.machineName}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      value={editReceiptForm.companyName}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, companyName: e.target.value }))}
                    >
                      <option value="">-- Select Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* Zone */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Zone</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={editReceiptForm.zone}
                    />
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Division</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={editReceiptForm.division}
                    />
                  </div>

                  {/* Part No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                    <input
                      list="editPartNo-options"
                      type="text"
                      required
                      placeholder="Type or select Part No."
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.partNo}
                      onChange={e => handleEditPartNoChange(e.target.value)}
                    />
                    <datalist id="editPartNo-options">
                      {availablePartsForEditReceipt.map(p => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* PL No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No.</label>
                    <input
                      list="editPlNo-options-demand"
                      type="text"
                      placeholder="Type or select PL No."
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.plNo}
                      onChange={e => handleEditPlNoChange(e.target.value)}
                    />
                    <datalist id="editPlNo-options-demand">
                      {availablePartsForEditReceipt.filter((p: any) => p.plNo).map(p => (
                        <option key={p.id} value={p.plNo}>{p.plNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* Part Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                    <textarea
                      rows={2}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter part description..."
                      value={editReceiptForm.description}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      placeholder="e.g. Rack A1"
                      value={editReceiptForm.location}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, location: e.target.value }))}
                    />
                  </div>

                  {/* Old Qty (Current Stock) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Old Qty (Current Stock)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={(() => {
                        const activeMachine = editReceiptForm.employeeId 
                          ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
                          : (editReceiptForm.machineName || '');
                        const matchedPart = fullPartsList.find(p => {
                          const matchMach = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
                          const matchPart = (editReceiptForm.partNo && p.partNo?.trim().toLowerCase() === editReceiptForm.partNo.trim().toLowerCase()) ||
                                            (editReceiptForm.plNo && p.plNo?.trim().toLowerCase() === editReceiptForm.plNo.trim().toLowerCase());
                          return matchMach && matchPart;
                        });
                        return matchedPart ? matchedPart.stock : 0;
                      })()}
                    />
                  </div>

                  {/* Quantity Returned */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity Returned</label>
                    <input
                      type="number"
                      required
                      min={1}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      value={editReceiptForm.qtyReturned || ''}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, qtyReturned: Number(e.target.value) }))}
                    />
                  </div>

                  {/* Unit of Measure */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Unit of Measure</label>
                    <select
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.unit}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, unit: e.target.value }))}
                    >
                      {STANDARD_RECEIPT_UOMS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    {editReceiptForm.unit === 'Other' && (
                      <input
                        type="text"
                        required
                        placeholder="Type custom unit (e.g. Barrel, Litre...)"
                        className="w-full mt-2 border border-outline/20 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-800 bg-amber-50/50"
                        value={editReceiptForm.customUnit}
                        onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, customUnit: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Transaction Qty (Disabled, read-only showing total count) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Transaction Qty (Total Count)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={editReceiptForm.qtyReturned || 0}
                    />
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                    <textarea
                      rows={2}
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter any additional remarks..."
                      value={editReceiptForm.remarks}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, remarks: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Form Footer Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowEditReceiptModal(false)}
                    className="px-5 py-2.5 rounded-xl border border-outline/20 text-slate-700 font-bold hover:bg-slate-50 transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={receiptSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-br from-primary to-indigo-700 text-white font-bold shadow-md shadow-primary/10 hover:shadow-primary/30 transition-all text-sm disabled:opacity-50"
                  >
                    {receiptSubmitting ? "Updating..." : "Update Receipt"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Receive Demand Modal */}
      <AnimatePresence>
        {showReceiveModal && (
          <motion.div 
            key="receive-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowReceiveModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Receive Demand</h2>
              <button onClick={() => setShowReceiveModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleReceiveDemand} className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Item Information</span>
                    <p className="text-xs font-bold text-slate-700">
                      {selectedDemand?.description || 'No Description'}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {selectedDemand?.plNo ? `PL: ${selectedDemand.plNo}` : `Part No: ${selectedDemand?.partNo || 'N/A'}`}
                    </p>
                  </div>
                  <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2.5 py-1 rounded-full uppercase">
                    {selectedDemand?.giveQty !== undefined ? `Approved Qty: ${selectedDemand.giveQty}` : `Demand Qty: ${selectedDemand?.qty}`}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-xs text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block tracking-wider leading-none mb-1">Current Stock</span>
                    <span className="text-sm font-black text-slate-800 block">
                      {(() => {
                        const key = selectedDemand?.plNo || selectedDemand?.partNo || '';
                        const st = key && parts[key] !== undefined ? parts[key] : 0;
                        return Number.isNaN(st) ? 0 : st;
                      })()}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-xs text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block tracking-wider leading-none mb-1">Received So Far</span>
                    <span className="text-sm font-black text-indigo-700 block">
                      {selectedDemand?.receivedQty || 0}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-xs text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block tracking-wider leading-none mb-1">Remaining</span>
                    <span className="text-sm font-black text-rose-600 block">
                      {Math.max(0, (selectedDemand?.giveQty !== undefined ? selectedDemand.giveQty : (selectedDemand?.qty || 0)) - (selectedDemand?.receivedQty || 0))}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Received Quantity</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, (selectedDemand?.giveQty !== undefined ? selectedDemand.giveQty : (selectedDemand?.qty || 0)) - (selectedDemand?.receivedQty || 0))}
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono font-bold"
                  value={receiveData.receivedQty}
                  onChange={e => setReceiveData({ ...receiveData, receivedQty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  required
                />
                
                {/* Live Stock & Receipt Feedback Section */}
                <div className="mt-3 bg-emerald-50/70 border border-emerald-200/60 p-3 rounded-lg text-xs space-y-1.5 shadow-2xs">
                  <div className="flex justify-between font-semibold text-emerald-800">
                    <span>Current Inventory Stock:</span>
                    <span className="font-black">{currentStockInModal}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-indigo-800">
                    <span>Received So Far:</span>
                    <span className="font-black">{selectedDemand?.receivedQty || 0} / {selectedDemand?.qty || 0}</span>
                  </div>
                  {receiveData.receivedQty > 0 && (
                    <>
                      <div className="border-t border-emerald-200/40 my-1" />
                      <div className="flex justify-between text-emerald-900 font-bold">
                        <span>New Stock after Receipt:</span>
                        <span>{currentStockInModal} + {receiveData.receivedQty} &rarr; <span className="text-sm font-black text-emerald-700">{currentStockInModal + receiveData.receivedQty}</span></span>
                      </div>
                      <div className="flex justify-between text-indigo-900 font-bold">
                        <span>New Received Total:</span>
                        <span>{(selectedDemand?.receivedQty || 0)} + {receiveData.receivedQty} &rarr; <span className="text-sm font-black text-indigo-700">{(selectedDemand?.receivedQty || 0) + receiveData.receivedQty} / {selectedDemand?.qty || 0}</span></span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate (Optional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.rate}
                  onChange={e => setReceiveData({ ...receiveData, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  placeholder="Leave 0 to keep current rate"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Location (Optional)</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.location}
                  onChange={e => setReceiveData({ ...receiveData, location: e.target.value })}
                  placeholder="Leave empty to keep current location"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Received Date</label>
                <input
                  type="date"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.receivedDate}
                  onChange={e => setReceiveData({ ...receiveData, receivedDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks (Optional)</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.remarks}
                  onChange={e => setReceiveData({ ...receiveData, remarks: e.target.value })}
                  placeholder="Enter remarks for this receipt"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-bold rounded shadow-lg hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Confirm Receipt
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Demand Modal */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div 
            key="edit-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowEditModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="p-5 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-extrabold text-primary">Edit Demand</h2>
              <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface p-1 rounded-full hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditDemand} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 border border-outline/20 rounded px-3 py-1.5 text-sm"
                      value={editDemandData.plNo}
                      onChange={e => setEditDemandData({ ...editDemandData, plNo: e.target.value })}
                    />
                    {editDemandData.plNo && parts[editDemandData.plNo] !== undefined && (
                      <div className="bg-indigo-50 px-3 py-1.5 rounded border border-indigo-100 flex flex-col justify-center">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase leading-none">Stock</span>
                        <span className="text-sm font-black text-indigo-700 leading-none">
                          {Number.isNaN(parts[editDemandData.plNo]) ? 0 : parts[editDemandData.plNo]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={editDemandData.partNo}
                    onChange={e => setEditDemandData({ ...editDemandData, partNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={editDemandData.description}
                    onChange={e => setEditDemandData({ ...editDemandData, description: e.target.value })}
                    placeholder="Item description"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold"
                    value={editDemandData.whetherUse}
                    onChange={e => setEditDemandData({ ...editDemandData, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {!isEmployee && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold text-slate-700"
                      value={editDemandData.machineName || ''}
                      onChange={(e) => {
                        setEditDemandData({ ...editDemandData, machineName: e.target.value });
                      }}
                    >
                      <option value="">None / General</option>
                      {allCreatedMachines.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity</label>
                  <input
                    type="number"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={editDemandData.qty}
                    onChange={e => setEditDemandData({ ...editDemandData, qty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={editDemandData.date}
                    onChange={e => setEditDemandData({ ...editDemandData, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Status</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm bg-white font-bold"
                    value={editDemandData.status}
                    onChange={e => setEditDemandData({ ...editDemandData, status: e.target.value as any })}
                    required
                  >
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-1.5 text-sm"
                    value={editDemandData.remarks || ''}
                    onChange={e => setEditDemandData({ ...editDemandData, remarks: e.target.value })}
                    placeholder="Enter remarks (if any)"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1.5">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                    <div className="relative w-16 h-16 rounded bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200 shadow-sm group">
                      {editDemandData.imageUrl ? (
                        <>
                          <img src={editDemandData.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setEditDemandData(prev => ({ ...prev, imageUrl: '' }))}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Camera size={18} />
                          <span className="text-[8px] font-bold uppercase tracking-wider mt-0.5">No Image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-grow w-full">
                      <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-2.5 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          onChange={(e) => handleImageUpload(e, true)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={14} className="text-indigo-500 mb-0.5" />
                        <p className="text-[11px] font-bold text-slate-700">Click or Drag Image</p>
                        <p className="text-[8px] text-slate-400 mt-0.5 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-1.5 text-xs font-bold text-secondary hover:bg-surface-container-low rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-bold rounded shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={14} /> : null}
                  Save Changes
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div 
            key="delete-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowDeleteModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Confirm Delete</h2>
                <button onClick={() => setShowDeleteModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-on-surface-variant">
                  Are you sure you want to delete this demand? This action cannot be undone.
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
                    onClick={handleDeleteDemand}
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Confirm Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forward Demand Modal */}
      <AnimatePresence>
        {showForwardModal && (
          <motion.div 
            key="forward-demand-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowForwardModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-indigo-50">
                <h2 className="text-xl font-bold text-indigo-900">Forward Demand</h2>
                <button onClick={() => setShowForwardModal(false)} className="text-indigo-600 hover:text-indigo-900">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleForwardSubmit} className="p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Select an employee to forward this demand for PL No. <strong className="text-indigo-700">{forwardingDemand?.plNo || '-'}</strong>.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-indigo-600 mb-1">Recipient Employee (कर्मचारी का चयन करें)</label>
                  <select
                    className="w-full border border-indigo-200 focus:ring-indigo-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={selectedForwardEmployeeId}
                    onChange={e => setSelectedForwardEmployeeId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Recipient (Same Company) --</option>
                    {employeeList
                      .filter(emp => {
                        const isNotMe = emp.id !== currentEmployeeId && emp.id !== auth.currentUser?.uid;
                        if (!isNotMe) return false;

                        // Exclude top-level admin
                        if (emp.accessType === 'full' || emp.isTopAdmin || emp.id === 'admin') return false;

                        const myCompany = currentEmployeeCompanyName || (auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) : '') || '';
                        
                        // Strict same-company check
                        if (myCompany) {
                          return emp.companyName === myCompany;
                        }
                        return true;
                      })
                      .map(emp => {
                        let roleBadge = emp.designation || 'Employee';
                        if (emp.accessType === 'admin-light') roleBadge = `Company Admin (${emp.companyName || 'Company'})`;
                        else if (emp.accessType === 'divisional-admin') roleBadge = `Divisional Admin (${emp.division || 'Division'})`;
                        else if (emp.accessType === 'zonal-admin') roleBadge = `Zonal Admin (${emp.zone || 'Zone'})`;

                        return (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} — [{roleBadge}] {emp.companyName ? `(${emp.companyName})` : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowForwardModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !selectedForwardEmployeeId}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Forward Demand
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject Demand Modal with Reason */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div 
            key="reject-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowRejectModal(false);
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-red-50">
                <h2 className="text-xl font-bold text-red-900">Reject Demand</h2>
                <button onClick={() => setShowRejectModal(false)} className="text-red-600 hover:text-red-900">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={submitRejection} className="p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Please provide a reason for rejecting this demand. The rejection reason will be displayed directly to the employee.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-red-600 mb-1">Rejection Reason</label>
                  <textarea
                    rows={3}
                    className="w-full border border-red-200 focus:ring-red-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={rejectReasonInput}
                    onChange={e => setRejectReasonInput(e.target.value)}
                    placeholder="Type the rejection reason here..."
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRejectModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !rejectReasonInput.trim()}
                    className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Confirm Reject
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tracking Modal */}
      <AnimatePresence>
        {showTrackingModal && trackingDemand && (
          <motion.div 
            key="tracking-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowTrackingModal(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-indigo-50">
                <div>
                  <h2 className="text-xl font-black text-indigo-900 tracking-tight">Demand Tracking Details (मांग ट्रैकिंग विवरण)</h2>
                  <p className="text-xs text-indigo-700/80 font-bold font-mono mt-0.5 animate-pulse">
                    PL No: {trackingDemand.plNo} | Part No: {trackingDemand.partNo || '-'}
                  </p>
                </div>
                <button onClick={() => setShowTrackingModal(false)} className="text-indigo-600 hover:text-indigo-900 bg-white/50 hover:bg-white p-1 rounded-full transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 flex-grow">
                {/* Demand Overview */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs font-semibold">
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">Status (स्थिति)</span>
                    <span className={cn(
                      "inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                      trackingDemand.status === 'pending' ? "bg-yellow-100 text-yellow-800" :
                      trackingDemand.status === 'completed' ? "bg-green-100 text-green-800" :
                      trackingDemand.status === 'rejected' ? "bg-red-100 text-red-800" :
                      trackingDemand.status === 'returned' ? "bg-amber-100 text-amber-800" :
                      "bg-blue-100 text-blue-800"
                    )}>
                      {trackingDemand.status === 'pending' && <Clock size={10} />}
                      {trackingDemand.status === 'completed' && <CheckCircle size={10} />}
                      {trackingDemand.status === 'rejected' && <XCircle size={10} />}
                      {trackingDemand.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">Demand Qty (मांग मात्रा)</span>
                    <span className="text-sm font-black text-indigo-950 block mt-1">{trackingDemand.qty}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">Received Qty (प्राप्त मात्रा)</span>
                    <span className="text-sm font-black text-emerald-700 block mt-1">{trackingDemand.receivedQty || 0}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">Created Date (बनाने की तिथि)</span>
                    <span className="text-slate-700 block mt-1.5">{trackingDemand.date}</span>
                  </div>
                </div>

                {/* Who is it pending with? */}
                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 text-xs">
                  <div className="font-extrabold text-amber-900 uppercase tracking-wide flex items-center gap-1.5 mb-1 text-[11px]">
                    <Clock size={14} className="text-amber-600" />
                    Current Ownership / Pending With (वर्तमान स्वामित्व/लंबित):
                  </div>
                  <div className="text-slate-700 font-bold">
                    {(() => {
                      if (trackingDemand.status === 'completed') {
                        return <span className="text-emerald-700 font-black">✓ Process Completed (सभी सामग्री प्राप्त की जा चुकी है)</span>;
                      }
                      if (trackingDemand.forwardedToAdmin) {
                        return <span>Escalated to <strong className="text-purple-700">Master Admin (मुख्य प्रशासक)</strong></span>;
                      }
                      if (trackingDemand.forwardedToCompanyAdmin) {
                        return <span>Forwarded to <strong className="text-amber-700">Company Admin ({trackingDemand.forwardedByCompanyName || 'Registered Company'})</strong></span>;
                      }
                      if (trackingDemand.forwardedToName) {
                        return <span>Assigned to employee: <strong className="text-indigo-700">{trackingDemand.forwardedToName}</strong> ({trackingDemand.forwardedToEmail?.replace('@employee.billedapp.com', '')})</span>;
                      }
                      if (trackingDemand.createdByEmployeeName) {
                        return <span>Pending with creator: <strong className="text-slate-700">{trackingDemand.createdByEmployeeName}</strong> ({trackingDemand.createdByEmail?.replace('@employee.billedapp.com', '')})</span>;
                      }
                      return <span className="text-slate-500 font-medium">Pending Initial Action</span>;
                    })()}
                  </div>
                </div>

                {/* Original remarks written when demand was created */}
                <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50 text-xs">
                  <div className="font-extrabold text-indigo-950 uppercase tracking-wide mb-1 text-[11px]">
                    Original Creator's Remarks / Notes (मांग की मूल टिप्पणी):
                  </div>
                  <div className="text-slate-700 italic font-medium leading-relaxed bg-white p-2.5 rounded-lg border border-indigo-100/30 font-mono">
                    "{trackingDemand.remarks || 'No remarks provided during creation'}"
                  </div>
                </div>

                {/* Action History / Logs Timeline */}
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">Action History Timeline (कार्यवाही का इतिहास)</h3>
                  {loadingLogs ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="animate-spin text-indigo-600" size={24} />
                    </div>
                  ) : trackingLogs.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-400 font-bold border border-dashed rounded-xl">
                      No logged actions found for this demand.
                    </div>
                  ) : (
                    <div className="relative pl-6 border-l border-slate-200 space-y-5 ml-2.5">
                      {trackingLogs.map((log, idx) => (
                        <div key={log.id || idx} className="relative">
                          {/* Timeline dot */}
                          <div className={cn(
                            "absolute -left-[31px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-white",
                            log.action === 'CREATE' || log.action === 'RESUBMIT' ? "bg-blue-500" :
                            log.action === 'FORWARD' || log.action?.includes('FORWARD') ? "bg-indigo-500" :
                            log.action === 'APPROVAL' || log.action === 'RECEIVE' || log.action === 'COMPLETE' ? "bg-emerald-500" :
                            log.action === 'REJECT' ? "bg-rose-500" : "bg-amber-500"
                          )} />
                          
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs">
                            <div className="flex flex-wrap justify-between items-center gap-1 border-b border-slate-200/50 pb-1.5 mb-1.5">
                              <span className="font-black text-slate-800 uppercase text-[10px] tracking-wider">
                                Action: {log.action || 'ACTION'}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold font-mono">
                                {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600 leading-relaxed">
                              <strong>Performed By:</strong> {log.performedByName || log.performedByEmail?.replace('@employee.billedapp.com', '') || 'Unknown'} 
                              {log.performedByEmail ? ` (${log.performedByEmail.replace('@employee.billedapp.com', '')})` : ''}
                            </div>
                            {log.remark && (
                              <div className="mt-1.5 p-2 bg-white rounded border border-slate-100 text-[11px] text-slate-700 font-mono font-medium">
                                <strong>Remark:</strong> "{log.remark}"
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-outline-variant/10 bg-slate-50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowTrackingModal(false)}
                  className="px-5 py-2 bg-slate-200 text-slate-700 text-xs font-black rounded-xl hover:bg-slate-300 transition-all active:scale-95 shadow-sm"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Demand Voucher PDF Logo Modal - Strictly Master Admin */}
      <AnimatePresence>
        {showLogoModal && isMasterAdmin && (
          <motion.div 
            key="logo-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowLogoModal(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowLogoModal(false)}
                className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary shrink-0">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 tracking-tight">Demand Voucher PDF Logo</h3>
                  <p className="text-xs text-slate-500 font-bold">Only Admin can upload & change this logo</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col items-center justify-center min-h-[140px] text-center shadow-inner">
                  {demandLogo ? (
                    <div className="space-y-2">
                      <img src={demandLogo} alt="Demand Voucher Logo" className="h-20 max-w-[200px] object-contain mx-auto drop-shadow-sm" />
                      <span className="inline-block px-3 py-1 text-[11px] font-black text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-full">
                        ✓ Active Custom Logo (सक्रिय लोगो)
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-slate-500 font-black text-xs uppercase tracking-wider">Default Indian Railways Emblem</div>
                      <div className="text-xs text-slate-500 font-medium">Currently using standard Indian Railways logo for all PDF vouchers</div>
                    </div>
                  )}
                </div>

                <div className="p-3.5 bg-amber-50/90 rounded-2xl border border-amber-200/80 text-xs text-amber-900 leading-relaxed font-medium">
                  📌 <strong>Global Admin Sync:</strong> Jab aap ek baar logo upload karte hain, to wahi demand ke voucher pdf download me show karega aur wah logo sabhi machine me automatically sync ho jayega.
                </div>

                <div className="flex flex-col gap-2.5 pt-2">
                  <label className="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white text-xs font-black rounded-2xl cursor-pointer hover:bg-primary/90 transition-all shadow-md active:scale-98 disabled:opacity-50">
                    {uploadingLogo ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>{uploadingLogo ? 'Saving Logo...' : 'Choose & Upload Custom Logo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="hidden"
                    />
                  </label>

                  {demandLogo && (
                    <button
                      onClick={handleResetLogo}
                      disabled={uploadingLogo}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-2xl hover:bg-rose-100 transition-all disabled:opacity-50 active:scale-98"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Reset to Default Railway Logo</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
