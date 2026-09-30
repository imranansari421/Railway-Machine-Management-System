import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  writeBatch, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where 
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { 
  ClipboardCheck, 
  PackageCheck, 
  Search, 
  Calendar, 
  Download, 
  FileText, 
  CheckCircle2, 
  Layers, 
  ArrowDownLeft, 
  Building2, 
  Cpu, 
  X, 
  FileSpreadsheet,
  RotateCcw,
  Eye,
  Clock,
  Inbox,
  Plus,
  Edit,
  Trash2,
  Boxes,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser, EmployeeProfile, isDemandAssignedToUser, isDemandSelfCreated, isAccountalItemForUser } from '../utils/employee';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import ReportPagination from '../components/reports/ReportPagination';

interface AccountalItem {
  id: string;
  sourceType: 'demand' | 'transaction' | 'issue_transfer';
  date: string;
  demandDate?: string;
  voucherNo: string;
  issueVoucherNo: string;
  demandNo?: string;
  plNo: string;
  partNo: string;
  description: string;
  demandedQty: number;
  issuingQty: number;
  qty: number;
  receivedQty: number;
  pendingQty: number;
  unit: string;
  rate: number;
  totalValue: number;
  receivedBy: string;
  receivedFrom: string;
  issuingCompanyDepot: string;
  demandedBy?: string;
  machineName: string;
  companyName?: string;
  location?: string;
  remarks?: string;
  itemCondition?: string;
  receiptStatus: 'awaiting_receipt' | 'partially_received' | 'received';
  status: 'accounted';
  rawDemand?: any;
  receipts?: any[];
  canReceive: boolean;
}

const STANDARD_RECEIPT_UOMS = ["Nos", "Sets", "Mtr", "Kg", "Ltr", "Pairs", "Box", "Pkt", "Roll", "Foot", "Quintal", "Other"];

