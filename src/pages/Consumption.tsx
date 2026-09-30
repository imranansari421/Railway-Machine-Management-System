import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser, getFilterAccessPermissions } from '../utils/employee';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Calendar, Clock, Plus, Trash2, Edit2, Printer, Loader2, Droplet, Building, FileText, CheckCircle, X, ShieldAlert, FileSpreadsheet, Lock, Sparkles, MapPin, Fuel } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { TrackMachineLoader } from '../components/TrackMachineLoader';
import { formatDateToDDMMYYYY } from '../utils/dateUtils';
import { MachineContract, buildMachineContractsMapping } from '../utils/contracts';

interface ConsumptionEngineRow {
  name: string;
  openingHours: string | number;
  closingHours: string | number;
  duration: string | number;
}

const calculateDuration = (opening: string, closing: string): string => {
  if (!opening || !closing) return '';
  
  const opClean = opening.trim();
  const clClean = closing.trim();

  // If both are simple numbers, subtract them
  const opNum = Number(opClean);
  const clNum = Number(clClean);
  if (!isNaN(opNum) && !isNaN(clNum)) {
    return String(Number((clNum - opNum).toFixed(2)));
  }

  // If they contain slash '/'
  if (opClean.includes('/') && clClean.includes('/')) {
    const opParts = opClean.split('/');
    const clParts = clClean.split('/');
    if (opParts.length === clParts.length) {
      const durationParts = clParts.map((clPart, idx) => {
        const o = Number(opParts[idx].trim());
        const c = Number(clPart.trim());
        return !isNaN(o) && !isNaN(c) ? String(Number((c - o).toFixed(2))) : '';
      });
      if (durationParts.every(p => p !== '')) {
        return durationParts.join('/');
      }
    }
  }

  // If they contain comma ','
  if (opClean.includes(',') && clClean.includes(',')) {
    const opParts = opClean.split(',');
    const clParts = clClean.split(',');
    if (opParts.length === clParts.length) {
      const durationParts = clParts.map((clPart, idx) => {
        const o = Number(opParts[idx].trim());
        const c = Number(clPart.trim());
        return !isNaN(o) && !isNaN(c) ? String(Number((c - o).toFixed(2))) : '';
      });
      if (durationParts.every(p => p !== '')) {
        return durationParts.join(',');
      }
    }
  }

  return '';
};

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

const sumDurations = (engines: any[]): string => {
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

interface HSDConsumptionRecord {
  id: string;
  fromDate: string;
  toDate: string;
  machineName: string;
  companyName: string;
  zoneName: string;
  divisionName: string;
  openingBalance: number;
  filledHsd: number;
  closingBalance: number;
  calculatedConsumption: number;
  monthAndYear: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  report?: string;
  engines?: ConsumptionEngineRow[];
}

// Formatting utilities
const formatToDDMMYYYY = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
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

const getMonthNameAndYear = (dateStr: string) => {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const findStableLocation = (movementsList: any[], targetDateStr: string) => {
  if (!targetDateStr || movementsList.length === 0) return null;
  
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) return null;

  // Sort movements chronologically (by fromDateTime ascending)
  const sorted = [...movementsList].sort((a, b) => {
    const dateA = a.fromDateTime ? new Date(a.fromDateTime).getTime() : 0;
    const dateB = b.fromDateTime ? new Date(b.fromDateTime).getTime() : 0;
    return dateA - dateB;
  });

  // 1. If targetDate is before the first movement starts
  const firstMov = sorted[0];
  const firstStart = firstMov.fromDateTime ? new Date(firstMov.fromDateTime) : null;
  if (firstStart && targetDate < firstStart) {
    return {
      zone: firstMov.fromZone || firstMov.toZone || '',
      division: firstMov.fromDivision || firstMov.toDivision || ''
    };
  }

  // 2. Find if targetDate falls during a movement or in a stable gap between movements
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const currentStart = current.fromDateTime ? new Date(current.fromDateTime) : null;
    const currentEnd = current.toDateTime ? new Date(current.toDateTime) : null;
    const next = sorted[i + 1];
    const nextStart = next && next.fromDateTime ? new Date(next.fromDateTime) : null;

    // If targetDate is during the current movement
    if (currentStart && currentEnd && targetDate >= currentStart && targetDate <= currentEnd) {
      // While it is moving, it came from fromZone/fromDivision where it was stable
      return {
        zone: current.fromZone || current.toZone || '',
        division: current.fromDivision || current.toDivision || ''
      };
    }

    // If targetDate is between current movement end and next movement start (i.e. stable at destination)
    if (currentEnd && targetDate > currentEnd && (!nextStart || targetDate < nextStart)) {
      return {
        zone: current.toZone || '',
        division: current.toDivision || ''
      };
    }
  }

  // 3. If targetDate is after the last movement's end
  const lastMov = sorted[sorted.length - 1];
  return {
    zone: lastMov.toZone || '',
    division: lastMov.toDivision || ''
  };
};

