import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Download, FileText, AlertTriangle, Calendar, Edit, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { toast } from 'sonner';

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
}

// Format Date to DD-MM-YYYY HH:mm matching image.png format
const formatToDDMMYYYY = (dateStr: string | undefined | null) => {
  if (!dateStr || dateStr.trim() === '' || dateStr === '-') return '-';
  const cleanStr = dateStr.trim();
  if (/^\d{2}-\d{2}-\d{4}/.test(cleanStr)) {
    return cleanStr;
  }
  const d = new Date(cleanStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return cleanStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

// Format Logged By official/creator name
const formatCreatorName = (name: string | undefined | null) => {
  if (!name) return 'Admin';
  const trimmed = name.trim();
  if (
    trimmed.endsWith('@billedapp.com') ||
    trimmed.toLowerCase() === 'admin' ||
    trimmed.toLowerCase() === 'master'
  ) {
    return 'Admin';
  }
  if (trimmed.endsWith('@employee.billedapp.com')) {
    return trimmed.split('@')[0].toUpperCase();
  }
  return trimmed.toUpperCase();
};

export default function BreakdownReportView({ filterPerms, userMachine }: Props) {
  const [breakdowns, setBreakdowns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
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
    const unsub = onSnapshot(collection(db, 'breakdowns'), (snap) => {
      const list: any[] = snap.docs.map(d => {
        const data = d.data();
        const start = data.dateTime || data.timeFrom || data.date || '';
        const end = data.toDateTime || data.timeTo || '';
        let durationStr = '-';
        if (start && end) {
          const diffMs = new Date(end).getTime() - new Date(start).getTime();
          if (!isNaN(diffMs) && diffMs > 0) {
            const totalMins = Math.floor(diffMs / (1000 * 60));
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            durationStr = `${hrs}h ${mins}m`;
          }
        } else if (data.durationHours || data.durationMinutes) {
          durationStr = `${data.durationHours || 0}h ${data.durationMinutes || 0}m`;
        }

        const dateOnly = (data.dateTime || data.date || data.createdAt || '').slice(0, 10);

        return {
          id: d.id,
          ...data,
          date: dateOnly,
          dateTime: start,
          toDateTime: end,
          duration: durationStr,
          machineName: data.machineName || '-',
          companyName: data.companyName || '-',
          breakdownType: data.breakdownType || data.type || data.category || 'Block Time',
          systemAffected: data.breakdownSection || data.section || data.systemAffected || '-',
          breakdownSection: data.breakdownSection || data.section || data.systemAffected || '-',
          reason: data.breakdownReason || data.reason || data.cause || '-',
          breakdownReason: data.breakdownReason || data.reason || data.cause || '-',
          remedialAction: data.preventativeMeasures || data.remedialAction || data.actionTaken || data.remarks || '-',
          preventativeMeasures: data.preventativeMeasures || data.remedialAction || data.actionTaken || data.remarks || '-',
          reportedBy: data.employeeName || data.reportedBy || data.createdBy || 'Admin',
          employeeName: data.employeeName || data.reportedBy || data.createdBy || 'Admin',
          zone: data.zone || '-',
          division: data.division || '-',
          status: data.status || 'Resolved',
          remarks: data.remarks || data.preventativeMeasures || '-',
        };
      });
      list.sort((a: any, b: any) => new Date(b.dateTime || b.date || b.createdAt || 0).getTime() - new Date(a.dateTime || a.date || a.createdAt || 0).getTime());
      setBreakdowns(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const machinesList = useMemo(() => {
    const set = new Set<string>();
    breakdowns.forEach(b => { if (b.machineName) set.add(b.machineName); });
    return Array.from(set).sort();
  }, [breakdowns]);

  const filteredBreakdowns = useMemo(() => {
    return breakdowns.filter(b => {
      if (selectedMachine !== 'all') {
        if (!b.machineName || b.machineName.trim().toLowerCase() !== selectedMachine.trim().toLowerCase()) {
          return false;
        }
      }

      if (selectedType !== 'all') {
        const t = (b.breakdownType || b.category || '').toLowerCase();
        if (!t.includes(selectedType.toLowerCase())) return false;
      }

      if (selectedStatus !== 'all') {
        const s = (b.status || 'resolved').toLowerCase();
        if (s !== selectedStatus.toLowerCase()) return false;
      }

      if (startDate) {
        const d = b.date || b.createdAt?.slice(0, 10);
        if (d && d < startDate) return false;
      }
      if (endDate) {
        const d = b.date || b.createdAt?.slice(0, 10);
        if (d && d > endDate) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (b.machineName || '').toLowerCase().includes(q) ||
          (b.breakdownType || '').toLowerCase().includes(q) ||
          (b.systemAffected || '').toLowerCase().includes(q) ||
          (b.reason || b.cause || '').toLowerCase().includes(q) ||
          (b.remedialAction || b.actionTaken || '').toLowerCase().includes(q) ||
          (b.reportedBy || b.employeeName || '').toLowerCase().includes(q) ||
          (b.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [breakdowns, selectedMachine, selectedType, selectedStatus, startDate, endDate, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMachine, selectedType, selectedStatus, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredBreakdowns.length / pageSize));
  const paginatedBreakdowns = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredBreakdowns.slice(start, start + pageSize);
  }, [filteredBreakdowns, currentPage, pageSize]);

  // Master Admin Delete
  const handleDelete = async (b: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete breakdown records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete breakdown record for "${b.machineName}" on ${b.date || 'unknown date'}? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'breakdowns', b.id));
      toast.success('Breakdown record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete breakdown record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (b: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit breakdown records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'machineName', label: 'Machine Name', type: 'text', required: true },
      { key: 'companyName', label: 'Company', type: 'text' },
      { key: 'breakdownSection', label: 'Failure Section / System', type: 'text', required: true },
      { key: 'breakdownReason', label: 'Failure Reason', type: 'textarea', required: true },
      { key: 'preventativeMeasures', label: 'Preventative Measures', type: 'textarea', required: true },
      { key: 'breakdownType', label: 'Type', type: 'select', options: ['Block Time', 'Base Depot', 'Mechanical', 'Electrical', 'Other'] },
      { key: 'dateTime', label: 'From Date/Time', type: 'datetime-local', required: true },
      { key: 'toDateTime', label: 'To Date/Time', type: 'datetime-local' },
      { key: 'employeeName', label: 'Logged By', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['Resolved', 'Pending', 'In Progress'] },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: b.id,
      fields,
      initialData: {
        machineName: b.machineName || '',
        companyName: b.companyName || '',
        breakdownSection: b.breakdownSection || b.section || b.systemAffected || '',
        breakdownReason: b.breakdownReason || b.reason || b.cause || '',
        preventativeMeasures: b.preventativeMeasures || b.remedialAction || b.actionTaken || '',
        breakdownType: b.breakdownType || b.type || 'Block Time',
        dateTime: b.dateTime || b.timeFrom || b.date || '',
        toDateTime: b.toDateTime || b.timeTo || '',
        employeeName: b.employeeName || b.reportedBy || '',
        status: b.status || 'Resolved',
        remarks: b.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredBreakdowns.map((b, idx) => ({
      'SR.': idx + 1,
      'MACHINE NAME': b.machineName || '-',
      'COMPANY': b.companyName || '-',
      'FAILURE SECTION / SYSTEM': b.breakdownSection || b.section || b.systemAffected || '-',
      'FAILURE REASON': b.breakdownReason || b.reason || b.cause || '-',
      'PREVENTATIVE MEASURES': b.preventativeMeasures || b.remedialAction || b.actionTaken || '-',
      'TYPE': b.breakdownType || b.type || 'Block Time',
      'FROM DATE/TIME': formatToDDMMYYYY(b.dateTime || b.timeFrom || b.date),
      'TO DATE/TIME': b.toDateTime || b.timeTo ? formatToDDMMYYYY(b.toDateTime || b.timeTo) : '-',
      'LOGGED BY': formatCreatorName(b.employeeName || b.reportedBy || b.createdBy),
      'RECORDED AT': b.createdAt ? format(new Date(b.createdAt), 'dd-MM-yyyy HH:mm') : '-',
    }));
    exportReportToExcel(data, 'Railway_Machine_Breakdown_Failure_Report');
  };

  const handleExportPdf = () => {
    const headers = [
      'SR.',
      'MACHINE NAME',
      'COMPANY',
      'FAILURE SECTION / SYSTEM',
      'FAILURE REASON',
      'PREVENTATIVE MEASURES',
      'TYPE',
      'FROM DATE/TIME',
      'TO DATE/TIME',
      'LOGGED BY',
    ];
    const rows = filteredBreakdowns.map((b, idx) => [
      idx + 1,
      b.machineName || '-',
      b.companyName || '-',
      b.breakdownSection || b.section || b.systemAffected || '-',
      b.breakdownReason || b.reason || b.cause || '-',
      b.preventativeMeasures || b.remedialAction || b.actionTaken || '-',
      b.breakdownType || b.type || 'Block Time',
      formatToDDMMYYYY(b.dateTime || b.timeFrom || b.date),
      b.toDateTime || b.timeTo ? formatToDDMMYYYY(b.toDateTime || b.timeTo) : '-',
      formatCreatorName(b.employeeName || b.reportedBy || b.createdBy),
    ]);
    exportReportToPdf({
      title: 'RAILWAY MACHINE BREAKDOWN / FAILURE HISTORY REPORT',
      subtitle: `Generated: ${format(new Date(), 'M/d/yyyy, h:mm:ss a')} | Total Breakdown Incidents: ${filteredBreakdowns.length}`,
      filterSummary: `Machine: ${selectedMachine} | Type: ${selectedType} | Total Incidents: ${filteredBreakdowns.length}`,
      headers,
      rows,
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { fontStyle: 'bold', cellWidth: 22 },
        2: { cellWidth: 24 },
        3: { textColor: [185, 28, 28], fontStyle: 'bold', cellWidth: 26 }, // Red #b91c1c
        4: { cellWidth: 62, fontSize: 6.5 }, // Failure reason
        5: { textColor: [4, 120, 87], cellWidth: 50, fontSize: 6.5 }, // Preventative #047857
        6: { halign: 'center', cellWidth: 18 },
        7: { cellWidth: 22 },
        8: { cellWidth: 22 },
        9: { cellWidth: 20, fontStyle: 'bold' },
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search cause, action, machine..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium"
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
            <option value="all">All Machines</option>
            {machinesList.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Failure Types</option>
            <option value="mechanical">Mechanical</option>
            <option value="electrical">Electrical</option>
            <option value="hydraulic">Hydraulic</option>
            <option value="pneumatic">Pneumatic</option>
            <option value="engine">Engine</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Status</option>
            <option value="resolved">Resolved</option>
            <option value="pending">Pending</option>
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

          {(searchTerm || selectedMachine !== (userMachine || 'all') || selectedType !== 'all' || selectedStatus !== 'all' || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                if (filterPerms.canChangeMachine) setSelectedMachine('all');
                setSelectedType('all');
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
            title={`Export complete data of all ${filteredBreakdowns.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredBreakdowns.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Report Sheet Header & Table matching image.png */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6 overflow-hidden">
        <div className="border-b-2 border-slate-900 pb-3 mb-5 flex flex-col md:flex-row md:items-end md:justify-between gap-2">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-wide">
              RAILWAY MACHINE BREAKDOWN / FAILURE HISTORY REPORT
            </h2>
            <div className="text-xs text-slate-600 font-bold mt-1.5 flex flex-wrap items-center gap-2">
              <span>Generated: {format(new Date(), 'M/d/yyyy, h:mm:ss a')}</span>
              <span className="text-slate-300">|</span>
              <span>Total Breakdown Incidents: {filteredBreakdowns.length}</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">Break Down & Failure Official Records</span>
        </div>

        <div className="overflow-x-auto border border-slate-300 rounded-lg">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#1e293b] text-white font-bold uppercase tracking-wider text-[11px] border-b border-slate-700">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-700/60 whitespace-nowrap">SR.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">MACHINE NAME</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">COMPANY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">FAILURE SECTION / SYSTEM</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[280px]">FAILURE REASON</th>
                <th className="p-3 border-r border-slate-700/60 min-w-[260px]">PREVENTATIVE MEASURES</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap text-center">TYPE</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">FROM DATE/TIME</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">TO DATE/TIME</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">LOGGED BY</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24 whitespace-nowrap">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 11 : 10} className="p-8 text-center text-slate-400 font-medium">
                    Loading breakdown records...
                  </td>
                </tr>
              ) : paginatedBreakdowns.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 11 : 10} className="p-8 text-center text-slate-400 font-medium">
                    No breakdown/failure records match your filters.
                  </td>
                </tr>
              ) : (
                paginatedBreakdowns.map((b, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  const fromDt = formatToDDMMYYYY(b.dateTime || b.timeFrom || b.date);
                  const toDt = b.toDateTime || b.timeTo ? formatToDDMMYYYY(b.toDateTime || b.timeTo) : '-';
                  const loggedBy = formatCreatorName(b.employeeName || b.reportedBy || b.createdBy);

                  return (
                    <tr key={b.id || idx} className="hover:bg-slate-50/80 transition-colors border-b border-slate-200">
                      <td className="p-3 text-center font-bold text-slate-500 font-mono border-r border-slate-200">
                        {absoluteIndex}
                      </td>
                      <td className="p-3 font-bold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {b.machineName || '-'}
                      </td>
                      <td className="p-3 font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap">
                        {b.companyName || '-'}
                      </td>
                      <td className="p-3 font-bold text-[#b91c1c] border-r border-slate-200 whitespace-nowrap">
                        {b.breakdownSection || b.section || b.systemAffected || '-'}
                      </td>
                      <td className="p-3 text-xs leading-relaxed text-slate-800 font-medium border-r border-slate-200 min-w-[280px]">
                        {b.breakdownReason || b.reason || b.cause || '-'}
                      </td>
                      <td className="p-3 text-xs leading-relaxed text-[#047857] font-medium border-r border-slate-200 min-w-[260px]">
                        {b.preventativeMeasures || b.remedialAction || b.actionTaken || '-'}
                      </td>
                      <td className="p-3 font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-center">
                        {b.breakdownType || b.type || 'Block Time'}
                      </td>
                      <td className="p-3 font-mono font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {fromDt}
                      </td>
                      <td className="p-3 font-mono font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {toDt}
                      </td>
                      <td className="p-3 font-bold text-slate-800 border-r border-slate-200 whitespace-nowrap">
                        {loggedBy}
                      </td>
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(b)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit Record"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(b)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
          totalItems={filteredBreakdowns.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Break Down Record"
        subtitle="Master Admin Privileges"
        recordId={editModal.recordId}
        collectionName="breakdowns"
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
