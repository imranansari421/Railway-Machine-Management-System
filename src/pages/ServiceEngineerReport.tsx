import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, getDoc, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { MachineContract, buildMachineContractsMapping } from '../utils/contracts';
import { Calendar, Clock, Plus, Trash2, Edit2, Search, Printer, Download, Loader2, Building, ShieldCheck, UserCircle, FileText, CheckCircle, X, ShieldAlert, Award, Radio, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { TrackMachineLoader } from '../components/TrackMachineLoader';
import ReportPagination from '../components/reports/ReportPagination';
import { exportReportToPdf } from '../utils/reportExportUtils';

interface ServiceEngineerReportRecord {
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

// Formatting utilities
const escapeHtml = (unsafe: string = '') => {
  return String(unsafe || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const formatToDDMMYYYY = (dateStr: string) => {
  if (!dateStr) return '';
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

export default function ServiceEngineerReport() {
  const [records, setRecords] = useState<ServiceEngineerReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fromVisitDateTime, setFromVisitDateTime] = useState('');
  const [toVisitDateTime, setToVisitDateTime] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [engineerName, setEngineerName] = useState('');
  const [engineerCompanyName, setEngineerCompanyName] = useState('');
  const [engineerCompanyType, setEngineerCompanyType] = useState('OEM');
  const [customCompanyType, setCustomCompanyType] = useState('');
  const [visitReason, setVisitReason] = useState('');
  const [description, setDescription] = useState('');
  const [machineName, setMachineName] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [divisionName, setDivisionName] = useState('');

  // Engine state variables
  const [enginesList, setEnginesList] = useState<Array<{ id: string; name: string; description?: string; createdAt: string; machineName?: string }>>([]);

  // Filter engines strictly associated with the selected machine
  const availableEngines = useMemo(() => {
    if (!machineName) return [];
    return enginesList.filter(e => e.machineName && e.machineName.trim().toLowerCase() === machineName.trim().toLowerCase());
  }, [enginesList, machineName]);

  const [selectedEngine, setSelectedEngine] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [showAddEngineModal, setShowAddEngineModal] = useState(false);
  const [newEngineName, setNewEngineName] = useState('');
  const [newEngineDesc, setNewEngineDesc] = useState('');
  const [newEngineMachineName, setNewEngineMachineName] = useState('');
  const [addingEngine, setAddingEngine] = useState(false);
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null);
  const [reportEngines, setReportEngines] = useState<Array<{ name: string; hours: string }>>([]);

  // Dropdown option states
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [machinesList, setMachinesList] = useState<string[]>([]);
  const [machineDataMap, setMachineDataMap] = useState<Record<string, { zone: string; division: string; companyName: string }>>({});
  const [movements, setMovements] = useState<any[]>([]);

  // User details
  const [isEmployee, setIsEmployee] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userAccessType, setUserAccessType] = useState('limited');
  const isReadOnlyAdmin = isEmployee && (userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');
  const [userName, setUserName] = useState('');

  // Filter States
  const [filterCompany, setFilterCompany] = useState('all');
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Custom modals
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<ServiceEngineerReportRecord | null>(null);

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
            setIsAdmin(access === 'full' || access === 'admin-light' || access === 'divisional-admin' || access === 'zonal-admin');
            let empName = emp.name || user.displayName || 'Employee';
            empName = formatCreatorName(empName);
            setUserName(empName);
            if (isEmp) {
              setCompanyName(emp.companyName || 'Other / Outside Agency');
              const empMachine = emp.machineName || '';
              setMachineName(empMachine);
              if (empMachine) {
                const posDoc = await getDoc(doc(db, 'machine_positions', empMachine));
                if (posDoc.exists()) {
                  const data = posDoc.data();
                  setZoneName(data.zone || 'No Zone Assigned');
                  setDivisionName(data.division || 'No Division Assigned');
                }
              }
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

  // 2. Fetch ALL machines list, positions & companies dynamically
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
          companyName: d.data().companyName || '',
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

          // Subscribe to machine_contracts to fetch official company assignments, transfers, and contracts
          unsubContracts = onSnapshot(collection(db, 'machine_contracts'), (contractsSnap) => {
            const rawContracts: MachineContract[] = [];
            const contractCompaniesSet = new Set<string>();

            contractsSnap.forEach((d) => {
              const data = d.data();
              rawContracts.push({ id: d.id, ...data } as MachineContract);
              if (data.companyName) contractCompaniesSet.add(data.companyName.trim());
              if (data.transferredToCompany) contractCompaniesSet.add(data.transferredToCompany.trim());
            });

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
            setMachinesList(Array.from(allMachines).filter(Boolean).sort());
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

  // 3. Listen to Service Engineer Report records real-time
  useEffect(() => {
    const unsubscribeRecords = onSnapshot(collection(db, 'service_engineer_reports'), (snap) => {
      const list: ServiceEngineerReportRecord[] = [];
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
          createdByName: data.createdByName || 'Admin',
          machineName: data.machineName || '',
          zoneName: data.zoneName || '',
          divisionName: data.divisionName || '',
          engineName: data.engineName || '',
          engineHours: data.engineHours || '',
          engines: data.engines || []
        });
      });
      // Sort chronologically by fromVisitDateTime descending
      list.sort((a, b) => new Date(b.fromVisitDateTime).getTime() - new Date(a.fromVisitDateTime).getTime());
      setRecords(list);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to service engineer reports:", error);
      handleFirestoreError(error, OperationType.LIST, 'service_engineer_reports');
    });

    return unsubscribeRecords;
  }, []);

  // 4. Listen to custom engines list in real-time
  useEffect(() => {
    const unsubEngines = onSnapshot(collection(db, 'service_engineer_engines'), (snap) => {
      const list: Array<{ id: string; name: string; description?: string; createdAt: string; machineName?: string }> = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || '',
          description: data.description || '',
          createdAt: data.createdAt || '',
          machineName: data.machineName || ''
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setEnginesList(list);
    }, (error) => {
      console.error("Error listening to engines:", error);
    });
    return unsubEngines;
  }, []);

  // Submit Handler: Add / Update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromVisitDateTime || !toVisitDateTime || !companyName.trim() || !engineerName.trim() || !engineerCompanyName.trim() || !visitReason.trim() || !description.trim()) {
      toast.error('All fields are required.');
      return;
    }

    setSubmitting(true);
    const dataPayload = {
      fromVisitDateTime,
      toVisitDateTime,
      companyName: companyName.trim(),
      engineerName: engineerName.trim(),
      engineerCompanyName: engineerCompanyName.trim(),
      engineerCompanyType: engineerCompanyType === 'Other' ? customCompanyType.trim() : engineerCompanyType,
      visitReason: visitReason.trim(),
      description: description.trim(),
      machineName: machineName.trim(),
      zoneName: zoneName.trim(),
      divisionName: divisionName.trim(),
      engineName: reportEngines.length > 0 ? reportEngines[0].name : '',
      engineHours: reportEngines.length > 0 ? reportEngines[0].hours : '',
      engines: reportEngines,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingId) {
        // Update existing
        await updateDoc(doc(db, 'service_engineer_reports', editingId), dataPayload);
        toast.success('Service Engineer Report updated successfully!');
        setEditingId(null);
      } else {
        // Add new
        await addDoc(collection(db, 'service_engineer_reports'), {
          ...dataPayload,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.uid || '',
          createdByName: userName
        });
        toast.success('Service Engineer Report logged successfully!');
      }

      // Reset form
      setFromVisitDateTime('');
      setToVisitDateTime('');
      if (!isEmployee) {
        setCompanyName('');
        setMachineName('');
        setZoneName('');
        setDivisionName('');
      }
      setEngineerName('');
      setEngineerCompanyName('');
      setEngineerCompanyType('OEM');
      setCustomCompanyType('');
      setVisitReason('');
      setDescription('');
      setSelectedEngine('');
      setEngineHours('');
      setReportEngines([]);
    } catch (err) {
      console.error("Error saving report:", err);
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'service_engineer_reports');
    } finally {
      setSubmitting(false);
    }
  };

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

  // Auto-populate Machine Details (Company, Zone, Division) based on machine movements at selected dates
  useEffect(() => {
    if (machineName) {
      // Default / fallback from current machineDataMap
      const details = machineDataMap[machineName];
      const fallbackCompany = details?.companyName || 'Other / Outside Agency';
      const fallbackZone = details?.zone || 'No Zone Assigned';
      const fallbackDivision = details?.division || 'No Division Assigned';

      setCompanyName(fallbackCompany);

      // Try to find historical/stable position based on selected dates
      const targetDate = fromVisitDateTime || toVisitDateTime;
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
  }, [machineName, fromVisitDateTime, toVisitDateTime, machineDataMap, movements]);

  const handleMachineChange = (val: string) => {
    setMachineName(val);
  };

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

  // Populate form for editing
  const handleEdit = (record: ServiceEngineerReportRecord) => {
    setEditingId(record.id);
    setFromVisitDateTime(record.fromVisitDateTime);
    setToVisitDateTime(record.toVisitDateTime);
    setEngineerName(record.engineerName);
    setEngineerCompanyName(record.engineerCompanyName || '');
    
    const knownTypes = ['OEM', 'Contractor', 'Railway Departmental', 'Third-Party Inspector'];
    if (record.engineerCompanyType && !knownTypes.includes(record.engineerCompanyType)) {
      setEngineerCompanyType('Other');
      setCustomCompanyType(record.engineerCompanyType);
    } else {
      setEngineerCompanyType(record.engineerCompanyType || 'OEM');
      setCustomCompanyType('');
    }
    
    setVisitReason(record.visitReason);
    setDescription(record.description);
    
    const mName = record.machineName || '';
    setMachineName(mName);
    
    // Dynamically map and use the machine's current active movement location rather than historical saved locations
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

    setSelectedEngine('');
    setEngineHours('');

    if (record.engines && record.engines.length > 0) {
      setReportEngines(record.engines);
    } else if (record.engineName) {
      setReportEngines([{ name: record.engineName, hours: record.engineHours || '' }]);
    } else {
      setReportEngines([]);
    }
    
    // Scroll window smoothly to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Add / Update custom engine handler
  const handleAddEngine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEngineName.trim()) {
      toast.error("Engine Name is required.");
      return;
    }
    const targetMachine = newEngineMachineName.trim() || machineName.trim();
    if (!targetMachine) {
      toast.error("Please select or associate a machine name.");
      return;
    }
    setAddingEngine(true);
    try {
      if (editingEngineId) {
        // Update existing engine profile
        await updateDoc(doc(db, 'service_engineer_engines', editingEngineId), {
          name: newEngineName.trim(),
          description: newEngineDesc.trim(),
          machineName: targetMachine,
          updatedAt: new Date().toISOString()
        });
        toast.success("Engine profile updated successfully!");
        setEditingEngineId(null);
      } else {
        // Add new engine profile
        await addDoc(collection(db, 'service_engineer_engines'), {
          name: newEngineName.trim(),
          description: newEngineDesc.trim(),
          machineName: targetMachine,
          createdAt: new Date().toISOString()
        });
        toast.success("New Engine profile added successfully!");
        setSelectedEngine(newEngineName.trim());
      }
      setNewEngineName('');
      setNewEngineDesc('');
      setNewEngineMachineName('');
      setShowAddEngineModal(false);
    } catch (err) {
      console.error("Error saving engine:", err);
      toast.error("Failed to save Engine profile.");
    } finally {
      setAddingEngine(false);
    }
  };

  // Delete engine profile handler
  const handleDeleteEngine = async (id: string, name: string) => {
    const engineObj = enginesList.find(e => e.id === id);
    if (window.confirm(`Are you sure you want to delete the engine "${name}"? This will not affect existing visit logs that reference this engine name.`)) {
      try {
        if (engineObj) {
          await archiveDeletedRecord({
            originalCollection: 'service_engineer_engines',
            originalId: id,
            data: engineObj,
            moduleName: 'Service Engineer Engine Profile',
            itemSummary: `Engine Profile: ${engineObj.name || name} (${engineObj.machineName || 'Machine'})`,
            machineName: engineObj.machineName,
            companyName: (engineObj as any).companyName,
          });
        }
        await deleteDoc(doc(db, 'service_engineer_engines', id));
        toast.success(`Engine "${name}" deleted successfully.`);
        if (editingEngineId === id) {
          setEditingEngineId(null);
          setNewEngineName('');
          setNewEngineDesc('');
        }
        if (selectedEngine === name) {
          setSelectedEngine('');
        }
      } catch (err) {
        console.error("Error deleting engine:", err);
        toast.error("Failed to delete Engine profile.");
      }
    }
  };

  // Delete Action
  const handleDelete = async (id: string) => {
    const rec = records.find(r => r.id === id);
    try {
      if (rec) {
        await archiveDeletedRecord({
          originalCollection: 'service_engineer_reports',
          originalId: id,
          data: rec,
          moduleName: 'Service Engineer Visit Log',
          itemSummary: `${rec.engineerName} (${rec.engineerCompanyName || 'OEM'}) • ${rec.machineName || 'Machine'} • ${rec.visitReason}`,
          machineName: rec.machineName,
          companyName: rec.companyName,
        });
      }
      await deleteDoc(doc(db, 'service_engineer_reports', id));
      toast.success('Report record deleted successfully.');
      setRecordToDelete(null);
    } catch (err) {
      console.error("Error deleting report:", err);
      handleFirestoreError(err, OperationType.DELETE, `service_engineer_reports/${id}`);
    }
  };

  // High Fidelity Printable Report Generation
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to print.");
      return;
    }

    const headers = [
      "Sr.",
      "Visit Period (From - To)", 
      "Machine Name", 
      "Contractor", 
      "Zone / Div.", 
      "Engineer & Company", 
      "Type", 
      "Engine & Hours",
      "Reason of Visit", 
      "Description & Work Done", 
      "Logged By"
    ];
    
    const rowsHtml = filteredRecords.map((rec, idx) => {
      const enginesListToDisplay = rec.engines && rec.engines.length > 0 
        ? rec.engines 
        : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);
      
      const enginesText = enginesListToDisplay.map(e => `<strong>${escapeHtml(e.name)}</strong>${e.hours ? ` (${escapeHtml(e.hours)}h)` : ''}`).join('<br/>') || '-';

      const formattedDesc = rec.description ? escapeHtml(rec.description).replace(/\n/g, '<br/>') : '-';
      const formattedReason = rec.visitReason ? escapeHtml(rec.visitReason).replace(/\n/g, '<br/>') : '-';

      return `
        <tr>
          <td style="text-align: center; font-weight: bold; color: #475569; font-family: monospace;">${idx + 1}</td>
          <td style="font-family: monospace; font-size: 8px; font-weight: 700; line-height: 1.3; white-space: nowrap !important;">
            <span style="color: #0f172a; font-weight: 700; white-space: nowrap !important;">${formatToDDMMYYYY(rec.fromVisitDateTime)}</span> <span style="color: #64748b; font-size: 7.5px; white-space: nowrap !important;">to</span> <span style="color: #0f172a; font-weight: 700; white-space: nowrap !important;">${formatToDDMMYYYY(rec.toVisitDateTime)}</span>
          </td>
          <td style="font-weight: 800; color: #0f172a; font-size: 8.5px;">${escapeHtml(rec.machineName || '-')}</td>
          <td style="font-weight: 600; color: #334155; font-size: 8px;">${escapeHtml(rec.companyName || '-')}</td>
          <td style="font-size: 8px; line-height: 1.25;">
            <div style="font-weight: 700; color: #0f172a;">${escapeHtml(rec.zoneName || '-')}</div>
            <div style="color: #64748b; font-size: 7.5px;">${escapeHtml(rec.divisionName || '-')}</div>
          </td>
          <td style="font-size: 8.5px; line-height: 1.3;">
            <div style="font-weight: 800; color: #1e293b;">${escapeHtml(rec.engineerName || '-')}</div>
            <div style="color: #475569; font-weight: 600; font-size: 7.5px;">${escapeHtml(rec.engineerCompanyName || '-')}</div>
          </td>
          <td style="text-align: center; font-weight: 700; font-size: 7.5px;">
            <span style="display: inline-block; padding: 2px 4px; background: #e0e7ff; color: #3730a3; border-radius: 4px;">
              ${escapeHtml(rec.engineerCompanyType || 'OEM')}
            </span>
          </td>
          <td style="font-size: 8px; line-height: 1.3; color: #0f172a;">${enginesText}</td>
          <td style="font-weight: 700; color: #312e81; font-size: 8.5px; line-height: 1.35;">${formattedReason}</td>
          <td class="desc-cell" style="font-size: 10px; line-height: 1.45; font-weight: 500; color: #0f172a; white-space: pre-wrap; word-break: break-word;">${formattedDesc}</td>
          <td style="font-weight: 600; color: #475569; font-size: 8px;">${escapeHtml(formatCreatorName(rec.createdByName))}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Services Engineer Report</title>
          <style>
            *, *:before, *:after {
              box-sizing: border-box;
            }
            @page {
              size: A4 landscape;
              margin: 5mm 6mm;
            }
            @media print {
              html, body {
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .no-print { display: none !important; }
              tr { page-break-inside: auto !important; break-inside: auto !important; }
              thead { display: table-header-group !important; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background-color: #fff;
              -webkit-print-color-adjust: exact;
            }
            .report-header {
              border-bottom: 1.5px solid #1e293b;
              padding-bottom: 4px;
              margin-bottom: 6px;
              width: 100%;
            }
            .report-title {
              font-size: 13px;
              font-weight: 900;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 2px 0;
            }
            .report-subtitle {
              font-size: 8.5px;
              font-weight: 700;
              color: #4338ca;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 2px 0;
            }
            .report-meta {
              font-size: 8px;
              color: #475569;
              font-weight: 600;
              line-height: 1.25;
            }
            table {
              width: 100% !important;
              max-width: 100% !important;
              border-collapse: collapse !important;
              margin: 0 !important;
              table-layout: fixed !important;
              border: 1px solid #64748b !important;
              page-break-inside: auto;
            }
            th, td {
              box-sizing: border-box;
              vertical-align: top;
              padding: 4px 3.5px;
              white-space: nowrap !important;
            }
            th {
              background-color: #1e293b !important;
              color: #ffffff !important;
              border: 1px solid #334155;
              text-align: left;
              font-size: 7.5px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              line-height: 1.2;
            }
            td {
              border: 1px solid #cbd5e1;
              color: #1e293b;
              vertical-align: top;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            thead {
              display: table-header-group;
            }
            tbody {
              display: table-row-group;
            }
            tr {
              page-break-inside: auto;
              break-inside: auto;
            }
            th:nth-child(1), td:nth-child(1) { width: 3%; text-align: center; }
            th:nth-child(2), td:nth-child(2) { width: 14% !important; white-space: nowrap !important; }
            th:nth-child(3), td:nth-child(3) { width: 7.5%; white-space: nowrap !important; }
            th:nth-child(4), td:nth-child(4) { width: 7.5%; }
            th:nth-child(5), td:nth-child(5) { width: 7%; }
            th:nth-child(6), td:nth-child(6) { width: 10.5%; }
            th:nth-child(7), td:nth-child(7) { width: 4%; text-align: center; }
            th:nth-child(8), td:nth-child(8) { width: 9%; }
            th:nth-child(9), td:nth-child(9) { width: 10%; }
            th:nth-child(10), td:nth-child(10) { width: 20.5%; }
            th:nth-child(11), td:nth-child(11) { width: 7%; }
            .desc-cell {
              font-size: 8.5px !important;
              font-weight: 500 !important;
              line-height: 1.35 !important;
              color: #0f172a !important;
              white-space: normal !important;
              word-break: break-word !important;
            }
          </style>
        </head>
        <body>
          <div class="report-header">
            <table style="width: 100%; border: none; margin: 0; background: transparent;" border="0">
              <tr>
                <td style="border: none; padding: 0; vertical-align: bottom;">
                  <div class="report-subtitle">INDIAN RAILWAYS • TRACK MACHINES ORGANIZATION</div>
                  <div class="report-title">Services Engineer Visit & Service History Ledger</div>
                </td>
                <td style="border: none; padding: 0; text-align: right; vertical-align: bottom;">
                  <div class="report-meta">
                    Generated: <strong>${new Date().toLocaleString()}</strong><br/>
                    ${(isEmployee && (machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`))) ? `Machine: <strong>${machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`)}</strong><br/>` : ''}
                    Total Visit Logs: <strong>${filteredRecords.length}</strong>
                  </div>
                </td>
              </tr>
            </table>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="11" style="text-align: center; padding: 15px; color: #64748b;">No service engineer records found.</td></tr>'}
            </tbody>
          </table>
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

  // High Fidelity Single Visit Voucher Print Generation
  const handlePrintSingle = (rec: ServiceEngineerReportRecord) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to print.");
      return;
    }

    const enginesListToDisplay = rec.engines && rec.engines.length > 0 
      ? rec.engines 
      : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);
    
    const enginesHtml = enginesListToDisplay.map(e => `
      <div style="padding: 6px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 4px; display: flex; justify-content: space-between;">
        <span style="font-weight: 700; color: #0f172a;">${escapeHtml(e.name)}</span>
        <span style="font-weight: 800; color: #4f46e5;">${e.hours ? `${escapeHtml(e.hours)} Hours` : 'Hours N/A'}</span>
      </div>
    `).join('') || '<div style="color: #94a3b8; font-style: italic;">No specific engine logged</div>';

    const formattedDesc = rec.description ? escapeHtml(rec.description).replace(/\n/g, '<br/>') : 'No description provided';
    const formattedReason = rec.visitReason ? escapeHtml(rec.visitReason).replace(/\n/g, '<br/>') : 'General Inspection';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Service Engineer Visit Voucher - ${escapeHtml(rec.machineName || 'Report')}</title>
          <style>
            *, *:before, *:after { box-sizing: border-box; }
            @page { size: A4 portrait; margin: 8mm 10mm; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .no-print { display: none !important; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
              color: #0f172a;
              background: #fff;
              margin: 0;
              padding: 10px;
            }
            .voucher-card {
              border: 2px solid #1e293b;
              border-radius: 10px;
              padding: 16px;
            }
            .header-block {
              text-align: center;
              border-bottom: 2px solid #0f172a;
              padding-bottom: 10px;
              margin-bottom: 14px;
            }
            .org-title {
              font-size: 16px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 2px 0;
            }
            .sub-title {
              font-size: 11px;
              font-weight: 700;
              color: #4338ca;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 0 0 4px 0;
            }
            .doc-title {
              display: inline-block;
              padding: 3px 14px;
              background: #1e293b;
              color: #fff;
              font-size: 12px;
              font-weight: 800;
              border-radius: 20px;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              margin-top: 4px;
            }
            .grid-2 {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-bottom: 12px;
            }
            .info-box {
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              padding: 3px 0;
              border-bottom: 1px dashed #e2e8f0;
            }
            .info-row:last-child { border-bottom: none; }
            .info-label { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9.5px; }
            .info-val { color: #0f172a; font-weight: 800; }
            .section-label {
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              color: #1e293b;
              margin-bottom: 6px;
              letter-spacing: 0.5px;
            }
            .description-box {
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 12px;
              background: #ffffff;
              font-size: 12.5px;
              line-height: 1.6;
              font-weight: 500;
              color: #0f172a;
              white-space: pre-wrap;
              word-break: break-word;
              min-height: 140px;
              margin-bottom: 14px;
            }
            .signatures-grid {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 12px;
              margin-top: 30px;
              text-align: center;
            }
            .sig-line {
              border-top: 1.5px solid #334155;
              padding-top: 6px;
              font-size: 10px;
              font-weight: 800;
              color: #1e293b;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <div class="voucher-card">
            <div class="header-block">
              <div class="org-title">INDIAN RAILWAYS / TRACK MACHINES ORGANIZATION</div>
              <div class="sub-title">Field Inspection, Maintenance & Service Engineer Visit Record</div>
              <div class="doc-title">SERVICE ENGINEER VISIT VOUCHER</div>
            </div>

            <div class="grid-2">
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Machine Name:</span>
                  <span class="info-val" style="color: #4338ca; font-size: 13px;">${escapeHtml(rec.machineName || 'N/A')}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Contractor Company:</span>
                  <span class="info-val">${escapeHtml(rec.companyName || 'N/A')}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Railway Zone / Div:</span>
                  <span class="info-val">${escapeHtml(rec.zoneName || 'N/A')}${rec.divisionName ? ` / ${escapeHtml(rec.divisionName)}` : ''}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">From Visit Date/Time:</span>
                  <span class="info-val font-mono">${formatToDDMMYYYY(rec.fromVisitDateTime)}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">To Visit Date/Time:</span>
                  <span class="info-val font-mono">${formatToDDMMYYYY(rec.toVisitDateTime)}</span>
                </div>
              </div>

              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Visiting Engineer:</span>
                  <span class="info-val" style="color: #0f172a; font-size: 12px;">${escapeHtml(rec.engineerName || 'N/A')}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Engineer Firm / OEM:</span>
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
                  <span class="info-label">Generated Timestamp:</span>
                  <span class="info-val">${new Date().toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div style="margin-bottom: 12px;">
              <div class="section-label">Engine Details & Working Hours</div>
              ${enginesHtml}
            </div>

            <div>
              <div class="section-label">Description & Detailed Work Carried Out / Inspection Notes</div>
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
                <div class="sig-line">Machine / Depot Official<br/><span style="font-size: 8.5px; font-weight: 500; color: #64748b;">Verified & Recorded</span></div>
              </div>
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

  // High Fidelity Excel Exporting
  const handleExportExcel = () => {
    if (filteredRecords.length === 0) {
      toast.error('No data to export.');
      return;
    }

    const dataToExport = filteredRecords.map(rec => {
      const enginesListToDisplay = rec.engines && rec.engines.length > 0 
        ? rec.engines 
        : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);
      
      const enginesText = enginesListToDisplay.map(e => `${e.name}${e.hours ? ` (${e.hours} Hrs)` : ''}`).join(', ') || 'N/A';

      return {
        "From Visit Date & Time": formatToDDMMYYYY(rec.fromVisitDateTime),
        "To Visit Date & Time": formatToDDMMYYYY(rec.toVisitDateTime),
        "Machine Name": rec.machineName || 'N/A',
        "Contract Company": rec.companyName,
        "Zone Name": rec.zoneName || 'N/A',
        "Division Name": rec.divisionName || 'N/A',
        "Services Engineer Name": rec.engineerName,
        "Services Engineer Company": rec.engineerCompanyName || 'N/A',
        "Company Type": rec.engineerCompanyType || 'N/A',
        "Engine Details": enginesText,
        "Visit Reason": rec.visitReason,
        "Descriptions": rec.description,
        "Logged By": formatCreatorName(rec.createdByName),
        "Logged On": new Date(rec.createdAt).toLocaleString()
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Service Engineer Reports");

    // Auto-fit columns
    const max_len = dataToExport.reduce((acc, row) => {
      Object.keys(row).forEach((key, col_idx) => {
        const val_len = String((row as any)[key] || '').length;
        const key_len = key.length;
        const max = Math.max(val_len, key_len);
        acc[col_idx] = Math.max(acc[col_idx] || 0, max);
      });
      return acc;
    }, [] as number[]);
    worksheet["!cols"] = max_len.map(len => ({ wch: Math.min(Math.max(len + 3, 10), 35) }));

    XLSX.writeFile(workbook, `Service_Engineer_Reports_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Excel report exported successfully!');
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
      filterSummary: `Machine: ${filterMachine} | Company: ${filterCompany} | Records: ${filteredRecords.length}`,
      headers,
      rows,
      filename: `Service_Engineer_Reports_${new Date().toISOString().split('T')[0]}`,
      orientation: 'landscape',
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 46, halign: 'center', fontStyle: 'bold' },
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

  // Filter options
  const filterAvailableMachines = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.machineName) set.add(r.machineName.trim()); });
    machinesList.forEach(m => set.add(m.trim()));
    return Array.from(set).sort();
  }, [records, machinesList]);

  const filterAvailableCompanies = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.companyName) set.add(r.companyName.trim()); });
    companiesList.forEach(c => set.add(c.trim()));
    return Array.from(set).sort();
  }, [records, companiesList]);

  const filterAvailableZones = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.zoneName) set.add(r.zoneName.trim()); });
    return Array.from(set).sort();
  }, [records]);

  // Filter application
  const filteredRecords = useMemo(() => {
    return records.filter(rec => {
      if (filterMachine !== 'all') {
        const sel = filterMachine.trim().toLowerCase();
        if ((rec.machineName || '').trim().toLowerCase() !== sel) return false;
      }

      if (filterCompany !== 'all') {
        const comp = filterCompany.trim().toLowerCase();
        if ((rec.companyName || '').trim().toLowerCase() !== comp) return false;
      }

      if (filterZone !== 'all') {
        const z = filterZone.trim().toLowerCase();
        if ((rec.zoneName || '').trim().toLowerCase() !== z) return false;
      }

      const searchLower = searchQuery.toLowerCase().trim();
      if (searchLower) {
        const matchSearch =
          (rec.engineerName || '').toLowerCase().includes(searchLower) ||
          (rec.engineerCompanyName || '').toLowerCase().includes(searchLower) ||
          (rec.visitReason || '').toLowerCase().includes(searchLower) ||
          (rec.description || '').toLowerCase().includes(searchLower) ||
          (rec.machineName || '').toLowerCase().includes(searchLower) ||
          (rec.companyName || '').toLowerCase().includes(searchLower) ||
          (rec.zoneName || '').toLowerCase().includes(searchLower) ||
          (rec.divisionName || '').toLowerCase().includes(searchLower) ||
          rec.engines?.some(e => e.name?.toLowerCase().includes(searchLower) || e.hours?.toLowerCase().includes(searchLower));

        if (!matchSearch) return false;
      }

      let matchDate = true;
      if (filterStartDate) {
        const itemDate = (rec.fromVisitDateTime || rec.createdAt || '').slice(0, 10);
        if (itemDate && itemDate < filterStartDate) matchDate = false;
      }
      if (filterEndDate) {
        const itemDate = (rec.fromVisitDateTime || rec.createdAt || '').slice(0, 10);
        if (itemDate && itemDate > filterEndDate) matchDate = false;
      }

      return matchDate;
    });
  }, [records, filterMachine, filterCompany, filterZone, searchQuery, filterStartDate, filterEndDate]);

  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const handleResetFilters = () => {
    setFilterMachine('all');
    setFilterCompany('all');
    setFilterZone('all');
    setSearchQuery('');
    setFilterStartDate('');
    setFilterEndDate('');
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] py-12">
        <TrackMachineLoader 
          message="Loading Service Engineer Reports..." 
          subMessage="Fetching machine breakdown logs & service visit history"
          size="md" 
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* LANDSCAPE INPUT FORM PANEL */}
      {!isReadOnlyAdmin && (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                <UserCircle size={22} />
              </span>
              <div>
                <h1 className="text-base font-black text-slate-900 uppercase tracking-wider">
                  {editingId ? "Edit Services Engineer Visit Record" : "Log Services Engineer Visit Record"}
                </h1>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Log machine technical inspection, visiting service engineers, and engine meter hours
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setFromVisitDateTime('');
                    setToVisitDateTime('');
                    if (!isEmployee) {
                      setCompanyName('');
                      setMachineName('');
                      setZoneName('');
                      setDivisionName('');
                    }
                    setEngineerName('');
                    setEngineerCompanyName('');
                    setEngineerCompanyType('OEM');
                    setCustomCompanyType('');
                    setVisitReason('');
                    setDescription('');
                    setSelectedEngine('');
                    setEngineHours('');
                    setReportEngines([]);
                  }}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <Link
                to="/report?tab=service-engineer"
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
              >
                <FileText size={14} />
                <span>View Services Engineer Report</span>
              </Link>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            
            {/* From Visit Date */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                From Visit Date & Time
              </label>
              <input
                type="datetime-local"
                value={fromVisitDateTime}
                onChange={e => setFromVisitDateTime(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                required
              />
            </div>

            {/* To Visit Date */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                To Visit Date & Time
              </label>
              <input
                type="datetime-local"
                value={toVisitDateTime}
                onChange={e => setToVisitDateTime(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                required
              />
            </div>

            {/* Machine Name */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Machine Name
              </label>
              {isEmployee ? (
                <input
                  type="text"
                  value={machineName}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 text-slate-500 font-bold outline-none cursor-not-allowed"
                  disabled
                />
              ) : (
                <select
                  value={machineName}
                  onChange={e => {
                    handleMachineChange(e.target.value);
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

            {/* Contract Company Name - Auto Fill, Non-Editable */}
            <div>
              <label className="block text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-1">
                Company Name (Contract Holder)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Building size={13} />
                </span>
                <input
                  type="text"
                  placeholder="Select machine to auto-fill"
                  value={companyName}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-500 font-bold outline-none cursor-not-allowed"
                  required
                  disabled
                />
              </div>
            </div>

            {/* Zone - Auto Fill, Non-Editable */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Zone Name
              </label>
              <input
                type="text"
                placeholder="Select machine to auto-fill"
                value={zoneName}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 text-slate-500 font-bold outline-none cursor-not-allowed"
                required
                disabled
              />
            </div>

            {/* Division - Auto Fill, Non-Editable */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Division Name
              </label>
              <input
                type="text"
                placeholder="Select machine to auto-fill"
                value={divisionName}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 text-slate-500 font-bold outline-none cursor-not-allowed"
                required
                disabled
              />
            </div>

            {/* Services Engineer Name */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Services Engineer Name
              </label>
              <input
                type="text"
                placeholder="e.g. Mr. S.K. Sharma"
                value={engineerName}
                onChange={e => setEngineerName(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                required
              />
            </div>

            {/* Services Engineer Company Name */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1 col-span-1">
                Services Engineer Company Name
              </label>
              <input
                type="text"
                placeholder="e.g. Plasser India / Caterpillar"
                value={engineerCompanyName}
                onChange={e => setEngineerCompanyName(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                required
              />
            </div>

            {/* Services Engineer Company Type */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Services Engineer Company Type
              </label>
              <select
                value={engineerCompanyType}
                onChange={e => setEngineerCompanyType(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                required
              >
                <option value="OEM">OEM (Original Equipment Manufacturer)</option>
                <option value="Contractor">Contractor Agency</option>
                <option value="Railway Departmental">Railway Departmental</option>
                <option value="Third-Party Inspector">Third-Party Inspector</option>
                <option value="Other">Other / Outside Vendor</option>
              </select>

              {engineerCompanyType === 'Other' && (
                <div className="mt-2">
                  <label className="block text-[9px] font-black text-amber-600 uppercase tracking-wider mb-0.5">
                    Specify Custom Vendor/Type
                  </label>
                  <input
                    type="text"
                    placeholder="Type manual company type..."
                    value={customCompanyType}
                    onChange={e => setCustomCompanyType(e.target.value)}
                    className="w-full text-xs border border-amber-200 rounded-xl px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-amber-500 bg-amber-50/25 font-bold text-slate-800"
                    required
                  />
                </div>
              )}
            </div>

            {/* Engine Selection & Hours (Multi-select / Dynamic list) */}
            <div className="md:col-span-2 bg-slate-50/50 p-4 rounded-2xl border border-slate-100 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Radio size={14} className="text-indigo-600" />
                    Engines Involved ({reportEngines.length})
                  </h3>
                  <p className="text-[10px] text-slate-500 font-semibold">Add one or more engines and their respective hours for this service visit.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEngineId(null);
                    setNewEngineName('');
                    setNewEngineDesc('');
                    if (machineName) {
                      setNewEngineMachineName(machineName);
                    }
                    setShowAddEngineModal(true);
                  }}
                  className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[10px] font-black px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors border border-indigo-100 self-start"
                >
                  <Plus size={12} /> Manage Engine Profiles
                </button>
              </div>

              {/* Temporary Add Row Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-6">
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Select Engine Model {machineName ? `(Machine: ${machineName})` : ''}
                  </label>
                  <select
                    value={selectedEngine}
                    onChange={e => setSelectedEngine(e.target.value)}
                    disabled={!machineName}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!machineName
                        ? "Select machine above first..."
                        : availableEngines.length === 0
                          ? "No engine created for this machine (Use Manage Engine Profiles)"
                          : "Select Engine..."}
                    </option>
                    {availableEngines.map(eng => (
                      <option key={eng.id} value={eng.name}>
                        {eng.name} {eng.description ? `(${eng.description})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Hours Worked
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1240.5, 12/24"
                    value={engineHours}
                    onChange={e => setEngineHours(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedEngine) {
                        toast.error("Please select an engine from the dropdown first.");
                        return;
                      }
                      if (reportEngines.some(e => e.name === selectedEngine)) {
                        toast.error("This engine has already been added to the list.");
                        return;
                      }
                      setReportEngines([...reportEngines, { name: selectedEngine, hours: engineHours.trim() }]);
                      setSelectedEngine('');
                      setEngineHours('');
                    }}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black border border-indigo-700 transition-colors shadow-sm flex items-center justify-center gap-1"
                  >
                    <Plus size={12} /> Add Row
                  </button>
                </div>
              </div>

              {/* Added Engines List */}
              {reportEngines.length > 0 ? (
                <div className="border border-slate-150 rounded-xl overflow-hidden bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-[9px] font-black text-slate-500 uppercase tracking-wider">
                        <th className="p-2 pl-3">#</th>
                        <th className="p-2">Engine Name / Model</th>
                        <th className="p-2">Engine Hours</th>
                        <th className="p-2 text-center w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportEngines.map((item, index) => (
                        <tr key={index} className="hover:bg-slate-50/50 text-[11px] font-medium text-slate-700">
                          <td className="p-2 pl-3 text-slate-400 font-mono">{index + 1}</td>
                          <td className="p-2 font-bold text-slate-900">{item.name}</td>
                          <td className="p-2 font-mono text-indigo-600 font-bold">{item.hours ? `${item.hours} Hours` : 'N/A'}</td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setReportEngines(reportEngines.filter((_, idx) => idx !== index));
                              }}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Remove from list"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-4 border border-dashed border-slate-200 rounded-xl bg-white text-slate-400 text-xs font-bold flex flex-col items-center justify-center gap-1">
                  <Radio size={20} className="stroke-[1.5] text-slate-300 animate-pulse" />
                  No engines added to this report yet.
                </div>
              )}
            </div>

            {/* Reason of Visit */}
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Reason of Visit
              </label>
              <textarea
                placeholder="e.g. Regular Inspection / Failure Rectification"
                value={visitReason}
                onChange={e => setVisitReason(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold min-h-[64px]"
                required
                rows={2}
              />
            </div>

            {/* Descriptions */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                Descriptions / Outcome / Remarks
              </label>
              <textarea
                placeholder="Detail description of visit outcome, recommendations, parts replaced, etc."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold min-h-[64px]"
                required
                rows={2}
              />
            </div>

          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setFromVisitDateTime('');
                  setToVisitDateTime('');
                  if (!isEmployee) {
                    setCompanyName('');
                    setMachineName('');
                    setZoneName('');
                    setDivisionName('');
                  }
                  setEngineerName('');
                  setEngineerCompanyName('');
                  setEngineerCompanyType('OEM');
                  setCustomCompanyType('');
                  setVisitReason('');
                  setDescription('');
                  setSelectedEngine('');
                  setEngineHours('');
                  setReportEngines([]);
                }}
                className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors"
              >
                Cancel Edit
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl border border-indigo-700 transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:bg-slate-300 disabled:border-slate-300 disabled:scale-100"
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={14} />
              ) : editingId ? (
                <>
                  <CheckCircle size={14} /> Update Report Record
                </>
              ) : (
                <>
                  <Plus size={14} /> Save Report Record
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      )}

      {/* Form Ends */}

      {/* Read-Only Admin Notification */}
      {isReadOnlyAdmin && (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center space-y-3">
          <div className="inline-flex p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <FileText size={24} />
          </div>
          <h2 className="text-base font-black text-slate-800 uppercase">Read-Only Admin Access</h2>
          <p className="text-xs text-slate-500 font-semibold max-w-md mx-auto">
            You have read-only access. You can view all logged Services Engineer visit records and inspection reports in the Reports section.
          </p>
          <div>
            <Link
              to="/report?tab=service-engineer"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl shadow-sm transition-all"
            >
              <FileText size={14} />
              <span>Go to Services Engineer Report</span>
            </Link>
          </div>
        </div>
      )}

      {/* Engine Manager Modal */}
      <AnimatePresence>
        {showAddEngineModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Radio size={18} />
                  <h3 className="text-sm font-black uppercase tracking-wider">
                    {editingEngineId ? 'Edit Engine Profile' : 'Add New Engine Profile'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddEngineModal(false);
                    setNewEngineName('');
                    setNewEngineDesc('');
                    setEditingEngineId(null);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleAddEngine} className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Engine Name / Model *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Cummins QSK19 / CAT 3512"
                      value={newEngineName}
                      onChange={e => setNewEngineName(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Engine Details / Data (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Engine Sl No. / HP Rating"
                      value={newEngineDesc}
                      onChange={e => setNewEngineDesc(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
                      Associate Machine Name *
                    </label>
                    <select
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

                <div className="flex items-center justify-end gap-2 pt-2">
                  {editingEngineId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEngineId(null);
                        setNewEngineName('');
                        setNewEngineDesc('');
                      }}
                      className="px-3 py-1.5 text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl font-bold transition-colors"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={addingEngine}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black border border-indigo-700 transition-colors shadow-sm flex items-center gap-1.5"
                  >
                    {addingEngine ? (
                      <Loader2 className="animate-spin" size={12} />
                    ) : (
                      <>
                        <CheckCircle size={12} /> {editingEngineId ? 'Update Engine' : 'Save Engine'}
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Existing Engine Profiles List with Edit / Delete Option */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Registered Engine Profiles ({enginesList.length})
                  </h4>
                </div>
                {enginesList.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                    {enginesList.map(eng => (
                      <div key={eng.id} className="flex items-center justify-between text-xs py-2 first:pt-0">
                        <div className="space-y-0.5">
                          <div className="font-extrabold text-slate-800 flex items-center gap-1.5 flex-wrap">
                            <span>{eng.name}</span>
                            {eng.machineName && (
                              <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded">
                                {eng.machineName}
                              </span>
                            )}
                          </div>
                          {eng.description && (
                            <div className="text-[10px] text-slate-500 font-medium">{eng.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 ml-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEngineId(eng.id);
                              setNewEngineName(eng.name);
                              setNewEngineDesc(eng.description || '');
                              setNewEngineMachineName(eng.machineName || '');
                            }}
                            className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Edit Engine Profile"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEngine(eng.id, eng.name)}
                            className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete Engine Profile"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-slate-400 font-medium text-xs">
                    No engines registered yet. Use the form above to add one.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
