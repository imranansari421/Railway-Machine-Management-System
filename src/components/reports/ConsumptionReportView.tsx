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
  Droplet, 
  Building2, 
  Cpu, 
  MapPin, 
  Gauge, 
  Clock, 
  Printer,
  ChevronRight,
  TrendingDown,
  Fuel
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { FilterAccessPermissions } from '../../utils/employee';
import { formatDateToDDMMYYYY } from '../../utils/dateUtils';
import ReportPagination from './ReportPagination';
import { toast } from 'sonner';

interface EngineHourRecord {
  name: string;
  openingHours: string | number;
  closingHours: string | number;
  duration: string | number;
}

export interface HSDConsumptionRecord {
  id: string;
  fromDate: string;
  toDate: string;
  machineName: string;
  companyName?: string;
  zoneName?: string;
  divisionName?: string;
  openingBalance: number;
  filledHsd: number;
  closingBalance: number;
  calculatedConsumption: number;
  monthAndYear?: string;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  report?: string;
  engines?: EngineHourRecord[];
}

interface Props {
  filterPerms: FilterAccessPermissions;
  userMachine?: string;
  userCompany?: string;
  userZone?: string;
  userDivision?: string;
}

export default function ConsumptionReportView({
  filterPerms,
  userMachine,
  userCompany,
  userZone,
  userDivision,
}: Props) {
  const [records, setRecords] = useState<HSDConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMachine, setSelectedMachine] = useState(() => userMachine || 'all');
  const [selectedCompany, setSelectedCompany] = useState(() => userCompany || 'all');
  const [selectedZone, setSelectedZone] = useState(() => userZone || 'all');
  const [selectedDivision, setSelectedDivision] = useState(() => userDivision || 'all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // View Record Modal
  const [viewRecord, setViewRecord] = useState<HSDConsumptionRecord | null>(null);

  // Synchronize HSD consumption reports real-time
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, 'consumptions'), (snap) => {
      const list: HSDConsumptionRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          fromDate: data.fromDate || '',
          toDate: data.toDate || '',
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          zoneName: data.zoneName || '',
          divisionName: data.divisionName || '',
          openingBalance: Number(data.openingBalance || 0),
          filledHsd: Number(data.filledHsd || 0),
          closingBalance: Number(data.closingBalance || 0),
          calculatedConsumption: Number(data.calculatedConsumption || 0),
          monthAndYear: data.monthAndYear || '',
          createdAt: data.createdAt || '',
          createdBy: data.createdBy || '',
          createdByName: data.createdByName || 'Admin',
          report: data.report || '',
          engines: data.engines || [],
        });
      });

      list.sort((a, b) => new Date(b.fromDate || b.createdAt || 0).getTime() - new Date(a.fromDate || a.createdAt || 0).getTime());
      setRecords(list);
      setLoading(false);
    }, (error) => {
      console.error('Error loading consumption reports:', error);
      toast.error('Failed to load consumption reports');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Compute unique lists for filter dropdowns
  const { allMachines, allCompanies, allZones, allDivisions } = useMemo(() => {
    const machines = new Set<string>();
    const companies = new Set<string>();
    const zones = new Set<string>();
    const divisions = new Set<string>();

    records.forEach(r => {
      if (r.machineName) machines.add(r.machineName);
      if (r.companyName) companies.add(r.companyName);
      if (r.zoneName) zones.add(r.zoneName);
      if (r.divisionName) divisions.add(r.divisionName);
    });

    return {
      allMachines: Array.from(machines).sort(),
      allCompanies: Array.from(companies).sort(),
      allZones: Array.from(zones).sort(),
      allDivisions: Array.from(divisions).sort(),
    };
  }, [records]);

  // Apply RBAC and user filters
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // Machine filter
      if (!filterPerms.canChangeMachine && userMachine) {
        if (r.machineName !== userMachine) return false;
      } else if (selectedMachine !== 'all') {
        if (r.machineName !== selectedMachine) return false;
      }

      // Company filter
      if (selectedCompany !== 'all') {
        if (r.companyName !== selectedCompany) return false;
      }

      // Zone filter
      if (selectedZone !== 'all' && r.zoneName !== selectedZone) {
        return false;
      }

      // Division filter
      if (selectedDivision !== 'all' && r.divisionName !== selectedDivision) {
        return false;
      }

      // Date range filter
      if (startDate) {
        const itemDate = r.fromDate || r.createdAt?.slice(0, 10) || '';
        if (itemDate && itemDate < startDate) return false;
      }
      if (endDate) {
        const itemDate = r.toDate || r.createdAt?.slice(0, 10) || '';
        if (itemDate && itemDate > endDate) return false;
      }

      // Search query across fields
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchMachine = r.machineName?.toLowerCase().includes(q);
        const matchCompany = r.companyName?.toLowerCase().includes(q);
        const matchZone = r.zoneName?.toLowerCase().includes(q);
        const matchDivision = r.divisionName?.toLowerCase().includes(q);
        const matchReport = r.report?.toLowerCase().includes(q);
        const matchEngines = r.engines?.some(e => e.name?.toLowerCase().includes(q));
        const matchCreatedBy = r.createdByName?.toLowerCase().includes(q);
        if (!matchMachine && !matchCompany && !matchZone && !matchDivision && !matchReport && !matchEngines && !matchCreatedBy) {
          return false;
        }
      }

      return true;
    });
  }, [records, filterPerms, selectedMachine, selectedCompany, selectedZone, selectedDivision, startDate, endDate, searchQuery]);

  // Metrics summary
  const metrics = useMemo(() => {
    const totalLogs = filteredRecords.length;
    const totalFilled = filteredRecords.reduce((acc, r) => acc + (r.filledHsd || 0), 0);
    const totalConsumed = filteredRecords.reduce((acc, r) => acc + (r.calculatedConsumption || 0), 0);
    const avgConsumption = totalLogs > 0 ? Math.round((totalConsumed / totalLogs) * 10) / 10 : 0;
    return { totalLogs, totalFilled, totalConsumed, avgConsumption };
  }, [filteredRecords]);

  // Pagination slice
  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage]);

  const getSingleEngineDuration = (e: any): string | number => {
    if (!e) return 0;
    const dur = e.duration ?? e.runningHours ?? e.hours ?? e.netDuration ?? e.workingHours;
    if (dur !== undefined && dur !== null && String(dur).trim() !== '') {
      if (typeof dur === 'number' && !isNaN(dur)) return Number(dur.toFixed(2));
      const s = String(dur).trim();
      if (s.includes('/') || s.includes(',')) return s;
      const num = parseFloat(s.replace(/[^\d.-]/g, ''));
      if (!isNaN(num)) return Number(num.toFixed(2));
    }

    const opStr = String(e.openingHours ?? e.openingMeter ?? '').trim();
    const clStr = String(e.closingHours ?? e.closingMeter ?? '').trim();
    if (opStr && clStr) {
      if (opStr.includes('/') && clStr.includes('/')) {
        const opParts = opStr.split('/');
        const clParts = clStr.split('/');
        if (opParts.length === clParts.length) {
          const diffs = clParts.map((c, i) => {
            const cv = parseFloat(c.replace(/[^\d.-]/g, ''));
            const ov = parseFloat(opParts[i].replace(/[^\d.-]/g, ''));
            return !isNaN(cv) && !isNaN(ov) ? Number((cv - ov).toFixed(2)) : 0;
          });
          return diffs.join('/');
        }
      }

      if (opStr.includes(',') && clStr.includes(',')) {
        const opParts = opStr.split(',');
        const clParts = clStr.split(',');
        if (opParts.length === clParts.length) {
          const diffs = clParts.map((c, i) => {
            const cv = parseFloat(c.replace(/[^\d.-]/g, ''));
            const ov = parseFloat(opParts[i].replace(/[^\d.-]/g, ''));
            return !isNaN(cv) && !isNaN(ov) ? Number((cv - ov).toFixed(2)) : 0;
          });
          return diffs.join(',');
        }
      }

      const opNum = parseFloat(opStr.replace(/[^\d.-]/g, ''));
      const clNum = parseFloat(clStr.replace(/[^\d.-]/g, ''));
      if (!isNaN(opNum) && !isNaN(clNum)) {
        return Number((clNum - opNum).toFixed(2));
      }
    }

    return 0;
  };

  const sumDurations = (engines?: any[]): string => {
    if (!engines || !Array.isArray(engines) || engines.length === 0) return '0';

    const resolved = engines.map(e => getSingleEngineDuration(e));

    const hasSlash = resolved.some(r => typeof r === 'string' && r.includes('/'));
    if (hasSlash) {
      const slashItems = resolved.filter((r): r is string => typeof r === 'string' && r.includes('/'));
      const partsCount = slashItems[0].split('/').length;
      const totals = Array(partsCount).fill(0);
      for (const r of resolved) {
        if (typeof r === 'string' && r.includes('/')) {
          const parts = r.split('/');
          parts.forEach((p, idx) => {
            if (idx < partsCount) {
              const v = parseFloat(p.replace(/[^\d.-]/g, '')) || 0;
              totals[idx] += v;
            }
          });
        } else {
          const v = typeof r === 'number' ? (isNaN(r) ? 0 : r) : parseFloat(String(r).replace(/[^\d.-]/g, '')) || 0;
          totals[0] += v;
        }
      }
      return totals.map(t => Number(t.toFixed(2))).join('/');
    }

    const hasComma = resolved.some(r => typeof r === 'string' && r.includes(','));
    if (hasComma) {
      const commaItems = resolved.filter((r): r is string => typeof r === 'string' && r.includes(','));
      const partsCount = commaItems[0].split(',').length;
      const totals = Array(partsCount).fill(0);
      for (const r of resolved) {
        if (typeof r === 'string' && r.includes(',')) {
          const parts = r.split(',');
          parts.forEach((p, idx) => {
            if (idx < partsCount) {
              const v = parseFloat(p.replace(/[^\d.-]/g, '')) || 0;
              totals[idx] += v;
            }
          });
        } else {
          const v = typeof r === 'number' ? (isNaN(r) ? 0 : r) : parseFloat(String(r).replace(/[^\d.-]/g, '')) || 0;
          totals[0] += v;
        }
      }
      return totals.map(t => Number(t.toFixed(2))).join(',');
    }

    let total = 0;
    for (const r of resolved) {
      const v = typeof r === 'number' ? (isNaN(r) ? 0 : r) : parseFloat(String(r).replace(/[^\d.-]/g, '')) || 0;
      if (!isNaN(v)) {
        total += v;
      }
    }
    return String(Number(total.toFixed(2)));
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredRecords.length === 0) {
      toast.error('No consumption records to export');
      return;
    }

    const dataToExport = filteredRecords.map((r, idx) => ({
      'SR.': idx + 1,
      'From Date': formatDateToDDMMYYYY(r.fromDate),
      'To Date': formatDateToDDMMYYYY(r.toDate),
      'Machine Name': r.machineName,
      'Company Name': r.companyName || 'Other / Outside Agency',
      'Zone': r.zoneName || 'N/A',
      'Division': r.divisionName || 'N/A',
      'Opening Balance (L)': r.openingBalance,
      'Filled HSD (L)': r.filledHsd,
      'Closing Balance (L)': r.closingBalance,
      'Calculated Consumption (L)': r.calculatedConsumption,
      'Total Engine Hours': sumDurations(r.engines),
      'Engines Breakdown': r.engines && r.engines.length > 0 
        ? r.engines.map(e => `${e.name}: ${e.openingHours}h->${e.closingHours}h (${e.duration}h)`).join('; ')
        : 'None',
      'Report / Remarks': r.report || 'No notes',
      'Logged By': r.createdByName || 'Admin',
    }));

    exportReportToExcel(
      dataToExport,
      'Consumption Report',
      `Consumption_Report_${formatDateToDDMMYYYY(new Date())}`
    );
  };

  // Export to PDF / Print Ledger
  const handleExportPdf = () => {
    if (filteredRecords.length === 0) {
      toast.error('No consumption records to export');
      return;
    }

    const headers = [
      'SR.',
      'Date Period',
      'Machine Name',
      'Company Name',
      'Zone / Div',
      'Opening',
      'Filled',
      'Closing',
      'Consumed',
      'Engine Hrs',
      'Remarks',
    ];

    const rows = filteredRecords.map((r, idx) => [
      idx + 1,
      `${formatDateToDDMMYYYY(r.fromDate)} to ${formatDateToDDMMYYYY(r.toDate)}`,
      r.machineName,
      r.companyName || 'N/A',
      `${r.zoneName || 'N/A'} / ${r.divisionName || 'N/A'}`,
      `${r.openingBalance} L`,
      `+${r.filledHsd} L`,
      `=${r.closingBalance} L`,
      `=${r.calculatedConsumption} L`,
      r.engines && r.engines.length > 0 ? `${sumDurations(r.engines)} Hrs` : 'N/A',
      r.report || '-',
    ]);

    exportReportToPdf({
      title: 'Consumption Report',
      subtitle: 'Machine Fuel & HSD Consumption Registry',
      headers,
      rows,
      orientation: 'landscape',
      filename: `Consumption_Report_${formatDateToDDMMYYYY(new Date())}`,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 46, halign: 'center', fontStyle: 'bold' }, // Date Period: fits on one line without wrapping
        2: { cellWidth: 24, fontStyle: 'bold' },
        3: { cellWidth: 30 },
        4: { cellWidth: 24 },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 18, halign: 'right' },
        7: { cellWidth: 18, halign: 'right' },
        8: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
        9: { cellWidth: 24 },
        10: { cellWidth: 'auto' },
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Records</p>
            <h3 className="text-2xl font-black text-slate-800 mt-1">{metrics.totalLogs}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Consumption entries logged</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Fuel size={22} />
          </div>
        </div>

        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Filled HSD</p>
            <h3 className="text-2xl font-black text-emerald-600 mt-1">{metrics.totalFilled.toLocaleString()} L</h3>
            <p className="text-xs text-slate-500 mt-0.5">Total fuel issued</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Droplet size={22} />
          </div>
        </div>

        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Consumed</p>
            <h3 className="text-2xl font-black text-indigo-700 mt-1">{metrics.totalConsumed.toLocaleString()} L</h3>
            <p className="text-xs text-slate-500 mt-0.5">Net HSD calculated</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <TrendingDown size={22} />
          </div>
        </div>

        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Avg Consumption</p>
            <h3 className="text-2xl font-black text-slate-800 mt-1">{metrics.avgConsumption} L</h3>
            <p className="text-xs text-slate-500 mt-0.5">Per recorded period</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <Gauge size={22} />
          </div>
        </div>
      </div>

      {/* Filter Toolbar & Actions */}
      <div className="bg-white border border-slate-300 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by machine, company, engine, remarks, or logger..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
              title="Export filtered records to Microsoft Excel"
            >
              <Download size={14} />
              <span>Excel</span>
            </button>

            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400 cursor-pointer"
              title="Export / Print official PDF report"
            >
              <FileText size={14} />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* Secondary Filter Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              Machine Name
            </label>
            <select
              value={selectedMachine}
              onChange={(e) => {
                setSelectedMachine(e.target.value);
                setCurrentPage(1);
              }}
              disabled={!filterPerms.canChangeMachine}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 cursor-pointer"
            >
              <option value="all">All Machines</option>
              {allMachines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              Company Name
            </label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 cursor-pointer"
            >
              <option value="all">All Companies</option>
              {allCompanies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              Zone
            </label>
            <select
              value={selectedZone}
              onChange={(e) => {
                setSelectedZone(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
            >
              <option value="all">All Zones</option>
              {allZones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              Division
            </label>
            <select
              value={selectedDivision}
              onChange={(e) => {
                setSelectedDivision(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
            >
              <option value="all">All Divisions</option>
              {allDivisions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* REGISTRY TABLE: Full screen landscape view */}
      <div className="bg-white border border-slate-300 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-300 pb-3">
          <h2 id="registry-heading" className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Fuel size={16} className="text-indigo-600" />
            Machine Consumption Logs Registry (Landscape)
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
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Date Period</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Machine Name</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Company Name</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Zone</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Division</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-right whitespace-nowrap border-r border-slate-300">Opening Bal</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-right whitespace-nowrap border-r border-slate-300">Filled HSD</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-right whitespace-nowrap border-r border-slate-300">Closing Bal</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-right whitespace-nowrap border-r border-slate-300">Consumed</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Engines Running Hours</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap border-r border-slate-300">Report / Remarks</th>
                <th className="p-3 text-[10px] font-black text-slate-700 uppercase tracking-wider text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-400 font-bold whitespace-nowrap">
                    Loading consumption records...
                  </td>
                </tr>
              ) : paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-400 whitespace-nowrap">
                    <FileText className="mx-auto text-slate-300 stroke-[1.5] mb-2" size={28} />
                    No HSD consumption records found matching the selected criteria.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((rec, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={rec.id} className="hover:bg-indigo-50/40 even:bg-slate-50/50 transition-colors">
                      <td className="p-3 text-center font-bold text-slate-500 border-r border-slate-300 font-mono text-[11px]">
                        {absoluteIndex}
                      </td>

                      <td className="p-3 font-mono text-slate-600 whitespace-nowrap border-r border-slate-300">
                        <span className="font-bold text-slate-900">{formatDateToDDMMYYYY(rec.fromDate)}</span>
                        <span className="text-slate-400 mx-1">to</span>
                        <span className="font-bold text-slate-900">{formatDateToDDMMYYYY(rec.toDate)}</span>
                      </td>

                      <td className="p-3 whitespace-nowrap border-r border-slate-300">
                        <span className="bg-slate-100 text-slate-800 text-[11px] font-black px-2.5 py-1 rounded-lg border border-slate-200 uppercase tracking-tight whitespace-nowrap">
                          {rec.machineName || 'N/A'}
                        </span>
                      </td>

                      <td className="p-3 text-slate-800 font-bold whitespace-nowrap border-r border-slate-300">
                        {rec.companyName || 'Other / Outside Agency'}
                      </td>

                      <td className="p-3 text-slate-600 font-bold whitespace-nowrap border-r border-slate-300">
                        {rec.zoneName || 'N/A'}
                      </td>

                      <td className="p-3 text-slate-600 font-bold whitespace-nowrap border-r border-slate-300">
                        {rec.divisionName || 'N/A'}
                      </td>

                      <td className="p-3 text-right font-mono text-slate-700 whitespace-nowrap border-r border-slate-300">
                        {rec.openingBalance.toLocaleString()} L
                      </td>

                      <td className="p-3 text-right font-mono text-emerald-700 font-bold whitespace-nowrap border-r border-slate-300">
                        +{rec.filledHsd.toLocaleString()} L
                      </td>

                      <td className="p-3 text-right font-mono text-slate-700 whitespace-nowrap border-r border-slate-300">
                        ={rec.closingBalance.toLocaleString()} L
                      </td>

                      <td className="p-3 text-right font-black text-indigo-700 font-mono bg-indigo-50/30 whitespace-nowrap border-r border-slate-300">
                        ={rec.calculatedConsumption.toLocaleString()} L
                      </td>

                      <td className="p-3 space-y-1 whitespace-nowrap border-r border-slate-300">
                        {rec.engines && rec.engines.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {rec.engines.map((e, index) => {
                              const dur = getSingleEngineDuration(e);
                              return (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 text-[9.5px] px-2 py-0.5 rounded border border-slate-200 whitespace-nowrap"
                                >
                                  <b>{e.name}</b>: {e.openingHours}h → {e.closingHours}h (<b>{dur}h</b>)
                                </span>
                              );
                            })}
                            <span className="text-[9.5px] font-black text-indigo-700 bg-indigo-50/90 px-2.5 py-1 rounded-md border border-indigo-200/80 inline-flex items-center gap-1.5 w-fit shadow-xs whitespace-nowrap">
                              <span className="font-bold text-slate-600">Sum:</span>
                              <span className="font-mono">{sumDurations(rec.engines)} Hrs</span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[10px] whitespace-nowrap">None recorded</span>
                        )}
                      </td>

                      <td className="p-3 text-slate-600 font-normal italic max-w-xs whitespace-nowrap truncate border-r border-slate-300" title={rec.report || ''}>
                        {rec.report || 'No notes'}
                      </td>

                      <td className="p-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => setViewRecord(rec)}
                          className="px-2.5 py-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="View Full Record Details"
                        >
                          <Eye size={13} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {paginatedRecords.length > 0 && (
              <tfoot className="border-t-2 border-slate-300 bg-slate-100/95 text-xs font-black text-slate-800">
                <tr>
                  <td colSpan={6} className="p-3 text-slate-700 uppercase text-[10px] tracking-wider whitespace-nowrap border-r border-slate-300">
                    Filtered Total ({filteredRecords.length} records)
                  </td>
                  <td className="p-3 text-right font-mono text-slate-800 whitespace-nowrap border-r border-slate-300">
                    {filteredRecords.reduce((acc, r) => acc + (Number(r.openingBalance) || 0), 0).toLocaleString()} L
                  </td>
                  <td className="p-3 text-right font-mono text-emerald-700 whitespace-nowrap border-r border-slate-300">
                    +{filteredRecords.reduce((acc, r) => acc + (Number(r.filledHsd) || 0), 0).toLocaleString()} L
                  </td>
                  <td className="p-3 text-right font-mono text-slate-800 whitespace-nowrap border-r border-slate-300">
                    ={filteredRecords.reduce((acc, r) => acc + (Number(r.closingBalance) || 0), 0).toLocaleString()} L
                  </td>
                  <td className="p-3 text-right font-mono text-indigo-700 bg-indigo-100/70 whitespace-nowrap border-r border-slate-300">
                    ={filteredRecords.reduce((acc, r) => acc + (Number(r.calculatedConsumption) || 0), 0).toLocaleString()} L
                  </td>
                  <td className="p-3 font-mono text-indigo-800 whitespace-nowrap border-r border-slate-300">
                    <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">
                      Total Engine Hrs: {filteredRecords.reduce((acc, r) => {
                        const s = sumDurations(r.engines);
                        const num = parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
                        return acc + (isNaN(num) ? 0 : num);
                      }, 0).toFixed(2)} Hrs
                    </span>
                  </td>
                  <td colSpan={2} className="p-3 text-slate-400 whitespace-nowrap"></td>
                </tr>
              </tfoot>
            )}
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

      {/* Record Detail Modal */}
      <AnimatePresence>
        {viewRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    <Fuel size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight">
                      Machine Fuel Consumption Record
                    </h3>
                    <p className="text-xs text-slate-500">
                      Detailed log breakdown for {viewRecord.machineName}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewRecord(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Record Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/60 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] font-black uppercase">Machine</span>
                  <strong className="text-slate-800 text-sm">{viewRecord.machineName}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-black uppercase">Company</span>
                  <strong className="text-slate-800">{viewRecord.companyName || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-black uppercase">Zone / Division</span>
                  <strong className="text-slate-800">{viewRecord.zoneName || 'N/A'} / {viewRecord.divisionName || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-black uppercase">Recorded Period</span>
                  <strong className="text-indigo-900 font-mono text-[11px]">
                    {formatDateToDDMMYYYY(viewRecord.fromDate)} to {formatDateToDDMMYYYY(viewRecord.toDate)}
                  </strong>
                </div>
              </div>

              {/* Fuel Balances */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black uppercase text-slate-400">Opening Balance</span>
                  <p className="text-lg font-mono font-black text-slate-800 mt-1">{viewRecord.openingBalance} L</p>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="text-[10px] font-black uppercase text-emerald-700">Filled HSD</span>
                  <p className="text-lg font-mono font-black text-emerald-800 mt-1">+{viewRecord.filledHsd} L</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-black uppercase text-slate-400">Closing Balance</span>
                  <p className="text-lg font-mono font-black text-slate-800 mt-1">={viewRecord.closingBalance} L</p>
                </div>
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <span className="text-[10px] font-black uppercase text-indigo-700">Net Consumed</span>
                  <p className="text-lg font-mono font-black text-indigo-900 mt-1">={viewRecord.calculatedConsumption} L</p>
                </div>
              </div>

              {/* Engine Hours Breakdown */}
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock size={14} className="text-indigo-600" />
                  Engine Running Hours Meter Readings
                </h4>
                {viewRecord.engines && viewRecord.engines.length > 0 ? (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100/70 border-b border-slate-200 font-bold text-slate-600">
                        <tr>
                          <th className="p-2.5">Engine Profile</th>
                          <th className="p-2.5 text-right">Opening Meter (Hrs)</th>
                          <th className="p-2.5 text-right">Closing Meter (Hrs)</th>
                          <th className="p-2.5 text-right">Net Duration (Hrs)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {viewRecord.engines.map((e, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 font-bold text-slate-800">{e.name}</td>
                            <td className="p-2.5 text-right font-mono text-slate-600">{e.openingHours}</td>
                            <td className="p-2.5 text-right font-mono text-slate-600">{e.closingHours}</td>
                            <td className="p-2.5 text-right font-mono font-black text-indigo-600">{getSingleEngineDuration(e)} Hrs</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50/80 border-t border-slate-200 font-bold">
                        <tr>
                          <td colSpan={3} className="p-2.5 text-slate-700 uppercase text-[10px] tracking-wider">Total Cumulative Engine Hours</td>
                          <td className="p-2.5 text-right font-mono font-black text-indigo-700">{sumDurations(viewRecord.engines)} Hrs</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl">
                    No specific engines registered for this machine consumption record.
                  </p>
                )}
              </div>

              {/* Report / Remarks */}
              {viewRecord.report && (
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    Report Remarks & Operational Notes
                  </span>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 font-medium">
                    {viewRecord.report}
                  </div>
                </div>
              )}

              {/* Footer Meta */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>Logged by: <strong className="text-slate-600">{viewRecord.createdByName || 'Admin'}</strong></span>
                <span>Created at: {formatDateToDDMMYYYY(viewRecord.createdAt)}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
