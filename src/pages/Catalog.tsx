import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { safeJsonStringify } from '../utils/firestore-errors';
import { Plus, Download, Eye, X, Upload, FileText, Search, Loader2, Trash2, Edit, Camera, Folder, Layers, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { archiveDeletedRecord } from '../utils/recycleBin';

interface Part {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
  whetherUse?: string;
  itemCondition?: string;
  remarks?: string;
  machineName?: string;
  imageUrl?: string;
  minQty?: number;
  folioName?: string;
  voucherNo?: string;
  companyName?: string;
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

interface Transaction {
  id: string;
  partId: string;
  type: 'received' | 'issued' | 'old_stock';
  qty: number;
  unit?: string;
  date: string;
  receiverName?: string;
  remarks?: string;
  details?: string;
  machineName?: string;
  companyName?: string;
  zone?: string;
  division?: string;
  runningBalance?: number;
  voucherNo?: string;
  demandNo?: string;
}

import { findEmployeeForUser, getFilterAccessPermissions } from '../utils/employee';

const stripHtml = (str?: string): string => {
  if (!str) return '';
  return str.replace(/<[^>]*>?/gm, '').trim();
};

export default function Catalog() {
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });
  const [currentUserZone, setCurrentUserZone] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`userZone_${auth.currentUser.uid}`) || '' : '';
  });
  const [currentUserDivision, setCurrentUserDivision] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || '' : '';
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessTypeVal = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessTypeVal === 'full' || userAccessTypeVal === 'admin-light' || userAccessTypeVal === 'divisional-admin' || userAccessTypeVal === 'zonal-admin';
  });
  const isReadOnlyAdmin = isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');

  const [selectedMachine, setSelectedMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      const savedM = localStorage.getItem(`userMachineName_${auth.currentUser.uid}`);
      if (savedM) return savedM;
    }
    return 'all';
  });
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedCondition, setSelectedCondition] = useState('all');
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [selectedZone, setSelectedZone] = useState(() => {
    if (auth.currentUser) {
      return localStorage.getItem(`userZone_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [selectedDivision, setSelectedDivision] = useState(() => {
    if (auth.currentUser) {
      return localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [zonesList, setZonesList] = useState<string[]>([]);
  const [divisionsList, setDivisionsList] = useState<string[]>([]);
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, userAccessType, null, {
      machineName: userMachine,
      zone: currentUserZone,
      division: currentUserDivision,
    });
  }, [isEmployee, userAccessType, userMachine, currentUserZone, currentUserDivision]);
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [machineToCompany, setMachineToCompany] = useState<Record<string, string>>({});

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

  const handleSelectMachine = (mach: string) => {
    setSelectedMachine(mach);
    if (mach !== 'all') {
      const pos = machinePositions[mach];
      if (pos) {
        if (pos.zone && userAccessType !== 'zonal-admin' && userAccessType !== 'divisional-admin') {
          setSelectedZone(pos.zone);
        }
        if (pos.division && userAccessType !== 'divisional-admin') {
          setSelectedDivision(pos.division);
        }
      }
      const co = machineToCompany[mach];
      if (co && !isEmployee) {
        setSelectedCompany(co);
      }
    }
  };

  const handleSelectZone = (z: string) => {
    if (userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin') return;
    setSelectedZone(z);
    setSelectedDivision('all');
    if (z !== 'all' && selectedMachine !== 'all') {
      const pos = machinePositions[selectedMachine];
      if (pos && pos.zone && pos.zone !== z) {
        setSelectedMachine('all');
      }
    }
  };

  const handleSelectDivision = (d: string) => {
    if (userAccessType === 'divisional-admin') return;
    setSelectedDivision(d);
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
    if (settingsMachines && settingsMachines.length > 0) {
      return Array.from(new Set(settingsMachines)).filter(Boolean).sort();
    }
    const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    return Array.from(new Set([...defaultList, ...customMachines])).filter(Boolean).sort();
  }, [settingsMachines, customMachines]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');
  const [currentTab, setCurrentTab] = useState<'items' | 'folios'>('items');
  const [folios, setFolios] = useState<{ id: string; name: string }[]>([]);
  const [newFolioName, setNewFolioName] = useState('');
  const [showNewFolioModal, setShowNewFolioModal] = useState(false);
  const [isCustomFolioNew, setIsCustomFolioNew] = useState(false);
  const [customFolioNewInput, setCustomFolioNewInput] = useState('');
  const [isCustomFolioEdit, setIsCustomFolioEdit] = useState(false);
  const [customFolioEditInput, setCustomFolioEditInput] = useState('');
  const [selectedFolioName, setSelectedFolioName] = useState<string | null>(null);
  const [showFolioCreateModal, setShowFolioCreateModal] = useState(false);
  const [folioInputName, setFolioInputName] = useState('');
  const [showFolioEditModal, setShowFolioEditModal] = useState(false);
  const [folioToEdit, setFolioToEdit] = useState<{ id: string; name: string } | null>(null);
  const [folioEditInputName, setFolioEditInputName] = useState('');
  const [showFolioDeleteConfirmModal, setShowFolioDeleteConfirmModal] = useState(false);
  const [folioToDelete, setFolioToDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAdmin(false);
        return;
      }
      const isEmployee = user.email?.endsWith('@employee.billedapp.com');
      if (isEmployee) {
        const emp = await findEmployeeForUser(user.uid, user.email);
        if (emp) {
          const isFull = emp.accessType === 'full' || emp.accessType === 'admin-light' || emp.accessType === 'divisional-admin' || emp.accessType === 'zonal-admin';
          localStorage.setItem(`accessType_${user.uid}`, emp.accessType || 'limited');
          setUserAccessType(emp.accessType || 'limited');
          setIsAdmin(isFull);
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${user.uid}`, mName);
          if (mName) {
            setSelectedMachine(mName);
          } else {
            setSelectedMachine('all');
          }
          const cName = emp.companyName || '';
          setCurrentUserCompanyName(cName);
          localStorage.setItem(`companyName_${user.uid}`, cName);
          const zName = emp.zone || '';
          const dName = emp.division || '';
          setCurrentUserZone(zName);
          setCurrentUserDivision(dName);
          localStorage.setItem(`userZone_${user.uid}`, zName);
          localStorage.setItem(`userDivision_${user.uid}`, dName);
          if (zName) setSelectedZone(zName);
          if (dName) setSelectedDivision(dName);
        } else {
          setIsAdmin(false);
          setUserAccessType('limited');
        }
      } else {
        // Not an employee, must be a platform-level Admin
        setIsAdmin(true);
        setUserAccessType('full');
        setUserMachine('');
      }
    });
    return () => unsubscribe();
  }, []);

  // Helper to match zones flexibly (e.g. "SECR" or "Southeast Central Railway (SECR)")
  const matchZone = (empZone: string | undefined, selectedZ: string): boolean => {
    if (!empZone) return false;
    const ez = empZone.trim().toLowerCase();
    const sz = selectedZ.trim().toLowerCase();
    return ez === sz || sz.includes(ez) || ez.includes(sz);
  };

  // Helper to match divisions flexibly (e.g. "Raipur" or "Bilaspur")
  const matchDivision = (empDiv: string | undefined, selectedD: string): boolean => {
    if (!empDiv) return false;
    const ed = empDiv.trim().toLowerCase();
    const sd = selectedD.trim().toLowerCase();
    return ed === sd || sd.includes(ed) || ed.includes(sd);
  };

  // Populate zones dynamically based on role (Admin/Admin-light get all zones, others get existing employee zones)
  useEffect(() => {
    if (isAdmin) {
      setZonesList(Object.keys(RAILWAY_ZONES_DIVISIONS));
    } else {
      const uniqueZones = Array.from(new Set(employeeList.map(e => e.zone).filter((z): z is string => !!z))) as string[];
      setZonesList(uniqueZones);
    }
  }, [isAdmin, employeeList]);

  // Populate divisions dynamically based on selected zone
  useEffect(() => {
    if (selectedZone === 'all') {
      if (isAdmin) {
        const allDivs = Object.values(RAILWAY_ZONES_DIVISIONS).flat();
        setDivisionsList(Array.from(new Set(allDivs)));
      } else {
        const uniqueDivs = Array.from(new Set(employeeList.map(e => e.division).filter((d): d is string => !!d))) as string[];
        setDivisionsList(uniqueDivs);
      }
    } else {
      const divs = RAILWAY_ZONES_DIVISIONS[selectedZone] || [];
      setDivisionsList(divs);
    }
  }, [selectedZone, isAdmin, employeeList]);

  const [parts, setParts] = useState<Part[]>([]);
  const [partsWithTransactions, setPartsWithTransactions] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partToDelete, setPartToDelete] = useState<string | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    const errInfo = {
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
    };
    console.error('Firestore Error: ', safeJsonStringify(errInfo));
    throw new Error(safeJsonStringify(errInfo));
  };

  const [newPart, setNewPart] = useState({
    plNo: '',
    description: '',
    partNo: '',
    rate: 0,
    stock: 0,
    location: '',
    whetherUse: 'CS',
    itemCondition: 'New',
    remarks: '',
    machineName: '',
    imageUrl: '',
    minQty: 5,
    folioName: 'New Item',
    voucherNo: '',
    unit: 'Nos',
  });

  const STANDARD_UOM_OPTIONS = [
    { value: "Nos", label: "Nos (नग / Pieces)" },
    { value: "Set", label: "Set (सेट)" },
    { value: "Mtr", label: "Mtr (मीटर)" },
    { value: "Ltr", label: "Ltr (लीटर)" },
    { value: "Kg", label: "Kg (कि.ग्रा.)" },
    { value: "Pair", label: "Pair (जोड़ी)" },
    { value: "Pkt", label: "Pkt (पैकेट)" },
    { value: "Roll", label: "Roll (रोल)" },
    { value: "Drum", label: "Drum (ड्रम)" },
    { value: "Box", label: "Box (बॉक्स)" },
    { value: "Brl", label: "Brl (बैरल)" },
    { value: "Quintal", label: "Quintal (क्विंटल)" },
    { value: "Other", label: "Other (अन्य - Custom Unit)" }
  ];

  const [newPartCustomUnit, setNewPartCustomUnit] = useState('');
  const [editPartCustomUnit, setEditPartCustomUnit] = useState('');

  const handleCatalogPlChange = (plVal: string) => {
    const cleanPl = plVal.trim().toLowerCase();
    let matchedPartNo = '';
    let matchedDesc = '';
    let matchedWhetherUse = '';
    let matchedRate = 0;

    if (cleanPl) {
      const matched = parts.find(p => p.plNo && p.plNo.trim().toLowerCase() === cleanPl);
      if (matched) {
        matchedPartNo = matched.partNo || '';
        matchedDesc = matched.description || '';
        matchedWhetherUse = matched.whetherUse || '';
        matchedRate = matched.rate || 0;
      }
    }

    setNewPart(prev => ({
      ...prev,
      plNo: plVal,
      partNo: matchedPartNo || prev.partNo,
      description: matchedDesc || prev.description,
      whetherUse: matchedWhetherUse || prev.whetherUse,
      rate: matchedRate || prev.rate,
    }));
  };

  const handleCatalogPartNoChange = (partVal: string) => {
    const cleanPart = partVal.trim().toLowerCase();
    let matchedPl = '';
    let matchedDesc = '';
    let matchedWhetherUse = '';
    let matchedRate = 0;

    if (cleanPart) {
      const matched = parts.find(p => p.partNo && p.partNo.trim().toLowerCase() === cleanPart);
      if (matched) {
        matchedPl = matched.plNo || '';
        matchedDesc = matched.description || '';
        matchedWhetherUse = matched.whetherUse || '';
        matchedRate = matched.rate || 0;
      }
    }

    setNewPart(prev => ({
      ...prev,
      partNo: partVal,
      plNo: matchedPl || prev.plNo,
      description: matchedDesc || prev.description,
      whetherUse: matchedWhetherUse || prev.whetherUse,
      rate: matchedRate || prev.rate,
    }));
  };

  const [editPartData, setEditPartData] = useState<Part & { voucherNo?: string }>({
    id: '',
    plNo: '',
    description: '',
    partNo: '',
    rate: 0,
    stock: 0,
    location: '',
    totalValue: 0,
    whetherUse: 'CS',
    itemCondition: 'New',
    remarks: '',
    machineName: '',
    imageUrl: '',
    minQty: 5,
    folioName: 'New Item',
    voucherNo: '',
    unit: 'Nos',
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
        setEditPartData(prev => ({ ...prev, imageUrl: base64 }));
      } else {
        setNewPart(prev => ({ ...prev, imageUrl: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    console.log('Current User:', auth.currentUser?.email);
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
      const partList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Part));
      
      // Fetch folios
      try {
        const folioSnapshot = await getDocs(collection(db, 'folios'));
        let folioList = folioSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string }));
        if (!folioList.some(f => f.name.toLowerCase() === 'new item')) {
          folioList = [{ id: 'new-item-default', name: 'New Item' }, ...folioList];
        }
        setFolios(folioList);
      } catch (folioErr) {
        console.error('Error fetching folios:', folioErr);
        setFolios([{ id: 'new-item-default', name: 'New Item' }]);
      }

      // Extract custom machines from parts list and employee list
      const uniqueMachines = Array.from(new Set([
        ...partList.map(p => p.machineName),
        ...empList.map(e => e.machineName)
      ].filter((m): m is string => !!m)));
      const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setParts(partList);

      // Fetch all transactions to see which parts have transactions
      const txSnapshot = await getDocs(collection(db, 'transactions'));
      const partIdsWithTx = new Set<string>();
      txSnapshot.docs.forEach(txDoc => {
        const txData = txDoc.data();
        if (txData.partId) {
          partIdsWithTx.add(txData.partId);
        }
      });
      setPartsWithTransactions(partIdsWithTx);
    } catch (error) {
      console.error('Error fetching parts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folioInputName.trim()) {
      toast.error('Please enter a folio name.');
      return;
    }
    setSubmitting(true);
    try {
      const duplicate = folios.some(f => f.name.toLowerCase() === folioInputName.trim().toLowerCase());
      if (duplicate) {
        toast.error('A folio with this name already exists.');
        setSubmitting(false);
        return;
      }
      const docRef = await addDoc(collection(db, 'folios'), {
        name: folioInputName.trim(),
        createdAt: new Date().toISOString()
      });
      setFolios(prev => [...prev, { id: docRef.id, name: folioInputName.trim() }]);
      toast.success('Folio created successfully!');
      setFolioInputName('');
      setShowFolioCreateModal(false);
    } catch (err) {
      console.error('Error creating folio:', err);
      toast.error('Failed to create folio.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditFolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folioToEdit || !folioEditInputName.trim()) {
      toast.error('Please enter a folio name.');
      return;
    }
    const oldName = folioToEdit.name;
    const newName = folioEditInputName.trim();
    if (oldName.toLowerCase() === newName.toLowerCase()) {
      setShowFolioEditModal(false);
      return;
    }
    setSubmitting(true);
    try {
      // Check duplicate name
      const duplicate = folios.some(f => f.id !== folioToEdit.id && f.name.toLowerCase() === newName.toLowerCase());
      if (duplicate) {
        toast.error('A folio with this name already exists.');
        setSubmitting(false);
        return;
      }

      // Check transactions in this folio
      const hasTx = parts.some(part => (part.folioName || 'New Item') === oldName && partsWithTransactions.has(part.id));
      if (hasTx) {
        toast.error('Cannot edit a folio containing items with transactions.');
        setSubmitting(false);
        return;
      }

      if (folioToEdit.id === 'new-item-default') {
        toast.error('Default folder cannot be edited.');
        setSubmitting(false);
        return;
      }

      // Update document
      const folioRef = doc(db, 'folios', folioToEdit.id);
      await updateDoc(folioRef, {
        name: newName
      });

      // Update all parts belonging to this folio name
      const partsToUpdate = parts.filter(p => (p.folioName || 'New Item') === oldName);
      const updatePromises = partsToUpdate.map(part => {
        const partRef = doc(db, 'parts', part.id);
        return updateDoc(partRef, { folioName: newName });
      });
      await Promise.all(updatePromises);

      toast.success('Folio renamed successfully!');
      fetchParts();
      setShowFolioEditModal(false);
      setFolioToEdit(null);
      setFolioEditInputName('');
    } catch (err) {
      console.error('Error editing folio:', err);
      toast.error('Failed to rename folio.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteFolio = async () => {
    if (!folioToDelete) return;
    const nameToDelete = folioToDelete.name;
    setSubmitting(true);
    try {
      // Check transactions in this folio
      const hasTx = parts.some(part => (part.folioName || 'New Item') === nameToDelete && partsWithTransactions.has(part.id));
      if (hasTx) {
        toast.error('Cannot delete a folio containing items with transactions.');
        setSubmitting(false);
        return;
      }

      if (folioToDelete.id === 'new-item-default') {
        toast.error('Default folder cannot be deleted.');
        setSubmitting(false);
        return;
      }

      // Delete document
      const folioRef = doc(db, 'folios', folioToDelete.id);
      await archiveDeletedRecord({
        originalCollection: 'folios',
        originalId: folioToDelete.id,
        data: folioToDelete,
        moduleName: 'Catalog Folio Folder',
        itemSummary: `Folio: ${folioToDelete.name || nameToDelete}`,
        companyName: (folioToDelete as any).companyName,
      });
      await deleteDoc(folioRef);

      // Move parts to "New Item"
      const partsToUpdate = parts.filter(p => (p.folioName || 'New Item') === nameToDelete);
      const updatePromises = partsToUpdate.map(part => {
        const partRef = doc(db, 'parts', part.id);
        return updateDoc(partRef, { folioName: 'New Item' });
      });
      await Promise.all(updatePromises);

      toast.success('Folio deleted successfully!');
      fetchParts();
      setShowFolioDeleteConfirmModal(false);
      setFolioToDelete(null);
    } catch (err) {
      console.error('Error deleting folio:', err);
      toast.error('Failed to delete folio.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Check for duplicates
      let plSnapEmpty = true;
      let partNoSnapEmpty = true;

      const promises = [];
      if (newPart.plNo && newPart.plNo.trim() !== "") {
        const plQuery = query(collection(db, 'parts'), where('plNo', '==', newPart.plNo.trim()));
        promises.push(getDocs(plQuery).then(snap => { plSnapEmpty = snap.empty; }));
      }
      if (newPart.partNo && newPart.partNo.trim() !== "") {
        const partNoQuery = query(collection(db, 'parts'), where('partNo', '==', newPart.partNo.trim()));
        promises.push(getDocs(partNoQuery).then(snap => { partNoSnapEmpty = snap.empty; }));
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      if (!plSnapEmpty || !partNoSnapEmpty) {
        toast.error('Item with this PL No. or Part No. already exists!');
        setSubmitting(false);
        return;
      }

      let finalFolioName = newPart.folioName;
      if (isCustomFolioNew && customFolioNewInput.trim()) {
        finalFolioName = customFolioNewInput.trim();
        const exists = folios.some(f => f.name.toLowerCase() === finalFolioName.toLowerCase());
        if (!exists) {
          try {
            await addDoc(collection(db, 'folios'), {
              name: finalFolioName,
              createdAt: new Date().toISOString()
            });
          } catch (folioErr) {
            console.error('Error saving folio:', folioErr);
          }
        }
      }

      const totalValue = newPart.rate * newPart.stock;
      const machineToAssign = (newPart.machineName || userMachine || '').trim();
      const voucherNumber = newPart.voucherNo?.trim() || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const finalLocation = newPart.stock >= 1 ? (newPart.location || '') : '';
      const resolvedUnit = (newPart.unit === 'Other' || !STANDARD_UOM_OPTIONS.some(o => o.value === newPart.unit && o.value !== 'Other'))
        ? (newPartCustomUnit.trim() || 'Nos')
        : (newPart.unit || 'Nos');

      const partRef = await addDoc(collection(db, 'parts'), {
        plNo: newPart.plNo || '',
        description: newPart.description,
        partNo: newPart.partNo,
        rate: newPart.rate,
        stock: newPart.stock,
        unit: resolvedUnit,
        location: finalLocation,
        whetherUse: newPart.whetherUse,
        itemCondition: newPart.itemCondition || 'New',
        remarks: newPart.remarks,
        totalValue,
        machineName: machineToAssign || '',
        companyName: currentUserCompanyName || '',
        imageUrl: newPart.imageUrl || '',
        minQty: typeof newPart.minQty === 'number' ? newPart.minQty : 5,
        folioName: finalFolioName || '',
        voucherNo: voucherNumber,
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'parts'));

      // Write initial stock transaction log only if initial stock is 1 or more
      if (newPart.stock > 0) {
        await addDoc(collection(db, 'transactions'), {
          partId: partRef.id,
          type: 'received',
          qty: newPart.stock,
          unit: resolvedUnit,
          date: format(new Date(), 'yyyy-MM-dd'),
          details: `Initial Stock / Item Creation (Stock: ${newPart.stock} ${resolvedUnit})`,
          remarks: newPart.remarks || 'New item added',
          machineName: machineToAssign || '',
          companyName: currentUserCompanyName || '',
          voucherNo: voucherNumber,
        }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'transactions'));
      }

      toast.success('Part added successfully');
      setShowAddModal(false);
      fetchParts();
      setNewPart({
        plNo: '',
        description: '',
        partNo: '',
        rate: 0,
        stock: 0,
        unit: 'Nos',
        location: '',
        whetherUse: 'CS',
        itemCondition: 'New',
        remarks: '',
        machineName: '',
        imageUrl: '',
        minQty: 5,
        folioName: '',
        voucherNo: '',
      });
      setNewPartCustomUnit('');
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
      setIsCustomFolioNew(false);
      setCustomFolioNewInput('');
    } catch (error) {
      console.error('Error adding part:', error);
      toast.error('Failed to add part. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let finalFolioName = editPartData.folioName;
      if (isCustomFolioEdit && customFolioEditInput.trim()) {
        finalFolioName = customFolioEditInput.trim();
        const exists = folios.some(f => f.name.toLowerCase() === finalFolioName.toLowerCase());
        if (!exists) {
          try {
            await addDoc(collection(db, 'folios'), {
              name: finalFolioName,
              createdAt: new Date().toISOString()
            });
          } catch (folioErr) {
            console.error('Error saving folio:', folioErr);
          }
        }
      }

      const partRef = doc(db, 'parts', editPartData.id);
      const totalValue = editPartData.rate * editPartData.stock;
      const machineToAssign = (editPartData.machineName || userMachine || '').trim();

      const oldPart = parts.find(p => p.id === editPartData.id);
      const oldStock = oldPart ? oldPart.stock : editPartData.stock;
      const stockDiff = editPartData.stock - oldStock;

      const voucherNumber = editPartData.voucherNo?.trim() || oldPart?.voucherNo || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const finalLocation = editPartData.stock >= 1 ? (editPartData.location || '') : '';
      const resolvedUnit = (editPartData.unit === 'Other' || !STANDARD_UOM_OPTIONS.some(o => o.value === editPartData.unit && o.value !== 'Other'))
        ? (editPartCustomUnit.trim() || 'Nos')
        : (editPartData.unit || 'Nos');

      await updateDoc(partRef, {
        plNo: editPartData.plNo || '',
        partNo: editPartData.partNo,
        description: editPartData.description,
        rate: editPartData.rate,
        stock: editPartData.stock,
        unit: resolvedUnit,
        location: finalLocation,
        whetherUse: editPartData.whetherUse || 'CS',
        itemCondition: editPartData.itemCondition || 'New',
        remarks: editPartData.remarks || '',
        totalValue,
        machineName: machineToAssign || '',
        imageUrl: editPartData.imageUrl || '',
        minQty: typeof editPartData.minQty === 'number' ? editPartData.minQty : 5,
        folioName: finalFolioName || '',
        voucherNo: voucherNumber,
      }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `parts/${editPartData.id}`));

      // Save transaction to history/reports ONLY if quantity (stock) was updated/changed
      if (stockDiff !== 0) {
        const transType = stockDiff > 0 ? 'received' : 'issued';
        const transQty = Math.abs(stockDiff);
        const detailMsg = `Stock Quantity Updated (Stock: ${oldStock} → ${editPartData.stock} ${resolvedUnit})`;

        await addDoc(collection(db, 'transactions'), {
          partId: editPartData.id,
          type: transType,
          qty: transQty,
          unit: resolvedUnit,
          date: format(new Date(), 'yyyy-MM-dd'),
          details: detailMsg,
          remarks: editPartData.remarks || 'Stock quantity updated',
          machineName: machineToAssign || '',
          companyName: currentUserCompanyName || '',
          voucherNo: voucherNumber,
        }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'transactions'));
      }

      toast.success('Part updated successfully');
      setShowEditModal(false);
      fetchParts();
      setEditPartCustomUnit('');
      setIsCustomFolioEdit(false);
      setCustomFolioEditInput('');
    } catch (error) {
      console.error('Error editing part:', error);
      toast.error('Failed to update part.');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchHistory = async (part: Part) => {
    try {
      const targetPartNo = part.partNo?.trim().toLowerCase();
      const targetPlNo = part.plNo?.trim().toLowerCase();

      // Find all matching part IDs in the currently loaded parts list
      const matchingPartIds = parts
        .filter(p => {
          const pNo = p.partNo?.trim().toLowerCase();
          const pPl = p.plNo?.trim().toLowerCase();
          const matchesPartNo = targetPartNo && pNo && pNo === targetPartNo;
          const matchesPlNo = targetPlNo && pPl && pPl === targetPlNo;
          return p.id === part.id || matchesPartNo || matchesPlNo;
        })
        .map(p => p.id);

      if (matchingPartIds.length === 0) {
        matchingPartIds.push(part.id);
      }

      let historyList: Transaction[] = [];

      // Query by chunking since 'in' queries are faster and more efficient
      if (matchingPartIds.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < matchingPartIds.length; i += 30) {
          chunks.push(matchingPartIds.slice(i, i + 30));
        }

        const queryPromises = chunks.map(chunk => {
          const q = query(collection(db, 'transactions'), where('partId', 'in', chunk));
          return getDocs(q);
        });

        const snapshots = await Promise.all(queryPromises);
        snapshots.forEach(snapshot => {
          snapshot.docs.forEach(doc => {
            historyList.push({ id: doc.id, ...doc.data() } as Transaction);
          });
        });
      } else {
        const q = query(collection(db, 'transactions'), where('partId', '==', part.id));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
          historyList.push({ id: doc.id, ...doc.data() } as Transaction);
        });
      }

      // Deduplicate transactions by their ID
      const uniqueHistoryMap = new Map<string, Transaction>();
      historyList.forEach(tx => uniqueHistoryMap.set(tx.id, tx));
      historyList = Array.from(uniqueHistoryMap.values());
      
      // Sort chronologically (oldest first) to compute running balance correctly
      const sortedChronological = [...historyList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let balance = 0;
      const historyWithBalance = sortedChronological.map(tx => {
        if (tx.type === 'issued') {
          balance -= tx.qty;
        } else {
          balance += tx.qty;
        }
        return {
          ...tx,
          runningBalance: balance,
        };
      });

      // Sort back to newest first for table display
      setHistory(historyWithBalance.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const handleShowHistory = (part: Part) => {
    setSelectedPart(part);
    fetchHistory(part);
    setShowHistoryModal(true);
  };

  const exportHistoryToExcel = () => {
    if (!selectedPart || history.length === 0) {
      toast.error('No transactions to export.');
      return;
    }

    const rows = history.map((h, idx) => {
      const typeStr = h.type === 'old_stock' ? 'Received (Initial/Old Stock)' : h.type === 'issued' ? 'Issued' : 'Received';
      const sourceStr = (() => {
        const detailsLower = h.details?.toLowerCase() || '';
        if (detailsLower.includes('unconnected')) return 'Unconnected Receipt';
        if (detailsLower.includes('demand')) return 'Demand Receipt';
        if (detailsLower.includes('initial') || h.type === 'old_stock') return 'Inventory (Initial Stock)';
        if (h.type === 'issued') return 'Issue';
        return 'Inventory Adjustment';
      })();

      return {
        'S.No': idx + 1,
        'Date': h.date || '',
        'Voucher No / Demand No': h.voucherNo || h.demandNo || '-',
        'Type': typeStr,
        'Quantity': h.type === 'issued' ? -h.qty : h.qty,
        'Running Balance': h.runningBalance !== undefined ? h.runningBalance : '-',
        'Source / Category': sourceStr,
        'Machine': stripHtml(h.machineName || '-'),
        'Zone / Division': `${stripHtml(h.zone || '')} ${h.division ? `(${stripHtml(h.division)})` : ''}`.trim() || '-',
        'Company': stripHtml(h.companyName || '-'),
        'Receiver / Issued To': stripHtml(h.receiverName || (h.type === 'issued' && h.details?.includes('Issued to: ') ? h.details.replace('Issued to: ', '') : '') || '-'),
        'Remarks': stripHtml(h.remarks || '-')
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transaction History');
    const safePartName = (selectedPart.plNo || selectedPart.partNo || selectedPart.description || 'Part').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Transaction_History_${safePartName}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Transaction history exported to Excel successfully!');
  };

  const exportHistoryToPDF = () => {
    if (!selectedPart || history.length === 0) {
      toast.error('No transactions to export.');
      return;
    }

    const doc = new jsPDF('landscape', 'mm', 'a4');

    // Header Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text('ITEM TRANSACTION HISTORY LEDGER', 14, 13);

    // Item Metadata
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(79, 70, 229);
    doc.text(`Item: ${selectedPart.description}`, 14, 19);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const meta1 = `PL No: ${selectedPart.plNo || 'N/A'} | Part No: ${selectedPart.partNo || 'N/A'} | Current Stock: ${selectedPart.stock || 0} ${selectedPart.unit || 'Nos'} | Rate: Rs. ${(selectedPart.rate || 0).toFixed(2)} | Location: ${selectedPart.location || 'N/A'}`;
    doc.text(meta1, 14, 24);

    const meta2 = `Generated On: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Total Transactions: ${history.length} | Machine: ${selectedPart.machineName || 'All'}`;
    doc.text(meta2, 14, 28.5);

    const tableData = history.map((h, idx) => {
      const typeStr = h.type === 'old_stock' ? 'Received (Old)' : h.type === 'issued' ? 'Issued' : 'Received';
      const receiverOrMachine = [
        h.receiverName || (h.type === 'issued' && h.details?.includes('Issued to: ') ? h.details.replace('Issued to: ', '') : ''),
        h.machineName ? `Machine: ${stripHtml(h.machineName)}` : '',
        h.zone || h.division ? `(${stripHtml(h.zone || '')} ${stripHtml(h.division || '')})` : ''
      ].filter(Boolean).join(' | ') || '-';

      return [
        idx + 1,
        h.date || '-',
        h.voucherNo || h.demandNo || '-',
        typeStr,
        `${h.type === 'issued' ? '-' : '+'}${h.qty}`,
        h.runningBalance !== undefined ? h.runningBalance : '-',
        receiverOrMachine,
        stripHtml(h.remarks || '-')
      ];
    });

    autoTable(doc, {
      startY: 32,
      head: [['#', 'Date', 'Voucher / Ref No.', 'Type', 'Qty', 'Balance', 'Details / Receiver / Machine', 'Remarks']],
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
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        valign: 'middle'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 24, halign: 'center' },
        2: { cellWidth: 32, halign: 'center' },
        3: { cellWidth: 26, halign: 'center' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 'auto', halign: 'left' },
        7: { cellWidth: 45, halign: 'left' }
      },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${data.pageNumber} of ${pageCount}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 6);
      }
    });

    const safePartName = (selectedPart.plNo || selectedPart.partNo || selectedPart.description || 'Part').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    doc.save(`Transaction_History_${safePartName}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('Transaction history PDF generated successfully!');
  };

  const handleDeletePart = async () => {
    if (!partToDelete) return;
    
    setSubmitting(true);
    try {
      const partObj = parts.find(p => p.id === partToDelete);
      if (partObj) {
        await archiveDeletedRecord({
          originalCollection: 'parts',
          originalId: partToDelete,
          data: partObj,
          moduleName: 'Catalog Item / Part',
          itemSummary: `${partObj.description || 'Part'} (PL: ${partObj.plNo || '-'}, Part No: ${partObj.partNo || '-'}) • Stock: ${partObj.stock || 0}`,
          companyName: partObj.companyName,
        });
      }
      await deleteDoc(doc(db, 'parts', partToDelete));
      toast.success('Item deleted successfully');
      setShowDeleteModal(false);
      setPartToDelete(null);
      fetchParts();
    } catch (error) {
      console.error('Error deleting part:', error);
      toast.error('Failed to delete item');
    } finally {
      setSubmitting(false);
    }
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredParts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "Inventory_Report.xlsx");
  };

  const exportToPDF = () => {
    if (filteredParts.length === 0) {
      toast.error('No inventory items to export.');
      return;
    }
    const doc = new jsPDF('landscape', 'mm', 'a4');
    
    // Header Title & Metadata
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text("INVENTORY CATALOG & SPARE PARTS REPORT", 14, 13);

    const totalStock = filteredParts.reduce((acc, p) => acc + (Number(p.stock) || 0), 0);
    const totalVal = filteredParts.reduce((acc, p) => {
      const rate = Number(p.rate) || 0;
      const stock = Number(p.stock) || 0;
      const tv = Number(p.totalValue);
      return acc + (!Number.isNaN(tv) && tv > 0 ? tv : rate * stock);
    }, 0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const metaLine = `Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Total Items: ${filteredParts.length} | Total Stock: ${totalStock} | Total Value: Rs. ${totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    doc.text(metaLine, 14, 18);

    const filterInfo = `Machine: ${selectedMachine !== 'all' ? selectedMachine : 'All'} | Zone: ${selectedZone !== 'all' ? selectedZone : 'All'} | Division: ${selectedDivision !== 'all' ? selectedDivision : 'All'} | Condition: ${selectedCondition !== 'all' ? selectedCondition : 'All'}`;
    doc.text(filterInfo, 14, 22);

    autoTable(doc, {
      startY: 25,
      head: [['Sr.', 'PL No.', 'Description', 'Part No.', 'Rate', 'Stock', 'Total Value', 'Location', 'Use / Cond.']],
      body: filteredParts.map((p, i) => [
        i + 1,
        p.plNo || '-',
        p.description || '-',
        p.partNo || '-',
        (Number.isNaN(Number(p.rate)) ? 0 : Number(p.rate || 0)).toFixed(2),
        p.stock ?? 0,
        (Number.isNaN(Number(p.totalValue)) ? Number((p.rate || 0) * (p.stock || 0)) : Number(p.totalValue || 0)).toFixed(2),
        p.location || '-',
        `${p.whetherUse || 'CS'}${p.itemCondition ? ` / ${p.itemCondition}` : ''}`
      ]),
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
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        lineWidth: 0.15,
        lineColor: [15, 23, 42],
        halign: 'center',
        valign: 'middle'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 26, halign: 'center' },
        2: { cellWidth: 'auto', halign: 'left' },
        3: { cellWidth: 32, halign: 'left' },
        4: { cellWidth: 24, halign: 'right', overflow: 'visible' },
        5: { cellWidth: 16, halign: 'center', overflow: 'visible' },
        6: { cellWidth: 28, halign: 'right', overflow: 'visible' },
        7: { cellWidth: 22, halign: 'center' },
        8: { cellWidth: 26, halign: 'center' }
      },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${data.pageNumber} of ${pageCount}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 6);
      }
    });

    doc.save(`Inventory_Catalog_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('Inventory PDF report generated successfully!');
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

    // Apply company filter constraint for non-employee admin
    if (!isEmployee && selectedCompany !== 'all') {
      const companyEmployees = employeeList.filter(e => e.companyName === selectedCompany);
      const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
      parts.forEach(part => {
        if (part.companyName === selectedCompany && part.machineName) {
          companyMachines.add(part.machineName);
        }
      });
      const matchesCompany = (p.companyName && p.companyName === selectedCompany) ||
                             (p.machineName && companyMachines.has(p.machineName)) ||
                             (!p.companyName && !p.machineName);
      if (!matchesCompany) {
        return false;
      }
    }

    // Apply zone filter constraint
    if (selectedZone !== 'all') {
      const zoneEmployees = employeeList.filter(e => matchZone(e.zone, selectedZone));
      const zoneMachines = new Set(zoneEmployees.map(e => e.machineName).filter(Boolean));
      if (p.machineName && !zoneMachines.has(p.machineName)) {
        return false;
      }
    }

    // Apply division filter constraint
    if (selectedDivision !== 'all') {
      const divisionEmployees = employeeList.filter(e => matchDivision(e.division, selectedDivision));
      const divisionMachines = new Set(divisionEmployees.map(e => e.machineName).filter(Boolean));
      if (p.machineName && !divisionMachines.has(p.machineName)) {
        return false;
      }
    }

    // Apply item condition filter constraint (New / Serviceable / Released)
    if (selectedCondition !== 'all') {
      const cond = getItemCondition(p);
      if (cond !== selectedCondition) {
        return false;
      }
    }

    // Apply company and machine filter constraint for employee users
    if (isEmployee) {
      const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
        const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
        parts.forEach(part => {
          if (part.companyName === myCompany && part.machineName) {
            companyMachines.add(part.machineName);
          }
        });

        const matchesCompany = (p.companyName && p.companyName === myCompany) ||
                               (p.machineName && companyMachines.has(p.machineName)) ||
                               (!p.companyName && (!p.machineName || companyMachines.size === 0));

        if (!matchesCompany) {
          return false;
        }
      }

      if (userAccessType === 'admin-light' || userAccessType === 'divisional-admin' || userAccessType === 'full') {
        if (selectedMachine !== 'all') {
          return (p.machineName || '').trim().toLowerCase() === selectedMachine.trim().toLowerCase();
        }
      } else {
        const myMachine = (userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '').trim();
        if (myMachine) {
          return (p.machineName || '').trim().toLowerCase() === myMachine.toLowerCase();
        } else if (selectedMachine !== 'all') {
          return (p.machineName || '').trim().toLowerCase() === selectedMachine.trim().toLowerCase();
        }
      }
    } else {
      if (selectedMachine !== 'all') {
        return (p.machineName || '').trim().toLowerCase() === selectedMachine.trim().toLowerCase();
      }
    }
    return true;
  });

  const partsByFolio = filteredParts.reduce((acc, part) => {
    const fName = part.folioName || 'New Item';
    if (!acc[fName]) {
      acc[fName] = [];
    }
    acc[fName].push(part);
    return acc;
  }, {} as Record<string, Part[]>);

  // Ensure all registered folios are included in partsByFolio
  folios.forEach(f => {
    if (!partsByFolio[f.name]) {
      partsByFolio[f.name] = [];
    }
  });

  const partsToRender = currentTab === 'items' 
    ? filteredParts 
    : (selectedFolioName ? (partsByFolio[selectedFolioName] || []) : []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-3xl font-black text-primary tracking-tight">Part Catalog</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/* Zone Filter */}
            <select
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm",
                !filterPerms.canChangeZone && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
              )}
              value={selectedZone}
              onChange={e => handleSelectZone(e.target.value)}
              disabled={!filterPerms.canChangeZone}
              title={!filterPerms.canChangeZone ? "Zone filter locked to your assigned zone" : "Select Zone"}
            >
              <option value="all">All Zones</option>
              {zonesList.map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>

            {/* Division Filter */}
            <select
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm",
                (!filterPerms.canChangeDivision || selectedZone === 'all') && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
              )}
              value={selectedDivision}
              onChange={e => handleSelectDivision(e.target.value)}
              disabled={!filterPerms.canChangeDivision || selectedZone === 'all'}
              title={!filterPerms.canChangeDivision ? "Division filter locked to your assigned division" : "Select Division"}
            >
              <option value="all">All Divisions</option>
              {divisionsList.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {/* Company Filter (for admins) */}
            {!isEmployee && (
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                value={selectedCompany}
                onChange={e => handleSelectCompany(e.target.value)}
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
              onChange={e => handleSelectMachine(e.target.value)}
              disabled={!filterPerms.canChangeMachine}
              title={!filterPerms.canChangeMachine ? "Machine filter locked to your assigned machine" : "Select Machine"}
            >
              <option value="all">All Machines</option>
              {(isEmployee && (userAccessType === 'admin-light' || userAccessType === 'divisional-admin' || userAccessType === 'full')
                ? Array.from(new Set([
                    ...employeeList.filter(e => e.companyName === (currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName),
                    ...parts.filter(p => p.companyName === (currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(p => p.machineName)
                  ].filter(Boolean)))
                : allMachinesList
              ).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {/* Condition Filter */}
            <select
              className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
              value={selectedCondition}
              onChange={e => setSelectedCondition(e.target.value)}
            >
              <option value="all">All Conditions (सभी स्थितियां)</option>
              <option value="New">✨ New / नया</option>
              <option value="Serviceable">🛠️ Serviceable / सर्विस-योग्य</option>
              <option value="Released">♻️ Released / रिलीज़्ड</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search PL No, Part No..."
              className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-64"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          {!isReadOnlyAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Plus size={20} /> New Item
            </button>
          )}
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-lg font-semibold hover:bg-indigo-50 transition-colors"
          >
            <Download size={20} /> Excel
          </button>
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-lg font-semibold hover:bg-indigo-50 transition-colors"
          >
            <FileText size={20} /> PDF
          </button>
        </div>
      </div>
      </div>

      {/* Folio View Toggles & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-3 pt-1">
        <div className="flex border border-slate-200 bg-slate-50 p-1 rounded-xl gap-1">
          <button
            onClick={() => { setCurrentTab('items'); setSelectedFolioName(null); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
              currentTab === 'items'
                ? "bg-white text-primary shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            <Layers size={14} />
            All Items ({filteredParts.length})
          </button>
          <button
            onClick={() => setCurrentTab('folios')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
              currentTab === 'folios'
                ? "bg-white text-primary shadow-sm border border-slate-200/50"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            <Folder size={14} />
            Folios / Folders ({Object.keys(partsByFolio).length})
          </button>
        </div>

        {currentTab === 'folios' && !isReadOnlyAdmin && (
          <button
            onClick={() => setShowFolioCreateModal(true)}
            className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-xl text-xs font-black transition-all"
          >
            <Plus size={16} /> Create New Folio
          </button>
        )}
      </div>

      <div className="flex-grow flex flex-col min-h-0 pb-16">
        {currentTab === 'folios' && selectedFolioName === null ? (
          /* Folios Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 overflow-auto flex-grow min-h-0 py-4 pr-1">
            {Object.entries(partsByFolio).map(([folioName, items]) => {
              const foundFolio = folios.find(f => f.name.toLowerCase() === folioName.toLowerCase());
              const hasTx = parts.some(part => (part.folioName || 'New Item') === folioName && partsWithTransactions.has(part.id));
              const canModifyFolio = isAdmin && !isReadOnlyAdmin && folioName.toLowerCase() !== 'new item' && !hasTx;

              return (
                <div
                  key={folioName}
                  onClick={() => setSelectedFolioName(folioName)}
                  className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-primary/40 hover:shadow-md cursor-pointer transition-all group flex flex-col justify-between h-[160px] relative"
                >
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3 group-hover:bg-primary group-hover:text-white transition-colors">
                      <Folder size={20} />
                    </div>
                    <h3 className="text-xs font-black text-slate-800 tracking-tight mb-1 group-hover:text-primary transition-colors line-clamp-1 pr-12">
                      {folioName}
                    </h3>
                    <p className="text-[10px] text-slate-500 font-bold">
                      {items.length} {items.length === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  
                  {/* Edit/Delete Folio Controls */}
                  {canModifyFolio && (
                    <div className="absolute top-4 right-4 flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-xs p-1 rounded-lg border border-slate-100 shadow-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (foundFolio) {
                            setFolioToEdit(foundFolio);
                            setFolioEditInputName(foundFolio.name);
                            setShowFolioEditModal(true);
                          }
                        }}
                        className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                        title="Rename Folio"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (foundFolio) {
                            setFolioToDelete(foundFolio);
                            setShowFolioDeleteConfirmModal(true);
                          }
                        }}
                        className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                        title="Delete Folio"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}

                  <div className="text-[10px] text-indigo-600 font-black flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Open Folio &rarr;
                  </div>
                </div>
              );
            })}
            {/* Create New Folio card */}
            {!isReadOnlyAdmin && (
              <div
                onClick={() => setShowFolioCreateModal(true)}
                className="bg-slate-50/50 rounded-2xl border border-dashed border-slate-300 p-5 hover:border-primary/60 hover:bg-indigo-50/20 cursor-pointer transition-all flex flex-col items-center justify-center text-center gap-2 group h-[160px]"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  <Plus size={16} />
                </div>
                <div className="text-[10px] font-black text-slate-600 group-hover:text-primary transition-colors">
                  Create New Folio
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Table View for All Items OR a Single Folio's Items */
          <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-auto flex-grow min-h-0 flex flex-col">
            {currentTab === 'folios' && selectedFolioName !== null && (
              /* Folio Header inside folder details */
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedFolioName(null)}
                    className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
                    title="Back to Folders"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="text-left">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Folio Folder</span>
                    <h2 className="text-xs font-black text-slate-800">{selectedFolioName}</h2>
                  </div>
                </div>
                <span className="text-xs font-bold px-3 py-1 bg-white rounded-full border border-slate-200 shadow-sm text-slate-600">
                  {partsToRender.length} {partsToRender.length === 1 ? 'item' : 'items'}
                </span>
              </div>
            )}
            
            <div className="overflow-auto flex-grow">
              <table className="w-full text-left min-w-[1000px] border-collapse">
                <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Sr No.</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">PL No.</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Description</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Part No.</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Rate</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Stock</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Total Value</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Location</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Whether Use</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Item Condition</th>
                    <th className="sticky top-0 bg-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {partsToRender.map((part, index) => (
                    <tr key={part.id} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-6 py-4 text-xs font-bold">{index + 1}</td>
                        <td className="px-6 py-4 text-xs font-mono font-bold text-primary">{part.plNo}</td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-3">
                            {part.imageUrl && (
                              <div className="w-10 h-10 rounded border border-slate-200/60 overflow-hidden flex-shrink-0 bg-slate-50 flex items-center justify-center">
                                <img src={part.imageUrl} alt={part.description} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                              </div>
                            )}
                            <div>{part.description}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono">{part.partNo}</td>
                        <td className="px-6 py-4 text-sm">₹{(Number.isNaN(part.rate) ? 0 : (part.rate || 0)).toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm font-bold">
                          {Number.isNaN(part.stock) ? 0 : (part.stock || 0)} <span className="text-xs font-semibold text-slate-500">{part.unit || 'Nos'}</span>
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-primary">₹{(Number.isNaN(part.totalValue) ? 0 : (part.totalValue || 0)).toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm">{part.location}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm",
                            part.whetherUse === 'CS' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                            part.whetherUse === 'MS' ? "bg-indigo-50 text-indigo-700 border border-indigo-200" :
                            part.whetherUse === 'T&P' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            "bg-amber-50 text-amber-700 border border-amber-200"
                          )}>
                            {part.whetherUse || 'CS'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-2xs border flex items-center gap-1 w-fit whitespace-nowrap",
                            getItemCondition(part) === 'Serviceable' ? "bg-blue-50 text-blue-800 border-blue-200" :
                            getItemCondition(part) === 'Released' ? "bg-amber-50 text-amber-800 border-amber-200" :
                            "bg-emerald-50 text-emerald-800 border-emerald-200"
                          )}>
                            {getItemCondition(part) === 'Serviceable' ? '🛠️ Serviceable' : getItemCondition(part) === 'Released' ? '♻️ Released' : '✨ New'}
                          </span>
                        </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleShowHistory(part)}
                            className="p-2 text-secondary hover:text-primary transition-colors"
                            title="View History"
                          >
                            <Eye size={18} />
                          </button>
                          {isAdmin && !isReadOnlyAdmin && (
                            <>
                              {(!partsWithTransactions.has(part.id) || !isEmployee) && (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditPartData({
                                        id: part.id,
                                        plNo: part.plNo,
                                        description: part.description,
                                        partNo: part.partNo,
                                        rate: part.rate,
                                        stock: part.stock,
                                        unit: part.unit || 'Nos',
                                        location: part.location || '',
                                        whetherUse: part.whetherUse || 'CS',
                                        remarks: part.remarks || '',
                                        totalValue: part.totalValue,
                                        machineName: part.machineName || '',
                                        imageUrl: part.imageUrl || '',
                                        minQty: part.minQty !== undefined ? part.minQty : 5,
                                        folioName: part.folioName || '',
                                      });
                                      const pUnit = part.unit || 'Nos';
                                      if (!STANDARD_UOM_OPTIONS.some(o => o.value === pUnit && o.value !== 'Other')) {
                                        setEditPartCustomUnit(pUnit);
                                      } else {
                                        setEditPartCustomUnit('');
                                      }
                                      setIsCustomFolioEdit(false);
                                      setCustomFolioEditInput('');
                                      setEditPartData(prev => ({ ...prev, itemCondition: getItemCondition(part), voucherNo: part.voucherNo || `VOU-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}` }));
                                      const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
                                      const mName = part.machineName || '';
                                      if (mName && !standardMachines.includes(mName)) {
                                        setIsCustomMachineEdit(true);
                                        setCustomMachineEditInput(mName);
                                      } else {
                                        setIsCustomMachineEdit(false);
                                        setCustomMachineEditInput('');
                                      }
                                      setShowEditModal(true);
                                    }}
                                    className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors"
                                    title="Edit Item"
                                  >
                                    <Edit size={18} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPartToDelete(part.id);
                                      setShowDeleteModal(true);
                                    }}
                                    className="p-2 text-red-400 hover:text-red-600 transition-colors"
                                    title="Delete Item"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create Folio Modal */}
      <AnimatePresence>
        {showFolioCreateModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl border border-slate-100"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2 text-primary font-black">
                  <Folder className="text-indigo-600" size={20} />
                  <span>Create New Folio</span>
                </div>
                <button onClick={() => setShowFolioCreateModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateFolio} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Folio (Folder) Name</label>
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    value={folioInputName}
                    onChange={e => setFolioInputName(e.target.value)}
                    placeholder="e.g., Mechanical Parts Folio"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowFolioCreateModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-bold rounded-lg shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="animate-spin" size={14} />}
                    Create Folder
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Folio Modal */}
      <AnimatePresence>
        {showFolioEditModal && folioToEdit && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl border border-slate-100"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2 text-primary font-black">
                  <Folder className="text-indigo-600" size={20} />
                  <span>Rename Folio</span>
                </div>
                <button onClick={() => { setShowFolioEditModal(false); setFolioToEdit(null); }} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleEditFolio} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Folio Name</label>
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    value={folioEditInputName}
                    onChange={e => setFolioEditInputName(e.target.value)}
                    placeholder="e.g., Mechanical Parts Folio"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowFolioEditModal(false); setFolioToEdit(null); }}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-bold rounded-lg shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="animate-spin" size={14} />}
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Folio Confirm Modal */}
      <AnimatePresence>
        {showFolioDeleteConfirmModal && folioToDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl border border-slate-100 p-6"
            >
              <div className="flex items-center gap-3 text-red-600 font-black mb-3">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                  <Trash2 size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black">Delete Folio Folder?</h3>
                  <p className="text-xs text-slate-500 font-bold">This action cannot be undone.</p>
                </div>
              </div>
              
              <div className="text-xs text-slate-600 mb-6 space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p>Are you sure you want to delete the folio folder <span className="font-bold text-slate-800">"{folioToDelete.name}"</span>?</p>
                <p className="font-semibold text-indigo-600">&rarr; All parts currently inside this folio will be moved to the <span className="font-bold">"New Item"</span> folder.</p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowFolioDeleteConfirmModal(false); setFolioToDelete(null); }}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteFolio}
                  disabled={submitting}
                  className="px-5 py-2 bg-red-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-red-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="animate-spin" size={14} />}
                  Delete Folder
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Part Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center flex-shrink-0">
              <h2 className="text-xl font-bold text-primary">Create New Item</h2>
              <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddPart} className="p-6 space-y-4 overflow-y-auto flex-1">
              <datalist id="catalog-pl-autocomplete">
                {Array.from(new Set(parts.map(p => p.plNo).filter(Boolean))).map(pl => (
                  <option key={pl} value={pl} />
                ))}
              </datalist>

              <datalist id="catalog-part-no-autocomplete">
                {Array.from(new Set(parts.map(p => p.partNo).filter(Boolean))).map(pn => (
                  <option key={pn} value={pn} />
                ))}
              </datalist>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <input
                    type="text"
                    list="catalog-pl-autocomplete"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-medium"
                    value={newPart.plNo}
                    onChange={e => handleCatalogPlChange(e.target.value)}
                    placeholder="Enter or select PL No."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    list="catalog-part-no-autocomplete"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-medium"
                    value={newPart.partNo}
                    onChange={e => handleCatalogPartNoChange(e.target.value)}
                    placeholder="Enter or select Part No."
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1 flex items-center justify-between">
                    <span>Voucher No. (वाउचर न.)</span>
                    <span className="text-[10px] text-indigo-600 font-medium normal-case">(Auto if blank)</span>
                  </label>
                  <input
                    type="text"
                    className="w-full border border-indigo-200 rounded px-3 py-2 text-sm font-mono font-bold text-indigo-900 bg-indigo-50/40"
                    value={newPart.voucherNo}
                    onChange={e => setNewPart({ ...newPart, voucherNo: e.target.value })}
                    placeholder={`e.g. VOU-${format(new Date(), 'yy')}-123456`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                    value={newPart.whetherUse}
                    onChange={e => setNewPart({ ...newPart, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Item Condition (वस्तु की स्थिति)</label>
                  <select
                    className="w-full border border-indigo-200 rounded px-3 py-2 text-sm bg-indigo-50/40 font-bold text-indigo-900"
                    value={newPart.itemCondition || 'New'}
                    onChange={e => setNewPart({ ...newPart, itemCondition: e.target.value })}
                    required
                  >
                    <option value="New">✨ New / नया Item</option>
                    <option value="Serviceable">🛠️ Serviceable / सर्विस-योग्य Item</option>
                    <option value="Released">♻️ Released / रिलीज़्ड Item</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.description}
                    onChange={e => setNewPart({ ...newPart, description: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate (दर)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.rate}
                    onChange={e => setNewPart({ ...newPart, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Unit of Measure (इकाई)</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-800"
                    value={STANDARD_UOM_OPTIONS.some(o => o.value === newPart.unit && o.value !== 'Other') ? newPart.unit : 'Other'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'Other') {
                        setNewPart({ ...newPart, unit: 'Other' });
                      } else {
                        setNewPart({ ...newPart, unit: val });
                        setNewPartCustomUnit('');
                      }
                    }}
                  >
                    {STANDARD_UOM_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {(newPart.unit === 'Other' || !STANDARD_UOM_OPTIONS.some(o => o.value === newPart.unit && o.value !== 'Other')) && (
                    <input
                      type="text"
                      required
                      placeholder="Type custom unit name (e.g. Barrel, Dozen, Tin...)"
                      className="w-full mt-2 border border-amber-300 rounded px-3 py-1.5 text-sm bg-amber-50/80 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={newPartCustomUnit}
                      onChange={e => setNewPartCustomUnit(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Initial Stock (प्रारंभिक मात्रा)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-bold"
                    value={newPart.stock}
                    onChange={e => setNewPart({ ...newPart, stock: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    placeholder="e.g. 10 or 0.5"
                    required
                  />
                </div>

                {newPart.stock >= 1 && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newPart.location}
                      onChange={e => setNewPart({ ...newPart, location: e.target.value })}
                      placeholder="e.g. Rack A / Bin 3"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Folio (Folder)</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-semibold text-slate-800"
                    value={isCustomFolioNew ? 'create-new-folio' : newPart.folioName || 'New Item'}
                    onChange={(e) => {
                      if (e.target.value === 'create-new-folio') {
                        setIsCustomFolioNew(true);
                        setNewPart({ ...newPart, folioName: customFolioNewInput });
                      } else {
                        setIsCustomFolioNew(false);
                        setNewPart({ ...newPart, folioName: e.target.value });
                      }
                    }}
                  >
                    <option value="New Item">New Item</option>
                    {folios.filter(f => f.name.toLowerCase() !== 'new item').map(f => (
                      <option key={f.id} value={f.name}>{f.name}</option>
                    ))}
                    <option value="create-new-folio" className="text-indigo-600 font-bold">+ Create New Folio</option>
                  </select>
                </div>
                {isCustomFolioNew && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Type New Folio Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                      value={customFolioNewInput}
                      onChange={(e) => {
                        setCustomFolioNewInput(e.target.value);
                        setNewPart({ ...newPart, folioName: e.target.value });
                      }}
                      placeholder="e.g. Electrical Folio"
                      required
                    />
                  </div>
                )}
                {!isEmployee && (
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                      <select
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                        value={isCustomMachineNew ? 'Other' : newPart.machineName}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setIsCustomMachineNew(true);
                            setNewPart({ ...newPart, machineName: customMachineNewInput });
                          } else {
                            setIsCustomMachineNew(false);
                            setNewPart({ ...newPart, machineName: e.target.value });
                          }
                        }}
                      >
                        <option value="">None / General</option>
                        {allMachinesList.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="Other">Other (Type custom)</option>
                      </select>
                    </div>
                    {isCustomMachineNew && (
                      <div>
                        <label className="block text-xs font-bold uppercase text-secondary mb-1">Type Machine Name</label>
                        <input
                          type="text"
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                          value={customMachineNewInput}
                          onChange={(e) => {
                            setCustomMachineNewInput(e.target.value);
                            setNewPart({ ...newPart, machineName: e.target.value });
                          }}
                          placeholder="e.g. NEW-MACHINE"
                          required
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                    <div className="relative w-24 h-24 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                      {newPart.imageUrl ? (
                        <>
                          <img src={newPart.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setNewPart(prev => ({ ...prev, imageUrl: '' }))}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Camera size={24} />
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 w-full">
                      <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-4 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          onChange={(e) => handleImageUpload(e, false)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={18} className="text-indigo-500 mb-1" />
                        <p className="text-xs font-bold text-slate-700">Click or Drag Image Here</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={newPart.remarks}
                    onChange={e => setNewPart({ ...newPart, remarks: e.target.value })}
                    placeholder="Enter remarks for this item..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
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
                  Save Item
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* Edit Part Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center flex-shrink-0">
              <h2 className="text-xl font-bold text-primary">Edit Item</h2>
              <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditPart} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.plNo}
                    onChange={e => setEditPartData({ ...editPartData, plNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.partNo}
                    onChange={e => setEditPartData({ ...editPartData, partNo: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1 flex items-center justify-between">
                    <span>Voucher No. (वाउचर न.)</span>
                    <span className="text-[10px] text-indigo-600 font-medium normal-case">(Update Voucher)</span>
                  </label>
                  <input
                    type="text"
                    className="w-full border border-indigo-200 rounded px-3 py-2 text-sm font-mono font-bold text-indigo-900 bg-indigo-50/40"
                    value={editPartData.voucherNo || ''}
                    onChange={e => setEditPartData({ ...editPartData, voucherNo: e.target.value })}
                    placeholder={`e.g. VOU-${format(new Date(), 'yy')}-123456`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                    value={editPartData.whetherUse}
                    onChange={e => setEditPartData({ ...editPartData, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Item Condition (वस्तु की स्थिति)</label>
                  <select
                    className="w-full border border-indigo-200 rounded px-3 py-2 text-sm bg-indigo-50/40 font-bold text-indigo-900"
                    value={editPartData.itemCondition || 'New'}
                    onChange={e => setEditPartData({ ...editPartData, itemCondition: e.target.value })}
                    required
                  >
                    <option value="New">✨ New / नया Item</option>
                    <option value="Serviceable">🛠️ Serviceable / सर्विस-योग्य Item</option>
                    <option value="Released">♻️ Released / रिलीज़्ड Item</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.description}
                    onChange={e => setEditPartData({ ...editPartData, description: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate (दर)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.rate}
                    onChange={e => setEditPartData({ ...editPartData, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Unit of Measure (इकाई)</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-800"
                    value={STANDARD_UOM_OPTIONS.some(o => o.value === editPartData.unit && o.value !== 'Other') ? editPartData.unit : 'Other'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'Other') {
                        setEditPartData({ ...editPartData, unit: 'Other' });
                      } else {
                        setEditPartData({ ...editPartData, unit: val });
                        setEditPartCustomUnit('');
                      }
                    }}
                  >
                    {STANDARD_UOM_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {(editPartData.unit === 'Other' || !STANDARD_UOM_OPTIONS.some(o => o.value === editPartData.unit && o.value !== 'Other')) && (
                    <input
                      type="text"
                      required
                      placeholder="Type custom unit name (e.g. Barrel, Dozen, Tin...)"
                      className="w-full mt-2 border border-amber-300 rounded px-3 py-1.5 text-sm bg-amber-50/80 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={editPartCustomUnit}
                      onChange={e => setEditPartCustomUnit(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Stock (मात्रा)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-bold"
                    value={editPartData.stock}
                    onChange={e => setEditPartData({ ...editPartData, stock: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    placeholder="e.g. 10 or 0.5"
                    required
                  />
                </div>

                {editPartData.stock >= 1 && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editPartData.location || ''}
                      onChange={e => setEditPartData({ ...editPartData, location: e.target.value })}
                      placeholder="e.g. Rack A / Bin 3"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Folio (Folder)</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-semibold text-slate-800"
                    value={isCustomFolioEdit ? 'create-new-folio' : editPartData.folioName || 'New Item'}
                    onChange={(e) => {
                      if (e.target.value === 'create-new-folio') {
                        setIsCustomFolioEdit(true);
                        setEditPartData({ ...editPartData, folioName: customFolioEditInput });
                      } else {
                        setIsCustomFolioEdit(false);
                        setEditPartData({ ...editPartData, folioName: e.target.value });
                      }
                    }}
                  >
                    <option value="New Item">New Item</option>
                    {folios.filter(f => f.name.toLowerCase() !== 'new item').map(f => (
                      <option key={f.id} value={f.name}>{f.name}</option>
                    ))}
                    <option value="create-new-folio" className="text-indigo-600 font-bold">+ Create New Folio</option>
                  </select>
                </div>
                {isCustomFolioEdit && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Type New Folio Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                      value={customFolioEditInput}
                      onChange={(e) => {
                        setCustomFolioEditInput(e.target.value);
                        setEditPartData({ ...editPartData, folioName: e.target.value });
                      }}
                      placeholder="e.g. Electrical Folio"
                      required
                    />
                  </div>
                )}
                {!isEmployee && (
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                      <select
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                        value={isCustomMachineEdit ? 'Other' : editPartData.machineName}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setIsCustomMachineEdit(true);
                            setEditPartData({ ...editPartData, machineName: customMachineEditInput });
                          } else {
                            setIsCustomMachineEdit(false);
                            setEditPartData({ ...editPartData, machineName: e.target.value });
                          }
                        }}
                      >
                        <option value="">None / General</option>
                        {allMachinesList.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="Other">Other (Type custom)</option>
                      </select>
                    </div>
                    {isCustomMachineEdit && (
                      <div>
                        <label className="block text-xs font-bold uppercase text-secondary mb-1">Type Machine Name</label>
                        <input
                          type="text"
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                          value={customMachineEditInput}
                          onChange={(e) => {
                            setCustomMachineEditInput(e.target.value);
                            setEditPartData({ ...editPartData, machineName: e.target.value });
                          }}
                          placeholder="e.g. NEW-MACHINE"
                          required
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                    <div className="relative w-24 h-24 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                      {editPartData.imageUrl ? (
                        <>
                          <img src={editPartData.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setEditPartData(prev => ({ ...prev, imageUrl: '' }))}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Camera size={24} />
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 w-full">
                      <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-4 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          onChange={(e) => handleImageUpload(e, true)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={18} className="text-indigo-500 mb-1" />
                        <p className="text-xs font-bold text-slate-700">Click or Drag Image Here</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={editPartData.remarks || ''}
                    onChange={e => setEditPartData({ ...editPartData, remarks: e.target.value })}
                    placeholder="Enter remarks for this item..."
                  />
                </div>
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

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
            <div className="p-6 border-b border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-primary">Transaction History</h2>
                <div className="text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1.5 flex flex-wrap gap-x-3 gap-y-1 items-center">
                  <span className="text-indigo-950">Item: {selectedPart?.description}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-indigo-700">Part No: {selectedPart?.partNo || '-'}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-indigo-900">PL No: {selectedPart?.plNo || '-'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  onClick={exportHistoryToExcel}
                  className="flex items-center gap-1.5 border border-emerald-600 bg-emerald-50/50 hover:bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                  title="Export Transaction History to Excel"
                >
                  <Download size={14} className="text-emerald-700" />
                  Excel
                </button>
                <button
                  onClick={exportHistoryToPDF}
                  className="flex items-center gap-1.5 border border-rose-600 bg-rose-50/50 hover:bg-rose-100 text-rose-800 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                  title="Export Transaction History to PDF"
                >
                  <FileText size={14} className="text-rose-700" />
                  PDF
                </button>
                <button 
                  onClick={() => setShowHistoryModal(false)} 
                  className="text-outline hover:text-on-surface p-1.5 hover:bg-slate-100 rounded-lg ml-1 transition-colors"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="px-6 pb-6 pt-0 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Date</th>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Voucher No. (वाउचर न.)</th>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Type</th>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Qty</th>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Total Qty</th>
                    <th className="sticky top-0 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {history.map((h) => (
                    <tr key={h.id} className="text-sm">
                      <td className="px-4 py-3">{h.date}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200 inline-block whitespace-nowrap">
                          {h.voucherNo || h.demandNo || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-black uppercase",
                          (h.type === 'received' || h.type === 'old_stock') ? "bg-green-100 text-green-700" :
                          h.type === 'issued' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
                        )}>
                          {h.type === 'old_stock' ? 'received' : h.type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">{h.qty}</td>
                      <td className="px-4 py-3 font-black text-indigo-700">{h.runningBalance !== undefined ? h.runningBalance : '-'}</td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant font-medium">
                        <div className="space-y-1.5">
                          {/* Transaction Source Badge */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(() => {
                              const detailsLower = h.details?.toLowerCase() || '';
                              if (detailsLower.includes('unconnected')) {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase">
                                    Unconnected Receipt
                                  </span>
                                );
                              } else if (detailsLower.includes('demand')) {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 uppercase">
                                    Demand Receipt
                                  </span>
                                );
                              } else if (detailsLower.includes('initial') || h.type === 'old_stock') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-200 uppercase">
                                    Inventory (Initial Stock)
                                  </span>
                                );
                              } else if (h.type === 'issued') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 uppercase">
                                    Issue
                                  </span>
                                );
                              } else {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 uppercase">
                                    Inventory Adjustment
                                  </span>
                                );
                              }
                            })()}

                            {/* Extra metadata badges - hide for unconnected receipts */}
                            {!(h.details?.toLowerCase() || '').includes('unconnected') && (
                              <>
                                {/* Machine Name */}
                                {h.machineName && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                    ⚙️ {stripHtml(h.machineName)}
                                  </span>
                                )}

                                {/* Zone & Division */}
                                {(h.zone || h.division) && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                    📍 {stripHtml(h.zone || '')} {h.division ? `(${stripHtml(h.division)})` : ''}
                                  </span>
                                )}

                                {/* Company Name */}
                                {h.companyName && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                    🏢 {stripHtml(h.companyName)}
                                  </span>
                                )}
                              </>
                            )}
                          </div>

                          {/* Receiver Info */}
                          {(h.receiverName || (h.type === 'issued' && h.details?.includes('Issued to: '))) && (
                            <div className="text-[11px] text-slate-700">
                              👤 <span className="font-semibold">Receiver / Issued to:</span> {stripHtml(h.receiverName || h.details?.replace('Issued to: ', ''))}
                            </div>
                          )}

                          {/* Remarks */}
                          {h.remarks ? (
                            <div className="text-[11px] text-indigo-950 font-bold bg-amber-50 border border-amber-200 px-2 py-1 rounded inline-block mt-0.5 shadow-sm">
                              📝 <span className="text-amber-800">Remarks / Details:</span> {stripHtml(h.remarks)}
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[10px]">No remarks provided</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-outline italic">No transaction history found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all active:scale-95"
              >
                Close
              </button>
            </div>
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
                Are you sure you want to delete this item? This action cannot be undone and will remove all associated stock data.
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
                  onClick={handleDeletePart}
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
