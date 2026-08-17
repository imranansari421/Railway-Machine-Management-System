import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Calendar, Clock, Plus, Trash2, Edit2, Printer, Loader2, Droplet, Building, FileText, CheckCircle, X, ShieldAlert, FileSpreadsheet, Lock, Sparkles, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

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

const sumDurations = (engines: ConsumptionEngineRow[]): string => {
  if (!engines || engines.length === 0) return '0';
  
  // If all are numbers, sum them
  const numbers = engines.map(e => Number(e.duration));
  if (numbers.every(n => !isNaN(n))) {
    return String(Number(numbers.reduce((acc, val) => acc + val, 0).toFixed(2)));
  }

  // If there are slashes or commas, let's return a clean join or handle component-wise sum
  const sample = String(engines[0]?.duration || '');
  if (sample.includes('/')) {
    const partsCount = sample.split('/').length;
    const totals = Array(partsCount).fill(0);
    let valid = true;
    for (const e of engines) {
      const parts = String(e.duration).split('/');
      if (parts.length !== partsCount) {
        valid = false;
        break;
      }
      for (let i = 0; i < partsCount; i++) {
        const val = Number(parts[i].trim());
        if (isNaN(val)) {
          valid = false;
          break;
        }
        totals[i] += val;
      }
    }
    if (valid) return totals.map(t => Number(t.toFixed(2))).join('/');
  }

  if (sample.includes(',')) {
    const partsCount = sample.split(',').length;
    const totals = Array(partsCount).fill(0);
    let valid = true;
    for (const e of engines) {
      const parts = String(e.duration).split(',');
      if (parts.length !== partsCount) {
        valid = false;
        break;
      }
      for (let i = 0; i < partsCount; i++) {
        const val = Number(parts[i].trim());
        if (isNaN(val)) {
          valid = false;
          break;
        }
        totals[i] += val;
      }
    }
    if (valid) return totals.map(t => Number(t.toFixed(2))).join(',');
  }

  // Fallback: list individual durations
  return engines.map(e => e.duration).join(' + ');
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
  if (trimmed === '102220971984@billedapp.com' || trimmed.endsWith('@billedapp.com') || trimmed === '102220971984') {
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

  // Form engine states (Involved engines list)
  const [reportEngines, setReportEngines] = useState<ConsumptionEngineRow[]>([]);
  const [selectedEngine, setSelectedEngine] = useState('');
  const [engineOpeningHours, setEngineOpeningHours] = useState('');
  const [engineClosingHours, setEngineClosingHours] = useState('');
  const [engineDuration, setEngineDuration] = useState('');

  // Engine profile creator popup / state
  const [isAddingEngineProfile, setIsAddingEngineProfile] = useState(false);
  const [newEngineName, setNewEngineName] = useState('');
  const [newEngineMachineName, setNewEngineMachineName] = useState('');

  // User details
  const [isEmployee, setIsEmployee] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAccessType, setUserAccessType] = useState('limited');
  const [userMachine, setUserMachine] = useState(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState(() => {
    return localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
  });
  const [userName, setUserName] = useState('');

  // Global filters
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');

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
            const access = emp.accessType || 'limited';
            setUserAccessType(access);
            setIsAdmin(access === 'full' || access === 'admin-light');
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

  // 2. Fetch ALL machines list, positions & companies dynamically (from machine_positions & employees)
  useEffect(() => {
    let unsubGeneral: () => void = () => {};
    let unsubEmployees: () => void = () => {};

    const unsubPositions = onSnapshot(collection(db, 'machine_positions'), (posSnap) => {
      const posData: Record<string, { zone: string; division: string }> = {};
      posSnap.forEach((d) => {
        posData[d.id] = {
          zone: d.data().zone || '',
          division: d.data().division || '',
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
          const companiesSet = new Set<string>();
          empSnap.forEach((d) => {
            const data = d.data();
            if (data.companyName) {
              companiesSet.add(data.companyName.trim());
            }
            if (data.machineName && data.companyName) {
              empCompanies[data.machineName.trim()] = data.companyName.trim();
            }
          });

          // Combine everything to include ALL created machines in the database
          const combinedMap: Record<string, { zone: string; division: string; companyName: string }> = {};
          const allMachines = new Set([
            ...generalMachines,
            ...Object.keys(posData),
            ...Object.keys(empCompanies)
          ]);
          
          allMachines.forEach((m) => {
            combinedMap[m] = {
              zone: posData[m]?.zone || 'No Zone Assigned',
              division: posData[m]?.division || 'No Division Assigned',
              companyName: empCompanies[m] || 'Other / Outside Agency'
            };
          });

          setMachineDataMap(combinedMap);
          setMachinesList(Array.from(allMachines).filter(Boolean).sort());
          setCompaniesList(Array.from(companiesSet).filter(Boolean).sort());
        });
      });
    });

    return () => {
      unsubPositions();
      unsubGeneral();
      unsubEmployees();
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

  // Check if any of the selected/added engines have an associated machine
  const lockedMachineFromEngines = (() => {
    // 1. Check selectedEngine
    if (selectedEngine) {
      const eng = enginesList.find(e => e.name === selectedEngine);
      if (eng && eng.machineName) return eng.machineName;
    }
    // 2. Check reportEngines
    for (const re of reportEngines) {
      const eng = enginesList.find(e => e.name === re.name);
      if (eng && eng.machineName) return eng.machineName;
    }
    return '';
  })();

  // Synchronize machine selection with the locked engine's machine
  useEffect(() => {
    if (lockedMachineFromEngines && machineName !== lockedMachineFromEngines) {
      setMachineName(lockedMachineFromEngines);
    }
  }, [lockedMachineFromEngines, machineName]);

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
    try {
      await addDoc(collection(db, 'service_engineer_engines'), {
        name: newEngineName.trim(),
        machineName: newEngineMachineName,
        createdAt: new Date().toISOString()
      });
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

      if (userAccessType !== 'admin-light') {
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
    try {
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

    const headers = ["From Date", "To Date", "Machine Name", "Company Name", "Zone", "Division", "Opening", "Filled HSD", "Closing", "Net Consumption", "Engine Working Hours", "Report Details"];
    const rows = filteredHsdRecords.map(rec => {
      const enginesStr = rec.engines && rec.engines.length > 0
        ? rec.engines.map(e => `${e.name} (${e.openingHours}h - ${e.closingHours}h = ${e.duration}h)`).join('<br/>')
        : 'None';
      
      return `
        <tr>
          <td style="font-family: monospace;">${formatToDDMMYYYY(rec.fromDate)}</td>
          <td style="font-family: monospace;">${formatToDDMMYYYY(rec.toDate)}</td>
          <td><b>${rec.machineName}</b></td>
          <td>${rec.companyName || 'N/A'}</td>
          <td>${rec.zoneName || 'N/A'}</td>
          <td>${rec.divisionName || 'N/A'}</td>
          <td style="font-family: monospace; text-align: right;">${rec.openingBalance} L</td>
          <td style="font-family: monospace; text-align: right;">${rec.filledHsd} L</td>
          <td style="font-family: monospace; text-align: right;">${rec.closingBalance} L</td>
          <td style="font-family: monospace; text-align: right; font-weight: bold; color: #4f46e5;">${rec.calculatedConsumption} L</td>
          <td style="font-size: 8px; line-height: 1.2;">${enginesStr}</td>
          <td style="font-size: 8px; max-width: 150px; word-break: break-all;">${rec.report || 'No report notes'}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Machine Consumption History Report</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              tr { page-break-inside: avoid; }
            }
            @page {
              size: A4 landscape;
              margin: 8mm 10mm;
            }
            body {
              font-family: 'Inter', -apple-system, sans-serif;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background-color: #fff;
            }
            h1 {
              font-size: 16px;
              font-weight: 850;
              margin: 0 0 4px 0;
              color: #1e1b4b;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 6px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .meta {
              font-size: 9px;
              color: #64748b;
              margin-bottom: 16px;
              font-weight: 600;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            th {
              background-color: #f8fafc;
              border: 1px solid #cbd5e1;
              padding: 6px 8px;
              text-align: left;
              font-size: 8px;
              font-weight: 800;
              text-transform: uppercase;
              color: #475569;
              letter-spacing: 0.2px;
            }
            td {
              border: 1px solid #cbd5e1;
              padding: 6px 8px;
              font-size: 8px;
              color: #334155;
              line-height: 1.3;
              vertical-align: top;
              word-break: break-word;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 8%; }
            th:nth-child(2), td:nth-child(2) { width: 8%; }
            th:nth-child(3), td:nth-child(3) { width: 8%; }
            th:nth-child(4), td:nth-child(4) { width: 9%; }
            th:nth-child(5), td:nth-child(5) { width: 8%; }
            th:nth-child(6), td:nth-child(6) { width: 8%; }
            th:nth-child(7), td:nth-child(7) { width: 6%; }
            th:nth-child(8), td:nth-child(8) { width: 6%; }
            th:nth-child(9), td:nth-child(9) { width: 6%; }
            th:nth-child(10), td:nth-child(10) { width: 8%; }
            th:nth-child(11), td:nth-child(11) { width: 15%; }
            th:nth-child(12), td:nth-child(12) { width: 10%; }
          </style>
        </head>
        <body>
          <h1>Machine Consumption History Report</h1>
          <div class="meta">Generated on ${new Date().toLocaleString()} | Filtered Count: ${filteredHsdRecords.length}</div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="12" style="text-align: center;">No records found.</td></tr>'}
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
        "Logged Date": rec.createdAt ? new Date(rec.createdAt).toLocaleDateString() : 'N/A'
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
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
        <span className="text-sm font-semibold text-slate-500">Loading consumption database...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Title Block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm">
        <div>
          <h1 id="consumption-title" className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2 border-b-0 pb-0">
            <Droplet className="text-indigo-600 animate-pulse" size={24} />
            Consumption Module
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
            Track H.S.D fuels logs, monitor real-time operating hours, and analyze machine utilization metrics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-print-report"
            onClick={handlePrint}
            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black rounded-xl border border-indigo-100 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
          >
            <Printer size={14} />
            Print Report
          </button>
          <button
            id="btn-export-excel"
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-black rounded-xl border border-emerald-100 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
          >
            <FileSpreadsheet size={14} />
            Export Excel
          </button>
        </div>
      </div>

      {/* Global Filter Toolbar */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {!(isEmployee && userAccessType === 'full') ? (
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Filter Machine</label>
            <select
              id="filter-machine-select"
              value={filterMachine}
              onChange={e => setFilterMachine(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold"
            >
              <option value="all">All Machines</option>
              {(isEmployee && userAccessType === 'admin-light'
                ? machinesList.filter(m => machineDataMap[m]?.companyName === (currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || ''))
                : machinesList
              ).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col justify-center">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Assigned Machine</label>
            <div className="flex flex-wrap items-center gap-2">
              {currentUserCompanyName && (
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] px-2.5 py-1 rounded-full font-bold">
                  Company: {currentUserCompanyName}
                </span>
              )}
              {userMachine && (
                <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] px-2.5 py-1 rounded-full font-bold">
                  Machine: {userMachine}
                </span>
              )}
            </div>
          </div>
        )}

        {(!isEmployee || userAccessType === 'admin-light') && (
          <>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Filter Zone</label>
              <select
                value={filterZone}
                onChange={e => {
                  setFilterZone(e.target.value);
                  setFilterDivision('all');
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold"
              >
                <option value="all">All Zones</option>
                {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Filter Division</label>
              <select
                value={filterDivision}
                onChange={e => setFilterDivision(e.target.value)}
                disabled={filterZone === 'all'}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold disabled:opacity-50"
              >
                <option value="all">All Divisions</option>
                {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <div>
          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Start Date</label>
          <input
            id="filter-start-date"
            type="date"
            value={filterStartDate}
            onChange={e => setFilterStartDate(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold"
          />
        </div>

        <div>
          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">End Date</label>
          <input
            id="filter-end-date"
            type="date"
            value={filterEndDate}
            onChange={e => setFilterEndDate(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white font-semibold"
          />
        </div>
      </div>

      {/* LANDSCAPE ENTRY FORM */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-6">
        <h2 id="form-heading" className="text-xs font-black text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100 flex items-center gap-1.5">
          <Plus size={16} className="text-indigo-600" />
          {editingId ? "Edit Consumption Record (Landscape Mode)" : "Log Machine Consumption (Landscape Mode)"}
        </h2>

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
                  <>
                    <select
                      id="form-machine-select"
                      value={machineName}
                      onChange={e => setMachineName(e.target.value)}
                      className={`w-full text-xs border rounded-xl px-3 py-2 outline-none focus:ring-1 bg-white font-semibold ${
                        lockedMachineFromEngines 
                          ? 'border-indigo-300 ring-1 ring-indigo-500/20 text-indigo-900 bg-indigo-50/10' 
                          : 'border-slate-200 focus:ring-indigo-500'
                      }`}
                      required
                    >
                      <option value="">Select Machine</option>
                      {machinesList.map(m => {
                        const isFrozen = lockedMachineFromEngines && m !== lockedMachineFromEngines;
                        return (
                          <option key={m} value={m} disabled={isFrozen}>
                            {m} {isFrozen ? '(Frozen / Freezed)' : ''}
                          </option>
                        );
                      })}
                    </select>
                    {lockedMachineFromEngines && (
                      <span className="text-[10px] text-indigo-600 font-black flex items-center gap-1 mt-1">
                        🔒 Frozen/Locked to engine machine: {lockedMachineFromEngines}
                      </span>
                    )}
                  </>
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
                onClick={() => setIsAddingEngineProfile(prev => !prev)}
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
                  <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Create Engine Profile</h4>
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
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
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
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Engine Profile</label>
                    <select
                      id="form-engine-select"
                      value={selectedEngine}
                      onChange={e => setSelectedEngine(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                    >
                      <option value="">Select Engine</option>
                      {enginesList.map(eng => (
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
            {editingId && (
              <button
                type="button"
                id="btn-cancel-edit"
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
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all"
              >
                Cancel Edit
              </button>
            )}
            <button
              type="submit"
              id="btn-submit-consumption"
              disabled={submitting}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl border border-indigo-700 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:bg-slate-300 disabled:cursor-not-allowed"
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

      {/* REGISTRY TABLE: Full screen landscape view */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
        <h2 id="registry-heading" className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
          Machine Consumption Logs Registry (Landscape)
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Date Period</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Machine Name</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Company Name</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Zone</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Division</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-right">Opening Bal</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-right">Filled HSD</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-right">Closing Bal</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-right">Consumed</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Engines Running Hours</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Report / Remarks</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
              {filteredHsdRecords.map(rec => {
                const isCreator = rec.createdBy === auth.currentUser?.uid;
                const canModify = !isEmployee && (isAdmin || isCreator);
                const company = rec.companyName || machineDataMap[rec.machineName]?.companyName || 'Other / Outside Agency';
                const zone = rec.zoneName || machineDataMap[rec.machineName]?.zone || 'N/A';
                const division = rec.divisionName || machineDataMap[rec.machineName]?.division || 'N/A';
                return (
                  <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-mono text-slate-500">
                      {formatToDDMMYYYY(rec.fromDate)} to {formatToDDMMYYYY(rec.toDate)}
                    </td>
                    <td className="p-3 font-bold text-slate-900">{rec.machineName}</td>
                    <td className="p-3 text-slate-800 font-bold">{company}</td>
                    <td className="p-3 text-slate-500 font-bold">{zone}</td>
                    <td className="p-3 text-slate-500 font-bold">{division}</td>
                    <td className="p-3 text-right font-mono">{rec.openingBalance} L</td>
                    <td className="p-3 text-right font-mono">+{rec.filledHsd} L</td>
                    <td className="p-3 text-right font-mono">={rec.closingBalance} L</td>
                    <td className="p-3 text-right font-black text-indigo-700 font-mono bg-indigo-50/20">={rec.calculatedConsumption} L</td>
                    <td className="p-3 space-y-1">
                      {rec.engines && rec.engines.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {rec.engines.map((e, index) => (
                            <span key={index} className="inline-block bg-slate-100 text-slate-800 text-[9px] px-2 py-0.5 rounded border border-slate-200">
                              <b>{e.name}</b>: {e.openingHours}h → {e.closingHours}h (<b>{e.duration}h</b>)
                            </span>
                          ))}
                          <span className="text-[9px] font-black text-indigo-700">
                            Sum: {sumDurations(rec.engines)} Hrs
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[10px]">None recorded</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-500 font-normal italic max-w-xs break-words">
                      {rec.report || 'No notes'}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canModify && (
                          <>
                            <button
                              id={`btn-edit-rec-${rec.id}`}
                              onClick={() => handleEditHSD(rec)}
                              className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                              title="Edit Record"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              id={`btn-delete-rec-${rec.id}`}
                              onClick={() => setRecordToDelete(rec.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                              title="Delete Record"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredHsdRecords.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400">
                    <FileText className="mx-auto text-slate-300 stroke-[1.5] mb-2" size={28} />
                    No HSD consumption records logged for the selected criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {recordToDelete && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-100 space-y-4"
            >
              <div className="flex items-center gap-2.5 text-rose-600">
                <ShieldAlert size={20} />
                <h3 className="text-sm font-black uppercase tracking-wider">Delete HSD Log?</h3>
              </div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Are you sure you want to delete this H.S.D consumption log? This action cannot be reverted.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  id="btn-cancel-delete"
                  onClick={() => setRecordToDelete(null)}
                  className="px-3.5 py-2 text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete"
                  onClick={() => handleDeleteHSD(recordToDelete)}
                  className="px-3.5 py-2 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold border border-rose-700 transition-colors shadow-sm"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
