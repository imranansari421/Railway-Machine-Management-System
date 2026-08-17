import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { findEmployeeForUser } from '../utils/employee';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { 
  Folder as FolderIcon, Plus, Trash2, Edit2, CheckCircle, 
  Circle, Save, X, Calendar, ClipboardList, ShieldAlert, 
  Printer, Download, Loader2, Search, Clock, Settings,
  Filter, SlidersHorizontal, FileText, ChevronRight, Layers,
  Bookmark, MapPin, Activity, Info, Cpu
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import * as XLSX from 'xlsx';

interface TodoItem {
  id: string;
  folderId: string;
  date?: string;
  unit?: string;
  engineHrs?: string;
  description?: string;
  newRepairs?: string;
  source?: string;
  sendTo?: string;
  workingLife?: string;
  remarks?: string;
  // Backward compatibility with simple todo items
  task: string;
  completed: boolean;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

interface Folder {
  id: string;
  name: string;
  machine?: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

// Utility to format Date to DD-MM-YYYY
const formatDateToDDMMYYYY = (dateStr: string | undefined) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD -> DD-MM-YYYY
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

// Format helper for display names/emails to fulfill user requirements
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

// Helper to strip prepended FOLDER: / folder: / Folder: from folder names
const cleanFolderName = (name: string | undefined | null) => {
  if (!name) return '';
  return name.replace(/^(FOLDER:|Folder:|folder:)\s*/i, '');
};

const standardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM", "TRT-6190050"];

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderMachine, setNewFolderMachine] = useState('TRT-6190050');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');

  // Form states for creating a history record
  const [logDate, setLogDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [logMachineName, setLogMachineName] = useState('');
  const [logUnitName, setLogUnitName] = useState('');
  const [logEngineHrs, setLogEngineHrs] = useState('');
  const [logDescription, setLogDescription] = useState('');
  const [logNewRepairs, setLogNewRepairs] = useState('New');
  const [logCustomNewRepairs, setLogCustomNewRepairs] = useState('');
  const [logSource, setLogSource] = useState('');
  const [logSendTo, setLogSendTo] = useState('');
  const [logWorkingLife, setLogWorkingLife] = useState('');
  const [logRemarks, setLogRemarks] = useState('');

  // Editing state (full modal)
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editEngineHrs, setEditEngineHrs] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNewRepairs, setEditNewRepairs] = useState('New');
  const [editCustomNewRepairs, setEditCustomNewRepairs] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editSendTo, setEditSendTo] = useState('');
  const [editWorkingLife, setEditWorkingLife] = useState('');
  const [editRemarks, setEditRemarks] = useState('');

  // Editing folder state
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderMachine, setEditFolderMachine] = useState('');

  // Custom delete confirmation states
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  // Role details
  const [userRole, setUserRole] = useState<'admin' | 'admin-light' | 'full' | 'limited'>('limited');
  const [userName, setUserName] = useState('');
  const [employeeMachine, setEmployeeMachine] = useState<string>('');
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');

  const [filterMachine, setFilterMachine] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [recordsSearchQuery, setRecordsSearchQuery] = useState('');
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'employees'), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setEmployeeList(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const mapping: Record<string, { zone: string; division: string }> = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.machineName) {
          mapping[data.machineName] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setMachinePositions(mapping);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const fetchUserRoleAndData = async () => {
      if (!auth.currentUser) return;
      try {
        let nameToSet = auth.currentUser.displayName || auth.currentUser.email || 'Anonymous';
        nameToSet = formatCreatorName(nameToSet);
        setUserName(nameToSet);
        
        if (!isEmployee) {
          setUserRole('admin');
        } else {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          if (emp) {
            setUserRole((emp.accessType as any) || 'limited');
            let empName = emp.name || auth.currentUser.displayName || 'Employee';
            empName = formatCreatorName(empName);
            setUserName(empName);
            if (emp.machineName) {
              setEmployeeMachine(emp.machineName);
              setNewFolderMachine(emp.machineName);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching user info in Folders:', err);
      }
    };
    fetchUserRoleAndData();
  }, [isEmployee]);

  // Sync edit states when editingTodo changes
  useEffect(() => {
    if (editingTodo) {
      setEditDate(editingTodo.date || editingTodo.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0]);
      setEditUnit(editingTodo.unit || '');
      setEditEngineHrs(editingTodo.engineHrs || '');
      setEditDescription(editingTodo.description || editingTodo.task || '');
      
      const nr = editingTodo.newRepairs || 'New';
      if (['New', 'Repairs', 'N/A', 'Replaced'].includes(nr)) {
        setEditNewRepairs(nr);
        setEditCustomNewRepairs('');
      } else {
        setEditNewRepairs('Other');
        setEditCustomNewRepairs(nr);
      }
      
      setEditSource(editingTodo.source || '');
      setEditSendTo(editingTodo.sendTo || '');
      setEditWorkingLife(editingTodo.workingLife || '');
      setEditRemarks(editingTodo.remarks || '');
    }
  }, [editingTodo]);

  // Admin check (allows create, edit, delete operations for folders and todo items)
  const isAdmin = !isEmployee || userRole === 'admin' || userRole === 'full' || userRole === 'admin-light';

  // Sync folders
  useEffect(() => {
    const q = collection(db, 'folders');
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Folder))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setFolders(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'folders');
    });
    return () => unsub();
  }, []);

  // Map all existing folders to 'TRT-6190050'
  useEffect(() => {
    if (folders.length > 0 && isAdmin) {
      const foldersToMigrate = folders.filter(f => f.machine !== 'TRT-6190050');
      if (foldersToMigrate.length > 0) {
        const runMigration = async () => {
          for (const folder of foldersToMigrate) {
            try {
              await updateDoc(doc(db, 'folders', folder.id), {
                machine: 'TRT-6190050'
              });
            } catch (err) {
              console.error(`Error migrating folder ${folder.id} to TRT-6190050:`, err);
            }
          }
        };
        runMigration();
      }
    }
  }, [folders, isAdmin]);

  const filteredFolders = React.useMemo(() => {
    return folders.filter(f => {
      const folderMachineName = cleanFolderName(f.name).trim();
      
      // 1. Text search query
      const matchesSearch = folderMachineName.toLowerCase().includes(folderSearchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // 2. Machine Filter
      const folderMachine = f.machine || (() => {
        const nameUpper = folderMachineName.toUpperCase();
        const matched = standardMachines.find(m => nameUpper.includes(m));
        return matched || '';
      })();

      if (filterMachine !== 'all' && folderMachine !== filterMachine) {
        return false;
      }

      // For non-admin employees, restrict to machines of their company/assigned machine
      if (isEmployee) {
        const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
        if (myCompany) {
          const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
          const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
          if (folderMachine && companyMachines.size > 0 && !companyMachines.has(folderMachine)) {
            return false;
          }
        }

        if (userRole !== 'admin-light') {
          const myMachine = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
          if (myMachine && folderMachine && folderMachine.toLowerCase() !== myMachine.toLowerCase()) {
            return false;
          }
        }
      }

      // Get position data (zone and division) for the folder's machine
      const pos = machinePositions[folderMachine];

      // 3. Zone Filter
      if (filterZone !== 'all') {
        if (!pos || pos.zone !== filterZone) return false;
      }

      // 4. Division Filter
      if (filterDivision !== 'all') {
        if (!pos || pos.division !== filterDivision) return false;
      }

      // 5. Only show folders whose machine matches one created in HR seating machine management
      const isCreatedInHR = Object.keys(machinePositions).length === 0 || Object.keys(machinePositions).some(
        m => m.toLowerCase() === folderMachine.toLowerCase() || m.toLowerCase() === folderMachineName.toLowerCase()
      );
      if (!isCreatedInHR) {
        return false;
      }

      return true;
    });
  }, [folders, folderSearchQuery, filterMachine, filterZone, filterDivision, machinePositions, employeeList]);

  // Sync todos for selected folder
  const activeFolderId = selectedFolderId && filteredFolders.some(f => f.id === selectedFolderId)
    ? selectedFolderId
    : (filteredFolders[0]?.id || '');

  useEffect(() => {
    if (!activeFolderId) {
      setTodos([]);
      return;
    }
    const q = query(collection(db, 'todos'), where('folderId', '==', activeFolderId));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TodoItem))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setTodos(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `todos?folderId=${activeFolderId}`);
    });
    return () => unsub();
  }, [activeFolderId]);

  // Automatically pre-populate/map the active folder's mapped machine and unit name into the form fields
  useEffect(() => {
    const active = folders.find(f => f.id === activeFolderId);
    if (active) {
      const folderMachine = active.machine || (() => {
        const nameUpper = cleanFolderName(active.name).toUpperCase();
        const matched = standardMachines.find(m => nameUpper.includes(m));
        return matched || cleanFolderName(active.name);
      })();
      setLogMachineName(folderMachine);
      setLogUnitName(cleanFolderName(active.name));
    } else {
      setLogMachineName('');
      setLogUnitName('');
    }
  }, [activeFolderId, folders]);

  const allMachines = React.useMemo(() => {
    const dbMachines = Object.keys(machinePositions);
    return Array.from(new Set([
      ...standardMachines,
      ...settingsMachines,
      ...dbMachines
    ])).filter(Boolean).sort();
  }, [machinePositions, settingsMachines]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Only Admins have permission to create folders.');
      return;
    }
    if (!newFolderName.trim()) {
      toast.error('Folder name cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'folders'), {
        name: newFolderName.trim(),
        machine: newFolderMachine,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || '',
        createdByName: userName
      });
      setSelectedFolderId(docRef.id);
      setNewFolderName('');
      toast.success('Folder created successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'folders');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder) return;
    if (!isAdmin) {
      toast.error('Only Admins have permission to edit folders.');
      return;
    }
    if (!editFolderName.trim()) {
      toast.error('Folder / Unit name cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'folders', editingFolder.id), {
        name: editFolderName.trim(),
        machine: editFolderMachine,
      });
      toast.success('Folder / Unit updated successfully!');
      setEditingFolder(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `folders/${editingFolder.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFolderId) {
      toast.error('Please select or create a folder first.');
      return;
    }
    if (!logDescription.trim()) {
      toast.error('Description cannot be empty.');
      return;
    }

    try {
      const finalNewRepairs = logNewRepairs === 'Other' ? logCustomNewRepairs.trim() : logNewRepairs;
      const activeObj = folders.find(f => f.id === activeFolderId);
      const finalUnitName = logUnitName.trim() || cleanFolderName(activeObj?.name || '');
      await addDoc(collection(db, 'todos'), {
        folderId: activeFolderId,
        date: logDate,
        unit: finalUnitName,
        machineName: logMachineName.trim() || activeObj?.machine || '',
        engineHrs: logEngineHrs.trim(),
        description: logDescription.trim(),
        newRepairs: finalNewRepairs,
        source: logSource.trim(),
        sendTo: logSendTo.trim(),
        workingLife: logWorkingLife.trim(),
        remarks: logRemarks.trim(),
        // Compatibility fallbacks
        task: logDescription.trim(),
        completed: false,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || '',
        createdByName: userName
      });

      // Reset form fields
      setLogDate(new Date().toISOString().split('T')[0]);
      setLogUnitName(cleanFolderName(activeObj?.name || ''));
      setLogEngineHrs('');
      setLogDescription('');
      setLogNewRepairs('New');
      setLogCustomNewRepairs('');
      setLogSource('');
      setLogSendTo('');
      setLogWorkingLife('');
      setLogRemarks('');

      toast.success('History record added to folder!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'todos');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTodo) return;
    if (!editDescription.trim()) {
      toast.error('Description cannot be empty.');
      return;
    }

    const isCreator = editingTodo.createdBy === auth.currentUser?.uid;
    if (!isAdmin && !isCreator) {
      toast.error('You do not have permission to edit this record.');
      return;
    }

    try {
      const finalNewRepairs = editNewRepairs === 'Other' ? editCustomNewRepairs.trim() : editNewRepairs;
      const ref = doc(db, 'todos', editingTodo.id);
      await updateDoc(ref, {
        date: editDate,
        unit: editUnit.trim(),
        engineHrs: editEngineHrs.trim(),
        description: editDescription.trim(),
        newRepairs: finalNewRepairs,
        source: editSource.trim(),
        sendTo: editSendTo.trim(),
        workingLife: editWorkingLife.trim(),
        remarks: editRemarks.trim(),
        // Compatibility fallbacks
        task: editDescription.trim()
      });
      setEditingTodo(null);
      setEditCustomNewRepairs('');
      toast.success('History record updated successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `todos/${editingTodo.id}`);
    }
  };

  const handleDeleteTask = async (todoId: string) => {
    const todo = todos.find(t => t.id === todoId);
    const isCreator = todo?.createdBy === auth.currentUser?.uid;
    if (!isAdmin && !isCreator) {
      toast.error('You do not have permission to delete this record.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'todos', todoId));
      toast.success('Record deleted successfully.');
      setTaskToDelete(null);
    } catch (error) {
      toast.error('Failed to delete record.');
      handleFirestoreError(error, OperationType.DELETE, `todos/${todoId}`);
    }
  };

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!isAdmin) {
      toast.error('Only Admins have permission to delete folders.');
      return;
    }
    setSaving(true);
    try {
      // Delete all tasks in the folder first
      let tasksSnap;
      try {
        tasksSnap = await getDocs(query(collection(db, 'todos'), where('folderId', '==', folderId)));
      } catch (err) {
        console.error('Error fetching tasks for folder:', err);
      }
      if (tasksSnap && tasksSnap.docs) {
        for (const d of tasksSnap.docs) {
          try {
            await deleteDoc(doc(db, 'todos', d.id));
          } catch (err) {
            console.error(`Error deleting task ${d.id}:`, err);
          }
        }
      }
      // Delete folder
      await deleteDoc(doc(db, 'folders', folderId));
      
      // Select another folder if available
      const remainingFolders = folders.filter(f => f.id !== folderId);
      if (remainingFolders.length > 0) {
        setSelectedFolderId(remainingFolders[0].id);
      } else {
        setSelectedFolderId('');
      }
      
      toast.success(`Folder "${folderName}" deleted successfully.`);
      setFolderToDelete(null);
    } catch (error) {
      console.error('Error deleting folder:', error);
      toast.error('Failed to delete folder.');
      handleFirestoreError(error, OperationType.DELETE, `folders/${folderId}`);
    } finally {
      setSaving(false);
    }
  };

  // High fidelity Print Functionality for SELECTED folder ONLY
  const handlePrintSelected = () => {
    const activeFolderObj = folders.find(f => f.id === selectedFolderId);
    if (!activeFolderObj) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to print.");
      return;
    }

    const cleanedName = cleanFolderName(activeFolderObj.name);
    const headers = ["Date", "Unit", "Engine Hrs.", "Description", "New/Repairs", "Source (Souers)", "Send to", "Working life", "Remarks", "Logged By"];
    
    const rowsHtml = todos.map(todo => {
      const d = todo.date ? formatDateToDDMMYYYY(todo.date) : formatDateToDDMMYYYY(todo.createdAt?.split('T')[0]);
      return `
        <tr>
          <td style="font-family: monospace;">${d}</td>
          <td>${todo.unit || ''}</td>
          <td style="font-family: monospace;">${todo.engineHrs || ''}</td>
          <td>${todo.description || todo.task || ''}</td>
          <td>${todo.newRepairs || ''}</td>
          <td>${todo.source || ''}</td>
          <td>${todo.sendTo || ''}</td>
          <td>${todo.workingLife || ''}</td>
          <td>${todo.remarks || ''}</td>
          <td>${formatCreatorName(todo.createdByName)}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>History Report - ${cleanedName}</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .no-print { display: none !important; }
              tr { page-break-inside: avoid; break-inside: avoid; }
              thead { display: table-header-group; }
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
              -webkit-print-color-adjust: exact;
            }
            h1 {
              font-size: 14px;
              font-weight: 800;
              margin: 0 0 2px 0;
              color: #1e1b4b;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 4px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .meta {
              font-size: 8px;
              color: #64748b;
              margin-bottom: 12px;
              font-weight: 600;
            }
            .folder-section {
              margin-bottom: 15px;
            }
            h2 {
              font-size: 10px;
              font-weight: 800;
              color: #4338ca;
              margin: 0 0 4px 0;
              padding-bottom: 2px;
              border-bottom: 2px solid #e2e8f0;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 8px;
              table-layout: fixed;
            }
            th {
              background-color: #f8fafc;
              border: 1px solid #cbd5e1;
              padding: 3px 4px;
              text-align: left;
              font-size: 8px;
              font-weight: 800;
              text-transform: uppercase;
              color: #475569;
              letter-spacing: 0.2px;
            }
            td {
              border: 1px solid #cbd5e1;
              padding: 3px 4px;
              font-size: 8px;
              color: #334155;
              line-height: 1.15;
              vertical-align: top;
              word-break: break-word;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            th:nth-child(1), td:nth-child(1) { width: 7%; }
            th:nth-child(2), td:nth-child(2) { width: 8%; }
            th:nth-child(3), td:nth-child(3) { width: 8%; }
            th:nth-child(4), td:nth-child(4) { width: 22%; }
            th:nth-child(5), td:nth-child(5) { width: 9%; }
            th:nth-child(6), td:nth-child(6) { width: 10%; }
            th:nth-child(7), td:nth-child(7) { width: 10%; }
            th:nth-child(8), td:nth-child(8) { width: 9%; }
            th:nth-child(9), td:nth-child(9) { width: 10%; }
            th:nth-child(10), td:nth-child(10) { width: 7%; }
          </style>
        </head>
        <body>
          <h1>HISTORY REPORT</h1>
          <div class="meta">Generated on ${new Date().toLocaleString()} | Folder: ${cleanedName} | Total Records: ${todos.length}</div>
          <div class="folder-section">
            <h2>${cleanedName}</h2>
            <table>
              <thead>
                <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
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

  // High fidelity Excel Export for SELECTED folder ONLY
  const handleExportExcelSelected = () => {
    const activeFolderObj = folders.find(f => f.id === selectedFolderId);
    if (!activeFolderObj || todos.length === 0) {
      toast.error("No records to export.");
      return;
    }
    
    const cleanedName = cleanFolderName(activeFolderObj.name);
    const dataToExport = todos.map(todo => ({
      "Date": todo.date ? formatDateToDDMMYYYY(todo.date) : formatDateToDDMMYYYY(todo.createdAt?.split('T')[0]),
      "Unit": todo.unit || '',
      "Engine Hrs.": todo.engineHrs || '',
      "Description": todo.description || todo.task || '',
      "New / Repairs": todo.newRepairs || '',
      "Source (Souers)": todo.source || '',
      "Send to": todo.sendTo || '',
      "Working life": todo.workingLife || '',
      "Remarks": todo.remarks || '',
      "Logged By": formatCreatorName(todo.createdByName)
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Folder History Log");
    
    // Auto-fit columns nicely and limit size to prevent horizontal scrolling/giant gaps
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

    XLSX.writeFile(workbook, `${cleanedName}_History_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Excel report for folder exported successfully!");
  };

  // High fidelity Print Functionality for ALL folders
  const handlePrintAll = async () => {
    setSaving(true);
    try {
      const qSnap = await getDocs(collection(db, 'todos'));
      const allTodos = qSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as TodoItem));
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error("Popup blocked! Please allow popups to print.");
        return;
      }

      // Group todos by cleaned folder name
      const grouped: Record<string, TodoItem[]> = {};
      folders.forEach(f => {
        const cleaned = cleanFolderName(f.name);
        grouped[cleaned] = allTodos.filter(t => t.folderId === f.id)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });

      const headers = ["Date", "Unit", "Engine Hrs.", "Description", "New/Repairs", "Source (Souers)", "Send to", "Working life", "Remarks", "Logged By"];

      let contentHtml = '';
      Object.keys(grouped).forEach(folderName => {
        const folderTodos = grouped[folderName];
        if (folderTodos.length === 0) return; // skip empty folders

        const rowsHtml = folderTodos.map(todo => {
          const d = todo.date ? formatDateToDDMMYYYY(todo.date) : formatDateToDDMMYYYY(todo.createdAt?.split('T')[0]);
          return `
            <tr>
              <td style="font-family: monospace;">${d}</td>
              <td>${todo.unit || ''}</td>
              <td style="font-family: monospace;">${todo.engineHrs || ''}</td>
              <td>${todo.description || todo.task || ''}</td>
              <td>${todo.newRepairs || ''}</td>
              <td>${todo.source || ''}</td>
              <td>${todo.sendTo || ''}</td>
              <td>${todo.workingLife || ''}</td>
              <td>${todo.remarks || ''}</td>
              <td>${formatCreatorName(todo.createdByName)}</td>
            </tr>
          `;
        }).join('');

        contentHtml += `
          <div class="folder-section" style="margin-bottom: 20px;">
            <h2 style="font-size: 10px; font-weight: 800; color: #4338ca; margin: 0 0 4px 0; padding-bottom: 2px; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; letter-spacing: 0.5px;">${folderName}</h2>
            <table>
              <thead>
                <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        `;
      });

      if (!contentHtml) {
        contentHtml = '<p style="text-align: center; color: #64748b; font-weight: bold; margin-top: 50px;">No records found in any folder.</p>';
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>History Report</title>
            <style>
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .no-print { display: none !important; }
                tr { page-break-inside: avoid; break-inside: avoid; }
                thead { display: table-header-group; }
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
                -webkit-print-color-adjust: exact;
              }
              h1 {
                font-size: 14px;
                font-weight: 800;
                margin: 0 0 2px 0;
                color: #1e1b4b;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              .meta {
                font-size: 8px;
                color: #64748b;
                margin-bottom: 12px;
                font-weight: 600;
              }
              .folder-section {
                margin-bottom: 15px;
              }
              h2 {
                font-size: 10px;
                font-weight: 800;
                color: #4338ca;
                margin: 0 0 4px 0;
                padding-bottom: 2px;
                border-bottom: 2px solid #e2e8f0;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 8px;
                table-layout: fixed;
              }
              th {
                background-color: #f8fafc;
                border: 1px solid #cbd5e1;
                padding: 3px 4px;
                text-align: left;
                font-size: 8px;
                font-weight: 800;
                text-transform: uppercase;
                color: #475569;
                letter-spacing: 0.2px;
              }
              td {
                border: 1px solid #cbd5e1;
                padding: 3px 4px;
                font-size: 8px;
                color: #334155;
                line-height: 1.15;
                vertical-align: top;
                word-break: break-word;
              }
              tr:nth-child(even) td {
                background-color: #f8fafc;
              }
              th:nth-child(1), td:nth-child(1) { width: 7%; }
              th:nth-child(2), td:nth-child(2) { width: 8%; }
              th:nth-child(3), td:nth-child(3) { width: 8%; }
              th:nth-child(4), td:nth-child(4) { width: 22%; }
              th:nth-child(5), td:nth-child(5) { width: 9%; }
              th:nth-child(6), td:nth-child(6) { width: 10%; }
              th:nth-child(7), td:nth-child(7) { width: 10%; }
              th:nth-child(8), td:nth-child(8) { width: 9%; }
              th:nth-child(9), td:nth-child(9) { width: 10%; }
              th:nth-child(10), td:nth-child(10) { width: 7%; }
            </style>
          </head>
          <body>
            <h1>HISTORY REPORT</h1>
            <div class="meta">Generated on ${new Date().toLocaleString()} | Total Folders: ${folders.length}</div>
            ${contentHtml}
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
    } catch (err) {
      console.error("Error printing folders:", err);
      toast.error("Failed to fetch records for all folders.");
    } finally {
      setSaving(false);
    }
  };

  // High fidelity Excel Export Functionality for ALL folders
  const handleExportExcelAll = async () => {
    setSaving(true);
    try {
      const qSnap = await getDocs(collection(db, 'todos'));
      const allTodos = qSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as TodoItem));

      if (allTodos.length === 0) {
        toast.error("No records to export.");
        return;
      }

      const dataToExport = allTodos.map(todo => {
        const folderObj = folders.find(f => f.id === todo.folderId);
        return {
          "Folder Name": folderObj ? cleanFolderName(folderObj.name) : "Unknown",
          "Date": todo.date ? formatDateToDDMMYYYY(todo.date) : formatDateToDDMMYYYY(todo.createdAt?.split('T')[0]),
          "Unit": todo.unit || '',
          "Engine Hrs.": todo.engineHrs || '',
          "Description": todo.description || todo.task || '',
          "New / Repairs": todo.newRepairs || '',
          "Source (Souers)": todo.source || '',
          "Send to": todo.sendTo || '',
          "Working life": todo.workingLife || '',
          "Remarks": todo.remarks || '',
          "Logged By": formatCreatorName(todo.createdByName)
        };
      }).sort((a, b) => a["Folder Name"].localeCompare(b["Folder Name"]));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "All Folders History Log");
      
      // Auto-fit columns nicely and limit size to prevent horizontal scrolling/giant gaps
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

      XLSX.writeFile(workbook, `All_Folders_History_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success("Excel report for all folders exported successfully!");
    } catch (err) {
      console.error("Error exporting folders:", err);
      toast.error("Failed to export all folders.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin h-8 w-8 text-indigo-600" />
      </div>
    );
  }

  const activeFolder = folders.find(f => f.id === activeFolderId);

  const filteredTodos = todos.filter(t => {
    if (!recordsSearchQuery) return true;
    const q = recordsSearchQuery.toLowerCase();
    return (
      (t.unit || '').toLowerCase().includes(q) ||
      (t.description || t.task || '').toLowerCase().includes(q) ||
      (t.newRepairs || '').toLowerCase().includes(q) ||
      (t.source || '').toLowerCase().includes(q) ||
      (t.sendTo || '').toLowerCase().includes(q) ||
      (t.workingLife || '').toLowerCase().includes(q) ||
      (t.remarks || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden">
      {/* 1. Header & Live Stats Panel */}
      <div className="flex-shrink-0 mb-6 bg-linear-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400">
                <FolderIcon size={20} className="animate-pulse" />
              </span>
              <h1 className="text-2xl font-black tracking-tight leading-none">Folders & History Logger</h1>
            </div>
            <p className="text-xs text-slate-300 font-medium">
              Create custom work logs & history folders to manage mechanical entries, repairs, and resources.
              {isAdmin ? (
                <span className="text-emerald-400 font-bold ml-1">● Authorized Administrator Mode</span>
              ) : (
                <span className="text-slate-400 font-bold ml-1">● Read-Only Access Mode</span>
              )}
            </p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-950/45 p-3 rounded-xl border border-slate-800/60">
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-[9px] text-slate-400 font-black uppercase tracking-wider">Total Folders</span>
              <span className="text-sm font-black text-indigo-400 font-mono">{folders.length}</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-[9px] text-slate-400 font-black uppercase tracking-wider">Selected Records</span>
              <span className="text-sm font-black text-emerald-400 font-mono">{todos.length}</span>
            </div>
            <div className="text-center px-2 min-w-[140px]">
              <span className="block text-[9px] text-slate-400 font-black uppercase tracking-wider">Active Folder & Machine</span>
              <span className="text-xs font-bold text-emerald-400 truncate max-w-[150px] block" title={activeFolder ? `${cleanFolderName(activeFolder.name)} (${activeFolder.machine || 'TRT-6190050'})` : "None Selected"}>
                {activeFolder ? `${cleanFolderName(activeFolder.name)} • ${activeFolder.machine || 'TRT-6190050'}` : "None Selected"}
              </span>
            </div>
          </div>
        </div>

        {/* Top Filters (Only for Admin / Admin-Light) inside the top blue/indigo banner! */}
        {(!isEmployee || userRole === 'admin' || userRole === 'admin-light') && (
          <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
              <SlidersHorizontal size={14} className="text-indigo-400" />
              <span>Filters:</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 min-w-[280px] max-w-3xl">
              {/* Filter Machine */}
              <div className="flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0">Machine</span>
                <select
                  value={filterMachine}
                  onChange={e => setFilterMachine(e.target.value)}
                  className="bg-transparent text-xs outline-none font-bold text-slate-200 cursor-pointer w-full"
                >
                  <option value="all" className="bg-slate-900 text-slate-200">All Machines</option>
                  {(isEmployee && userRole === 'admin-light'
                    ? allMachines.filter(m => {
                        const myCompany = localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
                        if (!myCompany) return true;
                        const companyEmployees = employeeList.filter(e => e.companyName === myCompany);
                        const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
                        return companyMachines.has(m);
                      })
                    : allMachines
                  ).map(m => (
                    <option key={m} value={m} className="bg-slate-900 text-slate-200">{m}</option>
                  ))}
                </select>
              </div>

              {/* Filter Zone */}
              <div className="flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0">Zone</span>
                <select
                  value={filterZone}
                  onChange={e => {
                    setFilterZone(e.target.value);
                    setFilterDivision('all');
                  }}
                  className="bg-transparent text-xs outline-none font-bold text-slate-200 cursor-pointer w-full"
                >
                  <option value="all" className="bg-slate-900 text-slate-200">All Zones</option>
                  {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                    <option key={z} value={z} className="bg-slate-900 text-slate-200">{z}</option>
                  ))}
                </select>
              </div>

              {/* Filter Division */}
              <div className="flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-800/80 disabled:opacity-50">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0">Division</span>
                <select
                  value={filterDivision}
                  onChange={e => setFilterDivision(e.target.value)}
                  disabled={filterZone === 'all'}
                  className="bg-transparent text-xs outline-none font-bold text-slate-200 cursor-pointer w-full disabled:cursor-not-allowed"
                >
                  <option value="all" className="bg-slate-900 text-slate-200">All Divisions</option>
                  {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map(d => (
                    <option key={d} value={d} className="bg-slate-900 text-slate-200">{d}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
        {/* Create Folder (Only for Admin) - Beautiful Full-Width Horizontal Bar */}
        {isAdmin && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 min-w-max">
                <Plus size={16} className="text-indigo-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  Create Folder
                </h3>
              </div>
              <form onSubmit={handleCreateFolder} className="flex-1 flex flex-col md:flex-row items-end gap-4 w-full">
                <div className="flex-1 min-w-0 w-full">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Unit Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Engine-MPT-01"
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50/50 transition-all font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 h-9"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    maxLength={40}
                    required
                  />
                </div>
                <div className="flex-1 min-w-0 w-full">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Machine Name</label>
                  <select
                    value={newFolderMachine}
                    onChange={e => setNewFolderMachine(e.target.value)}
                    disabled={isEmployee && userRole === 'full' && !!employeeMachine}
                    className={`w-full text-xs border border-slate-200 rounded-xl px-3 py-2 transition-all font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 h-9 ${
                      isEmployee && userRole === 'full' && !!employeeMachine ? 'bg-slate-100 font-extrabold text-slate-500 cursor-not-allowed' : 'bg-slate-50/50'
                    }`}
                  >
                    {allMachines.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 py-2 text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer shrink-0 h-9"
                >
                  {saving ? (
                    <Loader2 className="animate-spin h-3.5 w-3.5 text-white" />
                  ) : (
                    <>
                      <Plus size={14} /> Create Folder
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Side: Folder Manager & Search Panel (Col Span 4) */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-6">

            {/* Folder Filters & Library Workspace */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                  <FolderIcon size={16} className="text-indigo-600" /> Folders Library
                </h2>
                <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full font-mono">
                  {filteredFolders.length} Active
                </span>
              </div>

              {/* Folder Search & Controls */}
              <div className="space-y-3.5">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search folder or machine..."
                    className="w-full text-xs border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-slate-50/50 transition-all font-semibold text-slate-800"
                    value={folderSearchQuery}
                    onChange={e => setFolderSearchQuery(e.target.value)}
                  />
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  {folderSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setFolderSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Folders List Container */}
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {filteredFolders.length === 0 ? (
                  <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <FolderIcon size={24} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-bold">
                      {folders.length === 0 ? "No folders created yet." : "No matching folders."}
                    </p>
                  </div>
                ) : (
                  filteredFolders.map(folder => {
                    const isActive = folder.id === activeFolderId;
                    const cleanName = cleanFolderName(folder.name).trim();
                    const folderMachine = folder.machine || (() => {
                      const nameUpper = cleanName.toUpperCase();
                      const matched = standardMachines.find(m => nameUpper.includes(m));
                      return matched || '';
                    })();
                    const pos = machinePositions[folderMachine];

                    const dbMachineKey = Object.keys(machinePositions).find(
                      m => m.toLowerCase() === folderMachine.toLowerCase() || m.toLowerCase() === cleanName.toLowerCase()
                    );
                    const isCreatedInHR = !!dbMachineKey;
                    const displayNameToShow = isCreatedInHR ? (dbMachineKey || folderMachine) : '';

                    return (
                      <div
                        key={folder.id}
                        className={`group relative flex flex-col p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isActive
                            ? 'bg-gradient-to-b from-indigo-50 to-emerald-50/40 border-indigo-300 text-indigo-950 shadow-sm ring-2 ring-indigo-400/40'
                            : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50/50 text-slate-600'
                        }`}
                        onClick={() => setSelectedFolderId(folder.id)}
                      >
                        {/* Machine-wise Active Folder Status Badge */}
                        {isActive && (
                          <div className="mb-2 flex items-center justify-between">
                            <span className="inline-flex items-center gap-1 bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shadow-2xs">
                              <Activity size={10} className="animate-pulse" /> Active Machine Folder
                            </span>
                            <span className="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              ● Live
                            </span>
                          </div>
                        )}

                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className={`p-1.5 rounded-lg shrink-0 ${
                              isActive ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-200' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 transition-colors'
                            }`}>
                              <FolderIcon size={14} />
                            </span>
                            <div className="min-w-0">
                              <span className="font-black text-slate-800 truncate block">{cleanName}</span>
                              
                              {/* Machine metadata tags (Machine-wise name with Cpu icon) */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-wide uppercase shrink-0 flex items-center gap-1 ${
                                  isActive ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}>
                                  <Cpu size={10} />
                                  {folderMachine || 'TRT-6190050'}
                                </span>
                                {pos?.division && (
                                  <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase shrink-0 ${
                                    isActive ? 'bg-indigo-100/80 text-indigo-900 border border-indigo-200' : 'bg-slate-100 text-slate-500'
                                  }`}>
                                    {pos.division}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Edit & Delete Action buttons inside folder card */}
                          {isAdmin && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all absolute right-2.5 top-2.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingFolder(folder);
                                  setEditFolderName(cleanFolderName(folder.name));
                                  setEditFolderMachine(folder.machine || 'TRT-6190050');
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all shrink-0 cursor-pointer"
                                title="Edit Folder / Unit Name"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFolderToDelete({ id: folder.id, name: folder.name });
                                }}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0 cursor-pointer"
                                title="Delete Folder"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}

                          {isActive && !isAdmin && (
                            <span className="text-indigo-600 self-center shrink-0">
                              <ChevronRight size={14} />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Side: Upgraded History Logs Inside selected Folder (Col Span 8 / 9) */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-6">
            {activeFolder ? (
              <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-6">
                
                {/* Upper Header: Title, Print, Export */}
                <div className="flex flex-col xl:flex-row xl:items-center justify-between border-b border-slate-100 pb-5 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                        <FolderIcon size={18} />
                      </span>
                      <h2 className="text-xl font-black text-slate-800 leading-tight">
                        {cleanFolderName(activeFolder.name)}
                      </h2>
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                        <Cpu size={13} className="text-emerald-600" />
                        <span>Machine: <strong>{activeFolder.machine || 'TRT-6190050'}</strong></span>
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setEditingFolder(activeFolder);
                            setEditFolderName(cleanFolderName(activeFolder.name));
                            setEditFolderMachine(activeFolder.machine || 'TRT-6190050');
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 text-xs font-bold rounded-xl flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                          title="Edit Folder / Unit Name"
                        >
                          <Edit2 size={12} />
                          <span>Edit Unit</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                      <span>Folder Owner: <strong className="text-slate-600 font-black">{formatCreatorName(activeFolder.createdByName)}</strong></span>
                      <span>•</span>
                      <span className="text-indigo-600 font-extrabold flex items-center gap-1">
                        <Activity size={10} className="animate-pulse" /> Active Folder Mode
                      </span>
                    </div>
                  </div>
                  
                  {/* Action Print / Export Grid Buttons */}
                  <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
                    <button
                      onClick={handlePrintSelected}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-2xs shrink-0 cursor-pointer"
                      title="Print Selected Folder History Records"
                    >
                      <Printer size={13} className="text-indigo-600" />
                      <span>Print Folder</span>
                    </button>
                    <button
                      onClick={handleExportExcelSelected}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-2xs shrink-0 cursor-pointer"
                      title="Export Selected Folder History to Excel"
                    >
                      <Download size={13} className="text-emerald-600" />
                      <span>Export Folder</span>
                    </button>
                    <button
                      onClick={handlePrintAll}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl border border-indigo-700 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-sm shrink-0 cursor-pointer"
                      title="Print All Folders History Records"
                    >
                      <Printer size={13} />
                      <span>Print All</span>
                    </button>
                    <button
                      onClick={handleExportExcelAll}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl border border-amber-700 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-sm shrink-0 cursor-pointer"
                      title="Export All Folders History to Excel"
                    >
                      <Download size={13} />
                      <span>Export All</span>
                    </button>
                  </div>
                </div>

                {/* Log History Record Form (Collapsible/Styled Container) */}
                <form onSubmit={handleCreateTask} className="bg-slate-50/70 border border-slate-200/60 p-5 rounded-2xl space-y-4">
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 pb-2">
                    <Plus size={14} className="text-indigo-600" /> Log History Record
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Date</label>
                      <input
                        type="date"
                        value={logDate}
                        onChange={e => setLogDate(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Machine Name</label>
                      <input
                        type="text"
                        value={logMachineName}
                        onChange={e => setLogMachineName(e.target.value)}
                        placeholder="Machine name"
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-bold text-slate-700"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Unit Name</label>
                      <input
                        type="text"
                        value={logUnitName}
                        onChange={e => setLogUnitName(e.target.value)}
                        placeholder="e.g. Engine Unit, Transmission..."
                        className="w-full text-xs border border-indigo-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white font-bold text-slate-800 shadow-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Engine Hrs.</label>
                      <input
                        type="text"
                        placeholder="e.g. 1450 hrs"
                        value={logEngineHrs}
                        onChange={e => setLogEngineHrs(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">New / Repairs</label>
                      <select
                        value={logNewRepairs}
                        onChange={e => setLogNewRepairs(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-bold text-slate-700"
                      >
                        <option value="New">New</option>
                        <option value="Repairs">Repairs</option>
                        <option value="Replaced">Replaced</option>
                        <option value="Other">Other</option>
                        <option value="N/A">N/A</option>
                      </select>
                      {logNewRepairs === 'Other' && (
                        <input
                          type="text"
                          placeholder="Type custom option..."
                          value={logCustomNewRepairs}
                          onChange={e => setLogCustomNewRepairs(e.target.value)}
                          className="w-full mt-1.5 text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                          required
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Source (Souers)</label>
                      <input
                        type="text"
                        placeholder="e.g. Western Yard"
                        value={logSource}
                        onChange={e => setLogSource(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Send to</label>
                      <input
                        type="text"
                        placeholder="e.g. Hubli Depot"
                        value={logSendTo}
                        onChange={e => setLogSendTo(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Working life</label>
                      <input
                        type="text"
                        placeholder="e.g. 18 Months"
                        value={logWorkingLife}
                        onChange={e => setLogWorkingLife(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Description (Disecription)</label>
                      <textarea
                        placeholder="Provide details of log, replacements or checkups..."
                        value={logDescription}
                        onChange={e => setLogDescription(e.target.value)}
                        rows={2}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800 resize-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Remarks</label>
                      <textarea
                        placeholder="Provide miscellaneous remarks if any..."
                        value={logRemarks}
                        onChange={e => setLogRemarks(e.target.value)}
                        rows={2}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800 resize-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 py-2.5 text-xs font-bold transition-all shadow-md flex items-center gap-1.5 shadow-indigo-100 cursor-pointer"
                    >
                      <Plus size={14} /> Add History Log
                    </button>
                  </div>
                </form>

                {/* Log Records Listing Table Section */}
                <div className="space-y-4">
                  
                  {/* Local Log Records Finder Search and Filter */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 border border-slate-100 p-3 rounded-xl">
                    <div className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                      <ClipboardList size={14} className="text-slate-500" />
                      <span>History Log Records ({filteredTodos.length})</span>
                    </div>

                    <div className="relative w-full sm:max-w-xs">
                      <input
                        type="text"
                        placeholder="Search logs in this folder..."
                        value={recordsSearchQuery}
                        onChange={e => setRecordsSearchQuery(e.target.value)}
                        className="w-full text-[11px] border border-slate-200 rounded-lg pl-8 pr-7 py-2 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                      />
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      {recordsSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setRecordsSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  {filteredTodos.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-slate-200 rounded-2xl bg-slate-50/20">
                      <ClipboardList size={36} className="text-slate-300 mx-auto mb-2 stroke-[1.5]" />
                      <p className="text-xs text-slate-400 font-bold">
                        {todos.length === 0 ? "This folder has no history entries." : "No matching logs found inside this folder."}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {todos.length === 0 ? "Use the form above to log entries in this folder!" : "Adjust your logs search criteria."}
                      </p>
                    </div>
                  ) : (
                    <div className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[1000px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">Date</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Unit</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Engine Hrs.</th>
                              <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500">Description</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">New / Repairs</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Source (Souers)</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Send to</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Working life</th>
                              <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Remarks</th>
                              <th className="py-3 px-4 text-[10px] font-black uppercase tracking-wider text-slate-500 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredTodos.map(todo => {
                              const isCreator = todo.createdBy === auth.currentUser?.uid;
                              const canModify = isAdmin || isCreator;
                              return (
                                <tr key={todo.id} className="hover:bg-slate-50/40 transition-colors text-xs font-semibold text-slate-700">
                                  <td className="py-3.5 px-4 font-mono text-slate-900 font-extrabold whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <Calendar size={12} className="text-slate-400 shrink-0" />
                                      <span>
                                        {todo.date ? formatDateToDDMMYYYY(todo.date) : formatDateToDDMMYYYY(todo.createdAt?.split('T')[0])}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-3 truncate max-w-[120px]" title={todo.unit || ''}>
                                    <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-black font-mono">
                                      {todo.unit || '-'}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-3 font-mono font-bold whitespace-nowrap text-slate-800">
                                    <div className="flex items-center gap-1">
                                      <Clock size={11} className="text-slate-400" />
                                      <span>{todo.engineHrs || '-'}</span>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 max-w-[240px] break-words font-medium text-slate-800">
                                    {todo.description || todo.task || ''}
                                  </td>
                                  <td className="py-3.5 px-3">
                                    <span className={`inline-block px-2.5 py-0.5 rounded-sm text-[9px] font-black uppercase tracking-wider ${
                                      todo.newRepairs === 'New' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                      todo.newRepairs === 'Repairs' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                                      todo.newRepairs === 'Replaced' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                      'bg-slate-50 text-slate-600 border border-slate-200'
                                    }`}>
                                      {todo.newRepairs || 'N/A'}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-3 truncate max-w-[120px] text-slate-600" title={todo.source || ''}>
                                    {todo.source || '-'}
                                  </td>
                                  <td className="py-3.5 px-3 truncate max-w-[120px] text-slate-600" title={todo.sendTo || ''}>
                                    {todo.sendTo || '-'}
                                  </td>
                                  <td className="py-3.5 px-3 font-black text-indigo-900 whitespace-nowrap">
                                    {todo.workingLife || '-'}
                                  </td>
                                  <td className="py-3.5 px-3 max-w-[200px] break-words text-slate-500 font-medium text-[11px] italic">
                                    {todo.remarks || '-'}
                                  </td>
                                  <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                    {canModify ? (
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => setEditingTodo(todo)}
                                          className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors cursor-pointer"
                                          title="Edit Record"
                                        >
                                          <Edit2 size={13} />
                                        </button>
                                        <button
                                          onClick={() => setTaskToDelete(todo.id)}
                                          className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                          title="Delete Record"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 italic font-normal">Limited</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="bg-white border border-slate-200/80 rounded-2xl p-16 text-center shadow-xs">
                <FolderIcon size={48} className="text-slate-300 mx-auto mb-4 animate-bounce" />
                <h3 className="text-lg font-black text-slate-800">Select or Create a Folder</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">Please select a mechanical history folder from the left side library panel to view or add work logs.</p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Edit Record Dialog Modal */}
      <AnimatePresence>
        {editingTodo && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Edit2 size={16} className="text-indigo-600" /> Edit History Log
                </h3>
                <button
                  onClick={() => setEditingTodo(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={e => setEditDate(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Unit Name</label>
                    <input
                      type="text"
                      value={editUnit}
                      onChange={e => setEditUnit(e.target.value)}
                      placeholder="e.g. Engine Unit"
                      className="w-full text-xs border border-indigo-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Engine Hrs.</label>
                    <input
                      type="text"
                      value={editEngineHrs}
                      onChange={e => setEditEngineHrs(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">New / Repairs</label>
                    <select
                      value={editNewRepairs}
                      onChange={e => setEditNewRepairs(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-bold"
                    >
                      <option value="New">New</option>
                      <option value="Repairs">Repairs</option>
                      <option value="Replaced">Replaced</option>
                      <option value="Other">Other</option>
                      <option value="N/A">N/A</option>
                    </select>
                    {editNewRepairs === 'Other' && (
                      <input
                        type="text"
                        placeholder="Type custom option..."
                        value={editCustomNewRepairs}
                        onChange={e => setEditCustomNewRepairs(e.target.value)}
                        className="w-full mt-1.5 text-xs border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                        required
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Source (Souers)</label>
                    <input
                      type="text"
                      value={editSource}
                      onChange={e => setEditSource(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Send to</label>
                    <input
                      type="text"
                      value={editSendTo}
                      onChange={e => setEditSendTo(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Working life</label>
                    <input
                      type="text"
                      value={editWorkingLife}
                      onChange={e => setEditWorkingLife(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Description (Disecription)</label>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Remarks</label>
                    <textarea
                      value={editRemarks}
                      onChange={e => setEditRemarks(e.target.value)}
                      rows={3}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-semibold"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setEditingTodo(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-sm"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal for Deleting Folder */}
      <AnimatePresence>
        {folderToDelete && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Delete Folder Permanently?</h3>
                </div>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Are you sure you want to delete folder <span className="text-slate-800 font-bold">"{folderToDelete.name}"</span> and all of its associated tasks? This action is irreversible.
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setFolderToDelete(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteFolder(folderToDelete.id, folderToDelete.name)}
                    disabled={saving}
                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                  >
                    {saving ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal for Deleting Task */}
      <AnimatePresence>
        {taskToDelete && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Delete Record?</h3>
                </div>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Are you sure you want to permanently delete this history record?
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setTaskToDelete(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(taskToDelete)}
                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Folder / Unit Modal */}
      <AnimatePresence>
        {editingFolder && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Edit2 size={16} className="text-indigo-600" /> Edit Folder / Unit
                </h3>
                <button
                  onClick={() => setEditingFolder(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleUpdateFolder} className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Folder / Unit Name</label>
                  <input
                    type="text"
                    value={editFolderName}
                    onChange={e => setEditFolderName(e.target.value)}
                    placeholder="e.g. Engine-MPT-01"
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white font-semibold text-slate-800"
                    maxLength={40}
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Machine Name</label>
                  <select
                    value={editFolderMachine}
                    onChange={e => setEditFolderMachine(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white font-bold text-slate-700 cursor-pointer"
                  >
                    {allMachines.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setEditingFolder(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-indigo-100 cursor-pointer"
                  >
                    {saving ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Save size={13} />}
                    <span>Save Changes</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
