import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Download, FileText, Share2, Calendar, Edit, Trash2, PackageCheck } from 'lucide-react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions, cleanDisplayName } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { format, isValid } from 'date-fns';
import { toast } from 'sonner';

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
  userCompany?: string;
  userZone?: string;
  userDivision?: string;
  userAccessType?: string;
}

// Format date strictly to DD-MM-YYYY
function formatIssueDate(rawDate?: any): string {
  if (!rawDate) return format(new Date(), 'dd-MM-yyyy');
  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (!trimmed || trimmed === '-') return format(new Date(), 'dd-MM-yyyy');
    if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const [y, m, d] = trimmed.slice(0, 10).split('-');
      return `${d}-${m}-${y}`;
    }
    try {
      const parsed = new Date(trimmed);
      if (isValid(parsed) && parsed.getFullYear() > 1990) {
        return format(parsed, 'dd-MM-yyyy');
      }
    } catch {
      // ignore
    }
    return trimmed;
  }
  if (rawDate && typeof rawDate.toDate === 'function') {
    try {
      return format(rawDate.toDate(), 'dd-MM-yyyy');
    } catch {
      // ignore
    }
  }
  return format(new Date(), 'dd-MM-yyyy');
}

// Clean depot name without SSE/TM/ or SSE/ prefix
function cleanDepotName(name?: string): string {
  if (!name || name.trim() === '-' || name.trim().toLowerCase() === 'depot') {
    return 'Base Depot';
  }
  const cleaned = name
    .replace(/^SSE\/TM\//i, '')
    .replace(/^SSE\//i, '')
    .trim();
  return cleaned || 'Base Depot';
}

export default function IssueReportView({
  filterPerms,
  userMachine,
  userCompany,
  userZone,
  userDivision,
  userAccessType,
}: Props) {
  // Role Determinations
  const isFullAdmin = filterPerms.isFullAdmin;
  const isDivisionalAdmin = userAccessType === 'divisional-admin' || (!filterPerms.canChangeDivision && filterPerms.canChangeMachine);
  const isZonalAdmin = userAccessType === 'zonal-admin' || (!filterPerms.canChangeZone && filterPerms.canChangeMachine);
  const isCompanyAdmin = userAccessType === 'admin-light';
  const isRegularEmployee = !filterPerms.canChangeMachine || userAccessType === 'limited';

  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => (isRegularEmployee ? (userMachine || '') : 'all'));
  const [selectedCompany, setSelectedCompany] = useState(() => {
    return isFullAdmin ? 'all' : (userCompany || 'all');
  });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Position and Machines Mappings
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);
  const [empList, setEmpList] = useState<any[]>([]);

  // Sync userMachine for regular employee
  useEffect(() => {
    if (isRegularEmployee && userMachine) {
      setSelectedMachine(userMachine);
    }
  }, [isRegularEmployee, userMachine]);

  // Listen to machine_positions and settings
  useEffect(() => {
    const unsubPos = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const mapping: Record<string, { zone: string; division: string }> = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.machineName) {
          mapping[data.machineName] = {
            zone: data.zone || '',
            division: data.division || '',
          };
        }
      });
      setMachinePositions(mapping);
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
      }
    });

    return () => {
      unsubPos();
      unsubSettings();
    };
  }, []);

  // 10-row pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Edit Modal State
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    recordId: string;
    collectionName: string;
    fields: EditFieldConfig[];
    initialData: Record<string, any>;
  }>({
    isOpen: false,
    recordId: '',
    collectionName: 'issues',
    fields: [],
    initialData: {},
  });

  useEffect(() => {
    setLoading(true);

    let rawTransactions: any[] = [];
    let rawStoreIssues: any[] = [];
    let rawIssues: any[] = [];

    const partsMap = new Map<string, any>();
    const storeItemsMap = new Map<string, any>();
    const empMap = new Map<string, any>();

    // 1. Listen to parts catalog
    const unsubParts = onSnapshot(collection(db, 'parts'), (snap) => {
      partsMap.clear();
      snap.docs.forEach(d => {
        partsMap.set(d.id, { id: d.id, ...d.data() });
      });
      rebuildUnifiedIssues();
    });

    // 2. Listen to store_items catalog
    const unsubStoreItems = onSnapshot(collection(db, 'store_items'), (snap) => {
      storeItemsMap.clear();
      snap.docs.forEach(d => {
        storeItemsMap.set(d.id, { id: d.id, ...d.data() });
      });
      rebuildUnifiedIssues();
    });

    // 3. Listen to employees for designation lookup
    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      empMap.clear();
      const emps: any[] = [];
      snap.docs.forEach(d => {
        const emp = d.data();
        const empWithId = { id: d.id, ...emp };
        emps.push(empWithId);
        if (emp.name) empMap.set(emp.name.toLowerCase().trim(), emp);
        if (emp.email) empMap.set(emp.email.toLowerCase().trim(), emp);
        if (emp.employeeId) empMap.set(emp.employeeId.toLowerCase().trim(), emp);
        if (d.id) empMap.set(d.id, emp);
      });
      setEmpList(emps);
      rebuildUnifiedIssues();
    });

    // 4. Listen to transactions
    const unsubTransactions = onSnapshot(collection(db, 'transactions'), (snap) => {
      rawTransactions = snap.docs.map(d => ({ id: d.id, sourceCollection: 'transactions', ...d.data() }));
      rebuildUnifiedIssues();
    });

    // 5. Listen to store_issues
    const unsubStoreIssues = onSnapshot(collection(db, 'store_issues'), (snap) => {
      rawStoreIssues = snap.docs.map(d => ({ id: d.id, sourceCollection: 'store_issues', ...d.data() }));
      rebuildUnifiedIssues();
    });

    // 6. Listen to central issues collection
    const unsubIssues = onSnapshot(collection(db, 'issues'), (snap) => {
      rawIssues = snap.docs.map(d => ({ id: d.id, sourceCollection: 'issues', ...d.data() }));
      rebuildUnifiedIssues();
    });

    function findCatalogItem(item: any) {
      // 1. By ID
      if (item.partId && partsMap.has(item.partId)) return partsMap.get(item.partId);
      if (item.storeItemId && storeItemsMap.has(item.storeItemId)) return storeItemsMap.get(item.storeItemId);
      if (item.id && partsMap.has(item.id)) return partsMap.get(item.id);
      if (item.id && storeItemsMap.has(item.id)) return storeItemsMap.get(item.id);

      // 2. By PL No
      const rawPl = (item.plNo || '').trim();
      if (rawPl && rawPl !== '-' && rawPl.toUpperCase() !== 'NA' && rawPl.toUpperCase() !== 'N/A') {
        for (const p of partsMap.values()) {
          if (p.plNo && p.plNo.trim() === rawPl) return p;
        }
        for (const s of storeItemsMap.values()) {
          if (s.plNo && s.plNo.trim() === rawPl) return s;
        }
      }

      // 3. By Part No
      const rawPart = (item.partNo || '').trim().toLowerCase();
      if (rawPart && rawPart !== '-' && rawPart !== 'na' && rawPart !== 'n/a') {
        for (const p of partsMap.values()) {
          if (p.partNo && p.partNo.trim().toLowerCase() === rawPart) return p;
        }
        for (const s of storeItemsMap.values()) {
          if (s.partNo && s.partNo.trim().toLowerCase() === rawPart) return s;
        }
      }

      // 4. By normalized description
      const rawDesc = (item.description || item.itemName || item.partName || item.item || '').trim().toLowerCase();
      if (rawDesc && rawDesc !== '-' && rawDesc.length > 2) {
        for (const p of partsMap.values()) {
          const pDesc = (p.description || p.partName || p.name || '').trim().toLowerCase();
          if (pDesc && (pDesc === rawDesc || pDesc.includes(rawDesc) || rawDesc.includes(pDesc))) return p;
        }
        for (const s of storeItemsMap.values()) {
          const sDesc = (s.description || s.itemName || s.name || '').trim().toLowerCase();
          if (sDesc && (sDesc === rawDesc || sDesc.includes(rawDesc) || rawDesc.includes(sDesc))) return s;
        }
      }

      return null;
    }

    // Helper: Strict guard against demand requisitions, unconnected material, returns, receipts
    function isUnconnectedOrDemandOrNonIssue(item: any): boolean {
      // 1. If from demands collection
      if (item.sourceCollection === 'demands') return true;

      // 2. If non-issue transaction type
      const type = (item.type || '').toLowerCase().trim();
      if (
        type === 'received' ||
        type === 'return' ||
        type === 'returned' ||
        type === 'accountal' ||
        type === 'adjustment'
      ) {
        return true;
      }

      // 3. If linked to unconnected material receipt
      if (item.receiptId) return true;

      // 4. If voucher number matches unconnected material receipt (UMR) or non-issue vouchers
      const voucher = (
        item.voucherNo ||
        item.issueNoteNo ||
        item.issueVoucherNo ||
        ''
      ).toUpperCase().trim();

      if (
        voucher.startsWith('UMR') ||
        voucher.startsWith('UNC') ||
        voucher.startsWith('MRN') ||
        voucher.startsWith('VR-ACC') ||
        voucher.startsWith('REC-')
      ) {
        return true;
      }

      // 5. If details / remarks mention unconnected material or receiving
      const text = `${item.details || ''} ${item.remarks || ''} ${item.description || ''}`.toLowerCase();
      if (
        text.includes('unconnected') ||
        text.includes('un-connected') ||
        text.includes('received via') ||
        text.includes('accountal register')
      ) {
        return true;
      }

      return false;
    }

    function rebuildUnifiedIssues() {
      const itemsMap = new Map<string, any>();

      // A. Process Store Issues (`store_issues` collection) - Direct & Store Dispatches
      rawStoreIssues.forEach((s: any) => {
        if (isUnconnectedOrDemandOrNonIssue(s)) return;

        const catalog = findCatalogItem(s);

        let plNo = (s.plNo || '').trim();
        let partNo = (s.partNo || '').trim();
        if (plNo === '-' || plNo.toUpperCase() === 'NA' || plNo.toUpperCase() === 'N/A') plNo = '';
        if (partNo === '-' || partNo.toUpperCase() === 'NA' || partNo.toUpperCase() === 'N/A') partNo = '';

        if (!plNo && catalog?.plNo && catalog.plNo !== '-' && catalog.plNo.toUpperCase() !== 'NA') {
          plNo = catalog.plNo.trim();
        }
        if (!partNo && catalog?.partNo && catalog.partNo !== '-' && catalog.partNo.toUpperCase() !== 'NA') {
          partNo = catalog.partNo.trim();
        }

        let description = (s.description || s.itemName || s.name || '').trim();
        if (!description || description === '-' || description.toUpperCase() === 'NA') {
          if (catalog?.description || catalog?.name) {
            description = (catalog.description || catalog.name).trim();
          } else if (plNo) {
            description = `Store Inventory Item (PL: ${plNo})`;
          } else if (partNo) {
            description = `Machine Component (Part: ${partNo})`;
          } else {
            description = 'Central Store Dispatched Material';
          }
        }

        const qty = Math.max(1, Number(s.qty || 1));
        const unit = s.unit || catalog?.unit || 'Nos';
        const rawRate = Number(s.rate || catalog?.rate || 0);
        const rate = isNaN(rawRate) ? 0 : rawRate;
        const totalValue = Number(s.totalValue) || (qty * rate);

        const rawDate = s.date || s.createdAt;
        const formattedDate = formatIssueDate(rawDate);

        const issueNoteNo = (s.issueNoteNo || (s.id ? `IV-STORE-${s.id.slice(0, 6).toUpperCase()}` : 'IV-STORE')).trim();
        const demandNo = (s.demandNo || s.demandRefNo || '').trim();

        const issuedFrom = cleanDepotName(s.issuingCompany || s.issuingDepot || 'Central Store Depot');
        const issuedTo = (s.targetMachine || s.targetCompany || s.receiverName || 'Track Machine Unit').trim();

        let issuedBy = cleanDisplayName(s.issuedBy || s.officerName || s.lastActionByName || 'Store Keeper');
        if (!issuedBy || issuedBy === '-') issuedBy = 'Store Keeper';

        let issuedByDesignation = (s.officerDesignation || s.designation || '').trim();
        if (!issuedByDesignation || issuedByDesignation === '-') {
          const emp = empMap.get(issuedBy.toLowerCase());
          issuedByDesignation = emp?.designation || 'Store Depot Official';
        }

        let remarks = (s.remarks || '').trim();
        if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
          remarks = `Dispatched from Store to ${issuedTo} (${description})`;
        }

        const condition = s.condition || 'New';
        const companyName = s.issuingCompany || s.companyName || '';
        const receiverName = s.receiverName || issuedTo;

        const normVoucher = (issueNoteNo || '').toUpperCase().trim();
        const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
        const uniqueKey = normVoucher ? `${normVoucher}_${itemKey}` : `store_issues_${s.id}`;

        itemsMap.set(uniqueKey, {
          id: s.id,
          sourceCollection: 'store_issues',
          date: formattedDate,
          rawDate: rawDate || '',
          issueNoteNo,
          demandNo,
          plNo,
          partNo,
          description,
          qty,
          unit,
          rate,
          totalValue,
          issuedFrom,
          issuedTo,
          issuedBy,
          issuedByDesignation,
          receiverName,
          companyName,
          condition,
          remarks,
          zone: s.zone || '',
          division: s.division || '',
        });
      });

      // B. Process Central Issues (`issues` collection) - Action Desk & System Issues
      rawIssues.forEach((iss: any) => {
        if (isUnconnectedOrDemandOrNonIssue(iss)) return;

        const issueNoteNo = (iss.issueNoteNo || (iss.id ? `ISS-${iss.id.slice(0, 6).toUpperCase()}` : '')).trim();
        if (!issueNoteNo) return;

        const catalog = findCatalogItem(iss);

        let plNo = (iss.plNo || '').trim();
        let partNo = (iss.partNo || '').trim();
        if (plNo === '-' || plNo.toUpperCase() === 'NA' || plNo.toUpperCase() === 'N/A') plNo = '';
        if (partNo === '-' || partNo.toUpperCase() === 'NA' || partNo.toUpperCase() === 'N/A') partNo = '';

        if (!plNo && catalog?.plNo && catalog.plNo !== '-' && catalog.plNo.toUpperCase() !== 'NA') {
          plNo = catalog.plNo.trim();
        }
        if (!partNo && catalog?.partNo && catalog.partNo !== '-' && catalog.partNo.toUpperCase() !== 'NA') {
          partNo = catalog.partNo.trim();
        }

        let description = (iss.description || iss.itemName || iss.name || '').trim();
        if (!description || description === '-' || description.toUpperCase() === 'NA') {
          if (catalog?.description || catalog?.name) {
            description = (catalog.description || catalog.name).trim();
          } else if (plNo) {
            description = `Store Item (PL: ${plNo})`;
          } else if (partNo) {
            description = `Spares Component (Part: ${partNo})`;
          } else {
            description = 'Central Track Machine Spares';
          }
        }

        const qty = Math.max(1, Number(iss.qty || 1));
        const unit = iss.unit || catalog?.unit || 'Nos';
        const rawRate = Number(iss.rate || catalog?.rate || 0);
        const rate = isNaN(rawRate) ? 0 : rawRate;
        const totalValue = Number(iss.totalValue) || (qty * rate);

        const rawDate = iss.date || iss.createdAt;
        const formattedDate = formatIssueDate(rawDate);

        const demandNo = (iss.demandNo || '').trim();
        const issuedFrom = cleanDepotName(iss.issuingMachine || iss.issuingDepot || iss.machineName || iss.companyName || 'Central Depot');
        const issuedTo = cleanDepotName(iss.targetMachine || iss.targetMachineName || iss.machineName || iss.receiverName || 'Track Machine Unit');

        let issuedBy = cleanDisplayName(iss.issuedBy || 'Depot Official');
        if (!issuedBy || issuedBy === '-') issuedBy = 'Depot Official';

        const emp = empMap.get(issuedBy.toLowerCase());
        const issuedByDesignation = iss.issuedByDesignation || emp?.designation || 'Depot Incharge';

        let remarks = (iss.remarks || '').trim();
        if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
          remarks = `Issued to ${issuedTo} (${description})`;
        }

        const normVoucher = (issueNoteNo || '').toUpperCase().trim();
        const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
        const uniqueKey = normVoucher ? `${normVoucher}_${itemKey}` : `issues_${iss.id}`;

        if (!itemsMap.has(uniqueKey)) {
          itemsMap.set(uniqueKey, {
            id: iss.id,
            sourceCollection: 'issues',
            date: formattedDate,
            rawDate: rawDate || '',
            issueNoteNo,
            demandNo,
            plNo,
            partNo,
            description,
            qty,
            unit,
            rate,
            totalValue,
            issuedFrom,
            issuedTo,
            issuedBy,
            issuedByDesignation,
            receiverName: iss.receiverName || issuedTo,
            companyName: iss.companyName || '',
            condition: iss.condition || 'Good',
            remarks,
            zone: iss.zone || '',
            division: iss.division || '',
          });
        }
      });

      // C. Process Transactions (`transactions` collection) - ONLY Genuine Issued Transactions
      rawTransactions.forEach((t: any) => {
        // Exclude demands, unconnected materials, returns, adjustments, receipts
        if (isUnconnectedOrDemandOrNonIssue(t)) return;

        // Must be an issued transaction
        const isExplicitIssue =
          t.type === 'issued' ||
          t.isIssued === true ||
          (t.voucherNo && (t.voucherNo.startsWith('ISS') || t.voucherNo.startsWith('IV-')));

        if (!isExplicitIssue) return;

        const catalog = findCatalogItem(t);

        let plNo = (t.plNo || '').trim();
        let partNo = (t.partNo || '').trim();
        if (plNo === '-' || plNo.toUpperCase() === 'NA' || plNo.toUpperCase() === 'N/A') plNo = '';
        if (partNo === '-' || partNo.toUpperCase() === 'NA' || partNo.toUpperCase() === 'N/A') partNo = '';

        if (!plNo && catalog?.plNo && catalog.plNo !== '-' && catalog.plNo.toUpperCase() !== 'NA') {
          plNo = catalog.plNo.trim();
        }
        if (!partNo && catalog?.partNo && catalog.partNo !== '-' && catalog.partNo.toUpperCase() !== 'NA') {
          partNo = catalog.partNo.trim();
        }

        let description = (t.description || t.partName || t.itemName || '').trim();
        if (!description || description === '-' || description.toUpperCase() === 'NA') {
          if (catalog?.description || catalog?.name || catalog?.partName) {
            description = (catalog.description || catalog.name || catalog.partName).trim();
          } else if (plNo) {
            description = `Store Item (PL: ${plNo})`;
          } else if (partNo) {
            description = `Component (Part: ${partNo})`;
          } else if (t.details) {
            const m = t.details.match(/for\s+([^,\[]+)/i);
            description = m && m[1] ? m[1].trim() : 'Track Machine Consumable Spares';
          } else {
            description = 'Track Machine Consumable Spares';
          }
        }

        const qty = Math.max(1, Number(t.quantity || t.qty || 1));
        const unit = t.unit || catalog?.unit || 'Nos';
        const rawRate = Number(t.rate || catalog?.rate || 0);
        const rate = isNaN(rawRate) ? 0 : rawRate;
        const totalValue = Number(t.totalValue) || (qty * rate);

        const rawDate = t.date || t.timestamp || t.createdAt;
        const formattedDate = formatIssueDate(rawDate);

        const issueNoteNo = (
          t.issueNoteNo ||
          t.voucherNo ||
          (t.id ? `ISS-${t.id.slice(0, 6).toUpperCase()}` : 'ISS-TX')
        ).trim();

        // Extract demand number if available
        let demandNo = (t.demandNo || '').trim();
        if (!demandNo || demandNo === '-' || demandNo.toUpperCase() === 'NA') {
          if (t.details) {
            const m = t.details.match(/against\s+Demand\s+([^\s\[\]]+)/i);
            if (m && m[1]) demandNo = m[1].trim();
          }
        }

        // Extract issuedFrom & issuedTo
        const issuedFrom = cleanDepotName(t.machineName || t.depot || t.issuingDepot || 'Depot');

        let issuedTo = (
          t.targetMachineName ||
          t.issuedTo ||
          t.targetMachine ||
          t.issuedToMachine ||
          t.receiverName ||
          t.issuedToName ||
          ''
        ).trim();

        if (!issuedTo || issuedTo === '-' || issuedTo.toLowerCase() === 'machine') {
          if (t.details) {
            const mParen = t.details.match(/\(([^)]+)\)/);
            if (mParen && mParen[1] && !mParen[1].toLowerCase().includes('condition')) {
              issuedTo = mParen[1].trim();
            } else {
              const mTo = t.details.match(/Issued\s+to:?\s*([^(\[]+)/i);
              if (mTo && mTo[1]) issuedTo = mTo[1].trim();
            }
          }
        }
        if (!issuedTo || issuedTo === '-') issuedTo = 'Track Machine Unit';

        let issuedBy = cleanDisplayName(t.performedByName || t.issuedBy || t.lastActionByName || 'Depot Official');
        if (!issuedBy || issuedBy === '-') issuedBy = 'Depot Official';

        let issuedByDesignation = (t.designation || '').trim();
        if (!issuedByDesignation || issuedByDesignation === '-') {
          const emp = empMap.get(issuedBy.toLowerCase());
          issuedByDesignation = emp?.designation || 'Depot Official';
        }

        let remarks = (t.remarks || t.details || '').trim();
        if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
          remarks = `Issued to ${issuedTo} (${description})`;
        }

        const normVoucher = (issueNoteNo || '').toUpperCase().trim();
        const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
        const uniqueKey = normVoucher ? `${normVoucher}_${itemKey}` : `transactions_${t.id}`;

        if (!itemsMap.has(uniqueKey)) {
          itemsMap.set(uniqueKey, {
            id: t.id,
            sourceCollection: 'transactions',
            date: formattedDate,
            rawDate: rawDate || '',
            issueNoteNo,
            demandNo,
            plNo,
            partNo,
            description,
            qty,
            unit,
            rate,
            totalValue,
            issuedFrom,
            issuedTo,
            issuedBy,
            issuedByDesignation,
            receiverName: t.receiverName || issuedTo,
            companyName: t.companyName || '',
            condition: t.itemCondition || t.condition || 'Good',
            remarks,
            zone: t.zone || '',
            division: t.division || '',
          });
        }
      });

      const unifiedList = Array.from(itemsMap.values());
      // Sort newest first
      unifiedList.sort((a, b) => {
        const timeA = new Date(a.rawDate || a.date).getTime() || 0;
        const timeB = new Date(b.rawDate || b.date).getTime() || 0;
        return timeB - timeA;
      });

      setIssues(unifiedList);
      setLoading(false);
    }

    return () => {
      unsubParts();
      unsubStoreItems();
      unsubEmployees();
      unsubTransactions();
      unsubStoreIssues();
      unsubIssues();
    };
  }, []);

  const getMachineZone = (mName?: string): string => {
    if (!mName) return '';
    const clean = cleanDepotName(mName);
    if (machinePositions[clean]?.zone) return machinePositions[clean].zone;
    if (machinePositions[mName]?.zone) return machinePositions[mName].zone;
    for (const [key, pos] of Object.entries(machinePositions)) {
      if (key.toLowerCase() === clean.toLowerCase() || key.toLowerCase() === mName.toLowerCase()) {
        return pos.zone;
      }
    }
    for (const emp of empList) {
      if (cleanDepotName(emp.machineName || '').toLowerCase() === clean.toLowerCase()) {
        if (emp.zone) return emp.zone;
      }
    }
    return '';
  };

  const getMachineDivision = (mName?: string): string => {
    if (!mName) return '';
    const clean = cleanDepotName(mName);
    if (machinePositions[clean]?.division) return machinePositions[clean].division;
    if (machinePositions[mName]?.division) return machinePositions[mName].division;
    for (const [key, pos] of Object.entries(machinePositions)) {
      if (key.toLowerCase() === clean.toLowerCase() || key.toLowerCase() === mName.toLowerCase()) {
        return pos.division;
      }
    }
    for (const emp of empList) {
      if (cleanDepotName(emp.machineName || '').toLowerCase() === clean.toLowerCase()) {
        if (emp.division) return emp.division;
      }
    }
    return '';
  };

  const issueMatchesMachine = (i: any, machineToMatch: string): boolean => {
    if (!machineToMatch || machineToMatch === 'all') return true;
    const targetClean = cleanDepotName(machineToMatch).toLowerCase();
    const toClean = cleanDepotName(i.issuedTo || '').toLowerCase();
    const fromClean = cleanDepotName(i.issuedFrom || '').toLowerCase();
    const rawTo = (i.issuedTo || '').toLowerCase();
    const rawFrom = (i.issuedFrom || '').toLowerCase();

    return (
      toClean === targetClean ||
      fromClean === targetClean ||
      toClean.includes(targetClean) ||
      fromClean.includes(targetClean) ||
      rawTo.includes(targetClean) ||
      rawFrom.includes(targetClean)
    );
  };

  const issueMatchesDivision = (i: any, targetDiv: string): boolean => {
    if (!targetDiv || targetDiv === 'all') return true;
    const divLower = targetDiv.toLowerCase();
    if (i.division && i.division.toLowerCase() === divLower) return true;
    const toDiv = getMachineDivision(i.issuedTo);
    if (toDiv && toDiv.toLowerCase() === divLower) return true;
    const fromDiv = getMachineDivision(i.issuedFrom);
    if (fromDiv && fromDiv.toLowerCase() === divLower) return true;
    return false;
  };

  const issueMatchesZone = (i: any, targetZone: string): boolean => {
    if (!targetZone || targetZone === 'all') return true;
    const zoneLower = targetZone.toLowerCase();
    if (i.zone && i.zone.toLowerCase() === zoneLower) return true;
    const toZone = getMachineZone(i.issuedTo);
    if (toZone && toZone.toLowerCase() === zoneLower) return true;
    const fromZone = getMachineZone(i.issuedFrom);
    if (fromZone && fromZone.toLowerCase() === zoneLower) return true;
    return false;
  };

  const issueMatchesCompany = (i: any, targetCompany: string): boolean => {
    if (!targetCompany || targetCompany === 'all') return true;
    const compLower = targetCompany.toLowerCase();
    if (i.companyName && i.companyName.toLowerCase() === compLower) return true;
    for (const emp of empList) {
      if (emp.companyName && emp.companyName.toLowerCase() === compLower) {
        if (
          cleanDepotName(emp.machineName || '').toLowerCase() === cleanDepotName(i.issuedTo || '').toLowerCase() ||
          cleanDepotName(emp.machineName || '').toLowerCase() === cleanDepotName(i.issuedFrom || '').toLowerCase()
        ) {
          return true;
        }
      }
    }
    return false;
  };

  // Scoped list of machines available for machine-wise filtering
  const scopedMachinesList = useMemo(() => {
    const allSet = new Set<string>();
    issues.forEach(i => {
      if (i.issuedTo && i.issuedTo !== 'Track Machine Unit' && i.issuedTo !== 'Base Depot') {
        allSet.add(cleanDepotName(i.issuedTo));
      }
      if (i.issuedFrom && i.issuedFrom !== 'Base Depot' && i.issuedFrom !== 'Track Machine Unit') {
        allSet.add(cleanDepotName(i.issuedFrom));
      }
    });
    settingsMachines.forEach(m => {
      if (m && m.trim()) allSet.add(cleanDepotName(m));
    });
    Object.keys(machinePositions).forEach(m => {
      if (m && m.trim()) allSet.add(cleanDepotName(m));
    });
    empList.forEach(e => {
      if (e.machineName && e.machineName.trim()) allSet.add(cleanDepotName(e.machineName));
    });

    const allMachines = Array.from(allSet).sort();

    if (isRegularEmployee) {
      return userMachine ? [cleanDepotName(userMachine)] : [];
    }

    if (isDivisionalAdmin && userDivision) {
      const divLower = userDivision.toLowerCase();
      return allMachines.filter(m => {
        const div = getMachineDivision(m);
        return div && div.toLowerCase() === divLower;
      });
    }

    if (isZonalAdmin && userZone) {
      const zoneLower = userZone.toLowerCase();
      return allMachines.filter(m => {
        const z = getMachineZone(m);
        return z && z.toLowerCase() === zoneLower;
      });
    }

    if (isCompanyAdmin && userCompany) {
      const compLower = userCompany.toLowerCase();
      return allMachines.filter(m => {
        const belongs = empList.some(
          e => e.companyName?.toLowerCase() === compLower &&
               cleanDepotName(e.machineName || '').toLowerCase() === m.toLowerCase()
        );
        if (belongs) return true;
        return issues.some(
          i => i.companyName?.toLowerCase() === compLower &&
               (cleanDepotName(i.issuedTo).toLowerCase() === m.toLowerCase() ||
                cleanDepotName(i.issuedFrom).toLowerCase() === m.toLowerCase())
        );
      });
    }

    return allMachines;
  }, [
    issues,
    settingsMachines,
    machinePositions,
    empList,
    isRegularEmployee,
    isDivisionalAdmin,
    isZonalAdmin,
    isCompanyAdmin,
    userMachine,
    userDivision,
    userZone,
    userCompany,
  ]);

  const companiesList = useMemo(() => {
    const cs = new Set<string>();
    issues.forEach(i => { if (i.companyName) cs.add(i.companyName); });
    empList.forEach(e => { if (e.companyName) cs.add(e.companyName); });
    return Array.from(cs).sort();
  }, [issues, empList]);

  const filteredIssues = useMemo(() => {
    return issues.filter(i => {
      // 1. Role-based baseline authorization:
      // Regular machine employee: only see records matching their assigned machine
      if (isRegularEmployee) {
        if (!userMachine) return false;
        if (!issueMatchesMachine(i, userMachine)) return false;
      } else if (isDivisionalAdmin && userDivision) {
        // Divisional Admin: baseline scoped to their division
        if (!issueMatchesDivision(i, userDivision)) return false;
      } else if (isZonalAdmin && userZone) {
        // Zonal Admin: baseline scoped to their zone
        if (!issueMatchesZone(i, userZone)) return false;
      } else if (isCompanyAdmin && userCompany) {
        // Company Admin: baseline scoped to their company
        if (!issueMatchesCompany(i, userCompany)) return false;
      }

      // 2. Machine-wise filter (for senior admins who pick a specific machine)
      if (!isRegularEmployee && selectedMachine !== 'all') {
        if (!issueMatchesMachine(i, selectedMachine)) return false;
      }

      // 3. Company Filter (if full admin or selected)
      if (isFullAdmin && selectedCompany !== 'all') {
        if (!i.companyName || i.companyName.trim().toLowerCase() !== selectedCompany.trim().toLowerCase()) {
          return false;
        }
      }

      // 4. Date Range Filter
      if (startDate && i.rawDate && i.rawDate < startDate) return false;
      if (endDate && i.rawDate && i.rawDate > endDate) return false;

      // 5. Search Filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (i.issueNoteNo || '').toLowerCase().includes(q) ||
          (i.plNo || '').toLowerCase().includes(q) ||
          (i.partNo || '').toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q) ||
          (i.demandNo || '').toLowerCase().includes(q) ||
          (i.issuedTo || '').toLowerCase().includes(q) ||
          (i.issuedFrom || '').toLowerCase().includes(q) ||
          (i.issuedBy || '').toLowerCase().includes(q) ||
          (i.zone || '').toLowerCase().includes(q) ||
          (i.division || '').toLowerCase().includes(q) ||
          (i.companyName || '').toLowerCase().includes(q) ||
          (i.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [
    issues,
    isRegularEmployee,
    isDivisionalAdmin,
    isZonalAdmin,
    isCompanyAdmin,
    isFullAdmin,
    userMachine,
    userDivision,
    userZone,
    userCompany,
    selectedMachine,
    selectedCompany,
    startDate,
    endDate,
    searchTerm,
    machinePositions,
    empList,
  ]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMachine, selectedCompany, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / pageSize));
  const paginatedIssues = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredIssues.slice(start, start + pageSize);
  }, [filteredIssues, currentPage, pageSize]);

  // Totals
  const totals = useMemo(() => {
    let qty = 0;
    let val = 0;
    filteredIssues.forEach(i => {
      qty += Number(i.qty || 0);
      val += Number(i.totalValue || 0);
    });
    return { qty, val };
  }, [filteredIssues]);

  // Master Admin Delete
  const handleDelete = async (i: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete issue records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete issue voucher "${i.issueNoteNo}" for ${i.description}? This action cannot be undone.`)) {
      return;
    }

    try {
      const col = i.sourceCollection || 'issues';
      await deleteDoc(doc(db, col, i.id));
      toast.success('Issue record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete issue record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (i: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit issue records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'issueNoteNo', label: 'Issue Voucher No', type: 'text', required: true },
      { key: 'date', label: 'Issue Date (DD-MM-YYYY or YYYY-MM-DD)', type: 'text', required: true },
      { key: 'demandNo', label: 'Demand Requisition Ref', type: 'text' },
      { key: 'plNo', label: 'PL No', type: 'text' },
      { key: 'partNo', label: 'Part No', type: 'text' },
      { key: 'description', label: 'Item Description', type: 'textarea', required: true },
      { key: 'qty', label: 'Issued Qty', type: 'number', required: true },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'rate', label: 'Unit Rate (₹)', type: 'number' },
      { key: 'issuedFrom', label: 'Issuing Depot', type: 'text' },
      { key: 'issuedTo', label: 'Issued To (Machine / Unit)', type: 'text' },
      { key: 'issuedBy', label: 'Issued By (Official Name)', type: 'text' },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: i.id,
      collectionName: i.sourceCollection || 'issues',
      fields,
      initialData: {
        issueNoteNo: i.issueNoteNo || '',
        date: i.date || '',
        demandNo: i.demandNo || '',
        plNo: i.plNo || '',
        partNo: i.partNo || '',
        description: i.description || '',
        qty: i.qty || 1,
        unit: i.unit || 'Nos',
        rate: i.rate || 0,
        issuedFrom: i.issuedFrom || '',
        issuedTo: i.issuedTo || '',
        issuedBy: i.issuedBy || '',
        remarks: i.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredIssues.map((i, idx) => ({
      'S.No': idx + 1,
      'ISSUE DATE': i.date,
      'ISSUE VOUCHER NO': i.issueNoteNo,
      'PL NO': i.plNo || 'N/A',
      'PART NO': i.partNo || 'N/A',
      'ITEM DESCRIPTION': i.description,
      'ISSUED QTY': i.qty,
      'UNIT': i.unit || 'Nos',
      'RATE (RS)': i.rate,
      'TOTAL VALUE (RS)': i.totalValue,
      'ISSUED FROM (DEPOT)': i.issuedFrom,
      'ISSUED TO (MACHINE / UNIT)': i.issuedTo,
      'RECEIVED BY / TARGET PERSON': i.receiverName || i.issuedTo,
      'COMPANY': i.companyName || 'Indian Railways',
      'CONDITION': i.condition || 'Good',
      'REMARKS / PURPOSE': i.remarks,
    }));
    exportReportToExcel(data, 'Stores_And_Spares_Issue_Report');
  };

  const handleExportPdf = () => {
    const headers = [
      'SR.',
      'Date',
      'Issue Voucher No',
      'PL / Part No',
      'Description',
      'Qty & Unit',
      'Rate (₹)',
      'Total (₹)',
      'Issuing Depot',
      'Issued To',
    ];

    const rows = filteredIssues.map((i, idx) => [
      idx + 1,
      i.date,
      i.issueNoteNo,
      i.plNo && i.partNo
        ? `${i.plNo}\n(Pt: ${i.partNo})`
        : i.plNo
        ? i.plNo
        : i.partNo
        ? `Pt: ${i.partNo}`
        : 'Stock Spare',
      i.description,
      `${i.qty} ${i.unit}`,
      Number(i.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      Number(i.totalValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      i.issuedFrom,
      i.issuedTo,
    ]);

    exportReportToPdf({
      title: 'RAILWAY STORES & SPARES ISSUE DISPATCH REPORT',
      subtitle: 'Complete Ledger of Dispatched & Issued Spares and Stores Vouchers',
      filterSummary: `Machine: ${isRegularEmployee ? (userMachine || 'Assigned') : selectedMachine} | Scope: ${isDivisionalAdmin ? (userDivision || 'Divisional') : isZonalAdmin ? (userZone || 'Zonal') : isCompanyAdmin ? (userCompany || 'Company') : 'All'} | Total Qty: ${totals.qty} | Total Val: Rs. ${totals.val.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Records: ${filteredIssues.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* Document Title Banner */}
      <div className="bg-[#0f172a] text-white p-4 rounded-2xl shadow-sm border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600/30 rounded-xl border border-indigo-400/30 text-indigo-300">
            <Share2 size={22} />
          </div>
          <div>
            <h2 className="text-sm md:text-base font-black tracking-wide uppercase">
              RAILWAY STORES & SPARES ISSUE DISPATCH REPORT
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <p className="text-[11px] text-slate-300 font-medium">
                Complete Ledger of Dispatched & Issued Spares and Stores Vouchers
              </p>
              {isRegularEmployee ? (
                <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full text-[10px] font-bold">
                  Machine: {cleanDepotName(userMachine) || 'Assigned Machine'}
                </span>
              ) : isDivisionalAdmin ? (
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-bold">
                  Divisional Admin ({userDivision || 'Division'} - Machine-Wise)
                </span>
              ) : isZonalAdmin ? (
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-bold">
                  Zonal Admin ({userZone || 'Zone'} - Machine-Wise)
                </span>
              ) : isCompanyAdmin ? (
                <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-full text-[10px] font-bold">
                  Company Admin ({userCompany || 'Company'} - Machine-Wise)
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-slate-500/20 text-slate-300 border border-slate-500/40 rounded-full text-[10px] font-bold">
                  Master Admin (Machine-Wise)
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 self-stretch md:self-auto justify-between md:justify-start">
          <span>Generated: <b className="text-white">{format(new Date(), 'dd-MM-yyyy HH:mm')}</b></span>
          <span className="text-slate-500">|</span>
          <span>Records: <b className="text-emerald-400">{filteredIssues.length}</b></span>
        </div>
      </div>

      {/* Control Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search voucher, PL, part, description, machine..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium"
            />
          </div>

          {/* Machine Filter: Machine employee locked to their machine, Senior Admins have machine-wise dropdown */}
          {isRegularEmployee ? (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700">
              <span className="text-slate-400 font-normal">Machine:</span>
              <span className="text-indigo-700 font-bold">{cleanDepotName(userMachine) || 'Assigned Machine'}</span>
            </div>
          ) : (
            <select
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 font-semibold bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              title="Machine Wise Filter"
            >
              <option value="all">
                {isDivisionalAdmin
                  ? `All Machines (${userDivision || 'Division'})`
                  : isZonalAdmin
                  ? `All Machines (${userZone || 'Zone'})`
                  : isCompanyAdmin
                  ? `All Machines (${userCompany || 'Company'})`
                  : 'All Machines & Units'}
              </option>
              {scopedMachinesList.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}

          {/* Company Filter for Master Admin */}
          {isFullAdmin && (
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 font-semibold bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              title="Company Filter"
            >
              <option value="all">All Companies</option>
              {companiesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          {/* Date Range */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
            <Calendar size={13} className="text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-600"
              title="From Date"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-600"
              title="To Date"
            />
          </div>

          {(searchTerm || (selectedMachine !== 'all' && !isRegularEmployee) || (isFullAdmin && selectedCompany !== 'all') || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                if (!isRegularEmployee) setSelectedMachine('all');
                if (isFullAdmin) setSelectedCompany('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold"
            >
              Reset
            </button>
          )}
        </div>

        {/* Totals Pill & Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-xl text-xs font-semibold text-slate-700">
            <span>Total Dispatched Qty: <b className="text-indigo-600 font-mono">{totals.qty}</b></span>
            <span className="text-slate-300">|</span>
            <span>Total Value: <b className="text-emerald-700 font-mono">₹{totals.val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></span>
          </div>

          <button
            onClick={handleExportExcel}
            title={`Export complete data of all ${filteredIssues.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredIssues.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400 cursor-pointer"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <PackageCheck size={16} className="text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Issued Items & Spares Dispatch Ledger ({filteredIssues.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">All item fields enriched and validated</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#1e293b] text-white font-bold uppercase tracking-wider text-[11px] border-b border-slate-700">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-700/60 whitespace-nowrap">SR.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">ISSUE DATE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">ISSUE VOUCHER NO</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">PL NO / PART NO</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[220px]">ITEM DESCRIPTION</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">ISSUED QTY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">ISSUING DEPOT</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">ISSUED TO</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">TOTAL VALUE</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[180px]">REMARKS</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24 whitespace-nowrap">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 11 : 10} className="p-8 text-center text-slate-400 font-medium">
                    Loading complete issue records & cross-referencing catalog data...
                  </td>
                </tr>
              ) : paginatedIssues.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 11 : 10} className="p-8 text-center text-slate-400 font-medium">
                    No issued item records match your criteria.
                  </td>
                </tr>
              ) : (
                paginatedIssues.map((i, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={i.id || idx} className="hover:bg-slate-50/80 transition-colors border-b border-slate-200/80">
                      {/* SR. */}
                      <td className="p-3 text-center font-mono font-bold text-slate-500 border-r border-slate-200/60">
                        {absoluteIndex}
                      </td>

                      {/* ISSUE DATE */}
                      <td className="p-3 whitespace-nowrap font-medium text-slate-700 border-r border-slate-200/60">
                        {i.date}
                      </td>

                      {/* ISSUE VOUCHER NO */}
                      <td className="p-3 font-mono font-bold text-indigo-700 whitespace-nowrap border-r border-slate-200/60">
                        {i.issueNoteNo}
                      </td>

                      {/* PL NO / PART NO */}
                      <td className="p-3 font-mono border-r border-slate-200/60 whitespace-nowrap">
                        {i.plNo ? (
                          <div>
                            <div className="font-bold text-sm text-slate-900">{i.plNo}</div>
                            {i.partNo ? (
                              <div className="text-xs text-slate-600 font-medium mt-0.5">Part: {i.partNo}</div>
                            ) : (
                              <div className="text-xs text-slate-500 font-medium mt-0.5">PL Number</div>
                            )}
                          </div>
                        ) : i.partNo ? (
                          <div>
                            <div className="font-bold text-sm text-slate-900">{i.partNo}</div>
                            <div className="text-xs text-slate-500 font-medium mt-0.5">Part Number</div>
                          </div>
                        ) : (
                          <div className="text-slate-600 italic text-xs">General Store Spare</div>
                        )}
                      </td>

                      {/* ITEM DESCRIPTION */}
                      <td className="p-3 font-semibold text-slate-900 border-r border-slate-200/60 min-w-[220px] leading-snug">
                        <div>{i.description}</div>
                      </td>

                      {/* ISSUED QTY */}
                      <td className="p-3 text-right font-mono font-bold text-indigo-700 whitespace-nowrap border-r border-slate-200/60">
                        {i.qty} {i.unit}
                      </td>

                      {/* ISSUING DEPOT */}
                      <td className="p-3 font-semibold text-slate-800 whitespace-nowrap border-r border-slate-200/60">
                        <div>{i.issuedFrom}</div>
                        {i.companyName && (
                          <div className="text-[10px] text-slate-400 font-normal">{i.companyName}</div>
                        )}
                      </td>

                      {/* ISSUED TO */}
                      <td className="p-3 font-semibold text-slate-800 whitespace-nowrap border-r border-slate-200/60">
                        <div className="text-indigo-900 font-bold">{i.issuedTo}</div>
                        {i.receiverName && i.receiverName !== i.issuedTo && (
                          <div className="text-[10px] text-slate-500 font-normal">Consignee: {i.receiverName}</div>
                        )}
                      </td>

                      {/* TOTAL VALUE */}
                      <td className="p-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap border-r border-slate-200/60">
                        ₹{Number(i.totalValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* REMARKS */}
                      <td className="p-3 text-slate-600 text-xs min-w-[180px] leading-snug border-r border-slate-200/60">
                        {i.remarks}
                      </td>

                      {/* ACTIONS */}
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(i)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                              title="Edit Record"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(i)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Record"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 10-Row Pagination */}
        <ReportPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredIssues.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Issue Voucher Record"
        subtitle="Master Admin Privileges"
        recordId={editModal.recordId}
        collectionName={editModal.collectionName}
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