export default function Consumption() {
  const [hsdRecords, setHsdRecords] = useState<HSDConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Machine positions and company maps
  const [machineDataMap, setMachineDataMap] = useState<Record<string, { zone: string; division: string; companyName: string }>>({});
  const [movements, setMovements] = useState<any[]>([]);
  const [machinesList, setMachinesList] = useState<string[]>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Registered engine profiles list from firebase
  const [enginesList, setEnginesList] = useState<Array<{ id: string; name: string; machineName?: string }>>([]);

  // HSD Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [machineName, setMachineName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [divisionName, setDivisionName] = useState('');
  const [openingBalance, setOpeningBalance] = useState<number | ''>('');
  const [filledHsd, setFilledHsd] = useState<number | ''>('');
  const [closingBalance, setClosingBalance] = useState<number | ''>('');
  const [report, setReport] = useState('');

  // Filter engines strictly associated with the selected machine
  const availableEngines = useMemo(() => {
    if (!machineName) return [];
    return enginesList.filter(e => e.machineName && e.machineName.trim().toLowerCase() === machineName.trim().toLowerCase());
  }, [enginesList, machineName]);

  // Form engine states (Involved engines list)
  const [reportEngines, setReportEngines] = useState<ConsumptionEngineRow[]>([]);
  const [selectedEngine, setSelectedEngine] = useState('');
  const [engineOpeningHours, setEngineOpeningHours] = useState('');
  const [engineClosingHours, setEngineClosingHours] = useState('');
  const [engineDuration, setEngineDuration] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Engine profile creator popup / state
  const [isAddingEngineProfile, setIsAddingEngineProfile] = useState(false);
  const [newEngineName, setNewEngineName] = useState('');
  const [newEngineMachineName, setNewEngineMachineName] = useState('');

  // User details
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAccessType, setUserAccessType] = useState('limited');
  const isReadOnlyAdmin = isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');
  const [userMachine, setUserMachine] = useState(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });
  const [userName, setUserName] = useState('');

  // Global filters
  const [filterMachine, setFilterMachine] = useState(() => {
    if (auth.currentUser?.uid) {
      return localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) || 'all';
    }
    return 'all';
  });
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
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

  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, userAccessType, employeeProfile, {
      machineName: userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '',
      zone: (employeeProfile?.zone) || localStorage.getItem(`userZone_${auth.currentUser?.uid}`) || '',
      division: (employeeProfile?.division) || localStorage.getItem(`userDivision_${auth.currentUser?.uid}`) || '',
    });
  }, [isEmployee, userAccessType, employeeProfile, userMachine]);

  const handleSelectMachine = (mach: string) => {
    if (!filterPerms.canChangeMachine) return;
    setFilterMachine(mach);
    if (mach !== 'all') {
      const pos = machineDataMap[mach];
      if (pos) {
        if (pos.zone && pos.zone !== 'No Zone Assigned' && filterPerms.canChangeZone) {
          setFilterZone(pos.zone);
        }
        if (pos.division && pos.division !== 'No Division Assigned' && filterPerms.canChangeDivision) {
          setFilterDivision(pos.division);
        }
      }
    }
  };

  const handleSelectZone = (z: string) => {
    if (!filterPerms.canChangeZone) return;
    setFilterZone(z);
    setFilterDivision('all');
    if (z !== 'all' && filterMachine !== 'all') {
      const pos = machineDataMap[filterMachine];
      if (pos && pos.zone && pos.zone !== 'No Zone Assigned' && pos.zone !== z) {
        setFilterMachine('all');
      }
    }
  };

  const handleSelectDivision = (d: string) => {
    if (!filterPerms.canChangeDivision) return;
    setFilterDivision(d);
    if (d !== 'all' && filterMachine !== 'all') {
      const pos = machineDataMap[filterMachine];
      if (pos && pos.division && pos.division !== 'No Division Assigned' && pos.division !== d) {
        setFilterMachine('all');
      }
    }
  };

  // Modal Delete
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);

  // 1. Authenticate & fetch user details
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isEmp = !!user.email?.endsWith('@employee.billedapp.com');
        setIsEmployee(isEmp);
        
        let nameToSet = user.displayName || user.email || 'Anonymous';
        nameToSet = formatCreatorName(nameToSet);
        setUserName(nameToSet);

        try {
          const emp = await findEmployeeForUser(user.uid, user.email);
          if (emp) {
            setEmployeeProfile(emp);
            const access = emp.accessType || 'limited';
            setUserAccessType(access);
            setIsAdmin(access === 'full' || access === 'admin-light' || access === 'divisional-admin' || access === 'zonal-admin');
            const mName = emp.machineName || '';
            const cName = emp.companyName || '';
            setUserMachine(mName);
            setCurrentUserCompanyName(cName);
            localStorage.setItem(`userMachineName_${user.uid}`, mName);
            localStorage.setItem(`companyName_${user.uid}`, cName);
            let empName = emp.name || user.displayName || 'Employee';
            empName = formatCreatorName(empName);
            setUserName(empName);
            if (isEmp) {
              setMachineName(emp.machineName || '');
              if (emp.machineName) setFilterMachine(emp.machineName);
              if (emp.zone) setFilterZone(emp.zone);
              if (emp.division) setFilterDivision(emp.division);
            }
          } else {
            setIsAdmin(true);
          }
        } catch (error) {
          console.error("Error loading employee profile:", error);
        }
      }
    });
    return unsubscribeAuth;
  }, []);

  // 2. Fetch ALL machines list, positions, contracts & companies dynamically
  useEffect(() => {
    let unsubGeneral: () => void = () => {};
    let unsubEmployees: () => void = () => {};
    let unsubContracts: () => void = () => {};

    const unsubPositions = onSnapshot(collection(db, 'machine_positions'), (posSnap) => {
      const posData: Record<string, { zone: string; division: string; companyName?: string }> = {};
      posSnap.forEach((d) => {
        posData[d.id] = {
          zone: d.data().zone || '',
          division: d.data().division || '',
          companyName: d.data().companyName || ''
        };
      });

      unsubGeneral = onSnapshot(doc(db, 'settings', 'general'), (genSnap) => {
        let generalMachines: string[] = [];
        if (genSnap.exists()) {
          const data = genSnap.data();
          if (data.machines && Array.isArray(data.machines)) {
            generalMachines = data.machines;
          }
        }

        unsubEmployees = onSnapshot(collection(db, 'employees'), (empSnap) => {
          const empCompanies: Record<string, string> = {};
          const empCompaniesSet = new Set<string>();
          empSnap.forEach((d) => {
            const data = d.data();
            if (data.companyName) {
              empCompaniesSet.add(data.companyName.trim());
            }
            if (data.machineName && data.companyName) {
              empCompanies[data.machineName.trim()] = data.companyName.trim();
            }
          });

          // Also subscribe to machine_contracts to fetch official company assignments, transfers, and contracts
          unsubContracts = onSnapshot(collection(db, 'machine_contracts'), (contractsSnap) => {
            const rawContracts: MachineContract[] = [];
            const contractCompaniesSet = new Set<string>();

            contractsSnap.forEach((d) => {
              const data = d.data();
              rawContracts.push({ id: d.id, ...data } as MachineContract);
              if (data.companyName) contractCompaniesSet.add(data.companyName.trim());
              if (data.transferredToCompany) contractCompaniesSet.add(data.transferredToCompany.trim());
            });

            // Resolve authoritative contract mappings (handles active, transferred, expired)
            const contractMappings = buildMachineContractsMapping(rawContracts);

            // Combine everything to include ALL created machines in the database
            const combinedMap: Record<string, { zone: string; division: string; companyName: string }> = {};
            const allMachines = new Set([
              ...generalMachines,
              ...Object.keys(posData),
              ...Object.keys(empCompanies),
              ...Object.keys(contractMappings)
            ]);
            
            allMachines.forEach((m) => {
              const mKey = m.trim().toLowerCase();
              const fromContract = contractMappings[mKey]?.companyName;
              const fromPosition = posData[m]?.companyName;
              const fromEmp = empCompanies[m];

              combinedMap[m] = {
                zone: posData[m]?.zone || 'No Zone Assigned',
                division: posData[m]?.division || 'No Division Assigned',
                companyName: fromContract || fromPosition || fromEmp || 'Other / Outside Agency'
              };
            });

            const allCompaniesSet = new Set([...empCompaniesSet, ...contractCompaniesSet]);

            setMachineDataMap(combinedMap);
            const activeMachines = generalMachines.length > 0 ? generalMachines : Array.from(allMachines).filter(Boolean);
            setMachinesList(Array.from(new Set(activeMachines)).filter(Boolean).sort());
            setCompaniesList(Array.from(allCompaniesSet).filter(Boolean).sort());
          });
        });
      });
    });

    return () => {
      unsubPositions();
      unsubGeneral();
      unsubEmployees();
      unsubContracts();
    };
  }, []);

  // 3. Real-time fetch registered engine profiles from 'service_engineer_engines'
  useEffect(() => {
    const unsubEngines = onSnapshot(collection(db, 'service_engineer_engines'), (snap) => {
      const list: Array<{ id: string; name: string; machineName?: string }> = [];
      snap.forEach((d) => {
        list.push({ 
          id: d.id, 
          name: d.data().name || '',
          machineName: d.data().machineName || ''
        });
      });
      setEnginesList(list);
    });
    return unsubEngines;
  }, []);

  // 4. Synchronize HSD consumption reports real-time
  useEffect(() => {
    const unsubscribeHsd = onSnapshot(collection(db, 'consumptions'), (snap) => {
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
          engines: data.engines || []
        });
      });
      list.sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime());
      setHsdRecords(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading consumptions:", error);
    });

    return () => {
      unsubscribeHsd();
    };
  }, []);

  // Fetch machine movements for the selected machine
  useEffect(() => {
    if (!machineName) {
      setMovements([]);
      return;
    }
    const q = query(collection(db, 'machine_movements'), where('machineName', '==', machineName));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setMovements(list);
    }, (error) => {
      console.error("Error loading machine movements:", error);
    });
    return unsubscribe;
  }, [machineName]);

  // 5. Auto-populate Machine Details (Company, Zone, Division) based on machine movements at selected dates
  useEffect(() => {
    if (machineName) {
      // Default / fallback from current machineDataMap
      const details = machineDataMap[machineName];
      const fallbackCompany = details?.companyName || 'Other / Outside Agency';
      const fallbackZone = details?.zone || 'No Zone Assigned';
      const fallbackDivision = details?.division || 'No Division Assigned';

      setCompanyName(fallbackCompany);

      // Try to find historical/stable position based on selected dates
      const targetDate = fromDate || toDate;
      if (targetDate && movements.length > 0) {
        const stableLoc = findStableLocation(movements, targetDate);
        if (stableLoc) {
          setZoneName(stableLoc.zone || 'No Zone Assigned');
          setDivisionName(stableLoc.division || 'No Division Assigned');
          return;
        }
      }

      // If no movements or dates not specified, use current live positions
      setZoneName(fallbackZone);
      setDivisionName(fallbackDivision);
    } else {
      setCompanyName('');
      setZoneName('');
      setDivisionName('');
    }
  }, [machineName, fromDate, toDate, machineDataMap, movements]);

  // Reset selected engine if it does not belong to the selected machine
  useEffect(() => {
    if (selectedEngine && machineName) {
      const match = availableEngines.some(e => e.name === selectedEngine);
      if (!match) {
        setSelectedEngine('');
      }
    } else if (!machineName && selectedEngine) {
      setSelectedEngine('');
    }
  }, [machineName, availableEngines, selectedEngine]);

  // Calculate net consumption dynamically: (Opening Balance + Filled during month) - Closing Balance
  const calculatedConsumption = (Number(openingBalance) || 0) + (Number(filledHsd) || 0) - (Number(closingBalance) || 0);

  // Sync engine duration calculation
  useEffect(() => {
    const calculatedDur = calculateDuration(engineOpeningHours, engineClosingHours);
    setEngineDuration(calculatedDur);
  }, [engineOpeningHours, engineClosingHours]);

  // Add Engine row to current report record
  const handleAddEngineRow = () => {
    if (!selectedEngine) {
      toast.error("Please select an engine profile.");
      return;
    }
    if (engineOpeningHours.trim() === '' || engineClosingHours.trim() === '') {
      toast.error("Please provide both opening and closing hours.");
      return;
    }

    // Avoid duplicate engine row
    if (reportEngines.some(e => e.name === selectedEngine)) {
      toast.error(`Engine '${selectedEngine}' is already added to this log.`);
      return;
    }

    const finalDuration = engineDuration.trim() || calculateDuration(engineOpeningHours, engineClosingHours) || '0';

    setReportEngines(prev => [...prev, {
      name: selectedEngine,
      openingHours: engineOpeningHours.trim(),
      closingHours: engineClosingHours.trim(),
      duration: finalDuration
    }]);

    // Reset inputs
    setSelectedEngine('');
    setEngineOpeningHours('');
    setEngineClosingHours('');
    setEngineDuration('');
    toast.success("Engine added to current log.");
  };

  // Remove Engine row
  const handleRemoveEngineRow = (name: string) => {
    setReportEngines(prev => prev.filter(e => e.name !== name));
    toast.success("Engine removed from log.");
  };

  // Register a new engine profile dynamically to firebase
  const handleCreateEngineProfile = async () => {
    if (!newEngineName.trim()) {
      toast.error("Please enter a valid engine name.");
      return;
    }
    const targetMachine = newEngineMachineName.trim() || machineName.trim();
    if (!targetMachine) {
      toast.error("Please select or associate a machine name.");
      return;
    }
    try {
      await addDoc(collection(db, 'service_engineer_engines'), {
        name: newEngineName.trim(),
        machineName: targetMachine,
        createdAt: new Date().toISOString()
      });
      setSelectedEngine(newEngineName.trim());
      setNewEngineName('');
      setNewEngineMachineName('');
      setIsAddingEngineProfile(false);
      toast.success("Engine profile registered successfully!");
    } catch (err) {
      console.error("Error registering engine profile:", err);
      toast.error("Failed to register engine profile.");
    }
  };

  // Filter consumption records
  const filteredHsdRecords = hsdRecords.filter(rec => {
    if (isEmployee) {
      const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany && rec.companyName && rec.companyName !== myCompany) return false;

      if (userAccessType !== 'admin-light' && userAccessType !== 'divisional-admin' && userAccessType !== 'zonal-admin') {
        const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
        if (myMachine && rec.machineName && rec.machineName !== myMachine) return false;
      }
    }

    // Zone & Division Filters
    if (filterZone !== 'all') {
      const zone = rec.zoneName || machineDataMap[rec.machineName]?.zone || 'N/A';
      if (zone !== filterZone) return false;
    }

    if (filterDivision !== 'all') {
      const division = rec.divisionName || machineDataMap[rec.machineName]?.division || 'N/A';
      if (division !== filterDivision) return false;
    }

    const matchMachine = filterMachine === 'all' || rec.machineName === filterMachine;
    
    let matchDate = true;
    if (filterStartDate) {
      matchDate = matchDate && new Date(rec.fromDate) >= new Date(filterStartDate);
    }
    if (filterEndDate) {
      matchDate = matchDate && new Date(rec.fromDate) <= new Date(filterEndDate);
    }

    return matchMachine && matchDate;
  });

  // Handle save/update submission
  const handleSaveHSD = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromDate || !toDate || !machineName || openingBalance === '' || filledHsd === '' || closingBalance === '') {
      toast.error("Please fill all required inputs.");
      return;
    }

    setSubmitting(true);
    const op = Number(openingBalance);
    const filled = Number(filledHsd);
    const cl = Number(closingBalance);
    const netConsumption = (op + filled) - cl;
    const monthYear = getMonthNameAndYear(fromDate);

    const payload = {
      fromDate,
      toDate,
      machineName,
      companyName: companyName || 'Other / Outside Agency',
      zoneName: zoneName || 'No Zone Assigned',
      divisionName: divisionName || 'No Division Assigned',
      openingBalance: op,
      filledHsd: filled,
      closingBalance: cl,
      calculatedConsumption: netConsumption,
      monthAndYear: monthYear,
      report,
      engines: reportEngines,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, 'consumptions', editingId), payload);
        toast.success("Consumption record updated successfully!");
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'consumptions'), {
          ...payload,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.uid || '',
          createdByName: userName
        });
        toast.success("Consumption record logged successfully!");
      }

      // Reset form states
      setEditingId(null);
      setShowAddModal(false);
      setFromDate('');
      setToDate('');
      if (!isEmployee) setMachineName('');
      setOpeningBalance('');
      setFilledHsd('');
      setClosingBalance('');
      setReport('');
      setReportEngines([]);
    } catch (err) {
      console.error("Error logging consumption:", err);
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'consumptions');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditHSD = (record: HSDConsumptionRecord) => {
    setEditingId(record.id);
    setShowAddModal(true);
    setFromDate(record.fromDate);
    setToDate(record.toDate);
    
    const mName = record.machineName;
    setMachineName(mName);
    
    // Always map with the current active location/movement of the machine
    if (mName && machineDataMap[mName]) {
      const currentDetails = machineDataMap[mName];
      setCompanyName(currentDetails.companyName || 'Other / Outside Agency');
      setZoneName(currentDetails.zone || 'No Zone Assigned');
      setDivisionName(currentDetails.division || 'No Division Assigned');
    } else {
      setCompanyName(record.companyName || 'Other / Outside Agency');
      setZoneName('No Zone Assigned');
      setDivisionName('No Division Assigned');
    }

    setOpeningBalance(record.openingBalance);
    setFilledHsd(record.filledHsd);
    setClosingBalance(record.closingBalance);
    setReport(record.report || '');
    setReportEngines(record.engines || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteHSD = async (id: string) => {
    const rec = hsdRecords.find(r => r.id === id);
    try {
      if (rec) {
        await archiveDeletedRecord({
          originalCollection: 'consumptions',
          originalId: id,
          data: rec,
          moduleName: 'Fuel Consumption & HSD',
          itemSummary: `${rec.machineName || 'Machine'} • ${rec.fromDate} to ${rec.toDate} • ${rec.calculatedConsumption || 0} L`,
          machineName: rec.machineName,
          companyName: rec.companyName,
        });
      }
      await deleteDoc(doc(db, 'consumptions', id));
      toast.success("Consumption record deleted successfully.");
      setRecordToDelete(null);
    } catch (err) {
      console.error("Error deleting consumption:", err);
      handleFirestoreError(err, OperationType.DELETE, `consumptions/${id}`);
    }
  };

  // Printable Report Generation (Landscape)
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to print.");
      return;
    }

    const totalFilled = filteredHsdRecords.reduce((sum, r) => sum + (Number(r.filledHsd) || 0), 0);
    const totalConsumed = filteredHsdRecords.reduce((sum, r) => sum + (Number(r.calculatedConsumption) || 0), 0);

    const headers = ["Sr.", "From Date", "To Date", "Machine Name", "Company", "Zone / Div.", "Opening", "Filled HSD", "Closing", "Net Cons.", "Engine Hours", "Report Details"];
    const rows = filteredHsdRecords.map((rec, idx) => {
      const enginesStr = rec.engines && rec.engines.length > 0
        ? rec.engines.map(e => `<strong>${e.name}:</strong> ${e.openingHours}h - ${e.closingHours}h (${e.duration}h)`).join('<br/>')
        : '-';
      
      return `
        <tr>
          <td style="text-align: center; font-weight: bold; color: #64748b; font-family: monospace;">${idx + 1}</td>
          <td style="font-family: monospace; font-weight: 700; white-space: nowrap !important;">${formatToDDMMYYYY(rec.fromDate)}</td>
          <td style="font-family: monospace; font-weight: 700; white-space: nowrap !important;">${formatToDDMMYYYY(rec.toDate)}</td>
          <td style="font-weight: 700; color: #0f172a; white-space: nowrap !important;">${rec.machineName}</td>
          <td style="font-weight: 500; white-space: nowrap !important;">${rec.companyName || '-'}</td>
          <td style="font-size: 7.5px; white-space: nowrap !important;">${rec.zoneName || '-'}${rec.divisionName ? ` / ${rec.divisionName}` : ''}</td>
          <td style="font-family: monospace; text-align: right; white-space: nowrap !important;">${Number(rec.openingBalance || 0).toFixed(2)} L</td>
          <td style="font-family: monospace; text-align: right; font-weight: bold; color: #047857; white-space: nowrap !important;">+${Number(rec.filledHsd || 0).toFixed(2)} L</td>
          <td style="font-family: monospace; text-align: right; white-space: nowrap !important;">${Number(rec.closingBalance || 0).toFixed(2)} L</td>
          <td style="font-family: monospace; text-align: right; font-weight: 800; color: #4338ca; background-color: #f1f5f9; white-space: nowrap !important;">${Number(rec.calculatedConsumption || 0).toFixed(2)} L</td>
          <td class="wrap-cell" style="font-size: 7px; line-height: 1.25;">${enginesStr}</td>
          <td class="wrap-cell" style="font-size: 7.5px; line-height: 1.25; color: #475569;">${rec.report || '-'}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Machine Fuel Consumption Report</title>
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
            .summary-cards {
              display: flex;
              gap: 12px;
              margin-bottom: 10px;
            }
            .stat-pill {
              background-color: #f8fafc;
              border: 1px solid #cbd5e1;
              padding: 4px 10px;
              border-radius: 6px;
              font-size: 8.5px;
              font-weight: 600;
              color: #334155;
            }
            .stat-pill strong {
              color: #0f172a;
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
              vertical-align: middle;
              white-space: nowrap !important;
            }
            th.wrap-cell, td.wrap-cell {
              white-space: normal !important;
              word-break: break-word;
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
              padding: 4px 4px;
              font-size: 7.5px;
              color: #1e293b;
              line-height: 1.3;
              vertical-align: middle;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 3%; text-align: center; }
            th:nth-child(2), td:nth-child(2) { width: 8.5%; white-space: nowrap !important; font-family: monospace; }
            th:nth-child(3), td:nth-child(3) { width: 8.5%; white-space: nowrap !important; font-family: monospace; }
            th:nth-child(4), td:nth-child(4) { width: 9%; white-space: nowrap !important; }
            th:nth-child(5), td:nth-child(5) { width: 10%; white-space: nowrap !important; }
            th:nth-child(6), td:nth-child(6) { width: 7.5%; white-space: nowrap !important; }
            th:nth-child(7), td:nth-child(7) { width: 6.5%; text-align: right; white-space: nowrap !important; }
            th:nth-child(8), td:nth-child(8) { width: 7%; text-align: right; white-space: nowrap !important; }
            th:nth-child(9), td:nth-child(9) { width: 6.5%; text-align: right; white-space: nowrap !important; }
            th:nth-child(10), td:nth-child(10) { width: 7.5%; text-align: right; font-weight: bold; white-space: nowrap !important; }
            th:nth-child(11), td:nth-child(11) { width: 14%; }
            th:nth-child(12), td:nth-child(12) { width: 12%; }
          </style>
        </head>
        <body>
          <div class="report-header">
            <div>
              <h1 class="report-title">Machine Fuel Consumption & Engine Log Report</h1>
              <div class="report-meta">
                Generated: <strong>${new Date().toLocaleString()}</strong> | 
                ${(isEmployee && (userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`))) || (filterMachine !== 'all') ? `Machine: <strong>${userMachine || (filterMachine !== 'all' ? filterMachine : '')}</strong> | ` : ''}
                Total Entries: <strong>${filteredHsdRecords.length}</strong>
              </div>
            </div>
            <div class="summary-cards">
              <div class="stat-pill">Total Filled HSD: <strong style="color: #047857;">${totalFilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</strong></div>
              <div class="stat-pill">Total Consumption: <strong style="color: #4338ca;">${totalConsumed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</strong></div>
            </div>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="12" style="text-align: center; padding: 15px; color: #64748b;">No consumption records found.</td></tr>'}
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

  // High Fidelity Excel Exporting
  const handleExportExcel = () => {
    if (filteredHsdRecords.length === 0) {
      toast.error("No consumption records to export.");
      return;
    }
    const data = filteredHsdRecords.map(rec => {
      const enginesStr = rec.engines && rec.engines.length > 0
        ? rec.engines.map(e => `${e.name} (${e.openingHours}h - ${e.closingHours}h = ${e.duration}h)`).join(', ')
        : 'None';
      return {
        "From Date": formatToDDMMYYYY(rec.fromDate),
        "To Date": formatToDDMMYYYY(rec.toDate),
        "Machine Name": rec.machineName,
        "Company Name": rec.companyName || 'N/A',
        "Zone Name": rec.zoneName || 'N/A',
        "Division Name": rec.divisionName || 'N/A',
        "Opening Balance (L)": rec.openingBalance,
        "Filled HSD (L)": rec.filledHsd,
        "Closing Balance (L)": rec.closingBalance,
        "Net Consumption (L)": rec.calculatedConsumption,
        "Engines Working Hours": enginesStr,
        "Report Details": rec.report || 'No report notes',
        "Logged By": formatCreatorName(rec.createdByName),
        "Logged Date": rec.createdAt ? formatDateToDDMMYYYY(rec.createdAt) : 'N/A'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const filename = `Machine_Consumption_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Consumption Report");

    // Auto fit columns
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const cols = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      let maxLen = 10;
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.v) {
          maxLen = Math.max(maxLen, String(cell.v).length);
        }
      }
      cols.push({ wch: Math.min(maxLen + 3, 35) });
    }
    worksheet['!cols'] = cols;

    XLSX.writeFile(workbook, filename);
    toast.success("Excel sheet exported successfully!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] py-12">
        <TrackMachineLoader 
          message="Loading Fuel & Oil Consumption Records..." 
          subMessage="Fetching machine diesel logs & engine hour meter history"
          size="md" 
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* LANDSCAPE INPUT FORM PANEL */}
      {!isReadOnlyAdmin ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                <Fuel size={22} />
              </span>
              <div>
                <h1 className="text-base font-black text-slate-900 uppercase tracking-wider">
                  {editingId ? "Edit Consumption Record (Landscape Mode)" : "Log Machine Consumption (Landscape Mode)"}
                </h1>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Record machine fuel stock, diesel issues, and engine operating hours
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setFromDate('');
                    setToDate('');
                    if (!isEmployee) setMachineName('');
                    setOpeningBalance('');
                    setFilledHsd('');
                    setClosingBalance('');
                    setReport('');
                    setReportEngines([]);
                  }}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <Link
                to="/report?tab=consumption"
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
              >
                <FileText size={14} />
                <span>View Consumption Report</span>
              </Link>
            </div>
          </div>

          <form onSubmit={handleSaveHSD} className="space-y-6">
            
            {/* SECTION 1: Period & Machine Selection */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
              <Calendar size={12} />
              01. Period & Machine Selection
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">From Date</label>
                <input
                  id="form-from-date"
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">To Date</label>
                <input
                  id="form-to-date"
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Machine Name</label>
                {isEmployee ? (
                  <input
                    id="form-machine-readonly"
                    type="text"
                    value={machineName}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 text-slate-500 font-bold outline-none"
                    disabled
                  />
                ) : (
                  <select
                    id="form-machine-select"
                    value={machineName}
                    onChange={e => {
                      setMachineName(e.target.value);
                      setSelectedEngine('');
                    }}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                    required
                  >
                    <option value="">Select Machine</option>
                    {machinesList.map(m => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 2: Auto-filled Machine Specifications (Read-Only) */}
          <div className="space-y-3 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
            <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
              <Lock size={12} className="text-slate-400" />
              02. Machine Details (Auto-filled)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Contract / Company Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Building size={12} />
                  </span>
                  <input
                    id="form-company-autofill"
                    type="text"
                    value={companyName}
                    readOnly
                    placeholder="Auto-filled on select"
                    className="w-full text-xs border border-slate-200 bg-slate-100/80 text-slate-500 rounded-xl pl-8 pr-3 py-2 font-bold outline-none cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Zone Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <MapPin size={12} />
                  </span>
                  <input
                    id="form-zone-autofill"
                    type="text"
                    value={zoneName}
                    readOnly
                    placeholder="Auto-filled on select"
                    className="w-full text-xs border border-slate-200 bg-slate-100/80 text-slate-500 rounded-xl pl-8 pr-3 py-2 font-bold outline-none cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Division Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <MapPin size={12} />
                  </span>
                  <input
                    id="form-division-autofill"
                    type="text"
                    value={divisionName}
                    readOnly
                    placeholder="Auto-filled on select"
                    className="w-full text-xs border border-slate-200 bg-slate-100/80 text-slate-500 rounded-xl pl-8 pr-3 py-2 font-bold outline-none cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: H.S.D Fuels Balances & Net Consumption */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
              <Droplet size={12} />
              03. H.S.D Fuels Log & Net Balance
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Opening Balance (Liters)</label>
                <input
                  id="form-opening-balance"
                  type="number"
                  placeholder="e.g. 500"
                  value={openingBalance}
                  onChange={e => setOpeningBalance(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Filler HSD during Month (Liters)</label>
                <input
                  id="form-filled-hsd"
                  type="number"
                  placeholder="e.g. 1200"
                  value={filledHsd}
                  onChange={e => setFilledHsd(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Closing Balance (Liters)</label>
                <input
                  id="form-closing-balance"
                  type="number"
                  placeholder="e.g. 300"
                  value={closingBalance}
                  onChange={e => setClosingBalance(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Net Consumption (Auto-calculated)</label>
                <input
                  id="form-calculated-consumption"
                  type="number"
                  value={calculatedConsumption}
                  readOnly
                  disabled
                  placeholder="Computed instantly"
                  className="w-full text-xs border border-indigo-100 bg-indigo-50/50 text-indigo-700 font-extrabold rounded-xl px-3 py-2 outline-none cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* SECTION 4: Engines Hours Involved (Dual column sub-layout) */}
          <div className="space-y-3 bg-slate-50/30 p-4 border border-slate-200/50 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2 mb-3">
              <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                <Clock size={12} />
                04. Engines Involved & Work Hours
              </h3>
              
              {/* Profile creator button */}
              <button
                type="button"
                id="btn-toggle-engine-creation"
                onClick={() => {
                  if (!isAddingEngineProfile && machineName) {
                    setNewEngineMachineName(machineName);
                  }
                  setIsAddingEngineProfile(prev => !prev);
                }}
                className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-2 py-1 rounded-lg transition-all"
              >
                {isAddingEngineProfile ? "Close Panel" : "Register New Engine Profile"}
              </button>
            </div>

            {/* Sub-Panel: Add dynamic engine profile */}
            <AnimatePresence>
              {isAddingEngineProfile && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-inner"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Create Engine Profile</h4>
                    {machineName && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                        Selected Machine: {machineName}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">Engine name *</label>
                      <input
                        id="form-new-engine-name"
                        type="text"
                        placeholder="e.g. Engine Model C-18"
                        value={newEngineName}
                        onChange={e => setNewEngineName(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">Associate Machine *</label>
                      <select
                        id="form-new-engine-machine"
                        value={newEngineMachineName}
                        onChange={e => setNewEngineMachineName(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                        required
                      >
                        <option value="">Select Machine...</option>
                        {machinesList.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      id="btn-save-engine-profile"
                      onClick={handleCreateEngineProfile}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl border border-indigo-700 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
                    >
                      <CheckCircle size={14} /> Register Profile
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Row Inputs */}
              <div className="lg:col-span-5 space-y-4 bg-white p-4 rounded-xl border border-slate-200/60">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Select & Input Hours</span>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Engine Profile {machineName ? `(Machine: ${machineName})` : ''}
                    </label>
                    <select
                      id="form-engine-select"
                      value={selectedEngine}
                      onChange={e => setSelectedEngine(e.target.value)}
                      disabled={!machineName}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      <option value="">
                        {!machineName
                          ? "Select machine above first..."
                          : availableEngines.length === 0
                            ? "No engine created for this machine (Register above)"
                            : "Select Engine Profile..."}
                      </option>
                      {availableEngines.map(eng => (
                        <option key={eng.id} value={eng.name}>{eng.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Opening Hours</label>
                      <input
                        id="form-engine-opening"
                        type="text"
                        placeholder="e.g. 1024 or 10/20"
                        value={engineOpeningHours}
                        onChange={e => setEngineOpeningHours(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Closing Hours</label>
                      <input
                        id="form-engine-closing"
                        type="text"
                        placeholder="e.g. 1074 or 30/40"
                        value={engineClosingHours}
                        onChange={e => setEngineClosingHours(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Duration (Auto)</label>
                      <input
                        id="form-engine-duration"
                        type="text"
                        value={engineDuration}
                        onChange={e => setEngineDuration(e.target.value)}
                        placeholder="Run hours"
                        className="w-full text-xs border border-slate-200 bg-white text-slate-800 rounded-xl px-3 py-2 font-bold outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      type="button"
                      id="btn-add-engine-row"
                      onClick={handleAddEngineRow}
                      className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs rounded-xl border border-indigo-100 transition-all flex items-center justify-center gap-1 active:scale-95"
                    >
                      <Plus size={14} /> Add Engine Row
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Mini registry of added engines */}
              <div className="lg:col-span-7 bg-white p-4 rounded-xl border border-slate-200/60 flex flex-col justify-between min-h-[220px]">
                <div className="space-y-3">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Added Engines (Working during month)</span>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[320px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="p-2 text-[9px] font-black text-slate-500 uppercase">Engine Name</th>
                          <th className="p-2 text-[9px] font-black text-slate-500 uppercase text-right">Opening</th>
                          <th className="p-2 text-[9px] font-black text-slate-500 uppercase text-right">Closing</th>
                          <th className="p-2 text-[9px] font-black text-slate-500 uppercase text-right">Duration</th>
                          <th className="p-2 text-[9px] font-black text-slate-500 uppercase text-center">Delete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                        {reportEngines.map(e => (
                          <tr key={e.name} className="hover:bg-slate-50/50 font-semibold">
                            <td className="p-2 text-slate-900 font-bold">{e.name}</td>
                            <td className="p-2 text-right font-mono text-slate-500">{e.openingHours}h</td>
                            <td className="p-2 text-right font-mono text-slate-500">{e.closingHours}h</td>
                            <td className="p-2 text-right font-mono text-indigo-600 font-bold">={e.duration}h</td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                id={`btn-remove-engine-${e.name.replace(/\s+/g, '-')}`}
                                onClick={() => handleRemoveEngineRow(e.name)}
                                className="text-slate-400 hover:text-rose-600 transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}

                        {reportEngines.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-slate-400 italic font-medium">
                              No engines added yet. Add engines from the left panel.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Summarized running duration */}
                {reportEngines.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-indigo-900 bg-indigo-50/40 p-3 rounded-xl border border-indigo-50">
                    <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                      <Sparkles size={14} className="text-indigo-600 animate-spin" />
                      Monthly Running Summary
                    </span>
                    <span className="text-xs font-black">
                    Total Running duration:{" "}
                    <span className="font-mono text-sm font-extrabold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-md">
                      {sumDurations(reportEngines)} Hrs
                    </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 5: Report Entry Textarea */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
              <FileText size={12} />
              05. Operations Report & Remarks
            </h3>
            <div>
              <textarea
                id="form-report-textarea"
                rows={3}
                placeholder="Write specific fuel remarks, engine conditions, lubricants reports, greasings status or details of the month..."
                value={report}
                onChange={e => setReport(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-white resize-y"
              />
            </div>
          </div>

          {/* SECTION 6: Submission Actions Row */}
          <div className="flex gap-2.5 justify-end border-t border-slate-100 pt-5">
            {editingId || showAddModal ? (
              <button
                type="button"
                id="btn-cancel-edit"
                onClick={() => {
                  setEditingId(null);
                  setShowAddModal(false);
                  setFromDate('');
                  setToDate('');
                  if (!isEmployee) setMachineName('');
                  setOpeningBalance('');
                  setFilledHsd('');
                  setClosingBalance('');
                  setReport('');
                  setReportEngines([]);
                }}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              id="btn-submit-consumption"
              disabled={submitting}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl border border-indigo-700 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={14} />
              ) : editingId ? (
                <>
                  <CheckCircle size={14} /> Save Changes
                </>
              ) : (
                <>
                  <Plus size={14} /> Save Consumption Log
                </>
              )}
            </button>
          </div>
          </form>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center text-slate-500 font-medium">
          <p className="text-xs text-slate-600 font-bold">
            You have read-only permissions. Please view reports in the{" "}
            <Link to="/report?tab=consumption" className="text-indigo-600 underline">
              Report section
            </Link>.
          </p>
        </div>
      )}
    </div>
  );
}
