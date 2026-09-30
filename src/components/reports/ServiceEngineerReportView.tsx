import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Search,
  Download,
  FileText,
  Calendar,
  Eye,
  X,
  Printer,
  Building2,
  UserCircle,
  Wrench,
  Clock,
  ShieldCheck,
  Radio,
  FileSpreadsheet,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

export interface ServiceEngineerRecord {
  id: string;
  fromVisitDateTime: string;
  toVisitDateTime: string;
  companyName: string;
  engineerName: string;
  engineerCompanyName?: string;
  engineerCompanyType?: string;
  visitReason: string;
  description: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  machineName?: string;
  zoneName?: string;
  divisionName?: string;
  engineName?: string;
  engineHours?: string;
  engines?: Array<{ name: string; hours: string }>;
}

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
  userCompany?: string;
  userZone?: string;
  userDivision?: string;
}

const formatToDDMMYYYY = (dateStr: string | undefined | null) => {
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

const formatCreatorName = (name: string | undefined | null) => {
  if (!name) return 'Admin';
  const trimmed = name.trim();
  if (trimmed.endsWith('@billedapp.com') || trimmed.toLowerCase() === 'admin' || trimmed.toLowerCase() === 'master') {
    return 'Admin';
  }
  if (trimmed.endsWith('@employee.billedapp.com')) {
    return trimmed.split('@')[0];
  }
  return trimmed;
};

const escapeHtml = (unsafe: string = '') => {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export default function ServiceEngineerReportView({
  filterPerms,
  userMachine,
  userCompany,
  userZone,
  userDivision,
}: Props) {
  const [records, setRecords] = useState<ServiceEngineerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters - default to 'all' so that the complete data table is visible immediately
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedZone, setSelectedZone] = useState('all');
  const [selectedDivision, setSelectedDivision] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // View Record Modal
  const [viewRecord, setViewRecord] = useState<ServiceEngineerRecord | null>(null);

  // Synchronize Service Engineer records in real time
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, 'service_engineer_reports'),
      (snap) => {
        const list: ServiceEngineerRecord[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            fromVisitDateTime: data.fromVisitDateTime || '',
            toVisitDateTime: data.toVisitDateTime || '',
            companyName: data.companyName || '',
            engineerName: data.engineerName || '',
            engineerCompanyName: data.engineerCompanyName || '',
            engineerCompanyType: data.engineerCompanyType || 'OEM',
            visitReason: data.visitReason || '',
            description: data.description || '',
            createdAt: data.createdAt || '',
            createdBy: data.createdBy || '',
            createdByName: data.createdByName || '',
            machineName: data.machineName || '',
            zoneName: data.zoneName || '',
            divisionName: data.divisionName || '',
            engineName: data.engineName || '',
            engineHours: data.engineHours || '',
            engines: data.engines || [],
          });
        });

        // Sort latest first
        list.sort((a, b) => {
          const dateA = a.fromVisitDateTime || a.createdAt;
          const dateB = b.fromVisitDateTime || b.createdAt;
          return new Date(dateB).getTime() - new Date(dateA).getTime();
        });

        setRecords(list);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching service engineer reports:', error);
        toast.error('Failed to load service engineer reports');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filter option sets
  const availableMachines = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.machineName) set.add(r.machineName.trim());
    });
    if (userMachine) set.add(userMachine.trim());
    return Array.from(set).sort();
  }, [records, userMachine]);

  const availableCompanies = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.companyName) set.add(r.companyName.trim());
    });
    return Array.from(set).sort();
  }, [records]);

  const availableZones = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.zoneName) set.add(r.zoneName.trim());
    });
    return Array.from(set).sort();
  }, [records]);

  const availableDivisions = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.divisionName) set.add(r.divisionName.trim());
    });
    return Array.from(set).sort();
  }, [records]);

  // Apply filters
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // Machine filter
      if (selectedMachine !== 'all') {
        const sel = selectedMachine.trim().toLowerCase();
        if ((r.machineName || '').trim().toLowerCase() !== sel) return false;
      }

      // Company filter
      if (selectedCompany !== 'all') {
        const comp = selectedCompany.trim().toLowerCase();
        if ((r.companyName || '').trim().toLowerCase() !== comp) return false;
      }

      // Zone filter
      if (selectedZone !== 'all') {
        const z = selectedZone.trim().toLowerCase();
        if ((r.zoneName || '').trim().toLowerCase() !== z) return false;
      }

      // Division filter
      if (selectedDivision !== 'all') {
        const d = selectedDivision.trim().toLowerCase();
        if ((r.divisionName || '').trim().toLowerCase() !== d) return false;
      }

      // Date range filter
      if (startDate) {
        const itemDate = (r.fromVisitDateTime || r.createdAt || '').slice(0, 10);
        if (itemDate && itemDate < startDate) return false;
      }
      if (endDate) {
        const itemDate = (r.fromVisitDateTime || r.createdAt || '').slice(0, 10);
        if (itemDate && itemDate > endDate) return false;
      }

      // Search query across multiple fields
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchEngineer = r.engineerName?.toLowerCase().includes(q);
        const matchEngCompany = r.engineerCompanyName?.toLowerCase().includes(q);
        const matchContractCompany = r.companyName?.toLowerCase().includes(q);
        const matchMachine = r.machineName?.toLowerCase().includes(q);
        const matchReason = r.visitReason?.toLowerCase().includes(q);
        const matchDesc = r.description?.toLowerCase().includes(q);
        const matchZone = r.zoneName?.toLowerCase().includes(q);
        const matchDiv = r.divisionName?.toLowerCase().includes(q);
        const matchEngine = r.engines?.some((e) => e.name?.toLowerCase().includes(q) || e.hours?.toLowerCase().includes(q));

        if (
          !matchEngineer &&
          !matchEngCompany &&
          !matchContractCompany &&
          !matchMachine &&
          !matchReason &&
          !matchDesc &&
          !matchZone &&
          !matchDiv &&
          !matchEngine
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    records,
    selectedMachine,
    selectedCompany,
    selectedZone,
    selectedDivision,
    startDate,
    endDate,
    searchQuery,
  ]);

  // Metrics summary
  const metrics = useMemo(() => {
    const totalVisits = filteredRecords.length;
    const machinesServiced = new Set(filteredRecords.map((r) => r.machineName).filter(Boolean)).size;
    const engineersCount = new Set(filteredRecords.map((r) => r.engineerName).filter(Boolean)).size;
    const companiesCount = new Set(filteredRecords.map((r) => r.engineerCompanyName || r.companyName).filter(Boolean)).size;
    return { totalVisits, machinesServiced, engineersCount, companiesCount };
  }, [filteredRecords]);

  // Pagination slice
  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage]);

  // Reset filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedMachine('all');
    setSelectedCompany('all');
    setSelectedZone('all');
    setSelectedDivision('all');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredRecords.length === 0) {
      toast.error('No service engineer records to export');
      return;
    }

    const dataToExport = filteredRecords.map((rec, idx) => {
      const enginesList = rec.engines && rec.engines.length > 0
        ? rec.engines
        : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);
      const enginesText = enginesList.map((e) => `${e.name}${e.hours ? ` (${e.hours} Hrs)` : ''}`).join(', ') || 'N/A';

      return {
        'SR.': idx + 1,
        'From Visit Date & Time': formatToDDMMYYYY(rec.fromVisitDateTime),
        'To Visit Date & Time': formatToDDMMYYYY(rec.toVisitDateTime),
        'Machine Name': rec.machineName || 'N/A',
        'Contract Company': rec.companyName || 'N/A',
        'Zone Name': rec.zoneName || 'N/A',
        'Division Name': rec.divisionName || 'N/A',
        'Services Engineer Name': rec.engineerName || 'N/A',
        'Services Engineer Company': rec.engineerCompanyName || 'N/A',
        'Company Type': rec.engineerCompanyType || 'N/A',
        'Engine Details': enginesText,
        'Visit Reason': rec.visitReason || 'N/A',
        'Description & Work Carried Out': rec.description || 'N/A',
        'Logged By': formatCreatorName(rec.createdByName),
        'Created At': rec.createdAt ? new Date(rec.createdAt).toLocaleString() : 'N/A',
      };
    });

    const dateStr = new Date().toISOString().split('T')[0];
    exportReportToExcel(dataToExport, 'Services_Engineer_Report', `Service_Engineer_Reports_${dateStr}`);
  };

  // Export to PDF
  const handleExportPdf = () => {
    if (filteredRecords.length === 0) {
      toast.error('No service engineer records to export');
      return;
    }

    const headers = [
      'SR.',
      'Visit Period',
      'Machine',
      'Contractor',
      'Zone/Div',
      'Engineer Name',
      'Firm / Type',
      'Engines (Hrs)',
      'Visit Reason',
      'Descriptions',
    ];

    const rows = filteredRecords.map((r, idx) => {
      const enginesList = r.engines && r.engines.length > 0
        ? r.engines
        : (r.engineName ? [{ name: r.engineName, hours: r.engineHours || '' }] : []);
      const enginesText = enginesList.map((e) => `${e.name}${e.hours ? ` (${e.hours}h)` : ''}`).join(', ') || '-';

      return [
        idx + 1,
        `${formatToDDMMYYYY(r.fromVisitDateTime)} to ${formatToDDMMYYYY(r.toVisitDateTime)}`,
        r.machineName || '-',
        r.companyName || '-',
        `${r.zoneName || '-'}/${r.divisionName || '-'}`,
        r.engineerName || '-',
        `${r.engineerCompanyName || '-'} (${r.engineerCompanyType || 'OEM'})`,
        enginesText,
        r.visitReason || '-',
        r.description ? r.description.slice(0, 100) : '-',
      ];
    });

    exportReportToPdf({
      title: 'Services Engineer Report Ledger',
      subtitle: 'Technical inspection and visiting records of service engineers',
      filterSummary: `Machine: ${selectedMachine} | Company: ${selectedCompany} | Records: ${filteredRecords.length}`,
      headers,
      rows,
      filename: `Service_Engineer_Reports_${new Date().toISOString().split('T')[0]}`,
      orientation: 'landscape',
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 46, halign: 'center', fontStyle: 'bold' }, // Visit Period: prevents text wrapping
        2: { cellWidth: 24, fontStyle: 'bold' },
        3: { cellWidth: 28 },
        4: { cellWidth: 22 },
        5: { cellWidth: 26, fontStyle: 'bold' },
        6: { cellWidth: 28 },
        7: { cellWidth: 24 },
        8: { cellWidth: 28 },
        9: { cellWidth: 'auto' },
      },
    });
  };

  // Print single visit voucher
  const handlePrintSingle = (rec: ServiceEngineerRecord) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Unable to open print preview. Please check popup permissions.');
      return;
    }

    const enginesList = rec.engines && rec.engines.length > 0
      ? rec.engines
      : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);

    const enginesHtml = enginesList.length > 0
      ? `<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 1.5px solid #cbd5e1;">
              <th style="padding: 6px 10px; font-size: 11px; text-align: left; text-transform: uppercase;">Engine / Equipment</th>
              <th style="padding: 6px 10px; font-size: 11px; text-align: right; text-transform: uppercase;">Cumulative Running Hours</th>
            </tr>
          </thead>
          <tbody>
            ${enginesList.map((e) => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 6px 10px; font-weight: bold; font-size: 12px;">${escapeHtml(e.name)}</td>
                <td style="padding: 6px 10px; font-family: monospace; font-size: 12px; text-align: right; color: #4338ca; font-weight: bold;">${escapeHtml(e.hours ? `${e.hours} Hrs` : 'N/A')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p style="color: #64748b; font-size: 11px; font-style: italic;">No specific engine hours logged.</p>';

    const formattedReason = escapeHtml(rec.visitReason).replace(/\n/g, '<br/>');
    const formattedDesc = escapeHtml(rec.description).replace(/\n/g, '<br/>');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Service Engineer Report Voucher - ${escapeHtml(rec.machineName || 'Visit')}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm 15mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 10px; }
            .header-card { border: 2px solid #0f172a; padding: 12px 16px; border-radius: 6px; text-align: center; margin-bottom: 16px; }
            .rail-heading { font-size: 16px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 2px; }
            .sub-heading { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; }
            .doc-title { font-size: 13px; font-weight: 800; background: #0f172a; color: white; display: inline-block; padding: 4px 14px; border-radius: 4px; margin-top: 6px; letter-spacing: 0.5px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
            .info-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
            .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
            .info-label { font-weight: 700; color: #475569; text-transform: uppercase; }
            .info-val { font-weight: 800; color: #0f172a; text-align: right; }
            .section-label { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #1e293b; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; }
            .description-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; font-size: 11px; line-height: 1.5; min-height: 80px; white-space: pre-wrap; background: #fff; margin-bottom: 16px; }
            .signatures-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-top: 40px; text-align: center; }
            .sig-line { border-top: 1.5px solid #0f172a; padding-top: 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <div class="header-card">
            <div class="rail-heading">INDIAN RAILWAYS / TRACK MACHINE ORGANISATION</div>
            <div class="sub-heading">Machine Maintenance & Engineering Service Record</div>
            <div class="doc-title">SERVICE ENGINEER VISIT REPORT VOUCHER</div>
          </div>

          <div class="info-grid">
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Machine Name:</span>
                <span class="info-val" style="color: #1e40af; font-size: 13px;">${escapeHtml(rec.machineName || 'N/A')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Contractor Company:</span>
                <span class="info-val">${escapeHtml(rec.companyName || 'N/A')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Zone & Division:</span>
                <span class="info-val">${escapeHtml(rec.zoneName || 'N/A')} / ${escapeHtml(rec.divisionName || 'N/A')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Visit Start Date/Time:</span>
                <span class="info-val">${formatToDDMMYYYY(rec.fromVisitDateTime)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Visit End Date/Time:</span>
                <span class="info-val">${formatToDDMMYYYY(rec.toVisitDateTime)}</span>
              </div>
            </div>

            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Visiting Engineer:</span>
                <span class="info-val" style="color: #0f172a; font-size: 12px;">${escapeHtml(rec.engineerName || 'N/A')}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Firm / Agency:</span>
                <span class="info-val">${escapeHtml(rec.engineerCompanyName || 'N/A')} (${escapeHtml(rec.engineerCompanyType || 'OEM')})</span>
              </div>
              <div class="info-row">
                <span class="info-label">Reason of Visit:</span>
                <span class="info-val" style="color: #3730a3;">${formattedReason}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Report Logged By:</span>
                <span class="info-val">${escapeHtml(formatCreatorName(rec.createdByName))}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Report ID / Timestamp:</span>
                <span class="info-val">${rec.id.slice(0, 8)} • ${new Date().toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div style="margin-bottom: 14px;">
            <div class="section-label">Engine Details & Cumulative Running Hours</div>
            ${enginesHtml}
          </div>

          <div>
            <div class="section-label">Detailed Work Carried Out & Technical Inspection Notes</div>
            <div class="description-box">${formattedDesc}</div>
          </div>

          <div class="signatures-grid">
            <div>
              <div style="height: 38px;"></div>
              <div class="sig-line">Visiting Service Engineer<br/><span style="font-size: 8.5px; font-weight: 500; color: #64748b;">(Sign & Stamp)</span></div>
            </div>
            <div>
              <div style="height: 38px;"></div>
              <div class="sig-line">SSE / JE (Track Machine)<br/><span style="font-size: 8.5px; font-weight: 500; color: #64748b;">In-Charge</span></div>
            </div>
            <div>
              <div style="height: 38px;"></div>
              <div class="sig-line">Depot / Divisional Official<br/><span style="font-size: 8.5px; font-weight: 500; color: #64748b;">Verified & Recorded</span></div>
            </div>
          </div>

          <script>
            window.addEventListener('load', function() {
              setTimeout(function() {
                window.print();
              }, 200);
            });
            window.onafterprint = function() {
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <FileText size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Visits Logged</p>
            <h3 className="text-xl font-black text-slate-800 mt-0.5">{metrics.totalVisits}</h3>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <Wrench size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Machines Serviced</p>
            <h3 className="text-xl font-black text-slate-800 mt-0.5">{metrics.machinesServiced}</h3>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <UserCircle size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Service Engineers</p>
            <h3 className="text-xl font-black text-slate-800 mt-0.5">{metrics.engineersCount}</h3>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
            <Building2 size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Partner Firms / OEMs</p>
            <h3 className="text-xl font-black text-slate-800 mt-0.5">{metrics.companiesCount}</h3>
          </div>
        </div>
      </div>

      {/* Filter and Action Toolbar */}
      <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search by engineer, firm, machine, visit reason, or descriptions..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold"
            />
          </div>

          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              title={`Export complete data of all ${filteredRecords.length} records to Excel`}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
            >
              <Download size={14} />
              <span>Excel</span>
            </button>
            <button
              onClick={handleExportPdf}
              title={`Export complete data of all ${filteredRecords.length} records to PDF`}
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400 cursor-pointer"
            >
              <FileText size={14} />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* Secondary Filter Selectors */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Machine</label>
            <select
              value={selectedMachine}
              onChange={(e) => {
                setSelectedMachine(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">All Machines</option>
              {availableMachines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Contractor Firm</label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Contractor Firms</option>
              {availableCompanies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Zone</label>
            <select
              value={selectedZone}
              onChange={(e) => {
                setSelectedZone(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Zones</option>
              {availableZones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Active Filter Clear Tag */}
        {(searchQuery || selectedMachine !== 'all' || selectedCompany !== 'all' || selectedZone !== 'all' || selectedDivision !== 'all' || startDate || endDate) && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500 font-semibold">
              Filtered records: <b className="text-indigo-600">{filteredRecords.length}</b> of {records.length} total
            </span>
            <button
              onClick={handleResetFilters}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
            >
              <X size={12} />
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Main Ledger Table */}
      <div className="bg-white border border-slate-300 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-300 pb-3">
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <FileText size={16} className="text-indigo-600" />
            Services Engineer Reports Ledger (Landscape)
          </h2>
          <span className="text-xs text-slate-400 font-bold">
            Showing {filteredRecords.length} records
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-300 rounded-xl shadow-xs">
          <table className="w-full text-left border-collapse border border-slate-300 min-w-[1450px]">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-slate-800 font-extrabold select-none">
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-center w-12 border-r border-slate-300">#</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Visit Period</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Machine Name</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Contractor Firm</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Zone & Div</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Engineer Name</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Engineer Firm</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap text-center border-r border-slate-300">Type</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Engine Details</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Reason of Visit</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider min-w-[200px] max-w-[280px] border-r border-slate-300">Descriptions & Notes</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 bg-white text-xs font-semibold text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400 font-bold">
                    Loading service engineer reports...
                  </td>
                </tr>
              ) : paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400">
                    <FileText className="mx-auto text-slate-300 stroke-[1.5] mb-2" size={28} />
                    <p className="font-bold text-slate-700">No service engineer visit records found matching your filters.</p>
                    {records.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          <X size={12} />
                          <span>Reset Filters ({records.length} total records available)</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  const enginesList = record.engines && record.engines.length > 0
                    ? record.engines
                    : (record.engineName ? [{ name: record.engineName, hours: record.engineHours || '' }] : []);

                  return (
                    <tr key={record.id} className="hover:bg-indigo-50/40 even:bg-slate-50/50 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-500 border-r border-slate-300 font-mono text-[11px]">
                        {absoluteIndex}
                      </td>

                      <td className="p-3 font-mono text-slate-600 space-y-0.5 whitespace-nowrap align-top border-r border-slate-300">
                        <div className="text-[11px] text-slate-800 font-bold leading-tight">
                          {formatToDDMMYYYY(record.fromVisitDateTime)}
                        </div>
                        <div className="text-[9.5px] text-slate-400 font-semibold">
                          to {formatToDDMMYYYY(record.toVisitDateTime)}
                        </div>
                      </td>

                      <td className="p-3 whitespace-nowrap align-top border-r border-slate-300">
                        <span className="bg-slate-100 text-slate-800 text-[11px] font-black px-2.5 py-1 rounded-lg border border-slate-200 uppercase whitespace-nowrap inline-block tracking-tight">
                          {record.machineName || 'N/A'}
                        </span>
                      </td>

                      <td className="p-3 text-indigo-700 font-black whitespace-nowrap align-top border-r border-slate-300">
                        {record.companyName || 'N/A'}
                      </td>

                      <td className="p-3 text-slate-600 font-bold whitespace-nowrap align-top border-r border-slate-300">
                        <div>{record.zoneName || 'N/A'}</div>
                        <div className="text-[10px] text-slate-400">{record.divisionName || 'N/A'}</div>
                      </td>

                      <td className="p-3 text-slate-900 font-extrabold whitespace-nowrap align-top border-r border-slate-300">
                        {record.engineerName}
                      </td>

                      <td className="p-3 text-slate-700 font-bold whitespace-nowrap align-top border-r border-slate-300">
                        {record.engineerCompanyName || 'N/A'}
                      </td>

                      <td className="p-3 text-center whitespace-nowrap align-top border-r border-slate-300">
                        <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded border border-indigo-100">
                          {record.engineerCompanyType || 'OEM'}
                        </span>
                      </td>

                      <td className="p-3 space-y-1 align-top whitespace-nowrap border-r border-slate-300">
                        {enginesList.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {enginesList.map((e, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 text-[9.5px] px-2 py-0.5 rounded border border-slate-200 font-medium whitespace-nowrap"
                              >
                                <b>{e.name}</b>{e.hours ? `: ${e.hours}h` : ''}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[10px] whitespace-nowrap">No engines logged</span>
                        )}
                      </td>

                      <td className="p-3 text-slate-800 font-bold whitespace-nowrap align-top border-r border-slate-300">
                        {record.visitReason}
                      </td>

                      <td className="p-3 text-slate-600 font-normal text-xs align-top max-w-[280px] whitespace-nowrap truncate border-r border-slate-300" title={record.description || ''}>
                        {record.description || 'No additional remarks'}
                      </td>

                      <td className="p-3 text-center whitespace-nowrap align-top">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setViewRecord(record)}
                            className="px-2.5 py-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title="View Full Report Voucher"
                          >
                            <Eye size={13} />
                            <span>View</span>
                          </button>
                          <button
                            onClick={() => handlePrintSingle(record)}
                            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Print Voucher Directly"
                          >
                            <Printer size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <ReportPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredRecords.length}
          pageSize={pageSize}
        />
      </div>

      {/* Record Voucher Modal */}
      <AnimatePresence>
        {viewRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase">Service Engineer Visit Details</h3>
                    <p className="text-[11px] text-slate-400 font-semibold">{viewRecord.machineName || 'Machine Visit'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePrintSingle(viewRecord)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Printer size={13} />
                    Print Voucher
                  </button>
                  <button
                    onClick={() => setViewRecord(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Machine & Contractor</div>
                  <div className="font-extrabold text-slate-800 text-sm">{viewRecord.machineName || 'N/A'}</div>
                  <div className="text-indigo-600 font-bold">{viewRecord.companyName}</div>
                  <div className="text-slate-600 font-semibold text-[11px]">
                    {viewRecord.zoneName || 'N/A'}{viewRecord.divisionName ? ` / ${viewRecord.divisionName}` : ''}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Visiting Engineer</div>
                  <div className="font-extrabold text-slate-800 text-sm">{viewRecord.engineerName}</div>
                  <div className="text-slate-700 font-bold">{viewRecord.engineerCompanyName || 'N/A'}</div>
                  <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-extrabold rounded">
                    {viewRecord.engineerCompanyType || 'OEM'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">From Visit Date/Time</span>
                  <span className="font-bold text-slate-800 font-mono">{formatToDDMMYYYY(viewRecord.fromVisitDateTime)}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">To Visit Date/Time</span>
                  <span className="font-bold text-slate-800 font-mono">{formatToDDMMYYYY(viewRecord.toVisitDateTime)}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Reason of Visit</div>
                <div className="font-bold text-slate-900">{viewRecord.visitReason}</div>
              </div>

              {((viewRecord.engines && viewRecord.engines.length > 0) || viewRecord.engineName) && (
                <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-2">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Engine / Equipment Running Hours</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {viewRecord.engines && viewRecord.engines.length > 0 ? (
                      viewRecord.engines.map((eng, idx) => (
                        <div key={idx} className="bg-white p-2 rounded-lg border border-slate-200/80 flex items-center justify-between">
                          <span className="font-bold text-slate-800">{eng.name}</span>
                          <span className="font-mono font-bold text-indigo-600">{eng.hours ? `${eng.hours} Hrs` : 'N/A'}</span>
                        </div>
                      ))
                    ) : (
                      <div className="bg-white p-2 rounded-lg border border-slate-200/80 flex items-center justify-between">
                        <span className="font-bold text-slate-800">{viewRecord.engineName}</span>
                        <span className="font-mono font-bold text-indigo-600">{viewRecord.engineHours ? `${viewRecord.engineHours} Hrs` : 'N/A'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Description & Work Done</div>
                <div className="text-slate-700 whitespace-pre-wrap leading-relaxed">{viewRecord.description || 'No descriptions logged.'}</div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                <span>Logged By: <b className="text-slate-600">{formatCreatorName(viewRecord.createdByName)}</b></span>
                <span>Created: {viewRecord.createdAt ? new Date(viewRecord.createdAt).toLocaleString() : 'N/A'}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
