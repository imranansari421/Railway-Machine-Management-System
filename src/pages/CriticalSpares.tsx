import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { 
  ShieldAlert, 
  Upload, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Download, 
  FileSpreadsheet, 
  Filter, 
  Layers, 
  Loader2, 
  Check, 
  X, 
  FileText, 
  RefreshCw, 
  Send, 
  Cpu, 
  ArrowUpDown,
  Building2,
  AlertCircle,
  RotateCcw,
  Archive,
  Lock,
  Undo2,
  History,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Tag
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { archiveDeletedRecord } from '../utils/recycleBin';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { motion, AnimatePresence } from 'motion/react';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { cn } from '../lib/utils';
import { findEmployeeForUser, getFilterAccessPermissions } from '../utils/employee';

export interface CriticalSpareItem {
  id: string;
  plNo: string;
  partNo: string;
  description: string;
  requiredQty: number;
  unit: string;
  category: string;
  machineName?: string;
  creatorMachine?: string;
  zone?: string;
  division?: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
  createdByEmail?: string;
  createdByUid?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedByEmail?: string;
  deletedByMachine?: string;
  deletedReason?: string;
  restoredAt?: string;
  restoredByEmail?: string;
}

export interface InventoryPart {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
  machineName?: string;
  category?: string;
  companyName?: string;
  whetherUse?: string;
  itemCondition?: string;
}

export default function CriticalSpares() {
  const navigate = useNavigate();

  // Core Data States
  const [criticalItems, setCriticalItems] = useState<CriticalSpareItem[]>([]);
  const [inventoryParts, setInventoryParts] = useState<InventoryPart[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'adequate' | 'low' | 'critical'>('all');
  const [selectedMachine, setSelectedMachine] = useState(() => {
    return auth.currentUser ? localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) || 'all' : 'all';
  });
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filterZone, setFilterZone] = useState(() => {
    return auth.currentUser ? localStorage.getItem(`userZone_${auth.currentUser.uid}`) || 'all' : 'all';
  });
  const [filterDivision, setFilterDivision] = useState(() => {
    return auth.currentUser ? localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || 'all' : 'all';
  });
  const [selectedCompany, setSelectedCompany] = useState('all');

  // User & RBAC Context
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com') ||
    (typeof window !== 'undefined' && localStorage.getItem(`loginPortal_${auth.currentUser?.uid}`) === 'employee');
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });
  const isMasterAdmin = auth.currentUser?.email === 'imranansari399605@gmail.com' || (
    !isEmployee &&
    userAccessType !== 'admin-light' &&
    userAccessType !== 'zonal-admin' &&
    userAccessType !== 'divisional-admin'
  );
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });
  const [userMachine, setUserMachine] = useState(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserZone, setCurrentUserZone] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`userZone_${auth.currentUser.uid}`) || '' : '';
  });
  const [currentUserDivision, setCurrentUserDivision] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || '' : '';
  });
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, userAccessType, employeeProfile, {
      machineName: userMachine,
      zone: currentUserZone,
      division: currentUserDivision,
    });
  }, [isEmployee, userAccessType, employeeProfile, userMachine, currentUserZone, currentUserDivision]);

  const isCompanyAdmin = isEmployee && userAccessType === 'full';
  const isZonalAdmin = isEmployee && userAccessType === 'zonal-admin';
  const isDivisionalAdmin = isEmployee && userAccessType === 'divisional-admin';

  // Active vs Soft-Deleted / Archived Items
  const activeCriticalItems = useMemo(() => {
    return criticalItems.filter(item => !item.isDeleted);
  }, [criticalItems]);

  const deletedCriticalItems = useMemo(() => {
    return criticalItems.filter(item => Boolean(item.isDeleted));
  }, [criticalItems]);

  // Aux Data & Dynamic Mappings
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [machineToCompany, setMachineToCompany] = useState<Record<string, string>>({});
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CriticalSpareItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<CriticalSpareItem | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  // Master Admin Restore Center Modal States
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreMachineFilter, setRestoreMachineFilter] = useState('all');
  const [restoreSearchTerm, setRestoreSearchTerm] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Authority & Ownership Check:
  // ONLY the machine that uploaded / added the item can edit or delete it.
  // Other machines, Company Admin, Zonal Admin, Divisional Admin CANNOT delete/edit/clear.
  // Master Admin has supervision & restore capabilities.
  const canManageItem = (item: CriticalSpareItem) => {
    if (isMasterAdmin) return true;
    if (isCompanyAdmin || isZonalAdmin || isDivisionalAdmin) {
      return false;
    }
    if (userMachine) {
      const itemMachine = item.creatorMachine || item.machineName;
      return itemMachine === userMachine || item.machineName === userMachine;
    }
    return false;
  };

  // Check if current user can trigger "Clear All"
  const canUserClearAll = () => {
    if (isMasterAdmin) return true;
    if (isCompanyAdmin || isZonalAdmin || isDivisionalAdmin) return false;
    return Boolean(userMachine && userMachine !== 'all');
  };

  // PDF Upload & AI Extraction States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedItems, setAnalyzedItems] = useState<any[]>([]);
  const [extractedTitle, setExtractedTitle] = useState('');
  const [targetMachineForUpload, setTargetMachineForUpload] = useState('all');
  const [isSavingParsed, setIsSavingParsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State for Add / Edit
  const [formData, setFormData] = useState({
    plNo: '',
    partNo: '',
    description: '',
    requiredQty: 1,
    unit: 'Nos',
    category: 'General',
    machineName: 'all',
    remarks: ''
  });

  // Load User Context
  useEffect(() => {
    const initUser = async () => {
      if (!auth.currentUser) return;
      const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      if (emp) {
        setEmployeeProfile(emp);
        setUserAccessType(emp.accessType || 'limited');
        setUserMachine(emp.machineName || '');
        setCurrentUserCompanyName(emp.companyName || '');
        if (emp.zone) {
          setFilterZone(emp.zone);
          setCurrentUserZone(emp.zone);
        }
        if (emp.division) {
          setFilterDivision(emp.division);
          setCurrentUserDivision(emp.division);
        }
        if (emp.machineName) {
          setSelectedMachine(emp.machineName);
        }
      }
    };
    initUser();
  }, []);

  // Listen to Settings
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
      }
    });
    return () => unsub();
  }, []);

  // Listen to Machine Positions
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

  // Listen to Employees
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'employees'), (snap) => {
      const emps = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      setEmployeeList(emps);
      const uniqueCos = Array.from(new Set(emps.map(e => e.companyName).filter(Boolean))) as string[];
      setCompaniesList(uniqueCos);
      const m2c: Record<string, string> = {};
      emps.forEach(e => {
        if (e.machineName && e.companyName) {
          m2c[e.machineName] = e.companyName;
        }
      });
      setMachineToCompany(m2c);
    });
    return () => unsub();
  }, []);

  // Real-time Critical Spares subscription
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'critical_spares'), (snap) => {
      const items = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as CriticalSpareItem));
      setCriticalItems(items);
      setLoading(false);
    }, (error) => {
      console.error('Error listening to critical spares:', error);
      toast.error('Failed to load critical spares data');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Real-time Parts / Inventory subscription
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'parts'), (snap) => {
      const parts = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as InventoryPart));
      setInventoryParts(parts);
    });
    return () => unsub();
  }, []);

  // Combined Machine List
  const allMachinesList = useMemo(() => {
    const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    const partMachines = inventoryParts.map(p => p.machineName).filter(Boolean) as string[];
    const critMachines = criticalItems.map(c => c.machineName).filter(Boolean) as string[];
    return Array.from(new Set([...defaultList, ...settingsMachines, ...partMachines, ...critMachines])).filter(Boolean).sort();
  }, [settingsMachines, inventoryParts, criticalItems]);

  // Categories List
  const categoriesList = useMemo(() => {
    const defaultCats = [
      "Tamping Unit",
      "Hydraulic System",
      "Engine & Transmission",
      "Electrical & Electronics",
      "Pneumatic System",
      "Workhead & Tools",
      "Braking System",
      "Sensors & Controls",
      "Filters & Consumables",
      "General"
    ];
    const itemCats = criticalItems.map(i => i.category).filter(Boolean) as string[];
    return Array.from(new Set([...defaultCats, ...itemCats])).sort();
  }, [criticalItems]);

  // -------------------------------------------------------------
  // Filter Synchronization Handlers
  // -------------------------------------------------------------
  const handleSelectMachine = (mach: string) => {
    if (!filterPerms.canChangeMachine) return;
    setSelectedMachine(mach);
    if (mach !== 'all') {
      const pos = machinePositions[mach];
      if (pos) {
        if (pos.zone && filterPerms.canChangeZone) {
          setFilterZone(pos.zone);
        }
        if (pos.division && filterPerms.canChangeDivision) {
          setFilterDivision(pos.division);
        }
      }
      const co = machineToCompany[mach];
      if (co && !isEmployee) {
        setSelectedCompany(co);
      }
    }
  };

  const handleSelectZone = (z: string) => {
    if (!filterPerms.canChangeZone) return;
    setFilterZone(z);
    setFilterDivision('all');
    if (z !== 'all' && selectedMachine !== 'all') {
      const pos = machinePositions[selectedMachine];
      if (pos && pos.zone && pos.zone !== z) {
        setSelectedMachine('all');
      }
    }
  };

  const handleSelectDivision = (d: string) => {
    if (!filterPerms.canChangeDivision) return;
    setFilterDivision(d);
    if (d !== 'all' && selectedMachine !== 'all') {
      const pos = machinePositions[selectedMachine];
      if (pos && pos.division && pos.division !== d) {
        setSelectedMachine('all');
      }
    }
  };

  const handleSelectCompany = (comp: string) => {
    setSelectedCompany(comp);
    if (comp !== 'all' && selectedMachine !== 'all') {
      const machCo = machineToCompany[selectedMachine];
      if (machCo && machCo !== comp) {
        setSelectedMachine('all');
      }
    }
  };

  // -------------------------------------------------------------
  // Inventory Matching Logic & Color-Coding Calculation (Priority: Part No.)
  // -------------------------------------------------------------
  const criticalItemsWithMatch = useMemo(() => {
    return activeCriticalItems.map(item => {
      // Find matching parts in parts inventory primarily by PART NO.
      const itemPartRaw = (item.partNo || '').trim();
      const normItemPart = itemPartRaw.replace(/[\s\-_/.]/g, '').toLowerCase();

      const itemPlRaw = (item.plNo || '').trim();
      const normItemPl = itemPlRaw.replace(/\s+/g, '').toLowerCase();

      const itemDescRaw = (item.description || '').trim().toLowerCase();

      const matchedParts = inventoryParts.filter(p => {
        // Machine scope match:
        // If filter is specific machine, scope to that machine
        if (selectedMachine !== 'all' && p.machineName && p.machineName !== selectedMachine) {
          return false;
        }

        // Zone scope match
        if (filterZone !== 'all') {
          const pos = machinePositions[p.machineName || ''];
          if (pos && pos.zone && pos.zone !== filterZone) return false;
        }

        // Division scope match
        if (filterDivision !== 'all') {
          const pos = machinePositions[p.machineName || ''];
          if (pos && pos.division && pos.division !== filterDivision) return false;
        }

        // Item-level machine targeting
        if (item.machineName && item.machineName !== 'all' && p.machineName && p.machineName !== item.machineName) {
          return false;
        }

        const pPartRaw = (p.partNo || '').trim();
        const normPPart = pPartRaw.replace(/[\s\-_/.]/g, '').toLowerCase();

        const pPlRaw = (p.plNo || '').trim();
        const normPPl = pPlRaw.replace(/\s+/g, '').toLowerCase();

        const pDescRaw = (p.description || '').trim().toLowerCase();

        // 1. PRIMARY MATCH: Strict & Normalized Part No. matching
        if (normItemPart && normPPart) {
          if (normItemPart === normPPart) return true;
          if (itemPartRaw.toLowerCase() === pPartRaw.toLowerCase()) return true;
          if (normItemPart.length >= 4 && normPPart.length >= 4) {
            if (normItemPart.startsWith(normPPart) || normPPart.startsWith(normItemPart)) return true;
          }
        }

        // Check if Part No is present in inventory Part Description or PL
        if (normItemPart && normItemPart.length >= 4) {
          if (normPPl && normPPl === normItemPart) return true;
          const cleanPDesc = pDescRaw.replace(/[\s\-_/.]/g, '');
          if (cleanPDesc.includes(normItemPart)) return true;
        }

        // 2. SECONDARY MATCH: PL Number match
        if (normItemPl && normPPl && normItemPl === normPPl) {
          return true;
        }

        // 3. TERTIARY MATCH: Fallback to exact description match only if Part No & PL are not specified
        if (!normItemPart && !normItemPl && itemDescRaw.length > 5 && pDescRaw === itemDescRaw) {
          return true;
        }

        return false;
      });

      const totalInventoryStock = matchedParts.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
      const isMatched = matchedParts.length > 0;
      const reqQty = Number(item.requiredQty) || 1;
      const deficit = reqQty - totalInventoryStock;

      let status: 'adequate' | 'low' | 'critical';
      if (totalInventoryStock >= reqQty && totalInventoryStock > 0) {
        // Green: Inventory stock is greater than or equal to required
        status = 'adequate';
      } else if (totalInventoryStock > 0 && totalInventoryStock < reqQty) {
        // Yellow: Available stock is less than required (low stock)
        status = 'low';
      } else {
        // Red: Stock is zero OR item not found in inventory
        status = 'critical';
      }

      return {
        ...item,
        matchedParts,
        totalInventoryStock,
        isMatched,
        deficit,
        status
      };
    });
  }, [activeCriticalItems, inventoryParts, selectedMachine, filterZone, filterDivision, machinePositions]);

  // Filtered List based on Search & Status
  const filteredCriticalItems = useMemo(() => {
    return criticalItemsWithMatch.filter(item => {
      // Status Filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // Machine Filter
      if (selectedMachine !== 'all') {
        if (item.machineName && item.machineName !== 'all' && item.machineName !== selectedMachine) {
          return false;
        }
      }

      // Category Filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }

      // Search Filter
      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        const matchesPl = (item.plNo || '').toLowerCase().includes(q);
        const matchesPart = (item.partNo || '').toLowerCase().includes(q);
        const matchesDesc = (item.description || '').toLowerCase().includes(q);
        const matchesCat = (item.category || '').toLowerCase().includes(q);
        const matchesMachine = (item.machineName || '').toLowerCase().includes(q);
        if (!matchesPl && !matchesPart && !matchesDesc && !matchesCat && !matchesMachine) {
          return false;
        }
      }

      return true;
    });
  }, [criticalItemsWithMatch, statusFilter, selectedMachine, selectedCategory, searchTerm]);

  // KPI Metrics
  const kpis = useMemo(() => {
    const total = criticalItemsWithMatch.length;
    const adequate = criticalItemsWithMatch.filter(i => i.status === 'adequate').length;
    const low = criticalItemsWithMatch.filter(i => i.status === 'low').length;
    const critical = criticalItemsWithMatch.filter(i => i.status === 'critical').length;
    const healthPercentage = total > 0 ? Math.round((adequate / total) * 100) : 100;

    return {
      total,
      adequate,
      low,
      critical,
      healthPercentage
    };
  }, [criticalItemsWithMatch]);

  // Category-wise Grouping of Filtered Critical Spares
  const categoryGroupedItems = useMemo(() => {
    const groups: { [cat: string]: typeof filteredCriticalItems } = {};

    filteredCriticalItems.forEach(item => {
      const cat = (item.category || 'General').trim();
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat].push(item);
    });

    const sortedCats = Object.keys(groups).sort((a, b) => a.localeCompare(b));

    return sortedCats.map(cat => {
      const items = groups[cat];
      const adequateCount = items.filter(i => i.status === 'adequate').length;
      const lowCount = items.filter(i => i.status === 'low').length;
      const criticalCount = items.filter(i => i.status === 'critical').length;
      return {
        category: cat,
        items,
        totalCount: items.length,
        adequateCount,
        lowCount,
        criticalCount
      };
    });
  }, [filteredCriticalItems]);

  // Category Collapse State for UI
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleCategoryCollapse = (cat: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  const expandAllCategories = () => {
    setCollapsedCategories({});
  };

  const collapseAllCategories = () => {
    const allCollapsed: Record<string, boolean> = {};
    categoryGroupedItems.forEach(g => {
      allCollapsed[g.category] = true;
    });
    setCollapsedCategories(allCollapsed);
  };

  // -------------------------------------------------------------
  // PDF & File Upload + AI Parsing
  // -------------------------------------------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setExtractedTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleStartAnalysis = async () => {
    if (!uploadFile) {
      toast.error('Please select a PDF or Excel document to analyze.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const fileName = uploadFile.name;
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls') || fileName.toLowerCase().endsWith('.csv');

      if (isPdf) {
        // Convert to Base64 for Gemini Server Proxy
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(uploadFile);
        });

        const base64Data = await base64Promise;

        const response = await fetch('/api/analyze-critical-spares-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            pdfBase64: base64Data,
            mimeType: 'application/pdf',
            fileName: uploadFile.name
          })
        });

        const rawResponseText = await response.text();
        let data: any = null;

        try {
          data = JSON.parse(rawResponseText);
        } catch {
          // If response is HTML (e.g. server restart or gateway timeout)
          if (rawResponseText.includes('<!DOCTYPE') || rawResponseText.includes('<html')) {
            throw new Error('Server connection was briefly interrupted. Please click Start Analysis again.');
          }
          throw new Error('Unable to parse server response. Please try again or import via Excel/CSV.');
        }

        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to extract items from PDF.');
        }

        if (!data.items || data.items.length === 0) {
          toast.warning('No spare parts items could be recognized in this PDF. Please check the document format or add items manually.');
          setAnalyzedItems([]);
        } else {
          setExtractedTitle(data.documentTitle || uploadFile.name);
          if (data.machineName) {
            setTargetMachineForUpload(data.machineName);
          }
          setAnalyzedItems(data.items.map((item: any) => ({
            ...item,
            selected: true
          })));
          toast.success(`Successfully analyzed! Found ${data.items.length} critical spare parts.`);
        }
      } else if (isExcel) {
        // Direct Client-Side Excel/CSV Parser
        const data = await uploadFile.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });

        if (jsonData.length < 2) {
          toast.error('The selected Excel file is empty or missing headers.');
          setIsAnalyzing(false);
          return;
        }

        const headers = (jsonData[0] as string[]).map(h => String(h || '').toLowerCase().trim());
        
        // Find column indices
        const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('item') || h.includes('name') || h.includes('part name'));
        const partNoIdx = headers.findIndex(h => h.includes('part no') || h.includes('cat no') || h.includes('part') || h.includes('drawing'));
        const plNoIdx = headers.findIndex(h => h.includes('pl') || h.includes('pl no') || h.includes('code'));
        const qtyIdx = headers.findIndex(h => h.includes('qty') || h.includes('req') || h.includes('critical') || h.includes('sanction') || h.includes('min'));
        const unitIdx = headers.findIndex(h => h.includes('unit') || h.includes('uom'));
        const catIdx = headers.findIndex(h => h.includes('cat') || h.includes('system') || h.includes('group'));
        const machineIdx = headers.findIndex(h => h.includes('machine') || h.includes('model'));

        const parsedRows: any[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (!row || row.length === 0) continue;

          const desc = descIdx !== -1 ? String(row[descIdx] || '').trim() : '';
          const partNo = partNoIdx !== -1 ? String(row[partNoIdx] || '').trim() : '';
          const plNo = plNoIdx !== -1 ? String(row[plNoIdx] || '').trim() : '';

          if (!desc && !partNo && !plNo) continue;

          const rawQty = qtyIdx !== -1 ? row[qtyIdx] : 1;
          const requiredQty = Math.max(1, Number(rawQty) || 1);
          const unit = unitIdx !== -1 && row[unitIdx] ? String(row[unitIdx]).trim() : 'Nos';
          const category = catIdx !== -1 && row[catIdx] ? String(row[catIdx]).trim() : 'General';
          const machine = machineIdx !== -1 && row[machineIdx] ? String(row[machineIdx]).trim() : '';

          parsedRows.push({
            tempId: `excel_${Date.now()}_${i}`,
            plNo,
            partNo,
            description: desc || partNo || `Spare Part #${i}`,
            requiredQty,
            unit,
            category,
            machineName: machine,
            remarks: 'Imported from Excel',
            selected: true
          });
        }

        setAnalyzedItems(parsedRows);
        toast.success(`Imported ${parsedRows.length} items from spreadsheet.`);
      }
    } catch (error: any) {
      let errMsg = error?.message || 'Failed to analyze document.';
      try {
        if (errMsg.includes('{')) {
          const jsonSub = errMsg.slice(errMsg.indexOf('{'), errMsg.lastIndexOf('}') + 1);
          const parsed = JSON.parse(jsonSub);
          if (parsed?.error?.message) {
            errMsg = parsed.error.message;
          } else if (parsed?.error && typeof parsed.error === 'string') {
            errMsg = parsed.error;
          }
        }
      } catch {
        // Keep clean errMsg
      }
      
      if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
        errMsg = 'The AI model is experiencing high demand. Please click Start Analysis again or upload an Excel/CSV file.';
      }
      
      toast.error(errMsg, { duration: 5000 });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveParsedItems = async (mode: 'append' | 'replace') => {
    const selectedRows = analyzedItems.filter(i => i.selected);
    if (selectedRows.length === 0) {
      toast.error('No items selected to save.');
      return;
    }

    setIsSavingParsed(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const userEmail = auth.currentUser?.email || '';
      const userUid = auth.currentUser?.uid || '';
      const targetMach = targetMachineForUpload !== 'all' ? targetMachineForUpload : (userMachine || 'all');

      // If replace mode, only soft-delete current active items belonging to this target machine
      if (mode === 'replace') {
        const itemsToSoftReplace = activeCriticalItems.filter(item => {
          if (targetMach !== 'all') {
            return item.machineName === targetMach || item.creatorMachine === targetMach;
          }
          return true;
        });

        itemsToSoftReplace.forEach(item => {
          batch.update(doc(db, 'critical_spares', item.id), {
            isDeleted: true,
            deletedAt: now,
            deletedByEmail: userEmail,
            deletedByMachine: userMachine || targetMach,
            deletedReason: 'replaced_via_upload'
          });
        });
      }

      selectedRows.forEach(row => {
        const itemMachine = targetMach !== 'all' ? targetMach : (row.machineName || userMachine || 'all');
        const newDocRef = doc(collection(db, 'critical_spares'));
        batch.set(newDocRef, {
          plNo: row.plNo || '',
          partNo: row.partNo || '',
          description: row.description || '',
          requiredQty: Number(row.requiredQty) || 1,
          unit: row.unit || 'Nos',
          category: row.category || 'General',
          machineName: itemMachine,
          creatorMachine: userMachine || itemMachine,
          remarks: row.remarks || '',
          createdAt: now,
          updatedAt: now,
          createdByEmail: userEmail,
          createdByUid: userUid,
          isDeleted: false
        });
      });

      await batch.commit();
      toast.success(`Successfully saved ${selectedRows.length} Critical Spare items for machine ${targetMach}!`);
      setShowUploadModal(false);
      setUploadFile(null);
      setAnalyzedItems([]);
    } catch (error: any) {
      console.error('Error saving parsed items:', error);
      toast.error('Failed to save items to database.');
    } finally {
      setIsSavingParsed(false);
    }
  };

  // -------------------------------------------------------------
  // Manual Add / Edit / Delete Handlers (with Machine Ownership & Soft-Delete)
  // -------------------------------------------------------------
  const handleOpenAddModal = () => {
    setFormData({
      plNo: '',
      partNo: '',
      description: '',
      requiredQty: 1,
      unit: 'Nos',
      category: 'General',
      machineName: userMachine || (selectedMachine !== 'all' ? selectedMachine : 'all'),
      remarks: ''
    });
    setShowAddModal(true);
  };

  const handleSaveAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description && !formData.partNo && !formData.plNo) {
      toast.error('Please enter at least Item Description or Part No.');
      return;
    }

    try {
      const now = new Date().toISOString();
      const effectiveMachine = userMachine || formData.machineName || 'all';
      await addDoc(collection(db, 'critical_spares'), {
        plNo: formData.plNo.trim(),
        partNo: formData.partNo.trim(),
        description: formData.description.trim(),
        requiredQty: Math.max(1, Number(formData.requiredQty) || 1),
        unit: formData.unit.trim() || 'Nos',
        category: formData.category.trim() || 'General',
        machineName: effectiveMachine,
        creatorMachine: userMachine || effectiveMachine,
        remarks: formData.remarks.trim(),
        createdAt: now,
        updatedAt: now,
        createdByEmail: auth.currentUser?.email || '',
        createdByUid: auth.currentUser?.uid || '',
        isDeleted: false
      });

      toast.success('Critical spare item added successfully');
      setShowAddModal(false);
    } catch (error) {
      console.error('Error adding critical spare:', error);
      toast.error('Failed to add item');
    }
  };

  const handleOpenEditModal = (item: CriticalSpareItem) => {
    if (!canManageItem(item)) {
      toast.error(`Permission denied: Only machine "${item.creatorMachine || item.machineName || 'Owner'}" can edit this item.`);
      return;
    }
    setEditingItem(item);
    setFormData({
      plNo: item.plNo || '',
      partNo: item.partNo || '',
      description: item.description || '',
      requiredQty: item.requiredQty || 1,
      unit: item.unit || 'Nos',
      category: item.category || 'General',
      machineName: item.machineName || 'all',
      remarks: item.remarks || ''
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    if (!canManageItem(editingItem)) {
      toast.error(`Permission denied: Only the machine that uploaded this item can edit it.`);
      return;
    }

    try {
      const itemRef = doc(db, 'critical_spares', editingItem.id);
      await updateDoc(itemRef, {
        plNo: formData.plNo.trim(),
        partNo: formData.partNo.trim(),
        description: formData.description.trim(),
        requiredQty: Math.max(1, Number(formData.requiredQty) || 1),
        unit: formData.unit.trim() || 'Nos',
        category: formData.category.trim() || 'General',
        machineName: formData.machineName || 'all',
        remarks: formData.remarks.trim(),
        updatedAt: new Date().toISOString()
      });

      toast.success('Critical spare item updated');
      setShowEditModal(false);
      setEditingItem(null);
    } catch (error) {
      console.error('Error updating critical spare:', error);
      toast.error('Failed to update item');
    }
  };

  // Soft Delete: Sets isDeleted: true so data is removed from machine view but preserved on server
  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    if (!canManageItem(itemToDelete)) {
      toast.error(`Permission denied: Only machine "${itemToDelete.creatorMachine || itemToDelete.machineName || 'Owner'}" can delete this item.`);
      return;
    }

    try {
      const itemRef = doc(db, 'critical_spares', itemToDelete.id);
      await updateDoc(itemRef, {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedByEmail: auth.currentUser?.email || '',
        deletedByMachine: userMachine || itemToDelete.creatorMachine || itemToDelete.machineName || 'Unknown Machine',
        deletedReason: 'manual_delete'
      });

      toast.success(`"${itemToDelete.description}" removed from machine view (preserved in server archive).`);
      setShowDeleteConfirm(false);
      setItemToDelete(null);
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error('Failed to remove item');
    }
  };

  // Soft Clear All: Only clears active items uploaded by / assigned to this user's machine
  const handleClearAll = async () => {
    let targetItems: CriticalSpareItem[] = [];

    if (isMasterAdmin) {
      if (selectedMachine !== 'all') {
        targetItems = activeCriticalItems.filter(i => (i.creatorMachine === selectedMachine || i.machineName === selectedMachine));
      } else {
        targetItems = activeCriticalItems;
      }
    } else if (userMachine) {
      // Machine user: ONLY clear items belonging to their machine
      targetItems = activeCriticalItems.filter(i => (i.creatorMachine === userMachine || i.machineName === userMachine));
    } else {
      toast.error('Permission denied: Only machine operators can clear their machine critical spares.');
      return;
    }

    if (targetItems.length === 0) {
      toast.info('No active critical spares found to clear.');
      setShowClearAllConfirm(false);
      return;
    }

    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const userEmail = auth.currentUser?.email || '';
      const actingMachine = userMachine || (selectedMachine !== 'all' ? selectedMachine : 'Admin');

      targetItems.forEach(item => {
        batch.update(doc(db, 'critical_spares', item.id), {
          isDeleted: true,
          deletedAt: now,
          deletedByEmail: userEmail,
          deletedByMachine: actingMachine,
          deletedReason: 'clear_all'
        });
      });

      await batch.commit();
      toast.success(`Cleared ${targetItems.length} spares for machine ${actingMachine} (safely archived on server).`);
      setShowClearAllConfirm(false);
    } catch (error) {
      console.error('Error clearing critical spares:', error);
      toast.error('Failed to clear items');
    }
  };

  // -------------------------------------------------------------
  // Master Admin: Restore & Recovery Handlers
  // -------------------------------------------------------------
  const handleRestoreItem = async (item: CriticalSpareItem) => {
    setIsRestoring(true);
    try {
      const itemRef = doc(db, 'critical_spares', item.id);
      await updateDoc(itemRef, {
        isDeleted: false,
        restoredAt: new Date().toISOString(),
        restoredByEmail: auth.currentUser?.email || ''
      });
      toast.success(`Returned "${item.description}" to machine ${item.machineName || item.creatorMachine || 'All'}!`);
    } catch (error) {
      console.error('Error restoring item:', error);
      toast.error('Failed to restore item');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreAllForMachine = async (mach: string) => {
    const itemsToRestore = deletedCriticalItems.filter(i => {
      if (mach === 'all') return true;
      return i.creatorMachine === mach || i.machineName === mach;
    });

    if (itemsToRestore.length === 0) {
      toast.info('No archived items to restore for this selection.');
      return;
    }

    setIsRestoring(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const email = auth.currentUser?.email || '';

      itemsToRestore.forEach(item => {
        batch.update(doc(db, 'critical_spares', item.id), {
          isDeleted: false,
          restoredAt: now,
          restoredByEmail: email
        });
      });

      await batch.commit();
      toast.success(`Successfully restored ${itemsToRestore.length} critical spare(s) back to machine!`);
    } catch (error) {
      console.error('Error batch restoring items:', error);
      toast.error('Failed to restore items');
    } finally {
      setIsRestoring(false);
    }
  };

  const handlePermanentDelete = async (itemId: string) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can permanently purge database records.');
      return;
    }
    try {
      const itemObj = criticalItems.find(s => s.id === itemId);
      if (itemObj) {
        await archiveDeletedRecord({
          originalCollection: 'critical_spares',
          originalId: itemId,
          data: itemObj,
          moduleName: 'Critical Spares Target Item',
          itemSummary: `${itemObj.description} (PL: ${itemObj.plNo || '-'}, Part: ${itemObj.partNo || '-'}) • Target: ${itemObj.requiredQty} ${itemObj.unit || 'Nos'}`,
          machineName: itemObj.machineName,
          companyName: (itemObj as any).companyName,
        });
      }
      await deleteDoc(doc(db, 'critical_spares', itemId));
      toast.success('Record deleted and moved to Recycle Bin.');
    } catch (error) {
      console.error('Error permanently deleting:', error);
      toast.error('Failed to delete record');
    }
  };

  // -------------------------------------------------------------
  // Quick Action: Redirect to Demand Generation
  // -------------------------------------------------------------
  const handleCreateDemandFromShortage = (item: any) => {
    const shortageQty = Math.max(1, item.deficit > 0 ? item.deficit : item.requiredQty);
    navigate('/demand', {
      state: {
        prefillDemand: {
          plNo: item.plNo || '',
          partNo: item.partNo || '',
          description: item.description || '',
          qty: shortageQty,
          unit: item.unit || 'Nos',
          machineName: item.machineName !== 'all' ? item.machineName : (selectedMachine !== 'all' ? selectedMachine : userMachine)
        }
      }
    });
  };

  // -------------------------------------------------------------
  // Export Capabilities (PDF & Excel) - Category-Wise
  // -------------------------------------------------------------
  const exportToExcel = () => {
    if (filteredCriticalItems.length === 0) {
      toast.error('No items to export.');
      return;
    }

    // Sort export rows by Category first, then Description
    const sortedForExcel = [...filteredCriticalItems].sort((a, b) => {
      const catCompare = (a.category || 'General').localeCompare(b.category || 'General');
      if (catCompare !== 0) return catCompare;
      return (a.description || '').localeCompare(b.description || '');
    });

    const exportRows = sortedForExcel.map((item, idx) => ({
      'S.No': idx + 1,
      'Category': item.category || 'General',
      'Status': item.status === 'adequate' ? 'Fully Stocked (Green)' : item.status === 'low' ? 'Low Stock (Yellow)' : 'Critical / Missing (Red)',
      'PL No': item.plNo || '-',
      'Part No': item.partNo || '-',
      'Description': item.description,
      'Target Machine': item.machineName === 'all' || !item.machineName ? 'All Machines' : item.machineName,
      'Critical Required Qty': item.requiredQty,
      'Live Inventory Stock': item.totalInventoryStock,
      'Stock Deficit': item.deficit > 0 ? `-${item.deficit}` : `+${Math.abs(item.deficit)} Surplus`,
      'Unit': item.unit,
      'Remarks': item.remarks || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Critical Spares Category-wise');
    XLSX.writeFile(workbook, `Critical_Spares_Category_Wise_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
    toast.success('Category-wise Excel report downloaded successfully!');
  };

  const exportToPDF = () => {
    if (filteredCriticalItems.length === 0) {
      toast.error('No items to export.');
      return;
    }

    const docPdf = new jsPDF('landscape');
    
    // Header banner
    docPdf.setFillColor(30, 27, 75); // Deep Indigo
    docPdf.rect(0, 0, 297, 24, 'F');

    docPdf.setTextColor(255, 255, 255);
    docPdf.setFontSize(13);
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('INDIAN RAILWAYS - CRITICAL SPARE PARTS (CATEGORY-WISE STATUS REPORT)', 14, 10.5);

    docPdf.setFontSize(8.5);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(`Machine Scope: ${selectedMachine.toUpperCase()} | Zone: ${filterZone} | Category: ${selectedCategory.toUpperCase()} | Date: ${format(new Date(), 'dd-MM-yyyy HH:mm')}`, 14, 17.5);

    // Summary Statistics line
    docPdf.setTextColor(30, 41, 59);
    docPdf.setFontSize(8.5);
    docPdf.setFont('helvetica', 'bold');
    docPdf.text(
      `Summary: Total Items: ${kpis.total} | Adequate (Green): ${kpis.adequate} | Low Stock Deficit (Yellow): ${kpis.low} | Out of Stock / Missing (Red): ${kpis.critical} | Health: ${kpis.healthPercentage}%`,
      14,
      30
    );

    // Build Category-wise Grouped Table Data
    const tableData: any[] = [];
    let globalItemNum = 1;

    categoryGroupedItems.forEach(group => {
      // Category Section Divider Row
      const categoryStatusSummary = `${group.totalCount} item(s) • ${group.adequateCount} Stocked | ${group.lowCount} Low Deficit | ${group.criticalCount} Out of Stock`;
      tableData.push([
        {
          content: `CATEGORY: ${group.category.toUpperCase()}  [${categoryStatusSummary}]`,
          colSpan: 10,
          styles: {
            fillColor: [224, 231, 255], // Indigo-100 banner
            textColor: [30, 27, 75], // Deep Indigo
            fontStyle: 'bold',
            fontSize: 8.5,
            cellPadding: 2.5
          }
        }
      ]);

      // Items within this category
      group.items.forEach(item => {
        const statusLabel = item.status === 'adequate' 
          ? '[Adequate]' 
          : item.status === 'low' 
          ? `[Low: -${item.deficit}]` 
          : `[Critical: -${item.deficit}]`;

        tableData.push([
          globalItemNum++,
          statusLabel,
          item.plNo || '-',
          item.partNo || '-',
          item.description,
          item.category || 'General',
          item.machineName === 'all' || !item.machineName ? 'All' : item.machineName,
          `${item.requiredQty} ${item.unit || 'Nos'}`,
          `${item.totalInventoryStock} ${item.unit || 'Nos'}`,
          item.deficit > 0 ? `-${item.deficit}` : 'OK'
        ]);
      });
    });

    autoTable(docPdf, {
      head: [['#', 'Status', 'PL No', 'Part No', 'Description', 'Category', 'Machine', 'Req Qty', 'Live Stock', 'Shortage']],
      body: tableData,
      startY: 34,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2,
        valign: 'middle'
      },
      headStyles: {
        fillColor: [30, 27, 75],
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      didParseCell: (data) => {
        if (data.section === 'body') {
          // If this is a category header span row
          if (data.cell.colSpan && data.cell.colSpan > 1) {
            data.cell.styles.fillColor = [224, 231, 255];
            data.cell.styles.textColor = [30, 27, 75];
            data.cell.styles.fontStyle = 'bold';
            return;
          }

          // Status column color styling
          if (data.column.index === 1) {
            const raw = String(data.cell.raw || '');
            if (raw.includes('Adequate')) {
              data.cell.styles.textColor = [22, 101, 52]; // Green
              data.cell.styles.fontStyle = 'bold';
            } else if (raw.includes('Low')) {
              data.cell.styles.textColor = [161, 98, 7]; // Yellow/Amber
              data.cell.styles.fontStyle = 'bold';
            } else if (raw.includes('Critical')) {
              data.cell.styles.textColor = [185, 28, 28]; // Red
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      }
    });

    docPdf.save(`Critical_Spares_Category_Wise_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    toast.success('Category-wise PDF report generated and downloaded!');
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5 pb-10"
    >
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-900 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-indigo-900/20">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Critical Spare Management
            </h1>
            <p className="text-xs font-semibold text-slate-500">
              Automated PDF extraction, critical threshold comparison, and real-time inventory gap analysis.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-700 to-blue-700 hover:from-indigo-800 hover:to-blue-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-700/20 hover:shadow-indigo-700/30 transition-all cursor-pointer"
          >
            <Upload size={16} /> Upload & Analyze PDF
          </button>

          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 bg-slate-900 hover:bg-black text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            <Plus size={16} /> Add Item
          </button>

          <button
            onClick={exportToPDF}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
            title="Download PDF Report"
          >
            <Download size={15} /> PDF
          </button>

          <button
            onClick={exportToExcel}
            className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
            title="Export Excel"
          >
            <FileSpreadsheet size={15} /> Excel
          </button>

          {/* Master Admin: Restore Center & Recovery Action */}
          {isMasterAdmin && (
            <button
              onClick={() => {
                setRestoreMachineFilter(selectedMachine !== 'all' ? selectedMachine : 'all');
                setShowRestoreModal(true);
              }}
              className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 px-3.5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer relative"
              title="View archived records and restore data back to machines"
            >
              <RotateCcw size={15} className="text-amber-700" />
              <span>Restore Center</span>
              {deletedCriticalItems.length > 0 && (
                <span className="bg-amber-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black ml-1">
                  {deletedCriticalItems.length}
                </span>
              )}
            </button>
          )}

          {/* Clear All: Only allowed for the owning Machine or Master Admin */}
          {userMachine && activeCriticalItems.some(i => i.creatorMachine === userMachine || i.machineName === userMachine) && (
            <button
              onClick={() => setShowClearAllConfirm(true)}
              className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
              title={`Clear all critical spares uploaded by ${userMachine}`}
            >
              <Trash2 size={15} /> Clear ({userMachine})
            </button>
          )}

          {isMasterAdmin && !userMachine && activeCriticalItems.length > 0 && (
            <button
              onClick={() => setShowClearAllConfirm(true)}
              className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
              title="Clear active critical spares"
            >
              <Trash2 size={15} /> Clear {selectedMachine !== 'all' ? selectedMachine : 'All'}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Card */}
        <div 
          onClick={() => setStatusFilter('all')}
          className={cn(
            "p-4 rounded-2xl border transition-all cursor-pointer shadow-sm relative overflow-hidden",
            statusFilter === 'all' 
              ? "bg-slate-900 text-white border-slate-900 ring-2 ring-indigo-500/40" 
              : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
          )}
        >
          <div className="flex justify-between items-start">
            <span className={cn("text-xs font-bold uppercase tracking-wider", statusFilter === 'all' ? "text-slate-400" : "text-slate-500")}>
              Total Items
            </span>
            <Layers size={18} className={statusFilter === 'all' ? "text-indigo-400" : "text-slate-400"} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black">{kpis.total}</span>
            <span className={cn("text-xs font-semibold", statusFilter === 'all' ? "text-slate-400" : "text-slate-500")}>spares</span>
          </div>
        </div>

        {/* Green: Fully Stocked */}
        <div 
          onClick={() => setStatusFilter('adequate')}
          className={cn(
            "p-4 rounded-2xl border transition-all cursor-pointer shadow-sm relative overflow-hidden",
            statusFilter === 'adequate' 
              ? "bg-emerald-900 text-white border-emerald-800 ring-2 ring-emerald-500/40" 
              : "bg-emerald-50/70 text-emerald-950 border-emerald-200 hover:border-emerald-300"
          )}
        >
          <div className="flex justify-between items-start">
            <span className={cn("text-xs font-bold uppercase tracking-wider", statusFilter === 'adequate' ? "text-emerald-300" : "text-emerald-800")}>
              🟢 Adequate Stock
            </span>
            <CheckCircle2 size={18} className={statusFilter === 'adequate' ? "text-emerald-300" : "text-emerald-600"} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-300">{kpis.adequate}</span>
            <span className={cn("text-xs font-semibold", statusFilter === 'adequate' ? "text-emerald-300" : "text-emerald-700")}>Ready (≥Req)</span>
          </div>
        </div>

        {/* Yellow: Low Stock Deficit */}
        <div 
          onClick={() => setStatusFilter('low')}
          className={cn(
            "p-4 rounded-2xl border transition-all cursor-pointer shadow-sm relative overflow-hidden",
            statusFilter === 'low' 
              ? "bg-amber-950 text-white border-amber-800 ring-2 ring-amber-500/40" 
              : "bg-amber-50/80 text-amber-950 border-amber-200 hover:border-amber-300"
          )}
        >
          <div className="flex justify-between items-start">
            <span className={cn("text-xs font-bold uppercase tracking-wider", statusFilter === 'low' ? "text-amber-300" : "text-amber-800")}>
              🟡 Low Stock Deficit
            </span>
            <AlertTriangle size={18} className={statusFilter === 'low' ? "text-amber-300" : "text-amber-600"} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-600 dark:text-amber-300">{kpis.low}</span>
            <span className={cn("text-xs font-semibold", statusFilter === 'low' ? "text-amber-300" : "text-amber-700")}>Partial (&lt;Req)</span>
          </div>
        </div>

        {/* Red: Critical Out of Stock */}
        <div 
          onClick={() => setStatusFilter('critical')}
          className={cn(
            "p-4 rounded-2xl border transition-all cursor-pointer shadow-sm relative overflow-hidden",
            statusFilter === 'critical' 
              ? "bg-rose-950 text-white border-rose-800 ring-2 ring-rose-500/40" 
              : "bg-rose-50/80 text-rose-950 border-rose-200 hover:border-rose-300"
          )}
        >
          <div className="flex justify-between items-start">
            <span className={cn("text-xs font-bold uppercase tracking-wider", statusFilter === 'critical' ? "text-rose-300" : "text-rose-800")}>
              🔴 Critical / Missing
            </span>
            <XCircle size={18} className={statusFilter === 'critical' ? "text-rose-300" : "text-rose-600"} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-rose-600 dark:text-rose-300">{kpis.critical}</span>
            <span className={cn("text-xs font-semibold", statusFilter === 'critical' ? "text-rose-300" : "text-rose-700")}>Zero / Absent</span>
          </div>
        </div>

        {/* Health Score */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-1 p-4 rounded-2xl bg-gradient-to-br from-indigo-900 to-slate-900 text-white border border-indigo-800 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
              Readiness Score
            </span>
            <Cpu size={18} className="text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-indigo-300">{kpis.healthPercentage}%</span>
            <span className="text-xs font-semibold text-indigo-200">Stocked</span>
          </div>
          <div className="w-full bg-indigo-950/60 rounded-full h-1.5 mt-2 overflow-hidden">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500",
                kpis.healthPercentage >= 80 ? "bg-emerald-400" : kpis.healthPercentage >= 50 ? "bg-amber-400" : "bg-rose-400"
              )} 
              style={{ width: `${kpis.healthPercentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Smart Auto-Synchronized Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search PL No, Part No, Description..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Machine Filter with Auto-Sync */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500">Machine:</span>
              <select
                value={selectedMachine}
                onChange={e => handleSelectMachine(e.target.value)}
                disabled={!filterPerms.canChangeMachine}
                title={!filterPerms.canChangeMachine ? "Machine filter locked to your assigned machine" : "Select Machine"}
                className={cn(
                  "border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm hover:border-slate-300 focus:ring-2 focus:ring-indigo-500/20",
                  !filterPerms.canChangeMachine && "opacity-75 cursor-not-allowed bg-slate-100 text-slate-500"
                )}
              >
                <option value="all">All Machines</option>
                {allMachinesList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Zone Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500">Zone:</span>
              <select
                value={filterZone}
                disabled={!filterPerms.canChangeZone}
                title={!filterPerms.canChangeZone ? "Zone filter locked to your assigned zone" : "Select Zone"}
                onChange={e => handleSelectZone(e.target.value)}
                className={cn(
                  "border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm hover:border-slate-300 focus:ring-2 focus:ring-indigo-500/20",
                  !filterPerms.canChangeZone && "opacity-75 cursor-not-allowed bg-slate-100 text-slate-500"
                )}
              >
                <option value="all">All Zones</option>
                {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>

            {/* Division Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500">Div:</span>
              <select
                value={filterDivision}
                disabled={!filterPerms.canChangeDivision || filterZone === 'all'}
                title={!filterPerms.canChangeDivision ? "Division filter locked to your assigned division" : "Select Division"}
                onChange={e => handleSelectDivision(e.target.value)}
                className={cn(
                  "border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm hover:border-slate-300 focus:ring-2 focus:ring-indigo-500/20",
                  (!filterPerms.canChangeDivision || filterZone === 'all') && "opacity-75 cursor-not-allowed bg-slate-100 text-slate-500"
                )}
              >
                <option value="all">All Divisions</option>
                {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500">Category:</span>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm hover:border-slate-300 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">All Categories ({categoryGroupedItems.length})</option>
                {categoriesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status Tabs Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setStatusFilter('all')}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-lg transition-all",
                statusFilter === 'all' ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              All ({criticalItemsWithMatch.length})
            </button>
            <button
              onClick={() => setStatusFilter('adequate')}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1",
                statusFilter === 'adequate' ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-700 hover:text-emerald-900"
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
              Green ({kpis.adequate})
            </button>
            <button
              onClick={() => setStatusFilter('low')}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1",
                statusFilter === 'low' ? "bg-amber-600 text-white shadow-sm" : "text-amber-700 hover:text-amber-900"
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
              Yellow ({kpis.low})
            </button>
            <button
              onClick={() => setStatusFilter('critical')}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1",
                statusFilter === 'critical' ? "bg-rose-600 text-white shadow-sm" : "text-rose-700 hover:text-rose-900"
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-300" />
              Red ({kpis.critical})
            </button>
          </div>
        </div>

        {/* Category Pills Navigation Bar */}
        {categoriesList.length > 0 && activeCriticalItems.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1 mr-1">
              <FolderTree size={13} className="text-indigo-600" /> Categories:
            </span>
            <button
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer",
                selectedCategory === 'all'
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              )}
            >
              All Categories
              <span className={cn(
                "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                selectedCategory === 'all' ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-600"
              )}>
                {activeCriticalItems.length}
              </span>
            </button>
            {categoriesList.map(cat => {
              const catItems = criticalItemsWithMatch.filter(i => (i.category || 'General').trim() === cat);
              if (catItems.length === 0) return null;
              const hasDeficit = catItems.some(i => i.deficit > 0);
              const isSelected = selectedCategory === cat;

              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(isSelected ? 'all' : cat)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer",
                    isSelected
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                  )}
                >
                  <span>{cat}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.2 rounded-full font-black",
                    isSelected ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-600"
                  )}>
                    {catItems.length}
                  </span>
                  {hasDeficit && (
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" title="Contains Shortage/Deficit" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Table View - Grouped Category-Wise */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Table Subheader with Category Group Controls */}
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={14} className="text-indigo-600" /> 
              Category-Wise Breakdown
            </span>
            <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
              {categoryGroupedItems.length} {categoryGroupedItems.length === 1 ? 'Category' : 'Categories'}
            </span>
            <span className="text-xs text-slate-400 font-medium">
              ({filteredCriticalItems.length} total parts)
            </span>
          </div>

          {categoryGroupedItems.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={expandAllCategories}
                className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-50 border border-slate-200 px-2 py-1 rounded-lg transition-colors cursor-pointer"
              >
                Expand All
              </button>
              <button
                onClick={collapseAllCategories}
                className="text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg transition-colors cursor-pointer"
              >
                Collapse All
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-500">
            <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
            <p className="text-xs font-bold">Synchronizing Critical Spares with Live Inventory...</p>
          </div>
        ) : filteredCriticalItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <ShieldAlert size={28} />
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">No Critical Spares Found</h3>
            <p className="text-xs text-slate-500 max-w-md mb-4">
              {criticalItems.length === 0 
                ? "You have not added or uploaded any critical spare parts list yet. Upload a Railway Critical Spares PDF or add items manually."
                : "No spare parts matched your selected filters or search query."}
            </p>
            {criticalItems.length === 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                >
                  <Upload size={14} className="inline mr-1.5" /> Upload PDF
                </button>
                <button
                  onClick={handleOpenAddModal}
                  className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all"
                >
                  <Plus size={14} className="inline mr-1.5" /> Add Manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-slate-900 text-white font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-3.5 w-12 text-center whitespace-nowrap">#</th>
                  <th className="py-3 px-3.5 min-w-[130px] whitespace-nowrap">Status</th>
                  <th className="py-3 px-3.5 min-w-[140px] whitespace-nowrap">Part No / PL</th>
                  <th className="py-3 px-3.5 min-w-[260px]">Item Description</th>
                  <th className="py-3 px-3.5 min-w-[130px] whitespace-nowrap">Machine</th>
                  <th className="py-3 px-3.5 min-w-[90px] text-center whitespace-nowrap">Req Qty</th>
                  <th className="py-3 px-3.5 min-w-[120px] text-center whitespace-nowrap">Live Stock</th>
                  <th className="py-3 px-3.5 min-w-[110px] text-center whitespace-nowrap">Shortage</th>
                  <th className="py-3 px-3.5 min-w-[140px] text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {categoryGroupedItems.map((group) => {
                  const isCollapsed = collapsedCategories[group.category];

                  return (
                    <React.Fragment key={`group-${group.category}`}>
                      {/* Category Section Header Row */}
                      <tr className="bg-indigo-900/90 text-white border-y border-indigo-950 sticky top-0 z-10">
                        <td colSpan={9} className="py-2.5 px-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleCategoryCollapse(group.category)}
                                className="p-1 rounded-lg hover:bg-white/20 text-white transition-colors flex items-center gap-1.5 text-xs font-black cursor-pointer"
                                title={isCollapsed ? "Expand category" : "Collapse category"}
                              >
                                {isCollapsed ? (
                                  <ChevronRight size={16} className="text-indigo-200 shrink-0" />
                                ) : (
                                  <ChevronDown size={16} className="text-indigo-200 shrink-0" />
                                )}
                                <span className="text-xs font-black text-white tracking-wide uppercase">
                                  {group.category}
                                </span>
                              </button>

                              <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
                                {group.totalCount} {group.totalCount === 1 ? 'item' : 'items'}
                              </span>
                            </div>

                            {/* Category Health Indicators */}
                            <div className="flex items-center gap-2 text-[11px] font-bold">
                              <span className="inline-flex items-center gap-1 text-emerald-200 bg-emerald-900/80 px-2 py-0.5 rounded-md border border-emerald-700/50">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {group.adequateCount} Stocked
                              </span>
                              {group.lowCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-amber-200 bg-amber-900/80 px-2 py-0.5 rounded-md border border-amber-700/50">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {group.lowCount} Low
                                </span>
                              )}
                              {group.criticalCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-rose-200 bg-rose-900/80 px-2 py-0.5 rounded-md border border-rose-700/50">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> {group.criticalCount} Shortage
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Items in this category (if not collapsed) */}
                      {!isCollapsed && group.items.map((item, itemIdx) => {
                        const isGreen = item.status === 'adequate';
                        const isYellow = item.status === 'low';
                        const isRed = item.status === 'critical';

                        return (
                          <tr 
                            key={item.id}
                            className={cn(
                              "transition-colors hover:bg-slate-50/80",
                              isGreen && "bg-emerald-50/20 hover:bg-emerald-50/40",
                              isYellow && "bg-amber-50/25 hover:bg-amber-50/50",
                              isRed && "bg-rose-50/25 hover:bg-rose-50/50"
                            )}
                          >
                            {/* Serial Number */}
                            <td className="py-3 px-3.5 text-center font-bold text-slate-400 whitespace-nowrap">
                              {itemIdx + 1}
                            </td>

                            {/* Status Badge */}
                            <td className="py-3 px-3.5 whitespace-nowrap">
                              {isGreen && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap leading-none shadow-xs">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                                  Fully Stocked
                                </span>
                              )}
                              {isYellow && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300 whitespace-nowrap leading-none shadow-xs">
                                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                                  Low Stock
                                </span>
                              )}
                              {isRed && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap leading-none shadow-xs">
                                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                                  Out of Stock
                                </span>
                              )}
                            </td>

                            {/* Part No / PL */}
                            <td className="py-3 px-3.5 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono font-bold text-slate-900 text-xs tracking-tight whitespace-nowrap">
                                  {item.partNo || item.plNo || '-'}
                                </span>
                                {item.plNo && item.partNo && (
                                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                                    PL: {item.plNo}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Description & Remarks */}
                            <td className="py-3 px-3.5">
                              <div className="font-bold text-slate-900 text-xs leading-normal break-words">
                                {item.description}
                              </div>
                              {item.remarks && (
                                <div className="text-[10px] text-slate-500 mt-1 italic leading-tight break-words">
                                  {item.remarks}
                                </div>
                              )}
                            </td>

                            {/* Machine */}
                            <td className="py-3 px-3.5 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 whitespace-nowrap leading-none shadow-xs">
                                {item.machineName === 'all' || !item.machineName ? 'All Machines' : item.machineName}
                              </span>
                            </td>

                            {/* Required Qty */}
                            <td className="py-3 px-3.5 text-center whitespace-nowrap">
                              <div className="flex flex-col items-center justify-center gap-0.5">
                                <span className="font-black text-slate-900 text-xs leading-none">
                                  {item.requiredQty}
                                </span>
                                <span className="text-[9px] text-slate-400 font-bold uppercase leading-none">
                                  {item.unit || 'Nos'}
                                </span>
                              </div>
                            </td>

                            {/* Live Stock from Inventory */}
                            <td className="py-3 px-3.5 text-center whitespace-nowrap">
                              <div className="flex flex-col items-center justify-center gap-0.5">
                                <span className={cn(
                                  "font-black text-sm leading-none",
                                  isGreen ? "text-emerald-700" : isYellow ? "text-amber-700" : "text-rose-600"
                                )}>
                                  {item.totalInventoryStock}
                                </span>
                                <span className="text-[9px] text-slate-500 font-semibold leading-none">
                                  {item.isMatched ? `${item.matchedParts.length} item(s) found` : 'Not in catalog'}
                                </span>
                              </div>
                            </td>

                            {/* Shortage Deficit */}
                            <td className="py-3 px-3.5 text-center whitespace-nowrap">
                              {item.deficit > 0 ? (
                                <span className={cn(
                                  "inline-flex items-center justify-center px-2.5 py-1 rounded-md font-black text-xs whitespace-nowrap leading-none shadow-xs",
                                  isRed ? "bg-rose-100 text-rose-700 border border-rose-300" : "bg-amber-100 text-amber-800 border border-amber-300"
                                )}>
                                  -{item.deficit} {item.unit || 'Nos'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-md text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs font-black whitespace-nowrap leading-none">
                                  +{Math.abs(item.deficit)} OK
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="py-3 px-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {/* If Shortage exists, Quick Demand shortcut */}
                                {item.deficit > 0 && (
                                  <button
                                    onClick={() => handleCreateDemandFromShortage(item)}
                                    className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors inline-flex items-center gap-1 text-[10px] font-bold whitespace-nowrap cursor-pointer"
                                    title="Generate Material Demand for this deficit"
                                  >
                                    <Send size={11} className="shrink-0" /> Demand
                                  </button>
                                )}

                                {canManageItem(item) ? (
                                  <>
                                    <button
                                      onClick={() => handleOpenEditModal(item)}
                                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors inline-flex items-center justify-center cursor-pointer border border-transparent hover:border-slate-200"
                                      title="Edit Critical Spare Item"
                                    >
                                      <Edit3 size={13} />
                                    </button>

                                    <button
                                      onClick={() => {
                                        setItemToDelete(item);
                                        setShowDeleteConfirm(true);
                                      }}
                                      className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600 transition-colors inline-flex items-center justify-center cursor-pointer border border-transparent hover:border-rose-200"
                                      title="Delete Critical Spare Item"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                ) : (
                                  <div 
                                    className="p-1.5 rounded-lg text-slate-300 inline-flex items-center justify-center cursor-not-allowed"
                                    title={`Protected: Only machine "${item.creatorMachine || item.machineName || 'Owner'}" can edit or delete this spare.`}
                                  >
                                    <Lock size={13} />
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Upload & AI Analysis Modal */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                    <Upload size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Upload Critical Spares PDF / Excel</h3>
                    <p className="text-xs text-slate-500">AI automatically scans and converts the document into structured critical spare parts.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="py-4 space-y-4 overflow-y-auto flex-1">
                {/* Upload Box */}
                {!analyzedItems.length && (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-200 hover:border-indigo-500 bg-indigo-50/30 hover:bg-indigo-50/60 rounded-2xl p-8 text-center cursor-pointer transition-all space-y-3"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.xlsx,.xls,.csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-md">
                      <FileText size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        {uploadFile ? uploadFile.name : 'Click or Drag & Drop Critical Spares PDF / Excel Document'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Supports Railway OEM parts lists, critical sanction matrices, and maintenance catalogs (.pdf, .xlsx, .csv)
                      </p>
                    </div>
                    {uploadFile && (
                      <div className="inline-block bg-white border border-indigo-200 px-3 py-1 rounded-full text-xs font-bold text-indigo-700">
                        Size: {(uploadFile.size / 1024).toFixed(1)} KB
                      </div>
                    )}
                  </div>
                )}

                {/* Target Machine Selection */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Assign to Machine
                    </label>
                    <select
                      value={targetMachineForUpload}
                      onChange={e => setTargetMachineForUpload(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white font-bold text-slate-800"
                    >
                      <option value="all">Apply to All Machines</option>
                      {allMachinesList.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Document Title / Reference
                    </label>
                    <input
                      type="text"
                      value={extractedTitle}
                      onChange={e => setExtractedTitle(e.target.value)}
                      placeholder="e.g., CSM 08-32 Critical Spares 2026"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white font-bold text-slate-800"
                    />
                  </div>
                </div>

                {/* Analysis Action */}
                {!analyzedItems.length && uploadFile && (
                  <div className="text-center pt-2">
                    <button
                      onClick={handleStartAnalysis}
                      disabled={isAnalyzing}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 mx-auto disabled:opacity-50 cursor-pointer"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Analyzing with AI Vision & Extracting Tables...
                        </>
                      ) : (
                        <>
                          <Cpu size={16} /> Run Intelligent PDF Extraction
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Analyzed Table Preview */}
                {analyzedItems.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Extracted Parts Preview ({analyzedItems.filter(i => i.selected).length} / {analyzedItems.length} selected)
                      </h4>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAnalyzedItems(prev => prev.map(p => ({ ...p, selected: true })))}
                          className="text-[11px] font-bold text-indigo-600 hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          onClick={() => setAnalyzedItems(prev => prev.map(p => ({ ...p, selected: false })))}
                          className="text-[11px] font-bold text-slate-500 hover:underline"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                          <tr>
                            <th className="p-2 w-8 text-center"></th>
                            <th className="p-2 w-28">Part No</th>
                            <th className="p-2">Description</th>
                            <th className="p-2 w-24">Category</th>
                            <th className="p-2 w-16 text-center">Req Qty</th>
                            <th className="p-2 w-16 text-center">Unit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analyzedItems.map((item, idx) => (
                            <tr key={idx} className={item.selected ? "bg-white" : "bg-slate-50 opacity-60"}>
                              <td className="p-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={item.selected}
                                  onChange={e => {
                                    const checked = e.target.checked;
                                    setAnalyzedItems(prev => prev.map((p, pIdx) => pIdx === idx ? { ...p, selected: checked } : p));
                                  }}
                                  className="rounded text-indigo-600"
                                />
                              </td>
                              <td className="p-2 font-mono font-bold">{item.partNo || item.plNo || '-'}</td>
                              <td className="p-2 font-medium">{item.description}</td>
                              <td className="p-2 text-slate-500">{item.category}</td>
                              <td className="p-2 text-center font-bold text-indigo-700">{item.requiredQty}</td>
                              <td className="p-2 text-center">{item.unit || 'Nos'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {analyzedItems.length > 0 && (
                <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                  <button
                    onClick={() => {
                      setAnalyzedItems([]);
                      setUploadFile(null);
                    }}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    Upload Different File
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveParsedItems('append')}
                      disabled={isSavingParsed}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md disabled:opacity-50"
                    >
                      {isSavingParsed ? 'Saving...' : 'Add / Append to List'}
                    </button>
                    {criticalItems.length > 0 && (
                      <button
                        onClick={() => handleSaveParsedItems('replace')}
                        disabled={isSavingParsed}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md disabled:opacity-50"
                      >
                        Replace All Existing
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Add / Edit Critical Spare Modal */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {(showAddModal || showEditModal) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                    {showEditModal ? <Edit3 size={18} /> : <Plus size={18} />}
                  </div>
                  <h3 className="text-base font-black text-slate-900">
                    {showEditModal ? 'Edit Critical Spare' : 'Add Critical Spare Item'}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setShowEditModal(false);
                    setEditingItem(null);
                  }}
                  className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={showEditModal ? handleSaveEdit : handleSaveAdd} className="py-4 space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Item Description / Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g., Tamping Tine / Hydraulic Filter Element"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Part No / Drawing No
                    </label>
                    <input
                      type="text"
                      value={formData.partNo}
                      onChange={e => setFormData({ ...formData, partNo: e.target.value })}
                      placeholder="e.g., 10.12.34 / W37.123"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      PL Number (If any)
                    </label>
                    <input
                      type="text"
                      value={formData.plNo}
                      onChange={e => setFormData({ ...formData, plNo: e.target.value })}
                      placeholder="e.g., 29123456"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Critical Required Qty <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={formData.requiredQty}
                      onChange={e => setFormData({ ...formData, requiredQty: Number(e.target.value) || 1 })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Unit (UOM)
                    </label>
                    <select
                      value={formData.unit}
                      onChange={e => setFormData({ ...formData, unit: e.target.value })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                    >
                      <option value="Nos">Nos</option>
                      <option value="Set">Set</option>
                      <option value="Mtr">Mtr</option>
                      <option value="Kg">Kg</option>
                      <option value="Ltr">Ltr</option>
                      <option value="Pkt">Pkt</option>
                      <option value="Pair">Pair</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Category / Sub-assembly
                    </label>
                    <input
                      type="text"
                      list="categories-datalist"
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      placeholder="e.g., Tamping Unit"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                    />
                    <datalist id="categories-datalist">
                      {categoriesList.map(c => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Target Machine
                    </label>
                    <select
                      value={formData.machineName}
                      onChange={e => setFormData({ ...formData, machineName: e.target.value })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                    >
                      <option value="all">All Machines</option>
                      {allMachinesList.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Remarks / OEM Specification
                  </label>
                  <textarea
                    rows={2}
                    value={formData.remarks}
                    onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder="Optional notes or supplier details"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setShowEditModal(false);
                      setEditingItem(null);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
                  >
                    {showEditModal ? 'Save Changes' : 'Add to Critical Spares'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Delete Item Confirmation Dialog */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showDeleteConfirm && itemToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} />
              </div>
              <h3 className="text-base font-black text-slate-900 mb-1">Remove from Machine?</h3>
              <p className="text-xs text-slate-500 mb-4">
                Remove <strong className="text-slate-800">"{itemToDelete.description}"</strong> from machine <strong className="text-indigo-700">{itemToDelete.machineName || userMachine || 'list'}</strong>? 
                <span className="block text-[11px] text-slate-400 mt-1">Data is preserved safely in the database archive and can be restored by Admin.</span>
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteItem}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-rose-600/30"
                >
                  Confirm Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Clear All Confirmation Dialog */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showClearAllConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-base font-black text-slate-900 mb-1">Clear Critical Spares?</h3>
              <p className="text-xs text-slate-500 mb-4">
                Clear critical spare records for <strong className="text-indigo-700">{userMachine || (selectedMachine !== 'all' ? selectedMachine : 'Active List')}</strong>?
                <span className="block text-[11px] text-slate-400 mt-1">All records will be removed from this machine's view and archived safely on the server.</span>
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setShowClearAllConfirm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-rose-600/30"
                >
                  Yes, Clear List
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Master Admin: Restore Center & Archive Modal */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showRestoreModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    <RotateCcw size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                      Deleted Spares & Machine Restore Center
                      <span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                        {deletedCriticalItems.length} Archived
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      View cleared / deleted critical spare records and return them to machines anytime.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowRestoreModal(false)}
                  className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Filters & Quick Batch Restore Actions */}
              <div className="py-3.5 flex flex-wrap gap-2.5 items-center justify-between border-b border-slate-100">
                <div className="flex flex-wrap gap-2 items-center flex-1 min-w-[280px]">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search archived spares..."
                      value={restoreSearchTerm}
                      onChange={(e) => setRestoreSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-800"
                    />
                  </div>

                  {/* Machine Filter */}
                  <select
                    value={restoreMachineFilter}
                    onChange={(e) => setRestoreMachineFilter(e.target.value)}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-slate-700"
                  >
                    <option value="all">All Machines ({deletedCriticalItems.length})</option>
                    {allMachinesList.map(m => {
                      const count = deletedCriticalItems.filter(i => i.creatorMachine === m || i.machineName === m).length;
                      return (
                        <option key={m} value={m}>
                          {m} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Batch Return Buttons */}
                {deletedCriticalItems.length > 0 && (
                  <div className="flex gap-2">
                    {restoreMachineFilter !== 'all' && (
                      <button
                        onClick={() => handleRestoreAllForMachine(restoreMachineFilter)}
                        disabled={isRestoring}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Undo2 size={13} />
                        Return All to {restoreMachineFilter}
                      </button>
                    )}
                    <button
                      onClick={() => handleRestoreAllForMachine('all')}
                      disabled={isRestoring}
                      className="bg-slate-900 hover:bg-black text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw size={13} />
                      Return All Spares
                    </button>
                  </div>
                )}
              </div>

              {/* Archived Items Table */}
              <div className="flex-1 overflow-y-auto py-2">
                {deletedCriticalItems.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-2" />
                    <p className="font-bold text-slate-700 text-sm">No deleted items</p>
                    <p className="text-xs text-slate-400">All machine critical spares are active.</p>
                  </div>
                ) : (
                  (() => {
                    const filteredDeleted = deletedCriticalItems.filter(item => {
                      if (restoreMachineFilter !== 'all') {
                        if (item.machineName !== restoreMachineFilter && item.creatorMachine !== restoreMachineFilter) {
                          return false;
                        }
                      }
                      if (restoreSearchTerm) {
                        const q = restoreSearchTerm.toLowerCase();
                        const m1 = (item.description || '').toLowerCase().includes(q);
                        const m2 = (item.partNo || '').toLowerCase().includes(q);
                        const m3 = (item.plNo || '').toLowerCase().includes(q);
                        const m4 = (item.category || '').toLowerCase().includes(q);
                        const m5 = (item.machineName || '').toLowerCase().includes(q);
                        if (!m1 && !m2 && !m3 && !m4 && !m5) return false;
                      }
                      return true;
                    });

                    if (filteredDeleted.length === 0) {
                      return (
                        <div className="p-8 text-center text-slate-400 text-xs">
                          No archived spares match your filter.
                        </div>
                      );
                    }

                    return (
                      <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-2.5 px-3 w-10 text-center">#</th>
                            <th className="py-2.5 px-3 min-w-[100px]">Machine</th>
                            <th className="py-2.5 px-3 min-w-[110px]">Part No / PL</th>
                            <th className="py-2.5 px-3 min-w-[200px]">Description</th>
                            <th className="py-2.5 px-3 text-center min-w-[70px]">Req Qty</th>
                            <th className="py-2.5 px-3 min-w-[130px]">Deleted Info</th>
                            <th className="py-2.5 px-3 text-right min-w-[140px]">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                          {filteredDeleted.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-amber-50/30 transition-colors">
                              <td className="py-2.5 px-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200">
                                  {item.machineName || item.creatorMachine || 'All'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                                {item.partNo || item.plNo || '-'}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900 leading-tight">{item.description}</div>
                                <div className="text-[10px] text-slate-400">{item.category || 'General'}</div>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-slate-800">
                                {item.requiredQty} {item.unit || 'Nos'}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="text-[10px] text-slate-500">
                                  {item.deletedAt ? format(new Date(item.deletedAt), 'dd/MM/yy HH:mm') : 'Cleared'}
                                </div>
                                {item.deletedByMachine && (
                                  <div className="text-[9px] text-slate-400 font-semibold">
                                    By: {item.deletedByMachine}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleRestoreItem(item)}
                                    disabled={isRestoring}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] inline-flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                                    title="Restore spare back to machine active list"
                                  >
                                    <Undo2 size={11} /> Return
                                  </button>
                                  <button
                                    onClick={() => handlePermanentDelete(item.id)}
                                    className="p-1 rounded-lg hover:bg-rose-100 text-rose-500 hover:text-rose-700 transition-colors cursor-pointer"
                                    title="Permanently remove from database"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()
                )}
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                <span>
                  Showing {deletedCriticalItems.length} server-archived items.
                </span>
                <button
                  onClick={() => setShowRestoreModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 bg-slate-100"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
