import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { 
  Store as StoreIcon, Plus, Search, Filter, Download, FileText, Edit, Edit2, Lock, Trash2, X, 
  Send, Package, Building2, Layers, AlertCircle, CheckCircle2, RefreshCw, ChevronLeft, ChevronRight, UserCheck, TrendingUp, Eye
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { findEmployeeForUser } from '../utils/employee';
import { generateIssueNotePDF } from '../utils/pdfGenerator';
import { archiveDeletedRecord } from '../utils/recycleBin';
import StoreItemHistoryModal from '../components/StoreItemHistoryModal';
import StoreEditIssueModal from '../components/StoreEditIssueModal';

interface StoreItem {
  id: string;
  plNo?: string;
  description: string;
  partNo?: string;
  category: string;
  unit: string;
  stock: number;
  rate: number;
  totalValue: number;
  location?: string;
  companyName: string;
  itemCondition: 'New' | 'Serviceable' | 'Released';
  remarks?: string;
  createdAt?: string;
  createdBy?: string;
  initialStock?: number;
  oldStock?: number;
  transactionCount?: number;
  hasTransactions?: boolean;
}

interface StoreIssueRecord {
  id: string;
  issueNoteNo: string;
  storeItemId?: string;
  plNo?: string;
  partNo?: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  totalValue: number;
  issuingCompany: string;
  targetType: 'machine' | 'company';
  targetMachine?: string;
  targetCompany?: string;
  receiverName: string;
  receiverDesignation?: string;
  issuedBy: string;
  officerDesignation?: string;
  date: string;
  remarks?: string;
  createdAt?: string;
}

export default function Store() {
  const [activeTab, setActiveTab] = useState<'inventory' | 'history'>('inventory');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [issueRecords, setIssueRecords] = useState<StoreIssueRecord[]>([]);

  // User details
  const [currentEmployee, setCurrentEmployee] = useState<any>(null);
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [userAccessType, setUserAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  });
  const [userCompanyName, setUserCompanyName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) || '' : '';
  });

  // Machine & Company lists for dropdowns
  const [machinesList, setMachinesList] = useState<string[]>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');

  // Pagination for Store Tables (10 rows per page)
  const [inventoryPage, setInventoryPage] = useState(1);
  const inventoryPageSize = 10;
  const [issuePage, setIssuePage] = useState(1);
  const issuePageSize = 10;

  const STANDARD_STORE_UOMS = ["Nos", "Sets", "Mtr", "Kg", "Ltr", "Pairs", "Box", "Pkt", "Roll", "Foot", "Quintal", "Other"];
  const STANDARD_STORE_CATEGORIES = ["Spare Parts", "Mechanical", "Electrical", "Hydraulic", "Consumables", "Tools", "General", "Other"];

  // Catalog parts for auto-filling item details
  const [catalogParts, setCatalogParts] = useState<any[]>([]);
  const [autoMatchedInfo, setAutoMatchedInfo] = useState<string | null>(null);

  // Modals
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedItemToIssue, setSelectedItemToIssue] = useState<StoreItem | null>(null);

  // Form states for Store Item
  const [itemForm, setItemForm] = useState({
    plNo: '',
    description: '',
    partNo: '',
    category: 'Spare Parts',
    customCategory: '',
    unit: 'Nos',
    customUnit: '',
    stock: '1' as string | number,
    rate: '0' as string | number,
    location: '',
    itemCondition: 'New' as 'New' | 'Serviceable' | 'Released',
    remarks: ''
  });

  // Form states for Issue
  const [issueForm, setIssueForm] = useState({
    plNo: '',
    partNo: '',
    qty: 1,
    targetType: 'machine' as 'machine' | 'company',
    targetMachine: '',
    targetCompany: '',
    receiverName: '',
    receiverDesignation: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    remarks: ''
  });

  const isNaOrEmpty = (val?: string) => {
    if (!val) return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'n/a' || clean === 'na' || clean === 'nil' || clean === '-' || clean === 'none';
  };
  const [submittingIssue, setSubmittingIssue] = useState(false);

  // Employee list and Machine positions mapping
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});

  // Connected Materials modal & form state
  const [showConnectedModal, setShowConnectedModal] = useState(false);
  const [connectedSubmitting, setConnectedSubmitting] = useState(false);
  const [connectedForm, setConnectedForm] = useState({
    voucherNo: '',
    returnedDate: format(new Date(), 'yyyy-MM-dd'),
    machineName: '',
    companyName: '',
    zone: '',
    division: '',
    partNo: '',
    plNo: '',
    description: '',
    location: '',
    qtyReturned: '1' as string | number,
    unit: 'Nos',
    customUnit: '',
    remarks: '',
    selectedStoreItemId: ''
  });

  const isAssignedToMachine = Boolean(
    isEmployee &&
    currentEmployee?.machineName &&
    currentEmployee.machineName.trim() !== '' &&
    currentEmployee.machineName.toLowerCase() !== 'all' &&
    currentEmployee.machineName.toLowerCase() !== 'none' &&
    currentEmployee.machineName.toLowerCase() !== 'n/a'
  );
  const isReadOnlyAdmin = isEmployee && (userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');
  const isRestrictedAdmin = userAccessType === 'divisional-admin' || userAccessType === 'zonal-admin';
  const isAdminLight = Boolean(
    isEmployee && (
      userAccessType === 'admin-light' ||
      currentEmployee?.accessType === 'admin-light' ||
      (auth.currentUser && localStorage.getItem(`accessType_${auth.currentUser.uid}`) === 'admin-light')
    )
  );
  const canIssue = !isReadOnlyAdmin || !isEmployee || isAssignedToMachine;

  // Main Admin check (Non-employee login / root admin)
  const isMainAdmin = Boolean(auth.currentUser && !auth.currentUser.email?.endsWith('@employee.billedapp.com'));

  // Item History Modal State
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<StoreItem | null>(null);
  const [showItemHistoryModal, setShowItemHistoryModal] = useState(false);
  const [connectedReceipts, setConnectedReceipts] = useState<any[]>([]);
  const [centralTransactions, setCentralTransactions] = useState<any[]>([]);
  const [centralIssues, setCentralIssues] = useState<any[]>([]);

  // Check if an item has any recorded transaction (Issue note, Connected Material Receipt, or Central transaction)
  const itemHasTransaction = (item: StoreItem): boolean => {
    if (!item || !item.id) return false;

    // Direct transaction count or flag on item doc
    if ((item as any).transactionCount !== undefined && (item as any).transactionCount > 0) return true;
    if ((item as any).hasTransactions === true) return true;

    // Stock difference check from initial registration
    if (item.oldStock !== undefined && item.stock !== undefined && item.stock !== item.oldStock) {
      return true;
    }
    if (item.initialStock !== undefined && item.stock !== undefined && item.stock !== item.initialStock) {
      return true;
    }

    const itemId = item.id;
    const cleanPl = (item.plNo || '').trim().toLowerCase();
    const cleanPart = (item.partNo || '').trim().toLowerCase();
    const hasPl = !isNaOrEmpty(cleanPl);
    const hasPart = !isNaOrEmpty(cleanPart);

    // 1. Check issue records (store_issues)
    const hasIssue = issueRecords.some(issue => {
      if (issue.storeItemId && issue.storeItemId === itemId) return true;
      const issuePl = (issue.plNo || '').trim().toLowerCase();
      const issuePart = (issue.partNo || '').trim().toLowerCase();
      if (hasPl && !isNaOrEmpty(issuePl) && issuePl === cleanPl) return true;
      if (hasPart && !isNaOrEmpty(issuePart) && issuePart === cleanPart) return true;
      if (!hasPl && !hasPart) {
        if (issue.description && item.description && issue.description.trim().toLowerCase() === item.description.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });

    if (hasIssue) return true;

    // 2. Check connected material receipts (excluding initial Old Stock baseline)
    const hasReceipt = connectedReceipts.some(rec => {
      if (rec.isOldStock || rec.transactionType === 'old_stock') return false;
      if (rec.storeItemId && rec.storeItemId === itemId) return true;
      const recPl = (rec.plNo || '').trim().toLowerCase();
      const recPart = (rec.partNo || '').trim().toLowerCase();
      if (hasPl && !isNaOrEmpty(recPl) && recPl === cleanPl) return true;
      if (hasPart && !isNaOrEmpty(recPart) && recPart === cleanPart) return true;
      if (!hasPl && !hasPart) {
        if (rec.description && item.description && rec.description.trim().toLowerCase() === item.description.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });

    if (hasReceipt) return true;

    // 3. Check central transactions collection (excluding initial store_add_item_old_stock baseline)
    const hasCentral = centralTransactions.some(t => {
      if (t.source === 'store_add_item_old_stock') return false;
      if (t.storeItemId && t.storeItemId === itemId) return true;
      const tPl = (t.plNo || '').trim().toLowerCase();
      const tPart = (t.partNo || '').trim().toLowerCase();
      if (hasPl && !isNaOrEmpty(tPl) && tPl === cleanPl) return true;
      if (hasPart && !isNaOrEmpty(tPart) && tPart === cleanPart) return true;
      if (!hasPl && !hasPart) {
        if (t.description && item.description && String(t.description).trim().toLowerCase() === item.description.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });

    if (hasCentral) return true;

    // 4. Check central issues collection
    const hasCentralIssue = centralIssues.some(ci => {
      if (ci.storeItemId && ci.storeItemId === itemId) return true;
      const ciPl = (ci.plNo || '').trim().toLowerCase();
      const ciPart = (ci.partNo || '').trim().toLowerCase();
      if (hasPl && !isNaOrEmpty(ciPl) && ciPl === cleanPl) return true;
      if (hasPart && !isNaOrEmpty(ciPart) && ciPart === cleanPart) return true;
      if (!hasPl && !hasPart) {
        if (ci.description && item.description && String(ci.description).trim().toLowerCase() === item.description.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });

    if (hasCentralIssue) return true;

    return false;
  };

  // Main Admin Edit Issue Modal State
  const [showEditIssueModal, setShowEditIssueModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState<StoreIssueRecord | null>(null);
  const [editIssueSubmitting, setEditIssueSubmitting] = useState(false);

  // 1. Fetch user profile & company details
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setItems([]);
        setIssueRecords([]);
        setLoading(false);
        return;
      }

      try {
        const emp = await findEmployeeForUser(user.uid, user.email);
        if (emp) {
          setCurrentEmployee(emp);
          if (emp.accessType) {
            setUserAccessType(emp.accessType);
            localStorage.setItem(`accessType_${user.uid}`, emp.accessType);
          }
          if (emp.companyName) {
            setUserCompanyName(emp.companyName);
            localStorage.setItem(`companyName_${user.uid}`, emp.companyName);
          }
        }
      } catch (err) {
        console.error("Error loading profile in Store page:", err);
      }
    });

    return () => unsubAuth();
  }, []);

  // 2. Fetch Machines & Companies lists for dropdowns dynamically in real-time
  useEffect(() => {
    let generalCompanies: string[] = [];
    let employeeCompanies: string[] = [];
    let contractCompanies: string[] = [];
    let directCompanies: string[] = [];

    const updateAllCompanies = () => {
      const merged = new Set<string>([
        ...generalCompanies,
        ...employeeCompanies,
        ...contractCompanies,
        ...directCompanies
      ]);
      const list = Array.from(merged).map(c => c.trim()).filter(Boolean).sort();
      setCompaniesList(list);
    };

    const unsubGen = onSnapshot(doc(db, 'settings', 'general'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
        if (data.companies && Array.isArray(data.companies)) {
          generalCompanies = data.companies.map((c: any) => typeof c === 'string' ? c : c?.name || '').filter(Boolean);
        }
      }
      updateAllCompanies();
    }, (err) => {
      console.warn("Settings fetch warning:", err?.message || err);
    });

    const unsubEmp = onSnapshot(collection(db, 'employees'), (snap) => {
      const cos = new Set<string>();
      const emps: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        emps.push({ id: d.id, ...data });
        if (data.companyName) cos.add(data.companyName.trim());
      });
      setEmployeeList(emps);
      employeeCompanies = Array.from(cos);
      updateAllCompanies();
    }, (err) => {
      console.warn("Employees fetch warning:", err?.message || err);
    });

    const unsubPositions = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const mapping: Record<string, { zone: string; division: string }> = {};
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.machineName) {
          mapping[data.machineName] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setMachinePositions(mapping);
    }, (err) => {
      console.warn("Machine positions fetch warning:", err?.message || err);
    });

    const unsubContracts = onSnapshot(collection(db, 'machine_contracts'), (snap) => {
      const cos = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        if (data.companyName) cos.add(data.companyName.trim());
        if (data.transferredToCompany) cos.add(data.transferredToCompany.trim());
      });
      contractCompanies = Array.from(cos);
      updateAllCompanies();
    }, (err) => {
      console.warn("Contracts fetch warning:", err?.message || err);
    });

    const unsubCompanies = onSnapshot(collection(db, 'companies'), (snap) => {
      const cos = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        const cName = data.name || data.companyName;
        if (cName) cos.add(cName.trim());
      });
      directCompanies = Array.from(cos);
      updateAllCompanies();
    }, (err) => {
      console.warn("Companies collection fetch warning:", err?.message || err);
    });

    return () => {
      unsubGen();
      unsubEmp();
      unsubPositions();
      unsubContracts();
      unsubCompanies();
    };
  }, []);

  // 3. Fetch Parts catalog for auto-fill data matching
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setCatalogParts([]);
        return;
      }
      const unsub = onSnapshot(collection(db, 'parts'), (snap) => {
        const list: any[] = [];
        snap.forEach(d => {
          list.push({ id: d.id, ...d.data() });
        });
        setCatalogParts(list);
      }, (err) => {
        console.warn("Parts catalog fetch warning:", err?.message || err);
      });
      return () => unsub();
    });
    return () => unsubAuth();
  }, []);

  // Machines list (authoritative from settings or default fallback)
  const allMachines = useMemo(() => {
    if (machinesList && machinesList.length > 0) {
      return Array.from(new Set(machinesList)).filter(Boolean).sort();
    }
    const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    return defaultList.sort();
  }, [machinesList]);

  // 3. Realtime Listener for Store Items (`store_items`)
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (!user) {
        setItems([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const q = collection(db, 'store_items');
      unsub = onSnapshot(q, (snapshot) => {
        const list: StoreItem[] = [];
        snapshot.forEach((docSnap) => {
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
            createdAt: data.createdAt || '',
            createdBy: data.createdBy || '',
            initialStock: data.initialStock !== undefined ? Number(data.initialStock) : undefined,
            oldStock: data.oldStock !== undefined ? Number(data.oldStock) : undefined,
            transactionCount: data.transactionCount !== undefined ? Number(data.transactionCount) : undefined,
            hasTransactions: Boolean(data.hasTransactions)
          });
        });
        list.sort((a, b) => a.description.localeCompare(b.description));
        setItems(list);
        setLoading(false);
      }, (error) => {
        console.warn("Error fetching store items:", error?.message || error);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  // 4. Realtime Listener for Issue Records (`store_issues`)
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (!user) {
        setIssueRecords([]);
        return;
      }

      const q = collection(db, 'store_issues');
      unsub = onSnapshot(q, (snapshot) => {
        const list: StoreIssueRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            issueNoteNo: data.issueNoteNo || '',
            storeItemId: data.storeItemId || '',
            plNo: data.plNo || '',
            partNo: data.partNo || '',
            description: data.description || '',
            qty: Number(data.qty) || 0,
            unit: data.unit || 'Nos',
            rate: Number(data.rate) || 0,
            totalValue: Number(data.totalValue) || 0,
            issuingCompany: data.issuingCompany || '',
            targetType: data.targetType || 'machine',
            targetMachine: data.targetMachine || '',
            targetCompany: data.targetCompany || '',
            receiverName: data.receiverName || '',
            receiverDesignation: data.receiverDesignation || '',
            issuedBy: data.issuedBy || '',
            officerDesignation: data.officerDesignation || '',
            date: data.date || '',
            remarks: data.remarks || '',
            createdAt: data.createdAt || ''
          });
        });
        list.sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
        setIssueRecords(list);
      }, (error) => {
        console.warn("Error fetching store issue records:", error?.message || error);
      });
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  // 5. Realtime listener for Connected Material Receipts (for item history & inward transactions)
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (!user) {
        setConnectedReceipts([]);
        return;
      }
      const q = collection(db, 'connected_material_receipts');
      unsub = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        list.sort((a, b) => new Date(b.returnedDate || b.createdAt || 0).getTime() - new Date(a.returnedDate || a.createdAt || 0).getTime());
        setConnectedReceipts(list);
      }, (error) => {
        console.warn("Error fetching connected material receipts:", error?.message || error);
      });
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  // 6. Realtime listener for Central Ledger Transactions
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (!user) {
        setCentralTransactions([]);
        return;
      }
      const q = collection(db, 'transactions');
      unsub = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setCentralTransactions(list);
      }, (error) => {
        console.warn("Error fetching central transactions:", error?.message || error);
      });
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  // 7. Realtime listener for Central Issues
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (!user) {
        setCentralIssues([]);
        return;
      }
      const q = collection(db, 'issues');
      unsub = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setCentralIssues(list);
      }, (error) => {
        console.warn("Error fetching central issues:", error?.message || error);
      });
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  // Filter items based on user company / selection
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Role / Company check:
      if (isEmployee && userAccessType === 'admin-light') {
        if (userCompanyName && item.companyName && item.companyName.toLowerCase() !== userCompanyName.toLowerCase()) {
          return false;
        }
      } else if (companyFilter !== 'all') {
        if (item.companyName.toLowerCase() !== companyFilter.toLowerCase()) {
          return false;
        }
      }

      // Search
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const matchDesc = item.description.toLowerCase().includes(term);
        const matchPl = (item.plNo || '').toLowerCase().includes(term);
        const matchPart = (item.partNo || '').toLowerCase().includes(term);
        const matchLoc = (item.location || '').toLowerCase().includes(term);
        if (!matchDesc && !matchPl && !matchPart && !matchLoc) return false;
      }

      // Category
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

      // Condition
      if (conditionFilter !== 'all' && item.itemCondition !== conditionFilter) return false;

      return true;
    });
  }, [items, isEmployee, userAccessType, userCompanyName, companyFilter, searchTerm, categoryFilter, conditionFilter]);

  // Filter issue records for current company
  const filteredIssueRecords = useMemo(() => {
    return issueRecords.filter(rec => {
      if (isEmployee && userAccessType === 'admin-light') {
        if (userCompanyName && rec.issuingCompany && rec.issuingCompany.toLowerCase() !== userCompanyName.toLowerCase()) {
          return false;
        }
      } else if (companyFilter !== 'all') {
        if (rec.issuingCompany.toLowerCase() !== companyFilter.toLowerCase()) {
          return false;
        }
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const matchDesc = rec.description.toLowerCase().includes(term);
        const matchVoucher = rec.issueNoteNo.toLowerCase().includes(term);
        const matchTarget = (rec.targetMachine || rec.targetCompany || '').toLowerCase().includes(term);
        const matchReceiver = rec.receiverName.toLowerCase().includes(term);
        if (!matchDesc && !matchVoucher && !matchTarget && !matchReceiver) return false;
      }

      return true;
    });
  }, [issueRecords, isEmployee, userAccessType, userCompanyName, companyFilter, searchTerm]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalItems = filteredItems.length;
    const totalQty = filteredItems.reduce((acc, curr) => acc + curr.stock, 0);
    const totalVal = filteredItems.reduce((acc, curr) => acc + (curr.stock * curr.rate), 0);
    const lowStockCount = filteredItems.filter(i => i.stock <= 5).length;
    return { totalItems, totalQty, totalVal, lowStockCount };
  }, [filteredItems]);

  const availableCategoriesForFilter = useMemo(() => {
    const std = ["Spare Parts", "Mechanical", "Electrical", "Hydraulic", "Consumables", "Tools", "General"];
    const customCats = items.map(i => i.category).filter(c => Boolean(c) && !std.includes(c));
    return [...std, ...Array.from(new Set(customCats))];
  }, [items]);

  // Reset pagination when filter criteria change
  useEffect(() => {
    setInventoryPage(1);
  }, [searchTerm, categoryFilter, conditionFilter, companyFilter]);

  useEffect(() => {
    setIssuePage(1);
  }, [searchTerm, companyFilter]);

  // Sliced items for 10 rows per page (Store Inventory Table)
  const totalInventoryPages = Math.ceil(filteredItems.length / inventoryPageSize) || 1;
  const paginatedItems = useMemo(() => {
    const start = (inventoryPage - 1) * inventoryPageSize;
    return filteredItems.slice(start, start + inventoryPageSize);
  }, [filteredItems, inventoryPage, inventoryPageSize]);

  // Sliced issue records for 10 rows per page (Issue History Table)
  const totalIssuePages = Math.ceil(filteredIssueRecords.length / issuePageSize) || 1;
  const paginatedIssueRecords = useMemo(() => {
    const start = (issuePage - 1) * issuePageSize;
    return filteredIssueRecords.slice(start, start + issuePageSize);
  }, [filteredIssueRecords, issuePage, issuePageSize]);

  // Keep pagination within valid range
  useEffect(() => {
    if (inventoryPage > totalInventoryPages && totalInventoryPages > 0) {
      setInventoryPage(totalInventoryPages);
    }
  }, [totalInventoryPages, inventoryPage]);

  useEffect(() => {
    if (issuePage > totalIssuePages && totalIssuePages > 0) {
      setIssuePage(totalIssuePages);
    }
  }, [totalIssuePages, issuePage]);

  // Duplicate check for Add / Edit Item form (preventing same PL No or Part No)
  const duplicateWarning = useMemo(() => {
    const cleanPl = (itemForm.plNo || '').trim().toLowerCase();
    const cleanPart = (itemForm.partNo || '').trim().toLowerCase();
    const isPlValid = !isNaOrEmpty(cleanPl);
    const isPartValid = !isNaOrEmpty(cleanPart);

    if (!isPlValid && !isPartValid) return null;

    const dup = items.find(existing => {
      if (editingItem && existing.id === editingItem.id) return false;
      const existingPl = (existing.plNo || '').trim().toLowerCase();
      const existingPart = (existing.partNo || '').trim().toLowerCase();
      const plMatches = isPlValid && !isNaOrEmpty(existingPl) && existingPl === cleanPl;
      const partMatches = isPartValid && !isNaOrEmpty(existingPart) && existingPart === cleanPart;
      return plMatches || partMatches;
    });

    if (!dup) return null;

    const reasons: string[] = [];
    const existingPl = (dup.plNo || '').trim().toLowerCase();
    const existingPart = (dup.partNo || '').trim().toLowerCase();
    if (isPlValid && existingPl === cleanPl) reasons.push(`PL No: "${dup.plNo}"`);
    if (isPartValid && existingPart === cleanPart) reasons.push(`Part No: "${dup.partNo}"`);

    return {
      item: dup,
      reasons: reasons.join(' & ')
    };
  }, [items, itemForm.plNo, itemForm.partNo, editingItem]);

  // Auto-fill matching function when Part No or PL No is typed/selected in Store Add Item form
  const matchAndAutoFillStoreForm = (field: 'plNo' | 'partNo', val: string) => {
    if (!val.trim()) return;
    const clean = val.trim().toLowerCase();

    // Check if an item already exists in Store with this Part No or PL No
    const storeMatch = items.find(i => 
      (field === 'plNo' ? i.plNo?.trim().toLowerCase() === clean : i.partNo?.trim().toLowerCase() === clean) ||
      (field === 'plNo' ? i.partNo?.trim().toLowerCase() === clean : i.plNo?.trim().toLowerCase() === clean)
    );

    if (storeMatch && (!editingItem || storeMatch.id !== editingItem.id)) {
      setAutoMatchedInfo(null);
      return;
    }

    // Check catalogParts templates
    const matched = catalogParts.find(p => 
      (field === 'plNo' ? p.plNo?.trim().toLowerCase() === clean : p.partNo?.trim().toLowerCase() === clean) ||
      (field === 'plNo' ? p.partNo?.trim().toLowerCase() === clean : p.plNo?.trim().toLowerCase() === clean)
    ) || (editingItem ? storeMatch : null);

    if (matched) {
      const rawUnit = matched.unit || 'Nos';
      const isStdUnit = STANDARD_STORE_UOMS.includes(rawUnit);
      
      const rawCat = matched.category || 'Spare Parts';
      const isStdCat = STANDARD_STORE_CATEGORIES.includes(rawCat) && rawCat !== 'Other';

      setItemForm(prev => ({
        ...prev,
        [field]: val,
        plNo: matched.plNo || prev.plNo || (field === 'plNo' ? val : ''),
        partNo: matched.partNo || prev.partNo || (field === 'partNo' ? val : ''),
        description: matched.description || prev.description,
        category: isStdCat ? rawCat : 'Other',
        customCategory: isStdCat ? '' : rawCat,
        unit: isStdUnit ? rawUnit : 'Other',
        customUnit: isStdUnit ? '' : rawUnit,
        rate: matched.rate != null ? String(matched.rate) : (prev.rate ?? '0'),
        location: matched.location || prev.location || '',
        remarks: matched.remarks || prev.remarks || '',
      }));

      setAutoMatchedInfo(`Auto-filled item details for "${matched.description || val}" from Catalog`);
    }
  };

  // Connected Materials Helpers
  const availableMachinesForConnected = useMemo(() => {
    if (isEmployee && userAccessType === 'admin-light' && userCompanyName) {
      const compMachines = employeeList
        .filter(e => e.companyName?.trim().toLowerCase() === userCompanyName.trim().toLowerCase())
        .map(e => e.machineName)
        .filter(Boolean);
      if (compMachines.length > 0) {
        return Array.from(new Set(compMachines)).sort();
      }
    }
    return allMachines;
  }, [isEmployee, userAccessType, userCompanyName, employeeList, allMachines]);

  const handleOpenConnectedMaterials = () => {
    const empCompany = userCompanyName || currentEmployee?.companyName || '';
    const empMachine = currentEmployee?.machineName && currentEmployee.machineName.toLowerCase() !== 'all' && currentEmployee.machineName.toLowerCase() !== 'none'
      ? currentEmployee.machineName
      : '';
    const pos = empMachine ? machinePositions[empMachine] : null;

    setConnectedForm({
      voucherNo: '',
      returnedDate: format(new Date(), 'yyyy-MM-dd'),
      machineName: empMachine,
      companyName: empCompany,
      zone: pos?.zone || '',
      division: pos?.division || '',
      partNo: '',
      plNo: '',
      description: '',
      location: '',
      qtyReturned: '1',
      unit: 'Nos',
      customUnit: '',
      remarks: '',
      selectedStoreItemId: ''
    });
    setShowConnectedModal(true);
  };

  const handleConnectedMachineChange = (machName: string) => {
    const matchedEmp = employeeList.find(e => e.machineName === machName);
    const matchedCompany = matchedEmp?.companyName || '';
    const pos = machinePositions[machName];

    setConnectedForm(prev => ({
      ...prev,
      machineName: machName,
      companyName: matchedCompany || prev.companyName || userCompanyName || '',
      zone: pos?.zone || prev.zone || '',
      division: pos?.division || prev.division || '',
    }));
  };

  const handleSelectStoreItemForConnected = (selectedId: string) => {
    const itm = items.find(i => i.id === selectedId);
    if (!itm) {
      setConnectedForm(prev => ({
        ...prev,
        selectedStoreItemId: '',
        partNo: '',
        plNo: '',
        description: '',
        location: '',
        unit: 'Nos',
        customUnit: '',
      }));
      return;
    }
    const rawUnit = itm.unit || 'Nos';
    const isStd = STANDARD_STORE_UOMS.includes(rawUnit);
    setConnectedForm(prev => ({
      ...prev,
      selectedStoreItemId: itm.id,
      partNo: itm.partNo || '',
      plNo: itm.plNo || '',
      description: itm.description,
      location: itm.location || '',
      unit: isStd ? rawUnit : 'Other',
      customUnit: isStd ? '' : rawUnit,
    }));
  };

  const handleConnectedPartNoChange = (selectedPartNo: string) => {
    const clean = selectedPartNo.trim().toLowerCase();
    // Only search within items created in Store
    const matchedStoreItem = items.find(i => 
      (i.partNo && i.partNo.trim().toLowerCase() === clean) ||
      (i.plNo && i.plNo.trim().toLowerCase() === clean)
    );

    if (matchedStoreItem) {
      const rawUnit = matchedStoreItem.unit || 'Nos';
      const isStd = STANDARD_STORE_UOMS.includes(rawUnit);
      setConnectedForm(prev => ({
        ...prev,
        partNo: selectedPartNo,
        plNo: matchedStoreItem.plNo || prev.plNo,
        description: matchedStoreItem.description,
        unit: isStd ? rawUnit : 'Other',
        customUnit: isStd ? '' : rawUnit,
        location: matchedStoreItem.location || prev.location,
        selectedStoreItemId: matchedStoreItem.id,
      }));
    } else {
      setConnectedForm(prev => ({
        ...prev,
        partNo: selectedPartNo,
        selectedStoreItemId: '',
      }));
    }
  };

  const handleConnectedPlNoChange = (selectedPlNo: string) => {
    const clean = selectedPlNo.trim().toLowerCase();
    // Only search within items created in Store
    const matchedStoreItem = items.find(i => 
      (i.plNo && i.plNo.trim().toLowerCase() === clean) ||
      (i.partNo && i.partNo.trim().toLowerCase() === clean)
    );

    if (matchedStoreItem) {
      const rawUnit = matchedStoreItem.unit || 'Nos';
      const isStd = STANDARD_STORE_UOMS.includes(rawUnit);
      setConnectedForm(prev => ({
        ...prev,
        plNo: selectedPlNo,
        partNo: matchedStoreItem.partNo || prev.partNo,
        description: matchedStoreItem.description,
        unit: isStd ? rawUnit : 'Other',
        customUnit: isStd ? '' : rawUnit,
        location: matchedStoreItem.location || prev.location,
        selectedStoreItemId: matchedStoreItem.id,
      }));
    } else {
      setConnectedForm(prev => ({
        ...prev,
        plNo: selectedPlNo,
        selectedStoreItemId: '',
      }));
    }
  };

  const connectedCurrentStoreStock = useMemo(() => {
    if (connectedForm.selectedStoreItemId) {
      const itm = items.find(i => i.id === connectedForm.selectedStoreItemId);
      if (itm) return itm.stock;
    }
    const cleanPart = connectedForm.partNo.trim().toLowerCase();
    const cleanPl = connectedForm.plNo.trim().toLowerCase();
    const cleanDesc = connectedForm.description.trim().toLowerCase();

    const matched = items.find(i => 
      (cleanPart && i.partNo && i.partNo.trim().toLowerCase() === cleanPart) ||
      (cleanPl && i.plNo && i.plNo.trim().toLowerCase() === cleanPl) ||
      (cleanDesc && i.description && i.description.trim().toLowerCase() === cleanDesc)
    );
    return matched ? matched.stock : 0;
  }, [items, connectedForm.selectedStoreItemId, connectedForm.partNo, connectedForm.plNo, connectedForm.description]);

  const handleSaveConnectedReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectedForm.partNo.trim() && !connectedForm.description.trim() && !connectedForm.plNo.trim()) {
      toast.error("Please provide Part No, PL No, or Description.");
      return;
    }
    if (!connectedForm.returnedDate) {
      toast.error("Please enter a Returned Date.");
      return;
    }
    const qty = parseFloat(String(connectedForm.qtyReturned)) || 0;
    if (qty <= 0) {
      toast.error("Quantity Returned must be greater than 0.");
      return;
    }

    // Match item in Store items ONLY (Must already be created in Store)
    let matchedStoreItem = connectedForm.selectedStoreItemId
      ? items.find(i => i.id === connectedForm.selectedStoreItemId)
      : null;

    if (!matchedStoreItem) {
      const cleanPart = connectedForm.partNo.trim().toLowerCase();
      const cleanPl = connectedForm.plNo.trim().toLowerCase();
      const cleanDesc = connectedForm.description.trim().toLowerCase();
      matchedStoreItem = items.find(i => 
        (cleanPart && i.partNo && i.partNo.trim().toLowerCase() === cleanPart) ||
        (cleanPl && i.plNo && i.plNo.trim().toLowerCase() === cleanPl) ||
        (cleanDesc && i.description && i.description.trim().toLowerCase() === cleanDesc)
      ) || null;
    }

    // Strict constraint: Only items created in store can be updated
    if (!matchedStoreItem) {
      toast.error("Connected Materials can ONLY update items already created in Store. Please select an existing Store item or add it to Store first.");
      return;
    }

    const itemName = matchedStoreItem.description;
    const finalUnit = connectedForm.unit === 'Other' ? (connectedForm.customUnit.trim() || matchedStoreItem.unit || 'Nos') : (connectedForm.unit || matchedStoreItem.unit || 'Nos');
    const receiptVoucherNo = connectedForm.voucherNo?.trim() || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;

    const confirmed = window.confirm(`Confirm Connected Material Receipt:\n\nItem Name: ${itemName}\nReceived Qty: ${qty} ${finalUnit}\n\nClick OK to update this item's stock in the Store Inventory.`);
    if (!confirmed) return;

    setConnectedSubmitting(true);
    try {
      const user = auth.currentUser;
      const targetStoreItemId = matchedStoreItem.id;
      const oldStock = Number(matchedStoreItem.stock) || 0;
      const newStock = oldStock + qty;

      // 1. Update existing store item stock
      const rate = Number(matchedStoreItem.rate) || 0;
      const newTotalValue = newStock * rate;
      await updateDoc(doc(db, 'store_items', matchedStoreItem.id), {
        stock: newStock,
        totalValue: newTotalValue,
        location: connectedForm.location.trim() || matchedStoreItem.location || '',
        updatedAt: new Date().toISOString()
      });

      // 2. Add receipt record to connected_material_receipts
      const receiptPayload = {
        voucherNo: receiptVoucherNo,
        zone: connectedForm.zone.trim(),
        division: connectedForm.division.trim(),
        machineName: connectedForm.machineName.trim(),
        companyName: connectedForm.companyName.trim() || userCompanyName || 'General Store',
        partNo: connectedForm.partNo.trim() || matchedStoreItem.partNo || '',
        plNo: connectedForm.plNo.trim() || matchedStoreItem.plNo || '',
        description: itemName,
        returnedDate: connectedForm.returnedDate,
        qtyReturned: qty,
        unit: finalUnit,
        location: connectedForm.location.trim() || matchedStoreItem.location || '',
        remarks: connectedForm.remarks.trim(),
        transactionQty: qty,
        storeItemId: targetStoreItemId,
        oldStock,
        newStock,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || 'Unknown',
        createdByEmail: user?.email || '',
      };
      await addDoc(collection(db, 'connected_material_receipts'), receiptPayload);

      // 3. Add to transactions log
      await addDoc(collection(db, 'transactions'), {
        partNo: receiptPayload.partNo,
        plNo: receiptPayload.plNo,
        type: 'received',
        qty,
        date: connectedForm.returnedDate,
        details: `Received via Connected Material Receipt into Store (Old Stock: ${oldStock}, New Stock: ${newStock})`,
        remarks: connectedForm.remarks.trim(),
        voucherNo: receiptVoucherNo,
        machineName: connectedForm.machineName.trim(),
        companyName: receiptPayload.companyName,
        zone: connectedForm.zone.trim(),
        division: connectedForm.division.trim(),
        source: 'store_connected_receipt',
        createdAt: new Date().toISOString()
      });

      toast.success(`Connected Material Receipt logged! Voucher No: ${receiptVoucherNo}. Store stock of "${itemName}" updated to ${newStock} ${finalUnit}.`);
      setShowConnectedModal(false);
    } catch (err: any) {
      console.error("Error saving connected material receipt:", err);
      toast.error("Failed to save connected material receipt: " + (err?.message || "Unknown error"));
    } finally {
      setConnectedSubmitting(false);
    }
  };

  // Open Item History Modal
  const handleOpenItemHistory = (item: StoreItem) => {
    setSelectedHistoryItem(item);
    setShowItemHistoryModal(true);
  };

  // Open Edit Issue Modal (Main Admin Only)
  const handleOpenEditIssue = (issue: StoreIssueRecord) => {
    if (!isMainAdmin) {
      toast.error("Access Denied: Only Main Admin can edit issue records.");
      return;
    }
    setEditingIssue(issue);
    setShowEditIssueModal(true);
  };

  // Save Edit Issue Record & Auto-Adjust Store Stock (Main Admin Only)
  const handleSaveEditIssue = async (updatedData: {
    date: string;
    qty: number;
    targetType: 'machine' | 'company';
    targetMachine: string;
    targetCompany: string;
    receiverName: string;
    receiverDesignation: string;
    remarks: string;
  }) => {
    if (!isMainAdmin) {
      toast.error("Access Denied: Only Main Admin can edit issue records.");
      return;
    }
    if (!editingIssue) return;

    const newQty = Number(updatedData.qty) || 0;
    if (newQty <= 0) {
      toast.error("Issue quantity must be greater than 0.");
      return;
    }

    const oldQty = Number(editingIssue.qty) || 0;
    const qtyDiff = newQty - oldQty; // >0 means more issued (deduct stock), <0 means less issued (restore stock)

    let storeItem = items.find(i => i.id === editingIssue.storeItemId);
    if (!storeItem) {
      const cleanPart = (editingIssue.partNo || '').trim().toLowerCase();
      const cleanPl = (editingIssue.plNo || '').trim().toLowerCase();
      const cleanDesc = (editingIssue.description || '').trim().toLowerCase();
      storeItem = items.find(i => 
        (cleanPart && i.partNo && i.partNo.trim().toLowerCase() === cleanPart) ||
        (cleanPl && i.plNo && i.plNo.trim().toLowerCase() === cleanPl) ||
        (cleanDesc && i.description && i.description.trim().toLowerCase() === cleanDesc)
      );
    }

    if (storeItem && qtyDiff > 0 && storeItem.stock < qtyDiff) {
      toast.error(`Cannot increase issue quantity by ${qtyDiff}. Only ${storeItem.stock} ${storeItem.unit || 'units'} available in Store inventory.`);
      return;
    }

    setEditIssueSubmitting(true);
    try {
      const targetName = updatedData.targetType === 'machine' ? updatedData.targetMachine : updatedData.targetCompany;
      const rate = Number(editingIssue.rate) || (storeItem ? Number(storeItem.rate) : 0);
      const newTotalVal = newQty * rate;

      // 1. Adjust store item stock if qty changed and item exists
      if (storeItem && qtyDiff !== 0) {
        const newStock = Number(storeItem.stock) - qtyDiff;
        const newStockTotalVal = newStock * (Number(storeItem.rate) || 0);
        await updateDoc(doc(db, 'store_items', storeItem.id), {
          stock: newStock,
          totalValue: newStockTotalVal,
          updatedAt: new Date().toISOString()
        });
      }

      // 2. Update store_issues doc
      const payload = {
        date: updatedData.date,
        qty: newQty,
        totalValue: newTotalVal,
        targetType: updatedData.targetType,
        targetMachine: updatedData.targetType === 'machine' ? targetName : '',
        targetCompany: updatedData.targetType === 'company' ? targetName : '',
        receiverName: updatedData.receiverName.trim(),
        receiverDesignation: updatedData.receiverDesignation.trim(),
        remarks: updatedData.remarks.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'Main Admin'
      };
      await updateDoc(doc(db, 'store_issues', editingIssue.id), payload);

      // 3. Update central `issues` collection doc if matching issueNoteNo exists
      if (editingIssue.issueNoteNo) {
        try {
          const issuesQuery = query(collection(db, 'issues'), where('issueNoteNo', '==', editingIssue.issueNoteNo));
          const issuesSnap = await getDocs(issuesQuery);
          issuesSnap.forEach(async (d) => {
            await updateDoc(doc(db, 'issues', d.id), {
              date: updatedData.date,
              qty: newQty,
              totalValue: newTotalVal,
              machineName: updatedData.targetType === 'machine' ? targetName : '',
              receiverName: updatedData.receiverName.trim(),
              remarks: updatedData.remarks.trim(),
              updatedAt: new Date().toISOString()
            });
          });
        } catch (err) {
          console.warn("Sync central issues error:", err);
        }
      }

      toast.success(`Issue record updated! ${qtyDiff !== 0 ? `Store stock adjusted by ${-qtyDiff} units.` : ''}`);
      setShowEditIssueModal(false);
      setEditingIssue(null);
    } catch (err: any) {
      console.error("Error updating issue record:", err);
      toast.error("Failed to update issue record: " + (err?.message || "Unknown error"));
    } finally {
      setEditIssueSubmitting(false);
    }
  };

  // Delete Issue Record & Revert Stock to Store (Main Admin Only)
  const handleDeleteIssue = async (issue: StoreIssueRecord) => {
    if (!isMainAdmin) {
      toast.error("Access Denied: Only Main Admin can delete issue records.");
      return;
    }

    const confirmed = window.confirm(
      `Delete Issue Record?\n\nVoucher No: ${issue.issueNoteNo}\nItem: ${issue.description}\nQty Issued: ${issue.qty} ${issue.unit}\n\nRestoring Stock: Deleting this issue record will return ${issue.qty} ${issue.unit} back to Store Inventory stock.\n\nClick OK to proceed.`
    );
    if (!confirmed) return;

    try {
      // 1. Revert stock to Store item
      let storeItem = items.find(i => i.id === issue.storeItemId);
      if (!storeItem) {
        const cleanPart = (issue.partNo || '').trim().toLowerCase();
        const cleanPl = (issue.plNo || '').trim().toLowerCase();
        const cleanDesc = (issue.description || '').trim().toLowerCase();
        storeItem = items.find(i => 
          (cleanPart && i.partNo && i.partNo.trim().toLowerCase() === cleanPart) ||
          (cleanPl && i.plNo && i.plNo.trim().toLowerCase() === cleanPl) ||
          (cleanDesc && i.description && i.description.trim().toLowerCase() === cleanDesc)
        );
      }

      if (storeItem) {
        const restoredStock = Number(storeItem.stock) + Number(issue.qty);
        const newTotalVal = restoredStock * (Number(storeItem.rate) || 0);
        await updateDoc(doc(db, 'store_items', storeItem.id), {
          stock: restoredStock,
          totalValue: newTotalVal,
          updatedAt: new Date().toISOString()
        });
      }

      // 2. Archive deleted record in recycle bin
      await archiveDeletedRecord({
        originalCollection: 'store_issues',
        originalId: issue.id,
        data: issue,
        moduleName: 'Store Issue Record',
        itemSummary: `Issue #${issue.issueNoteNo} - ${issue.description} • Qty: ${issue.qty} ${issue.unit} to ${issue.targetMachine || issue.targetCompany || 'Consignee'}`,
        companyName: issue.issuingCompany
      });

      // 3. Delete from store_issues
      await deleteDoc(doc(db, 'store_issues', issue.id));

      // 4. Delete from central issues if exists
      if (issue.issueNoteNo) {
        try {
          const issuesQuery = query(collection(db, 'issues'), where('issueNoteNo', '==', issue.issueNoteNo));
          const issuesSnap = await getDocs(issuesQuery);
          issuesSnap.forEach(async (d) => {
            await deleteDoc(doc(db, 'issues', d.id));
          });
        } catch (err) {
          console.warn("Sync central issues delete error:", err);
        }
      }

      toast.success(`Issue record deleted and ${issue.qty} ${issue.unit} restored to Store inventory stock!`);
    } catch (err: any) {
      console.error("Error deleting issue record:", err);
      toast.error("Failed to delete issue record: " + (err?.message || "Unknown error"));
    }
  };

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingItem(null);
    setAutoMatchedInfo(null);
    setItemForm({
      plNo: '',
      description: '',
      partNo: '',
      category: 'Spare Parts',
      customCategory: '',
      unit: 'Nos',
      customUnit: '',
      stock: '1',
      rate: '0',
      location: '',
      itemCondition: 'New',
      remarks: ''
    });
    setShowAddEditModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (item: StoreItem) => {
    // Admin Light Company constraint: items with transactions cannot be edited
    if (isAdminLight && itemHasTransaction(item)) {
      toast.error("Admin Light Company: इस आइटम में पहले से ट्रांजेक्शन हो चुका है, इसलिए इसे एडिट नहीं किया जा सकता। (Items with recorded transactions cannot be edited by Admin Light Company.)");
      return;
    }

    setEditingItem(item);
    setAutoMatchedInfo(null);
    const isStdUnit = STANDARD_STORE_UOMS.includes(item.unit || 'Nos');
    const rawCat = item.category || 'Spare Parts';
    const isStdCat = STANDARD_STORE_CATEGORIES.includes(rawCat) && rawCat !== 'Other';

    setItemForm({
      plNo: item.plNo || '',
      description: item.description,
      partNo: item.partNo || '',
      category: isStdCat ? rawCat : 'Other',
      customCategory: isStdCat ? '' : rawCat,
      unit: isStdUnit ? (item.unit || 'Nos') : 'Other',
      customUnit: isStdUnit ? '' : (item.unit || ''),
      stock: item.stock !== undefined && item.stock !== null ? String(item.stock) : '1',
      rate: item.rate !== undefined && item.rate !== null ? String(item.rate) : '0',
      location: item.location || '',
      itemCondition: item.itemCondition,
      remarks: item.remarks || ''
    });
    setShowAddEditModal(true);
  };

  // Save Add / Edit Store Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.description.trim()) {
      toast.error("Item Description is required!");
      return;
    }

    // Role / Company Boundary Validation:
    if (editingItem && isEmployee && userAccessType === 'admin-light' && userCompanyName) {
      if (editingItem.companyName && editingItem.companyName.toLowerCase() !== userCompanyName.toLowerCase()) {
        toast.error("Unauthorized: You can only edit store items belonging to your company.");
        return;
      }
    }

    // Admin Light Company: Block editing if item has any transaction
    if (editingItem && isAdminLight && itemHasTransaction(editingItem)) {
      toast.error("Admin Light Company: इस आइटम में पहले से ट्रांजेक्शन हो चुका है, इसलिए इसे एडिट नहीं किया जा सकता।");
      return;
    }

    // Duplicate Item Check (PL No or Part No match - "same PL no. ya Same part no se dubara item add n ho paye ya duplicate item entry n ho paye")
    const cleanPl = itemForm.plNo.trim().toLowerCase();
    const cleanPart = itemForm.partNo.trim().toLowerCase();
    const isPlValid = !isNaOrEmpty(cleanPl);
    const isPartValid = !isNaOrEmpty(cleanPart);

    if (isPlValid || isPartValid) {
      const duplicateItem = items.find(existing => {
        if (editingItem && existing.id === editingItem.id) return false;
        const existingPl = (existing.plNo || '').trim().toLowerCase();
        const existingPart = (existing.partNo || '').trim().toLowerCase();
        const plMatches = isPlValid && !isNaOrEmpty(existingPl) && existingPl === cleanPl;
        const partMatches = isPartValid && !isNaOrEmpty(existingPart) && existingPart === cleanPart;
        return plMatches || partMatches;
      });

      if (duplicateItem) {
        const reasons: string[] = [];
        const existingPl = (duplicateItem.plNo || '').trim().toLowerCase();
        const existingPart = (duplicateItem.partNo || '').trim().toLowerCase();
        if (isPlValid && existingPl === cleanPl) reasons.push(`PL No: "${duplicateItem.plNo}"`);
        if (isPartValid && existingPart === cleanPart) reasons.push(`Part No: "${duplicateItem.partNo}"`);

        toast.error(`Duplicate Item Blocked! An item with the same ${reasons.join(' & ')} already exists in Store: "${duplicateItem.description}" (Stock: ${duplicateItem.stock} ${duplicateItem.unit || 'Nos'}). Duplicate entry is not allowed.`);
        return;
      }
    }

    try {
      const company = editingItem ? (editingItem.companyName || userCompanyName || currentEmployee?.companyName || 'General Store') : (userCompanyName || currentEmployee?.companyName || 'General Store');
      const finalUnit = itemForm.unit === 'Other' ? (itemForm.customUnit.trim() || 'Nos') : (itemForm.unit || 'Nos');
      const finalCategory = itemForm.category === 'Other' ? (itemForm.customCategory.trim() || 'General') : (itemForm.category || 'Spare Parts');

      const parsedStock = parseFloat(String(itemForm.stock)) || 0;
      const parsedRate = parseFloat(String(itemForm.rate)) || 0;

      const itemData = {
        plNo: itemForm.plNo.trim(),
        description: itemForm.description.trim(),
        partNo: itemForm.partNo.trim(),
        category: finalCategory,
        unit: finalUnit,
        stock: parsedStock,
        rate: parsedRate,
        totalValue: parsedStock * parsedRate,
        location: itemForm.location.trim(),
        companyName: company,
        itemCondition: itemForm.itemCondition,
        remarks: itemForm.remarks.trim(),
        updatedAt: new Date().toISOString()
      };

      if (editingItem) {
        await updateDoc(doc(db, 'store_items', editingItem.id), {
          ...itemData,
          oldStock: editingItem.oldStock !== undefined ? editingItem.oldStock : (editingItem.initialStock !== undefined ? editingItem.initialStock : editingItem.stock),
          initialStock: editingItem.initialStock !== undefined ? editingItem.initialStock : editingItem.stock,
        });
        toast.success("Store item updated successfully!");
      } else {
        const itemPayload = {
          ...itemData,
          oldStock: parsedStock,
          initialStock: parsedStock,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.email || ''
        };
        const docRef = await addDoc(collection(db, 'store_items'), itemPayload);

        // Always log "Old Stock" inward receipt transaction to connected_material_receipts
        // so it permanently shows in Item History modal with "Old Stock" & its stock quantity
        const oldStockVoucher = `OLD-STK-${format(new Date(), 'yyMM')}-${Math.floor(1000 + Math.random() * 9000)}`;
        await addDoc(collection(db, 'connected_material_receipts'), {
          voucherNo: oldStockVoucher,
          transactionType: 'old_stock',
          isOldStock: true,
          title: 'Old Stock',
          description: itemData.description,
          plNo: itemData.plNo,
          partNo: itemData.partNo,
          category: itemData.category,
          qtyReturned: parsedStock,
          transactionQty: parsedStock,
          unit: itemData.unit,
          oldStock: parsedStock,
          newStock: parsedStock,
          companyName: company,
          location: itemData.location || 'Store Inventory',
          remarks: itemForm.remarks.trim() ? `Old Stock: ${itemForm.remarks.trim()}` : 'Old Stock (Material added to store)',
          returnedDate: format(new Date(), 'yyyy-MM-dd'),
          storeItemId: docRef.id,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.uid || 'Unknown',
          createdByEmail: auth.currentUser?.email || 'Store Official',
        });

        // Add to central ledger transactions
        await addDoc(collection(db, 'transactions'), {
          partNo: itemData.partNo,
          plNo: itemData.plNo,
          type: 'received',
          qty: parsedStock,
          date: format(new Date(), 'yyyy-MM-dd'),
          details: `Old Stock registered via Add Item to Store: ${itemData.description} (Stock: ${parsedStock} ${itemData.unit})`,
          remarks: itemForm.remarks.trim() || 'Old Stock',
          voucherNo: oldStockVoucher,
          companyName: company,
          source: 'store_add_item_old_stock',
          createdAt: new Date().toISOString()
        });

        toast.success(`New store item added with Old Stock: ${parsedStock} ${itemData.unit}!`);
      }

      setShowAddEditModal(false);
    } catch (err) {
      console.error("Error saving store item:", err);
      toast.error("Failed to save store item.");
    }
  };

  // Delete Store Item
  const handleDeleteItem = async (id: string, desc: string) => {
    const itemObj = items.find(i => i.id === id);
    if (!itemObj) return;

    // Role / Company Boundary Validation:
    if (isEmployee && userAccessType === 'admin-light' && userCompanyName) {
      if (itemObj.companyName && itemObj.companyName.toLowerCase() !== userCompanyName.toLowerCase()) {
        toast.error("Unauthorized: You can only delete store items belonging to your company.");
        return;
      }
    }

    // Admin Light Company constraint: items with transactions cannot be deleted
    if (isAdminLight && itemHasTransaction(itemObj)) {
      toast.error("Admin Light Company: इस आइटम में पहले से ट्रांजेक्शन हो चुका है, इसलिए इसे डिलीट नहीं किया जा सकता। (Items with recorded transactions cannot be deleted by Admin Light Company.)");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${desc}" from the Store?`)) return;
    try {
      await archiveDeletedRecord({
        originalCollection: 'store_items',
        originalId: id,
        data: itemObj,
        moduleName: 'Store Inventory Item',
        itemSummary: `${itemObj.description} (PL: ${itemObj.plNo || '-'}, Part: ${itemObj.partNo || '-'}) • Stock: ${itemObj.stock || 0} ${itemObj.unit || 'Nos'}`,
        companyName: (itemObj as any).companyName,
      });
      await deleteDoc(doc(db, 'store_items', id));
      toast.success("Item removed from Store.");
    } catch (err) {
      console.error("Error deleting item:", err);
      toast.error("Failed to delete item.");
    }
  };

  // Open Issue Modal
  const handleOpenIssueModal = (item: StoreItem) => {
    if (item.stock <= 0) {
      toast.error("Cannot issue item with 0 stock.");
      return;
    }
    setSelectedItemToIssue(item);
    setIssueForm({
      plNo: item.plNo || '',
      partNo: item.partNo || '',
      qty: 1,
      targetType: 'machine',
      targetMachine: allMachines[0] || '',
      targetCompany: companiesList[0] || '',
      receiverName: '',
      receiverDesignation: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      remarks: ''
    });
    setShowIssueModal(true);
  };

  // Submit Issue Item from Store
  const handleConfirmIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemToIssue) return;

    // Cross-company validation
    if (isEmployee && userAccessType === 'admin-light' && userCompanyName) {
      if (selectedItemToIssue.companyName && selectedItemToIssue.companyName.toLowerCase() !== userCompanyName.toLowerCase()) {
        toast.error("Unauthorized: You can only issue items belonging to your company.");
        return;
      }
    }

    const issueQty = Number(issueForm.qty);
    if (!issueQty || issueQty <= 0) {
      toast.error("Please enter a valid issue quantity.");
      return;
    }

    if (issueQty > selectedItemToIssue.stock) {
      toast.error(`Cannot issue ${issueQty} units. Only ${selectedItemToIssue.stock} units available in stock.`);
      return;
    }

    const targetName = issueForm.targetType === 'machine' ? issueForm.targetMachine : issueForm.targetCompany;
    if (!targetName.trim()) {
      toast.error(`Please select or enter a target ${issueForm.targetType}.`);
      return;
    }

    setSubmittingIssue(true);

    try {
      const issuerName = currentEmployee?.name || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'STORE OFFICIAL';
      const issuerDesignation = currentEmployee?.designation || 'Store In-Charge';
      const issuingCompany = userCompanyName || selectedItemToIssue.companyName || 'Company Store';

      const generatedIssueNoteNo = `ST-ISS-${Date.now().toString().slice(-6)}`;
      const finalPlNo = issueForm.plNo.trim() || selectedItemToIssue.plNo || '';
      const finalPartNo = issueForm.partNo.trim() || selectedItemToIssue.partNo || '';

      // 1. Deduct stock from store item (and update PL/Part No if updated)
      const newStock = selectedItemToIssue.stock - issueQty;
      await updateDoc(doc(db, 'store_items', selectedItemToIssue.id), {
        stock: newStock,
        totalValue: newStock * selectedItemToIssue.rate,
        plNo: finalPlNo,
        partNo: finalPartNo,
        updatedAt: new Date().toISOString()
      });

      // 2. Create store issue log
      const issueRecordData: Omit<StoreIssueRecord, 'id'> = {
        issueNoteNo: generatedIssueNoteNo,
        storeItemId: selectedItemToIssue.id,
        plNo: finalPlNo,
        partNo: finalPartNo,
        description: selectedItemToIssue.description,
        qty: issueQty,
        unit: selectedItemToIssue.unit || 'Nos',
        rate: selectedItemToIssue.rate || 0,
        totalValue: issueQty * (selectedItemToIssue.rate || 0),
        issuingCompany: issuingCompany,
        targetType: issueForm.targetType,
        targetMachine: issueForm.targetType === 'machine' ? targetName : '',
        targetCompany: issueForm.targetType === 'company' ? targetName : '',
        receiverName: issueForm.receiverName || 'Consignee Officer',
        receiverDesignation: issueForm.receiverDesignation || '',
        issuedBy: issuerName,
        officerDesignation: issuerDesignation,
        date: issueForm.date,
        remarks: issueForm.remarks,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'store_issues'), issueRecordData);

      // 3. Also push to central system `issues` collection
      await addDoc(collection(db, 'issues'), {
        issueNoteNo: generatedIssueNoteNo,
        date: issueForm.date,
        plNo: finalPlNo,
        partNo: finalPartNo,
        description: selectedItemToIssue.description,
        qty: issueQty,
        unit: selectedItemToIssue.unit || 'Nos',
        rate: selectedItemToIssue.rate || 0,
        totalValue: issueQty * (selectedItemToIssue.rate || 0),
        machineName: issueForm.targetType === 'machine' ? targetName : '',
        companyName: issuingCompany,
        receiverName: issueForm.receiverName || 'Consignee Officer',
        remarks: issueForm.remarks || '',
        issuedBy: issuerName,
        createdAt: new Date().toISOString()
      });

      // 4. Generate & Auto-Download PDF Voucher
      try {
        await generateIssueNotePDF({
          issueNoteNo: generatedIssueNoteNo,
          date: issueForm.date,
          plNo: finalPlNo || 'N/A',
          partNo: finalPartNo || 'N/A',
          description: selectedItemToIssue.description,
          qty: issueQty,
          unit: selectedItemToIssue.unit || 'Nos',
          rate: selectedItemToIssue.rate || 0,
          totalValue: issueQty * (selectedItemToIssue.rate || 0),
          issuingDepot: issuingCompany,
          machineName: issueForm.targetType === 'machine' ? targetName : (issueForm.targetCompany || 'Store'),
          issuedTo: issueForm.receiverName ? `${issueForm.receiverName} (${issueForm.receiverDesignation || 'Consignee'})` : 'Consignee Officer',
          issuedBy: issuerName,
          officerName: issuerName,
          officerDesignation: issuerDesignation,
          consigneeDepot: targetName,
          remarks: issueForm.remarks || '',
          zone: 'South East Central Railway'
        }, true);
        toast.success("Issue Voucher PDF generated and downloaded!");
      } catch (pdfErr) {
        console.error("PDF generation error:", pdfErr);
        toast.info("Item issued, but PDF generation encountered an error.");
      }

      toast.success(`Successfully issued ${issueQty} ${selectedItemToIssue.unit} of "${selectedItemToIssue.description}"!`);
      setShowIssueModal(false);
      setActiveTab('history');
    } catch (err) {
      console.error("Error issuing item from store:", err);
      toast.error("Failed to complete issue transaction.");
    } finally {
      setSubmittingIssue(false);
    }
  };

  // Re-download PDF Voucher from History
  const handleRedownloadVoucher = async (record: StoreIssueRecord) => {
    try {
      await generateIssueNotePDF({
        issueNoteNo: record.issueNoteNo,
        date: record.date,
        plNo: record.plNo || '',
        partNo: record.partNo || '',
        description: record.description,
        qty: record.qty,
        unit: record.unit || 'Nos',
        rate: record.rate || 0,
        totalValue: record.totalValue || 0,
        issuingDepot: record.issuingCompany,
        machineName: record.targetMachine || record.targetCompany || 'N/A',
        issuedTo: record.receiverName ? `${record.receiverName} (${record.receiverDesignation || 'Consignee'})` : 'Consignee Officer',
        issuedBy: record.issuedBy,
        officerName: record.issuedBy,
        officerDesignation: record.officerDesignation || 'Store Official',
        consigneeDepot: record.targetMachine || record.targetCompany || 'Consignee Officer',
        remarks: record.remarks || '',
        zone: 'South East Central Railway'
      }, true);
      toast.success(`Voucher ${record.issueNoteNo} downloaded!`);
    } catch (err) {
      console.error("Voucher download error:", err);
      toast.error("Failed to generate voucher PDF.");
    }
  };

  // Export Issue History to Excel
  const handleExportIssueHistoryExcel = () => {
    if (filteredIssueRecords.length === 0) {
      toast.error("No issue history records to export.");
      return;
    }
    const excelData = filteredIssueRecords.map((rec, idx) => ({
      'S.No': idx + 1,
      'Voucher No': rec.issueNoteNo,
      'Date': rec.date,
      'Item Description': rec.description,
      'PL No': rec.plNo || 'N/A',
      'Part No': rec.partNo || 'N/A',
      'Qty Issued': rec.qty,
      'Unit': rec.unit,
      'Rate (₹)': rec.rate,
      'Total Value (₹)': rec.totalValue,
      'Target Destination': rec.targetType === 'machine' ? (rec.targetMachine || 'N/A') : (rec.targetCompany || 'N/A'),
      'Destination Type': rec.targetType === 'machine' ? 'Machine Dispatch' : 'Company Transfer',
      'Received By (Consignee)': rec.receiverName,
      'Receiver Designation': rec.receiverDesignation || 'N/A',
      'Issued By': rec.issuedBy,
      'Officer Designation': rec.officerDesignation || 'N/A',
      'Issuing Company': rec.issuingCompany,
      'Remarks': rec.remarks || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Issue History");
    XLSX.writeFile(workbook, `Company_Store_Issue_History_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success("Issue History Excel exported!");
  };

  // Export Issue History to PDF
  const handleExportIssueHistoryPDF = () => {
    if (filteredIssueRecords.length === 0) {
      toast.error("No issue history records to export.");
      return;
    }
    const docPdf = new jsPDF('landscape', 'mm', 'a4');
    
    // Header Title & Metadata
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(13);
    docPdf.setTextColor(30, 41, 59);
    docPdf.text(`COMPANY STORE - MATERIAL ISSUE HISTORY (${userCompanyName || 'ALL COMPANIES'})`, 14, 13);

    const totalQty = filteredIssueRecords.reduce((acc, item) => acc + (Number(item.qty) || 0), 0);
    const totalVal = filteredIssueRecords.reduce((acc, item) => acc + (Number(item.totalValue) || 0), 0);

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.setTextColor(71, 85, 105);
    const metaLine = `Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Total Issue Records: ${filteredIssueRecords.length} | Total Quantity Issued: ${totalQty} | Total Value: Rs. ${totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    docPdf.text(metaLine, 14, 18);

    if (searchTerm.trim()) {
      docPdf.text(`Search Filter: "${searchTerm.trim()}"`, 14, 22);
    }

    const tableData = filteredIssueRecords.map((rec, idx) => [
      idx + 1,
      rec.issueNoteNo || '-',
      rec.date || '-',
      rec.description || '-',
      rec.plNo || '-',
      rec.partNo || '-',
      `${rec.qty} ${rec.unit}`,
      rec.targetType === 'machine' ? `Machine:\n${rec.targetMachine || '-'}` : `Company:\n${rec.targetCompany || '-'}`,
      `${rec.receiverName || '-'}${rec.receiverDesignation ? `\n(${rec.receiverDesignation})` : ''}`,
      `${rec.issuedBy || '-'}${rec.officerDesignation ? `\n(${rec.officerDesignation})` : ''}`,
      rec.remarks || '-'
    ]);

    autoTable(docPdf, {
      startY: searchTerm.trim() ? 25 : 21,
      head: [['#', 'Voucher No', 'Date', 'Issued Item', 'PL No', 'Part No', 'Qty', 'Destination', 'Received By', 'Issued By', 'Remarks']],
      body: tableData,
      theme: 'grid',
      tableLineColor: [148, 163, 184],
      tableLineWidth: 0.2,
      styles: {
        fontSize: 7,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.15,
        cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
        valign: 'middle',
        font: 'helvetica'
      },
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        lineWidth: 0.15,
        lineColor: [67, 56, 202],
        halign: 'center',
        valign: 'middle'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 26, halign: 'center' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 'auto', halign: 'left' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 20, halign: 'center' },
        6: { cellWidth: 18, halign: 'center' },
        7: { cellWidth: 28, halign: 'left' },
        8: { cellWidth: 30, halign: 'left' },
        9: { cellWidth: 30, halign: 'left' },
        10: { cellWidth: 24, halign: 'left' }
      },
      didDrawPage: (data) => {
        const pageCount = docPdf.getNumberOfPages();
        docPdf.setFontSize(7.5);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${data.pageNumber} of ${pageCount}`, docPdf.internal.pageSize.width - 25, docPdf.internal.pageSize.height - 6);
      }
    });

    docPdf.save(`Company_Store_Issue_History_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success("Issue History PDF report generated!");
  };

  // Export Store Items or Issue History to Excel
  const handleExportExcel = () => {
    if (activeTab === 'history') {
      handleExportIssueHistoryExcel();
      return;
    }
    if (filteredItems.length === 0) {
      toast.error("No store items to export.");
      return;
    }
    const excelData = filteredItems.map((item, idx) => ({
      'S.No': idx + 1,
      'PL No': item.plNo || 'N/A',
      'Item Description': item.description,
      'Part No': item.partNo || 'N/A',
      'Category': item.category,
      'Unit': item.unit,
      'Stock Qty': item.stock,
      'Rate (₹)': item.rate,
      'Total Value (₹)': item.totalValue,
      'Location': item.location || 'N/A',
      'Condition': item.itemCondition,
      'Company': item.companyName,
      'Remarks': item.remarks || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Company Store");
    XLSX.writeFile(workbook, `Company_Store_Stock_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success("Excel sheet exported!");
  };

  // Export Store Items or Issue History to PDF
  const handleExportPDF = () => {
    if (activeTab === 'history') {
      handleExportIssueHistoryPDF();
      return;
    }
    if (filteredItems.length === 0) {
      toast.error("No store items to export.");
      return;
    }
    const docPdf = new jsPDF('landscape', 'mm', 'a4');
    
    // Header Title & Metadata
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(13);
    docPdf.setTextColor(30, 41, 59);
    docPdf.text(`COMPANY STORE STOCK INVENTORY (${userCompanyName || 'ALL COMPANIES'})`, 14, 13);

    const totalStock = filteredItems.reduce((acc, item) => acc + (Number(item.stock) || 0), 0);
    const totalVal = filteredItems.reduce((acc, item) => {
      const rate = Number(item.rate) || 0;
      const stock = Number(item.stock) || 0;
      const tv = Number(item.totalValue);
      return acc + (!Number.isNaN(tv) && tv > 0 ? tv : rate * stock);
    }, 0);

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.setTextColor(71, 85, 105);
    const metaLine = `Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Total Items: ${filteredItems.length} | Total Stock: ${totalStock} | Total Value: Rs. ${totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    docPdf.text(metaLine, 14, 18);

    const filterInfo = `Category: ${categoryFilter !== 'all' ? categoryFilter : 'All'} | Condition: ${conditionFilter !== 'all' ? conditionFilter : 'All'}`;
    docPdf.text(filterInfo, 14, 22);

    const tableData = filteredItems.map((item, idx) => [
      idx + 1,
      item.plNo || '-',
      item.description || '-',
      item.partNo || '-',
      item.category || '-',
      item.unit || 'Nos',
      item.stock ?? 0,
      (Number.isNaN(Number(item.rate)) ? 0 : Number(item.rate || 0)).toFixed(2),
      (Number.isNaN(Number(item.totalValue)) ? Number((item.rate || 0) * (item.stock || 0)) : Number(item.totalValue || 0)).toFixed(2),
      item.location || '-',
      item.itemCondition || 'New'
    ]);

    autoTable(docPdf, {
      startY: 25,
      head: [['#', 'PL No', 'Description', 'Part No', 'Category', 'Unit', 'Stock', 'Rate', 'Total Value', 'Location', 'Condition']],
      body: tableData,
      theme: 'grid',
      tableLineColor: [148, 163, 184],
      tableLineWidth: 0.2,
      styles: {
        fontSize: 7.5,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.15,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        valign: 'middle',
        font: 'helvetica'
      },
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        lineWidth: 0.15,
        lineColor: [67, 56, 202],
        halign: 'center',
        valign: 'middle'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 24, halign: 'center' },
        2: { cellWidth: 'auto', halign: 'left' },
        3: { cellWidth: 26, halign: 'left' },
        4: { cellWidth: 22, halign: 'center' },
        5: { cellWidth: 14, halign: 'center' },
        6: { cellWidth: 16, halign: 'center', overflow: 'visible' },
        7: { cellWidth: 22, halign: 'right', overflow: 'visible' },
        8: { cellWidth: 26, halign: 'right', overflow: 'visible' },
        9: { cellWidth: 20, halign: 'center' },
        10: { cellWidth: 20, halign: 'center' }
      },
      didDrawPage: (data) => {
        const pageCount = docPdf.getNumberOfPages();
        docPdf.setFontSize(7.5);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${data.pageNumber} of ${pageCount}`, docPdf.internal.pageSize.width - 25, docPdf.internal.pageSize.height - 6);
      }
    });

    docPdf.save(`Company_Store_Inventory_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF report generated!");
  };

  // Restrict access: strictly only for Company Admin (admin-light) and Master Admin (ADMIN)
  // Not allowed for: zonal admin, divisional admin, full admin, or regular employees
  if (isEmployee && userAccessType !== 'admin-light') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Restricted</h2>
        <p className="text-sm text-slate-500 max-w-md mb-6">
          The Store Inventory module is exclusively available for Company Admin (Admin-Light) and Master Admin accounts. Your account does not have permission to view this module.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-4 md:p-5 text-white shadow-md relative overflow-hidden border border-slate-800">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-indigo-500/10 backdrop-blur-3xl rounded-l-full pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-indigo-300 text-[10px] font-black tracking-wide uppercase">
              <Building2 size={12} />
              {userCompanyName || 'Company Store & Dispatch'}
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2">
              <StoreIcon className="text-indigo-400 stroke-[2.5]" size={24} />
              Company Store Inventory
            </h1>
            <p className="text-[11px] md:text-xs text-slate-300 font-medium max-w-xl">
              Store company parts, spares & consumables. Dispatch and issue items directly to machines or other companies with automated PDF Vouchers.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnlyAdmin && (
              <>
                <button
                  id="connected-materials-btn"
                  onClick={handleOpenConnectedMaterials}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/30 transition-all active:scale-95"
                  title="Log Connected Material Receipt into Store"
                >
                  <Layers size={14} />
                  Connected Materials
                </button>
                <button
                  id="add-item-store-btn"
                  onClick={handleOpenAdd}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95"
                >
                  <Plus size={14} />
                  Add Item to Store
                </button>
              </>
            )}
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs transition-all border border-white/10"
              title={activeTab === 'history' ? "Export Issue History to Excel" : "Export Inventory to Excel"}
            >
              <Download size={13} />
              {activeTab === 'history' ? 'Excel (Issues)' : 'Excel'}
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs transition-all border border-white/10"
              title={activeTab === 'history' ? "Export Issue History to PDF" : "Export Inventory to PDF"}
            >
              <FileText size={13} />
              {activeTab === 'history' ? 'PDF (Issues)' : 'PDF Report'}
            </button>
          </div>
        </div>

        {/* Stats Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3.5 pt-3 border-t border-white/10">
          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-lg p-2.5 px-3.5 shadow-sm flex items-center justify-between transition-all hover:bg-white/15">
            <div>
              <span className="text-slate-300 text-[10px] font-bold uppercase tracking-wider block">Total Items</span>
              <span className="text-base md:text-lg font-black text-white mt-0.5 tracking-tight block">{stats.totalItems}</span>
            </div>
            <div className="p-1.5 bg-indigo-500/20 rounded-md shrink-0">
              <Package className="text-indigo-300" size={14} />
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-lg p-2.5 px-3.5 shadow-sm flex items-center justify-between transition-all hover:bg-white/15">
            <div>
              <span className="text-indigo-200 text-[10px] font-bold uppercase tracking-wider block">Total Stock Qty</span>
              <span className="text-base md:text-lg font-black text-indigo-300 mt-0.5 tracking-tight block">{stats.totalQty}</span>
            </div>
            <div className="p-1.5 bg-indigo-500/20 rounded-md shrink-0">
              <Layers className="text-indigo-300" size={14} />
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-lg p-2.5 px-3.5 shadow-sm flex items-center justify-between transition-all hover:bg-white/15">
            <div>
              <span className="text-emerald-200 text-[10px] font-bold uppercase tracking-wider block">Total Store Valuation</span>
              <span className="text-base md:text-lg font-black text-emerald-300 mt-0.5 tracking-tight block">₹{stats.totalVal.toLocaleString('en-IN')}</span>
            </div>
            <div className="p-1.5 bg-emerald-500/20 rounded-md shrink-0">
              <TrendingUp className="text-emerald-300" size={14} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Header & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-2.5 md:p-3 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 w-full md:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('inventory')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
              activeTab === 'inventory'
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Package size={14} />
            Store Stock ({filteredItems.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
              activeTab === 'history'
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Send size={14} />
            Issue History ({filteredIssueRecords.length})
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search item, PL, part, location..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Filters Bar for Inventory Tab */}
      {activeTab === 'inventory' && (
        <div className="flex flex-wrap items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 shadow-sm">
          <span className="flex items-center gap-1 text-slate-400 uppercase tracking-wider text-[10px] font-bold mr-1">
            <Filter size={12} /> Filters:
          </span>

          {/* Category Filter */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-[11px]">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs font-medium text-slate-800 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Categories</option>
              {availableCategoriesForFilter.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Condition Filter */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-[11px]">Condition:</span>
            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs font-medium text-slate-800 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Conditions</option>
              <option value="New">New</option>
              <option value="Serviceable">Serviceable</option>
              <option value="Released">Released</option>
            </select>
          </div>

          {/* Company Filter (for Master admin) */}
          {!isEmployee && companiesList.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-slate-500 text-[11px]">Company:</span>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs font-medium text-slate-800 focus:ring-1 focus:ring-indigo-500 max-w-[160px] truncate"
              >
                <option value="all">All Companies</option>
                {companiesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 flex flex-col items-center justify-center space-y-2 shadow-sm">
          <RefreshCw size={24} className="animate-spin text-indigo-600" />
          <p className="text-xs font-medium">Loading store inventory...</p>
        </div>
      ) : activeTab === 'inventory' ? (
        /* Inventory Table */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">PL No / Part No</th>
                  <th className="py-2.5 px-3">Item Description</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3 text-center">Condition</th>
                  <th className="py-2.5 px-3 text-center">Stock</th>
                  <th className="py-2.5 px-3 text-right">Rate (₹)</th>
                  <th className="py-2.5 px-3 text-right">Valuation (₹)</th>
                  <th className="py-2.5 px-3 text-center">Location</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-normal text-slate-700">
                {paginatedItems.map((item, idx) => {
                  const absoluteIdx = (inventoryPage - 1) * inventoryPageSize + idx + 1;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">{absoluteIdx}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-slate-900 text-xs">{item.plNo || '-'}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{item.partNo || 'No Part #'}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{item.description}</div>
                        {item.companyName && (
                          <div className="text-[10px] text-indigo-600 font-medium">{item.companyName}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold uppercase">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold inline-block",
                          item.itemCondition === 'New' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                          item.itemCondition === 'Serviceable' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                          "bg-slate-100 text-slate-600 border border-slate-200"
                        )}>
                          {item.itemCondition}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg text-xs font-bold inline-flex items-center gap-1",
                          item.stock <= 0 ? "bg-rose-50 text-rose-700 border border-rose-200" :
                          item.stock <= 5 ? "bg-amber-50 text-amber-800 border border-amber-200" :
                          "bg-indigo-50 text-indigo-700 border border-indigo-100"
                        )}>
                          {item.stock} {item.unit}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-800 text-xs">
                        ₹{item.rate.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 text-xs">
                        ₹{item.totalValue.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-600 text-xs">
                        {item.location || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            id={`view-item-history-${item.id}`}
                            onClick={() => handleOpenItemHistory(item)}
                            className="p-1 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                            title="View Item History (आइटम हिस्ट्री देखें)"
                          >
                            <Eye size={14} />
                          </button>
                          {!isReadOnlyAdmin && !(isAdminLight && itemHasTransaction(item)) && (
                            <>
                              <button
                                id={`edit-item-${item.id}`}
                                onClick={() => handleOpenEdit(item)}
                                className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                                title="Edit Item"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                id={`delete-item-${item.id}`}
                                onClick={() => handleDeleteItem(item.id, item.description)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                                title="Delete Item"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-1">
                        <Package size={28} className="text-slate-300 stroke-[1.5]" />
                        <p className="text-xs font-bold">No store items found.</p>
                        <p className="text-[10px]">Click "Add Item to Store" above to stock items for your company.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls for Store Inventory Table (10 rows per page) */}
          {filteredItems.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 bg-slate-50/90 border-t border-slate-200 text-xs">
              <div className="text-slate-500 font-medium">
                Showing <span className="font-bold text-slate-800">{(inventoryPage - 1) * inventoryPageSize + 1}</span> to{' '}
                <span className="font-bold text-slate-800">{Math.min(inventoryPage * inventoryPageSize, filteredItems.length)}</span> of{' '}
                <span className="font-bold text-slate-800">{filteredItems.length}</span> items
                <span className="text-indigo-600 font-semibold text-[11px] ml-1.5">(10 rows per page)</span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  id="btn-inventory-prev"
                  onClick={() => setInventoryPage(p => Math.max(1, p - 1))}
                  disabled={inventoryPage <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
                  title="Previous 10 items"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>

                {/* Page number buttons */}
                {totalInventoryPages > 1 && (
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalInventoryPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalInventoryPages || Math.abs(p - inventoryPage) <= 1)
                      .map((p, idx, arr) => {
                        const prevPage = arr[idx - 1];
                        const showEllipsis = prevPage && p - prevPage > 1;
                        return (
                          <React.Fragment key={p}>
                            {showEllipsis && <span className="px-1 text-slate-400 font-bold">...</span>}
                            <button
                              type="button"
                              onClick={() => setInventoryPage(p)}
                              className={cn(
                                "w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-all cursor-pointer",
                                inventoryPage === p
                                  ? "bg-indigo-600 text-white shadow-xs"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {p}
                            </button>
                          </React.Fragment>
                        );
                      })}
                  </div>
                )}

                <div className="px-3 py-1 bg-white border border-slate-200 rounded-xl font-mono font-bold text-slate-700 shadow-xs">
                  Page {inventoryPage} of {totalInventoryPages}
                </div>

                <button
                  type="button"
                  id="btn-inventory-next"
                  onClick={() => setInventoryPage(p => Math.min(totalInventoryPages, p + 1))}
                  disabled={inventoryPage >= totalInventoryPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
                  title="Next 10 items"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Issue History Table */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold shrink-0">
                <FileText size={16} />
              </div>
              <div>
                <div className="text-xs font-black text-slate-800 uppercase tracking-wide">Issue Vouchers & Material Outward History</div>
                <div className="text-[11px] text-slate-500 font-medium">
                  Showing {filteredIssueRecords.length} records • Total items issued: {filteredIssueRecords.reduce((acc, r) => acc + (Number(r.qty) || 0), 0)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportIssueHistoryExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition-all border border-slate-200 shadow-xs active:scale-95"
                title="Export Issue History to Excel"
              >
                <Download size={13} />
                <span>Excel</span>
              </button>
              <button
                onClick={handleExportIssueHistoryPDF}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition-all shadow-xs shadow-indigo-600/20 active:scale-95"
                title="Export Issue History to PDF Report"
              >
                <FileText size={13} />
                <span>Export PDF</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Voucher No & Date</th>
                  <th className="py-2.5 px-3">Issued Item</th>
                  <th className="py-2.5 px-3 text-center">Qty Issued</th>
                  <th className="py-2.5 px-3">Target Destination</th>
                  <th className="py-2.5 px-3">Received By (Consignee)</th>
                  <th className="py-2.5 px-3">Issued By</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-normal text-slate-700">
                {paginatedIssueRecords.map((rec, idx) => {
                  const absoluteIdx = (issuePage - 1) * issuePageSize + idx + 1;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">{absoluteIdx}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-indigo-600 text-xs">{rec.issueNoteNo}</div>
                        <div className="text-[10px] text-slate-500">{rec.date}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{rec.description}</div>
                        <div className="text-[10px] font-mono text-slate-500">PL: {rec.plNo || 'N/A'} | Part: {rec.partNo || 'N/A'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg font-bold text-xs inline-block">
                          {rec.qty} {rec.unit}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">
                          {rec.targetMachine ? `Machine: ${rec.targetMachine}` : rec.targetCompany || 'Store'}
                        </div>
                        <span className="text-[10px] text-indigo-600 font-semibold uppercase">
                          {rec.targetType === 'machine' ? 'Machine Dispatch' : 'Company Transfer'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{rec.receiverName}</div>
                        <div className="text-[10px] text-slate-500">{rec.receiverDesignation || 'Consignee Officer'}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{rec.issuedBy}</div>
                        <div className="text-[10px] text-slate-500">{rec.officerDesignation || 'Store Official'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            id={`download-voucher-${rec.id}`}
                            onClick={() => handleRedownloadVoucher(rec)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-bold text-xs transition-colors border border-indigo-200 shadow-xs"
                            title="Download Issue Voucher PDF"
                          >
                            <Download size={12} />
                            Voucher PDF
                          </button>
                          {isMainAdmin && (
                            <>
                              <button
                                id={`admin-edit-issue-${rec.id}`}
                                onClick={() => handleOpenEditIssue(rec)}
                                className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                                title="Main Admin: Edit Issue Record"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                id={`admin-delete-issue-${rec.id}`}
                                onClick={() => handleDeleteIssue(rec)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                                title="Main Admin: Delete Issue Record & Restore Stock"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredIssueRecords.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-1">
                        <Send size={28} className="text-slate-300 stroke-[1.5]" />
                        <p className="text-xs font-bold">No store issue records found.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls for Issue History Table (10 rows per page) */}
          {filteredIssueRecords.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 bg-slate-50/90 border-t border-slate-200 text-xs">
              <div className="text-slate-500 font-medium">
                Showing <span className="font-bold text-slate-800">{(issuePage - 1) * issuePageSize + 1}</span> to{' '}
                <span className="font-bold text-slate-800">{Math.min(issuePage * issuePageSize, filteredIssueRecords.length)}</span> of{' '}
                <span className="font-bold text-slate-800">{filteredIssueRecords.length}</span> records
                <span className="text-slate-400 text-[11px] ml-1.5">(10 rows per page)</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-issue-prev"
                  onClick={() => setIssuePage(p => Math.max(1, p - 1))}
                  disabled={issuePage <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
                  title="Previous 10 records"
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>

                <div className="px-3 py-1 bg-white border border-slate-200 rounded-xl font-mono font-bold text-slate-700 shadow-xs">
                  Page {issuePage} of {totalIssuePages}
                </div>

                <button
                  type="button"
                  id="btn-issue-next"
                  onClick={() => setIssuePage(p => Math.min(totalIssuePages, p + 1))}
                  disabled={issuePage >= totalIssuePages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
                  title="Next 10 records"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Store Item Modal (Landscape Layout) */}
      <AnimatePresence>
        {showAddEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
              onClick={() => setShowAddEditModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-3xl p-6 md:p-8 shadow-2xl border border-slate-200 z-10 space-y-6 overflow-hidden max-h-[92vh] overflow-y-auto text-left"
            >
              {/* Datalists for auto-complete */}
              <datalist id="store-plNo-options">
                {Array.from(new Set([
                  ...catalogParts.map(p => p.plNo).filter(Boolean),
                  ...items.map(i => i.plNo).filter(Boolean)
                ])).map((pl: any) => (
                  <option key={pl} value={pl} />
                ))}
              </datalist>

              <datalist id="store-partNo-options">
                {Array.from(new Set([
                  ...catalogParts.map(p => p.partNo).filter(Boolean),
                  ...items.map(i => i.partNo).filter(Boolean)
                ])).map((pn: any) => (
                  <option key={pn} value={pn} />
                ))}
              </datalist>

              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200">
                    <StoreIcon size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-slate-900">
                        {editingItem ? 'Edit Store Item' : 'Add Item to Company Store'}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Enter PL No or Part No to auto-fill matching catalog details automatically.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddEditModal(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Duplicate Item Alert Banner */}
              {duplicateWarning && (
                <div className="flex items-start gap-3 p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 text-xs animate-fadeIn">
                  <AlertCircle size={20} className="text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-black text-rose-800 text-sm">
                      Duplicate Item Detected ({duplicateWarning.reasons})
                    </div>
                    <p className="mt-0.5 text-rose-700 font-medium">
                      An item with this PL No. or Part No. already exists in Store inventory:
                      <strong className="block mt-0.5 text-rose-950 font-bold">
                        "{duplicateWarning.item.description}" • Current Stock: {duplicateWarning.item.stock} {duplicateWarning.item.unit || 'Nos'} • PL: {duplicateWarning.item.plNo || '-'} • Part: {duplicateWarning.item.partNo || '-'}
                      </strong>
                    </p>
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">
                      Duplicate entry is not allowed. To add more stock, use Connected Materials or update the existing item.
                    </p>
                  </div>
                </div>
              )}

              {/* Auto-match Alert Banner (shown only when no duplicate is detected) */}
              {!duplicateWarning && autoMatchedInfo && (
                <div className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-bold animate-fadeIn">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  <span>{autoMatchedInfo}</span>
                </div>
              )}

              <form onSubmit={handleSaveItem} className="space-y-6">
                {/* Section 1: Item Identification & Auto-Match */}
                <div className="p-4 bg-slate-50/70 border border-slate-100 rounded-2xl space-y-4">
                  <div className="text-xs font-black uppercase tracking-wider text-indigo-900/70 flex items-center gap-2">
                    <Layers size={14} className="text-indigo-600" />
                    1. Item Identification & Catalog Search
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* PL No */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">PL No (Code)</label>
                      <input
                        list="store-plNo-options"
                        type="text"
                        value={itemForm.plNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemForm(prev => ({ ...prev, plNo: val }));
                          matchAndAutoFillStoreForm('plNo', val);
                        }}
                        onBlur={(e) => matchAndAutoFillStoreForm('plNo', e.target.value)}
                        placeholder="Type PL No to search..."
                        className={cn(
                          "w-full px-3.5 py-2.5 bg-white border rounded-xl text-xs font-mono font-bold text-slate-800 outline-none transition-all",
                          duplicateWarning && duplicateWarning.reasons.includes('PL No')
                            ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 bg-rose-50/30 text-rose-900"
                            : "border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        )}
                      />
                      {duplicateWarning && duplicateWarning.reasons.includes('PL No') && (
                        <span className="text-[10px] text-rose-600 font-bold mt-1 block">Already exists in store!</span>
                      )}
                    </div>

                    {/* Part No */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Part No / Model</label>
                      <input
                        list="store-partNo-options"
                        type="text"
                        value={itemForm.partNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemForm(prev => ({ ...prev, partNo: val }));
                          matchAndAutoFillStoreForm('partNo', val);
                        }}
                        onBlur={(e) => matchAndAutoFillStoreForm('partNo', e.target.value)}
                        placeholder="Type Part No to search..."
                        className={cn(
                          "w-full px-3.5 py-2.5 bg-white border rounded-xl text-xs font-mono font-bold text-slate-800 outline-none transition-all",
                          duplicateWarning && duplicateWarning.reasons.includes('Part No')
                            ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 bg-rose-50/30 text-rose-900"
                            : "border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        )}
                      />
                      {duplicateWarning && duplicateWarning.reasons.includes('Part No') && (
                        <span className="text-[10px] text-rose-600 font-bold mt-1 block">Already exists in store!</span>
                      )}
                    </div>

                    {/* Category */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                      <select
                        value={itemForm.category}
                        onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      >
                        {STANDARD_STORE_CATEGORIES.map(c => (
                          <option key={c} value={c}>{c === 'Other' ? 'Other (Type Custom Category)' : c}</option>
                        ))}
                      </select>
                      {itemForm.category === 'Other' && (
                        <input
                          type="text"
                          required
                          placeholder="Type custom category name..."
                          value={itemForm.customCategory}
                          onChange={(e) => setItemForm({ ...itemForm, customCategory: e.target.value })}
                          className="w-full mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                        />
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Item Description / Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={itemForm.description}
                      onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                      placeholder="e.g. Brake Shoe, Oil Filter, Hydraulic Pump Seal"
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Section 2: Stock & Valuation */}
                <div className="p-4 bg-slate-50/70 border border-slate-100 rounded-2xl space-y-4">
                  <div className="text-xs font-black uppercase tracking-wider text-indigo-900/70 flex items-center gap-2">
                    <Package size={14} className="text-indigo-600" />
                    2. Inventory Stock & Valuation (Old Stock Entry)
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                    {/* Stock Qty */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Stock Qty (Old Stock) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        value={itemForm.stock}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setItemForm(prev => ({ ...prev, stock: val }));
                          }
                        }}
                        placeholder="e.g. 10 or 0.5"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
                      <span className="text-[10px] text-amber-700 font-semibold mt-1 block">
                        Saved as Old Stock in item history
                      </span>
                    </div>

                    {/* Unit of Measure */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Unit of Measure</label>
                      <select
                        value={itemForm.unit}
                        onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      >
                        {STANDARD_STORE_UOMS.map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                      {itemForm.unit === 'Other' && (
                        <input
                          type="text"
                          required
                          placeholder="Type custom unit..."
                          value={itemForm.customUnit}
                          onChange={(e) => setItemForm({ ...itemForm, customUnit: e.target.value })}
                          className="w-full mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                        />
                      )}
                    </div>

                    {/* Rate */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Rate per Unit (₹)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={itemForm.rate}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setItemForm(prev => ({ ...prev, rate: val }));
                          }
                        }}
                        placeholder="e.g. 150 or 25.50"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>

                    {/* Total Value Readout */}
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Total Stock Value</label>
                      <div className="px-3.5 py-2.5 bg-indigo-50/80 border border-indigo-100 rounded-xl text-sm font-black text-indigo-900 flex items-center justify-between">
                        <span>₹{((parseFloat(String(itemForm.stock)) || 0) * (parseFloat(String(itemForm.rate)) || 0)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Storage Location & Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Condition */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Item Condition</label>
                    <select
                      value={itemForm.itemCondition}
                      onChange={(e) => setItemForm({ ...itemForm, itemCondition: e.target.value as any })}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    >
                      <option value="New">New Item</option>
                      <option value="Serviceable">Serviceable / Reconditioned</option>
                      <option value="Released">Released Old Item</option>
                    </select>
                  </div>

                  {/* Location */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Storage Rack / Bin Location</label>
                    <input
                      type="text"
                      value={itemForm.location}
                      onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
                      placeholder="e.g. Rack B-3, Bin 12, Shelf 2"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Remarks / Specifications</label>
                    <textarea
                      rows={2}
                      value={itemForm.remarks}
                      onChange={(e) => setItemForm({ ...itemForm, remarks: e.target.value })}
                      placeholder="Optional notes or additional item specifications..."
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <div className="text-xs text-slate-400 font-medium">
                    Storing for: <span className="font-bold text-slate-700">{userCompanyName || currentEmployee?.companyName || 'General Store'}</span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowAddEditModal(false)}
                      className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={Boolean(duplicateWarning)}
                      title={duplicateWarning ? `Cannot save: Item with same ${duplicateWarning.reasons} already exists in store` : undefined}
                      className={cn(
                        "px-6 py-2.5 font-bold text-xs rounded-xl shadow-lg transition-all",
                        duplicateWarning
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-300"
                          : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 cursor-pointer"
                      )}
                    >
                      {editingItem ? 'Save Changes' : 'Add Item to Store'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Issue Item Modal */}
      <AnimatePresence>
        {showIssueModal && selectedItemToIssue && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
              onClick={() => setShowIssueModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 z-10 space-y-5 overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                    <Send className="text-indigo-600" size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800">Issue Item from Store</h3>
                    <p className="text-[10px] text-slate-400 font-bold">Generates official PDF Issue Note Voucher</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowIssueModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Selected Item Summary Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">Selected Store Item</div>
                  <span className="text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md text-xs font-black">
                    Available Stock: {selectedItemToIssue.stock} {selectedItemToIssue.unit}
                  </span>
                </div>
                <div className="text-sm font-black text-slate-900">{selectedItemToIssue.description}</div>
                
                {/* PL & Part No Fields */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className={`p-2.5 rounded-xl border ${isNaOrEmpty(selectedItemToIssue.plNo) ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="mb-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">PL No</label>
                    </div>
                    {isNaOrEmpty(selectedItemToIssue.plNo) ? (
                      <input
                        type="text"
                        value={issueForm.plNo}
                        onChange={(e) => setIssueForm({ ...issueForm, plNo: e.target.value })}
                        placeholder="Type PL No..."
                        className="w-full bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={issueForm.plNo}
                        disabled
                        className="w-full bg-slate-100/90 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono font-bold text-slate-700 cursor-not-allowed"
                      />
                    )}
                  </div>

                  <div className={`p-2.5 rounded-xl border ${isNaOrEmpty(selectedItemToIssue.partNo) ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="mb-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Part No</label>
                    </div>
                    {isNaOrEmpty(selectedItemToIssue.partNo) ? (
                      <input
                        type="text"
                        value={issueForm.partNo}
                        onChange={(e) => setIssueForm({ ...issueForm, partNo: e.target.value })}
                        placeholder="Type Part No..."
                        className="w-full bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={issueForm.partNo}
                        disabled
                        className="w-full bg-slate-100/90 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono font-bold text-slate-700 cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>
              </div>

              <form onSubmit={handleConfirmIssue} className="space-y-4">
                {/* Target Type Selector */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Issue Target Destination</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIssueForm({ ...issueForm, targetType: 'machine' })}
                      className={cn(
                        "py-2 px-3 rounded-xl text-xs font-black transition-all border",
                        issueForm.targetType === 'machine'
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      To Railway Machine
                    </button>
                    <button
                      type="button"
                      onClick={() => setIssueForm({
                        ...issueForm,
                        targetType: 'company',
                        targetCompany: issueForm.targetCompany || (companiesList.length > 0 ? companiesList[0] : '')
                      })}
                      className={cn(
                        "py-2 px-3 rounded-xl text-xs font-black transition-all border",
                        issueForm.targetType === 'company'
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      To Other Company / Unit
                    </button>
                  </div>
                </div>

                {/* Machine or Company Selection */}
                {issueForm.targetType === 'machine' ? (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Select Target Machine <span className="text-rose-500">*</span></label>
                    <select
                      required
                      value={issueForm.targetMachine}
                      onChange={(e) => setIssueForm({ ...issueForm, targetMachine: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    >
                      <option value="">-- Select Machine --</option>
                      {allMachines.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Select Target Registered Company <span className="text-rose-500">*</span></label>
                    <select
                      required
                      value={issueForm.targetCompany}
                      onChange={(e) => setIssueForm({ ...issueForm, targetCompany: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    >
                      <option value="">-- Select Registered Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {companiesList.length === 0 && (
                      <p className="text-[11px] text-amber-600 font-semibold mt-1">
                        No registered companies found in the system yet.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Issue Qty */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex justify-between">
                      <span>Issue Quantity <span className="text-rose-500">*</span></span>
                      <span className="text-[11px] font-black text-indigo-600 uppercase">{selectedItemToIssue.unit || 'Nos'}</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      min={0.001}
                      max={selectedItemToIssue.stock}
                      value={issueForm.qty}
                      onChange={(e) => setIssueForm({ ...issueForm, qty: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                      placeholder="e.g. 1 or 0.1"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>

                  {/* Date */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Issue Date</label>
                    <input
                      type="date"
                      value={issueForm.date}
                      onChange={(e) => setIssueForm({ ...issueForm, date: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Receiver Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Received By / Consignee</label>
                    <input
                      type="text"
                      value={issueForm.receiverName}
                      onChange={(e) => setIssueForm({ ...issueForm, receiverName: e.target.value })}
                      placeholder="e.g. R. K. Sharma"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>

                  {/* Receiver Designation */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Receiver Designation</label>
                    <input
                      type="text"
                      value={issueForm.receiverDesignation}
                      onChange={(e) => setIssueForm({ ...issueForm, receiverDesignation: e.target.value })}
                      placeholder="e.g. SSE/TM, Junior Engineer"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>

                {/* Remarks */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Remarks / Issue Reason</label>
                  <textarea
                    rows={2}
                    value={issueForm.remarks}
                    onChange={(e) => setIssueForm({ ...issueForm, remarks: e.target.value })}
                    placeholder="e.g. Issued for emergency breakdown replacement..."
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>

                {/* Modal Footer */}
                <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingIssue}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                  >
                    {submittingIssue ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Issuing & Generating PDF...
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        Confirm & Issue PDF Voucher
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Connected Material Receipt Modal (Mirrors Unconnected Material Receipt & Updates Store Inventory Entry) */}
      <AnimatePresence>
        {showConnectedModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8 border border-slate-200"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-sm">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900">Connected Material Receipt</h2>
                    <p className="text-[11px] text-slate-500 font-semibold">
                      Log received materials and update existing Store Inventory entry (केवल स्टोर में बने आइटम ही अपडेट होंगे)
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowConnectedModal(false)} 
                  className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveConnectedReceipt} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-left">
                {/* Notice banner about restriction */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-800 font-medium">
                  <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold text-amber-900">Store Item Required:</strong> Connected Materials केवल वही आइटम अपडेट कर सकता है जो स्टोर इन्वेंट्री में पहले से मौजूद (Created) है। नीचे दी गई लिस्ट से स्टोर का आइटम चुनें।
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Select Item Created in Store */}
                  <div className="md:col-span-2 bg-emerald-50/70 border border-emerald-200/90 rounded-xl p-3.5 shadow-xs">
                    <label className="block text-xs font-bold uppercase text-emerald-950 mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Package size={14} className="text-emerald-700" />
                        Select Item Created in Store (स्टोर में बना आइटम चुनें) *
                      </span>
                      <span className="text-[10px] text-emerald-700 normal-case font-bold bg-emerald-100/80 px-2 py-0.5 rounded-md">
                        {items.length} Store Items Available
                      </span>
                    </label>
                    <select
                      id="connected-store-item-select"
                      required
                      className="w-full border border-emerald-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 outline-none transition-all font-bold text-slate-800 bg-white"
                      value={connectedForm.selectedStoreItemId}
                      onChange={e => handleSelectStoreItemForConnected(e.target.value)}
                    >
                      <option value="">-- Choose Item Created in Store --</option>
                      {items.map(i => (
                        <option key={i.id} value={i.id}>
                          {i.description} {i.partNo ? `[Part: ${i.partNo}]` : ''} {i.plNo ? `[PL: ${i.plNo}]` : ''} • Current Stock: {i.stock} {i.unit}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Voucher No. */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Voucher No.</label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed select-none"
                      placeholder=""
                      value={connectedForm.voucherNo}
                    />
                  </div>

                  {/* Returned Date */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Returned Date</label>
                    <input
                      type="date"
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={connectedForm.returnedDate}
                      onChange={e => setConnectedForm(prev => ({ ...prev, returnedDate: e.target.value }))}
                    />
                  </div>

                  {/* Company Name */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Name</label>
                    <select
                      required
                      disabled={isEmployee && userAccessType === 'admin-light' && Boolean(userCompanyName)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-700 bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      value={connectedForm.companyName}
                      onChange={e => setConnectedForm(prev => ({ ...prev, companyName: e.target.value }))}
                    >
                      <option value="">-- Select Company --</option>
                      {companiesList.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* Part No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Part No.</label>
                    <input
                      list="connected-partNo-options"
                      type="text"
                      placeholder="Type or select Part No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-800"
                      value={connectedForm.partNo}
                      onChange={e => handleConnectedPartNoChange(e.target.value)}
                    />
                  </div>

                  {/* PL No with Searchable Datalist */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">PL No.</label>
                    <input
                      list="connected-plNo-options"
                      type="text"
                      placeholder="Type or select PL No."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-800"
                      value={connectedForm.plNo}
                      onChange={e => handleConnectedPlNoChange(e.target.value)}
                    />
                  </div>

                  {/* Part Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description</label>
                    <textarea
                      rows={2}
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-slate-800 font-medium"
                      placeholder="Enter part description..."
                      value={connectedForm.description}
                      onChange={e => setConnectedForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-700"
                      placeholder="e.g. Rack A1"
                      value={connectedForm.location}
                      onChange={e => setConnectedForm(prev => ({ ...prev, location: e.target.value }))}
                    />
                  </div>

                  {/* Old Qty (Current Store Stock) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Old Qty (Current Store Stock)</label>
                    <input
                      type="number"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800 cursor-not-allowed"
                      value={connectedCurrentStoreStock}
                    />
                  </div>

                  {/* Quantity Returned */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Quantity Returned (Received Qty)</label>
                    <input
                      type="number"
                      required
                      min="0.0001"
                      step="any"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-800"
                      value={connectedForm.qtyReturned}
                      onChange={e => setConnectedForm(prev => ({ ...prev, qtyReturned: e.target.value }))}
                    />
                  </div>

                  {/* Unit of Measure */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Unit of Measure (इकाई)</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-700 bg-white"
                      value={connectedForm.unit}
                      onChange={e => setConnectedForm(prev => ({ ...prev, unit: e.target.value }))}
                    >
                      {STANDARD_STORE_UOMS.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    {connectedForm.unit === 'Other' && (
                      <input
                        type="text"
                        required
                        placeholder="Type custom unit (e.g. Barrel, Litre...)"
                        className="w-full mt-2 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-800 bg-emerald-50/50"
                        value={connectedForm.customUnit}
                        onChange={e => setConnectedForm(prev => ({ ...prev, customUnit: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Transaction Qty (Disabled, read-only showing total count) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Transaction Qty (Total Count)</label>
                    <input
                      type="text"
                      disabled
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-slate-100 font-black text-slate-800 cursor-not-allowed"
                      value={connectedForm.qtyReturned || 0}
                    />
                  </div>

                  {/* Helper / Status Preview */}
                  <div className="flex flex-col justify-center">
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded-xl p-2.5">
                      New Store Stock will become: <strong className="text-emerald-900 text-sm">{connectedCurrentStoreStock + (parseFloat(String(connectedForm.qtyReturned)) || 0)} {connectedForm.unit === 'Other' ? connectedForm.customUnit || 'Units' : connectedForm.unit}</strong>
                    </span>
                  </div>

                  {/* Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Remarks</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-slate-800 font-medium"
                      placeholder="Enter any additional remarks..."
                      value={connectedForm.remarks}
                      onChange={e => setConnectedForm(prev => ({ ...prev, remarks: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Form Footer Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowConnectedModal(false)}
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={connectedSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold shadow-md shadow-emerald-600/20 hover:shadow-emerald-600/30 transition-all text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {connectedSubmitting ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        Updating Store...
                      </>
                    ) : (
                      <>
                        <Layers size={15} />
                        Log Receipt & Update Store
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Item History Modal with Inward & Outward Transactions & Admin Controls */}
      <StoreItemHistoryModal
        isOpen={showItemHistoryModal}
        onClose={() => {
          setShowItemHistoryModal(false);
          setSelectedHistoryItem(null);
        }}
        item={selectedHistoryItem}
        issues={issueRecords}
        receipts={connectedReceipts}
        isMainAdmin={isMainAdmin}
        onEditIssue={(rec) => {
          handleOpenEditIssue(rec);
        }}
        onDeleteIssue={(rec) => {
          handleDeleteIssue(rec);
        }}
        onDownloadVoucher={(rec) => {
          handleRedownloadVoucher(rec);
        }}
      />

      {/* Main Admin Edit Issue Modal */}
      <StoreEditIssueModal
        isOpen={showEditIssueModal}
        onClose={() => {
          setShowEditIssueModal(false);
          setEditingIssue(null);
        }}
        issue={editingIssue}
        allMachines={allMachines}
        companiesList={companiesList}
        currentStoreStock={
          editingIssue ? (
            items.find(i => i.id === editingIssue.storeItemId)?.stock ?? 
            items.find(i => (i.partNo && i.partNo === editingIssue.partNo) || (i.plNo && i.plNo === editingIssue.plNo))?.stock ?? 0
          ) : 0
        }
        onSave={handleSaveEditIssue}
        loading={editIssueSubmitting}
      />

      {/* Datalists for Connected Materials & Store Items (Restricted strictly to Store items) */}
      <datalist id="connected-partNo-options">
        {items.filter(i => i.partNo).map(item => (
          <option key={`store-part-${item.id}`} value={item.partNo}>
            {item.partNo} - {item.description} (Store Stock: {item.stock} {item.unit || 'Nos'})
          </option>
        ))}
      </datalist>

      <datalist id="connected-plNo-options">
        {items.filter(i => i.plNo).map(item => (
          <option key={`store-pl-${item.id}`} value={item.plNo}>
            {item.plNo} - {item.description} (Store Stock: {item.stock} {item.unit || 'Nos'})
          </option>
        ))}
      </datalist>
    </div>
  );
}
