import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Download, FileText, Users, Edit, Trash2, Cpu } from 'lucide-react';
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
  userZone?: string;
  userDivision?: string;
}

const getEmployeeExitDate = (emp: any): string => {
  return emp?.doe || emp?.leftDate || emp?.exitDate || emp?.dateOfExit || emp?.resignationDate || '';
};

export default function HRReportView({
  filterPerms,
  userCompany,
  userMachine,
  userZone,
  userDivision,
}: Props) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState<'all' | 'current' | 'left'>('all');

  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [selectedCompany, setSelectedCompany] = useState(() => {
    return filterPerms.isFullAdmin ? 'all' : (userCompany || 'all');
  });
  const [selectedZone, setSelectedZone] = useState(() => userZone || 'all');
  const [selectedDivision, setSelectedDivision] = useState(() => userDivision || 'all');

  // 10 Rows per page pagination
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
    const unsub = onSnapshot(collection(db, 'employees'), (snap) => {
      const list: any[] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setEmployees(list);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const companiesList = useMemo(() => {
    const cs = new Set<string>();
    employees.forEach(e => { if (e.companyName) cs.add(e.companyName); });
    return Array.from(cs).sort();
  }, [employees]);

  const machinesList = useMemo(() => {
    const ms = new Set<string>();
    employees.forEach(e => { if (e.machineName) ms.add(e.machineName); });
    return Array.from(ms).sort();
  }, [employees]);

  // Filter employees
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      // 1. Employment Status Radio filter
      const exitDt = getEmployeeExitDate(emp);
      const isLeft = Boolean(
        emp.status === 'left' ||
        emp.status === 'resigned' ||
        emp.status === 'inactive' ||
        exitDt
      );

      if (employmentFilter === 'current' && isLeft) return false;
      if (employmentFilter === 'left' && !isLeft) return false;

      // 2. Machine Filter
      if (selectedMachine !== 'all') {
        if (!emp.machineName || emp.machineName.trim().toLowerCase() !== selectedMachine.trim().toLowerCase()) {
          return false;
        }
      }

      // 3. Company Filter
      if (selectedCompany !== 'all') {
        if (!emp.companyName || emp.companyName.trim().toLowerCase() !== selectedCompany.trim().toLowerCase()) {
          return false;
        }
      }

      // 4. Zone Filter
      if (selectedZone !== 'all') {
        if (!emp.zone || emp.zone.trim().toLowerCase() !== selectedZone.trim().toLowerCase()) {
          return false;
        }
      }

      // 5. Division Filter
      if (selectedDivision !== 'all') {
        if (!emp.division || emp.division.trim().toLowerCase() !== selectedDivision.trim().toLowerCase()) {
          return false;
        }
      }

      // 6. Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (emp.name || '').toLowerCase().includes(q) ||
          (emp.designation || '').toLowerCase().includes(q) ||
          (emp.pfNo || '').toLowerCase().includes(q) ||
          (emp.employeeId || '').toLowerCase().includes(q) ||
          (emp.mobile || '').toLowerCase().includes(q) ||
          (emp.machineName || '').toLowerCase().includes(q) ||
          (emp.companyName || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [employees, employmentFilter, selectedMachine, selectedCompany, selectedZone, selectedDivision, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [employmentFilter, selectedMachine, selectedCompany, selectedZone, selectedDivision, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, currentPage, pageSize]);

  // Counts for 3 radio buttons
  const counts = useMemo(() => {
    let curr = 0;
    let left = 0;
    employees.forEach(e => {
      const exitDt = getEmployeeExitDate(e);
      const isL = Boolean(
        e.status === 'left' ||
        e.status === 'resigned' ||
        e.status === 'inactive' ||
        exitDt
      );
      if (isL) left++;
      else curr++;
    });
    return { all: employees.length, current: curr, left };
  }, [employees]);

  // Master Admin Delete Action
  const handleDelete = async (emp: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can delete employee records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete employee "${emp.name}" (${emp.designation || 'Staff'})? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'employees', emp.id));
      toast.success('Employee record deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete employee: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit Action
  const handleEdit = (emp: any) => {
    if (!filterPerms.isFullAdmin) {
      toast.error('Only Master Admin can edit employee records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'name', label: 'Employee Name', type: 'text', required: true },
      { key: 'designation', label: 'Designation', type: 'text', required: true },
      { key: 'machineName', label: 'Assigned Machine', type: 'text' },
      { key: 'companyName', label: 'Company Name', type: 'text' },
      { key: 'mobile', label: 'Mobile No', type: 'text' },
      { key: 'pfNo', label: 'PF / ID No', type: 'text' },
      { key: 'status', label: 'Employment Status', type: 'select', options: ['active', 'left'], required: true },
      { key: 'doj', label: 'Joining Date (DOJ)', type: 'date' },
      { key: 'leftDate', label: 'Left Date / Exit Date (DOE)', type: 'date' },
      { key: 'zone', label: 'Railway Zone', type: 'text' },
      { key: 'division', label: 'Railway Division', type: 'text' },
    ];

    setEditModal({
      isOpen: true,
      recordId: emp.id,
      fields,
      initialData: {
        name: emp.name || '',
        designation: emp.designation || '',
        machineName: emp.machineName || '',
        companyName: emp.companyName || '',
        mobile: emp.mobile || '',
        pfNo: emp.pfNo || emp.employeeId || '',
        status: emp.status === 'left' ? 'left' : 'active',
        doj: emp.doj || emp.joiningDate || '',
        leftDate: getEmployeeExitDate(emp),
        zone: emp.zone || '',
        division: emp.division || '',
      },
    });
  };

  const handleExportExcel = () => {
    const excelData = filteredEmployees.map((emp, idx) => {
      const exitDt = getEmployeeExitDate(emp);
      const isLeft = Boolean(
        emp.status === 'left' ||
        emp.status === 'resigned' ||
        emp.status === 'inactive' ||
        exitDt
      );
      return {
        'S.No': idx + 1,
        'MACHINE': emp.machineName || 'Unassigned',
        'EMPLOYEE NAME': emp.name,
        'DESIGNATION': emp.designation || '-',
        'PF / EMP ID': emp.pfNo || emp.employeeId || '-',
        'MOBILE': emp.mobile || '-',
        'EMAIL': emp.email || '-',
        'COMPANY': emp.companyName || '-',
        'RAILWAY ZONE': emp.zone || '-',
        'RAILWAY DIVISION': emp.division || '-',
        'DATE OF JOINING (DOJ)': emp.doj || emp.joiningDate || '-',
        'LEFT / EXIT DATE (DOE)': exitDt || (isLeft ? 'Left' : '-'),
        'EMPLOYMENT STATUS': isLeft ? 'Left Employee' : 'Current Active',
        'REMARKS / REASON OF LEAVING': emp.remarks || emp.reasonOfLeaving || '-',
        'RECORDED AT': emp.createdAt ? format(new Date(emp.createdAt), 'dd-MM-yyyy HH:mm') : '-',
      };
    });
    exportReportToExcel(excelData, `HR_Report_${employmentFilter.toUpperCase()}`);
  };

  const handleExportPdf = () => {
    const headers = ['S.No', 'Machine', 'Employee Name', 'Designation', 'PF / ID', 'Mobile', 'Company', 'Zone/Div', 'DOJ', 'Left / Exit Date', 'Status', 'Remarks'];
    const rows = filteredEmployees.map((emp, idx) => {
      const exitDt = getEmployeeExitDate(emp);
      const isLeft = Boolean(
        emp.status === 'left' ||
        emp.status === 'resigned' ||
        emp.status === 'inactive' ||
        exitDt
      );
      return [
        idx + 1,
        emp.machineName || 'Unassigned',
        emp.name || '-',
        emp.designation || '-',
        emp.pfNo || emp.employeeId || '-',
        emp.mobile || '-',
        emp.companyName || '-',
        `${emp.zone || '-'}/${emp.division || '-'}`,
        emp.doj || emp.joiningDate || '-',
        exitDt || (isLeft ? 'Left' : '-'),
        isLeft ? 'Left' : 'Active',
        emp.remarks || emp.reasonOfLeaving || '-',
      ];
    });
    exportReportToPdf({
      title: 'HUMAN RESOURCES (HR) REPORT',
      subtitle: `Machine-Wise Roster (${employmentFilter.toUpperCase()} EMPLOYEES)`,
      filterSummary: `Category: ${employmentFilter.toUpperCase()} | Machine: ${selectedMachine} | Company: ${selectedCompany} | Total Records Exported: ${filteredEmployees.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* 3 Radio Buttons Header Banner */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* 3 Radio Buttons */}
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl w-full md:w-auto">
          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
            employmentFilter === 'all'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}>
            <input
              type="radio"
              name="employmentStatus"
              value="all"
              checked={employmentFilter === 'all'}
              onChange={() => setEmploymentFilter('all')}
              className="sr-only"
            />
            <span>All Employees</span>
          </label>

          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
            employmentFilter === 'current'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}>
            <input
              type="radio"
              name="employmentStatus"
              value="current"
              checked={employmentFilter === 'current'}
              onChange={() => setEmploymentFilter('current')}
              className="sr-only"
            />
            <span>Current Employees</span>
          </label>

          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
            employmentFilter === 'left'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}>
            <input
              type="radio"
              name="employmentStatus"
              value="left"
              checked={employmentFilter === 'left'}
              onChange={() => setEmploymentFilter('left')}
              className="sr-only"
            />
            <span>Left Employees</span>
          </label>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={handleExportExcel}
            title={`Export complete roster of all ${filteredEmployees.length} employees to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete roster of all ${filteredEmployees.length} employees to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Account-based Filters Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-2.5 items-center">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search employee, PF no, mobile, designation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium"
          />
        </div>

        {/* Machine Filter */}
        <div className="flex items-center gap-1">
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
        </div>

        {/* Company Filter */}
        <div className="flex items-center gap-1">
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
        </div>

        {/* Reset */}
        {(searchTerm || selectedMachine !== (userMachine || 'all') || selectedCompany !== (filterPerms.isFullAdmin ? 'all' : (userCompany || 'all'))) && (
          <button
            onClick={() => {
              setSearchTerm('');
              if (filterPerms.canChangeMachine) setSelectedMachine('all');
              if (filterPerms.isFullAdmin) setSelectedCompany('all');
            }}
            className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold"
          >
            Reset
          </button>
        )}
      </div>

      {/* Employees Table Display (10 Rows per Page) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
              Human Resources (HR) Ledger ({filteredEmployees.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Status: {employmentFilter === 'all' ? 'All Records' : employmentFilter === 'current' ? 'Active Staff' : 'Ex-Employees'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/75 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-3 text-center w-12">#</th>
                <th className="p-3">Machine</th>
                <th className="p-3">Employee Name</th>
                <th className="p-3">Designation</th>
                <th className="p-3">PF / Employee ID</th>
                <th className="p-3">Contact No</th>
                <th className="p-3">Company</th>
                <th className="p-3">Zone / Div</th>
                <th className="p-3">Joining Date (DOJ)</th>
                <th className="p-3">Left Date / Exit Date</th>
                <th className="p-3">Status</th>
                {filterPerms.isFullAdmin && <th className="p-3 text-center w-24">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 12 : 11} className="p-8 text-center text-slate-400 font-medium">
                    Loading employee roster...
                  </td>
                </tr>
              ) : paginatedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={filterPerms.isFullAdmin ? 12 : 11} className="p-8 text-center text-slate-400 font-medium">
                    No employee records match your criteria.
                  </td>
                </tr>
              ) : (
                paginatedEmployees.map((emp, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  const exitDt = getEmployeeExitDate(emp);
                  const isLeft = Boolean(emp.status === 'left' || emp.status === 'resigned' || emp.status === 'inactive' || exitDt);
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-400">{absoluteIndex}</td>
                      <td className="p-3 font-semibold text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Cpu size={14} className="text-amber-500 shrink-0" />
                          <span>{emp.machineName || 'Unassigned'}</span>
                        </div>
                      </td>
                      <td className="p-3 font-bold text-slate-800">
                        {emp.name}
                      </td>
                      <td className="p-3 font-semibold text-slate-600">
                        {emp.designation || '-'}
                      </td>
                      <td className="p-3 font-mono font-medium text-slate-700">
                        {emp.pfNo || emp.employeeId || '-'}
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        {emp.mobile || '-'}
                      </td>
                      <td className="p-3 text-slate-700">
                        {emp.companyName || '-'}
                      </td>
                      <td className="p-3 text-slate-600">
                        {emp.zone || emp.division ? `${emp.zone || '-'}/${emp.division || '-'}` : '-'}
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {emp.doj || emp.joiningDate || '-'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {exitDt ? (
                          <span className="font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                            {exitDt}
                          </span>
                        ) : isLeft ? (
                          <span className="text-rose-500 font-medium italic text-[11px]">Left (Date not set)</span>
                        ) : (
                          <span className="text-slate-400 font-mono">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isLeft ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {isLeft ? 'Left' : 'Current'}
                        </span>
                      </td>
                      {filterPerms.isFullAdmin && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleEdit(emp)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit Employee"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(emp)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Employee"
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

        {/* 10 Rows Pagination with Preview & Next buttons */}
        <ReportPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredEmployees.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Edit Employee Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title="Edit Employee Record"
        subtitle="Master Admin Privileges"
        recordId={editModal.recordId}
        collectionName="employees"
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
