import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search,
  Download,
  FileText,
  Boxes,
  Calendar,
  Trash2,
  Edit,
  PackageMinus,
  RefreshCw,
} from 'lucide-react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
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
}

export interface UnconnectedReceiptRecord {
  id: string;
  voucherNo: string;
  returnedDate: string;
  zone: string;
  division: string;
  machineName: string;
  companyName: string;
  selectMode?: string;
  employeeId?: string;
  employeeName?: string;
  partNo: string;
  plNo: string;
  description: string;
  qtyReturned: number;
  transactionQty: number;
  unit: string;
  location: string;
  remarks: string;
  createdAt?: string;
}

function formatDateDisplay(rawDate?: any): string {
  if (!rawDate) return '-';
  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (!trimmed || trimmed === '-') return '-';
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
  return '-';
}

export default function UnconnectedMaterialReportView({
  filterPerms,
  userMachine,
  userCompany,
  userZone,
  userDivision,
}: Props) {
  const [receipts, setReceipts] = useState<UnconnectedReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState<string>(
    filterPerms.canChangeMachine ? 'all' : userMachine || 'all'
  );
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Admin Edit Modal
  const [editingRecord, setEditingRecord] = useState<UnconnectedReceiptRecord | null>(null);

  // Real-time listener for `unconnected_material_receipts`
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, 'unconnected_material_receipts'),
      (snap) => {
        const list: UnconnectedReceiptRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            voucherNo: (d.voucherNo || `VOU-${docSnap.id.slice(0, 6).toUpperCase()}`).trim(),
            returnedDate: d.returnedDate || d.date || '',
            zone: d.zone || '',
            division: d.division || '',
            machineName: d.machineName || '',
            companyName: d.companyName || '',
            selectMode: d.selectMode || '',
            employeeId: d.employeeId || '',
            employeeName: d.employeeName || '',
            partNo: d.partNo || '',
            plNo: d.plNo || '',
            description: d.description || 'Unconnected Material Spare',
            qtyReturned: Number(d.qtyReturned || d.quantityReturned || d.qty || 0),
            transactionQty: Number(d.transactionQty || d.qtyReturned || 0),
            unit: d.unit || 'Nos',
            location: d.location || 'Depot',
            remarks: d.remarks || '',
            createdAt: d.createdAt || '',
          };
        });

        // Sort descending by returnedDate / id
        list.sort((a, b) => {
          const dateA = a.returnedDate || a.createdAt || '';
          const dateB = b.returnedDate || b.createdAt || '';
          return dateB.localeCompare(dateA);
        });

        setReceipts(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error loading unconnected material receipts:', err);
        toast.error('Failed to load unconnected material receipts.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Distinct Filter Option Lists
  const machinesList = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach((r) => {
      if (r.machineName && r.machineName.trim() && r.machineName !== '-') {
        set.add(r.machineName.trim());
      }
    });
    return Array.from(set).sort();
  }, [receipts]);

  const zonesList = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach((r) => {
      if (r.zone && r.zone.trim() && r.zone !== '-') set.add(r.zone.trim());
    });
    return Array.from(set).sort();
  }, [receipts]);

  const divisionsList = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach((r) => {
      if (r.division && r.division.trim() && r.division !== '-') set.add(r.division.trim());
    });
    return Array.from(set).sort();
  }, [receipts]);

  const companiesList = useMemo(() => {
    const set = new Set<string>();
    receipts.forEach((r) => {
      if (r.companyName && r.companyName.trim() && r.companyName !== '-') set.add(r.companyName.trim());
    });
    return Array.from(set).sort();
  }, [receipts]);

  // Role-based and Search Filtering
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      // RBAC Company Filter
      if (!filterPerms.isFullAdmin && userCompany) {
        if (r.companyName && r.companyName !== userCompany) return false;
      }

      // RBAC Machine Filter
      if (!filterPerms.canChangeMachine && userMachine && userMachine !== 'all') {
        if (r.machineName && r.machineName !== userMachine) return false;
      }

      // UI Dropdown Filters
      if (selectedMachine !== 'all' && r.machineName !== selectedMachine) return false;
      if (selectedZone !== 'all' && r.zone !== selectedZone) return false;
      if (selectedDivision !== 'all' && r.division !== selectedDivision) return false;
      if (selectedCompany !== 'all' && r.companyName !== selectedCompany) return false;

      // Date Range Filter
      if (startDate || endDate) {
        const itemDate = r.returnedDate || r.createdAt?.slice(0, 10) || '';
        if (itemDate) {
          if (startDate && itemDate < startDate) return false;
          if (endDate && itemDate > endDate) return false;
        }
      }

      // Free Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          r.voucherNo.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.plNo.toLowerCase().includes(q) ||
          r.partNo.toLowerCase().includes(q) ||
          r.machineName.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          (r.employeeName || '').toLowerCase().includes(q) ||
          (r.employeeId || '').toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q) ||
          r.zone.toLowerCase().includes(q) ||
          r.division.toLowerCase().includes(q) ||
          r.remarks.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [
    receipts,
    filterPerms,
    userCompany,
    userMachine,
    selectedMachine,
    selectedZone,
    selectedDivision,
    selectedCompany,
    startDate,
    endDate,
    searchTerm,
  ]);

  // Overall Statistics
  const stats = useMemo(() => {
    let totalQty = 0;
    const machines = new Set<string>();
    const uniqueSpares = new Set<string>();

    filteredReceipts.forEach((r) => {
      totalQty += r.qtyReturned || 0;
      if (r.machineName) machines.add(r.machineName);
      const spareKey = r.plNo || r.partNo || r.description;
      if (spareKey) uniqueSpares.add(spareKey);
    });

    return {
      totalCount: filteredReceipts.length,
      totalQty,
      machinesCount: machines.size,
      sparesCount: uniqueSpares.size,
    };
  }, [filteredReceipts]);

  // Paginated Slicing
  const totalPages = Math.ceil(filteredReceipts.length / itemsPerPage) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredReceipts.slice(start, start + itemsPerPage);
  }, [filteredReceipts, currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedMachine, selectedZone, selectedDivision, selectedCompany, startDate, endDate, itemsPerPage]);

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredReceipts.length === 0) {
      toast.error('No unconnected material receipts to export.');
      return;
    }

    const data = filteredReceipts.map((r, idx) => ({
      'S.No': idx + 1,
      'VOUCHER NO': r.voucherNo,
      'RETURNED DATE': formatDateDisplay(r.returnedDate),
      'ZONE': r.zone || '-',
      'DIVISION': r.division || '-',
      'MACHINE NAME': r.machineName || '-',
      'COMPANY': r.companyName || '-',
      'RETURNED BY (EMPLOYEE)': r.employeeName ? `${r.employeeName} (${r.employeeId || 'N/A'})` : '-',
      'PL NO': r.plNo || '-',
      'PART NO': r.partNo || '-',
      'ITEM DESCRIPTION': r.description,
      'RETURNED QTY': r.qtyReturned,
      'TRANSACTION QTY': r.transactionQty,
      'UNIT': r.unit || 'Nos',
      'LOCATION / DEPOT': r.location || '-',
      'REMARKS': r.remarks || '-',
    }));

    exportReportToExcel(data, `Unconnected_Material_Report_${format(new Date(), 'dd-MM-yyyy')}`);
    toast.success(`Exported ${filteredReceipts.length} records to Excel.`);
  };

  // Export to PDF
  const handleExportPdf = () => {
    if (filteredReceipts.length === 0) {
      toast.error('No unconnected material receipts to export.');
      return;
    }

    const headers = [
      'SR.',
      'VOUCHER NO',
      'DATE',
      'MACHINE / UNIT',
      'PL / PART NO',
      'ITEM DESCRIPTION',
      'QTY',
      'LOCATION',
      'REMARKS',
    ];

    const rows = filteredReceipts.map((r, idx) => [
      idx + 1,
      r.voucherNo,
      formatDateDisplay(r.returnedDate),
      r.machineName || '-',
      r.plNo && r.partNo ? `${r.plNo}\n(${r.partNo})` : r.plNo || r.partNo || '-',
      r.description,
      `${r.qtyReturned} ${r.unit || 'Nos'}`,
      r.location || '-',
      r.remarks || '-',
    ]);

    exportReportToPdf({
      title: 'UNCONNECTED MATERIAL RECEIPT REPORT',
      subtitle: 'Surplus & Returned Materials Register',
      filterSummary: `Records: ${filteredReceipts.length} | Total Qty: ${stats.totalQty} | Date: ${format(new Date(), 'dd-MM-yyyy')}`,
      headers,
      rows,
      filename: `Unconnected_Material_Report_${format(new Date(), 'dd-MM-yyyy')}`,
      orientation: 'landscape',
    });
    toast.success('Generated PDF Report.');
  };

  // Admin Delete Handler
  const handleDelete = async (r: UnconnectedReceiptRecord) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only administrators can delete unconnected material records.');
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to delete unconnected receipt "${r.voucherNo}" (${r.description})? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'unconnected_material_receipts', r.id));
      toast.success(`Receipt ${r.voucherNo} deleted successfully.`);
    } catch (err) {
      console.error('Error deleting receipt:', err);
      toast.error('Failed to delete receipt.');
    }
  };

  // Admin Edit Fields Configuration
  const editFields: EditFieldConfig[] = [
    { key: 'voucherNo', label: 'Voucher No', type: 'text', required: true },
    { key: 'returnedDate', label: 'Returned Date (YYYY-MM-DD)', type: 'date', required: true },
    { key: 'machineName', label: 'Machine Name', type: 'text', required: true },
    { key: 'zone', label: 'Zone', type: 'text' },
    { key: 'division', label: 'Division', type: 'text' },
    { key: 'plNo', label: 'PL No', type: 'text' },
    { key: 'partNo', label: 'Part No', type: 'text' },
    { key: 'description', label: 'Item Description', type: 'textarea', required: true },
    { key: 'qtyReturned', label: 'Returned Qty', type: 'number', required: true },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'location', label: 'Location / Depot', type: 'text' },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
  ];

  return (
    <div className="space-y-5">
      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <Boxes size={20} />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Receipts</div>
            <div className="text-xl font-black text-slate-900 font-mono mt-0.5">{stats.totalCount}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <PackageMinus size={20} />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Qty Returned</div>
            <div className="text-xl font-black text-emerald-600 font-mono mt-0.5">{stats.totalQty}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Boxes size={20} />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Unique Items / Spares</div>
            <div className="text-xl font-black text-slate-900 font-mono mt-0.5">{stats.sparesCount}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shrink-0">
            <RefreshCw size={20} />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Covered Machines</div>
            <div className="text-xl font-black text-slate-900 font-mono mt-0.5">{stats.machinesCount}</div>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-grow max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search voucher, PL/part no, description, machine..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
              title="Export Full Data to Excel"
            >
              <Download size={14} />
              <span>Excel</span>
            </button>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
              title="Export Full Data to PDF"
            >
              <FileText size={14} />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* Dropdown Filters & Date Range */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          {/* Machine Dropdown */}
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            disabled={!filterPerms.canChangeMachine && Boolean(userMachine)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          >
            <option value="all">All Machines ({machinesList.length})</option>
            {machinesList.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* Zone Dropdown */}
          {zonesList.length > 0 && (
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Zones</option>
              {zonesList.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}

          {/* Division Dropdown */}
          {divisionsList.length > 0 && (
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Divisions</option>
              {divisionsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          {/* Company Dropdown */}
          {filterPerms.isFullAdmin && companiesList.length > 0 && (
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Companies</option>
              {companiesList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          {/* Date Range */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-600">
            <Calendar size={13} className="text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent focus:outline-none text-[11px] font-medium"
              title="From Date"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent focus:outline-none text-[11px] font-medium"
              title="To Date"
            />
          </div>

          {/* Reset Button */}
          {(searchTerm ||
            selectedMachine !== (filterPerms.canChangeMachine ? 'all' : userMachine || 'all') ||
            selectedZone !== 'all' ||
            selectedDivision !== 'all' ||
            selectedCompany !== 'all' ||
            startDate ||
            endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                if (filterPerms.canChangeMachine) setSelectedMachine('all');
                setSelectedZone('all');
                setSelectedDivision('all');
                setSelectedCompany('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Boxes size={16} className="text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Unconnected Material Register ({filteredReceipts.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Surplus, unconnected and returned spare material receipts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#1e293b] text-white font-bold uppercase tracking-wider text-[11px] border-b border-slate-700">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-700/60 whitespace-nowrap">SR.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">VOUCHER NO</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">RETURNED DATE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">ZONE / DIVISION</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">MACHINE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">COMPANY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">PL NO / PART NO</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[220px]">ITEM DESCRIPTION</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">RETURNED QTY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">LOCATION / DEPOT</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[160px]">REMARKS</th>
                {filterPerms.isFullAdmin && (
                  <th className="p-3 text-center w-24 whitespace-nowrap">ACTIONS</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td
                    colSpan={filterPerms.isFullAdmin ? 12 : 11}
                    className="p-8 text-center text-slate-400 font-medium"
                  >
                    Loading unconnected material receipts...
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={filterPerms.isFullAdmin ? 12 : 11}
                    className="p-8 text-center text-slate-400 font-medium"
                  >
                    No unconnected material receipts found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedData.map((r, idx) => {
                  const globalIdx = (currentPage - 1) * itemsPerPage + idx + 1;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* SR */}
                      <td className="p-3 text-center font-bold text-slate-400 border-r border-slate-200/60">
                        {globalIdx}
                      </td>

                      {/* VOUCHER NO */}
                      <td className="p-3 font-mono font-bold text-indigo-700 whitespace-nowrap border-r border-slate-200/60">
                        {r.voucherNo}
                      </td>

                      {/* RETURNED DATE */}
                      <td className="p-3 font-medium text-slate-700 whitespace-nowrap border-r border-slate-200/60">
                        {formatDateDisplay(r.returnedDate)}
                      </td>

                      {/* ZONE / DIVISION */}
                      <td className="p-3 border-r border-slate-200/60 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{r.zone || '-'}</div>
                        <div className="text-[11px] text-slate-500 font-normal">{r.division || '-'}</div>
                      </td>

                      {/* MACHINE */}
                      <td className="p-3 font-bold text-slate-900 whitespace-nowrap border-r border-slate-200/60">
                        {r.machineName || '-'}
                      </td>

                      {/* COMPANY */}
                      <td className="p-3 font-medium text-slate-700 whitespace-nowrap border-r border-slate-200/60">
                        {r.companyName || '-'}
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
                          <div className="text-slate-600 italic text-xs">Uncategorized Spare</div>
                        )}
                      </td>

                      {/* ITEM DESCRIPTION */}
                      <td className="p-3 font-semibold text-slate-900 border-r border-slate-200/60 min-w-[220px] leading-snug">
                        <div>{r.description}</div>
                        {r.employeeName && (
                          <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                            By: {r.employeeName} {r.employeeId ? `(${r.employeeId})` : ''}
                          </div>
                        )}
                      </td>

                      {/* RETURNED QTY */}
                      <td className="p-3 text-right font-mono font-bold text-emerald-600 whitespace-nowrap border-r border-slate-200/60">
                        {r.qtyReturned} {r.unit}
                      </td>

                      {/* LOCATION / DEPOT */}
                      <td className="p-3 font-medium text-slate-700 whitespace-nowrap border-r border-slate-200/60">
                        {r.location || '-'}
                      </td>

                      {/* REMARKS */}
                      <td className="p-3 text-slate-600 border-r border-slate-200/60 leading-relaxed min-w-[160px]">
                        {r.remarks || '-'}
                      </td>

                      {/* ACTIONS */}
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setEditingRecord(r)}
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

        {/* Pagination */}
        {filteredReceipts.length > 0 && (
          <ReportPagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={itemsPerPage}
            totalItems={filteredReceipts.length}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {/* Admin Edit Modal */}
      {editingRecord && (
        <EditReportRecordModal
          isOpen={Boolean(editingRecord)}
          onClose={() => setEditingRecord(null)}
          onSaveSuccess={() => {
            setEditingRecord(null);
            toast.success('Receipt record updated successfully.');
          }}
          recordId={editingRecord.id}
          collectionName="unconnected_material_receipts"
          title={`Edit Unconnected Receipt - ${editingRecord.voucherNo}`}
          fields={editFields}
          initialData={editingRecord}
        />
      )}
    </div>
  );
}
