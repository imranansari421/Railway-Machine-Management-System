import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getEffectiveContractStatus } from '../../utils/contracts';
import { Search, Download, FileText, CalendarClock, Calendar, Edit, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { toast } from 'sonner';

interface Props {
  filterPerms: FilterAccessPermissions;
  userCompany?: string;
  userMachine?: string;
}

export default function ContractsReportView({ filterPerms, userCompany, userMachine }: Props) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState(() => {
    return filterPerms.isFullAdmin ? 'all' : (userCompany || 'all');
  });
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 10-row pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Edit Modal State
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    recordId: string;
    fields: EditFieldConfig[];
    initialData: Record<string, any>;
  }>({
    isOpen: false,
    recordId: '',
    fields: [],
    initialData: {},
  });

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, 'machine_contracts'), (snap) => {
      const list: any[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.createdAt || b.startDate || 0).getTime() - new Date(a.createdAt || a.startDate || 0).getTime());
      setContracts(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const companiesList = useMemo(() => {
    const set = new Set<string>();
    contracts.forEach(c => { if (c.companyName) set.add(c.companyName); });
    return Array.from(set).sort();
  }, [contracts]);

  const machinesList = useMemo(() => {
    const set = new Set<string>();
    contracts.forEach(c => { if (c.machineName) set.add(c.machineName); });
    return Array.from(set).sort();
  }, [contracts]);

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      if (selectedStatus !== 'all') {
        const s = getEffectiveContractStatus(c);
        if (s !== selectedStatus.toLowerCase()) return false;
      }

      if (selectedCompany !== 'all') {
        if (!c.companyName || c.companyName.trim().toLowerCase() !== selectedCompany.trim().toLowerCase()) {
          return false;
        }
      }

      if (selectedMachine !== 'all') {
        if (!c.machineName || c.machineName.trim().toLowerCase() !== selectedMachine.trim().toLowerCase()) {
          return false;
        }
      }

      if (startDate) {
        const d = c.startDate || c.createdAt?.slice(0, 10);
        if (d && d < startDate) return false;
      }
      if (endDate) {
        const d = c.startDate || c.createdAt?.slice(0, 10);
        if (d && d > endDate) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (c.machineName || '').toLowerCase().includes(q) ||
          (c.companyName || '').toLowerCase().includes(q) ||
          (c.contractNo || '').toLowerCase().includes(q) ||
          (c.previousCompany || '').toLowerCase().includes(q) ||
          (c.transferredToCompany || '').toLowerCase().includes(q) ||
          (c.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [contracts, selectedStatus, selectedCompany, selectedMachine, startDate, endDate, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, selectedCompany, selectedMachine, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredContracts.length / pageSize));
  const paginatedContracts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredContracts.slice(start, start + pageSize);
  }, [filteredContracts, currentPage, pageSize]);

  // Master Admin Delete
  const handleDelete = async (c: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete contract records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete contract for machine "${c.machineName}" (${c.companyName})? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'machine_contracts', c.id));
      toast.success('Contract record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete contract: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (c: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit contract records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'machineName', label: 'Machine Name', type: 'text', required: true },
      { key: 'companyName', label: 'Assigned Company', type: 'text', required: true },
      { key: 'contractNo', label: 'Contract / WO No', type: 'text' },
      { key: 'startDate', label: 'Assignment / Start Date', type: 'date' },
      { key: 'endDate', label: 'Contract Expiry Date', type: 'date' },
      { key: 'status', label: 'Contract Status', type: 'select', options: ['active', 'transferred', 'renewed', 'expired', 'terminated'] },
      { key: 'previousCompany', label: 'Previous Company (if transferred)', type: 'text' },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: c.id,
      fields,
      initialData: {
        machineName: c.machineName || '',
        companyName: c.companyName || '',
        contractNo: c.contractNo || '',
        startDate: c.startDate || '',
        endDate: c.endDate || '',
        status: c.status || 'active',
        previousCompany: c.previousCompany || '',
        remarks: c.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredContracts.map((c, idx) => ({
      'S.No': idx + 1,
      'MACHINE NAME': c.machineName || '-',
      'ASSIGNED COMPANY': c.companyName || '-',
      'CONTRACT / WO NO': c.contractNo || '-',
      'START DATE / ASSIGNED': c.startDate || (c.createdAt ? format(new Date(c.createdAt), 'dd-MM-yyyy') : '-'),
      'END DATE / EXPIRY': c.endDate || '-',
      'CONTRACT STATUS': (c.status || 'active').toUpperCase(),
      'PREVIOUS COMPANY': c.previousCompany || '-',
      'RAILWAY ZONE': c.zone || '-',
      'RAILWAY DIVISION': c.division || '-',
      'RENEWAL / TRANSFER HISTORY': Array.isArray(c.renewalHistory) && c.renewalHistory.length > 0
        ? c.renewalHistory.map((h: any) => `${h.date || ''}: ${h.note || h.remarks || 'Renewed'}`).join('; ')
        : (c.renewalHistory?.length ? `${c.renewalHistory.length} Renewals Recorded` : 'None'),
      'REMARKS': c.remarks || '-',
      'RECORDED AT': c.createdAt ? format(new Date(c.createdAt), 'dd-MM-yyyy HH:mm') : '-',
    }));
    exportReportToExcel(data, 'Machine_Contracts_Report');
  };

  const handleExportPdf = () => {
    const headers = ['S.No', 'Machine', 'Assigned Company', 'Contract / WO No', 'Start / Assigned', 'End / Expiry', 'Status', 'Zone / Div', 'Previous Co.', 'Remarks'];
    const rows = filteredContracts.map((c, idx) => [
      idx + 1,
      c.machineName || '-',
      c.companyName || '-',
      c.contractNo || '-',
      c.startDate || (c.createdAt ? format(new Date(c.createdAt), 'dd-MM-yy') : '-'),
      c.endDate || '-',
      (c.status || 'active').toUpperCase(),
      `${c.zone || '-'}/${c.division || '-'}`,
      c.previousCompany || (c.renewalHistory?.length ? `${c.renewalHistory.length} Renewals` : '-'),
      c.remarks || '-',
    ]);
    exportReportToPdf({
      title: 'MACHINE CONTRACTS & ALLOCATION REPORT',
      subtitle: 'Official Registry of Machine Allocation, Contracts, Renewals & Transfers',
      filterSummary: `Status: ${selectedStatus.toUpperCase()} | Company: ${selectedCompany} | Total Records Exported: ${filteredContracts.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* Control / Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search machine, company, contract..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium"
            />
          </div>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Contract Status</option>
            <option value="active">Active Contracts</option>
            <option value="transferred">Transferred</option>
            <option value="renewed">Renewed</option>
            <option value="expired">Expired</option>
          </select>

          {/* Machine Filter */}
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Machines</option>
            {machinesList.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Company Filter */}
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            disabled={!filterPerms.isFullAdmin}
            className={`px-3 py-2 text-xs rounded-xl border border-slate-200 font-semibold ${
              !filterPerms.isFullAdmin ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 text-slate-700'
            }`}
          >
            <option value="all">All Companies</option>
            {companiesList.map(c => (
              <option key={c} value={c}>{c}</option>
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

          {(searchTerm || selectedStatus !== 'all' || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedStatus('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold"
            >
              Reset
            </button>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={handleExportExcel}
            title={`Export complete data of all ${filteredContracts.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredContracts.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Machine Contracts & Allocations ({filteredContracts.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">Assignment, Renewals & Transfers</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-3 text-center w-12">#</th>
                <th className="p-3">Machine Name</th>
                <th className="p-3">Assigned Company</th>
                <th className="p-3">Contract / WO No</th>
                <th className="p-3">Assignment Date</th>
                <th className="p-3">Expiry Date</th>
                <th className="p-3">Contract Status</th>
                <th className="p-3">Transfer / History</th>
                <th className="p-3">Remarks</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 10 : 9} className="p-8 text-center text-slate-400 font-medium">
                    Loading machine contracts report...
                  </td>
                </tr>
              ) : paginatedContracts.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 10 : 9} className="p-8 text-center text-slate-400 font-medium">
                    No machine contract records match the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedContracts.map((c, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  const statusStr = getEffectiveContractStatus(c);
                  return (
                    <tr key={c.id || idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-400">{absoluteIndex}</td>
                      <td className="p-3 font-mono font-bold text-indigo-700">
                        {c.machineName}
                      </td>
                      <td className="p-3 font-semibold text-slate-800">
                        {c.companyName}
                      </td>
                      <td className="p-3 font-mono text-slate-700">
                        {c.contractNo || '-'}
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {c.startDate || (c.createdAt ? format(new Date(c.createdAt), 'dd-MM-yyyy') : '-')}
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {c.endDate || '-'}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          statusStr === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : statusStr === 'transferred'
                            ? 'bg-blue-100 text-blue-800'
                            : statusStr === 'expired'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {statusStr.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">
                        {c.transferredToCompany ? (
                          <div className="text-[11px] bg-blue-50/80 p-1 rounded border border-blue-100 text-blue-900 font-semibold">
                            <span className="text-blue-500 font-normal">To:</span> {c.transferredToCompany}
                          </div>
                        ) : c.previousCompany ? (
                          <div className="text-[11px]">
                            <span className="text-slate-400">Prev:</span> <span className="font-medium text-slate-700">{c.previousCompany}</span>
                          </div>
                        ) : c.renewalHistory?.length ? (
                          <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-bold">
                            {c.renewalHistory.length} Renewals
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-3 text-slate-500 italic max-w-xs truncate" title={c.remarks}>
                        {c.remarks || '-'}
                      </td>
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(c)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit Contract"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(c)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Contract"
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
          totalItems={filteredContracts.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Machine Contract"
        subtitle="Master Admin Privileges"
        recordId={editModal.recordId}
        collectionName="machine_contracts"
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
