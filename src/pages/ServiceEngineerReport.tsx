import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot, getDoc, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Calendar, Clock, Plus, Trash2, Edit2, Search, Printer, Download, Loader2, Building, ShieldCheck, UserCircle, FileText, CheckCircle, X, ShieldAlert, Award, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

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
  if (trimmed === '102220971984@billedapp.com' || trimmed.endsWith('@billedapp.com') || trimmed === '102220971984') {
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
  const [userName, setUserName] = useState('');

  // Filter States
  const [filterCompany, setFilterCompany] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Custom modals
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
            setIsAdmin(access === 'full' || access === 'admin-light');
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
      handleMachineChange(lockedMachineFromEngines);
    }
  }, [lockedMachineFromEngines, machineName]);

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
    setAddingEngine(true);
    try {
      if (editingEngineId) {
        // Update existing engine profile
        await updateDoc(doc(db, 'service_engineer_engines', editingEngineId), {
          name: newEngineName.trim(),
          description: newEngineDesc.trim(),
          machineName: newEngineMachineName,
          updatedAt: new Date().toISOString()
        });
        toast.success("Engine profile updated successfully!");
        setEditingEngineId(null);
      } else {
        // Add new engine profile
        await addDoc(collection(db, 'service_engineer_engines'), {
          name: newEngineName.trim(),
          description: newEngineDesc.trim(),
          machineName: newEngineMachineName,
          createdAt: new Date().toISOString()
        });
        toast.success("New Engine profile added successfully!");
        setSelectedEngine(newEngineName.trim());
      }
      setNewEngineName('');
      setNewEngineDesc('');
      setNewEngineMachineName('');
    } catch (err) {
      console.error("Error saving engine:", err);
      toast.error("Failed to save Engine profile.");
    } finally {
      setAddingEngine(false);
    }
  };

  // Delete engine profile handler
  const handleDeleteEngine = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete the engine "${name}"? This will not affect existing visit logs that reference this engine name.`)) {
      try {
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
    try {
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
      "From Visit Time", 
      "To Visit Time", 
      "Machine Name", 
      "Contract Company", 
      "Zone", 
      "Division", 
      "Engineer Name", 
      "Engineer Company", 
      "Company Type", 
      "Engine Details",
      "Reason of Visit", 
      "Description", 
      "Logged By"
    ];
    
    const rowsHtml = filteredRecords.map(rec => {
      const enginesListToDisplay = rec.engines && rec.engines.length > 0 
        ? rec.engines 
        : (rec.engineName ? [{ name: rec.engineName, hours: rec.engineHours || '' }] : []);
      
      const enginesText = enginesListToDisplay.map(e => `${e.name}${e.hours ? ` (${e.hours}h)` : ''}`).join(', ') || 'N/A';

      return `
        <tr>
          <td style="font-family: monospace;">${formatToDDMMYYYY(rec.fromVisitDateTime)}</td>
          <td style="font-family: monospace;">${formatToDDMMYYYY(rec.toVisitDateTime)}</td>
          <td><b>${rec.machineName || 'N/A'}</b></td>
          <td>${rec.companyName}</td>
          <td>${rec.zoneName || 'N/A'}</td>
          <td>${rec.divisionName || 'N/A'}</td>
          <td>${rec.engineerName}</td>
          <td>${rec.engineerCompanyName || 'N/A'}</td>
          <td>${rec.engineerCompanyType || 'N/A'}</td>
          <td>${enginesText}</td>
          <td>${rec.visitReason}</td>
          <td>${rec.description}</td>
          <td>${formatCreatorName(rec.createdByName)}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Services Engineer Report</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              tr { page-break-inside: avoid; }
            }
            @page {
              size: A4 landscape;
              margin: 6mm 8mm;
            }
            body {
              font-family: 'Inter', -apple-system, sans-serif;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background-color: #fff;
            }
            h1 {
              font-size: 14px;
              font-weight: 800;
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
              margin-bottom: 12px;
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
              padding: 5px 6px;
              text-align: left;
              font-size: 7.5px;
              font-weight: 800;
              text-transform: uppercase;
              color: #475569;
              letter-spacing: 0.2px;
            }
            td {
              border: 1px solid #cbd5e1;
              padding: 5px 6px;
              font-size: 7.5px;
              color: #334155;
              line-height: 1.25;
              vertical-align: top;
              word-break: break-word;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 9%; }
            th:nth-child(2), td:nth-child(2) { width: 9%; }
            th:nth-child(3), td:nth-child(3) { width: 6%; }
            th:nth-child(4), td:nth-child(4) { width: 8%; }
            th:nth-child(5), td:nth-child(5) { width: 5%; }
            th:nth-child(6), td:nth-child(6) { width: 5%; }
            th:nth-child(7), td:nth-child(7) { width: 9%; }
            th:nth-child(8), td:nth-child(8) { width: 9%; }
            th:nth-child(9), td:nth-child(9) { width: 7%; }
            th:nth-child(10), td:nth-child(10) { width: 9%; }
            th:nth-child(11), td:nth-child(11) { width: 10%; }
            th:nth-child(12), td:nth-child(12) { width: 13%; }
            th:nth-child(13), td:nth-child(13) { width: 6%; }
          </style>
        </head>
        <body>
          <h1>Services Engineer Report History</h1>
          <div class="meta">Generated on ${new Date().toLocaleString()} | Total Records: ${filteredRecords.length}</div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="13" style="text-align: center;">No records matched standard criteria.</td></tr>'}
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

  // Filter application
  const filteredRecords = records.filter(rec => {
    if (isEmployee) {
      const myCompany = companyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany && rec.companyName && rec.companyName !== myCompany) return false;

      const myMachine = machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      if (myMachine && rec.machineName && rec.machineName !== myMachine) return false;
    }

    const matchCompany = filterCompany === 'all' || rec.companyName === filterCompany;
    
    const searchLower = searchQuery.toLowerCase().trim();
    const matchSearch = !searchLower || 
      rec.engineerName.toLowerCase().includes(searchLower) ||
      (rec.engineerCompanyName && rec.engineerCompanyName.toLowerCase().includes(searchLower)) ||
      rec.visitReason.toLowerCase().includes(searchLower) ||
      rec.description.toLowerCase().includes(searchLower) ||
      (rec.machineName && rec.machineName.toLowerCase().includes(searchLower));

    let matchDate = true;
    if (filterStartDate) {
      matchDate = matchDate && new Date(rec.fromVisitDateTime) >= new Date(filterStartDate);
    }
    if (filterEndDate) {
      const endThreshold = new Date(filterEndDate);
      endThreshold.setHours(23, 59, 59, 999);
      matchDate = matchDate && new Date(rec.fromVisitDateTime) <= endThreshold;
    }

    return matchCompany && matchSearch && matchDate;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
        <span className="text-sm font-semibold text-slate-500">Loading Services Engineer Reports...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Upper header action banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2 border-b-0 pb-0">
            <UserCircle className="text-indigo-600" size={24} />
            Services Engineer Report
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
            Log, track, and export services engineer visiting histories and inspection details
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black rounded-xl border border-indigo-100 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
          >
            <Printer size={14} />
            Print Ledger Report
          </button>
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-black rounded-xl border border-emerald-100 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
          >
            <Download size={14} />
            Export Excel Ledger
          </button>
        </div>
      </div>

      {/* LANDSCAPE INPUT FORM PANEL */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-2.5">
          <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Radio size={16} />
          </span>
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">
            {editingId ? "Edit Visit Record (Landscape Form)" : "Log Services Engineer Visit Record (Landscape Form)"}
          </h2>
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
                <>
                  <select
                    value={machineName}
                    onChange={e => handleMachineChange(e.target.value)}
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
                    Select Engine Model
                  </label>
                  <select
                    value={selectedEngine}
                    onChange={e => setSelectedEngine(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                  >
                    <option value="">Select Engine...</option>
                    {enginesList.map(eng => (
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

      {/* DEDICATED REPORT TABLE / LEDGER SECTION */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
        
        {/* Report Section Header and Live Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={16} className="text-indigo-600" />
              Services Engineer Reports Ledger
            </h2>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5 uppercase tracking-wide">
              Live database reporting register of all logged services engineer visits
            </p>
          </div>
          <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-3 py-1.5 rounded-full self-start sm:self-auto">
            Matched Reports: {filteredRecords.length}
          </span>
        </div>

        {/* Live Ledger Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={14} />
            </span>
            <input
              type="text"
              placeholder="Search engineer/company/machine..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={filterCompany}
              onChange={e => setFilterCompany(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
            >
              <option value="all">All Contract Companies</option>
              {companiesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="Other / Outside Agency">Other / Outside Agency</option>
            </select>
          </div>

          <div>
            <input
              type="date"
              value={filterStartDate}
              onChange={e => setFilterStartDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
              title="Start Visit Date"
            />
          </div>

          <div>
            <input
              type="date"
              value={filterEndDate}
              onChange={e => setFilterEndDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-700"
              title="End Visit Date"
            />
          </div>
        </div>

        {/* Dynamic On-Screen Ledger Report Table (Scrollable in Landscape) */}
        <div className="overflow-x-auto border border-slate-200/60 rounded-xl">
          <table className="w-full text-left border-collapse min-w-[1250px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75">
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Visit Period</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Machine Name</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Contractor Company</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Zone & Div</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Engineer Name</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Engineer Company</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Company Type</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Engine Details</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Reason of Visit</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Descriptions & Remarks</th>
                <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
              {filteredRecords.map((record) => {
                const isCreator = record.createdBy === auth.currentUser?.uid;
                const canModify = !isEmployee && (isAdmin || isCreator);

                return (
                  <tr key={record.id} className="hover:bg-slate-50/40 transition-colors">
                    <td className="p-3 font-mono text-slate-500 space-y-0.5">
                      <div className="text-[11px] text-slate-700 font-bold">{formatToDDMMYYYY(record.fromVisitDateTime)}</div>
                      <div className="text-[9.5px] text-slate-400 font-semibold">to {formatToDDMMYYYY(record.toVisitDateTime)}</div>
                    </td>
                    <td className="p-3">
                      <span className="bg-slate-100 text-slate-800 text-[11px] font-black px-2 py-1 rounded-lg border border-slate-200 uppercase">
                        {record.machineName || 'N/A'}
                      </span>
                    </td>
                    <td className="p-3 text-indigo-700 font-black">
                      {record.companyName}
                    </td>
                    <td className="p-3 space-y-0.5">
                      <div className="text-slate-800 font-black">{record.zoneName || 'N/A'}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">{record.divisionName || 'N/A'}</div>
                    </td>
                    <td className="p-3 text-slate-900 font-bold">
                      {record.engineerName}
                    </td>
                    <td className="p-3 text-slate-800 font-black">
                      {record.engineerCompanyName || 'N/A'}
                    </td>
                    <td className="p-3">
                      <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[9.5px] font-black rounded border border-indigo-100 uppercase tracking-wider">
                        {record.engineerCompanyType || 'OEM'}
                      </span>
                    </td>
                    <td className="p-3">
                      {(() => {
                        const enginesListToDisplay = record.engines && record.engines.length > 0 
                          ? record.engines 
                          : (record.engineName ? [{ name: record.engineName, hours: record.engineHours || '' }] : []);

                        if (enginesListToDisplay.length === 0) {
                          return <span className="text-slate-400 italic text-[11px]">N/A</span>;
                        }

                        return (
                          <div className="space-y-1.5 min-w-[120px]">
                            {enginesListToDisplay.map((eng, idx) => (
                              <div key={idx} className="border-b border-slate-100 last:border-b-0 pb-1 last:pb-0">
                                <div className="text-slate-800 font-extrabold text-[11px] leading-tight">{eng.name}</div>
                                {eng.hours && (
                                  <div className="text-[10px] text-indigo-600 font-black">{eng.hours} Hours</div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-3 text-slate-800 font-bold max-w-[150px] truncate" title={record.visitReason}>
                      {record.visitReason}
                    </td>
                    <td className="p-3 text-slate-500 font-normal italic max-w-[220px] truncate" title={record.description}>
                      {record.description}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        {canModify ? (
                          <>
                            <button
                              onClick={() => handleEdit(record)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                              title="Edit Record"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setRecordToDelete(record.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded-lg transition-colors"
                              title="Delete Record"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium italic">Read Only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-10 text-center text-slate-400">
                    <FileText className="mx-auto text-slate-300 stroke-[1.5] mb-2" size={32} />
                    No services engineer reports match the active filters or search string.
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
                <h3 className="text-sm font-black uppercase tracking-wider">Delete Logged Report?</h3>
              </div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Are you sure you want to delete this engineer visit record? This action is permanent and cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRecordToDelete(null)}
                  className="px-3.5 py-2 text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(recordToDelete)}
                  className="px-3.5 py-2 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold border border-rose-700 transition-colors shadow-sm"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                          <div className="font-extrabold text-slate-800">{eng.name}</div>
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
