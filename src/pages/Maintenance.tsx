import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { findEmployeeForUser, EmployeeProfile, getFilterAccessPermissions } from '../utils/employee';
import { MachineContract, buildMachineContractsMapping, getCompanyByMachine } from '../utils/contracts';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { 
  Wrench, Plus, Trash2, Edit2, Lock, Unlock, Clock, User, 
  Cpu, Building2, Calendar, Search, FileText, CheckCircle2, 
  AlertCircle, X, ChevronRight, Save, ClipboardList, RefreshCw 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface MaintenanceSection {
  id: string;
  title: string;
  details: string;
  status: 'Completed' | 'Pending' | 'In Progress';
}

interface MaintenanceReport {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  machineName: string;
  companyName: string;
  date: string;
  attendedBy: string;
  createdAt: string;
  sections: MaintenanceSection[];
  status: string;
  zone?: string;
  division?: string;
  interval?: string;
  isScheduledMigration?: boolean;
}

// Helper to remove special characters (!@#$%^&*+=~`|<>?{}[];:")
const removeSpecialChars = (val: string) => {
  if (!val) return '';
  return val.replace(/[!@#$%^&*+=~`|<>?{}[\]\\;:"]/g, '');
};

export default function Maintenance() {
  const [activeTab, setActiveTab] = useState<'form' | 'reports'>('form');
  const [isEmployee, setIsEmployee] = useState(true);
  const [accessType, setAccessType] = useState<string>('limited');
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfile | null>(null);
  
  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [machineName, setMachineName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attendedBy, setAttendedBy] = useState('');
  const [selectedInterval, setSelectedInterval] = useState('Daily Schedule');
  const [sections, setSections] = useState<MaintenanceSection[]>([
    { id: '1', title: '', details: '', status: 'Completed' }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [zone, setZone] = useState('');
  const [division, setDivision] = useState('');
  const [movements, setMovements] = useState<any[]>([]);
  const [fallbackZone, setFallbackZone] = useState('');
  const [fallbackDivision, setFallbackDivision] = useState('');

  // 1. Subscribe to machine_positions for fallback position
  useEffect(() => {
    if (!machineName) {
      setFallbackZone('');
      setFallbackDivision('');
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'machine_positions', machineName), (docSnap) => {
      if (docSnap.exists()) {
        const pos = docSnap.data();
        setFallbackZone(pos.zone || '');
        setFallbackDivision(pos.division || '');
      } else {
        setFallbackZone('');
        setFallbackDivision('');
      }
    }, (error) => {
      console.error("Error loading machine fallback position:", error);
    });
    return () => unsubscribe();
  }, [machineName]);

  // 2. Subscribe to machine_movements for this machine
  useEffect(() => {
    if (!machineName) {
      setMovements([]);
      return;
    }
    const q = query(collection(db, 'machine_movements'), where('machineName', '==', machineName));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setMovements(list);
    }, (error) => {
      console.error("Error loading machine movements in Maintenance:", error);
    });
    return () => unsubscribe();
  }, [machineName]);

  // 3. Compute zone and division based on selected machine, movements and selected date
  useEffect(() => {
    if (!machineName) {
      setZone('');
      setDivision('');
      return;
    }

    if (movements.length === 0) {
      setZone(fallbackZone || 'No Zone Assigned');
      setDivision(fallbackDivision || 'No Division Assigned');
      return;
    }

    // Sort movements by fromDateTime ascending to reconstruct history
    const sorted = [...movements].sort((a, b) => {
      const tA = a.fromDateTime || '';
      const tB = b.fromDateTime || '';
      return tA.localeCompare(tB);
    });

    let resolvedZone = fallbackZone || 'No Zone Assigned';
    let resolvedDivision = fallbackDivision || 'No Division Assigned';

    for (const m of sorted) {
      const depDate = (m.fromDateTime || '').split('T')[0];
      const reachDate = (m.toDateTime || '').split('T')[0];

      if (depDate && date >= depDate) {
        if (reachDate && date >= reachDate) {
          resolvedZone = m.toZone || resolvedZone;
          resolvedDivision = m.toDivision || resolvedDivision;
        } else {
          resolvedZone = m.fromZone || resolvedZone;
          resolvedDivision = m.fromDivision || resolvedDivision;
        }
      }
    }

    setZone(resolvedZone);
    setDivision(resolvedDivision);
  }, [machineName, movements, date, fallbackZone, fallbackDivision]);

  // Reports Dashboard State
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [employeesList, setEmployeesList] = useState<{ id: string; name: string; email: string; companyName?: string; machineName?: string }[]>([]);
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [contractCompanyMap, setContractCompanyMap] = useState<Record<string, string>>({});
  const [loadingReports, setLoadingReports] = useState(true);
  
  // Listen to auth state changes
  const [currentUid, setCurrentUid] = useState<string | null>(auth.currentUser?.uid || null);

  // Filters State
  const [filterMachine, setFilterMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterDate, setFilterDate] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('all');
  const [filterZone, setFilterZone] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userZone_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterDivision, setFilterDivision] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userDivision_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterInterval, setFilterInterval] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, accessType, employeeProfile, {
      machineName: machineName || localStorage.getItem(`userMachineName_${currentUid}`) || '',
      zone: (employeeProfile?.zone) || localStorage.getItem(`userZone_${currentUid}`) || '',
      division: (employeeProfile?.division) || localStorage.getItem(`userDivision_${currentUid}`) || '',
    });
  }, [isEmployee, accessType, employeeProfile, machineName, currentUid]);
  
  // Selected report for view detail drawer
  const [selectedReport, setSelectedReport] = useState<MaintenanceReport | null>(null);

  // Time tracker state for dynamic UI lock state updates
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Dynamic state updates for 5-minute ticks
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000); // refresh every 10 seconds
    return () => clearInterval(timer);
  }, []);

  const isAdmin = 
    !isEmployee || 
    accessType === 'full' || 
    accessType === 'admin-light' || 
    auth.currentUser?.email === 'imranansari399605@gmail.com' || 
    auth.currentUser?.email?.endsWith('@billedapp.com');

  const isSuperAdmin = 
    !isEmployee || 
    auth.currentUser?.email === 'imranansari399605@gmail.com' || 
    (auth.currentUser?.email?.endsWith('@billedapp.com') && !auth.currentUser?.email?.endsWith('@employee.billedapp.com'));

  const showZoneDivisionFilter = !isEmployee || accessType === 'admin-light' || accessType === 'zonal-admin' || accessType === 'divisional-admin';
  const isReadOnlyAdmin = isEmployee && (accessType === 'admin-light' || accessType === 'zonal-admin' || accessType === 'divisional-admin');

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUid(user.uid);
      } else {
        setCurrentUid(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Fetch current user and profile details
  useEffect(() => {
    const checkRole = async () => {
      if (!currentUid) return;
      const user = auth.currentUser;
      if (!user) return;
      const email = user.email;
      const isEmp = !!email?.endsWith('@employee.billedapp.com');
      setIsEmployee(isEmp);

      try {
        const emp = await findEmployeeForUser(user.uid, email);
        if (emp) {
          setEmployeeProfile(emp);
          setAccessType(emp.accessType || 'limited');
          if (emp.machineName) {
            setFilterMachine(emp.machineName);
          }
          if (emp.zone) {
            setFilterZone(emp.zone);
          }
          if (emp.division) {
            setFilterDivision(emp.division);
          }
          if (emp.accessType === 'admin-light' || emp.accessType === 'zonal-admin' || emp.accessType === 'divisional-admin') {
            setActiveTab('reports');
          }
          // Autofill for employees
          setMachineName(emp.machineName || '');
          setCompanyName(emp.companyName || '');
          if (!attendedBy) {
            setAttendedBy(removeSpecialChars(emp.name || '').toUpperCase());
          }
        } else {
          setIsEmployee(false);
          setAccessType('full'); // Admin / owner access
        }
      } catch (err) {
        console.error("Error reading employee profile for Maintenance page:", err);
      }
    };

    checkRole();
  }, [currentUid]);

  // Sync maintenance reports
  useEffect(() => {
    if (!currentUid) {
      setReports([]);
      setLoadingReports(true);
      return;
    }
    setLoadingReports(true);

    let mList: MaintenanceReport[] = [];
    let sList: MaintenanceReport[] = [];

    const updateCombinedList = () => {
      const combined = [...mList, ...sList];
      // Sort by createdAt descending
      combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setReports(combined);
      setLoadingReports(false);
    };

    const unsubscribeM = onSnapshot(collection(db, 'maintenance'), (snapshot) => {
      const list: MaintenanceReport[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          employeeId: data.employeeId || '',
          employeeName: data.employeeName || '',
          employeeEmail: data.employeeEmail || '',
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          date: data.date || '',
          attendedBy: data.attendedBy || '',
          createdAt: data.createdAt || '',
          sections: data.sections || [],
          status: data.status || 'submitted',
          zone: data.zone || '',
          division: data.division || '',
          interval: data.interval || 'Daily Schedule',
          isScheduledMigration: false
        });
      });
      mList = list;
      updateCombinedList();
    }, (error) => {
      console.error("Error loading maintenance reports:", error);
      updateCombinedList();
    });

    const unsubscribeS = onSnapshot(collection(db, 'schedule_maintenance'), (snapshot) => {
      const list: MaintenanceReport[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          employeeId: data.employeeId || '',
          employeeName: data.employeeName || '',
          employeeEmail: data.employeeEmail || '',
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          date: data.date || '',
          attendedBy: data.attendedBy || '',
          createdAt: data.createdAt || '',
          sections: data.sections || [],
          status: data.status || 'submitted',
          zone: data.zone || '',
          division: data.division || '',
          interval: data.interval || 'Daily Schedule',
          isScheduledMigration: true
        });
      });
      sList = list;
      updateCombinedList();
    }, (error) => {
      console.error("Error loading schedule_maintenance reports:", error);
      updateCombinedList();
    });

    return () => {
      unsubscribeM();
      unsubscribeS();
    };
  }, [currentUid]);

  // Load all employees for filtering
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const snap = await getDocs(collection(db, 'employees'));
        const list: { id: string; name: string; email: string; companyName?: string; machineName?: string }[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || 'Unknown',
            email: d.email || '',
            companyName: d.companyName || '',
            machineName: d.machineName || ''
          });
        });
        setEmployeesList(list);
      } catch (err) {
        console.error("Error loading employees list:", err);
        handleFirestoreError(err, OperationType.LIST, 'employees');
      }
    };
    loadEmployees();
  }, []);

  // Listen to settings and employees to compile machines and companies lists
  useEffect(() => {
    // 1. Listen to settings/general for machines list
    let settingsMachines: string[] = [];
    let employeeCompanies: string[] = [];
    let employeeMachines: string[] = [];
    let contractCompanies: string[] = [];
    let contractMachines: string[] = [];

    const recompute = () => {
      const allM = Array.from(new Set([...settingsMachines, ...contractMachines, ...employeeMachines])).filter(Boolean).sort();
      const allC = Array.from(new Set([...employeeCompanies, ...contractCompanies])).filter(Boolean).sort();
      if (allM.length > 0) setMachinesList(allM);
      if (allC.length > 0) setCompaniesList(allC);
    };

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          settingsMachines = data.machines;
          recompute();
        }
      }
    });

    // 2. Load all unique companies and any other machines from employees
    const unsubscribeEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      const companiesSet = new Set<string>();
      const machinesSet = new Set<string>();
      
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.companyName) {
          companiesSet.add(data.companyName.trim());
        }
        if (data.machineName) {
          machinesSet.add(data.machineName.trim());
        }
      });

      employeeCompanies = Array.from(companiesSet);
      employeeMachines = Array.from(machinesSet);
      recompute();
    }, (error) => {
      console.error("Error loading employees for dropdowns:", error);
    });

    // 3. Load official contracts to map machineName -> active / transferred / expired company
    const unsubscribeContracts = onSnapshot(collection(db, 'machine_contracts'), (snap) => {
      const rawContracts: MachineContract[] = [];
      const cos = new Set<string>();
      const machs = new Set<string>();

      snap.forEach(d => {
        const data = d.data();
        rawContracts.push({ id: d.id, ...data } as MachineContract);
        if (data.companyName) cos.add(data.companyName.trim());
        if (data.transferredToCompany) cos.add(data.transferredToCompany.trim());
        if (data.machineName) machs.add(data.machineName.trim());
      });

      const mappings = buildMachineContractsMapping(rawContracts);
      const cMap: Record<string, string> = {};
      Object.entries(mappings).forEach(([m, res]) => {
        if (res.companyName) {
          cMap[m.toLowerCase()] = res.companyName;
          cos.add(res.companyName);
        }
      });

      contractCompanies = Array.from(cos);
      contractMachines = Array.from(machs);
      setContractCompanyMap(cMap);
      recompute();
    }, (err) => {
      console.warn("Contracts fetch warning in Maintenance:", err);
    });

    return () => {
      unsubscribeSettings();
      unsubscribeEmployees();
      unsubscribeContracts();
    };
  }, []);

  const handleMachineChange = async (selected: string) => {
    setMachineName(selected);
    if (!selected) {
      if (!isEmployee) setCompanyName('');
      return;
    }

    if (!isEmployee) {
      const key = selected.trim().toLowerCase();
      const autoCo = contractCompanyMap[key];
      if (autoCo) {
        setCompanyName(autoCo);
      } else {
        try {
          const directCo = await getCompanyByMachine(selected);
          if (directCo) setCompanyName(directCo);
        } catch (err) {
          console.error("Error auto-resolving company in Maintenance:", err);
        }
      }
    }
  };

  // Compile unique employees list for filter dropdown
  const uniqueEmployeesForFilter = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; email: string; companyName?: string; machineName?: string }>();

    // Add from employeesList
    employeesList.forEach(emp => {
      map.set(emp.id, emp);
    });

    // Also collect from reports
    reports.forEach(r => {
      if (r.employeeId && !map.has(r.employeeId)) {
        map.set(r.employeeId, {
          id: r.employeeId,
          name: r.employeeName || r.attendedBy || 'Employee',
          email: r.employeeEmail || '',
          companyName: r.companyName,
          machineName: r.machineName
        });
      } else if (r.employeeName && !r.employeeId) {
        const key = `name_${r.employeeName.toLowerCase().trim()}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name: r.employeeName,
            email: r.employeeEmail || '',
            companyName: r.companyName,
            machineName: r.machineName
          });
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employeesList, reports]);

  // Form Section management
  const addSection = () => {
    const newId = (sections.length + 1).toString();
    setSections([...sections, { id: newId, title: '', details: '', status: 'Completed' }]);
  };

  const removeSection = (id: string) => {
    if (sections.length === 1) {
      toast.error("At least one section is required to submit a maintenance report");
      return;
    }
    setSections(sections.filter(s => s.id !== id));
  };

  const updateSectionField = (id: string, field: keyof MaintenanceSection, value: string) => {
    setSections(sections.map(s => {
      if (s.id === id) {
        return { ...s, [field]: value };
      }
      return s;
    }));
  };

  // Helper functions to evaluate permissions
  const getLockStatus = (report: MaintenanceReport) => {
    if (!auth.currentUser) return { editable: false, deletable: false, reason: 'Not authenticated' };
    
    const now = currentTime;
    const createdTime = new Date(report.createdAt).getTime();
    const timeDiffMs = now - createdTime;

    // Super Admin has lifetime access with no changes
    if (isSuperAdmin) {
      return { 
        editable: true, 
        deletable: true, 
        reason: 'Lifetime access (Super Admin)' 
      };
    }

    // Calculate if report date is within the last 3 days (today, yesterday, and day before yesterday)
    const reportDateStr = report.date;
    const getLocalDateStr = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const todayObj = new Date();
    const yesterdayObj = new Date();
    yesterdayObj.setDate(todayObj.getDate() - 1);
    const dayBeforeObj = new Date();
    dayBeforeObj.setDate(todayObj.getDate() - 2);

    const tStr = getLocalDateStr(todayObj);
    const yStr = getLocalDateStr(yesterdayObj);
    const dbStr = getLocalDateStr(dayBeforeObj);

    const isWithin3Days = (reportDateStr === tStr || reportDateStr === yStr || reportDateStr === dbStr);

    // If report is older than 3 days, it is locked for non-Super-Admins
    if (!isWithin3Days) {
      return {
        editable: false,
        deletable: false,
        reason: 'Locked (Access limited to last 3 days)'
      };
    }

    // Sub-admins (full access admin or admin light) have access to edit/delete reports within the last 3 days
    const isSubAdmin = accessType === 'full' || accessType === 'admin-light';
    if (isSubAdmin) {
      return {
        editable: true,
        deletable: true,
        reason: 'Unlocked (Access allowed for last 3 days)'
      };
    }

    // Regular Employee who submitted this report (must be within 5 mins)
    const isOwner = report.employeeId === auth.currentUser.uid;
    if (isOwner) {
      const isWithin5Mins = timeDiffMs < 5 * 60 * 1000;
      return {
        editable: isWithin5Mins,
        deletable: isWithin5Mins,
        reason: isWithin5Mins ? 'Edit & Delete access (Owner - 5 mins limit)' : 'Locked (Owner - 5 mins elapsed)'
      };
    }

    // Standard employee looking at someone else's report
    return {
      editable: false,
      deletable: false,
      reason: 'No access (Report owned by another employee)'
    };
  };

  const handleExportPDF = () => {
    const headers = ["Sr.", "Date", "Machine Name", "Company", "Zone / Div.", "Interval", "Logged By", "Attended By", "Work Details & Checkpoints"];
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to export to PDF.");
      return;
    }
    
    const rowsHtml = filteredReports.map((row, idx) => {
      const sectionsHtml = row.sections && Array.isArray(row.sections) && row.sections.length > 0
        ? row.sections.map((s: any) => `
            <div style="margin-bottom: 3px;">
              <strong>• ${s.title || 'Check'}:</strong> ${s.details || 'Standard'} 
              <span style="font-size: 7px; font-weight: 700; color: #4338ca; padding: 1px 4px; background: #e0e7ff; border-radius: 3px;">${s.status || 'OK'}</span>
            </div>
          `).join('')
        : '-';

      return `
        <tr>
          <td style="text-align: center; font-weight: bold; color: #64748b; font-family: monospace;">${idx + 1}</td>
          <td style="font-family: monospace; font-weight: 600;">${row.date || '-'}</td>
          <td style="font-weight: 700; color: #0f172a;">${row.machineName || '-'}</td>
          <td style="font-weight: 500;">${row.companyName || '-'}</td>
          <td style="font-size: 7.5px;">${row.zone || '-'}${row.division ? ` / ${row.division}` : ''}</td>
          <td style="font-weight: 600; color: #0f766e; font-size: 7.5px;">${row.interval || '-'}</td>
          <td style="font-weight: 600; color: #334155;">${row.employeeName || '-'}</td>
          <td style="font-weight: 700; color: #1e1b4b; text-transform: uppercase; font-size: 7.5px;">${row.attendedBy || '-'}</td>
          <td style="font-size: 7.5px; line-height: 1.25; color: #334155;">${sectionsHtml}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Railway Machine Maintenance Report</title>
          <style>
            *, *:before, *:after {
              box-sizing: border-box;
            }
            @page {
              size: A4 landscape;
              margin: 8mm 10mm;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .no-print { display: none !important; }
              tr { page-break-inside: avoid; break-inside: avoid; }
              thead { display: table-header-group; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background-color: #fff;
              -webkit-print-color-adjust: exact;
            }
            .report-header {
              border-bottom: 2px solid #0f172a;
              padding-bottom: 8px;
              margin-bottom: 12px;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .report-title {
              font-size: 15px;
              font-weight: 800;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 4px 0;
            }
            .report-meta {
              font-size: 8.5px;
              color: #475569;
              font-weight: 600;
              line-height: 1.4;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 4px;
              table-layout: fixed;
              border: 1.5px solid #64748b;
            }
            th, td {
              box-sizing: border-box;
              overflow-wrap: break-word;
              word-wrap: break-word;
              word-break: break-word;
              white-space: normal !important;
              vertical-align: top;
            }
            th {
              background-color: #1e293b !important;
              color: #ffffff !important;
              border: 1px solid #334155;
              padding: 5px 4px;
              text-align: left;
              font-size: 7.5px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              line-height: 1.25;
            }
            td {
              border: 1px solid #94a3b8;
              padding: 4.5px 4px;
              font-size: 7.5px;
              color: #1e293b;
              line-height: 1.3;
              vertical-align: top;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 3%; }
            th:nth-child(2), td:nth-child(2) { width: 7.5%; }
            th:nth-child(3), td:nth-child(3) { width: 8.5%; }
            th:nth-child(4), td:nth-child(4) { width: 8%; }
            th:nth-child(5), td:nth-child(5) { width: 8.5%; }
            th:nth-child(6), td:nth-child(6) { width: 7.5%; }
            th:nth-child(7), td:nth-child(7) { width: 8.5%; }
            th:nth-child(8), td:nth-child(8) { width: 10.5%; }
            th:nth-child(9), td:nth-child(9) { width: 38%; }
          </style>
        </head>
        <body>
          <div class="report-header">
            <div>
              <h1 class="report-title">Railway Machine Maintenance Log Report</h1>
              <div class="report-meta">
                Generated: <strong>${new Date().toLocaleString()}</strong> | 
                ${(isEmployee && (employeeProfile?.machineName || localStorage.getItem(`userMachineName_${currentUid}`))) || (machineName && !isEmployee) ? `Machine: <strong>${employeeProfile?.machineName || localStorage.getItem(`userMachineName_${currentUid}`) || machineName}</strong> | ` : ''}
                Total Maintenance Records: <strong>${filteredReports.length}</strong>
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="9" style="text-align: center; padding: 15px; color: #64748b;">No maintenance records found.</td></tr>'}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.close();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportExcel = () => {
    const headers = ["Date", "Machine Name", "Company", "Logged By", "Attended By", "Work Details"];
    const keys = ["date", "machineName", "companyName", "employeeName", "attendedBy", "sections"];
    const filename = `Maintenance_Report_${new Date().toISOString().split('T')[0]}`;
    
    const csvRows = [headers.join(",")];
    for (const row of filteredReports) {
      const values = keys.map(k => {
        let val = row[k as keyof MaintenanceReport];
        if (k === 'sections' && Array.isArray(val)) {
          val = val.map((s: any) => `${s.title}: ${s.details} [${s.status}]`).join('; ');
        }
        const stringVal = String(val || '').replace(/"/g, '""');
        return `"${stringVal}"`;
      });
      csvRows.push(values.join(","));
    }
    const csvString = csvRows.join("\n");
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Excel/CSV report downloaded successfully!");
  };

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineName.trim()) {
      toast.error("Please enter the machine name");
      return;
    }
    if (!companyName.trim()) {
      toast.error("Please enter the company name");
      return;
    }
    if (!attendedBy.trim()) {
      toast.error("Please enter who attended this maintenance");
      return;
    }

    // Validate sections
    const invalidSection = sections.find(s => !s.title.trim() || !s.details.trim());
    if (invalidSection) {
      toast.error("Please fill in both Title and Details for all sections");
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No authenticated user");

      // 1. Date check: Maintenance last 3 days ka fill kar sake (today, yesterday, and day before yesterday)
      if (!isSuperAdmin) {
        const getLocalDateStr = (d: Date) => {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const tObj = new Date();
        const yObj = new Date();
        yObj.setDate(tObj.getDate() - 1);
        const dbObj = new Date();
        dbObj.setDate(tObj.getDate() - 2);

        const tStr = getLocalDateStr(tObj);
        const yStr = getLocalDateStr(yObj);
        const dbStr = getLocalDateStr(dbObj);

        const isValidDate = (date === tStr || date === yStr || date === dbStr);
        if (!isValidDate) {
          toast.error("You can only submit maintenance reports for the last 3 days (including today).");
          setSubmitting(false);
          return;
        }
      }

      // 2. Duplicate Check: Only applies to regular employees
      if (isEmployee) {
        const isDuplicate = reports.some(r => 
          r.employeeId === user.uid && 
          r.machineName.trim().toLowerCase() === machineName.trim().toLowerCase() && 
          r.date === date && 
          r.id !== editingId
        );

        if (isDuplicate) {
          toast.error(`You have already submitted a maintenance report for ${machineName} on ${date}.`);
          setSubmitting(false);
          return;
        }
      }

      const cleanedAttendedBy = removeSpecialChars(attendedBy).trim().toUpperCase();
      const cleanedSections = sections.map(s => ({
        ...s,
        title: removeSpecialChars(s.title).trim(),
        details: removeSpecialChars(s.details).trim()
      }));

      const reportData = {
        machineName: removeSpecialChars(machineName).trim(),
        companyName: removeSpecialChars(companyName).trim(),
        date,
        attendedBy: cleanedAttendedBy,
        sections: cleanedSections,
        zone,
        division,
        interval: selectedInterval,
        updatedAt: new Date().toISOString()
      };

      if (editingId) {
        // Update existing report
        // First verify they can still edit it
        const currentReport = reports.find(r => r.id === editingId);
        if (!currentReport) {
          toast.error("Report not found");
          setSubmitting(false);
          return;
        }

        const lockInfo = getLockStatus(currentReport);
        if (!lockInfo.editable) {
          toast.error(`Cannot edit report: ${lockInfo.reason}`);
          setSubmitting(false);
          return;
        }

        if (currentReport.isScheduledMigration) {
          await updateDoc(doc(db, 'schedule_maintenance', editingId), reportData);
        } else {
          await updateDoc(doc(db, 'maintenance', editingId), reportData);
        }
        toast.success("Maintenance report updated successfully!");
        setEditingId(null);
      } else {
        // Create new report
        const newReport = {
          ...reportData,
          employeeId: user.uid,
          employeeName: employeeProfile?.name || user.displayName || user.email?.split('@')[0] || 'Employee',
          employeeEmail: user.email || '',
          createdAt: new Date().toISOString(),
          status: 'submitted'
        };

        await addDoc(collection(db, 'maintenance'), newReport);
        toast.success("Maintenance report submitted and forwarded to admins!");
      }

      // Reset form fields
      setSections([{ id: '1', title: '', details: '', status: 'Completed' }]);
      if (!isEmployee) {
        setMachineName('');
        setCompanyName('');
        setAttendedBy('');
      } else {
        // Keep employee info autofilled
        setMachineName(employeeProfile?.machineName || '');
        setCompanyName(employeeProfile?.companyName || '');
        setAttendedBy(removeSpecialChars(employeeProfile?.name || '').toUpperCase());
      }
      setDate(new Date().toISOString().split('T')[0]);
      setZone('');
      setDivision('');
      setSelectedInterval('Daily Schedule');
      
      // Navigate to reports tab
      setActiveTab('reports');
    } catch (err: any) {
      console.error("Error submitting maintenance record:", err);
      toast.error("Failed to submit maintenance report: " + err.message);
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, editingId ? `maintenance/${editingId}` : 'maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditInit = (report: MaintenanceReport) => {
    const lockInfo = getLockStatus(report);
    if (!lockInfo.editable) {
      toast.error(`This record is locked: ${lockInfo.reason}`);
      return;
    }

    setEditingId(report.id);
    setMachineName(removeSpecialChars(report.machineName));
    setCompanyName(removeSpecialChars(report.companyName));
    setDate(report.date);
    setAttendedBy(removeSpecialChars(report.attendedBy).toUpperCase());
    setZone(report.zone || '');
    setDivision(report.division || '');
    setSelectedInterval(report.interval || 'Daily Schedule');
    setSections(report.sections.map((s, index) => ({
      id: s.id || (index + 1).toString(),
      title: removeSpecialChars(s.title),
      details: removeSpecialChars(s.details),
      status: s.status
    })));

    setActiveTab('form');
    setSelectedReport(null); // Close detail modal if open
    toast.info("Report loaded for editing. Please complete your changes.");
  };

  const handleDelete = async (id: string) => {
    const report = reports.find(r => r.id === id);
    if (!report) return;

    const lockInfo = getLockStatus(report);
    if (!lockInfo.deletable) {
      toast.error(`Cannot delete this record: ${lockInfo.reason}`);
      return;
    }

    if (!window.confirm("Are you sure you want to delete this maintenance report? This action cannot be undone.")) {
      return;
    }

    try {
      await archiveDeletedRecord({
        originalCollection: report.isScheduledMigration ? 'schedule_maintenance' : 'maintenance',
        originalId: id,
        data: report,
        moduleName: report.isScheduledMigration ? 'Scheduled Maintenance' : 'Maintenance Record',
        itemSummary: `${report.machineName || 'Machine'} • ${report.date || ''} • ${report.interval || 'Daily'} (Attended: ${report.attendedBy || report.employeeName || 'Staff'})`,
        machineName: report.machineName,
        companyName: report.companyName,
      });

      if (report.isScheduledMigration) {
        await deleteDoc(doc(db, 'schedule_maintenance', id));
      } else {
        await deleteDoc(doc(db, 'maintenance', id));
      }
      toast.success("Maintenance report deleted successfully");
      if (selectedReport?.id === id) {
        setSelectedReport(null);
      }
    } catch (err: any) {
      console.error("Error deleting maintenance report:", err);
      toast.error("Failed to delete record: " + err.message);
      handleFirestoreError(err, OperationType.DELETE, `maintenance/${id}`);
    }
  };

  // Filtered reports calculation
  const filteredReports = reports.filter((report) => {
    if (isEmployee) {
      const myCompany = employeeProfile?.companyName || localStorage.getItem(`companyName_${currentUid}`) || '';
      if (myCompany && report.companyName && report.companyName !== myCompany) return false;

      if (accessType !== 'admin-light') {
        const myMachine = employeeProfile?.machineName || localStorage.getItem(`userMachineName_${currentUid}`) || '';
        if (myMachine && report.machineName && report.machineName !== myMachine) return false;
      }
    }

    // 1. Date Filter
    if (filterDate && report.date !== filterDate) return false;

    // 2. Employee Filter
    if (filterEmployeeId !== 'all') {
      const selectedEmp = uniqueEmployeesForFilter.find(e => e.id === filterEmployeeId);
      if (selectedEmp) {
        const selId = selectedEmp.id.toLowerCase().trim();
        const selName = selectedEmp.name.toLowerCase().trim();
        const selEmail = selectedEmp.email.toLowerCase().trim();

        const repId = (report.employeeId || '').toLowerCase().trim();
        const repName = (report.employeeName || '').toLowerCase().trim();
        const repEmail = (report.employeeEmail || '').toLowerCase().trim();
        const repAttended = (report.attendedBy || '').toLowerCase().trim();

        const matchId = repId && repId === selId;
        const matchEmail = selEmail && repEmail && repEmail === selEmail;
        const matchName = selName && (
          (repName && (repName.includes(selName) || selName.includes(repName))) ||
          (repAttended && (repAttended.includes(selName) || selName.includes(repAttended)))
        );

        if (!matchId && !matchEmail && !matchName) return false;
      } else {
        const q = filterEmployeeId.toLowerCase().trim();
        const matchId = (report.employeeId || '').toLowerCase() === q;
        const matchName = (report.employeeName || '').toLowerCase().includes(q) || (report.attendedBy || '').toLowerCase().includes(q);
        if (!matchId && !matchName) return false;
      }
    }

    // Machine Filter
    if (filterMachine !== 'all' && report.machineName !== filterMachine) return false;

    // Zone Filter
    if (filterZone !== 'all' && report.zone !== filterZone) return false;

    // Division Filter
    if (filterDivision !== 'all' && report.division !== filterDivision) return false;

    // Interval Filter
    if (filterInterval !== 'all') {
      const repInterval = report.interval || 'Daily Schedule';
      if (filterInterval === 'Other') {
        const isStandard = ['Daily Schedule', '50 Hours', '100 Hours', '200 Hours', '250 Hours', '500 Hours', '1000 Hours'].some(val => repInterval.startsWith(val));
        if (isStandard) return false;
      } else {
        if (!repInterval.startsWith(filterInterval)) return false;
      }
    }

    // 3. Text Search (Machine, Company, Employee Name, Attended By)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchMachine = report.machineName.toLowerCase().includes(q);
      const matchCompany = report.companyName.toLowerCase().includes(q);
      const matchEmpName = report.employeeName.toLowerCase().includes(q);
      const matchAttended = report.attendedBy.toLowerCase().includes(q);
      const matchSections = report.sections.some(s => 
        s.title.toLowerCase().includes(q) || s.details.toLowerCase().includes(q)
      );

      if (!matchMachine && !matchCompany && !matchEmpName && !matchAttended && !matchSections) {
        return false;
      }
    }

    return true;
  });

  const getLocalDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getLocalDateStr(new Date());
  const minDateObj = new Date();
  minDateObj.setDate(minDateObj.getDate() - 2);
  const minDateStr = getLocalDateStr(minDateObj);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden">
      
      {/* Fixed Sticky Header for Maintenance Page */}
      <div className="flex-shrink-0 bg-white border border-slate-200/80 rounded-2xl p-4 md:p-6 mb-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-inner">
              <Wrench className="stroke-[2.2]" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Railway Machine Maintenance
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Log and monitor machine inspection logs, service entries, and certifications.
              </p>
            </div>
          </div>

          {/* Current User Assignment Information */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2.5 flex items-center gap-4 text-xs">
            {isEmployee ? (
              <>
                <div className="space-y-0.5">
                  <span className="text-slate-400 block font-bold uppercase tracking-wider text-[9px]">My Machine</span>
                  <span className="font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Cpu size={13} className="text-slate-500" />
                    {employeeProfile?.machineName || "Not Assigned"}
                  </span>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="space-y-0.5">
                  <span className="text-slate-400 block font-bold uppercase tracking-wider text-[9px]">Company</span>
                  <span className="font-extrabold text-indigo-600 flex items-center gap-1.5">
                    <Building2 size={13} className="text-indigo-400" />
                    {employeeProfile?.companyName || "No Company"}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 py-0.5 text-indigo-800 font-bold">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                System Administrator Mode
              </div>
            )}
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-slate-100 mt-6 -mx-4 md:-mx-6 px-4 md:px-6">
          {!isReadOnlyAdmin && (
            <button
              onClick={() => { setActiveTab('form'); setEditingId(null); }}
              className={`py-3 px-4 font-bold text-xs md:text-sm tracking-tight border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'form' 
                  ? 'border-indigo-600 text-indigo-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ClipboardList size={16} />
              {editingId ? 'Edit Maintenance Entry' : 'New Maintenance Entry'}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Data Area - Heading/Headers remain fixed above */}
      <div className="flex-grow overflow-y-auto h-full pr-1">
        
        <AnimatePresence mode="wait">
          {activeTab === 'form' ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-3xl mx-auto pb-12"
            >
              <form onSubmit={handleSubmit} className="bg-white border border-slate-200/80 rounded-2xl shadow-xl p-6 md:p-8 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                    <Wrench size={18} className="text-indigo-600" />
                    {editingId ? 'Modify Maintenance Report' : 'Submit Machine Maintenance Log'}
                  </h2>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setSections([{ id: '1', title: '', details: '', status: 'Completed' }]);
                        if (isEmployee) {
                          setMachineName(employeeProfile?.machineName || '');
                          setCompanyName(employeeProfile?.companyName || '');
                          setAttendedBy(removeSpecialChars(employeeProfile?.name || '').toUpperCase());
                        } else {
                          setMachineName('');
                          setCompanyName('');
                          setAttendedBy('');
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-xs transition-colors"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                {/* Machine Name, Company and Date Controls */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Machine Name
                    </label>
                    <div className="relative">
                      <Cpu className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                      {!isEmployee || accessType === 'admin-light' ? (
                        <select
                          value={machineName}
                          onChange={(e) => handleMachineChange(e.target.value)}
                          className="w-full pl-10 pr-10 py-2.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all cursor-pointer shadow-sm"
                        >
                          <option value="">Select Machine</option>
                          {(isEmployee && accessType === 'admin-light'
                            ? machinesList.filter(m => {
                                const myCompany = employeeProfile?.companyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
                                if (!myCompany) return true;
                                const isContracted = contractCompanyMap[m.toLowerCase()]?.toLowerCase() === myCompany.toLowerCase();
                                if (isContracted) return true;
                                const companyEmployees = employeesList.filter(e => e.companyName === myCompany);
                                const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
                                return companyMachines.has(m);
                              })
                            : machinesList
                          ).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={machineName}
                          onChange={(e) => setMachineName(removeSpecialChars(e.target.value))}
                          disabled={isEmployee && !!employeeProfile?.machineName}
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 disabled:opacity-60 transition-all shadow-sm"
                          placeholder="e.g. Loco Engine 12"
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Company Name
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                      {!isEmployee ? (
                        <select
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          className="w-full pl-10 pr-10 py-2.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all cursor-pointer shadow-sm"
                        >
                          <option value="">Select Company</option>
                          {companiesList.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(removeSpecialChars(e.target.value))}
                          disabled={isEmployee && !!employeeProfile?.companyName}
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 disabled:opacity-60 transition-all shadow-sm"
                          placeholder="e.g. Western Railways"
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Maintenance Date
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                         type="date"
                         value={date}
                         min={isSuperAdmin ? undefined : minDateStr}
                         max={isSuperAdmin ? undefined : todayStr}
                         onChange={(e) => setDate(e.target.value)}
                         className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Maintenance Interval
                    </label>
                    <div className="relative">
                      <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={16} />
                      <select
                        value={selectedInterval}
                        onChange={(e) => setSelectedInterval(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-semibold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all cursor-pointer shadow-sm"
                      >
                        <option value="Daily Schedule">Daily Schedule</option>
                        <option value="50 Hours">50 Hours</option>
                        <option value="100 Hours">100 Hours</option>
                        <option value="200 Hours">200 Hours</option>
                        <option value="250 Hours">250 Hours</option>
                        <option value="500 Hours">500 Hours</option>
                        <option value="1000 Hours">1000 Hours</option>
                        <option value="Other">Other Interval</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Zone and Division (Locked based on selected Machine) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 border border-slate-100 p-4 rounded-xl">
                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Railway Zone
                    </label>
                    <input
                      type="text"
                      value={zone || 'Select a machine first'}
                      disabled
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-slate-700 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                      Division
                    </label>
                    <input
                      type="text"
                      value={zone ? (division || 'No Division') : 'Select a machine first'}
                      disabled
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-slate-700 cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Sections List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                      Work Details & Checklist Sections
                    </span>
                    <button
                      type="button"
                      onClick={addSection}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Plus size={14} />
                      Create Section
                    </button>
                  </div>

                  {sections.map((section, index) => (
                    <div 
                      key={section.id} 
                      className="p-4 border border-slate-200/80 rounded-2xl bg-slate-50/50 space-y-3 relative group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-600">
                          Section #{index + 1}
                        </span>
                        {sections.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSection(section.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all"
                            title="Remove Section"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <input
                            type="text"
                            value={section.title}
                            onChange={(e) => updateSectionField(section.id, 'title', removeSpecialChars(e.target.value))}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            placeholder="Section Title (e.g. Braking System, Cabin Filters)"
                          />
                        </div>
                        <div>
                          <select
                            value={section.status}
                            onChange={(e) => updateSectionField(section.id, 'status', e.target.value as any)}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          >
                            <option value="Completed">Completed</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Pending">Pending</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <textarea
                          rows={2}
                          value={section.details}
                          onChange={(e) => updateSectionField(section.id, 'details', removeSpecialChars(e.target.value))}
                          className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          placeholder="Provide details about findings, repair actions, parts replaced or status updates..."
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Attended By */}
                <div className="border-t border-slate-100 pt-5">
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                    Attended By
                  </label>
                  <div className="relative max-w-md">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      value={attendedBy}
                      onChange={(e) => setAttendedBy(removeSpecialChars(e.target.value).toUpperCase())}
                      style={{ textTransform: 'uppercase' }}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 uppercase focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
                      placeholder="FULL NAME OF TECHNICIAN OR ATTENDEE"
                    />
                  </div>
                </div>

                {/* Submitting Controls */}
                <div className="flex items-center justify-end border-t border-slate-100 pt-5">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm tracking-tight shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <RefreshCw className="animate-spin" size={16} />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save size={16} />
                        {editingId ? 'Update Maintenance Log' : 'Submit and Forward to Admins'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6 pb-12 h-full flex flex-col"
            >
              
              {/* Reports Dashboard Sticky Filters Layout */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 flex-shrink-0">
                
                {/* Date filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Date
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      value={filterDate}
                      onChange={(e) => setFilterDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all"
                    />
                    {filterDate && (
                      <button 
                        onClick={() => setFilterDate('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Employee Filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Employee
                  </label>
                  <select
                    value={filterEmployeeId}
                    onChange={(e) => setFilterEmployeeId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all"
                  >
                    <option value="all">All Employees</option>
                    {uniqueEmployeesForFilter.filter(emp => {
                      if (isEmployee && accessType === 'full') {
                        const myCompany = employeeProfile?.companyName || localStorage.getItem(`companyName_${currentUid}`);
                        const myMachine = employeeProfile?.machineName || localStorage.getItem(`userMachineName_${currentUid}`);
                        return (!emp.companyName || emp.companyName === myCompany) && (!emp.machineName || emp.machineName === myMachine);
                      }
                      if (isEmployee && accessType === 'admin-light') {
                        const myCompany = employeeProfile?.companyName || localStorage.getItem(`companyName_${currentUid}`);
                        return (!emp.companyName || emp.companyName === myCompany);
                      }
                      return true;
                    }).map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name.replace('@employee.billedapp.com', '')}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Machine Filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Machine
                  </label>
                  <select
                    value={filterMachine}
                    onChange={(e) => setFilterMachine(e.target.value)}
                    disabled={!filterPerms.canChangeMachine}
                    title={!filterPerms.canChangeMachine ? "Machine filter locked to your assigned machine" : "Select Machine"}
                    className={cn(
                      "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all",
                      !filterPerms.canChangeMachine && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                    )}
                  >
                    <option value="all">All Machines</option>
                    {machinesList.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Zone Filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Zone
                  </label>
                  <select
                    value={filterZone}
                    onChange={(e) => {
                      if (!filterPerms.canChangeZone) return;
                      setFilterZone(e.target.value);
                      setFilterDivision('all');
                    }}
                    disabled={!filterPerms.canChangeZone}
                    title={!filterPerms.canChangeZone ? "Zone filter locked to your assigned zone" : "Select Zone"}
                    className={cn(
                      "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all",
                      !filterPerms.canChangeZone && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                    )}
                  >
                    <option value="all">All Zones</option>
                    {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>

                {/* Division Filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Division
                  </label>
                  <select
                    value={filterDivision}
                    onChange={(e) => {
                      if (!filterPerms.canChangeDivision) return;
                      setFilterDivision(e.target.value);
                    }}
                    disabled={!filterPerms.canChangeDivision || filterZone === 'all'}
                    title={!filterPerms.canChangeDivision ? "Division filter locked to your assigned division" : "Select Division"}
                    className={cn(
                      "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all disabled:opacity-55",
                      (!filterPerms.canChangeDivision || filterZone === 'all') && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                    )}
                  >
                    <option value="all">All Divisions</option>
                    {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                {/* Interval Filter */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Filter by Interval
                  </label>
                  <select
                    value={filterInterval}
                    onChange={(e) => setFilterInterval(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white transition-all"
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
                </div>

                {/* Search query */}
                <div className={showZoneDivisionFilter ? "sm:col-span-2 xl:col-span-2" : "sm:col-span-2 xl:col-span-4"}>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                    Search Records
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(removeSpecialChars(e.target.value))}
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:bg-white transition-all"
                      placeholder="Search machine, company, attendee, or work details..."
                    />
                  </div>
                </div>

              </div>

              {/* Title & Action Buttons Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider block sm:inline">
                  Records matching filters: <strong className="text-indigo-600">{filteredReports.length}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportPDF}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-black rounded-xl border border-rose-200 transition-all active:scale-95 shadow-sm"
                    title="Export current filtered data to PDF"
                  >
                    <FileText size={13} />
                    Export PDF
                  </button>
                  <button
                    onClick={handleExportExcel}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-black rounded-xl border border-emerald-200 transition-all active:scale-95 shadow-sm"
                    title="Export current filtered data to Excel/CSV"
                  >
                    <Save size={13} />
                    Export Excel
                  </button>
                </div>
              </div>

              {/* Data Table with Sticky Header - ONLY the data scrolls */}
              <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col max-h-[500px]">
                <div className="overflow-x-auto flex-grow overflow-y-auto">
                  
                  {loadingReports ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
                      <RefreshCw className="animate-spin text-indigo-500" size={28} />
                      <span className="text-xs font-bold">Synchronizing records...</span>
                    </div>
                  ) : filteredReports.length === 0 ? (
                    <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                      <ClipboardList size={36} className="text-slate-300 stroke-[1.5]" />
                      <p className="text-xs font-bold">No maintenance reports match your filters</p>
                      <p className="text-[10px]">Create a new maintenance log to see it displayed here.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      
                      {/* Sticky Table Header */}
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200/80 z-10">
                        <tr>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Date
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Machine Name
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Company
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Logged By
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Attended By
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500 text-center">
                            Lock Status
                          </th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500 text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>

                      {/* Scrollable Rows */}
                      <tbody className="divide-y divide-slate-100">
                        {filteredReports.map((report) => {
                          const lockInfo = getLockStatus(report);
                          const createdDate = new Date(report.createdAt);
                          
                          return (
                            <tr 
                              key={report.id} 
                              className="hover:bg-slate-50/60 cursor-pointer transition-all duration-150 group"
                              onClick={() => setSelectedReport(report)}
                            >
                              <td className="py-3.5 px-4">
                                <span className="font-extrabold text-xs text-slate-800 font-mono">
                                  {report.date}
                                </span>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="space-y-1">
                                  <span className="font-extrabold text-xs text-indigo-950 flex items-center gap-1.5">
                                    <Cpu size={13} className="text-slate-400" />
                                    {report.machineName}
                                  </span>
                                  {report.zone && (
                                    <span className="inline-block text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 mr-1">
                                      📍 {report.zone} - {report.division}
                                    </span>
                                  )}
                                  {report.interval && (
                                    <span className="inline-block text-[9px] font-black text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 mr-1">
                                      ⚙️ {report.interval}
                                    </span>
                                  )}
                                  {report.isScheduledMigration && (
                                    <span className="inline-block text-[9px] font-black text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5">
                                      📅 Scheduled
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="font-bold text-xs text-slate-600">
                                  {report.companyName}
                                </span>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="space-y-0.5">
                                  <span className="font-bold text-xs text-slate-800 block">
                                    {report.employeeName ? (
                                      (report.employeeName.trim().endsWith('@billedapp.com') || report.employeeName.trim().toLowerCase() === 'admin') ? 'Admin' : report.employeeName.replace('@employee.billedapp.com', '')
                                    ) : ''}
                                  </span>
                                  <span className="text-[9px] text-slate-400 block font-mono">
                                    {report.employeeEmail ? (
                                      report.employeeEmail.trim().endsWith('@billedapp.com') ? 'Admin' : report.employeeEmail.replace('@employee.billedapp.com', '')
                                    ) : ''}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="font-semibold text-xs text-slate-700">
                                  {report.attendedBy}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <div className="inline-flex justify-center w-full">
                                  {lockInfo.editable ? (
                                    <span 
                                      className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[9px] font-black tracking-wider uppercase flex items-center gap-1 border border-emerald-100" 
                                      title={lockInfo.reason}
                                    >
                                      <Unlock size={10} />
                                      Unlocked
                                    </span>
                                  ) : (
                                    <span 
                                      className="px-2 py-1 bg-rose-50 text-rose-700 rounded-lg text-[9px] font-black tracking-wider uppercase flex items-center gap-1 border border-rose-100"
                                      title={lockInfo.reason}
                                    >
                                      <Lock size={10} />
                                      Locked
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1.5">
                                  
                                  {/* View Detail Indicator */}
                                  <button
                                    onClick={() => setSelectedReport(report)}
                                    className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors"
                                    title="View Details"
                                  >
                                    <ChevronRight size={15} />
                                  </button>

                                  {/* Edit option */}
                                  {lockInfo.editable && !isReadOnlyAdmin && (
                                    <button
                                      onClick={() => handleEditInit(report)}
                                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                      title="Edit Record"
                                    >
                                      <Edit2 size={13} />
                                    </button>
                                  )}

                                  {/* Delete option */}
                                  {lockInfo.deletable && !isReadOnlyAdmin && (
                                    <button
                                      onClick={() => handleDelete(report.id)}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                      title="Delete Record"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}

                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>

                    </table>
                  )}

                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Detail Slide Drawer Overlay */}
      <AnimatePresence>
        {selectedReport && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-50 cursor-pointer"
              onClick={() => setSelectedReport(null)}
            />
            
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 180 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-white shadow-2xl z-50 border-l border-slate-200 overflow-y-auto flex flex-col"
            >
              
              {/* Header */}
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">
                      Maintenance Report Details
                    </h3>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                      Report ID: {selectedReport.id.slice(0, 8)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedReport(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6 flex-grow">
                
                {/* Meta Panel */}
                <div className="grid grid-cols-2 gap-4 p-4 border border-slate-150 rounded-2xl bg-slate-50/50 text-xs">
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Machine</span>
                    <span className="font-extrabold text-slate-800 flex items-center gap-1">
                      <Cpu size={12} className="text-slate-500" />
                      {selectedReport.machineName}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Company</span>
                    <span className="font-extrabold text-indigo-700 flex items-center gap-1">
                      <Building2 size={12} className="text-indigo-500" />
                      {selectedReport.companyName}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Report Date</span>
                    <span className="font-extrabold text-slate-800 flex items-center gap-1">
                      <Calendar size={12} className="text-slate-500" />
                      {selectedReport.date}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Logged By</span>
                    <span className="font-extrabold text-slate-800 flex items-center gap-1">
                      <User size={12} className="text-slate-500" />
                      {selectedReport.employeeName ? (
                        (selectedReport.employeeName.trim().endsWith('@billedapp.com') || selectedReport.employeeName.trim().toLowerCase() === 'admin') ? 'Admin' : selectedReport.employeeName.replace('@employee.billedapp.com', '')
                      ) : ''}
                      {selectedReport.employeeEmail && selectedReport.employeeEmail !== selectedReport.employeeName && (
                        <span className="text-[10px] text-slate-400 font-mono font-normal">
                          ({selectedReport.employeeEmail.trim().endsWith('@billedapp.com') ? 'Admin' : selectedReport.employeeEmail.replace('@employee.billedapp.com', '')})
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Maintenance Interval</span>
                    <span className="font-extrabold text-indigo-700 flex items-center gap-1">
                      <Clock size={12} className="text-indigo-500" />
                      {selectedReport.interval || 'Daily Schedule'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block tracking-wider text-[9px] mb-0.5">Report Origin</span>
                    <span className={`font-extrabold flex items-center gap-1 ${selectedReport.isScheduledMigration ? 'text-teal-700' : 'text-slate-700'}`}>
                      <Calendar size={12} className={selectedReport.isScheduledMigration ? 'text-teal-500' : 'text-slate-500'} />
                      {selectedReport.isScheduledMigration ? 'Scheduled Maintenance' : 'Standard Maintenance Log'}
                    </span>
                  </div>
                </div>

                {/* Lock info info block */}
                <div className="p-3.5 border border-slate-100 rounded-2xl bg-indigo-50/30 flex items-start gap-3">
                  <div className="mt-0.5 text-indigo-600">
                    <Clock size={16} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-800 block">Lock / Access Control Status</span>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                      This record was logged at {new Date(selectedReport.createdAt).toLocaleString()}. 
                      {getLockStatus(selectedReport).reason}
                    </p>
                  </div>
                </div>

                {/* Custom Sections / Work details */}
                <div className="space-y-4">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider block border-b border-slate-100 pb-1.5">
                    Logged Work & Observations
                  </span>

                  {selectedReport.sections.map((section, index) => (
                    <div 
                      key={section.id || index} 
                      className="p-4 border border-slate-200/80 rounded-2xl bg-white shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800">
                          {section.title || "Observation Section"}
                        </span>
                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-lg border tracking-wider ${
                          section.status === 'Completed' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : section.status === 'Pending'
                            ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                        }`}>
                          {section.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/50 p-2.5 rounded-xl border border-slate-100 font-medium">
                        {section.details}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Attended By Details */}
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                    Maintenance Completed By
                  </span>
                  <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 border border-slate-200/60 rounded-2xl text-xs font-extrabold text-slate-800">
                    <CheckCircle2 className="text-emerald-500 shrink-0" size={16} />
                    {selectedReport.attendedBy}
                  </div>
                </div>

              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2 mt-auto">
                {getLockStatus(selectedReport).editable && (
                  <button
                    onClick={() => handleEditInit(selectedReport)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Edit2 size={13} />
                    Edit Record
                  </button>
                )}
                {getLockStatus(selectedReport).deletable && (
                  <button
                    onClick={() => handleDelete(selectedReport.id)}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete Record
                  </button>
                )}
                <button
                  onClick={() => setSelectedReport(null)}
                  className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition-colors"
                >
                  Close View
                </button>
              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
