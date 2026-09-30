import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Eye, Download, Edit, Trash2, ArrowDownLeft, ArrowUpRight, Clock, 
  Package, Calendar, Building2, Layers, Search, FileText, CheckCircle2, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

export interface StoreItem {
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
}

export interface StoreIssueRecord {
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

interface StoreItemHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StoreItem | null;
  issues: StoreIssueRecord[];
  receipts: any[];
  isMainAdmin: boolean;
  onEditIssue: (issue: StoreIssueRecord) => void;
  onDeleteIssue: (issue: StoreIssueRecord) => void;
  onDownloadVoucher: (issue: StoreIssueRecord) => void;
}

export default function StoreItemHistoryModal({
  isOpen,
  onClose,
  item,
  issues,
  receipts,
  isMainAdmin,
  onEditIssue,
  onDeleteIssue,
  onDownloadVoucher
}: StoreItemHistoryModalProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'issues' | 'receipts'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const isNaOrEmpty = (val?: string) => {
    if (!val) return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'n/a' || clean === 'na' || clean === 'nil' || clean === '-' || clean === 'none';
  };

  // Strictly filter transactions matching this item by Part No or PL No ("wahi item ka transaction show kare jo us item ke part no ya PL no. se match kare otherwise nahi")
  const isRecordMatchingItem = (r: { partNo?: string; plNo?: string; storeItemId?: string; description?: string }) => {
    if (!item) return false;
    const itemPart = (item.partNo || '').trim().toLowerCase();
    const itemPl = (item.plNo || '').trim().toLowerCase();
    const hasItemPart = !isNaOrEmpty(itemPart);
    const hasItemPl = !isNaOrEmpty(itemPl);

    const rPart = (r.partNo || '').trim().toLowerCase();
    const rPl = (r.plNo || '').trim().toLowerCase();
    const hasRPart = !isNaOrEmpty(rPart);
    const hasRPl = !isNaOrEmpty(rPl);

    // If the item has Part No or PL No, ONLY show transactions that strictly match Part No or PL No
    if (hasItemPart || hasItemPl) {
      const partMatched = hasItemPart && (
        (hasRPart && rPart === itemPart) ||
        (hasRPl && rPl === itemPart)
      );
      const plMatched = hasItemPl && (
        (hasRPl && rPl === itemPl) ||
        (hasRPart && rPart === itemPl)
      );

      if (partMatched || plMatched) {
        return true;
      }

      // If linked by storeItemId, only allow if neither partNo nor plNo contradicts the item
      if (r.storeItemId && r.storeItemId === item.id) {
        const partConflict = hasItemPart && hasRPart && rPart !== itemPart;
        const plConflict = hasItemPl && hasRPl && rPl !== itemPl;
        if (!partConflict && !plConflict) {
          return true;
        }
      }

      // Otherwise do NOT match!
      return false;
    }

    // Fallback ONLY when item has neither Part No nor PL No configured
    if (r.storeItemId && r.storeItemId === item.id) return true;
    const cleanDesc = (item.description || '').trim().toLowerCase();
    if (cleanDesc && r.description && r.description.trim().toLowerCase() === cleanDesc) {
      return true;
    }
    return false;
  };

  // Filter issues specifically matching this item (safe even when item is null)
  const itemIssues = useMemo(() => {
    if (!item) return [];
    return issues
      .filter(r => isRecordMatchingItem(r))
      .sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
  }, [item, issues]);

  // Filter receipts specifically matching this item (safe even when item is null)
  const itemReceipts = useMemo(() => {
    if (!item) return [];

    const matchedReceipts = receipts.filter(r => isRecordMatchingItem(r));

    // Check if an explicit Old Stock receipt exists in matched records
    const hasOldStockReceipt = matchedReceipts.some(r => 
      r.isOldStock || 
      r.transactionType === 'old_stock' || 
      (r.title && r.title.toLowerCase().includes('old stock')) ||
      (r.remarks && r.remarks.toLowerCase().includes('old stock'))
    );

    const oldStockValue = item.oldStock !== undefined && item.oldStock !== null
      ? Number(item.oldStock)
      : (item.initialStock !== undefined && item.initialStock !== null ? Number(item.initialStock) : Number(item.stock || 0));

    const effectiveReceipts = [...matchedReceipts];

    // If no explicit old stock receipt is found in receipts, inject the initial Old Stock record
    if (!hasOldStockReceipt && oldStockValue > 0) {
      effectiveReceipts.push({
        id: `old-stock-${item.id}`,
        storeItemId: item.id,
        voucherNo: 'OLD-STOCK',
        isOldStock: true,
        transactionType: 'old_stock',
        title: 'Old Stock',
        description: item.description,
        plNo: item.plNo || '',
        partNo: item.partNo || '',
        category: item.category,
        qtyReturned: oldStockValue,
        transactionQty: oldStockValue,
        unit: item.unit,
        oldStock: oldStockValue,
        newStock: oldStockValue,
        companyName: item.companyName,
        location: item.location || 'Store Inventory',
        remarks: 'Old Stock (Material added to store)',
        returnedDate: item.createdAt ? item.createdAt.slice(0, 10) : format(new Date(), 'yyyy-MM-dd'),
        createdAt: item.createdAt || new Date().toISOString(),
        createdByEmail: item.createdBy || 'Store Official',
      });
    }

    return effectiveReceipts.sort((a, b) => new Date(b.returnedDate || b.createdAt || 0).getTime() - new Date(a.returnedDate || a.createdAt || 0).getTime());
  }, [item, receipts]);

  // Combined timeline
  const combinedTimeline = useMemo(() => {
    const itemUnit = item?.unit || 'Nos';
    const issueEvents = itemIssues.map(iss => ({
      id: `issue-${iss.id}`,
      type: 'issue' as const,
      rawIssue: iss,
      date: iss.date || iss.createdAt || '',
      voucherNo: iss.issueNoteNo,
      qty: iss.qty,
      unit: iss.unit || itemUnit,
      title: 'Item Dispatched / Issued (निर्गमित)',
      party: iss.targetType === 'machine' ? `Machine: ${iss.targetMachine || '-'}` : `Company: ${iss.targetCompany || '-'}`,
      person: iss.receiverName ? `${iss.receiverName} (${iss.receiverDesignation || 'Receiver'})` : (iss.issuedBy || '-'),
      remarks: iss.remarks || '',
      createdAt: iss.createdAt || iss.date || ''
    }));

    const receiptEvents = itemReceipts.map(rec => {
      const isOldStock = Boolean(rec.isOldStock || rec.transactionType === 'old_stock' || (rec.remarks && rec.remarks.toLowerCase().includes('old stock')));
      const qtyNum = Number(rec.qtyReturned ?? rec.transactionQty ?? 0);
      return {
        id: `receipt-${rec.id}`,
        type: 'receipt' as const,
        isOldStock,
        rawReceipt: rec,
        date: rec.returnedDate || rec.createdAt || '',
        voucherNo: rec.voucherNo || (isOldStock ? 'OLD-STOCK' : '-'),
        qty: qtyNum,
        unit: rec.unit || itemUnit,
        title: isOldStock ? 'Old Stock' : 'Connected Material Received (प्राप्त / इनवर्ड)',
        party: isOldStock 
          ? `Store: ${rec.companyName || item?.companyName || 'Store Inventory'}`
          : (rec.machineName ? `Machine: ${rec.machineName} (${rec.companyName || '-'})` : (rec.companyName || 'Store Inward')),
        person: rec.createdByEmail || item?.createdBy || 'Store Official',
        remarks: rec.remarks || (isOldStock ? `Old Stock: ${qtyNum} ${rec.unit || itemUnit}` : (rec.oldStock !== undefined && rec.newStock !== undefined ? `Stock adjusted: ${rec.oldStock} ➜ ${rec.newStock}` : '')),
        createdAt: rec.createdAt || rec.returnedDate || ''
      };
    });

    const merged = [...issueEvents, ...receiptEvents];
    return merged.sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
  }, [itemIssues, itemReceipts, item?.unit, item?.companyName, item?.createdBy]);

  // Filtered lists based on search
  const filteredTimeline = useMemo(() => {
    if (!searchQuery.trim()) return combinedTimeline;
    const q = searchQuery.toLowerCase().trim();
    return combinedTimeline.filter(e => 
      e.voucherNo.toLowerCase().includes(q) ||
      e.party.toLowerCase().includes(q) ||
      e.person.toLowerCase().includes(q) ||
      e.remarks.toLowerCase().includes(q) ||
      e.date.toLowerCase().includes(q)
    );
  }, [combinedTimeline, searchQuery]);

  const filteredIssues = useMemo(() => {
    if (!searchQuery.trim()) return itemIssues;
    const q = searchQuery.toLowerCase().trim();
    return itemIssues.filter(i => 
      i.issueNoteNo.toLowerCase().includes(q) ||
      (i.targetMachine || '').toLowerCase().includes(q) ||
      (i.targetCompany || '').toLowerCase().includes(q) ||
      i.receiverName.toLowerCase().includes(q) ||
      (i.remarks || '').toLowerCase().includes(q) ||
      i.date.toLowerCase().includes(q)
    );
  }, [itemIssues, searchQuery]);

  const filteredReceipts = useMemo(() => {
    if (!searchQuery.trim()) return itemReceipts;
    const q = searchQuery.toLowerCase().trim();
    return itemReceipts.filter(r => 
      (r.voucherNo || '').toLowerCase().includes(q) ||
      (r.machineName || '').toLowerCase().includes(q) ||
      (r.companyName || '').toLowerCase().includes(q) ||
      (r.remarks || '').toLowerCase().includes(q) ||
      (r.returnedDate || '').toLowerCase().includes(q)
    );
  }, [itemReceipts, searchQuery]);

  const totalReceivedQty = useMemo(() => {
    return itemReceipts.reduce((sum, r) => sum + Number(r.qtyReturned ?? r.transactionQty ?? 0), 0);
  }, [itemReceipts]);

  const totalIssuedQty = useMemo(() => {
    return itemIssues.reduce((sum, i) => sum + Number(i.qty || 0), 0);
  }, [itemIssues]);

  // Compute Old Stock quantity for this item
  const oldStockQty = useMemo(() => {
    if (!item) return 0;
    if (item.oldStock !== undefined && item.oldStock !== null) return Number(item.oldStock);
    if (item.initialStock !== undefined && item.initialStock !== null) return Number(item.initialStock);
    const oldRec = itemReceipts.find(r => r.isOldStock || r.transactionType === 'old_stock' || (r.remarks && r.remarks.toLowerCase().includes('old stock')));
    if (oldRec) return Number(oldRec.qtyReturned ?? oldRec.transactionQty ?? oldRec.oldStock ?? 0);
    return Number(item.stock || 0);
  }, [item, itemReceipts]);

  // Export to Excel
  const handleExportHistoryExcel = () => {
    if (!item) return;
    const dataToExport = activeTab === 'issues' 
      ? filteredTimeline.filter(t => t.type === 'issue') 
      : activeTab === 'receipts' 
        ? filteredTimeline.filter(t => t.type === 'receipt')
        : filteredTimeline;

    if (dataToExport.length === 0) {
      toast.error("No records to export.");
      return;
    }

    const rows = dataToExport.map((ev, idx) => {
      const isOld = Boolean((ev as any).isOldStock || (ev.remarks && ev.remarks.toLowerCase().includes('old stock')));
      const typeStr = ev.type === 'issue' ? 'ISSUE (OUTWARD)' : isOld ? 'OLD STOCK' : 'RECEIPT (INWARD)';
      return {
        "S.No": idx + 1,
        "Date": ev.date,
        "Transaction Type": typeStr,
        "Voucher / Note No.": ev.voucherNo,
        "Quantity": ev.type === 'issue' ? -ev.qty : ev.qty,
        "Unit": ev.unit,
        "Target / Source": ev.party,
        "Handled By / Consignee": ev.person,
        "Remarks": ev.remarks
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Item History");
    const safeName = (item.description || 'Item').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Store_Item_History_${safeName}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success("Excel sheet exported!");
  };

  // Export to PDF
  const handleExportHistoryPDF = () => {
    if (!item) return;
    const dataToExport = activeTab === 'issues' 
      ? filteredTimeline.filter(t => t.type === 'issue') 
      : activeTab === 'receipts' 
        ? filteredTimeline.filter(t => t.type === 'receipt')
        : filteredTimeline;

    if (dataToExport.length === 0) {
      toast.error("No records to export.");
      return;
    }

    const docPdf = new jsPDF('landscape', 'mm', 'a4');

    // Header Title
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(13);
    docPdf.setTextColor(30, 41, 59);
    docPdf.text('STORE ITEM TRANSACTION & AUDIT HISTORY', 14, 13);

    // Item Overview Metadata
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(9);
    docPdf.setTextColor(79, 70, 229);
    docPdf.text(`Item: ${item.description}`, 14, 18.5);

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.setTextColor(71, 85, 105);
    const meta1 = `PL No: ${item.plNo || 'N/A'} | Part No: ${item.partNo || 'N/A'} | Category: ${item.category} | Condition: ${item.itemCondition} | Unit: ${item.unit} | Location: ${item.location || 'N/A'}`;
    docPdf.text(meta1, 14, 23);

    const meta2 = `Company: ${item.companyName} | Current Stock: ${item.stock} ${item.unit} | Old Stock: ${oldStockQty} ${item.unit} | Total Inward: ${totalReceivedQty} ${item.unit} | Total Outward: ${totalIssuedQty} ${item.unit} | Valuation: Rs. ${(item.stock * (item.rate || 0)).toLocaleString('en-IN')}`;
    docPdf.text(meta2, 14, 27.5);

    const viewScope = activeTab === 'issues' ? 'Issues Only' : activeTab === 'receipts' ? 'Receipts Only' : 'All Transactions';
    const dateStr = `Generated on: ${format(new Date(), 'dd-MM-yyyy HH:mm')} | Filter Scope: ${viewScope} | Total Records: ${dataToExport.length}${searchQuery ? ` | Search: "${searchQuery}"` : ''}`;
    docPdf.text(dateStr, 14, 32);

    // Table Data
    const tableData = dataToExport.map((ev, idx) => {
      const isOld = Boolean((ev as any).isOldStock || (ev.remarks && ev.remarks.toLowerCase().includes('old stock')));
      const typeStr = ev.type === 'issue' ? 'ISSUE (OUTWARD)' : isOld ? 'OLD STOCK' : 'RECEIPT (INWARD)';
      return [
        idx + 1,
        ev.date || '-',
        typeStr,
        ev.voucherNo || '-',
        `${ev.type === 'issue' ? '-' : '+'}${ev.qty} ${ev.unit}`,
        ev.party || '-',
        ev.person || '-',
        ev.remarks || '-'
      ];
    });

    autoTable(docPdf, {
      startY: 35,
      head: [['#', 'Date', 'Type', 'Voucher / Note No.', 'Quantity', 'Target / Source', 'Handled By / Consignee', 'Remarks']],
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
        2: { cellWidth: 32, halign: 'center' },
        3: { cellWidth: 32, halign: 'center' },
        4: { cellWidth: 24, halign: 'center' },
        5: { cellWidth: 'auto', halign: 'left' },
        6: { cellWidth: 44, halign: 'left' },
        7: { cellWidth: 42, halign: 'left' }
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body') {
          if (hookData.column.index === 2) {
            const val = String(hookData.cell.raw || '');
            if (val.includes('ISSUE')) {
              hookData.cell.styles.textColor = [225, 29, 72];
              hookData.cell.styles.fontStyle = 'bold';
            } else if (val.includes('OLD STOCK')) {
              hookData.cell.styles.textColor = [180, 83, 9];
              hookData.cell.styles.fontStyle = 'bold';
            } else if (val.includes('RECEIPT')) {
              hookData.cell.styles.textColor = [16, 149, 106];
              hookData.cell.styles.fontStyle = 'bold';
            }
          }
          if (hookData.column.index === 4) {
            const val = String(hookData.cell.raw || '');
            if (val.startsWith('-')) {
              hookData.cell.styles.textColor = [225, 29, 72];
              hookData.cell.styles.fontStyle = 'bold';
            } else if (val.startsWith('+')) {
              hookData.cell.styles.textColor = [16, 149, 106];
              hookData.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
      didDrawPage: (data) => {
        const pageCount = docPdf.getNumberOfPages();
        docPdf.setFontSize(7.5);
        docPdf.setTextColor(148, 163, 184);
        docPdf.text(`Page ${data.pageNumber} of ${pageCount}`, docPdf.internal.pageSize.width - 25, docPdf.internal.pageSize.height - 6);
      }
    });

    const safeName = (item.description || 'Item').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    docPdf.save(`Store_Item_History_${safeName}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success("Item history PDF downloaded!");
  };

  // Safe early return ONLY after all hooks have been invoked
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 md:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl my-auto border border-slate-200 flex flex-col max-h-[92vh]"
      >
        {/* Modal Header */}
        <div className="p-4 md:p-5 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-xs shrink-0 mt-0.5">
              <Package size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base md:text-lg font-black text-slate-900 leading-tight">
                  {item.description}
                </h2>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold",
                  item.itemCondition === 'New' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                  item.itemCondition === 'Serviceable' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-slate-100 text-slate-600 border border-slate-200"
                )}>
                  {item.itemCondition}
                </span>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md border border-indigo-100 text-[10px] font-bold">
                  {item.category}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1">
                <span>PL: <strong className="font-mono text-slate-800">{item.plNo || '-'}</strong></span>
                <span>•</span>
                <span>Part #: <strong className="font-mono text-slate-800">{item.partNo || '-'}</strong></span>
                <span>•</span>
                <span>Location: <strong className="text-slate-800">{item.location || '-'}</strong></span>
                <span>•</span>
                <span>Company: <strong className="text-indigo-600">{item.companyName}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportHistoryExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs"
              title="Export History to Excel"
            >
              <Download size={13} />
              <span>Excel</span>
            </button>
            <button
              onClick={handleExportHistoryPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shadow-indigo-600/20"
              title="Export History to PDF Report"
            >
              <FileText size={13} />
              <span>Export PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200 transition-colors ml-1"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Quick Stat Highlights */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 md:gap-3 p-4 bg-slate-50/50 border-b border-slate-100 shrink-0">
          <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Current Stock (स्टॉक)</div>
            <div className="text-lg font-black text-indigo-700 mt-0.5 flex items-baseline gap-1">
              {item.stock} <span className="text-xs font-bold text-slate-500">{item.unit}</span>
            </div>
          </div>

          <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200/80 shadow-xs">
            <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
              <Package size={13} className="text-amber-600" /> Old Stock (आरंभिक)
            </div>
            <div className="text-lg font-black text-amber-900 mt-0.5 flex items-baseline gap-1">
              {oldStockQty} <span className="text-xs font-bold text-amber-700">{item.unit}</span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
              <ArrowDownLeft size={13} /> Total Received (इनवर्ड)
            </div>
            <div className="text-lg font-black text-emerald-700 mt-0.5 flex items-baseline gap-1">
              {totalReceivedQty} <span className="text-xs font-bold text-slate-500">{item.unit}</span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
              <ArrowUpRight size={13} /> Total Issued (आउटवर्ड)
            </div>
            <div className="text-lg font-black text-rose-700 mt-0.5 flex items-baseline gap-1">
              {totalIssuedQty} <span className="text-xs font-bold text-slate-500">{item.unit}</span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs col-span-2 sm:col-span-1">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stock Valuation</div>
            <div className="text-lg font-black text-slate-900 mt-0.5">
              ₹{(item.stock * (item.rate || 0)).toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        {/* Tab & Search Bar */}
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-all",
                activeTab === 'all'
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              All Activity ({combinedTimeline.length})
            </button>
            <button
              onClick={() => setActiveTab('issues')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                activeTab === 'issues'
                  ? "bg-white text-rose-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <ArrowUpRight size={13} />
              Issue History ({itemIssues.length})
            </button>
            <button
              onClick={() => setActiveTab('receipts')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                activeTab === 'receipts'
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <ArrowDownLeft size={13} />
              Receipts / Inward ({itemReceipts.length})
            </button>
          </div>

          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search voucher, machine, consignee..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-medium"
            />
          </div>
        </div>

        {/* History Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'all' && (
            <div className="space-y-2.5">
              {filteredTimeline.map((ev) => {
                const isOld = Boolean((ev as any).isOldStock || (ev.remarks && ev.remarks.toLowerCase().includes('old stock')));
                return (
                <div 
                  key={ev.id}
                  className={cn(
                    "rounded-xl border p-3.5 hover:shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                    isOld ? "bg-amber-50/40 border-amber-200/90" : "bg-white border-slate-200/90"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      ev.type === 'issue' 
                        ? "bg-rose-50 text-rose-600 border border-rose-200" 
                        : isOld
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                    )}>
                      {ev.type === 'issue' ? <ArrowUpRight size={16} /> : isOld ? <Package size={16} /> : <ArrowDownLeft size={16} />}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider",
                          ev.type === 'issue' 
                            ? "bg-rose-100/70 text-rose-800" 
                            : isOld
                              ? "bg-amber-200/80 text-amber-900 border border-amber-300"
                              : "bg-emerald-100/70 text-emerald-800"
                        )}>
                          {ev.type === 'issue' ? 'Issued / Outward' : isOld ? 'Old Stock' : 'Receipt / Inward'}
                        </span>
                        <span className={cn(
                          "font-mono text-xs font-bold",
                          isOld ? "text-amber-800" : "text-indigo-700"
                        )}>{ev.voucherNo}</span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                          <Calendar size={12} className="text-slate-400" />
                          {ev.date}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-800 mt-1">
                        {ev.party}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-right">
                      <div className={cn(
                        "text-sm font-black font-mono",
                        ev.type === 'issue' ? "text-rose-600" : isOld ? "text-amber-800" : "text-emerald-600"
                      )}>
                        {ev.type === 'issue' ? `-${ev.qty}` : `+${ev.qty}`} {ev.unit}
                      </div>
                      {isOld && (
                        <span className="text-[10px] font-bold text-amber-700 block">Old Stock</span>
                      )}
                    </div>

                    {ev.type === 'issue' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onDownloadVoucher(ev.rawIssue)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Download Issue Voucher PDF"
                        >
                          <Download size={14} />
                        </button>
                        {isMainAdmin && (
                          <>
                            <button
                              id={`history-edit-issue-${ev.rawIssue.id}`}
                              onClick={() => onEditIssue(ev.rawIssue)}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Edit Issue (Main Admin Only)"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              id={`history-delete-issue-${ev.rawIssue.id}`}
                              onClick={() => onDeleteIssue(ev.rawIssue)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Issue (Main Admin Only)"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}

              {filteredTimeline.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <Clock size={32} className="mx-auto text-slate-300 stroke-[1.5] mb-2" />
                  <p className="text-xs font-bold text-slate-600">No activity recorded for this item yet.</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Issues and connected receipts will appear here automatically.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'issues' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Date & Voucher</th>
                    <th className="py-2.5 px-3 text-center">Qty Issued</th>
                    <th className="py-2.5 px-3">Target Destination</th>
                    <th className="py-2.5 px-3">Received By</th>
                    <th className="py-2.5 px-3">Issued By</th>
                    <th className="py-2.5 px-3">Remarks</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-normal text-slate-700">
                  {filteredIssues.map((iss, idx) => (
                    <tr key={iss.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-indigo-600 text-xs">{iss.issueNoteNo}</div>
                        <div className="text-[10px] text-slate-500">{iss.date}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-lg font-bold text-xs inline-block border border-rose-100">
                          {iss.qty} {iss.unit}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">
                          {iss.targetMachine ? `Machine: ${iss.targetMachine}` : iss.targetCompany || 'Store'}
                        </div>
                        <span className="text-[10px] text-indigo-600 font-semibold uppercase">
                          {iss.targetType === 'machine' ? 'Machine Dispatch' : 'Company Transfer'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{iss.receiverName}</div>
                        <div className="text-[10px] text-slate-500">{iss.receiverDesignation || 'Consignee Officer'}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{iss.issuedBy}</div>
                        <div className="text-[10px] text-slate-500">{iss.officerDesignation || 'Store Official'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-[160px] truncate">
                        {iss.remarks || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onDownloadVoucher(iss)}
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Download Issue Voucher PDF"
                          >
                            <Download size={14} />
                          </button>
                          {isMainAdmin && (
                            <>
                              <button
                                id={`issue-table-edit-${iss.id}`}
                                onClick={() => onEditIssue(iss)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Edit Issue (Main Admin Only)"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                id={`issue-table-delete-${iss.id}`}
                                onClick={() => onDeleteIssue(iss)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Delete Issue (Main Admin Only)"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredIssues.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 text-xs font-medium">
                        No issue records found for this item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'receipts' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Date & Voucher</th>
                    <th className="py-2.5 px-3 text-center">Qty Received</th>
                    <th className="py-2.5 px-3">Source Machine & Company</th>
                    <th className="py-2.5 px-3 text-center">Stock Change</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3">Remarks / Logged By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-normal text-slate-700">
                  {filteredReceipts.map((rec, idx) => {
                    const isOld = Boolean(rec.isOldStock || rec.transactionType === 'old_stock' || (rec.remarks && rec.remarks.toLowerCase().includes('old stock')));
                    return (
                    <tr key={rec.id} className={cn("transition-colors", isOld ? "bg-amber-50/40 hover:bg-amber-50/70" : "hover:bg-slate-50/80")}>
                      <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className={cn("font-mono font-bold text-xs", isOld ? "text-amber-800" : "text-emerald-700")}>
                          {rec.voucherNo || (isOld ? 'OLD-STOCK' : '-')}
                        </div>
                        <div className="text-[10px] text-slate-500">{rec.returnedDate || '-'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg font-bold text-xs inline-block border",
                          isOld ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-emerald-50 text-emerald-700 border-emerald-100"
                        )}>
                          +{rec.qtyReturned ?? rec.transactionQty ?? 0} {rec.unit || item.unit}
                        </span>
                        {isOld && (
                          <span className="text-[9px] font-black uppercase text-amber-700 block mt-0.5">Old Stock</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">
                          {isOld ? 'Store Initial / Old Stock' : (rec.machineName ? `Machine: ${rec.machineName}` : '-')}
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {rec.companyName || '-'} {rec.zone ? `• ${rec.zone}` : ''}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-[11px] text-slate-700">
                        {isOld ? (
                          <span className="px-2 py-0.5 bg-amber-100/80 text-amber-900 rounded font-bold text-[10px]">
                            Old Stock: {rec.qtyReturned ?? rec.transactionQty ?? rec.oldStock ?? item.stock}
                          </span>
                        ) : rec.oldStock !== undefined && rec.newStock !== undefined ? (
                          <span>{rec.oldStock} ➜ <strong className="text-emerald-700">{rec.newStock}</strong></span>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 text-xs">
                        {rec.location || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-[180px] truncate">
                        <div className="font-medium">{isOld ? (rec.remarks || 'Old Stock') : (rec.remarks || 'Connected Material Receipt')}</div>
                      </td>
                    </tr>
                    );
                  })}

                  {filteredReceipts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-xs font-medium">
                        No connected material receipts found for this item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
