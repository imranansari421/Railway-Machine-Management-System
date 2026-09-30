import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Download, FileText, ArrowRightLeft, Calendar, Edit, Trash2 } from 'lucide-react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { format } from 'date-fns';
import { FilterAccessPermissions } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { toast } from 'sonner';

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
  userZone?: string;
  userDivision?: string;
}

const formatToDDMMYYYY = (dateStr?: string) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

const calculateDuration = (fromStr?: string, toStr?: string): string => {
  if (!fromStr || !toStr) return '-';
  const start = new Date(fromStr);
  const end = new Date(toStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
  const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (diffHours < 0) return '-';
  const hours = (Math.round(diffHours * 10) / 10).toFixed(1);
  return `${hours} hrs`;
};

const formatCreatorName = (name?: string, email?: string): string => {
  const val = name || email;
  if (!val) return 'Admin';
  const trimmed = val.trim();
  if (trimmed.endsWith('@billedapp.com') || trimmed.toLowerCase() === 'admin' || trimmed.toLowerCase() === 'master') {
    return 'Admin';
  }
  return trimmed.replace('@employee.billedapp.com', '');
};

const formatZoneDiv = (zone?: string, div?: string): string => {
  const cleanZone = zone && zone !== '-' ? zone.trim() : '';
  const cleanDiv = div && div !== '-' ? div.trim() : '';
  if (cleanZone && cleanDiv) {
    return `${cleanZone} / ${cleanDiv}`;
  }
  if (cleanZone) return cleanZone;
  if (cleanDiv) return cleanDiv;
  return '-';
};

export default function MachineMovementReportView({ filterPerms, userMachine, userZone, userDivision }: Props) {
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 10 rows per page
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Edit Modal
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
    const unsub = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list: any[] = snap.docs.map(d => {
        const m = d.data();
        const rawFrom = m.fromDateTime || m.departureTime || '';
        const rawTo = m.toDateTime || m.arrivalTime || '';
        const dateOnly = (rawFrom || m.date || m.movementDate || m.createdAt || '').slice(0, 10);
        const fromLoc = m.fromType || m.fromStation || m.fromLocation || '-';
        const toLoc = m.toType || m.toStation || m.toLocation || '-';

        return {
          id: d.id,
          ...m,
          rawFromDateTime: rawFrom,
          rawToDateTime: rawTo,
          date: dateOnly,
          fromDateTime: rawFrom,
          toDateTime: rawTo,
          fromLocation: fromLoc,
          toLocation: toLoc,
          machineName: m.machineName || '-',
          companyName: m.companyName || '-',
          fromZone: m.fromZone || '-',
          fromDivision: m.fromDivision || '-',
          toZone: m.toZone || '-',
          toDivision: m.toDivision || '-',
          purpose: m.purpose || `${fromLoc} → ${toLoc}`,
          trainNo: m.trainNo || m.bpcNo || m.authorityNo || '-',
          operatorName: m.driverName || m.operatorName || m.employeeName || 'Operator',
          submittedBy: m.submittedBy || m.employeeName || m.createdBy || '-',
          remarks: m.remarks || '-',
          createdAt: m.createdAt || '',
        };
      });
      list.sort((a: any, b: any) => new Date(b.rawFromDateTime || b.date || b.createdAt || 0).getTime() - new Date(a.rawFromDateTime || a.date || a.createdAt || 0).getTime());
      setMovements(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const machinesList = useMemo(() => {
    const set = new Set<string>();
    movements.forEach(m => { if (m.machineName) set.add(m.machineName); });
    return Array.from(set).sort();
  }, [movements]);

  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      if (selectedMachine !== 'all') {
        if (!m.machineName || m.machineName.trim().toLowerCase() !== selectedMachine.trim().toLowerCase()) {
          return false;
        }
      }

      if (startDate) {
        const d = m.date || m.movementDate || m.createdAt?.slice(0, 10);
        if (d && d < startDate) return false;
      }
      if (endDate) {
        const d = m.date || m.movementDate || m.createdAt?.slice(0, 10);
        if (d && d > endDate) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (m.machineName || '').toLowerCase().includes(q) ||
          (m.fromStation || '').toLowerCase().includes(q) ||
          (m.toStation || '').toLowerCase().includes(q) ||
          (m.fromDivision || '').toLowerCase().includes(q) ||
          (m.toDivision || '').toLowerCase().includes(q) ||
          (m.purpose || '').toLowerCase().includes(q) ||
          (m.trainNo || '').toLowerCase().includes(q) ||
          (m.driverName || m.operatorName || '').toLowerCase().includes(q) ||
          (m.submittedBy || m.employeeName || '').toLowerCase().includes(q) ||
          (m.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [movements, selectedMachine, startDate, endDate, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMachine, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / pageSize));
  const paginatedMovements = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMovements.slice(start, start + pageSize);
  }, [filteredMovements, currentPage, pageSize]);

  // Master Admin Delete
  const handleDelete = async (m: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete movement records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete movement record for "${m.machineName}" (${m.fromStation} → ${m.toStation})? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'machine_movements', m.id));
      toast.success('Movement record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete movement record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (m: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit movement records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'machineName', label: 'Machine Name', type: 'text', required: true },
      { key: 'companyName', label: 'Company Name', type: 'text' },
      { key: 'fromDateTime', label: 'From Date/Time', type: 'datetime-local', required: true },
      { key: 'toDateTime', label: 'To Date/Time', type: 'datetime-local', required: true },
      { key: 'fromZone', label: 'From Zone', type: 'text' },
      { key: 'fromDivision', label: 'From Division', type: 'text' },
      { key: 'toZone', label: 'To Zone', type: 'text' },
      { key: 'toDivision', label: 'To Division', type: 'text' },
      { key: 'fromType', label: 'From Location (FROM LOC.)', type: 'text' },
      { key: 'toType', label: 'To Location (TO LOC.)', type: 'text' },
      { key: 'employeeName', label: 'Logged By', type: 'text' },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: m.id,
      fields,
      initialData: {
        machineName: m.machineName || '',
        companyName: m.companyName || '',
        fromDateTime: m.rawFromDateTime || m.fromDateTime || '',
        toDateTime: m.rawToDateTime || m.toDateTime || '',
        fromZone: m.fromZone || '',
        fromDivision: m.fromDivision || '',
        toZone: m.toZone || '',
        toDivision: m.toDivision || '',
        fromType: m.fromLocation !== '-' ? m.fromLocation : (m.fromType || m.fromStation || ''),
        toType: m.toLocation !== '-' ? m.toLocation : (m.toType || m.toStation || ''),
        employeeName: m.employeeName || m.submittedBy || '',
        remarks: m.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredMovements.map((m, idx) => {
      const fromDtFormatted = formatToDDMMYYYY(m.rawFromDateTime || m.fromDateTime);
      const toDtFormatted = formatToDDMMYYYY(m.rawToDateTime || m.toDateTime);
      const duration = calculateDuration(m.rawFromDateTime || m.fromDateTime, m.rawToDateTime || m.toDateTime);
      return {
        'SR.': idx + 1,
        'MACHINE NAME': m.machineName || '-',
        'COMPANY': m.companyName || '-',
        'FROM DATE/TIME': fromDtFormatted,
        'TO DATE/TIME': toDtFormatted,
        'FROM (ZONE / DIV)': formatZoneDiv(m.fromZone, m.fromDivision),
        'TO (ZONE / DIV)': formatZoneDiv(m.toZone, m.toDivision),
        'FROM LOC.': m.fromLocation || '-',
        'TO LOC.': m.toLocation || '-',
        'DURATION': duration,
        'LOGGED BY': formatCreatorName(m.submittedBy || m.employeeName),
        'REMARKS': m.remarks || '-',
        'RECORDED AT': m.createdAt ? format(new Date(m.createdAt), 'dd-MM-yyyy HH:mm') : '-',
      };
    });
    exportReportToExcel(data, 'Machine_Movement_Report');
  };

  const handleExportPdf = () => {
    const headers = [
      'SR.',
      'MACHINE NAME',
      'COMPANY',
      'FROM DATE/TIME',
      'TO DATE/TIME',
      'FROM (ZONE / DIV)',
      'TO (ZONE / DIV)',
      'FROM LOC.',
      'TO LOC.',
      'DURATION',
      'LOGGED BY',
    ];
    const rows = filteredMovements.map((m, idx) => [
      idx + 1,
      m.machineName || '-',
      m.companyName || '-',
      formatToDDMMYYYY(m.rawFromDateTime || m.fromDateTime),
      formatToDDMMYYYY(m.rawToDateTime || m.toDateTime),
      formatZoneDiv(m.fromZone, m.fromDivision),
      formatZoneDiv(m.toZone, m.toDivision),
      m.fromLocation || '-',
      m.toLocation || '-',
      calculateDuration(m.rawFromDateTime || m.fromDateTime, m.rawToDateTime || m.toDateTime),
      formatCreatorName(m.submittedBy || m.employeeName),
    ]);
    exportReportToPdf({
      title: 'MACHINE MOVEMENT REPORT',
      subtitle: 'Complete Machine Movement History & Transit Records',
      filterSummary: `Machine: ${selectedMachine} | Records Exported: ${filteredMovements.length}`,
      headers,
      rows,
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
              placeholder="Search station, division, machine..."
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
            title={`Export complete data of all ${filteredMovements.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredMovements.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Movement Table - Matching exact thead and columns from image.png */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Submitted Machine Movements Ledger ({filteredMovements.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">Recorded from Machine Movement module</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#1e293b] text-white font-bold uppercase tracking-wider text-[11px] border-b border-slate-700">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-700/60">SR.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">MACHINE NAME</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">COMPANY</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">FROM DATE/TIME</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">TO DATE/TIME</th>
                <th className="p-3 border-r border-slate-700/60">FROM (ZONE / DIV)</th>
                <th className="p-3 border-r border-slate-700/60">TO (ZONE / DIV)</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">FROM LOC.</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">TO LOC.</th>
                <th className="p-3 border-r border-slate-700/60 text-right whitespace-nowrap">DURATION</th>
                <th className="p-3 border-r border-slate-700/60 whitespace-nowrap">LOGGED BY</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24 whitespace-nowrap">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 12 : 11} className="p-8 text-center text-slate-400 font-medium">
                    Loading machine movements...
                  </td>
                </tr>
              ) : paginatedMovements.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 12 : 11} className="p-8 text-center text-slate-400 font-medium">
                    No machine movements match the criteria.
                  </td>
                </tr>
              ) : (
                paginatedMovements.map((m, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  const fromDtFormatted = formatToDDMMYYYY(m.rawFromDateTime || m.fromDateTime);
                  const toDtFormatted = formatToDDMMYYYY(m.rawToDateTime || m.toDateTime);
                  const duration = calculateDuration(m.rawFromDateTime || m.fromDateTime, m.rawToDateTime || m.toDateTime);
                  const fromZoneDiv = formatZoneDiv(m.fromZone, m.fromDivision);
                  const toZoneDiv = formatZoneDiv(m.toZone, m.toDivision);
                  const loggedBy = formatCreatorName(m.submittedBy || m.employeeName);

                  return (
                    <tr key={m.id || idx} className="hover:bg-slate-50/80 transition-colors border-b border-slate-200">
                      <td className="p-3 text-center font-bold text-slate-500 font-mono border-r border-slate-200">
                        {absoluteIndex}
                      </td>
                      <td className="p-3 font-bold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {m.machineName}
                      </td>
                      <td className="p-3 font-medium text-slate-800 border-r border-slate-200 whitespace-nowrap">
                        {m.companyName || '-'}
                      </td>
                      <td className="p-3 font-mono font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {fromDtFormatted}
                      </td>
                      <td className="p-3 font-mono font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {toDtFormatted}
                      </td>
                      <td className="p-3 text-slate-700 border-r border-slate-200 text-xs">
                        {fromZoneDiv}
                      </td>
                      <td className="p-3 text-slate-700 border-r border-slate-200 text-xs">
                        {toZoneDiv}
                      </td>
                      <td className="p-3 font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {m.fromLocation || '-'}
                      </td>
                      <td className="p-3 font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap text-xs">
                        {m.toLocation || '-'}
                      </td>
                      <td className="p-3 font-mono font-bold text-indigo-700 text-right pr-4 border-r border-slate-200 whitespace-nowrap text-xs">
                        {duration}
                      </td>
                      <td className="p-3 font-medium text-slate-700 border-r border-slate-200 whitespace-nowrap">
                        {loggedBy}
                      </td>
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(m)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit Movement"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(m)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Movement"
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
          totalItems={filteredMovements.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Machine Movement"
        subtitle="Master Admin Privileges"
        recordId={editModal.recordId}
        collectionName="machine_movements"
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
