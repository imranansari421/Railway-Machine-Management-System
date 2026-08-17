import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { 
  Store as StoreIcon, Plus, Search, Filter, Download, FileText, Edit, Edit2, Lock, Trash2, X, 
  Send, Package, Building2, Layers, AlertCircle, CheckCircle2, RefreshCw, ChevronRight, UserCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { findEmployeeForUser } from '../utils/employee';
import { generateIssueNotePDF } from '../utils/pdfGenerator';

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
    stock: 1,
    rate: 0,
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

  // 2. Fetch Machines & Companies lists for dropdowns
  useEffect(() => {
    const unsubGen = onSnapshot(doc(db, 'settings', 'general'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
      }
    }, (err) => {
      console.warn("Settings fetch warning:", err?.message || err);
    });

    const unsubEmp = onSnapshot(collection(db, 'employees'), (snap) => {
      const comps = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        if (data.companyName) comps.add(data.companyName);
      });
      setCompaniesList(Array.from(comps).sort());
    }, (err) => {
      console.warn("Employees fetch warning:", err?.message || err);
    });

    return () => {
      unsubGen();
      unsubEmp();
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

  // Default fallback machines
  const allMachines = useMemo(() => {
    const defaultList = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    return Array.from(new Set([...defaultList, ...machinesList])).sort();
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
            createdBy: data.createdBy || ''
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

  // Auto-fill matching function when Part No or PL No is typed/selected in Store Add Item form
  const matchAndAutoFillStoreForm = (field: 'plNo' | 'partNo', val: string) => {
    if (!val.trim()) return;
    const clean = val.trim().toLowerCase();

    // Check catalogParts and store items for matches
    const matched = catalogParts.find(p => 
      (field === 'plNo' ? p.plNo?.trim().toLowerCase() === clean : p.partNo?.trim().toLowerCase() === clean) ||
      (field === 'plNo' ? p.partNo?.trim().toLowerCase() === clean : p.plNo?.trim().toLowerCase() === clean)
    ) || items.find(i => 
      (field === 'plNo' ? i.plNo?.trim().toLowerCase() === clean : i.partNo?.trim().toLowerCase() === clean) ||
      (field === 'plNo' ? i.partNo?.trim().toLowerCase() === clean : i.plNo?.trim().toLowerCase() === clean)
    );

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
        rate: Number(matched.rate) || prev.rate || 0,
        location: matched.location || prev.location || '',
        remarks: matched.remarks || prev.remarks || '',
      }));

      setAutoMatchedInfo(`Auto-filled item details for "${matched.description || val}" from Catalog/Store`);
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
      stock: 1,
      rate: 0,
      location: '',
      itemCondition: 'New',
      remarks: ''
    });
    setShowAddEditModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (item: StoreItem) => {
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
      stock: item.stock,
      rate: item.rate,
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

    try {
      const company = userCompanyName || currentEmployee?.companyName || 'General Store';
      const finalUnit = itemForm.unit === 'Other' ? (itemForm.customUnit.trim() || 'Nos') : (itemForm.unit || 'Nos');
      const finalCategory = itemForm.category === 'Other' ? (itemForm.customCategory.trim() || 'General') : (itemForm.category || 'Spare Parts');

      const itemData = {
        plNo: itemForm.plNo.trim(),
        description: itemForm.description.trim(),
        partNo: itemForm.partNo.trim(),
        category: finalCategory,
        unit: finalUnit,
        stock: Number(itemForm.stock) || 0,
        rate: Number(itemForm.rate) || 0,
        totalValue: (Number(itemForm.stock) || 0) * (Number(itemForm.rate) || 0),
        location: itemForm.location.trim(),
        companyName: company,
        itemCondition: itemForm.itemCondition,
        remarks: itemForm.remarks.trim(),
        updatedAt: new Date().toISOString()
      };

      if (editingItem) {
        await updateDoc(doc(db, 'store_items', editingItem.id), itemData);
        toast.success("Store item updated successfully!");
      } else {
        await addDoc(collection(db, 'store_items'), {
          ...itemData,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.email || ''
        });
        toast.success("New store item added successfully!");
      }

      setShowAddEditModal(false);
    } catch (err) {
      console.error("Error saving store item:", err);
      toast.error("Failed to save store item.");
    }
  };

  // Delete Store Item
  const handleDeleteItem = async (id: string, desc: string) => {
    if (!window.confirm(`Are you sure you want to delete "${desc}" from the Store?`)) return;
    try {
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

  // Export Store Items to Excel
  const handleExportExcel = () => {
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

  // Export Store Items to PDF
  const handleExportPDF = () => {
    if (filteredItems.length === 0) {
      toast.error("No store items to export.");
      return;
    }
    const docPdf = new jsPDF('landscape');
    docPdf.setFontSize(14);
    docPdf.text(`Company Store Stock Inventory (${userCompanyName || 'All Companies'})`, 14, 15);
    docPdf.setFontSize(9);
    docPdf.text(`Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')}`, 14, 21);

    const tableData = filteredItems.map((item, idx) => [
      idx + 1,
      item.plNo || '-',
      item.description,
      item.partNo || '-',
      item.category,
      item.unit,
      item.stock,
      `₹${item.rate}`,
      `₹${item.totalValue}`,
      item.location || '-',
      item.itemCondition
    ]);

    autoTable(docPdf, {
      startY: 25,
      head: [['#', 'PL No', 'Description', 'Part No', 'Category', 'Unit', 'Stock', 'Rate', 'Total Value', 'Location', 'Condition']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8 }
    });

    docPdf.save(`Company_Store_Inventory_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF report generated!");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-indigo-500/10 backdrop-blur-3xl rounded-l-full pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-indigo-300 text-xs font-black tracking-wide uppercase">
              <Building2 size={14} />
              {userCompanyName || 'Company Store & Dispatch'}
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-3">
              <StoreIcon className="text-indigo-400 stroke-[2.5]" size={32} />
              Company Store Inventory
            </h1>
            <p className="text-xs md:text-sm text-slate-300 font-medium max-w-2xl">
              Store company parts, spares & consumables. Dispatch and issue items directly to machines or other companies with automated PDF Vouchers.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
            >
              <Plus size={16} />
              Add Item to Store
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold text-xs transition-all border border-white/10"
              title="Export to Excel"
            >
              <Download size={14} />
              Excel
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold text-xs transition-all border border-white/10"
              title="Export to PDF"
            >
              <FileText size={14} />
              PDF Report
            </button>
          </div>
        </div>

        {/* Stats Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/10">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-wider block">Total Items</span>
            <span className="text-2xl font-black text-white">{stats.totalItems}</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-wider block">Total Stock Qty</span>
            <span className="text-2xl font-black text-indigo-300">{stats.totalQty}</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-wider block">Total Store Valuation</span>
            <span className="text-2xl font-black text-emerald-400">₹{stats.totalVal.toLocaleString('en-IN')}</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-wider block">Low Stock (&le; 5)</span>
            <span className={cn("text-2xl font-black", stats.lowStockCount > 0 ? "text-amber-400 animate-pulse" : "text-slate-300")}>
              {stats.lowStockCount}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Header & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('inventory')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap",
              activeTab === 'inventory'
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Package size={16} />
            Store Stock Inventory ({filteredItems.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap",
              activeTab === 'history'
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Send size={16} />
            Issue History Vouchers ({filteredIssueRecords.length})
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search item, PL No, part, location..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Filters Bar for Inventory Tab */}
      {activeTab === 'inventory' && (
        <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 text-xs font-bold text-slate-700 shadow-sm">
          <span className="flex items-center gap-1.5 text-slate-400 uppercase tracking-wider text-[10px] font-black mr-1">
            <Filter size={14} /> Filters:
          </span>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">All Categories</option>
              {availableCategoriesForFilter.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Condition Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Condition:</span>
            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">All Conditions</option>
              <option value="New">New</option>
              <option value="Serviceable">Serviceable</option>
              <option value="Released">Released</option>
            </select>
          </div>

          {/* Company Filter (for admins) */}
          {(!isEmployee || userAccessType === 'full') && companiesList.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Company:</span>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 max-w-[180px] truncate"
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
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3 shadow-sm">
          <RefreshCw size={32} className="animate-spin text-indigo-600" />
          <p className="text-xs font-bold">Loading store inventory...</p>
        </div>
      ) : activeTab === 'inventory' ? (
        /* Inventory Table */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">#</th>
                  <th className="py-3.5 px-4">PL No / Part No</th>
                  <th className="py-3.5 px-4">Item Description</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4 text-center">Condition</th>
                  <th className="py-3.5 px-4 text-center">Available Stock</th>
                  <th className="py-3.5 px-4 text-right">Rate (₹)</th>
                  <th className="py-3.5 px-4 text-right">Total Valuation</th>
                  <th className="py-3.5 px-4 text-center">Storage Loc</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                {filteredItems.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900">{item.plNo || '-'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{item.partNo || 'No Part #'}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{item.description}</div>
                      {item.companyName && (
                        <div className="text-[10px] text-indigo-600 font-semibold">{item.companyName}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-extrabold uppercase">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold inline-block",
                        item.itemCondition === 'New' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        item.itemCondition === 'Serviceable' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                        "bg-slate-100 text-slate-600 border border-slate-200"
                      )}>
                        {item.itemCondition}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={cn(
                        "px-3 py-1 rounded-xl text-xs font-black inline-flex items-center gap-1",
                        item.stock <= 0 ? "bg-rose-50 text-rose-700 border border-rose-200" :
                        item.stock <= 5 ? "bg-amber-50 text-amber-800 border border-amber-200" :
                        "bg-indigo-50 text-indigo-700 border border-indigo-100"
                      )}>
                        {item.stock} {item.unit}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                      ₹{item.rate.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-black text-slate-900">
                      ₹{item.totalValue.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-center text-slate-500 font-medium">
                      {item.location || '-'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenIssueModal(item)}
                          disabled={item.stock <= 0}
                          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-black transition-all shadow-sm"
                          title="Issue Item to Machine / Company"
                        >
                          <Send size={13} />
                          Issue
                        </button>
                        <button
                          onClick={() => handleOpenEdit(item)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Edit Item"
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id, item.description)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Delete Item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Package size={36} className="text-slate-300 stroke-[1.5]" />
                        <p className="text-xs font-bold">No store items found.</p>
                        <p className="text-[10px]">Click "Add Item to Store" above to stock items for your company.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Issue History Table */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">#</th>
                  <th className="py-3.5 px-4">Voucher No & Date</th>
                  <th className="py-3.5 px-4">Issued Item</th>
                  <th className="py-3.5 px-4 text-center">Qty Issued</th>
                  <th className="py-3.5 px-4">Target Destination</th>
                  <th className="py-3.5 px-4">Received By (Consignee)</th>
                  <th className="py-3.5 px-4">Issued By</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                {filteredIssueRecords.map((rec, idx) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-black text-indigo-600">{rec.issueNoteNo}</div>
                      <div className="text-[10px] text-slate-400 font-medium">{rec.date}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{rec.description}</div>
                      <div className="text-[10px] font-mono text-slate-400">PL: {rec.plNo || 'N/A'} | Part: {rec.partNo || 'N/A'}</div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg font-black text-xs inline-block">
                        {rec.qty} {rec.unit}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">
                        {rec.targetMachine ? `Machine: ${rec.targetMachine}` : rec.targetCompany || 'Store'}
                      </div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        {rec.targetType === 'machine' ? 'Machine Dispatch' : 'Company Transfer'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{rec.receiverName}</div>
                      <div className="text-[10px] text-slate-400">{rec.receiverDesignation || 'Consignee Officer'}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">{rec.issuedBy}</div>
                      <div className="text-[10px] text-slate-400">{rec.officerDesignation || 'Store Official'}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleRedownloadVoucher(rec)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl font-bold text-xs transition-colors border border-indigo-200"
                        title="Download Issue Voucher PDF"
                      >
                        <Download size={13} />
                        Voucher PDF
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredIssueRecords.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Send size={36} className="text-slate-300 stroke-[1.5]" />
                        <p className="text-xs font-bold">No store issue records found.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

              {/* Auto-match Alert Banner */}
              {autoMatchedInfo && (
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
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
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
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
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
                    2. Inventory Stock & Valuation
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                    {/* Stock Qty */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Stock Qty <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        required
                        min={0}
                        value={itemForm.stock}
                        onChange={(e) => setItemForm({ ...itemForm, stock: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                        placeholder="e.g. 10 or 0.5"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
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
                        type="number"
                        min={0}
                        value={itemForm.rate}
                        onChange={(e) => setItemForm({ ...itemForm, rate: Number(e.target.value) })}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>

                    {/* Total Value Readout */}
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Total Stock Value</label>
                      <div className="px-3.5 py-2.5 bg-indigo-50/80 border border-indigo-100 rounded-xl text-sm font-black text-indigo-900 flex items-center justify-between">
                        <span>₹{((Number(itemForm.stock) || 0) * (Number(itemForm.rate) || 0)).toLocaleString('en-IN')}</span>
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
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-200 transition-all"
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
                  <div className={`p-2 rounded-xl border ${isNaOrEmpty(selectedItemToIssue.plNo) ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">PL No</span>
                      {isNaOrEmpty(selectedItemToIssue.plNo) ? (
                        <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-amber-200">
                          <Edit2 size={9} /> Editable (N/A)
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-slate-200">
                          <Lock size={9} /> Locked
                        </span>
                      )}
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

                  <div className={`p-2 rounded-xl border ${isNaOrEmpty(selectedItemToIssue.partNo) ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Part No</span>
                      {isNaOrEmpty(selectedItemToIssue.partNo) ? (
                        <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-amber-200">
                          <Edit2 size={9} /> Editable (N/A)
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-slate-200">
                          <Lock size={9} /> Locked
                        </span>
                      )}
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
                      onClick={() => setIssueForm({ ...issueForm, targetType: 'company' })}
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
                    <label className="text-xs font-bold text-slate-700">Select / Enter Target Company <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      value={issueForm.targetCompany}
                      onChange={(e) => setIssueForm({ ...issueForm, targetCompany: e.target.value })}
                      placeholder="e.g. Eastern Railway Depot, Central Store"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
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
    </div>
  );
}