export default function Accountal() {
  const [activeTab, setActiveTab] = useState<'register' | 'unconnected'>('register');
  const [currentEmployee, setCurrentEmployee] = useState<EmployeeProfile | null>(null);
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [userCompany, setUserCompany] = useState<string>(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });

  const isCompanyAdmin = userAccessType === 'admin-light' || userAccessType === 'divisional-admin' || userAccessType === 'zonal-admin';
  const isMasterAdmin = !isEmployee || userAccessType === 'full';
  const isPrimaryAdmin = isMasterAdmin || auth.currentUser?.email === 'imranansari399605@gmail.com' || auth.currentUser?.email?.startsWith('master.') || auth.currentUser?.email?.startsWith('admin.');

  // Hide 12th th tag (Actions) in Unconnected Material Receipts table for:
  // Employee account, Company Light (admin-light), Zonal Admin, and Divisional Admin
  const hideUnconnectedActions = Boolean(
    !auth.currentUser?.email?.startsWith('master.') &&
    !auth.currentUser?.email?.startsWith('admin.') &&
    auth.currentUser?.email !== 'imranansari399605@gmail.com' &&
    (
      isEmployee ||
      Boolean(currentEmployee) ||
      userAccessType === 'admin-light' ||
      userAccessType === 'zonal-admin' ||
      userAccessType === 'divisional-admin'
    )
  );

  const assignedMachine = (currentEmployee?.machineName || userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '').trim();
  const hasAssignedMachine = Boolean(
    assignedMachine &&
    assignedMachine.toLowerCase() !== 'all' &&
    assignedMachine.toLowerCase() !== 'none' &&
    assignedMachine.toLowerCase() !== 'n/a'
  );

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState<string>(() => {
    const m = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
    const access = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || '';
    if (m && access !== 'full') return m;
    return 'all';
  });
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [filterCondition, setFilterCondition] = useState('all');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState<'all' | 'awaiting' | 'received'>('all');
  const [filterSourceDepot, setFilterSourceDepot] = useState<'all' | 'other_user_depot'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Unconnected Receipt Filters & State
  const [unconnectedReceipts, setUnconnectedReceipts] = useState<any[]>([]);
  const [allMovements, setAllMovements] = useState<any[]>([]);
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('');
  const [receiptFilterMachine, setReceiptFilterMachine] = useState<string>(() => {
    const m = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
    const access = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || '';
    if (m && access !== 'full') return m;
    return 'all';
  });
  const [receiptFilterCompany, setReceiptFilterCompany] = useState('all');
  const [receiptFilterZone, setReceiptFilterZone] = useState('all');
  const [receiptFilterDivision, setReceiptFilterDivision] = useState('all');

  // Modals for Unconnected
  const [showAddReceiptModal, setShowAddReceiptModal] = useState(false);
  const [showEditReceiptModal, setShowEditReceiptModal] = useState(false);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);

  const [receiptForm, setReceiptForm] = useState({
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

  const [editReceiptForm, setEditReceiptForm] = useState<any>({
    id: '',
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

  // Data
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [allDemands, setAllDemands] = useState<any[]>([]);
  const [allParts, setAllParts] = useState<any[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [machinesList, setMachinesList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State for Viewing Accountal Voucher/Detail
  const [viewItem, setViewItem] = useState<AccountalItem | null>(null);

  // Modal State for Receiving Demanded Item into Stock
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedItemToReceive, setSelectedItemToReceive] = useState<AccountalItem | null>(null);
  const [receiveQty, setReceiveQty] = useState<number>(1);
  const [receiveDate, setReceiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [receiveRate, setReceiveRate] = useState<number>(0);
  const [receiveLocation, setReceiveLocation] = useState<string>('');
  const [receiveCondition, setReceiveCondition] = useState<string>('New');
  const [receiveRemarks, setReceiveRemarks] = useState<string>('');
  const [submittingReceive, setSubmittingReceive] = useState<boolean>(false);
  const [receiveSearchQuery, setReceiveSearchQuery] = useState<string>('');
  const [selectedInventoryPart, setSelectedInventoryPart] = useState<any | null>(null);
  const [receiveLedgerNo, setReceiveLedgerNo] = useState<string>('');
  const [receiveLedgerFolioNo, setReceiveLedgerFolioNo] = useState<string>('');
  const [receiveLedgerFolioPl, setReceiveLedgerFolioPl] = useState<string>('');
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [showReceiveWarningDialog, setShowReceiveWarningDialog] = useState<boolean>(false);
  const [showReceiveConfirmDialog, setShowReceiveConfirmDialog] = useState<boolean>(false);
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [foliosList, setFoliosList] = useState<{ id: string; name: string; machineName?: string }[]>([]);

  // Load User Profile
  useEffect(() => {
    const initProfile = async () => {
      if (!auth.currentUser) return;
      const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      if (emp) {
        setCurrentEmployee(emp);
        setUserAccessType(emp.accessType || 'limited');
        localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
        const m = emp.machineName || '';
        setUserMachine(m);
        localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, m);
        if (m && !isMasterAdmin) {
          setSelectedMachine(m);
          setReceiptFilterMachine(m);
        }
        const c = emp.companyName || '';
        setUserCompany(c);
        localStorage.setItem(`companyName_${auth.currentUser.uid}`, c);
      }
    };
    initProfile();
  }, []);

  // Fetch Employees & Companies
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'employees'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEmployeeList(list);
      const cos = Array.from(new Set(list.map((e: any) => e.companyName).filter(Boolean))) as string[];
      setCompaniesList(cos);
      const machs = Array.from(new Set(list.map((e: any) => e.machineName).filter(Boolean))) as string[];
      const standard = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      setMachinesList(Array.from(new Set([...standard, ...machs])).sort());
    });
    return () => unsub();
  }, []);

  // Fetch Transactions (Received & Old Stock)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'transactions'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter for received type transactions
      const receivedTx = list.filter((t: any) => t.type === 'received' || t.type === 'old_stock');
      setAllTransactions(receivedTx);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Fetch Demands
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'demands'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllDemands(list);
    });
    return () => unsub();
  }, []);

  // Fetch Parts to match details and update stock
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'parts'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllParts(list);
    });
    return () => unsub();
  }, []);

  // Fetch Folios from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'folios'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; machineName?: string }));
      setFoliosList(list);
    }, (err) => {
      console.error("Error loading folios in Accountal:", err);
    });
    return () => unsub();
  }, []);

  // Fetch Unconnected Material Receipts
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'unconnected_material_receipts'), (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      list.sort((a, b) => new Date(b.returnedDate || b.createdAt || 0).getTime() - new Date(a.returnedDate || a.createdAt || 0).getTime());
      setUnconnectedReceipts(list);
    }, (err) => {
      console.error("Error loading unconnected receipts:", err);
    });
    return () => unsub();
  }, []);

  // Fetch Machine Movements for Zone/Division Auto-fill
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

  // Fetch Machine Positions
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const posMap: Record<string, { zone: string; division: string }> = {};
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.machineName) {
          posMap[data.machineName] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setMachinePositions(posMap);
    }, (err) => {
      console.error("Error loading machine positions:", err);
    });
    return () => unsub();
  }, []);

  // Helper to determine stable zone/division on a date
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

  // Auto-populate zone/division for Add Form
  useEffect(() => {
    if (!showAddReceiptModal) return;
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
  }, [receiptForm.machineName, receiptForm.employeeId, receiptForm.returnedDate, allMovements, machinePositions, employeeList, showAddReceiptModal]);

  // Auto-populate zone/division for Edit Form
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

  const allCreatedMachines = useMemo(() => {
    return Array.from(new Set([
      ...machinesList,
      ...Object.keys(machinePositions),
      ...employeeList.map(e => e.machineName).filter(Boolean),
      ...allParts.map(p => p.machineName).filter(Boolean),
      ...allDemands.map(d => d.machineName).filter(Boolean),
    ])).filter(Boolean).sort();
  }, [machinesList, machinePositions, employeeList, allParts, allDemands]);

  const activeReceiptMachine = receiptForm.employeeId
    ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
    : (receiptForm.machineName || '');

  const availablePartsForReceipt = useMemo(() => {
    return allParts.filter(p => {
      if (!activeReceiptMachine) return true;
      return p.machineName && p.machineName.trim().toLowerCase() === activeReceiptMachine.trim().toLowerCase();
    });
  }, [allParts, activeReceiptMachine]);

  const activeEditReceiptMachine = editReceiptForm.employeeId
    ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
    : (editReceiptForm.machineName || '');

  const availablePartsForEditReceipt = useMemo(() => {
    return allParts.filter(p => {
      if (!activeEditReceiptMachine) return true;
      return p.machineName && p.machineName.trim().toLowerCase() === activeEditReceiptMachine.trim().toLowerCase();
    });
  }, [allParts, activeEditReceiptMachine]);

  const handleOpenAddReceiptModal = () => {
    const defaultMach = hasAssignedMachine ? assignedMachine : (userMachine || '');
    const matchedEmp = employeeList.find(e => e.machineName === defaultMach);
    const matchedCompany = matchedEmp?.companyName || userCompany || '';
    
    setReceiptForm({
      voucherNo: '',
      zone: '',
      division: '',
      machineName: defaultMach,
      companyName: matchedCompany,
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

  const handlePreviewUnconnected = (r: any) => {
    setViewItem({
      id: r.id,
      sourceType: 'issue_transfer',
      date: r.returnedDate ? format(new Date(r.returnedDate), 'dd-MM-yyyy') : (r.date || format(new Date(), 'dd-MM-yyyy')),
      voucherNo: r.voucherNo || 'N/A',
      issueVoucherNo: r.voucherNo || 'N/A',
      plNo: r.plNo || '-',
      partNo: r.partNo || '-',
      description: r.description || '-',
      demandedQty: r.qtyReturned || r.transactionQty || 1,
      issuingQty: r.qtyReturned || r.transactionQty || 1,
      qty: r.qtyReturned || r.transactionQty || 1,
      receivedQty: r.qtyReturned || r.transactionQty || 1,
      pendingQty: 0,
      unit: r.unit || 'Nos',
      rate: r.rate || 0,
      totalValue: (r.rate || 0) * (r.qtyReturned || 1),
      receivedBy: r.employeeName || r.receivedBy || 'Depot Official',
      receivedFrom: r.companyName || r.zone || 'Unconnected Receipt',
      issuingCompanyDepot: r.companyName || (r.zone ? `${r.zone} / ${r.division || ''}` : 'Depot'),
      machineName: r.machineName || 'Machine',
      location: r.location || '-',
      remarks: r.remarks || '',
      itemCondition: r.condition || 'Serviceable',
      receiptStatus: 'received',
      status: 'accounted',
      canReceive: false,
    });
  };

  const handleMachineNameChange = (machName: string) => {
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = matchedEmp ? matchedEmp.companyName || '' : '';
    setReceiptForm(prev => ({
      ...prev,
      machineName: machName,
      companyName: matchedCompany || prev.companyName,
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

  const handlePartNoChange = (selectedPartNo: string) => {
    const activeMachine = receiptForm.employeeId
      ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
      : (receiptForm.machineName || '');

    const matchedPart = allParts.find(p => {
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

    const matchedPart = allParts.find(p => {
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

  const handleEditMachineNameChange = (machName: string) => {
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = matchedEmp ? matchedEmp.companyName || '' : '';
    setEditReceiptForm((prev: any) => ({
      ...prev,
      machineName: machName,
      companyName: matchedCompany || prev.companyName,
    }));
  };

  const handleEditPartNoChange = (selectedPartNo: string) => {
    const activeMachine = editReceiptForm.employeeId
      ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
      : (editReceiptForm.machineName || '');

    const matchedPart = allParts.find(p => {
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

    const matchedPart = allParts.find(p => {
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

    const matchedPart = allParts.find(p => {
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

    const confirmed = window.confirm(`Confirm Material Receipt Log:\n\nItem Name: ${itemName}\nReceived Qty: ${qty}\n\nClick OK to add this received quantity to the Inventory Stock.`);
    if (!confirmed) return;

    setReceiptSubmitting(true);
    try {
      const user = auth.currentUser;
      const isRestrictedEmp = Boolean(hasAssignedMachine);
      const finalMachine = isRestrictedEmp ? assignedMachine : activeMachine;

      if (isRestrictedEmp && activeMachine && activeMachine.trim().toLowerCase() !== assignedMachine.trim().toLowerCase()) {
        toast.error(`You can only log material receipt for your assigned machine (${assignedMachine}).`);
        setReceiptSubmitting(false);
        return;
      }

      const receiptVoucherNo = receiptForm.voucherNo?.trim() || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const finalUnit = receiptForm.unit === 'Other' ? (receiptForm.customUnit.trim() || 'Nos') : (receiptForm.unit || 'Nos');

      const payload = {
        voucherNo: receiptVoucherNo,
        zone: receiptForm.zone,
        division: receiptForm.division,
        machineName: finalMachine,
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
        transactionQty: Number(receiptForm.qtyReturned),
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

        toast.success(`Unconnected Material Receipt logged! Voucher No: ${receiptVoucherNo}. Stock of ${matchedPart.partNo} increased to ${newStock}`);
      } else {
        toast.success(`Unconnected Material Receipt logged! Voucher No: ${receiptVoucherNo}`);
      }

      setShowAddReceiptModal(false);
    } catch (error) {
      console.error("Error saving unconnected receipt:", error);
      toast.error("Failed to save receipt. Please try again.");
    } finally {
      setReceiptSubmitting(false);
    }
  };

  const handleDeleteReceipt = async (id: string) => {
    if (!isPrimaryAdmin && !isCompanyAdmin) {
      toast.error("Only administrators can delete unconnected material receipts.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this receipt record? This will also revert the stock of the part and remove its transaction history.")) return;
    try {
      const receiptDocRef = doc(db, 'unconnected_material_receipts', id);
      const receiptSnap = await getDoc(receiptDocRef);
      if (receiptSnap.exists()) {
        const originalReceipt = receiptSnap.data();
        const originalQty = Number(originalReceipt.qtyReturned || 0);
        const originalPartNo = originalReceipt.partNo || '';
        const originalPlNo = originalReceipt.plNo || '';

        const matchedPartOld = allParts.find(p => 
          (originalPartNo && p.partNo?.trim().toLowerCase() === originalPartNo.trim().toLowerCase()) ||
          (originalPlNo && p.plNo?.trim().toLowerCase() === originalPlNo.trim().toLowerCase())
        );

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

      // Delete linked transaction history
      const transQuery = query(
        collection(db, 'transactions'),
        where('receiptId', '==', id)
      );
      const transSnap = await getDocs(transQuery);
      for (const tDoc of transSnap.docs) {
        await deleteDoc(doc(db, 'transactions', tDoc.id));
      }

      if (receiptSnap && receiptSnap.exists()) {
        const rData = receiptSnap.data();
        await archiveDeletedRecord({
          originalCollection: 'unconnected_material_receipts',
          originalId: id,
          data: rData,
          moduleName: 'Accountal / Unconnected Material Receipt',
          itemSummary: `Receipt: ${rData.partNo || rData.plNo || 'Item'} (${rData.qtyReturned || 0} ${rData.unit || 'Nos'}) • ${rData.machineName || 'Depot'}`,
          machineName: rData.machineName,
          companyName: (rData as any).companyName,
        });
      }
      await deleteDoc(receiptDocRef);

      toast.success("Receipt record deleted successfully and inventory stock reverted.");
    } catch (error) {
      console.error("Error deleting receipt:", error);
      toast.error("Failed to delete receipt.");
    }
  };

  const handleOpenEditReceipt = (r: any) => {
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
    if (!isPrimaryAdmin && !isCompanyAdmin) {
      toast.error("Only administrators can edit unconnected material receipts.");
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

    const matchedPartNew = allParts.find(p => {
      const machMatch = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
      const partMatch = (editReceiptForm.partNo && p.partNo?.trim().toLowerCase() === editReceiptForm.partNo.trim().toLowerCase()) ||
                        (editReceiptForm.plNo && p.plNo?.trim().toLowerCase() === editReceiptForm.plNo.trim().toLowerCase());
      return machMatch && partMatch;
    });

    if (!matchedPartNew) {
      toast.error("The entered Part No / PL No does not match any item in the Inventory.");
      return;
    }

    setReceiptSubmitting(true);
    try {
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

      const matchedPartOld = allParts.find(p => 
        (originalPartNo && p.partNo?.trim().toLowerCase() === originalPartNo.trim().toLowerCase()) ||
        (originalPlNo && p.plNo?.trim().toLowerCase() === originalPlNo.trim().toLowerCase())
      );

      if (matchedPartOld) {
        const partRefOld = doc(db, 'parts', matchedPartOld.id);
        const oldStockReverted = (matchedPartOld.stock || 0) - originalQty;
        const oldTotalValue = oldStockReverted * (matchedPartOld.rate || 0);
        await updateDoc(partRefOld, {
          stock: oldStockReverted,
          totalValue: oldTotalValue,
        });
      }

      // Add new stock to matched part
      const partRefNew = doc(db, 'parts', matchedPartNew.id);
      const baseStock = (matchedPartOld && matchedPartOld.id === matchedPartNew.id)
        ? (matchedPartOld.stock || 0) - originalQty
        : (matchedPartNew.stock || 0);
      const newStockNew = baseStock + Number(editReceiptForm.qtyReturned);
      const newTotalValueNew = newStockNew * (matchedPartNew.rate || 0);

      await updateDoc(partRefNew, {
        stock: newStockNew,
        totalValue: newTotalValueNew,
        location: editReceiptForm.location || matchedPartNew.location || '',
      });

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
      };

      await updateDoc(receiptDocRef, updatedPayload);
      toast.success("Receipt record and inventory stock updated successfully!");
      setShowEditReceiptModal(false);
    } catch (error) {
      console.error("Error updating receipt:", error);
      toast.error("Failed to update receipt.");
    } finally {
      setReceiptSubmitting(false);
    }
  };

  const exportUnconnectedReceiptsExcel = () => {
    if (filteredUnconnectedReceipts.length === 0) {
      toast.error("No unconnected receipts to export.");
      return;
    }
    const dataToExport = filteredUnconnectedReceipts.map((r, i) => ({
      "Sr No.": i + 1,
      "Voucher No": r.voucherNo || '-',
      "Returned Date": r.returnedDate ? format(new Date(r.returnedDate), 'dd-MM-yyyy') : '-',
      "Zone": r.zone || '-',
      "Division": r.division || '-',
      "Machine Name": r.machineName || '-',
      "Company Name": r.companyName || '-',
      "Part No": r.partNo || '-',
      "PL No": r.plNo || '-',
      "Description": r.description || '-',
      "Quantity Returned": r.qtyReturned || 0,
      "Unit": r.unit || 'Nos',
      "Storage Location": r.location || '-',
      "Remarks": r.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Unconnected Receipts");
    XLSX.writeFile(wb, `Unconnected_Material_Receipts_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
    toast.success("Exported unconnected material receipts to Excel!");
  };

  const exportUnconnectedReceiptsPDF = () => {
    if (filteredUnconnectedReceipts.length === 0) {
      toast.error("No unconnected receipts to export.");
      return;
    }
    try {
      const doc = new jsPDF('landscape', 'pt', 'a4');
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('RAILWAY MACHINE MANAGEMENT SYSTEM (RMMS)', 40, 35);
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text(`UNCONNECTED MATERIAL RECEIPTS (असंबंधित सामग्री प्राप्ति) - Generated on: ${format(new Date(), 'dd-MMM-yyyy')}`, 40, 52);

      const tableData = filteredUnconnectedReceipts.map((r, i) => [
        i + 1,
        r.returnedDate ? format(new Date(r.returnedDate), 'dd-MM-yyyy') : '-',
        r.voucherNo || '-',
        r.machineName || '-',
        `${r.plNo || '-'}\n${r.partNo || ''}`.trim(),
        r.description && r.description.length > 25 ? r.description.substring(0, 23) + '...' : r.description || '-',
        `${r.qtyReturned || 0} ${r.unit || 'Nos'}`,
        r.location || '-',
        r.remarks || '-'
      ]);

      (doc as any).autoTable({
        startY: 65,
        head: [['S.N.', 'DATE', 'VOUCHER NO', 'MACHINE', 'PL / PART NO', 'DESCRIPTION', 'QTY RETURNED', 'LOCATION', 'REMARKS']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
        margin: { left: 40, right: 40 },
      });

      doc.save(`RMMS_Unconnected_Receipts_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('Unconnected Receipts PDF generated successfully!');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('Failed to generate PDF.');
    }
  };

  const filteredUnconnectedReceipts = useMemo(() => {
    return unconnectedReceipts.filter(r => {
      // Machine filter
      if (receiptFilterMachine !== 'all' && r.machineName !== receiptFilterMachine) return false;
      // Company filter
      if (receiptFilterCompany !== 'all' && r.companyName !== receiptFilterCompany) return false;
      // Zone filter
      if (receiptFilterZone !== 'all' && r.zone !== receiptFilterZone) return false;
      // Division filter
      if (receiptFilterDivision !== 'all' && r.division !== receiptFilterDivision) return false;
      // Role scope & account isolation filter
      const myEmpId = currentEmployee?.employeeId || currentEmployee?.id;
      const myPf = (currentEmployee?.pfNo || '').toLowerCase();
      const myUid = auth.currentUser?.uid;
      const myEmail = (auth.currentUser?.email || '').toLowerCase();
      const myMach = (userMachine || currentEmployee?.machineName || '').trim().toLowerCase();

      const isMyReceipt = Boolean(
        (myEmpId && r.employeeId && (r.employeeId === myEmpId || r.employeeId === currentEmployee?.employeeId || r.employeeId === currentEmployee?.id)) ||
        (myPf && r.employeeId && r.employeeId.toLowerCase() === myPf) ||
        (myUid && r.createdBy && r.createdBy === myUid) ||
        (myEmail && r.createdByEmail && r.createdByEmail.toLowerCase() === myEmail) ||
        (myMach && r.machineName && r.machineName.trim().toLowerCase() === myMach)
      );

      const isExplicitAdminFilter = Boolean(
        (isMasterAdmin || isCompanyAdmin) &&
        (receiptFilterMachine !== 'all' || receiptFilterCompany !== 'all')
      );

      if (!isMyReceipt && !isExplicitAdminFilter) {
        return false;
      }
      // Search
      if (receiptSearchTerm) {
        const q = receiptSearchTerm.toLowerCase();
        const matches = 
          (r.voucherNo && r.voucherNo.toLowerCase().includes(q)) ||
          (r.partNo && r.partNo.toLowerCase().includes(q)) ||
          (r.plNo && r.plNo.toLowerCase().includes(q)) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          (r.machineName && r.machineName.toLowerCase().includes(q)) ||
          (r.companyName && r.companyName.toLowerCase().includes(q)) ||
          (r.remarks && r.remarks.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [unconnectedReceipts, receiptFilterMachine, receiptFilterCompany, receiptFilterZone, receiptFilterDivision, receiptSearchTerm, isEmployee, isCompanyAdmin, isMasterAdmin, userMachine]);

  // Aggregate stats for unconnected receipts
  const totalUnconnectedQty = useMemo(() => {
    return filteredUnconnectedReceipts.reduce((acc, r) => acc + (Number(r.qtyReturned) || 0), 0);
  }, [filteredUnconnectedReceipts]);

  const uniqueUnconnectedMachines = useMemo(() => {
    return new Set(filteredUnconnectedReceipts.map(r => r.machineName).filter(Boolean)).size;
  }, [filteredUnconnectedReceipts]);

  const uniqueUnconnectedParts = useMemo(() => {
    return new Set(filteredUnconnectedReceipts.map(r => r.partNo || r.plNo).filter(Boolean)).size;
  }, [filteredUnconnectedReceipts]);

  const receiptZones = useMemo(() => Array.from(new Set(unconnectedReceipts.map(r => r.zone).filter(Boolean))), [unconnectedReceipts]);
  const receiptDivisions = useMemo(() => Array.from(new Set(unconnectedReceipts.map(r => r.division).filter(Boolean))), [unconnectedReceipts]);
  const receiptCompanies = useMemo(() => Array.from(new Set(unconnectedReceipts.map(r => r.companyName).filter(Boolean))), [unconnectedReceipts]);
  const receiptMachines = useMemo(() => Array.from(new Set(unconnectedReceipts.map(r => r.machineName).filter(Boolean))), [unconnectedReceipts]);

  const handleResetReceiptFilters = () => {
    setReceiptSearchTerm('');
    setReceiptFilterMachine('all');
    setReceiptFilterCompany('all');
    setReceiptFilterZone('all');
    setReceiptFilterDivision('all');
  };

  // Transform depot-issued demands and received transactions into unified Accountal Register Items
  const accountalRegisterItems = useMemo(() => {
    const items: AccountalItem[] = [];
    const seenDemandIds = new Set<string>();
    const seenDemandNos = new Set<string>();
    const seenVouchers = new Set<string>();

    // 1. Process Demands officially issued by Forwarded Employee / Issuing Depot:
    // Demands MUST be officially issued by the forwarded employee / issuing depot.
    // If an item has NOT been issued by the user/forwarded employee yet, it MUST NOT appear in Accountal.
    allDemands.forEach((d) => {
      // Must not be pending, forwarded, rejected, or returned
      if (
        d.status === 'pending' || 
        d.status === 'forwarded' || 
        d.status === 'rejected' || 
        d.status === 'returned'
      ) {
        return;
      }

      // Must have official approved/issued/completed status
      const isOfficialIssued = d.status === 'approved' || d.status === 'completed' || d.status === 'issued';
      if (!isOfficialIssued) return;

      // Must have an official issuing quantity (> 0) given by the issuing/forwarded authority
      const issuedQty = Number(d.giveQty || 0);
      if (issuedQty <= 0) return;

      // Must have official issue voucher / note or issuedAt timestamp indicating the forwarded employee has actually issued the item
      const officialIssueVoucher = (d.issueNoteNo && d.issueNoteNo.trim()) || (d.issueVoucherNo && d.issueVoucherNo.trim());
      const isActuallyIssued = Boolean(officialIssueVoucher || d.issuedAt || (Array.isArray(d.receipts) && d.receipts.length > 0));
      if (!isActuallyIssued) return;

      // If the demand was forwarded to another employee/official, verify they have actually executed the issue
      const wasForwarded = Boolean(
        d.forwardedTo || 
        d.forwardedToName || 
        d.forwardedToEmail || 
        d.forwardedToEmployeeId || 
        d.forwardedToCompanyAdmin || 
        d.forwardedToAdmin
      );
      if (wasForwarded && !officialIssueVoucher && !d.issuedAt && (!d.receipts || d.receipts.length === 0)) {
        return;
      }

      const demandedQty = Number(d.demandedQty !== undefined ? d.demandedQty : (d.qty || 0));
      const rQty = Number(d.receivedQty || 0);
      const pendingQty = Math.max(0, issuedQty - rQty);

      // User directive: Whichever item is received in Accountal Module must NOT be shown in Accountal Module,
      // it should ONLY be shown in the Accountal Report!
      if ((rQty >= issuedQty && issuedQty > 0) || pendingQty <= 0) {
        return;
      }

      let receiptStatus: 'awaiting_receipt' | 'partially_received' | 'received' = 'awaiting_receipt';
      if (rQty > 0) {
        receiptStatus = 'partially_received';
      } else {
        receiptStatus = 'awaiting_receipt';
      }

      const effectiveRate = Number(d.rate || d.approvedRate || 0);
      const voucher = officialIssueVoucher || (d.demandNo ? `ISS-${d.demandNo}` : `ISS-${d.id.slice(0, 6).toUpperCase()}`);
      const demander = d.createdByEmployeeName || d.createdByEmail || d.issuedToEmployeeName || 'Demanding Official';
      const supplier = d.issuedFromMachine || d.lastActionByName || 'Central Depot';
      const issuingCompanyDepot = d.issuedFromMachine || d.issuedFromDepot || d.issuingCompany || d.sourceDepot || d.lastActionByName || supplier;

      items.push({
        id: `demand-${d.id}`,
        sourceType: 'demand',
        date: d.lastActionDate || d.receivedDate || d.date || format(new Date(), 'yyyy-MM-dd'),
        demandDate: d.date || d.demandDate || d.createdAt || '',
        voucherNo: voucher,
        issueVoucherNo: officialIssueVoucher || voucher,
        demandNo: d.demandNo,
        plNo: d.plNo || '',
        partNo: d.partNo || '',
        description: d.description || '',
        demandedQty: demandedQty,
        issuingQty: issuedQty,
        qty: issuedQty,
        receivedQty: rQty,
        pendingQty: pendingQty,
        unit: d.unit || 'Nos',
        rate: effectiveRate,
        totalValue: issuedQty * effectiveRate,
        receivedBy: d.receipts?.[0]?.receiverName || demander,
        receivedFrom: supplier,
        issuingCompanyDepot: issuingCompanyDepot,
        demandedBy: demander,
        machineName: d.requestingMachineName || d.machineName || 'Depot',
        companyName: d.createdByCompanyName,
        location: d.receipts?.[0]?.location || d.location || '',
        remarks: d.remarks || '',
        itemCondition: d.whetherUse || d.itemCondition || 'New',
        receiptStatus: receiptStatus,
        status: 'accounted',
        rawDemand: d,
        receipts: d.receipts || [],
        canReceive: issuedQty > 0 && pendingQty > 0,
      });

      seenDemandIds.add(d.id);
      if (d.demandNo) seenDemandNos.add(d.demandNo.toLowerCase());
      if (d.issueNoteNo) seenVouchers.add(d.issueNoteNo.toLowerCase());
      if (d.issueVoucherNo) seenVouchers.add(d.issueVoucherNo.toLowerCase());
    });

    // Sort chronologically newest first
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [allDemands]);

  // Apply filters to Accountal Register Items (Strict Isolation for Employees)
  const filteredRegisterItems = useMemo(() => {
    return accountalRegisterItems.filter((item) => {
      // Strict Account Isolation Rule:
      // "Accountal me wahi items show kare jisko accountal item jaye baki kisi ke account me show n kare"
      const isAccountRecipient = isAccountalItemForUser(
        item.rawDemand,
        auth.currentUser,
        currentEmployee,
        employeeList
      );

      // Explicit Admin Inspection:
      // Only when Master Admin or Company Admin explicitly selects a specific machine/company in the filter dropdown
      const isExplicitAdminFilter = Boolean(
        (isMasterAdmin || isCompanyAdmin) &&
        ((selectedMachine !== 'all' && item.machineName === selectedMachine) ||
         (selectedCompany !== 'all' && item.companyName === selectedCompany))
      );

      // Show ONLY if the accountal item went to this user account (or explicitly selected in admin filter)
      if (!isAccountRecipient && !isExplicitAdminFilter) {
        return false;
      }

      // Receipt Status Filter (All, Awaiting Receipt, Received)
      if (receiptStatusFilter === 'awaiting') {
        if (item.receiptStatus !== 'awaiting_receipt' && item.receiptStatus !== 'partially_received') return false;
      } else if (receiptStatusFilter === 'received') {
        if (item.receiptStatus !== 'received') return false;
      }

      // Company filter dropdown (for Admin)
      if (selectedCompany !== 'all') {
        const compEmps = employeeList.filter(e => e.companyName === selectedCompany);
        const compMachines = new Set(compEmps.map(e => e.machineName).filter(Boolean));
        const matchesComp = item.companyName === selectedCompany;
        const matchesMach = item.machineName && compMachines.has(item.machineName);
        if (!matchesComp && !matchesMach) return false;
      }

      // Machine filter dropdown
      if (selectedMachine !== 'all') {
        if (item.machineName && item.machineName !== selectedMachine) return false;
      }

      // Condition filter
      if (filterCondition !== 'all') {
        if (item.itemCondition !== filterCondition) return false;
      }

      // Other User Depot Filter
      if (filterSourceDepot === 'other_user_depot') {
        const myMach = (userMachine || currentEmployee?.machineName || '').trim().toLowerCase();
        const itemIssuing = (item.issuingCompanyDepot || item.receivedFrom || '').toLowerCase();
        const itemMach = (item.machineName || '').toLowerCase();
        // Item is from another user depot if issuing depot/shop is specified or different from receiver machine
        const isFromOtherDepot = item.sourceType === 'demand' || (itemIssuing && (!myMach || !itemIssuing.includes(myMach)));
        if (!isFromOtherDepot) return false;
      }

      // Date Range Filter
      if (startDate) {
        if (new Date(item.date) < new Date(startDate)) return false;
      }
      if (endDate) {
        if (new Date(item.date) > new Date(endDate)) return false;
      }

      // Search Term (PL, Part No, Description, Voucher, Received By, Received From, Demanded By)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matches = 
          item.plNo.toLowerCase().includes(q) ||
          item.partNo.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.voucherNo.toLowerCase().includes(q) ||
          (item.issueVoucherNo && item.issueVoucherNo.toLowerCase().includes(q)) ||
          (item.demandNo && item.demandNo.toLowerCase().includes(q)) ||
          item.receivedBy.toLowerCase().includes(q) ||
          (item.demandedBy && item.demandedBy.toLowerCase().includes(q)) ||
          item.receivedFrom.toLowerCase().includes(q) ||
          (item.issuingCompanyDepot && item.issuingCompanyDepot.toLowerCase().includes(q)) ||
          item.machineName.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [accountalRegisterItems, isMasterAdmin, isCompanyAdmin, userCompany, userMachine, currentEmployee, employeeList, selectedCompany, selectedMachine, filterCondition, receiptStatusFilter, filterSourceDepot, startDate, endDate, searchTerm]);

  // Financial & Volume Totals
  const totalAccountedQty = useMemo(() => {
    return filteredRegisterItems.reduce((sum, item) => sum + (item.receivedQty || item.qty || 0), 0);
  }, [filteredRegisterItems]);

  const totalAccountedValue = useMemo(() => {
    return filteredRegisterItems.reduce((sum, item) => sum + (item.totalValue || 0), 0);
  }, [filteredRegisterItems]);

  const awaitingReceiptCount = useMemo(() => {
    return filteredRegisterItems.filter(i => i.canReceive).length;
  }, [filteredRegisterItems]);

  const uniqueMaterialCount = useMemo(() => {
    return new Set(filteredRegisterItems.map(i => (i.plNo || i.partNo || i.description).trim().toLowerCase()).filter(Boolean)).size;
  }, [filteredRegisterItems]);

  // Pagination State for Accountal Register (10 rows per page)
  const pageSize = 10;
  const [registerCurrentPage, setRegisterCurrentPage] = useState(1);
  const registerTotalPages = Math.max(1, Math.ceil(filteredRegisterItems.length / pageSize));
  const paginatedRegisterItems = useMemo(() => {
    const start = (registerCurrentPage - 1) * pageSize;
    return filteredRegisterItems.slice(start, start + pageSize);
  }, [filteredRegisterItems, registerCurrentPage, pageSize]);

  // Reset register pagination on filter change
  useEffect(() => {
    setRegisterCurrentPage(1);
  }, [searchTerm, selectedMachine, selectedCompany, filterCondition, receiptStatusFilter, filterSourceDepot, startDate, endDate]);

  // Pagination State for Unconnected Material Receipts (10 rows per page)
  const [unconnectedCurrentPage, setUnconnectedCurrentPage] = useState(1);
  const unconnectedTotalPages = Math.max(1, Math.ceil(filteredUnconnectedReceipts.length / pageSize));
  const paginatedUnconnectedReceipts = useMemo(() => {
    const start = (unconnectedCurrentPage - 1) * pageSize;
    return filteredUnconnectedReceipts.slice(start, start + pageSize);
  }, [filteredUnconnectedReceipts, unconnectedCurrentPage, pageSize]);

  // Reset unconnected pagination on filter change
  useEffect(() => {
    setUnconnectedCurrentPage(1);
  }, [receiptSearchTerm, receiptFilterMachine, receiptFilterCompany, receiptFilterZone, receiptFilterDivision]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedMachine('all');
    setSelectedCompany('all');
    setFilterCondition('all');
    setReceiptStatusFilter('all');
    setFilterSourceDepot('all');
    setStartDate('');
    setEndDate('');
    setRegisterCurrentPage(1);
  };

  // Machine inventory parts for the target machine of selected receipt item
  const machineInventoryParts = useMemo(() => {
    if (!selectedItemToReceive) return [];
    const targetMachine = selectedItemToReceive.rawDemand?.requestingMachineName || selectedItemToReceive.rawDemand?.machineName || selectedItemToReceive.machineName || userMachine || '';
    if (!targetMachine) return allParts;
    return allParts.filter(p => !p.machineName || p.machineName.trim().toLowerCase() === targetMachine.trim().toLowerCase());
  }, [allParts, selectedItemToReceive, userMachine]);

  // Folios created for this machine (from folios collection and parts collection)
  const machineFolios = useMemo(() => {
    const targetMachine = selectedItemToReceive?.rawDemand?.requestingMachineName || 
                          selectedItemToReceive?.rawDemand?.machineName || 
                          selectedItemToReceive?.machineName || 
                          userMachine || '';
    
    // Folios from parts of this machine
    const fromMachineParts = machineInventoryParts
      .map(p => (p.folioName || p.ledgerFolioNo || '').trim())
      .filter(Boolean);

    // Folios from folios collection
    const fromFoliosCol = foliosList
      .filter(f => !f.machineName || !targetMachine || f.machineName.trim().toLowerCase() === targetMachine.trim().toLowerCase())
      .map(f => (f.name || '').trim())
      .filter(Boolean);

    // Folios from all parts as fallback if machine has none
    const fromAllParts = allParts
      .map(p => (p.folioName || p.ledgerFolioNo || '').trim())
      .filter(Boolean);

    const merged = Array.from(new Set([
      ...fromMachineParts, 
      ...fromFoliosCol, 
      ...(fromMachineParts.length === 0 ? fromAllParts : [])
    ])).filter(Boolean).sort();
    return merged;
  }, [machineInventoryParts, foliosList, allParts, selectedItemToReceive, userMachine]);

  // Filtered inventory parts matching search query in Receive Modal
  const matchingInventoryParts = useMemo(() => {
    const q = receiveSearchQuery.trim().toLowerCase();
    const sourceList = machineInventoryParts.length > 0 ? machineInventoryParts : allParts;
    if (!q) return sourceList.slice(0, 10);
    return sourceList.filter(p => {
      const pl = (p.plNo || '').toLowerCase();
      const partNo = (p.partNo || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const folio = (p.folioName || p.ledgerFolioNo || '').toLowerCase();
      const ledger = (p.ledgerNo || '').toLowerCase();
      const itemCode = (p.itemCode || '').toLowerCase();
      return pl.includes(q) || partNo.includes(q) || desc.includes(q) || folio.includes(q) || ledger.includes(q) || itemCode.includes(q);
    }).slice(0, 15);
  }, [machineInventoryParts, allParts, receiveSearchQuery]);

  const handleSelectInventoryPart = (part: any) => {
    setSelectedInventoryPart(part);
    setReceiveSearchQuery(part.plNo ? `${part.plNo} - ${part.description || part.partNo}` : (part.description || part.partNo || ''));
    setReceiveLedgerNo(part.ledgerNo || '');
    setReceiveLedgerFolioNo(part.ledgerFolioNo || part.folioNo || part.folioName || '');
    const plPart = part.ledgerFolioPl || part.plNo || part.partNo || selectedItemToReceive?.plNo || selectedItemToReceive?.partNo || '';
    const desc = part.description || selectedItemToReceive?.description || '';
    setReceiveLedgerFolioPl(plPart && desc && !plPart.includes(desc) ? `${plPart} - ${desc}` : (plPart || desc));
    if (part.location) {
      setReceiveLocation(part.location);
    }
    setShowSearchDropdown(false);
  };

  const handleReceiveSearchChange = (queryStr: string) => {
    setReceiveSearchQuery(queryStr);
    setShowSearchDropdown(true);

    const q = queryStr.trim().toLowerCase();
    if (!q) {
      setSelectedInventoryPart(null);
      return;
    }

    const pool = machineInventoryParts.length > 0 ? machineInventoryParts : allParts;
    const exactMatch = pool.find(p => {
      const pl = (p.plNo || '').trim().toLowerCase();
      const part = (p.partNo || '').trim().toLowerCase();
      const folio = (p.folioName || p.ledgerFolioNo || '').trim().toLowerCase();
      const desc = (p.description || '').trim().toLowerCase();
      const itemCode = (p.itemCode || '').trim().toLowerCase();
      return (
        pl === q ||
        part === q ||
        folio === q ||
        desc === q ||
        itemCode === q ||
        (pl && q.length >= 3 && pl.includes(q)) ||
        (part && q.length >= 3 && part.includes(q)) ||
        (desc && q.length >= 4 && desc.includes(q))
      );
    });

    if (exactMatch) {
      setSelectedInventoryPart(exactMatch);
      setReceiveLedgerNo(exactMatch.ledgerNo || '');
      setReceiveLedgerFolioNo(exactMatch.ledgerFolioNo || exactMatch.folioNo || exactMatch.folioName || '');
      const plPart = exactMatch.ledgerFolioPl || exactMatch.plNo || exactMatch.partNo || selectedItemToReceive?.plNo || selectedItemToReceive?.partNo || '';
      const desc = exactMatch.description || selectedItemToReceive?.description || '';
      setReceiveLedgerFolioPl(plPart && desc && !plPart.includes(desc) ? `${plPart} - ${desc}` : (plPart || desc));
      if (exactMatch.location) {
        setReceiveLocation(exactMatch.location);
      }
    }
  };

  // Open Receive Modal for a demanded item issued by depot
  const handleOpenReceiveModal = (item: AccountalItem) => {
    const itemMachine = (item.rawDemand?.requestingMachineName || item.rawDemand?.machineName || item.machineName || '').trim().toLowerCase();
    const myMachine = (userMachine || currentEmployee?.machineName || '').trim().toLowerCase();

    if (!isMasterAdmin && myMachine && itemMachine && itemMachine !== myMachine) {
      toast.error(`You can only take on account / receive items for your assigned machine (${userMachine}). This item belongs to ${item.machineName || 'another machine'}.`);
      return;
    }

    setSelectedItemToReceive(item);
    setReceiveQty(item.pendingQty || item.qty || 1);
    setReceiveDate(format(new Date(), 'yyyy-MM-dd'));
    setReceiveRate(item.rate || 0);
    setReceiveCondition(item.itemCondition || 'New');
    setReceiveRemarks('');
    setShowSearchDropdown(false);
    setShowReceiveWarningDialog(false);
    setShowReceiveConfirmDialog(false);
    setWarningMessage('');

    const targetMachine = item.rawDemand?.requestingMachineName || item.rawDemand?.machineName || item.machineName || userMachine || 'Depot';
    const cleanPl = (item.plNo || '').trim().toLowerCase();
    const cleanPart = (item.partNo || '').trim().toLowerCase();

    // Match in target machine's inventory
    const matched = allParts.find(p => {
      const matchMach = !targetMachine || !p.machineName || p.machineName.trim().toLowerCase() === targetMachine.trim().toLowerCase();
      if (!matchMach) return false;
      const matchPl = cleanPl && p.plNo && p.plNo.trim().toLowerCase() === cleanPl;
      const matchPart = cleanPart && p.partNo && p.partNo.trim().toLowerCase() === cleanPart;
      return matchPl || matchPart;
    });

    const itemPl = item.plNo || item.partNo || '';
    const itemDesc = item.description || '';
    const initialPlDesc = itemPl && itemDesc ? `${itemPl} - ${itemDesc}` : (itemPl || itemDesc);

    if (matched) {
      setSelectedInventoryPart(matched);
      setReceiveSearchQuery(matched.plNo || matched.partNo || matched.description || '');
      setReceiveLocation(matched.location || item.location || '');
      setReceiveLedgerNo(matched.ledgerNo || '');
      setReceiveLedgerFolioNo(matched.ledgerFolioNo || matched.folioNo || matched.folioName || '');
      const plPart = matched.ledgerFolioPl || matched.plNo || matched.partNo || itemPl;
      const desc = matched.description || itemDesc;
      setReceiveLedgerFolioPl(plPart && desc && !plPart.includes(desc) ? `${plPart} - ${desc}` : (plPart || desc));
    } else {
      setSelectedInventoryPart(null);
      setReceiveSearchQuery(item.plNo || item.partNo || '');
      setReceiveLocation(item.location || '');
      setReceiveLedgerNo('');
      setReceiveLedgerFolioNo('');
      setReceiveLedgerFolioPl(initialPlDesc);
    }

    setShowReceiveModal(true);
  };

  // Form submit handler with validation & mismatch check
  const handlePreSubmitReceive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemToReceive || !selectedItemToReceive.rawDemand) {
      toast.error('No valid demand linked to this item.');
      return;
    }

    const maxAllowed = selectedItemToReceive.pendingQty || selectedItemToReceive.qty || 1;
    if (receiveQty <= 0) {
      toast.error('Receipt quantity must be greater than 0.');
      return;
    }
    if (receiveQty > maxAllowed) {
      toast.error(`Receipt quantity cannot exceed remaining pending quantity (${maxAllowed} ${selectedItemToReceive.unit || 'Nos'}).`);
      return;
    }

    const incomingPl = (selectedItemToReceive.plNo || '').trim().toLowerCase();
    const incomingPart = (selectedItemToReceive.partNo || '').trim().toLowerCase();

    if (selectedInventoryPart) {
      const invPl = (selectedInventoryPart.plNo || '').trim().toLowerCase();
      const invPart = (selectedInventoryPart.partNo || '').trim().toLowerCase();
      const matchPl = incomingPl && invPl && incomingPl === invPl;
      const matchPart = incomingPart && invPart && incomingPart === invPart;

      if (!matchPl && !matchPart) {
        setWarningMessage(
          `Warning: Incoming item's PL No. (${selectedItemToReceive.plNo || '-'}) / Part No. (${selectedItemToReceive.partNo || '-'}) does not match the selected inventory item (${selectedInventoryPart.plNo || '-'} / ${selectedInventoryPart.partNo || '-'}). Do you want to proceed and update this item in the inventory?`
        );
        setShowReceiveWarningDialog(true);
        return;
      }
    } else {
      const targetMachine = selectedItemToReceive.rawDemand?.requestingMachineName || selectedItemToReceive.rawDemand?.machineName || selectedItemToReceive.machineName || userMachine || 'Depot';
      const existingMatch = allParts.find(p => {
        const matchesMach = !targetMachine || !p.machineName || p.machineName.toLowerCase() === targetMachine.toLowerCase();
        const matchesPl = incomingPl && p.plNo && p.plNo.trim().toLowerCase() === incomingPl;
        const matchesPart = incomingPart && p.partNo && p.partNo.trim().toLowerCase() === incomingPart;
        return matchesMach && (matchesPl || matchesPart);
      });

      if (!existingMatch) {
        setWarningMessage(
          `Warning: No matching item found for PL No. (${selectedItemToReceive.plNo || '-'}) or Part No. (${selectedItemToReceive.partNo || '-'}) in ${targetMachine} inventory. A new inventory item will be created in stock. Do you want to proceed?`
        );
        setShowReceiveWarningDialog(true);
        return;
      }
    }

    // Direct confirmation
    setShowReceiveConfirmDialog(true);
  };

  const handleWarningOk = () => {
    setShowReceiveWarningDialog(false);
    setShowReceiveConfirmDialog(true);
  };

  // Confirm receipt and take item on account into stock
  const handleConfirmReceive = async () => {
    setShowReceiveConfirmDialog(false);
    if (!selectedItemToReceive || !selectedItemToReceive.rawDemand) {
      toast.error('No valid demand linked to this item.');
      return;
    }

    const demand = selectedItemToReceive.rawDemand;
    const maxAllowed = selectedItemToReceive.pendingQty || selectedItemToReceive.qty || 1;

    if (receiveQty <= 0 || receiveQty > maxAllowed) {
      toast.error('Invalid receipt quantity.');
      return;
    }

    setSubmittingReceive(true);
    try {
      const batch = writeBatch(db);
      const targetMachine = demand.requestingMachineName || demand.machineName || userMachine || 'Depot';
      const receiverName = currentEmployee?.name || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Depot Official';

      // 1. Update or Create Part in 'parts' collection for target machine inventory
      const cleanPl = (demand.plNo || '').trim().toLowerCase();
      const cleanPart = (demand.partNo || '').trim().toLowerCase();

      let targetPart = selectedInventoryPart;
      if (!targetPart) {
        targetPart = allParts.find(p => {
          const matchesMach = !targetMachine || !p.machineName || p.machineName.toLowerCase() === targetMachine.toLowerCase();
          const matchesPl = cleanPl && p.plNo && p.plNo.trim().toLowerCase() === cleanPl;
          const matchesPartNo = cleanPart && p.partNo && p.partNo.trim().toLowerCase() === cleanPart;
          return matchesMach && (matchesPl || matchesPartNo);
        });
      }

      let partId = '';
      if (targetPart) {
        partId = targetPart.id;
        const newStock = (targetPart.stock || 0) + receiveQty;
        const effectiveRate = receiveRate > 0 ? receiveRate : (targetPart.rate || demand.rate || 0);
        const newTotalVal = newStock * effectiveRate;
        const partRef = doc(db, 'parts', targetPart.id);
        batch.update(partRef, {
          stock: newStock,
          rate: effectiveRate,
          totalValue: newTotalVal,
          location: receiveLocation || targetPart.location || '',
          ledgerNo: receiveLedgerNo || targetPart.ledgerNo || '',
          folioName: receiveLedgerFolioNo || targetPart.folioName || targetPart.ledgerFolioNo || '',
          ledgerFolioNo: receiveLedgerFolioNo || targetPart.ledgerFolioNo || targetPart.folioNo || '',
          ledgerFolioPl: receiveLedgerFolioPl || targetPart.ledgerFolioPl || targetPart.plNo || '',
          whetherUse: receiveCondition || targetPart.whetherUse || 'CS',
          itemCondition: receiveCondition || targetPart.itemCondition || 'New',
          updatedAt: new Date().toISOString(),
        });
      } else {
        const newPartRef = doc(collection(db, 'parts'));
        partId = newPartRef.id;
        const effectiveRate = receiveRate > 0 ? receiveRate : (demand.rate || 0);
        batch.set(newPartRef, {
          plNo: demand.plNo || '',
          partNo: demand.partNo || '',
          description: demand.description || '',
          stock: receiveQty,
          rate: effectiveRate,
          totalValue: receiveQty * effectiveRate,
          unit: demand.unit || 'Nos',
          location: receiveLocation || 'Main Store',
          machineName: targetMachine,
          ledgerNo: receiveLedgerNo || '',
          folioName: receiveLedgerFolioNo || '',
          ledgerFolioNo: receiveLedgerFolioNo || '',
          ledgerFolioPl: receiveLedgerFolioPl || demand.plNo || demand.partNo || '',
          whetherUse: receiveCondition || 'CS',
          itemCondition: receiveCondition || 'New',
          createdAt: new Date().toISOString(),
        });
      }

      // 2. Update Demand document with receipt progress
      const demandRef = doc(db, 'demands', demand.id);
      const previouslyReceived = demand.receivedQty || 0;
      const totalReceived = previouslyReceived + receiveQty;
      const targetGiven = demand.giveQty !== undefined ? demand.giveQty : demand.qty;
      const isCompleted = totalReceived >= targetGiven;

      const newReceiptEntry = {
        qty: receiveQty,
        date: receiveDate,
        location: receiveLocation,
        rate: receiveRate,
        ledgerNo: receiveLedgerNo,
        ledgerFolioNo: receiveLedgerFolioNo,
        ledgerFolioPl: receiveLedgerFolioPl,
        remarks: receiveRemarks,
        receiverName: receiverName,
        receivedFrom: demand.issuedFromMachine || demand.lastActionByName || 'Depot',
        itemCondition: receiveCondition,
        timestamp: new Date().toISOString(),
      };

      const existingReceipts = Array.isArray(demand.receipts) ? demand.receipts : [];

      batch.update(demandRef, {
        status: isCompleted ? 'completed' : 'approved',
        receivedQty: totalReceived,
        receivedDate: receiveDate,
        lastReceivedDate: receiveDate,
        receipts: [...existingReceipts, newReceiptEntry],
      });

      // 3. Add to Transactions collection (type: 'received')
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: partId,
        type: 'received',
        qty: receiveQty,
        unit: demand.unit || 'Nos',
        date: receiveDate,
        rate: receiveRate,
        totalValue: receiveQty * receiveRate,
        voucherNo: demand.issueNoteNo || demand.demandNo || `VR-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`,
        demandNo: demand.demandNo || '',
        plNo: demand.plNo || '',
        partNo: demand.partNo || '',
        description: demand.description || '',
        ledgerNo: receiveLedgerNo || '',
        ledgerFolioNo: receiveLedgerFolioNo || '',
        ledgerFolioPl: receiveLedgerFolioPl || '',
        details: `Accountal Receipt: ${receiveQty} ${demand.unit || 'Nos'} received into ${targetMachine} [Condition: ${receiveCondition}]`,
        remarks: receiveRemarks || `Received against demand ${demand.demandNo || ''}`,
        receiverName: receiverName,
        receivedBy: receiverName,
        receivedFrom: demand.issuedFromMachine || demand.lastActionByName || 'Central Depot / Company',
        machineName: targetMachine,
        itemCondition: receiveCondition,
        whetherUse: receiveCondition,
        location: receiveLocation,
        companyName: demand.createdByCompanyName || userCompany || '',
        timestamp: new Date().toISOString(),
      });

      // 4. Log to Demand Logs
      const logRef = doc(collection(db, 'demand_logs'));
      batch.set(logRef, {
        demandId: demand.id,
        plNo: demand.plNo || '',
        partNo: demand.partNo || '',
        description: demand.description || '',
        action: isCompleted ? 'COMPLETE' : 'RECEIVE',
        remark: `Accountal: Received ${receiveQty} ${demand.unit || 'Nos'} into ${targetMachine}. Receiver: ${receiverName}.${receiveRemarks ? ` Note: ${receiveRemarks}` : ''}`,
        performedByUid: auth.currentUser?.uid || '',
        performedByName: receiverName,
        performedByEmail: auth.currentUser?.email || '',
        timestamp: new Date().toISOString(),
      });

      await batch.commit();
      toast.success(`Item successfully received & taken on account! (${receiveQty} ${demand.unit || 'Nos'}) — Moved to Accountal Report.`);
      setShowReceiveModal(false);
      setSelectedItemToReceive(null);
    } catch (error) {
      console.error('Error accounting received item:', error);
      toast.error('Failed to receive item. Please check your connection.');
    } finally {
      setSubmittingReceive(false);
    }
  };

  // Export Accountal Register to Excel
  const handleExportExcel = () => {
    try {
      const dataToExport = filteredRegisterItems.map((item, index) => ({
        'S.No': index + 1,
        'DATE': item.date,
        'DEMAND NO': item.demandNo || '-',
        'PL & PART NO': `${item.plNo || '-'}${item.partNo ? ' / ' + item.partNo : ''}`,
        'DESCRIPTION': item.description,
        'DEMAND QTY': `${item.demandedQty || item.qty} ${item.unit}`,
        'ISSUING QTY': `${item.issuingQty || item.qty} ${item.unit}`,
        'ISSUING COMPANY / DEPOT': item.issuingCompanyDepot || item.receivedFrom || '-',
        'ISSUE VOUCHER NO': item.issueVoucherNo || item.voucherNo || '-',
        'RECEIVING MACHINE / DEPOT': item.machineName,
        'DEMANDED BY': item.demandedBy || '-',
        'STATUS': item.receiptStatus === 'received' ? 'Received' : (item.receiptStatus === 'partially_received' ? 'Partially Received' : 'Awaiting Receipt'),
        'REMARKS': item.remarks || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Accountal Register');

      const maxCols = Object.keys(dataToExport[0] || {}).length;
      worksheet['!cols'] = Array(maxCols).fill({ wch: 18 });

      XLSX.writeFile(workbook, `RMMS_Accountal_Register_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
      toast.success('Accountal Register exported to Excel successfully!');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export Excel.');
    }
  };

  // Export Accountal Register to PDF
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF('landscape', 'pt', 'a4');
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('RAILWAY MACHINE MANAGEMENT SYSTEM (RMMS)', 40, 35);
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text(`MATERIAL ACCOUNTAL REGISTER (सामग्री लेखांकन रजिस्टर) - Generated on: ${format(new Date(), 'dd-MMM-yyyy')}`, 40, 52);

      const tableData = filteredRegisterItems.map((item, index) => [
        index + 1,
        item.date,
        item.demandNo || '-',
        `${item.plNo || '-'}\n${item.partNo || ''}`.trim(),
        item.description.length > 25 ? item.description.substring(0, 23) + '...' : item.description,
        `${item.demandedQty || item.qty} ${item.unit}`,
        `${item.issuingQty || item.qty} ${item.unit}`,
        item.issuingCompanyDepot || item.receivedFrom || '-',
        item.issueVoucherNo || item.voucherNo || '-',
        item.receiptStatus === 'received' ? 'Received' : 'Pending',
      ]);

      (doc as any).autoTable({
        startY: 65,
        head: [['S.N.', 'DATE', 'DEMAND NO', 'PL & PART NO', 'DESCRIPTION', 'DEMAND QTY', 'ISSUING QTY', 'ISSUING COMPANY/DEPOT', 'ISSUE VOUCHER NO', 'STATUS']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
        margin: { left: 40, right: 40 },
      });

      doc.save(`RMMS_Accountal_Ledger_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('Accountal PDF generated successfully!');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('Failed to generate PDF.');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden space-y-4"
    >
      {/* Header Bar */}
      <div className="flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-indigo-100">
              <ClipboardCheck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">Accountal Module</h1>
                <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md border border-emerald-200">
                  लेखांकन व सामग्री प्राप्ति
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Official Material Accountal Register for items issued by depot & unconnected material receipts taken on account.
              </p>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1 w-fit">
            <button
              id="accountal-tab-register-btn"
              onClick={() => setActiveTab('register')}
              className={cn(
                "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                activeTab === 'register' 
                  ? "bg-white text-indigo-700 shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <ClipboardCheck size={14} />
              Accountal Register
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-200/80 rounded-full font-black text-slate-700">
                {filteredRegisterItems.length}
              </span>
            </button>
            <button
              id="accountal-tab-unconnected-btn"
              onClick={() => setActiveTab('unconnected')}
              className={cn(
                "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                activeTab === 'unconnected' 
                  ? "bg-white text-indigo-700 shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Boxes size={14} />
              Unconnected Material Receipts
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-200/80 rounded-full font-black text-slate-700">
                {filteredUnconnectedReceipts.length}
              </span>
            </button>
          </div>
        </div>

        {/* User Context & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto justify-end">
          {userCompany && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold">
              <Building2 size={14} className="text-emerald-600" />
              {userCompany}
            </span>
          )}
          {userMachine && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold">
              <Cpu size={14} className="text-indigo-600" />
              {userMachine}
            </span>
          )}

          {activeTab === 'register' ? (
            <>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                title="Export to Excel"
              >
                <Download size={14} className="text-emerald-600" />
                Excel
              </button>
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                title="Download PDF Ledger"
              >
                <FileText size={14} className="text-indigo-600" />
                PDF
              </button>
            </>
          ) : (
            <>
              <button
                onClick={exportUnconnectedReceiptsExcel}
                className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                title="Export Unconnected Material Receipts to Excel"
              >
                <Download size={14} className="text-emerald-600" />
                Export Excel
              </button>
              <button
                onClick={exportUnconnectedReceiptsPDF}
                className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                title="Export Unconnected Material Receipts to PDF"
              >
                <FileText size={14} className="text-indigo-600" />
                Export PDF
              </button>
              {!(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin')) && (
                <button
                  id="log-unconnected-receipt-btn"
                  onClick={handleOpenAddReceiptModal}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus size={16} />
                  Log Unconnected Receipt
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      {activeTab === 'register' ? (
        <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Accounted Entries</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{filteredRegisterItems.length}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PackageCheck size={18} />
            </div>
          </div>

          <div className={cn(
            "p-4 rounded-xl border shadow-sm flex items-center justify-between transition-all",
            awaitingReceiptCount > 0 
              ? "bg-amber-50/60 border-amber-200" 
              : "bg-white border-slate-200"
          )}>
            <div>
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Awaiting Receipt</span>
              <p className="text-lg font-black text-amber-900 mt-0.5">{awaitingReceiptCount} items</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock size={18} />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Total Qty Received</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{totalAccountedQty.toLocaleString()}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ArrowDownLeft size={18} />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Total Material Valuation</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">₹{totalAccountedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers size={18} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Receipts Logged</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{filteredUnconnectedReceipts.length}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Boxes size={18} />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Total Returned Qty</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{totalUnconnectedQty.toLocaleString()}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ArrowDownLeft size={18} />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Active Machines</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{uniqueUnconnectedMachines}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Cpu size={18} />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Unique Items Logged</span>
              <p className="text-lg font-black text-slate-800 mt-0.5">{uniqueUnconnectedParts}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <PackageCheck size={18} />
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      {activeTab === 'register' ? (
        <div className="flex-shrink-0 flex flex-col lg:flex-row justify-between lg:items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          {/* Register Count Badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-slate-700 tracking-wide">
              Accountal Items
            </span>
            <span className="px-2.5 py-0.5 text-xs font-mono font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
              {filteredRegisterItems.length}
            </span>
          </div>

          {/* Search & Secondary Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Search PL, Part, Voucher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Machine Filter */}
            <select
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
              disabled={!isMasterAdmin && Boolean(userMachine)}
              className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none disabled:opacity-85 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
            >
              {!isMasterAdmin && Boolean(userMachine) ? (
                <option value={userMachine}>{userMachine}</option>
              ) : (
                <>
                  <option value="all">All Machines</option>
                  {machinesList.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </>
              )}
            </select>

            {/* Company Filter (Admin only) */}
            {isMasterAdmin && (
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none"
              >
                <option value="all">All Companies</option>
                {companiesList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* Condition Filter */}
            <select
              value={filterCondition}
              onChange={(e) => setFilterCondition(e.target.value)}
              className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none"
            >
              <option value="all">All Conditions</option>
              <option value="New">✨ New</option>
              <option value="Serviceable">🛠️ Serviceable</option>
              <option value="Released">♻️ Released</option>
            </select>

            {/* Reset Filters */}
            {(searchTerm || selectedMachine !== 'all' || selectedCompany !== 'all' || filterCondition !== 'all' || filterSourceDepot !== 'all' || startDate || endDate) && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 text-xs font-bold hover:bg-slate-50 transition-colors"
                title="Reset Filters"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}

            {/* Export Buttons */}
            <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Export Accountal Register to Excel"
              >
                <Download size={13} className="text-emerald-600" />
                Excel
              </button>
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Download Accountal Register PDF"
              >
                <FileText size={13} className="text-indigo-600" />
                PDF
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 flex flex-col lg:flex-row justify-between lg:items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          {/* Receipts Count Badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-slate-700 tracking-wide">
              Receipt Records
            </span>
            <span className="px-2.5 py-0.5 text-xs font-mono font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
              {filteredUnconnectedReceipts.length}
            </span>
          </div>

          {/* Search & Secondary Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Search Receipts, Voucher, PL..."
                value={receiptSearchTerm}
                onChange={(e) => setReceiptSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              {receiptSearchTerm && (
                <button 
                  onClick={() => setReceiptSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Machine Filter */}
            <select
              value={receiptFilterMachine}
              onChange={(e) => setReceiptFilterMachine(e.target.value)}
              disabled={!isMasterAdmin && Boolean(userMachine)}
              className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none disabled:opacity-85 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
            >
              {!isMasterAdmin && Boolean(userMachine) ? (
                <option value={userMachine}>{userMachine}</option>
              ) : (
                <>
                  <option value="all">All Machines</option>
                  {allCreatedMachines.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </>
              )}
            </select>

            {/* Company Filter (Admin only) */}
            {isMasterAdmin && (
              <select
                value={receiptFilterCompany}
                onChange={(e) => setReceiptFilterCompany(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none"
              >
                <option value="all">All Companies</option>
                {companiesList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* Zone Filter */}
            {receiptZones.length > 0 && (
              <select
                value={receiptFilterZone}
                onChange={(e) => setReceiptFilterZone(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none"
              >
                <option value="all">All Zones</option>
                {receiptZones.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            )}

            {/* Division Filter */}
            {receiptDivisions.length > 0 && (
              <select
                value={receiptFilterDivision}
                onChange={(e) => setReceiptFilterDivision(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-slate-50 font-bold text-slate-700 shadow-sm focus:outline-none"
              >
                <option value="all">All Divisions</option>
                {receiptDivisions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}

            {/* Reset Filters */}
            {(receiptSearchTerm || receiptFilterMachine !== 'all' || receiptFilterCompany !== 'all' || receiptFilterZone !== 'all' || receiptFilterDivision !== 'all') && (
              <button
                onClick={handleResetReceiptFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 text-xs font-bold hover:bg-slate-50 transition-colors"
                title="Reset Filters"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}

            {/* Export Buttons */}
            <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
              <button
                onClick={exportUnconnectedReceiptsExcel}
                className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Export Unconnected Material Receipts to Excel"
              >
                <Download size={13} className="text-emerald-600" />
                Excel
              </button>
              <button
                onClick={exportUnconnectedReceiptsPDF}
                className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Export Unconnected Material Receipts to PDF"
              >
                <FileText size={13} className="text-indigo-600" />
                PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-grow overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0">
        {activeTab === 'register' ? (
          /* ACCOUNTAL REGISTER CONTAINER */
          <div className="flex flex-col h-full overflow-hidden">
            {/* Table Header Banner with Title & Export Options */}
            <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <ClipboardCheck size={14} />
                </div>
                <h2 className="text-xs font-black uppercase text-slate-800 tracking-wide">
                  Accountal Material Inward Register
                </h2>
                <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                  {filteredRegisterItems.length} records
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {!(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin')) && (
                  <button
                    id="accountal-new-receipt-btn"
                    onClick={handleOpenAddReceiptModal}
                    className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-black transition-all shadow-xs cursor-pointer active:scale-95 mr-1"
                    title="Log New Material Receipt (नया रसीद दर्ज करें)"
                  >
                    <Plus size={14} />
                    <span>+ New Receipt</span>
                  </button>
                )}
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  title="Export Accountal Register to Excel"
                >
                  <Download size={13} className="text-emerald-600" />
                  Export Excel
                </button>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  title="Download Accountal Register PDF"
                >
                  <FileText size={13} className="text-indigo-600" />
                  Export PDF
                </button>
              </div>
            </div>

            {/* ACCOUNTAL REGISTER TABLE */}
            <div className="flex-grow overflow-auto">
              {filteredRegisterItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                    <PackageCheck size={26} />
                  </div>
                  <h3 className="text-sm font-bold text-slate-700">No Accountal Items Found</h3>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Items demanded by you and issued from depot will appear here ready to be received into your stock.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10 text-[11px] text-slate-600 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4 whitespace-nowrap">DATE</th>
                      <th className="py-3 px-4 whitespace-nowrap">DEMAND NO</th>
                      <th className="py-3 px-4 whitespace-nowrap">PL & PART NO</th>
                      <th className="py-3 px-4">DESCRIPTION</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">DEMAND QTY</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">ISSUING QTY</th>
                      <th className="py-3 px-4 whitespace-nowrap">ISSUING COMPANY / DEPOT</th>
                      <th className="py-3 px-4 whitespace-nowrap">ISSUE VOUCHER NO</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {paginatedRegisterItems.map((item) => (
                      <tr key={item.id} className={cn("transition-colors", item.canReceive ? "bg-amber-50/20 hover:bg-amber-50/50" : "hover:bg-slate-50/80")}>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                          {item.date}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {item.demandNo ? (
                            <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[11px] block w-fit border border-indigo-100">
                              {item.demandNo}
                            </span>
                          ) : (
                            <span className="font-mono text-slate-400 text-[11px] block">-</span>
                          )}
                          {item.demandedBy && (
                            <span className="text-[10px] text-slate-400 block mt-0.5 max-w-[120px] truncate" title={item.demandedBy}>
                              By: {item.demandedBy}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-black text-slate-900 block">{item.plNo || '-'}</span>
                          <span className="font-mono text-slate-400 text-[10px] block">{item.partNo || '-'}</span>
                        </td>
                        <td className="py-3 px-4 max-w-xs truncate" title={item.description}>
                          <span className="font-semibold text-slate-800 block truncate">{item.description}</span>
                          {item.remarks && (
                            <span className="text-[10px] text-slate-400 truncate block italic">"{item.remarks}"</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap font-mono font-bold text-slate-800">
                          <span className="inline-block bg-slate-100 px-2.5 py-0.5 rounded text-xs">
                            {item.demandedQty || item.qty} {item.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded text-xs border border-emerald-200 inline-block">
                            {item.issuingQty || item.qty} {item.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-block font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {item.issuingCompanyDepot || item.receivedFrom || 'Depot'}
                          </span>
                          {item.machineName && (
                            <span className="text-[10px] text-slate-400 block mt-0.5">For: {item.machineName}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-bold text-slate-800 bg-amber-50 px-2 py-0.5 rounded text-[11px] block w-fit border border-amber-200">
                            {item.issueVoucherNo || item.voucherNo}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {item.canReceive ? (
                              <button
                                id={`btn-receive-${item.id}`}
                                onClick={() => handleOpenReceiveModal(item)}
                                disabled={hasAssignedMachine && Boolean(item.machineName) && item.machineName.trim().toLowerCase() !== assignedMachine.toLowerCase()}
                                className={cn(
                                  "inline-flex items-center gap-1.5 font-black text-xs px-3.5 py-1.5 rounded-xl shadow-sm transition-all whitespace-nowrap",
                                  hasAssignedMachine && Boolean(item.machineName) && item.machineName.trim().toLowerCase() !== assignedMachine.toLowerCase()
                                    ? "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 shadow-none opacity-60"
                                    : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white shadow-emerald-600/25 cursor-pointer"
                                )}
                                title={hasAssignedMachine && Boolean(item.machineName) && item.machineName.trim().toLowerCase() !== assignedMachine.toLowerCase()
                                  ? `Item belongs to ${item.machineName}. Only assigned machine can receive.`
                                  : "Click to receive this demanded item into stock"
                                }
                              >
                                <PackageCheck size={15} />
                                Received
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 size={13} />
                                <span>Received</span>
                              </span>
                            )}
                            <button
                              onClick={() => setViewItem(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-900 border border-indigo-200/80 rounded-xl transition-all shadow-2xs cursor-pointer active:scale-95"
                              title="Preview Receipt Record (पूर्वावलोकन एवं विवरण देखें)"
                            >
                              <Eye size={14} className="text-indigo-600" />
                              <span>Preview</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Controls (10 rows per page with Previous / Next) */}
            {filteredRegisterItems.length > 0 && (
              <ReportPagination
                currentPage={registerCurrentPage}
                totalPages={registerTotalPages}
                totalItems={filteredRegisterItems.length}
                pageSize={pageSize}
                onPageChange={setRegisterCurrentPage}
              />
            )}
          </div>
        ) : (
          /* UNCONNECTED MATERIAL RECEIPTS CONTAINER */
          <div className="flex flex-col h-full overflow-hidden">
            {/* Table Header Banner with Title & Export Options */}
            <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <Boxes size={14} />
                </div>
                <h2 className="text-xs font-black uppercase text-slate-800 tracking-wide">
                  Unconnected Material Receipts Register
                </h2>
                <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                  {filteredUnconnectedReceipts.length} records
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={exportUnconnectedReceiptsExcel}
                  className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  title="Export Unconnected Material Receipts to Excel"
                >
                  <Download size={13} className="text-emerald-600" />
                  Export Excel
                </button>
                <button
                  onClick={exportUnconnectedReceiptsPDF}
                  className="flex items-center gap-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  title="Export Unconnected Material Receipts to PDF"
                >
                  <FileText size={13} className="text-indigo-600" />
                  Export PDF
                </button>
              </div>
            </div>

            {/* UNCONNECTED MATERIAL RECEIPTS TABLE */}
            <div className="flex-grow overflow-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10 text-[11px] text-slate-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4 whitespace-nowrap">Sr No.</th>
                  <th className="py-3 px-4 whitespace-nowrap">Voucher No</th>
                  <th className="py-3 px-4 whitespace-nowrap">Returned Date</th>
                  <th className="py-3 px-4 whitespace-nowrap">Zone / Division</th>
                  <th className="py-3 px-4 whitespace-nowrap">Machine</th>
                  <th className="py-3 px-4 whitespace-nowrap">Company</th>
                  <th className="py-3 px-4 whitespace-nowrap">Part No / PL No</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 whitespace-nowrap">Returned Qty (Transaction Qty)</th>
                  <th className="py-3 px-4 whitespace-nowrap">Storage Location</th>
                  <th className="py-3 px-4">Remarks</th>
                  {!hideUnconnectedActions && (
                    <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {paginatedUnconnectedReceipts.map((r, index) => {
                  const serialNo = (unconnectedCurrentPage - 1) * pageSize + index + 1;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 text-xs font-bold text-slate-500">{serialNo}</td>
                      <td 
                        className="py-3 px-4 cursor-pointer"
                        onClick={() => handlePreviewUnconnected(r)}
                        title="Click to preview receipt details (विवरण एवं पूर्वावलोकन देखें)"
                      >
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded text-[11px] block w-fit border border-indigo-100 transition-colors">
                          {r.voucherNo || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 font-bold">
                        {r.returnedDate ? format(new Date(r.returnedDate), 'dd-MM-yyyy') : '-'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">{r.zone || '-'}</span>
                          <span className="text-[10px] text-slate-400">{r.division || '-'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-bold text-indigo-700">{r.machineName || '-'}</td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold text-slate-700">{r.companyName || '-'}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">Part: {r.partNo || '-'}</span>
                          <span className="text-[10px] text-slate-500 font-mono">PL: {r.plNo || '-'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate" title={r.description}>
                        <span className="font-semibold text-slate-800 block truncate">{r.description || '-'}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-full">
                            {r.qtyReturned} {r.unit || 'Nos'}
                          </span>
                          <span className="text-[10px] text-slate-400">Total Count: {r.transactionQty}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-700">{r.location || '-'}</td>
                      <td className="py-3 px-4 max-w-xs truncate" title={r.remarks}>
                        <span className="text-slate-500 italic truncate block">{r.remarks || '-'}</span>
                      </td>
                      {!hideUnconnectedActions && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handlePreviewUnconnected(r)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-900 border border-indigo-200/80 rounded-xl transition-all shadow-2xs cursor-pointer active:scale-95"
                              title="Preview Receipt Record (पूर्वावलोकन देखें)"
                            >
                              <Eye size={14} className="text-indigo-600" />
                              <span>Preview</span>
                            </button>
                            {isPrimaryAdmin || isCompanyAdmin ? (
                              <>
                                <button
                                  onClick={() => handleOpenEditReceipt(r)}
                                  className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer"
                                  title="Edit Receipt Record"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteReceipt(r.id)}
                                  className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer"
                                  title="Delete Receipt Record"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredUnconnectedReceipts.length === 0 && (
                  <tr>
                    <td colSpan={hideUnconnectedActions ? 11 : 12} className="text-center py-12 text-sm text-slate-400 font-bold">
                      <div className="flex flex-col items-center justify-center">
                        <Boxes size={28} className="text-slate-300 mb-2" />
                        <span>No unconnected material receipts logged yet.</span>
                        {!(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin')) && (
                          <button
                            onClick={handleOpenAddReceiptModal}
                            className="mt-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                          >
                            <Plus size={14} /> Log your first unconnected receipt
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls (10 rows per page with Previous / Next) */}
          {filteredUnconnectedReceipts.length > 0 && (
            <ReportPagination
              currentPage={unconnectedCurrentPage}
              totalPages={unconnectedTotalPages}
              totalItems={filteredUnconnectedReceipts.length}
              pageSize={pageSize}
              onPageChange={setUnconnectedCurrentPage}
            />
          )}
        </div>
      )}
    </div>

      {/* RECEIVE ITEM MODAL (LANDSCAPE) */}
      <AnimatePresence>
        {showReceiveModal && selectedItemToReceive && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
            >
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-5 text-white flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded">
                    TAKE ON ACCOUNT / प्राप्ति अभिलेख
                  </span>
                  <h3 className="text-lg font-black mt-1">Receive Item & Add to Stock</h3>
                  <p className="text-xs text-white/80 flex flex-wrap items-center gap-2 mt-0.5">
                    <span>Demand: <strong>{selectedItemToReceive.demandNo || selectedItemToReceive.voucherNo || '-'}</strong></span>
                    <span>•</span>
                    <span>Demand Date: <strong className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-white">{(() => {
                      const rawD = selectedItemToReceive.demandDate || selectedItemToReceive.rawDemand?.date || selectedItemToReceive.rawDemand?.demandDate || selectedItemToReceive.date || selectedItemToReceive.rawDemand?.createdAt;
                      if (!rawD) return '-';
                      try {
                        return rawD.includes('T') ? format(new Date(rawD), 'dd-MM-yyyy') : rawD.slice(0, 10);
                      } catch {
                        return rawD.slice(0, 10);
                      }
                    })()}</strong></span>
                    <span>•</span>
                    <span>Issue No: <strong className="font-mono bg-white/20 px-1.5 py-0.5 rounded text-white">{selectedItemToReceive.issueVoucherNo || selectedItemToReceive.voucherNo || selectedItemToReceive.rawDemand?.issueNoteNo || selectedItemToReceive.rawDemand?.issueVoucherNo || '-'}</strong></span>
                  </p>
                </div>
                <button 
                  onClick={() => setShowReceiveModal(false)}
                  className="p-1 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handlePreSubmitReceive} className="p-6 overflow-y-auto space-y-4">
                {/* Item Summary Box (Wide Landscape) */}
                <div className="bg-emerald-50/80 border border-emerald-100 p-4 rounded-2xl text-xs text-slate-700">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200/60 pb-2.5 mb-2.5">
                    <div>
                      <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">Item Description</span>
                      <div className="font-extrabold text-emerald-950 text-sm">{selectedItemToReceive.description}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold px-2.5 py-1 bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-lg flex items-center gap-1 font-mono">
                        <span className="text-[9px] uppercase font-sans font-black text-indigo-700">Issue No:</span>
                        {selectedItemToReceive.issueVoucherNo || selectedItemToReceive.voucherNo || selectedItemToReceive.rawDemand?.issueNoteNo || selectedItemToReceive.rawDemand?.issueVoucherNo || '-'}
                      </span>
                      <span className="text-[11px] font-bold px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg">
                        Pending: <strong>{selectedItemToReceive.pendingQty || selectedItemToReceive.qty} {selectedItemToReceive.unit}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-[11px] text-slate-600 font-mono">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Issue No. / वाउचर नं.</span>
                      <strong className="text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-100 block w-fit truncate">
                        {selectedItemToReceive.issueVoucherNo || selectedItemToReceive.voucherNo || selectedItemToReceive.rawDemand?.issueNoteNo || selectedItemToReceive.rawDemand?.issueVoucherNo || '-'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Demand Date / मांग दिनांक</span>
                      <strong className="text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded border border-emerald-200 block w-fit">
                        {(() => {
                          const rawD = selectedItemToReceive.demandDate || selectedItemToReceive.rawDemand?.date || selectedItemToReceive.rawDemand?.demandDate || selectedItemToReceive.date || selectedItemToReceive.rawDemand?.createdAt;
                          if (!rawD) return '-';
                          try {
                            return rawD.includes('T') ? format(new Date(rawD), 'dd-MM-yyyy') : rawD.slice(0, 10);
                          } catch {
                            return rawD.slice(0, 10);
                          }
                        })()}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">PL No.</span>
                      <strong className="text-slate-800">{selectedItemToReceive.plNo || '-'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Part No.</span>
                      <strong className="text-slate-800">{selectedItemToReceive.partNo || '-'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Issuing Depot</span>
                      <strong className="text-slate-800">{selectedItemToReceive.receivedFrom || 'Depot'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Target Machine</span>
                      <strong className="text-slate-800">{selectedItemToReceive.machineName || userMachine || 'Depot'}</strong>
                    </div>
                  </div>
                </div>

                {/* 2-Column Landscape Body */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                  {/* Left Column: Receipt Parameters */}
                  <div className="space-y-4 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                      <Layers size={13} className="text-emerald-600" />
                      Receipt Details
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                          Receive Qty *
                        </label>
                        <input
                          type="number"
                          value={receiveQty}
                          disabled
                          readOnly
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-500 font-mono cursor-not-allowed select-none focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                          Receive Date *
                        </label>
                        <input
                          type="date"
                          value={receiveDate}
                          onChange={(e) => setReceiveDate(e.target.value)}
                          required
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono shadow-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                          Rate (₹ / Unit)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={receiveRate}
                          disabled
                          readOnly
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-500 font-mono cursor-not-allowed select-none focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                          Item Condition (As Issued by Depot)
                        </label>
                        <select
                          value={receiveCondition}
                          disabled
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700 cursor-not-allowed select-none shadow-sm opacity-95"
                          title="Item condition as issued by Issuing Depot (डिपो द्वारा जारी स्थिति)"
                        >
                          <option value={receiveCondition}>{receiveCondition} (As Issued by Depot)</option>
                          <option value="New">✨ New / नया</option>
                          <option value="Serviceable">🛠️ Serviceable / सर्विस-योग्य</option>
                          <option value="Released">♻️ Released / रिलीज़्ड</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Inventory Search & Ledger Details */}
                  <div className="space-y-4 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Boxes size={13} className="text-emerald-600" />
                        Inventory & Ledger Linking
                      </span>
                      {selectedInventoryPart ? (
                        <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 size={10} /> Matched
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-medium">Auto-match / Search</span>
                      )}
                    </div>

                    {/* Search PL No / Item Code / Folio Name / Description */}
                    <div className="relative">
                      <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                        Search PL No / Item Code / Folio Name / Description
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search PL No / Item Code / Folio Name / Description"
                          value={receiveSearchQuery}
                          onChange={(e) => handleReceiveSearchChange(e.target.value)}
                          onFocus={() => setShowSearchDropdown(true)}
                          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                        />
                        <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                        {receiveSearchQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              setReceiveSearchQuery('');
                              setSelectedInventoryPart(null);
                              setShowSearchDropdown(false);
                            }}
                            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      {/* Dropdown Suggestions with full item details */}
                      {showSearchDropdown && matchingInventoryParts.length > 0 && (
                        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-100">
                          {matchingInventoryParts.map(part => (
                            <div
                              key={part.id}
                              onMouseDown={() => handleSelectInventoryPart(part)}
                              className="p-3 hover:bg-emerald-50 cursor-pointer text-xs transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-extrabold text-slate-900">{part.description || part.partNo}</span>
                                {part.stock !== undefined && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0 font-mono">
                                    Stock: {part.stock} {part.unit || ''}
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1 text-[10px] text-slate-500 mt-1.5 font-mono">
                                <span>PL: <strong className="text-slate-800">{part.plNo || '-'}</strong></span>
                                <span>Part: <strong className="text-slate-800">{part.partNo || '-'}</strong></span>
                                <span>Folio: <strong className="text-indigo-600">{part.folioName || part.ledgerFolioNo || '-'}</strong></span>
                                <span>Loc: <strong className="text-emerald-700">{part.location || '-'}</strong></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Full Item Details Display Card */}
                      {selectedInventoryPart ? (
                        <div className="mt-2.5 p-3 bg-emerald-50/90 border border-emerald-200 rounded-2xl space-y-2">
                          <div className="flex items-center justify-between border-b border-emerald-200/70 pb-1.5">
                            <span className="text-[11px] font-black uppercase text-emerald-950 flex items-center gap-1.5">
                              <CheckCircle2 size={13} className="text-emerald-600" />
                              Inventory Item Full Details / इन्वेंटरी पूर्ण विवरण
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-mono">
                              Stock: {selectedInventoryPart.stock !== undefined ? selectedInventoryPart.stock : '-'} {selectedInventoryPart.unit || ''}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            <div>
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">PL No.</span>
                              <strong className="text-slate-800 font-mono">{selectedInventoryPart.plNo || '-'}</strong>
                            </div>
                            <div>
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Part No.</span>
                              <strong className="text-slate-800 font-mono">{selectedInventoryPart.partNo || '-'}</strong>
                            </div>
                            <div>
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Folio No / Name</span>
                              <strong className="text-indigo-700 font-mono">{selectedInventoryPart.folioName || selectedInventoryPart.ledgerFolioNo || '-'}</strong>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Item Description</span>
                              <span className="font-semibold text-slate-800 text-xs block leading-tight">{selectedInventoryPart.description || '-'}</span>
                            </div>
                            <div>
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Storage Location</span>
                              <strong className="text-emerald-800">{selectedInventoryPart.location || '-'}</strong>
                            </div>
                            <div>
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Unit / Condition</span>
                              <strong className="text-slate-700">{selectedInventoryPart.unit || 'Nos'} • {selectedInventoryPart.itemCondition || selectedInventoryPart.condition || 'New'}</strong>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[9px] uppercase font-bold text-slate-400 block">Machine / Depot</span>
                              <strong className="text-slate-700 truncate block">{selectedInventoryPart.machineName || userMachine || 'Depot'}</strong>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2.5 p-2.5 bg-slate-100/70 border border-dashed border-slate-200 rounded-xl text-[11px] text-slate-500 flex items-center gap-1.5">
                          <Boxes size={13} className="text-slate-400 shrink-0" />
                          <span>Type PL No, Part No, or Description to auto-fill inventory and view full item details.</span>
                        </div>
                      )}
                    </div>

                    {/* Storage Location (auto-filled on search match, editable) */}
                    <div>
                      <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                        Storage Location
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Bin 4A, Rack 2"
                        value={receiveLocation}
                        onChange={(e) => setReceiveLocation(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                      />
                    </div>

                    {/* Ledger Folio No. (Dropdown of machine folios), Ledger Folio PL/Item No. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wide block mb-1">
                          Ledger Folio No.
                        </label>
                        <select
                          value={receiveLedgerFolioNo}
                          disabled={Boolean(receiveLedgerFolioNo || selectedInventoryPart)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setReceiveLedgerFolioNo(val);
                            const matchedPart = machineInventoryParts.find(p => (p.folioName || p.ledgerFolioNo) === val);
                            if (matchedPart) {
                              if (matchedPart.location) setReceiveLocation(matchedPart.location);
                              const plPart = matchedPart.ledgerFolioPl || matchedPart.plNo || matchedPart.partNo || selectedItemToReceive?.plNo || selectedItemToReceive?.partNo || '';
                              const desc = matchedPart.description || selectedItemToReceive?.description || '';
                              setReceiveLedgerFolioPl(plPart && desc && !plPart.includes(desc) ? `${plPart} - ${desc}` : (plPart || desc));
                            }
                          }}
                          className={`w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold font-mono shadow-sm ${
                            (receiveLedgerFolioNo || selectedInventoryPart) ? 'bg-slate-100 cursor-not-allowed text-slate-700 opacity-95' : 'bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500'
                          }`}
                        >
                          <option value="">-- Select Folio ({machineFolios.length}) --</option>
                          {machineFolios.map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                          {receiveLedgerFolioNo && !machineFolios.includes(receiveLedgerFolioNo) && (
                            <option value={receiveLedgerFolioNo}>{receiveLedgerFolioNo}</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wide block mb-1 truncate" title={`PL No. - ${selectedItemToReceive.description || selectedItemToReceive.partNo || 'Item Name'}`}>
                          PL No. - {selectedItemToReceive.description || selectedItemToReceive.partNo || 'Item Name'}
                        </label>
                        <input
                          type="text"
                          placeholder="PL No. - Item Name"
                          value={receiveLedgerFolioPl}
                          onChange={(e) => setReceiveLedgerFolioPl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Receipt Remarks / Observations */}
                <div>
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block mb-1">
                    Receipt Remarks / Observations
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter any remarks, package condition, verification notes..."
                    value={receiveRemarks}
                    onChange={(e) => setReceiveRemarks(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none shadow-sm"
                  />
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowReceiveModal(false)}
                    className="flex-1 sm:flex-initial sm:px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReceive}
                    className="flex-1 py-2.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
                  >
                    <PackageCheck size={16} />
                    {submittingReceive ? 'Processing...' : 'Confirm Receipt & Take On Account'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WARNING DIALOG MODAL (PL / PART NO MISMATCH) */}
      <AnimatePresence>
        {showReceiveWarningDialog && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-amber-200 overflow-hidden"
            >
              <div className="bg-amber-500 text-white p-4 flex items-center gap-3">
                <AlertTriangle size={24} className="shrink-0" />
                <div>
                  <h4 className="font-black text-sm">Warning: Item Mismatch</h4>
                  <p className="text-[11px] text-amber-100">Please review inventory linking</p>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {warningMessage}
                </p>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowReceiveWarningDialog(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleWarningOk}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  OK / Proceed
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RECEIPT CONFIRMATION DIALOG MODAL */}
      <AnimatePresence>
        {showReceiveConfirmDialog && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-emerald-200 overflow-hidden"
            >
              <div className="bg-emerald-600 text-white p-4 flex items-center gap-3">
                <PackageCheck size={24} className="shrink-0" />
                <div>
                  <h4 className="font-black text-sm">Receipt Confirmation</h4>
                  <p className="text-[11px] text-emerald-100">Take material on account</p>
                </div>
              </div>
              <div className="p-6 text-center space-y-2">
                <p className="text-sm font-bold text-slate-800">
                  Do you want to received {receiveQty} {selectedItemToReceive?.unit || selectedItemToReceive?.rawDemand?.unit || 'Nos'}?
                </p>
                <p className="text-xs text-slate-500">
                  Click OK to receive this item into stock and complete accountal.
                </p>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowReceiveConfirmDialog(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingReceive}
                  onClick={handleConfirmReceive}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md transition-all active:scale-95 disabled:opacity-75 cursor-pointer"
                >
                  {submittingReceive ? 'Processing...' : 'OK'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* VIEW RECEIPT DETAILS MODAL */}
      <AnimatePresence>
        {viewItem && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            >
              <div className="bg-slate-900 p-5 text-white flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-white/10 px-2 py-0.5 rounded text-indigo-300">
                    RECEIPT VOUCHER RECORD
                  </span>
                  <h3 className="text-lg font-black mt-1">{viewItem.voucherNo}</h3>
                  <p className="text-xs text-slate-400">Accounted on: {viewItem.date}</p>
                </div>
                <button 
                  onClick={() => setViewItem(null)}
                  className="p-1 rounded-xl text-slate-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-400 uppercase">Item Description</span>
                  <p className="font-bold text-slate-900 text-sm">{viewItem.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">PL NUMBER</span>
                    <span className="font-mono font-bold text-slate-800">{viewItem.plNo || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">PART NUMBER</span>
                    <span className="font-mono font-bold text-slate-800">{viewItem.partNo || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">QUANTITY</span>
                    <span className="font-black text-emerald-700">
                      {viewItem.receivedQty || viewItem.qty} {viewItem.unit}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">RATE / TOTAL</span>
                    <span className="font-mono font-bold text-slate-800">
                      ₹{viewItem.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Depot / Machine:</span>
                    <span className="font-bold text-slate-800">{viewItem.machineName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Demanded By:</span>
                    <span className="font-semibold text-slate-700">{viewItem.demandedBy || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Received By:</span>
                    <span className="font-semibold text-slate-700">{viewItem.receivedBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Supplied / Issued From:</span>
                    <span className="font-semibold text-slate-700">{viewItem.receivedFrom}</span>
                  </div>
                  {viewItem.location && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Storage Location:</span>
                      <span className="font-mono font-semibold text-slate-700">{viewItem.location}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Condition:</span>
                    <span className="font-bold text-slate-800">{viewItem.itemCondition || 'New'}</span>
                  </div>
                  {viewItem.remarks && (
                    <div className="pt-2 border-t border-slate-100">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Remarks:</span>
                      <p className="text-slate-600 italic mt-0.5">"{viewItem.remarks}"</p>
                    </div>
                  )}
                </div>

                <div className="pt-3">
                  <button
                    onClick={() => setViewItem(null)}
                    className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
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
              <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h2 className="text-lg font-extrabold text-indigo-900">Unconnected Material Receipt</h2>
                <button 
                  onClick={() => setShowAddReceiptModal(false)} 
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveReceipt} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Voucher No. */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Voucher No.</label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed select-none"
                      placeholder=""
                      value={receiptForm.voucherNo}
                    />
                  </div>

                  {/* Returned Date */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Returned Date</label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.returnedDate}
                      onChange={e => setReceiptForm(prev => ({ ...prev, returnedDate: e.target.value }))}
                    />
                  </div>

                  {/* Machine Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Machine Name</label>
                    <select
                      required
                      disabled={hasAssignedMachine}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                      value={hasAssignedMachine ? assignedMachine : receiptForm.machineName}
                      onChange={e => handleMachineNameChange(e.target.value)}
                    >
                      {hasAssignedMachine ? (
                        <option value={assignedMachine}>{assignedMachine}</option>
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
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      Company Name
                    </label>
                    <select
                      required
                      disabled={!!receiptForm.machineName}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-500"
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
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Zone</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={receiptForm.zone}
                    />
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Division</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={receiptForm.division}
                    />
                  </div>

                  {/* Part No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Part No.</label>
                    <input
                      list="partNo-options-accountal"
                      type="text"
                      required
                      placeholder="Type or select Part No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.partNo}
                      onChange={e => handlePartNoChange(e.target.value)}
                    />
                    <datalist id="partNo-options-accountal">
                      {availablePartsForReceipt.map((p: any) => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* PL No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">PL No.</label>
                    <input
                      list="plNo-options-accountal"
                      type="text"
                      placeholder="Type or select PL No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={receiptForm.plNo}
                      onChange={e => handlePlNoChange(e.target.value)}
                    />
                    <datalist id="plNo-options-accountal">
                      {availablePartsForReceipt.filter((p: any) => p.plNo).map((p: any) => (
                        <option key={p.id} value={p.plNo}>{p.plNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* Part Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter part description..."
                      value={receiptForm.description}
                      onChange={e => setReceiptForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700"
                      placeholder="e.g. Rack A1"
                      value={receiptForm.location}
                      onChange={e => setReceiptForm(prev => ({ ...prev, location: e.target.value }))}
                    />
                  </div>

                  {/* Old Qty (Current Stock) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Old Qty (Current Stock)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={(() => {
                        const activeMachine = receiptForm.employeeId 
                          ? (employeeList.find(e => e.id === receiptForm.employeeId || e.pfNo === receiptForm.employeeId)?.machineName || receiptForm.machineName || '')
                          : (receiptForm.machineName || '');
                        const matchedPart = allParts.find((p: any) => {
                          const matchMach = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
                          const matchPart = (receiptForm.partNo && p.partNo?.trim().toLowerCase() === receiptForm.partNo.trim().toLowerCase()) ||
                                            (receiptForm.plNo && p.plNo?.trim().toLowerCase() === receiptForm.plNo.trim().toLowerCase());
                          return matchMach && matchPart;
                        });
                        return matchedPart ? (matchedPart.stock || 0) : 0;
                      })()}
                    />
                  </div>

                  {/* Quantity Returned */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Quantity Returned</label>
                    <input
                      type="number"
                      required
                      min={1}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700"
                      value={receiptForm.qtyReturned || ''}
                      onChange={e => setReceiptForm(prev => ({ ...prev, qtyReturned: Number(e.target.value) }))}
                    />
                  </div>

                  {/* Unit of Measure */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Unit of Measure</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
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
                        className="w-full mt-2 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-800 bg-amber-50/50"
                        value={receiptForm.customUnit}
                        onChange={e => setReceiptForm(prev => ({ ...prev, customUnit: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Transaction Qty (Disabled, read-only showing total count) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Transaction Qty (Total Count)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={receiptForm.qtyReturned || 0}
                    />
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Remarks</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 font-medium"
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
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={receiptSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white font-bold shadow-md shadow-indigo-600/20 hover:shadow-indigo-600/30 transition-all text-sm disabled:opacity-50 cursor-pointer"
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
              <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h2 className="text-lg font-extrabold text-indigo-900">Edit Unconnected Material Receipt</h2>
                <button 
                  onClick={() => setShowEditReceiptModal(false)} 
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleUpdateReceipt} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Voucher No. */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Voucher No.</label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      placeholder=""
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono font-bold text-slate-600 bg-slate-100 cursor-not-allowed select-none"
                      value={editReceiptForm.voucherNo}
                    />
                  </div>

                  {/* Returned Date */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Returned Date</label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.returnedDate}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, returnedDate: e.target.value }))}
                    />
                  </div>

                  {/* Machine Name */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Machine Name</label>
                    <select
                      required
                      disabled={hasAssignedMachine}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                      value={hasAssignedMachine ? assignedMachine : editReceiptForm.machineName}
                      onChange={e => handleEditMachineNameChange(e.target.value)}
                    >
                      {hasAssignedMachine ? (
                        <option value={assignedMachine}>{assignedMachine}</option>
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
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      Company Name
                    </label>
                    <select
                      required
                      disabled={!!editReceiptForm.machineName}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-500"
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
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Zone</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={editReceiptForm.zone}
                    />
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Division</label>
                    <input
                      type="text"
                      disabled
                      placeholder="Select Date & Machine to auto-fill"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-bold text-slate-700"
                      value={editReceiptForm.division}
                    />
                  </div>

                  {/* Part No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Part No.</label>
                    <input
                      list="editPartNo-options-accountal"
                      type="text"
                      required
                      placeholder="Type or select Part No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.partNo}
                      onChange={e => handleEditPartNoChange(e.target.value)}
                    />
                    <datalist id="editPartNo-options-accountal">
                      {availablePartsForEditReceipt.map((p: any) => (
                        <option key={p.id} value={p.partNo}>{p.partNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* PL No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">PL No.</label>
                    <input
                      list="editPlNo-options-accountal"
                      type="text"
                      placeholder="Type or select PL No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={editReceiptForm.plNo}
                      onChange={e => handleEditPlNoChange(e.target.value)}
                    />
                    <datalist id="editPlNo-options-accountal">
                      {availablePartsForEditReceipt.filter((p: any) => p.plNo).map((p: any) => (
                        <option key={p.id} value={p.plNo}>{p.plNo} - {p.description}</option>
                      ))}
                    </datalist>
                  </div>

                  {/* Part Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 font-medium"
                      placeholder="Enter part description..."
                      value={editReceiptForm.description}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700"
                      placeholder="e.g. Rack A1"
                      value={editReceiptForm.location}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, location: e.target.value }))}
                    />
                  </div>

                  {/* Old Qty (Current Stock) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Old Qty (Current Stock)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={(() => {
                        const activeMachine = editReceiptForm.employeeId 
                          ? (employeeList.find(e => e.id === editReceiptForm.employeeId || e.pfNo === editReceiptForm.employeeId)?.machineName || editReceiptForm.machineName || '')
                          : (editReceiptForm.machineName || '');
                        const matchedPart = allParts.find((p: any) => {
                          const matchMach = !activeMachine || (p.machineName && p.machineName.trim().toLowerCase() === activeMachine.trim().toLowerCase());
                          const matchPart = (editReceiptForm.partNo && p.partNo?.trim().toLowerCase() === editReceiptForm.partNo.trim().toLowerCase()) ||
                                            (editReceiptForm.plNo && p.plNo?.trim().toLowerCase() === editReceiptForm.plNo.trim().toLowerCase());
                          return matchMach && matchPart;
                        });
                        return matchedPart ? (matchedPart.stock || 0) : 0;
                      })()}
                    />
                  </div>

                  {/* Quantity Returned */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Quantity Returned</label>
                    <input
                      type="number"
                      required
                      min={1}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700"
                      value={editReceiptForm.qtyReturned || ''}
                      onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, qtyReturned: Number(e.target.value) }))}
                    />
                  </div>

                  {/* Unit of Measure */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Unit of Measure</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-700 bg-white"
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
                        className="w-full mt-2 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-800 bg-amber-50/50"
                        value={editReceiptForm.customUnit}
                        onChange={e => setEditReceiptForm((prev: any) => ({ ...prev, customUnit: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Transaction Qty (Disabled, read-only showing total count) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Transaction Qty (Total Count)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800"
                      value={editReceiptForm.qtyReturned || 0}
                    />
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Remarks</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 font-medium"
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
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={receiptSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white font-bold shadow-md shadow-indigo-600/20 hover:shadow-indigo-600/30 transition-all text-sm disabled:opacity-50 cursor-pointer"
                  >
                    {receiptSubmitting ? "Updating..." : "Update Receipt"}
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
