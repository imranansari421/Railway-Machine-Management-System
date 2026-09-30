import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { 
  Search, 
  Download, 
  FileText, 
  Wrench, 
  Calendar, 
  Edit, 
  Trash2, 
  Eye, 
  X, 
  Clock, 
  Cpu, 
  Building2, 
  User, 
  MapPin,
  ClipboardList
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { toast } from 'sonner';

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
  userCompany?: string;
}

export default function MaintenanceReportView({ filterPerms, userMachine, userCompany }: Props) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [selectedInterval, setSelectedInterval] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // View Record Modal
  const [viewRecord, setViewRecord] = useState<any | null>(null);

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
    collectionName: 'maintenance',
    fields: [],
    initialData: {},
  });

  useEffect(() => {
    setLoading(true);
    let maintList: any[] = [];
    let schedList: any[] = [];

    const unsubM = onSnapshot(collection(db, 'maintenance'), (snap) => {
      maintList = snap.docs.map(d => ({ id: d.id, source: 'maintenance', ...d.data() }));
      combine();
    });

    const unsubS = onSnapshot(collection(db, 'schedule_maintenance'), (snap) => {
      schedList = snap.docs.map(d => ({ id: d.id, source: 'schedule_maintenance', ...d.data() }));
      combine();
    });

    function combine() {
      const combined = [...maintList, ...schedList].map(r => {
        let workDoneCombined = r.workDone || r.description || '';
        if (!workDoneCombined && Array.isArray(r.sections) && r.sections.length > 0) {
          workDoneCombined = r.sections
            .map((s: any) => `${s.title ? s.title + ': ' : ''}${s.details || ''}${s.status ? ` [${s.status}]` : ''}`)
            .filter(Boolean)
            .join('; ');
        }

        let sparesCombined = r.sparesReplaced || '';
        if (!sparesCombined && Array.isArray(r.partsUsed) && r.partsUsed.length > 0) {
          sparesCombined = r.partsUsed.map((p: any) => `${p.name || p.partNo} (${p.qty || 1} ${p.unit || 'Nos'})`).join(', ');
        }

        const assignedInterval = r.interval || r.scheduleType || r.scheduleLevel || r.maintenanceType || 'Daily Schedule';

        return {
          ...r,
          date: r.date || r.createdAt?.slice(0, 10) || '-',
          machineName: r.machineName || '-',
          companyName: r.companyName || '-',
          interval: assignedInterval,
          maintenanceType: r.maintenanceType || r.type || assignedInterval || 'General Maintenance',
          scheduleType: r.scheduleType || assignedInterval || '-',
          engineHours: r.engineHours || '-',
          tampingCounters: r.tampingCounters || r.tampingCount || '-',
          workDone: workDoneCombined || '-',
          sparesReplaced: sparesCombined || '-',
          attendedBy: (r.attendedBy || r.employeeName || '-').toUpperCase(),
          employeeName: r.employeeName || '-',
          zone: r.zone || '-',
          division: r.division || '-',
          status: r.status || 'Completed',
          remarks: r.remarks || '-',
          createdAt: r.createdAt || '',
          rawSections: Array.isArray(r.sections) ? r.sections : [],
          rawPartsUsed: Array.isArray(r.partsUsed) ? r.partsUsed : [],
        };
      });
      combined.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
      setReports(combined);
      setLoading(false);
    }

    return () => {
      unsubM();
      unsubS();
    };
  }, []);

  const machinesList = useMemo(() => {
    const set = new Set<string>();
    reports.forEach(r => { if (r.machineName) set.add(r.machineName); });
    return Array.from(set).sort();
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      if (selectedMachine !== 'all') {
        if (!r.machineName || r.machineName.trim().toLowerCase() !== selectedMachine.trim().toLowerCase()) {
          return false;
        }
      }

      if (selectedInterval !== 'all') {
        const repInterval = (r.interval || r.scheduleType || r.maintenanceType || 'Daily Schedule').trim();
        if (selectedInterval === 'Other') {
          const isStandard = ['Daily Schedule', '50 Hours', '100 Hours', '200 Hours', '250 Hours', '500 Hours', '1000 Hours'].some(val => repInterval.toLowerCase().startsWith(val.toLowerCase()));
          if (isStandard) return false;
        } else {
          if (!repInterval.toLowerCase().includes(selectedInterval.toLowerCase())) return false;
        }
      }

      if (startDate) {
        const d = r.date || r.createdAt?.slice(0, 10);
        if (d && d < startDate) return false;
      }
      if (endDate) {
        const d = r.date || r.createdAt?.slice(0, 10);
        if (d && d > endDate) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (r.machineName || '').toLowerCase().includes(q) ||
          (r.workDone || '').toLowerCase().includes(q) ||
          (r.attendedBy || '').toLowerCase().includes(q) ||
          (r.interval || '').toLowerCase().includes(q) ||
          (r.maintenanceType || '').toLowerCase().includes(q) ||
          (r.scheduleType || '').toLowerCase().includes(q) ||
          (r.remarks || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [reports, selectedMachine, selectedInterval, startDate, endDate, searchTerm]);

  // Reset page on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMachine, selectedInterval, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / pageSize));
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [filteredReports, currentPage, pageSize]);

  // Master Admin Delete
  const handleDelete = async (r: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete maintenance records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete maintenance record for "${r.machineName}" on ${r.date || 'unknown date'}? This action cannot be undone.`)) {
      return;
    }

    try {
      const col = r.source || 'maintenance';
      await deleteDoc(doc(db, col, r.id));
      toast.success('Maintenance record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit
  const handleEdit = (r: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit maintenance records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'date', label: 'Maintenance Date', type: 'date', required: true },
      { key: 'machineName', label: 'Machine Name', type: 'text', required: true },
      { key: 'interval', label: 'Maintenance Interval', type: 'select', options: ['Daily Schedule', '50 Hours', '100 Hours', '200 Hours', '250 Hours', '500 Hours', '1000 Hours', 'Other'] },
      { key: 'maintenanceType', label: 'Maintenance Type', type: 'text' },
      { key: 'scheduleType', label: 'Schedule Level', type: 'text' },
      { key: 'engineHours', label: 'Engine Hours', type: 'text' },
      { key: 'tampingCounters', label: 'Tamping Count', type: 'text' },
      { key: 'workDone', label: 'Work Done Details', type: 'textarea', required: true },
      { key: 'attendedBy', label: 'Attended By', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['Completed', 'Pending', 'In Progress'] },
      { key: 'remarks', label: 'Remarks / Notes', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: r.id,
      collectionName: r.source || 'maintenance',
      fields,
      initialData: {
        date: r.date || '',
        machineName: r.machineName || '',
        interval: r.interval || 'Daily Schedule',
        maintenanceType: r.maintenanceType || r.type || 'General',
        scheduleType: r.scheduleType || r.scheduleLevel || '',
        engineHours: r.engineHours || '',
        tampingCounters: r.tampingCounters || r.tampingCount || '',
        workDone: r.workDone || r.description || '',
        attendedBy: (r.attendedBy || r.employeeName || '').toUpperCase(),
        status: r.status || 'Completed',
        remarks: r.remarks || '',
      },
    });
  };

  const handleExportExcel = () => {
    const data = filteredReports.map((r, idx) => ({
      'S.No': idx + 1,
      'MAINTENANCE DATE': r.date || '-',
      'MACHINE NAME': r.machineName || '-',
      'COMPANY': r.companyName || '-',
      'RAILWAY ZONE': r.zone || '-',
      'RAILWAY DIVISION': r.division || '-',
      'MAINTENANCE INTERVAL': r.interval || 'Daily Schedule',
      'MAINTENANCE TYPE': r.maintenanceType || 'General Maintenance',
      'SCHEDULE / LEVEL': r.scheduleType || '-',
      'ENGINE HOURS': r.engineHours || '-',
      'TAMPING COUNTER': r.tampingCounters || '-',
      'WORK DONE DETAILS': r.workDone || '-',
      'SPARES / PARTS REPLACED': r.sparesReplaced || '-',
      'ATTENDED BY (BLOCK LETTERS)': (r.attendedBy || r.employeeName || '-').toUpperCase(),
      'LOGGED BY (EMPLOYEE)': r.employeeName || '-',
      'STATUS': r.status || 'Completed',
      'REMARKS': r.remarks || '-',
      'RECORDED AT': r.createdAt ? format(new Date(r.createdAt), 'dd-MM-yyyy HH:mm') : '-',
    }));
    exportReportToExcel(data, 'Maintenance_Records_Report');
  };

  const handleExportPdf = () => {
    const headers = ['S.No', 'Date', 'Machine', 'Company / Div', 'Interval / Schedule', 'Eng. Hrs / Count', 'Work Done Details', 'Spares Replaced', 'Attended By', 'Status'];
    const rows = filteredReports.map((r, idx) => [
      idx + 1,
      r.date || '-',
      r.machineName || '-',
      `${r.companyName || '-'}\n(${r.zone || '-'}/${r.division || '-'})`,
      `${r.interval || 'Daily Schedule'}${r.scheduleType && r.scheduleType !== '-' && r.scheduleType !== r.interval ? ` (${r.scheduleType})` : ''}`,
      `${r.engineHours !== '-' ? `${r.engineHours}h` : '-'} / ${r.tampingCounters || '-'}`,
      r.workDone || '-',
      r.sparesReplaced || '-',
      (r.attendedBy || r.employeeName || '-').toUpperCase(),
      r.status || 'Completed',
    ]);
    exportReportToPdf({
      title: 'MAINTENANCE & SERVICING RECORDS REPORT',
      subtitle: 'Complete Log of Track Machine Maintenance Operations & Schedules',
      filterSummary: `Machine: ${selectedMachine} | Interval: ${selectedInterval} | Total Records Exported: ${filteredReports.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-300 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search work done, attended by, machine..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium text-slate-800"
            />
          </div>

          {/* Machine Filter */}
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            disabled={!filterPerms.canChangeMachine}
            className={`px-3 py-2 text-xs rounded-xl border border-slate-300 font-semibold shadow-xs ${
              !filterPerms.canChangeMachine ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 text-slate-800 cursor-pointer'
            }`}
          >
            <option value="all">All Machines</option>
            {machinesList.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Maintenance Interval Filter */}
          <select
            value={selectedInterval}
            onChange={(e) => setSelectedInterval(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-xs cursor-pointer"
          >
            <option value="all">All Intervals</option>
            <option value="Daily Schedule">Daily Schedule</option>
            <option value="50 Hours">50 Hours</option>
            <option value="100 Hours">100 Hours</option>
            <option value="200 Hours">200 Hours</option>
            <option value="250 Hours">250 Hours</option>
            <option value="500 Hours">500 Hours</option>
            <option value="1000 Hours">1000 Hours</option>
            <option value="Other">Other Interval</option>
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-xl px-2 py-1">
            <Calendar size={13} className="text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-700 cursor-pointer"
              title="From Date"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-700 cursor-pointer"
              title="To Date"
            />
          </div>

          {(searchTerm || selectedMachine !== (userMachine || 'all') || selectedInterval !== 'all' || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                if (filterPerms.canChangeMachine) setSelectedMachine('all');
                setSelectedInterval('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={handleExportExcel}
            title={`Export complete data of all ${filteredReports.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredReports.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400 cursor-pointer"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Records Table with Visible Lines and Enhanced Fonts */}
      <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50 border-b border-slate-300 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-indigo-600" />
            <h3 className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
              Maintenance Records Ledger ({filteredReports.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-600 font-semibold">Track Machine Servicing & Scheduled Maintenance</span>
        </div>

        <div className="overflow-x-auto border-x-0 border-b border-slate-300">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 text-slate-800 font-extrabold uppercase tracking-wider text-[11px] border-b border-slate-300 select-none">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-300">#</th>
                <th className="p-3 border-r border-slate-300 whitespace-nowrap">Date</th>
                <th className="p-3 border-r border-slate-300">Machine</th>
                <th className="p-3 border-r border-slate-300">Interval / Schedule</th>
                <th className="p-3 border-r border-slate-300">Eng. Hrs / Count</th>
                <th className="p-3 border-r border-slate-300">Work Done Details</th>
                <th className="p-3 border-r border-slate-300">Attended By</th>
                <th className="p-3 border-r border-slate-300 text-center">Status</th>
                <th className="p-3 border-r border-slate-300">Remarks</th>
                <th className="p-3 text-center w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                    Loading maintenance records...
                  </td>
                </tr>
              ) : paginatedReports.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                    No maintenance records match your filters.
                  </td>
                </tr>
              ) : (
                paginatedReports.map((r, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={r.id || idx} className="hover:bg-indigo-50/40 even:bg-slate-50/50 transition-colors">
                      <td className="p-2.5 text-center font-bold text-slate-500 border-r border-slate-300 font-mono text-[11px]">
                        {absoluteIndex}
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-slate-700 font-medium font-mono text-[11px] border-r border-slate-300">
                        {r.date || '-'}
                      </td>
                      <td className="p-2.5 font-mono font-bold text-indigo-700 text-xs border-r border-slate-300">
                        {r.machineName}
                      </td>
                      <td className="p-2.5 border-r border-slate-300">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200 inline-flex items-center gap-1 shadow-2xs">
                          <Clock size={10} className="text-teal-600 shrink-0" />
                          <span>{r.interval || r.scheduleType || 'Daily Schedule'}</span>
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-700 font-mono text-[11px] border-r border-slate-300 font-semibold whitespace-nowrap">
                        {r.engineHours && r.engineHours !== '-' ? `${r.engineHours}h` : '-'}
                        {r.tampingCounters && r.tampingCounters !== '-' ? ` / ${r.tampingCounters}` : ''}
                      </td>
                      <td className="p-2.5 text-slate-800 max-w-sm font-medium border-r border-slate-300 text-xs" title={r.workDone || r.description}>
                        <span className="line-clamp-2 leading-relaxed">{r.workDone || r.description || '-'}</span>
                      </td>
                      <td className="p-2.5 font-bold text-slate-900 uppercase tracking-wide text-[11px] border-r border-slate-300 whitespace-nowrap">
                        {(r.attendedBy || r.employeeName || '-').toUpperCase()}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 text-center whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
                          {r.status || 'Recorded'}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-600 italic max-w-xs border-r border-slate-300 text-[11px]" title={r.remarks}>
                        <span className="line-clamp-1">{r.remarks || '-'}</span>
                      </td>
                      <td className="p-2.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Eye button for row data view */}
                          <button
                            onClick={() => setViewRecord(r)}
                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 bg-blue-50/70 shadow-2xs cursor-pointer"
                            title="View Full Record Details"
                          >
                            <Eye size={14} />
                          </button>

                          {/* Master Admin Actions */}
                          {filterPerms.isFullAdmin && (
                            <>
                              <button
                                onClick={() => handleEdit(r)}
                                className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200 bg-indigo-50/70 shadow-2xs cursor-pointer"
                                title="Edit Record"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(r)}
                                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-100 rounded-lg transition-colors border border-rose-200 bg-rose-50/70 shadow-2xs cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
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
          totalItems={filteredReports.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* View Record Details Modal */}
      <AnimatePresence>
        {viewRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black backdrop-blur-xs cursor-pointer"
              onClick={() => setViewRecord(null)}
            />
            
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10 flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-indigo-50/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
                    <Wrench size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight">
                      Maintenance Record Details
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Machine: <strong className="text-indigo-700 font-mono">{viewRecord.machineName}</strong> • Date: <strong className="text-slate-700">{viewRecord.date}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewRecord(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-5 text-xs">
                {/* Meta Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50/80 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Machine</span>
                    <span className="font-mono font-black text-indigo-700 text-sm flex items-center gap-1.5">
                      <Cpu size={13} className="text-indigo-500" />
                      {viewRecord.machineName}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Company</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-500" />
                      {viewRecord.companyName || '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Zone / Division</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <MapPin size={13} className="text-slate-500" />
                      {viewRecord.zone || '-'}/{viewRecord.division || '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Maintenance Date</span>
                    <span className="font-mono font-bold text-slate-800 flex items-center gap-1.5">
                      <Calendar size={13} className="text-slate-500" />
                      {viewRecord.date || '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Interval / Schedule</span>
                    <span className="font-bold text-teal-700 flex items-center gap-1.5">
                      <Clock size={13} className="text-teal-600" />
                      {viewRecord.interval || viewRecord.scheduleType || 'Daily Schedule'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Status</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 inline-block">
                      {viewRecord.status || 'Completed'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Engine Hours</span>
                    <span className="font-mono font-bold text-slate-800">
                      {viewRecord.engineHours && viewRecord.engineHours !== '-' ? `${viewRecord.engineHours} hrs` : '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Tamping Counter</span>
                    <span className="font-mono font-bold text-slate-800">
                      {viewRecord.tampingCounters || '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Attended By</span>
                    <span className="font-black text-slate-900 uppercase">
                      {(viewRecord.attendedBy || viewRecord.employeeName || '-').toUpperCase()}
                    </span>
                  </div>

                  <div className="sm:col-span-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Logged By</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User size={13} className="text-slate-500" />
                      {viewRecord.employeeName || '-'}
                      {viewRecord.createdAt && (
                        <span className="text-[11px] font-normal text-slate-400 font-mono ml-2">
                          (Recorded: {format(new Date(viewRecord.createdAt), 'dd-MM-yyyy HH:mm')})
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Work Done Details */}
                <div className="space-y-2">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ClipboardList size={14} className="text-indigo-600" />
                    Work Done Details & Observations
                  </span>
                  {viewRecord.rawSections && viewRecord.rawSections.length > 0 ? (
                    <div className="space-y-2">
                      {viewRecord.rawSections.map((sec: any, idx: number) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-slate-800 text-xs">{sec.title || `Section ${idx + 1}`}</span>
                            {sec.status && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                                {sec.status}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-700 text-xs font-medium whitespace-pre-wrap">{sec.details || '-'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-slate-800 font-medium whitespace-pre-wrap text-xs leading-relaxed">
                      {viewRecord.workDone || viewRecord.description || 'No work details specified.'}
                    </div>
                  )}
                </div>

                {/* Spares / Parts Replaced */}
                {(viewRecord.sparesReplaced !== '-' || (viewRecord.rawPartsUsed && viewRecord.rawPartsUsed.length > 0)) && (
                  <div className="space-y-2">
                    <span className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Wrench size={14} className="text-teal-600" />
                      Spares / Parts Replaced
                    </span>
                    <div className="p-3.5 bg-teal-50/40 rounded-2xl border border-teal-200/80 text-teal-950 font-medium text-xs leading-relaxed">
                      {viewRecord.sparesReplaced || '-'}
                    </div>
                  </div>
                )}

                {/* Remarks */}
                {viewRecord.remarks && viewRecord.remarks !== '-' && (
                  <div className="space-y-2">
                    <span className="text-xs font-black text-slate-900 uppercase tracking-wider block">
                      Remarks / Notes
                    </span>
                    <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/70 text-slate-700 italic text-xs font-medium">
                      "{viewRecord.remarks}"
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
                {filterPerms.isFullAdmin && (
                  <button
                    onClick={() => {
                      const rec = viewRecord;
                      setViewRecord(null);
                      handleEdit(rec);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Edit size={13} />
                    Edit Record
                  </button>
                )}
                <button
                  onClick={() => setViewRecord(null)}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl font-bold text-xs transition-all shadow-xs cursor-pointer"
                >
                  Close View
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Maintenance Record"
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
