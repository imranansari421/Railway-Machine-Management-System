import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Download, FileText, ClipboardCheck, Calendar, Edit, Trash2, PackageCheck } from 'lucide-react';
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
}

// Format date strictly to DD-MM-YYYY
function formatReceiptDate(rawDate?: any): string {
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

export default function AccountalReportView({ filterPerms, userMachine, userCompany }: Props) {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [selectedCompany, setSelectedCompany] = useState(() => {
    return filterPerms.isFullAdmin ? 'all' : (userCompany || 'all');
  });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
    collectionName: 'demands',
    fields: [],
    initialData: {},
  });

  useEffect(() => {
    setLoading(true);

    let rawDemands: any[] = [];
    let rawTransactions: any[] = [];

    const partsMap = new Map<string, any>();
    const storeItemsMap = new Map<string, any>();
    const empMap = new Map<string, any>();

    // 1. Listen to parts catalog
    const unsubParts = onSnapshot(collection(db, 'parts'), (snap) => {
      partsMap.clear();
      snap.docs.forEach(d => {
        partsMap.set(d.id, { id: d.id, ...d.data() });
      });
      rebuildAccountalReceipts();
    });

    // 2. Listen to store_items catalog
    const unsubStoreItems = onSnapshot(collection(db, 'store_items'), (snap) => {
      storeItemsMap.clear();
      snap.docs.forEach(d => {
        storeItemsMap.set(d.id, { id: d.id, ...d.data() });
      });
      rebuildAccountalReceipts();
    });

    // 3. Listen to employees for designation lookup
    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      empMap.clear();
      snap.docs.forEach(d => {
        const emp = d.data();
        if (emp.name) empMap.set(emp.name.toLowerCase().trim(), emp);
        if (emp.email) empMap.set(emp.email.toLowerCase().trim(), emp);
        if (emp.employeeId) empMap.set(emp.employeeId.toLowerCase().trim(), emp);
        if (d.id) empMap.set(d.id, emp);
      });
      rebuildAccountalReceipts();
    });

    // 4. Listen to demands (where items have been received or completed)
    const unsubDemands = onSnapshot(collection(db, 'demands'), (snap) => {
      rawDemands = snap.docs.map(d => ({ id: d.id, sourceCollection: 'demands', ...d.data() }));
      rebuildAccountalReceipts();
    });

    // 5. Listen to transactions (received type and old stock)
    const unsubTransactions = onSnapshot(collection(db, 'transactions'), (snap) => {
      rawTransactions = snap.docs.map(d => ({ id: d.id, sourceCollection: 'transactions', ...d.data() }));
      rebuildAccountalReceipts();
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

    // Helper: Strict guard against non-accountal data (Unconnected material, Old stock, Issues, Store inward)
    function isUnconnectedOrNonAccountal(item: any): boolean {
      if (!item) return true;

      // 1. Unconnected material check:
      if (item.receiptId) return true;
      if (item.isUnconnected === true || item.unconnected === true) return true;

      const voucher = (
        item.voucherNo ||
        item.issueNoteNo ||
        item.issueVoucherNo ||
        ''
      ).toUpperCase().trim();

      if (
        voucher.startsWith('UMR') ||
        voucher.startsWith('UNC') ||
        voucher.startsWith('MRN')
      ) {
        return true;
      }

      // Check text for unconnected material references
      const text = `${item.details || ''} ${item.remarks || ''} ${item.description || ''} ${item.sourceType || ''}`.toLowerCase();
      if (
        text.includes('unconnected') ||
        text.includes('un-connected') ||
        text.includes('surplus/returned')
      ) {
        return true;
      }

      // 2. Old stock / Catalog initial stock ledger:
      if (item.type === 'old_stock' || text.includes('initial stock')) {
        return true;
      }

      // 3. Issues / Dispatches (these belong to Issue Report, not Accountal):
      if (item.type === 'issued' || item.isIssued === true) {
        return true;
      }

      return false;
    }

    function rebuildAccountalReceipts() {
      const itemsMap = new Map<string, any>();
      const seenSignatures = new Set<string>();

      // A. Process Demands that have genuine Accountal Receipts
      rawDemands.forEach((dm: any) => {
        if (isUnconnectedOrNonAccountal(dm)) return;

        const hasReceiptsArray = Array.isArray(dm.receipts) && dm.receipts.length > 0;
        const receivedQty = Number(dm.receivedQty || 0);

        // STRICT: Only items that were genuinely received into Accountal!
        // Demands without receipts array and without receivedQty > 0 must NEVER appear in Accountal Report!
        if (!hasReceiptsArray && (receivedQty <= 0 || !dm.receivedDate)) {
          return;
        }

        const catalog = findCatalogItem(dm);

        // Resolve PL & Part No
        let plNo = (dm.plNo || '').trim();
        let partNo = (dm.partNo || '').trim();
        if (plNo === '-' || plNo.toUpperCase() === 'NA' || plNo.toUpperCase() === 'N/A') plNo = '';
        if (partNo === '-' || partNo.toUpperCase() === 'NA' || partNo.toUpperCase() === 'N/A') partNo = '';

        if (!plNo && catalog?.plNo && catalog.plNo !== '-' && catalog.plNo.toUpperCase() !== 'NA') {
          plNo = catalog.plNo.trim();
        }
        if (!partNo && catalog?.partNo && catalog.partNo !== '-' && catalog.partNo.toUpperCase() !== 'NA') {
          partNo = catalog.partNo.trim();
        }

        // Resolve Description
        let description = (dm.description || dm.itemName || dm.partName || dm.name || dm.materialName || '').trim();
        if (!description || description === '-' || description.toUpperCase() === 'NA') {
          if (catalog?.description || catalog?.name || catalog?.partName) {
            description = (catalog.description || catalog.name || catalog.partName).trim();
          } else if (plNo) {
            description = `Store Item (PL: ${plNo})`;
          } else if (partNo) {
            description = `Spares Component (Part: ${partNo})`;
          } else {
            description = 'Track Machine Consumable Spares';
          }
        }

        const unit = dm.unit || catalog?.unit || 'Nos';
        const rawRate = Number(dm.rate || dm.approvedRate || catalog?.rate || 0);
        const rate = isNaN(rawRate) ? 0 : rawRate;

        // Demand No
        let demandNo = (dm.demandNo || dm.demandRefNo || dm.requisitionNo || '').trim();
        if (!demandNo || demandNo === '-' || demandNo.toUpperCase() === 'NA') {
          demandNo = `DM-${dm.id.slice(0, 6).toUpperCase()}`;
        }

        // Voucher No
        const voucherNo = (
          dm.issueNoteNo ||
          dm.issueVoucherNo ||
          dm.voucherNo ||
          (demandNo ? `VR-${demandNo}` : `VR-${dm.id.slice(0, 6).toUpperCase()}`)
        ).trim();

        // Receiving Machine
        let receivingMachine = (
          dm.requestingMachineName ||
          dm.machineName ||
          dm.targetMachine ||
          dm.issuedToMachine ||
          ''
        ).trim();
        if (!receivingMachine || receivingMachine === '-' || receivingMachine.toLowerCase() === 'machine') {
          receivingMachine = 'Track Machine Unit';
        }

        // Received From (Issuing Depot)
        const rawSupplier = dm.issuingDepot || dm.issuedFromMachine || dm.issuedFrom || dm.sourceDepot || dm.companyName;
        const receivedFrom = cleanDepotName(rawSupplier);

        const companyName = dm.companyName || dm.createdByCompanyName || '';

        // If demand has receipts array, unpack each genuine Accountal receipt entry
        if (hasReceiptsArray) {
          dm.receipts.forEach((rc: any, rcIdx: number) => {
            const rQty = Number(rc.qty || 1);
            if (rQty <= 0) return;
            const rRate = Number(rc.rate !== undefined ? rc.rate : rate);
            const rTotalVal = rQty * rRate;
            const rRawDate = rc.date || rc.timestamp || dm.receivedDate || dm.lastReceivedDate || dm.createdAt;
            const rDate = formatReceiptDate(rRawDate);

            let receivedBy = cleanDisplayName(rc.receiverName || dm.issuedToEmployeeName || dm.createdByEmployeeName || 'Recipient Official');
            if (!receivedBy || receivedBy === '-') receivedBy = 'Recipient Official';

            const emp = empMap.get(receivedBy.toLowerCase());
            const receivedByDesignation = rc.receiverDesignation || emp?.designation || 'Machine Custodian';

            let remarks = (rc.remarks || dm.remarks || '').trim();
            if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
              remarks = `Material received and accounted into stock for ${receivingMachine}`;
            }

            const condition = rc.itemCondition || dm.whetherUse || dm.itemCondition || 'New';
            const uniqueKey = `dm_${dm.id}_rc_${rcIdx}`;

            // Record signature for deduplication against transactions
            const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
            const sigDemand = `${demandNo.toLowerCase().trim()}_${itemKey}_${rQty}`;
            const sigVoucher = `${voucherNo.toLowerCase().trim()}_${itemKey}_${rQty}`;
            seenSignatures.add(sigDemand);
            seenSignatures.add(sigVoucher);
            if (dm.id) seenSignatures.add(dm.id);

            itemsMap.set(uniqueKey, {
              id: `${dm.id}_rc_${rcIdx}`,
              sourceCollection: 'demands',
              date: rDate,
              rawDate: rRawDate || '',
              voucherNo,
              demandNo,
              plNo,
              partNo,
              description,
              qty: rQty,
              unit,
              rate: rRate,
              totalValue: rTotalVal,
              receivingMachine,
              receivedFrom,
              receivedBy,
              receivedByDesignation,
              companyName,
              condition,
              remarks,
            });
          });
        } else if (receivedQty > 0 && dm.receivedDate) {
          // Single verified demand accountal receipt (legacy single-receipt format)
          const rQty = receivedQty;
          const rTotalVal = Number(dm.totalValue) || (rQty * rate);
          const rRawDate = dm.receivedDate || dm.lastReceivedDate || dm.createdAt;
          const rDate = formatReceiptDate(rRawDate);

          let receivedBy = cleanDisplayName(dm.issuedToEmployeeName || dm.createdByEmployeeName || dm.receiverName || 'Recipient Official');
          if (!receivedBy || receivedBy === '-') receivedBy = 'Recipient Official';

          const emp = empMap.get(receivedBy.toLowerCase());
          const receivedByDesignation = dm.receiverDesignation || emp?.designation || 'Machine Custodian';

          let remarks = (dm.remarks || dm.remark || '').trim();
          if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
            remarks = `Received against requisition ${demandNo} into ${receivingMachine}`;
          }

          const condition = dm.whetherUse || dm.itemCondition || 'Good';
          const uniqueKey = `dm_${dm.id}_receipt`;

          const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
          const sigDemand = `${demandNo.toLowerCase().trim()}_${itemKey}_${rQty}`;
          const sigVoucher = `${voucherNo.toLowerCase().trim()}_${itemKey}_${rQty}`;
          seenSignatures.add(sigDemand);
          seenSignatures.add(sigVoucher);
          if (dm.id) seenSignatures.add(dm.id);

          itemsMap.set(uniqueKey, {
            id: dm.id,
            sourceCollection: 'demands',
            date: rDate,
            rawDate: rRawDate || '',
            voucherNo,
            demandNo,
            plNo,
            partNo,
            description,
            qty: rQty,
            unit,
            rate,
            totalValue: rTotalVal,
            receivingMachine,
            receivedFrom,
            receivedBy,
            receivedByDesignation,
            companyName,
            condition,
            remarks,
          });
        }
      });

      // B. Process Transactions - ONLY Genuine Accountal Transactions
      rawTransactions.forEach((t: any) => {
        // Exclude unconnected material, old stock, issues, and non-accountal data
        if (isUnconnectedOrNonAccountal(t)) return;

        // Verify this transaction is genuinely an Accountal receipt
        const isExplicitAccountal =
          Boolean(t.details && t.details.toLowerCase().includes('accountal')) ||
          t.sourceType === 'accountal' ||
          t.accountalReceipt === true ||
          t.type === 'accountal' ||
          (t.type === 'received' && Boolean(t.demandNo) && !t.receiptId && (t.details?.toLowerCase().includes('received from demand') || t.details?.toLowerCase().includes('received into')));

        if (!isExplicitAccountal) return;

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
            const m = t.details.match(/for\s+([^,\[]+)/i) || t.details.match(/Receipt:\s*\d+\s*[^\s]+\s+([^,\[]+)/i);
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
        const formattedDate = formatReceiptDate(rawDate);

        // Demand No
        let demandNo = (t.demandNo || '').trim();
        if (!demandNo || demandNo === '-' || demandNo.toUpperCase() === 'NA') {
          if (t.details) {
            const m = t.details.match(/against\s+demand\s+([^\s\[\]]+)/i) || t.details.match(/from\s+demand\s+([^\s\[\],]+)/i);
            if (m && m[1]) demandNo = m[1].trim();
          }
        }
        if (!demandNo) demandNo = 'Accountal Entry';

        const voucherNo = (
          t.voucherNo ||
          t.issueNoteNo ||
          (t.id ? `VR-${t.id.slice(0, 6).toUpperCase()}` : 'VR-ACC')
        ).trim();

        // Check deduplication against already accounted demand receipts!
        const itemKey = (plNo || partNo || description.slice(0, 30)).toLowerCase().trim();
        const sigDemand = `${demandNo.toLowerCase().trim()}_${itemKey}_${qty}`;
        const sigVoucher = `${voucherNo.toLowerCase().trim()}_${itemKey}_${qty}`;

        if (
          seenSignatures.has(sigDemand) ||
          seenSignatures.has(sigVoucher) ||
          (t.demandId && seenSignatures.has(t.demandId))
        ) {
          // Already added from demand receipts, skip duplicate!
          return;
        }

        // Receiving Machine
        let receivingMachine = (t.machineName || t.targetMachine || t.targetMachineName || '').trim();
        if (!receivingMachine || receivingMachine === '-' || receivingMachine.toLowerCase() === 'store') {
          if (t.details) {
            const mInto = t.details.match(/into\s+([^,\[]+)/i);
            if (mInto && mInto[1]) receivingMachine = mInto[1].trim();
          }
        }
        if (!receivingMachine || receivingMachine === '-') receivingMachine = 'Track Machine Unit';

        // Received From
        const rawSupplier = t.receivedFrom || t.supplier || t.issuingDepot || t.depot;
        const receivedFrom = cleanDepotName(rawSupplier);

        let receivedBy = cleanDisplayName(t.receiverName || t.receivedBy || t.performedByName || 'Consignee Official');
        if (!receivedBy || receivedBy === '-') receivedBy = 'Consignee Official';

        let receivedByDesignation = (t.designation || '').trim();
        if (!receivedByDesignation || receivedByDesignation === '-') {
          const emp = empMap.get(receivedBy.toLowerCase());
          receivedByDesignation = emp?.designation || 'Machine Custodian';
        }

        let remarks = (t.remarks || t.details || '').trim();
        if (!remarks || remarks === '-' || remarks.toLowerCase() === 'none') {
          remarks = `Material accounted into stock for ${receivingMachine}`;
        }

        const condition = t.itemCondition || t.whetherUse || t.condition || 'New';
        const companyName = t.companyName || '';

        const uniqueKey = `tx_${t.id}`;
        seenSignatures.add(sigDemand);
        seenSignatures.add(sigVoucher);

        itemsMap.set(uniqueKey, {
          id: t.id,
          sourceCollection: 'transactions',
          date: formattedDate,
          rawDate: rawDate || '',
          voucherNo,
          demandNo,
          plNo,
          partNo,
          description,
          qty,
          unit,
          rate,
          totalValue,
          receivingMachine,
          receivedFrom,
          receivedBy,
          receivedByDesignation,
          companyName,
          condition,
          remarks,
        });
      });

      const unifiedList = Array.from(itemsMap.values());
      // Sort newest first
      unifiedList.sort((a, b) => {
        const timeA = new Date(a.rawDate || a.date).getTime() || 0;
        const timeB = new Date(b.rawDate || b.date).getTime() || 0;
        return timeB - timeA;
      });

      setReceipts(unifiedList);
      setLoading(false);
    }

    return () => {
      unsubParts();
      unsubStoreItems();
      unsubEmployees();
      unsubDemands();
      unsubTransactions();
    };
  }, []);

  const machinesList = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach(r => {
      if (r.receivingMachine && r.receivingMachine !== 'Track Machine Unit') set.add(r.receivingMachine);
      if (r.receivedFrom && r.receivedFrom !== 'Base Depot') set.add(r.receivedFrom);
    });
    return Array.from(set).sort();
  }, [receipts]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter(r => {
      if (selectedMachine !== 'all') {
        const mMatch = (r.receivingMachine || '').toLowerCase();
        const fMatch = (r.receivedFrom || '').toLowerCase();
        const sel = selectedMachine.toLowerCase();
        if (!mMatch.includes(sel) && !fMatch.includes(sel)) return false;
      }

      if (selectedCompany !== 'all') {
        if (!r.companyName || r.companyName.trim().toLowerCase() !== selectedCompany.trim().toLowerCase()) {
          return false;
        }
      }

      if (startDate && r.rawDate && r.rawDate < startDate) return false;
      if (endDate && r.rawDate && r.rawDate > endDate) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (r.voucherNo || '').toLowerCase().includes(q) ||
          (r.plNo || '').toLowerCase().includes(q) ||
          (r.partNo || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.demandNo || '').toLowerCase().includes(q) ||
          (r.receivingMachine || '').toLowerCase().includes(q) ||
          (r.receivedFrom || '').toLowerCase().includes(q) ||
          (r.receivedBy || '').toLowerCase().includes(q) ||
          (r.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [receipts, selectedMachine, selectedCompany, startDate, endDate, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMachine, selectedCompany, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredReceipts.length / pageSize));
  const paginatedReceipts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredReceipts.slice(start, start + pageSize);
  }, [filteredReceipts, currentPage, pageSize]);

  // Totals
  const totals = useMemo(() => {
    let qty = 0;
    let val = 0;
    filteredReceipts.forEach(r => {
      qty += Number(r.qty || 0);
      val += Number(r.totalValue || 0);
    });
    return { qty, val };
  }, [filteredReceipts]);

  // Master Admin Delete
  const handleDelete = async (r: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete accountal records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete accountal voucher "${r.voucherNo}" for ${r.description}? This action cannot be undone.`)) {
      return;
    }

    try {
      const col = r.sourceCollection || 'demands';
      await deleteDoc(doc(db, col, r.id));
      toast.success('Accountal record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (r: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit accountal records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'voucherNo', label: 'Voucher / VR No', type: 'text', required: true },
      { key: 'date', label: 'Receipt Date (DD-MM-YYYY or YYYY-MM-DD)', type: 'text', required: true },
      { key: 'demandNo', label: 'Demand Requisition No', type: 'text' },
      { key: 'plNo', label: 'PL No', type: 'text' },
      { key: 'partNo', label: 'Part No', type: 'text' },
      { key: 'description', label: 'Item Description', type: 'textarea', required: true },
      { key: 'qty', label: 'Received Qty', type: 'number', required: true },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'rate', label: 'Unit Rate (₹)', type: 'number' },
      { key: 'receivingMachine', label: 'Receiving Machine / Unit', type: 'text' },
      { key: 'receivedFrom', label: 'Received From (Issuing Depot)', type: 'text' },
      { key: 'receivedBy', label: 'Received By (Official Name)', type: 'text' },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: r.id,
      collectionName: r.sourceCollection || 'demands',
      fields,
      initialData: {
        voucherNo: r.voucherNo || '',
        date: r.date || '',
        demandNo: r.demandNo || '',
        plNo: r.plNo || '',
        partNo: r.partNo || '',
        description: r.description || '',
        qty: r.qty || 1,
        unit: r.unit || 'Nos',
        rate: r.rate || 0,
        receivingMachine: r.receivingMachine || '',
        receivedFrom: r.receivedFrom || '',
        receivedBy: r.receivedBy || '',
        remarks: r.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredReceipts.map((r, idx) => ({
      'S.No': idx + 1,
      'RECEIPT DATE': r.date,
      'VOUCHER / VR NO': r.voucherNo,
      'DEMAND REQUISITION NO': r.demandNo,
      'PL NO': r.plNo || 'N/A',
      'PART NO': r.partNo || 'N/A',
      'ITEM DESCRIPTION': r.description,
      'RECEIVED QTY': r.qty,
      'UNIT': r.unit || 'Nos',
      'RATE (RS)': r.rate,
      'TOTAL VALUE (RS)': r.totalValue,
      'RECEIVING MACHINE / UNIT': r.receivingMachine,
      'RECEIVED FROM (DEPOT)': r.receivedFrom,
      'RECEIVED BY (CONSIGNEE)': `${r.receivedBy}${r.receivedByDesignation ? ` (${r.receivedByDesignation})` : ''}`,
      'COMPANY': r.companyName || 'Indian Railways',
      'CONDITION': r.condition || 'New',
      'REMARKS / PURPOSE': r.remarks,
    }));
    exportReportToExcel(data, 'Material_Accountal_And_Stock_Receipt_Report');
  };

  const handleExportPdf = () => {
    const headers = [
      'SR.',
      'Receipt Date',
      'VR / Note No',
      'Demand No',
      'PL / Part No',
      'Description',
      'Qty & Unit',
      'Rate (₹)',
      'Total (₹)',
      'Receiving Machine',
      'Received From',
      'Received By',
    ];

    const rows = filteredReceipts.map((r, idx) => [
      idx + 1,
      r.date,
      r.voucherNo,
      r.demandNo,
      r.plNo && r.partNo
        ? `${r.plNo}\n(Pt: ${r.partNo})`
        : r.plNo
        ? r.plNo
        : r.partNo
        ? `Pt: ${r.partNo}`
        : 'Stock Spare',
      r.description,
      `${r.qty} ${r.unit}`,
      Number(r.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      Number(r.totalValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      r.receivingMachine,
      r.receivedFrom,
      `${r.receivedBy}${r.receivedByDesignation ? `\n(${r.receivedByDesignation})` : ''}`,
    ]);

    exportReportToPdf({
      title: 'RAILWAY ACCOUNTAL & STOCK RECEIPT REGISTER',
      subtitle: 'Complete Ledger of Received Items, Material Inward & On-Account Spares',
      filterSummary: `Machine: ${selectedMachine} | Company: ${selectedCompany} | Total Qty: ${totals.qty} | Total Val: Rs. ${totals.val.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Records: ${filteredReceipts.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* Document Title Banner */}
      <div className="bg-[#0f172a] text-white p-4 rounded-2xl shadow-sm border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-600/30 rounded-xl border border-emerald-400/30 text-emerald-300">
            <ClipboardCheck size={22} />
          </div>
          <div>
            <h2 className="text-sm md:text-base font-black tracking-wide uppercase">
              RAILWAY ACCOUNTAL & STOCK RECEIPT REGISTER
            </h2>
            <p className="text-[11px] text-slate-300 font-medium">
              Complete Ledger of Received Items, Material Inward & On-Account Spares
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 self-stretch md:self-auto justify-between md:justify-start">
          <span>Generated: <b className="text-white">{format(new Date(), 'dd-MM-yyyy HH:mm')}</b></span>
          <span className="text-slate-500">|</span>
          <span>Records: <b className="text-emerald-400">{filteredReceipts.length}</b></span>
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
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-slate-50 font-medium"
            />
          </div>

          {/* Machine Filter */}
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            disabled={!filterPerms.canChangeMachine}
            className={`px-3 py-2 text-xs rounded-xl border border-slate-200 font-semibold ${
              !filterPerms.canChangeMachine ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 text-slate-700'
            }`}
          >
            <option value="all">All Machines & Units</option>
            {machinesList.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

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

          {(searchTerm || selectedMachine !== (userMachine || 'all') || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                if (filterPerms.canChangeMachine) setSelectedMachine('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>

        {/* Totals & Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-xl text-xs font-semibold text-slate-700">
            <span>Total Received Qty: <b className="text-indigo-600 font-mono">{totals.qty}</b></span>
            <span className="text-slate-300">|</span>
            <span>Total Valuation: <b className="text-emerald-700 font-mono">₹{totals.val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></span>
          </div>

          <button
            onClick={handleExportExcel}
            title={`Export complete data of all ${filteredReceipts.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredReceipts.length} records to PDF`}
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
            <PackageCheck size={16} className="text-emerald-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Accountal & Material Inward Register ({filteredReceipts.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">All material fields validated with catalog data</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#1e293b] text-white font-bold uppercase tracking-wider text-[11px] border-b border-slate-700">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-700/60 whitespace-nowrap">SR.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">RECEIPT DATE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">VOUCHER / VR NO</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">DEMAND NO</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">PL NO / PART NO</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[220px]">ITEM DESCRIPTION</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">RECEIVED QTY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">RECEIVING MACHINE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">RECEIVED FROM (DEPOT)</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">RECEIVED BY</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">TOTAL VALUE</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[180px]">REMARKS</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24 whitespace-nowrap">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 13 : 12} className="p-8 text-center text-slate-400 font-medium">
                    Loading accountal records & cross-referencing catalog data...
                  </td>
                </tr>
              ) : paginatedReceipts.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 13 : 12} className="p-8 text-center text-slate-400 font-medium">
                    No received items match your criteria.
                  </td>
                </tr>
              ) : (
                paginatedReceipts.map((r, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={r.id || idx} className="hover:bg-slate-50/80 transition-colors border-b border-slate-200/80">
                      {/* SR. */}
                      <td className="p-3 text-center font-mono font-bold text-slate-500 border-r border-slate-200/60">
                        {absoluteIndex}
                      </td>

                      {/* RECEIPT DATE */}
                      <td className="p-3 whitespace-nowrap font-medium text-slate-700 border-r border-slate-200/60">
                        {r.date}
                      </td>

                      {/* VOUCHER / VR NO */}
                      <td className="p-3 font-mono font-bold text-indigo-700 whitespace-nowrap border-r border-slate-200/60">
                        {r.voucherNo}
                      </td>

                      {/* DEMAND NO */}
                      <td className="p-3 font-mono border-r border-slate-200/60 whitespace-nowrap">
                        {r.demandNo.startsWith('DM-') || r.demandNo.startsWith('DEM') || /^\d+$/.test(r.demandNo) ? (
                          <span className="font-bold text-slate-800">{r.demandNo}</span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                            {r.demandNo}
                          </span>
                        )}
                      </td>

                      {/* PL NO / PART NO */}
                      <td className="p-3 font-mono border-r border-slate-200/60 whitespace-nowrap">
                        {r.plNo ? (
                          <div>
                            <div className="font-bold text-sm text-slate-900">{r.plNo}</div>
                            {r.partNo ? (
                              <div className="text-xs text-slate-600 font-medium mt-0.5">Part: {r.partNo}</div>
                            ) : (
                              <div className="text-xs text-slate-500 font-medium mt-0.5">PL Number</div>
                            )}
                          </div>
                        ) : r.partNo ? (
                          <div>
                            <div className="font-bold text-sm text-slate-900">{r.partNo}</div>
                            <div className="text-xs text-slate-500 font-medium mt-0.5">Part Number</div>
                          </div>
                        ) : (
                          <div className="text-slate-600 italic text-xs">General Stock Spare</div>
                        )}
                      </td>

                      {/* ITEM DESCRIPTION */}
                      <td className="p-3 font-semibold text-slate-900 border-r border-slate-200/60 min-w-[220px] leading-snug">
                        <div>{r.description}</div>
                      </td>

                      {/* RECEIVED QTY */}
                      <td className="p-3 text-right font-mono font-bold text-emerald-600 whitespace-nowrap border-r border-slate-200/60">
                        {r.qty} {r.unit}
                      </td>

                      {/* RECEIVING MACHINE */}
                      <td className="p-3 font-semibold text-slate-800 whitespace-nowrap border-r border-slate-200/60">
                        <div className="text-indigo-900 font-bold">{r.receivingMachine}</div>
                        {r.companyName && (
                          <div className="text-[10px] text-slate-400 font-normal">{r.companyName}</div>
                        )}
                      </td>

                      {/* RECEIVED FROM */}
                      <td className="p-3 font-semibold text-slate-800 whitespace-nowrap border-r border-slate-200/60">
                        <div>{r.receivedFrom}</div>
                      </td>

                      {/* RECEIVED BY */}
                      <td className="p-3 font-semibold text-slate-800 whitespace-nowrap border-r border-slate-200/60">
                        <div>{r.receivedBy}</div>
                        {r.receivedByDesignation && (
                          <div className="text-[10px] text-slate-500 font-normal">{r.receivedByDesignation}</div>
                        )}
                      </td>

                      {/* TOTAL VALUE */}
                      <td className="p-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap border-r border-slate-200/60">
                        ₹{Number(r.totalValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* REMARKS */}
                      <td className="p-3 text-slate-600 text-xs min-w-[180px] leading-snug border-r border-slate-200/60">
                        {r.remarks}
                      </td>

                      {/* ACTIONS */}
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(r)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                              title="Edit Record"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
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
          totalItems={filteredReceipts.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Accountal Record"
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
