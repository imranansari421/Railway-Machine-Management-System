import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDoc, getDocs, updateDoc, setDoc, doc, query, where, writeBatch, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Plus, Search, CheckCircle, XCircle, Clock, X, Loader2, Edit, Trash2, ArrowUpRight, Camera, Upload, Download, Eye, Image as ImageIcon } from 'lucide-react';
import { compressImage } from '../utils/imageCompressor';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { generateDemandPDF } from '../utils/pdfGenerator';

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

import { findEmployeeForUser } from '../utils/employee';

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

  const [selectedMachine, setSelectedMachine] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
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
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
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

  const fetchFullAccessEmployees = async () => {
    try {
      const snap = await getDocs(collection(db, 'employees'));
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      const filtered = list.filter(emp => {
        const isFullOrLight = emp.accessType === 'full' || emp.accessType === 'admin-light';
        const isOperator = emp.designation?.toLowerCase().includes('operator');
        return isFullOrLight || isOperator;
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
          setUserAccessType(emp.accessType || 'limited');
          setIsAdmin(isFull);
          setIsLightAdmin(emp.accessType === 'admin-light');
          setCurrentEmployeeName(emp.name || '');
          setCurrentEmployeePfNo(emp.pfNo || '');
          setCurrentEmployeeId(emp.employeeId || '');
          setCurrentEmployeeCompanyName(emp.companyName || '');
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
        }
      }
    };
    checkAccess();
    fetchFullAccessEmployees();
  }, []);

  const [demandLogo, setDemandLogo] = useState<string>(() => localStorage.getItem('demandLogo') || '');
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
        if (data.demandLogo !== undefined) {
          setDemandLogo(data.demandLogo || '');
          if (data.demandLogo) {
            localStorage.setItem('demandLogo', data.demandLogo);
          } else {
            localStorage.removeItem('demandLogo');
          }
        }
      }
    });
    return () => unsubscribeSettings();
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

  // Collect all unique created machines from all collections (settings, positions, employees, parts, demands)
  const allCreatedMachines = useMemo(() => {
    return Array.from(new Set([
      "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM",
      ...settingsMachines,
      ...customMachines,
      ...Object.keys(machinePositions),
      ...employeeList.map(e => e.machineName).filter(Boolean),
      ...fullPartsList.map(p => p.machineName).filter(Boolean),
      ...demands.map(d => d.machineName).filter(Boolean),
    ])).filter(Boolean).sort();
  }, [settingsMachines, customMachines, machinePositions, employeeList, fullPartsList, demands]);
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

  const handleEditMachineNameChange = (machName: string) => {
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = matchedEmp ? matchedEmp.companyName || '' : '';
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

  // Handle machine change: sets machine and auto-fills mapped company
  const handleMachineNameChange = (machName: string) => {
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = matchedEmp ? matchedEmp.companyName || '' : '';
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
      const activeMachine = receiptForm.employeeId 
        ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName)
        : receiptForm.machineName;

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

        toast.success(`Unconnected Material Receipt logged! Stock of ${matchedPart.partNo} increased to ${newStock} at ${receiptForm.location || 'N/A'}`);
        await fetchParts();
      } else {
        toast.success("Unconnected Material Receipt logged successfully!");
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

      // 3. Delete unconnected receipt
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
  }, []);

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

    if (!isPrimaryAdmin) {
      toast.error('Only ADMIN accounts can upload the Demand PDF logo.');
      return;
    }

    setUploadingLogo(true);
    try {
      const base64Logo = await compressImage(file, 400, 400, 0.85);
      if (base64Logo) {
        await setDoc(doc(db, 'settings', 'general'), { demandLogo: base64Logo }, { merge: true });
        setDemandLogo(base64Logo);
        localStorage.setItem('demandLogo', base64Logo);
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
    if (!isPrimaryAdmin) {
      toast.error('Only ADMIN accounts can modify the Demand PDF logo.');
      return;
    }

    setUploadingLogo(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), { demandLogo: '' }, { merge: true });
      setDemandLogo('');
      localStorage.removeItem('demandLogo');
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

      // Auto-generate Demand PDF Voucher
      try {
        const isComp = Boolean(!machineToAssign || currentEmployeeCompanyName);
        await generateDemandPDF({
          demandNo: generatedDemandNo,
          date: newDemand.date || format(new Date(), 'yyyy-MM-dd'),
          plNo: newDemand.plNo,
          partNo: newDemand.partNo,
          description: newDemand.description,
          qty: newDemand.qty,
          machineName: machineToAssign || '',
          companyName: currentEmployeeCompanyName || '',
          isCompanyDemand: isComp,
          zone: derivedZone,
          remarks: newDemand.remarks || '',
          forwardedTo: selectedEmp ? selectedEmp.name : 'Master / Company Admin',
          forwardedBy: isComp 
            ? `Company Administrator (${currentEmployeeCompanyName || 'Admin'})` 
            : (currentEmployeeName || auth.currentUser?.email || 'Demand Initiator'),
          status: 'PENDING / FORWARDED'
        }, true);
        toast.success('Demand PDF Voucher generated & downloaded!');
      } catch (pdfError) {
        console.error('Error generating Demand PDF:', pdfError);
      }

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

      if (!matchingPartDoc) {
        toast.error("Phle Inventory me Item create karo uske baad hi item received hoga otherwise item not received", {
          duration: 6000
        });
        setSubmitting(false);
        return;
      }

      const batch = writeBatch(db);
      const partId = matchingPartDoc.id;
      const partData = matchingPartDoc.data() as any;
      const newStock = (partData.stock || 0) + receiveData.receivedQty;
      const newRate = receiveData.rate || partData.rate || selectedDemand.approvedRate || 0;
      const newLocation = receiveData.location || partData.location || '';
      const newTotalValue = newStock * newRate;

      batch.update(doc(db, 'parts', partId), {
        stock: newStock,
        rate: newRate,
        location: newLocation,
        totalValue: newTotalValue,
      });

      // Calculate accumulated received quantity and updated status
      const previouslyReceived = selectedDemand.receivedQty || 0;
      const currentReceived = receiveData.receivedQty;
      const totalReceived = previouslyReceived + currentReceived;

      const newStatus = totalReceived >= selectedDemand.qty ? 'completed' : 'pending';

      const existingReceipts = selectedDemand.receipts || [];
      const newReceipt = {
        qty: currentReceived,
        date: receiveData.receivedDate,
        remarks: receiveData.remarks || '',
      };
      const updatedReceipts = [...existingReceipts, newReceipt];

      // Update demand status & receipt records
      const demandRef = doc(db, 'demands', selectedDemand.id);
      batch.update(demandRef, {
        status: newStatus,
        receivedQty: totalReceived,
        receivedDate: receiveData.receivedDate,
        receipts: updatedReceipts,
      });

      // Add to transaction history
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: partId,
        type: 'received',
        qty: receiveData.receivedQty,
        date: receiveData.receivedDate,
        details: `Received from demand${receiveData.remarks ? `: ${receiveData.remarks}` : ''}`,
        remarks: receiveData.remarks || '',
        machineName: selectedDemand.machineName || '',
        voucherNo: selectedDemand.demandNo || `DEM-${format(new Date(), 'yy')}-${selectedDemand.id.slice(-6).toUpperCase()}`,
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
          remark: `Received ${currentReceived} pcs on ${receiveData.receivedDate}. Total Received: ${totalReceived}/${selectedDemand.qty}. Status: ${newStatus.toUpperCase()}.${receiveData.remarks ? ` Note: ${receiveData.remarks}` : ''}`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.error('Error logging receive action to demand_logs:', logErr);
      }

      toast.success(newStatus === 'completed' 
        ? `Demand fully received and completed! Stock updated.` 
        : `Partially received: ${totalReceived} of ${selectedDemand.qty} (Status: Pending). Received: ${currentReceived} pcs.`
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
    if (isEmployee) {
      toast.error('Only the Super Admin has permission to delete demands.');
      return;
    }
    if (isLightAdmin) {
      toast.error('Admin-light users do not have permission to delete demands.');
      return;
    }
    if (!demandToDelete) return;
    setSubmitting(true);
    try {
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
      if (selectedEmp) {
        const isCompanyAdmin = selectedEmp.accessType === 'admin-light';
        const isFullAdmin = selectedEmp.accessType === 'full';

        await updateDoc(doc(db, 'demands', forwardingDemand.id), {
          forwardedTo: selectedEmp.id,
          forwardedToName: selectedEmp.name,
          forwardedToEmail: selectedEmp.email || '',
          forwardedToCompanyAdmin: isCompanyAdmin ? true : false,
          forwardedToAdmin: isFullAdmin ? true : false,
          forwardedToAdminAt: isFullAdmin ? new Date().toISOString() : '',
          forwardedToCompanyAdminAt: isCompanyAdmin ? new Date().toISOString() : '',
          forwardedByUid: auth.currentUser?.uid || '',
          forwardedByEmail: auth.currentUser?.email || '',
          forwardedByName: currentEmployeeName || '',
          forwardedByCompanyName: currentEmployeeCompanyName || '',
          forwardedAt: new Date().toISOString(),
        });

        // Log to demand_logs for complete tracking history
        await addDoc(collection(db, 'demand_logs'), {
          demandId: forwardingDemand.id,
          plNo: forwardingDemand.plNo || '',
          partNo: forwardingDemand.partNo || '',
          description: forwardingDemand.description || '',
          action: 'FORWARD',
          remark: `Forwarded to ${selectedEmp.name} (Designation: ${selectedEmp.designation || 'N/A'})`,
          performedByUid: auth.currentUser?.uid || '',
          performedByName: currentEmployeeName || auth.currentUser?.email || 'Employee',
          performedByEmail: auth.currentUser?.email || '',
          timestamp: new Date().toISOString(),
          newForwardedToName: selectedEmp.name
        });

        // Send notification to the forwarded employee
        await addDoc(collection(db, 'notifications'), {
          targetEmail: selectedEmp.email || '',
          title: 'Demand Forwarded to You',
          message: `A demand for PL No. ${forwardingDemand.plNo} has been forwarded to you by ${currentEmployeeName || auth.currentUser?.email || 'an employee'}.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });

        toast.success(`Demand forwarded to ${selectedEmp.name} successfully`);

        // Generate Demand PDF Voucher
        try {
          const dNum = forwardingDemand.demandNo || `DEM-${format(new Date(forwardingDemand.date || Date.now()), 'yy')}-${forwardingDemand.id.slice(-6).toUpperCase()}`;
          const isComp = Boolean(!forwardingDemand.machineName || forwardingDemand.createdByCompanyName);
          const derivedZone = getZoneForMachine(forwardingDemand.machineName, forwardingDemand.date);
          await generateDemandPDF({
            demandNo: dNum,
            date: forwardingDemand.date || format(new Date(), 'yyyy-MM-dd'),
            plNo: forwardingDemand.plNo,
            partNo: forwardingDemand.partNo,
            description: forwardingDemand.description,
            qty: forwardingDemand.qty,
            machineName: forwardingDemand.machineName || '',
            companyName: forwardingDemand.createdByCompanyName || currentEmployeeCompanyName || '',
            isCompanyDemand: isComp,
            zone: derivedZone,
            remarks: forwardingDemand.remarks || '',
            forwardedTo: selectedEmp.name,
            forwardedBy: isComp
              ? `Company Administrator (${forwardingDemand.createdByCompanyName || currentEmployeeCompanyName || 'Admin'})`
              : (currentEmployeeName || auth.currentUser?.email || 'Demand Initiator'),
            status: 'FORWARDED'
          }, true);
          toast.success('Forward Voucher PDF generated & downloaded!');
        } catch (pdfErr) {
          console.error('Error generating PDF:', pdfErr);
        }
      }
      setShowForwardModal(false);
      setForwardingDemand(null);
      setSelectedForwardEmployeeId('');
      fetchDemands();
    } catch (error) {
      console.error('Error forwarding demand:', error);
      toast.error('Failed to forward demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectClick = (demandId: string) => {
    setRejectingDemandId(demandId);
    setRejectReasonInput('');
    setShowRejectModal(true);
  };

  const submitRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDemandId) return;
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

      if (dObj) {
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
            status: 'FORWARDED TO SUPER ADMIN'
          }, true);
        } catch (err) {
          console.error('Error generating PDF:', err);
        }
      }

      fetchDemands();
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

      if (dObj) {
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
            status: 'FORWARDED TO COMPANY ADMIN'
          }, true);
        } catch (err) {
          console.error('Error generating PDF:', err);
        }
      }

      fetchDemands();
    } catch (error) {
      console.error('Error forwarding demand to company admin:', error);
      toast.error('Failed to forward demand to Company Admin.');
    }
  };

  const filteredDemands = demands.filter(d => {
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

    // Rule: If a demand was requested from another machine (isOtherMachineDemand),
    // do NOT show it in the target machine's Demand page (Demand.tsx). Only show to the requesting machine/creator!
    if (d.isOtherMachineDemand || (d.requestingMachineName && d.targetMachineName && d.requestingMachineName !== d.targetMachineName)) {
      const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      const myEmail = auth.currentUser?.email || '';
      const isCreator = (d.createdByEmail && myEmail && d.createdByEmail.toLowerCase() === myEmail.toLowerCase()) ||
                        (d.createdByUid && d.createdByUid === auth.currentUser?.uid) ||
                        (myMachine && d.requestingMachineName && d.requestingMachineName === myMachine);
      if (!isCreator && isEmployee) {
        return false;
      }
    }

    // Rule: If a demand was issued by a machine (issuedFromMachine or isInterMachineIssue),
    // do NOT show it in the issuing machine's active demand section.
    // It should ONLY show in History / Reports (Action Logs & Reports / Transactions).
    if (d.issuedFromMachine || d.isInterMachineIssue) {
      const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      const issuingMachine = d.issuedFromMachine || '';

      // Hide from issuing machine's active demand section if current user belongs to the issuing machine
      if (isEmployee && myMachine && issuingMachine && myMachine.trim().toLowerCase() === issuingMachine.trim().toLowerCase()) {
        return false;
      }

      // Hide if the selected machine filter matches the issuing machine (and not requested by that machine)
      if (selectedMachine !== 'all' && issuingMachine && selectedMachine.trim().toLowerCase() === issuingMachine.trim().toLowerCase() && d.machineName !== selectedMachine) {
        return false;
      }
    }

    // Hide completed demands for regular employees and company accounts. Only show completed demands to Master Admin (!isEmployee).
    if (d.status === 'completed' && isEmployee) {
      return false;
    }

    // Check if specifically forwarded to me (by ID or Email)
    const isForwardedToMe = d.forwardedTo === currentEmployeeId || (auth.currentUser?.email && d.forwardedToEmail?.toLowerCase() === auth.currentUser.email.toLowerCase());
    
    if (!isForwardedToMe) {
      // Apply company filter constraint
      if (!isEmployee && selectedCompany !== 'all') {
        const creator = employeeList.find(e => 
          (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
          (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
          (e.id && d.createdByUid && e.id === d.createdByUid)
        );
        const demandCompany = creator ? creator.companyName || '' : '';
        if (demandCompany !== selectedCompany) {
          return false;
        }
      }

      // Apply company and machine filter constraints for non-admin users
      if (isEmployee) {
        const creator = employeeList.find(e => 
          (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
          (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
          (e.id && d.createdByUid && e.id === d.createdByUid)
        );
        const demandCompany = creator ? creator.companyName || '' : '';
        const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
        if (myCompany && demandCompany && demandCompany !== myCompany) return false;

        if (userAccessType !== 'admin-light') {
          const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
          if (myMachine) {
            const isTargetMachine = d.machineName && d.machineName === myMachine;
            const isRequestingMachine = d.requestingMachineName && d.requestingMachineName === myMachine;
            const isUserCreator = (d.createdByEmail && auth.currentUser?.email && d.createdByEmail.toLowerCase() === auth.currentUser.email.toLowerCase()) || (d.createdByUid && d.createdByUid === auth.currentUser?.uid);
            
            if (!isTargetMachine && !isRequestingMachine && !isUserCreator) {
              return false;
            }
          }
        }
      }
    }

    if (isAdmin && selectedMachine !== 'all' && !isForwardedToMe) {
      if (d.machineName !== selectedMachine) return false;
    }

    // Zone Filter
    if (filterZone !== 'all') {
      const pos = machinePositions[d.machineName || ''];
      if (!pos || pos.zone !== filterZone) return false;
    }

    // Division Filter
    if (filterDivision !== 'all') {
      const pos = machinePositions[d.machineName || ''];
      if (!pos || pos.division !== filterDivision) return false;
    }

    return true;
  });

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
      voucherNo: `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`,
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
          
          {/* Tab Selector */}
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('demands')}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                activeTab === 'demands' 
                  ? "bg-white text-primary shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Demands
            </button>
            <button
              onClick={() => setActiveTab('unconnected')}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                activeTab === 'unconnected' 
                  ? "bg-white text-primary shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Unconnected Material Receipts
            </button>
          </div>

          {isAdmin && !(isEmployee && userAccessType === 'full') && (
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
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                value={selectedMachine}
                onChange={e => setSelectedMachine(e.target.value)}
              >
                <option value="all">All Machines</option>
                {(isEmployee && userAccessType === 'admin-light'
                  ? Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                  : allCreatedMachines
                ).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
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
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm disabled:opacity-50"
                value={filterDivision}
                disabled={filterZone === 'all'}
                onChange={(e) => setFilterDivision(e.target.value)}
              >
                <option value="all">All Divisions</option>
                {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {isEmployee && userAccessType === 'full' && (
            <div className="flex flex-wrap items-center gap-2">
              {localStorage.getItem(`companyName_${auth.currentUser?.uid}`) && (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-1.5 rounded-full font-bold">
                  Company: {localStorage.getItem(`companyName_${auth.currentUser?.uid}`)}
                </span>
              )}
              {userMachine && (
                <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1.5 rounded-full font-bold">
                  Machine: {userMachine}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Tab specific Action Buttons */}
        {activeTab === 'demands' && (
          <div className="flex flex-wrap gap-2">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
              <input
                type="text"
                placeholder="Search PL No..."
                className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            
            {isPrimaryAdmin && (
              <button
                type="button"
                onClick={() => setShowLogoModal(true)}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-3.5 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
                title="Upload & Manage Demand PDF Logo (Admin Only)"
              >
                <ImageIcon className="w-4 h-4 text-primary" />
                <span>Demand PDF Logo</span>
                {demandLogo ? (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm"></span>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-amber-400 shadow-sm"></span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => exportDemands('pending')}
              className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              title="Export Pending and Rejected Demands"
            >
              <Download size={16} /> Pending Export
            </button>

            {!isEmployee && (
              <>
                <button
                  type="button"
                  onClick={() => exportDemands('completed')}
                  className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
                  title="Export Completed Demands"
                >
                  <Download size={16} /> Complete Export
                </button>

                <button
                  type="button"
                  onClick={handleExportAll}
                  className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
                  title="Export All Demands"
                >
                  <Download size={16} /> Export All
                </button>
              </>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Plus size={20} /> Create Demand
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

            <button
              onClick={handleOpenAddReceiptModal}
              className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Plus size={20} /> Log Unconnected Receipt
            </button>
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
              return (
              <tr key={demand.id} className={cn(
                "hover:bg-surface-container-low transition-colors",
                demand.status !== 'pending' && "bg-surface-container-low/50 opacity-80"
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
                    <div>
                      <div className="font-semibold text-slate-800">{demand.description || '-'}</div>
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
                  {demand.qty || 0} <span className="text-[11px] font-semibold text-slate-500">{demand.unit || 'Nos'}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    {(() => {
                      const isCompleted = demand.status === 'completed' || (demand.receivedQty !== undefined && demand.receivedQty >= (demand.qty || 0));
                      const isPendingOrApproved = !isCompleted && (demand.status === 'pending' || demand.status === 'approved');
                      const displayStatus = isCompleted ? 'completed' : (demand.status === 'approved' ? 'pending' : demand.status);
                      
                      return (
                        <span className={cn(
                          "px-2 py-1 rounded text-[10px] font-black uppercase flex items-center gap-1 w-fit",
                          isPendingOrApproved ? "bg-yellow-100 text-yellow-700" :
                          isCompleted ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        )}>
                          {isPendingOrApproved && <Clock size={10} />}
                          {isCompleted && <CheckCircle size={10} />}
                          {demand.status === 'rejected' && <XCircle size={10} />}
                          {displayStatus}
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
                  <div>{demand.receivedQty || '-'}</div>
                  {demand.receipts && demand.receipts.length > 1 && (
                    <div className="text-[9px] text-slate-400 font-medium leading-tight mt-1 max-w-[120px] whitespace-normal">
                      History: {demand.receipts.map(r => `${r.qty} pcs`).join(' + ')}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  <div>{demand.receivedDate || '-'}</div>
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
                            status: demand.status ? demand.status.toUpperCase() : 'PENDING'
                          }, true);
                          toast.success('PDF Voucher Downloaded!');
                        } catch (err) {
                          console.error(err);
                          toast.error('Failed to generate PDF voucher');
                        }
                      }}
                      className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-all"
                      title="Download Voucher PDF (माँग पत्र पीडीएफ)"
                    >
                      <Download size={18} />
                    </button>
                    {demand.status === 'pending' ? (
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
                            <button
                              onClick={() => handleRejectClick(demand.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                              title="Reject Demand"
                            >
                              <XCircle size={18} />
                            </button>
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
                    ) : (
                      <span className="text-[10px] font-bold text-outline uppercase mr-2">Locked</span>
                    )}

                    {!isEmployee && (
                      <>
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
                          <button
                            onClick={() => {
                              setDemandToDelete(demand.id);
                              setShowDeleteModal(true);
                            }}
                            className="p-2 text-red-400 hover:text-red-600 transition-colors flex items-center justify-center"
                            title="Delete Demand"
                          >
                            <Trash2 size={18} />
                          </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl"
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
                      <option value="">-- Select Recipient (Optional) --</option>
                      {fullAccessEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.accessType === 'admin-light'
                            ? `${emp.companyName || emp.name.replace(' Admin', '')} (Company Administrator)`
                            : `${emp.name} (${emp.designation || 'Employee'}) - ${emp.companyName || 'No Company'}`}
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

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1.5">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                    <div className="relative w-16 h-16 rounded bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200 shadow-sm group">
                      {newDemand.imageUrl ? (
                        <>
                          <img src={newDemand.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setNewDemand(prev => ({ ...prev, imageUrl: '' }))}
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
                          onChange={(e) => handleImageUpload(e, false)}
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
          </div>
        )}
      </AnimatePresence>

      {/* Log Unconnected Material Receipt Modal */}
      <AnimatePresence>
        {showAddReceiptModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8"
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
                      required
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono font-bold text-slate-800 bg-slate-50"
                      placeholder="e.g. VOU-26-123456"
                      value={receiptForm.voucherNo}
                      onChange={e => setReceiptForm(prev => ({ ...prev, voucherNo: e.target.value }))}
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
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.machineName}
                      onChange={e => handleMachineNameChange(e.target.value)}
                    >
                      <option value="">-- Select Machine --</option>
                      {(isEmployee && userAccessType === 'admin-light'
                        ? Array.from(new Set(employeeList.filter(e => e.companyName === (localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                        : (isEmployee && userAccessType !== 'admin-light' && userMachine)
                          ? [userMachine]
                          : allCreatedMachines
                      ).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
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
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      value={receiptForm.partNo}
                      onChange={e => handlePartNoChange(e.target.value)}
                    />
                    <datalist id="partNo-options">
                      {availablePartsForReceipt.map(p => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
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
          </div>
        )}
      </AnimatePresence>

      {/* Edit Unconnected Material Receipt Modal */}
      <AnimatePresence>
        {showEditReceiptModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8"
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
                      required
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono font-bold text-slate-800 bg-slate-50"
                      placeholder="e.g. VOU-26-123456"
                      value={editReceiptForm.voucherNo}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, voucherNo: e.target.value }))}
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
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.machineName}
                      onChange={e => handleEditMachineNameChange(e.target.value)}
                    >
                      <option value="">-- Select Machine --</option>
                      {allCreatedMachines.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
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
                      className="w-full border border-outline/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold text-slate-700"
                      value={editReceiptForm.partNo}
                      onChange={e => handleEditPartNoChange(e.target.value)}
                    />
                    <datalist id="editPartNo-options">
                      {availablePartsForEditReceipt.map(p => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
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
          </div>
        )}
      </AnimatePresence>

      {/* Receive Demand Modal */}
      <AnimatePresence>
        {showReceiveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
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
                    Demand Qty: {selectedDemand?.qty}
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
                      {Math.max(0, (selectedDemand?.qty || 0) - (selectedDemand?.receivedQty || 0))}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Received Quantity</label>
                <input
                  type="number"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
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
          </div>
        )}
      </AnimatePresence>

      {/* Edit Demand Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl"
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
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
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
          </div>
        )}
      </AnimatePresence>

      {/* Forward Demand Modal */}
      <AnimatePresence>
        {showForwardModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-indigo-50">
                <h2 className="text-xl font-bold text-indigo-900">Forward Demand</h2>
                <button onClick={() => setShowForwardModal(false)} className="text-indigo-600 hover:text-indigo-900">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleForwardSubmit} className="p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Select an employee to forward this demand for PL No. <strong className="text-indigo-700">{forwardingDemand?.plNo}</strong>.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-indigo-600 mb-1">Recipient Employee (कर्मचारी का चयन करें)</label>
                  <select
                    className="w-full border border-indigo-200 focus:ring-indigo-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={selectedForwardEmployeeId}
                    onChange={e => setSelectedForwardEmployeeId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Recipient --</option>
                    {employeeList
                      .filter(emp => {
                        const isNotMe = emp.id !== currentEmployeeId && emp.id !== auth.currentUser?.uid;
                        if (!isNotMe) return false;

                        const myCompany = currentEmployeeCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
                        const isOperator = emp.designation?.toLowerCase().includes('operator');
                        const isSameCompany = !myCompany || !emp.companyName || emp.companyName === myCompany;
                        
                        if (isEmployee && userAccessType === 'full') {
                          // Full Access Admin forwards to Company Admin (admin-light) or Operator
                          return emp.accessType === 'admin-light' || (isOperator && isSameCompany);
                        }
                        if (isEmployee && userAccessType === 'admin-light') {
                          // Company Admin forwards to Master Admin (full) or Operator
                          return emp.accessType === 'full' || (isOperator && isSameCompany);
                        }
                        // Standard employees forward to Full Access (full) or Operator
                        return emp.accessType === 'full' || (isOperator && isSameCompany);
                      })
                      .map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.accessType === 'admin-light'
                            ? `${emp.companyName || emp.name.replace(' Admin', '')} (Company Administrator)`
                            : `${emp.name} (${emp.designation || 'Employee'}) - ${emp.companyName || 'No Company'}`}
                        </option>
                      ))}
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
          </div>
        )}
      </AnimatePresence>

      {/* Reject Demand Modal with Reason */}
      <AnimatePresence>
        {showRejectModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
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
          </div>
        )}

        {showTrackingModal && trackingDemand && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
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
          </div>
        )}
      </AnimatePresence>

      {/* Admin Demand Voucher PDF Logo Modal */}
      <AnimatePresence>
        {showLogoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 relative overflow-hidden"
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
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
