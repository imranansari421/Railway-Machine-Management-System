import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser, formatCreatorName, recordCareerTransition } from '../utils/employee';
import { getCompanyByMachine, MachineContract, buildMachineContractsMapping } from '../utils/contracts';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Cpu, Building2, Calendar, Clock, Plus, ArrowRightLeft, Loader2, FileText, MapPin, RotateCcw, CheckCircle2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { Link } from 'react-router-dom';

interface MovementRecord {
  id: string;
  machineName: string;
  companyName: string;
  fromDateTime: string;
  toDateTime: string;
  fromType?: string;
  toType?: string;
  fromZone?: string;
  fromDivision?: string;
  toZone?: string;
  toDivision?: string;
  createdAt: string;
  createdBy: string;
  employeeName: string;
}

export default function MachineMovement() {
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Lists for dropdowns
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Machine to Company mappings from contracts, employees, positions, etc.
  const [employeeCompanyMap, setEmployeeCompanyMap] = useState<Record<string, string>>({});
  const [contractCompanyMap, setContractCompanyMap] = useState<Record<string, string>>({});
  const [positionCompanyMap, setPositionCompanyMap] = useState<Record<string, string>>({});

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [machineName, setMachineName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [fromDateTime, setFromDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [fromType, setFromType] = useState('');
  const [toType, setToType] = useState('');
  const [fromZone, setFromZone] = useState('');
  const [fromDivision, setFromDivision] = useState('');
  const [toZone, setToZone] = useState('');
  const [toDivision, setToDivision] = useState('');
  const [originalMachineNameForEdit, setOriginalMachineNameForEdit] = useState<string>('');

  const latestMovementForSelectedMachine = useMemo(() => {
    if (!machineName) return null;
    return movements.find(m => m.machineName?.trim().toLowerCase() === machineName.trim().toLowerCase()) || null;
  }, [machineName, movements]);

  // Helper to find the associated company for any machine
  const findCompanyForMachine = (m: string): string => {
    if (!m) return '';
    const key = m.trim().toLowerCase();

    // 1. Check contracts first (active/current official contract)
    if (contractCompanyMap[key]) return contractCompanyMap[key];

    // 2. Check previous machine movement records
    const pastMovement = movements.find(mov => mov.machineName?.trim().toLowerCase() === key && mov.companyName?.trim());
    if (pastMovement?.companyName) return pastMovement.companyName.trim();

    // 3. Check employees mapped to this machine
    if (employeeCompanyMap[key]) return employeeCompanyMap[key];

    // 4. Check machine positions document
    if (positionCompanyMap[key]) return positionCompanyMap[key];

    return '';
  };

  // Auto-populate origin zone/division and company name when machine is selected
  useEffect(() => {
    if (!editingId) {
      if (latestMovementForSelectedMachine) {
        setFromZone(latestMovementForSelectedMachine.toZone || '');
        setFromDivision(latestMovementForSelectedMachine.toDivision || '');
      } else {
        setFromZone('');
        setFromDivision('');
      }

      if (machineName) {
        // Priority to machine_contracts (including transfers/renewals) then latest movement
        const autoCo = findCompanyForMachine(machineName) || latestMovementForSelectedMachine?.companyName || '';
        if (autoCo) {
          setCompanyName(autoCo);
        }
      }
    }
  }, [latestMovementForSelectedMachine, editingId, machineName]);

  // Secondary effect to fill companyName if data loaded asynchronously
  useEffect(() => {
    if (!editingId && machineName && !companyName) {
      const autoCo = findCompanyForMachine(machineName);
      if (autoCo) {
        setCompanyName(autoCo);
        setCompaniesList(prev => prev.includes(autoCo) ? prev : [...prev, autoCo].sort());
      }
    }
  }, [machineName, editingId, movements, employeeCompanyMap, contractCompanyMap, positionCompanyMap]);

  // User States
  const [isEmployee, setIsEmployee] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);
  const [userAccessType, setUserAccessType] = useState<string>('limited');

  const isReadOnlyAdmin = isEmployee && (userAccessType === 'admin-light' || userAccessType === 'zonal-admin' || userAccessType === 'divisional-admin');

  // 1. Check user profile and role
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isEmp = !!user.email?.endsWith('@employee.billedapp.com');
        setIsEmployee(isEmp);
        
        try {
          const emp = await findEmployeeForUser(user.uid, user.email);
          if (emp) {
            setEmployeeProfile(emp);
            const access = emp.accessType || 'limited';
            setUserAccessType(access);
            if (isEmp) {
              setMachineName(emp.machineName || '');
              setCompanyName(emp.companyName || '');
            }
          } else {
            setUserAccessType('full');
          }
        } catch (error) {
          console.error("Error checking employee profile:", error);
        }
      }
    });
    return unsubscribeAuth;
  }, []);

  // 2. Fetch machines and companies list & maintain machine-to-company linkages
  useEffect(() => {
    let generalMachines: string[] = [];
    let empMachines: string[] = [];
    let contractMachines: string[] = [];
    let posMachines: string[] = [];
    let allEmpCompanies: string[] = [];
    let allContractCompanies: string[] = [];
    let allPosCompanies: string[] = [];
    let allDirectCompanies: string[] = [];

    const defaultStandardMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];

    const recomputeLists = () => {
      const mergedMachines = new Set([
        ...defaultStandardMachines,
        ...generalMachines,
        ...empMachines,
        ...contractMachines,
        ...posMachines
      ]);
      setMachinesList(Array.from(mergedMachines).filter(Boolean).sort());

      const mergedCompanies = new Set([
        ...allEmpCompanies,
        ...allContractCompanies,
        ...allPosCompanies,
        ...allDirectCompanies
      ]);
      setCompaniesList(Array.from(mergedCompanies).filter(Boolean).sort());
    };

    // A. General Settings
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          generalMachines = data.machines;
        }
        if (data.companies && Array.isArray(data.companies)) {
          allDirectCompanies = data.companies;
        }
      }
      recomputeLists();
    });

    // B. Employees
    const unsubscribeEmployees = onSnapshot(collection(db, 'employees'), (snap) => {
      const companiesSet = new Set<string>();
      const machinesSet = new Set<string>();
      const empMap: Record<string, string> = {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.companyName) companiesSet.add(data.companyName.trim());
        if (data.machineName) {
          const mTrim = data.machineName.trim();
          machinesSet.add(mTrim);
          if (data.companyName) {
            empMap[mTrim.toLowerCase()] = data.companyName.trim();
          }
        }
      });
      allEmpCompanies = Array.from(companiesSet);
      empMachines = Array.from(machinesSet);
      setEmployeeCompanyMap(empMap);
      recomputeLists();
    });

    // C. Machine Contracts (Direct Official Machine-to-Company Linkage with Transfer & Expiry Handling)
    const unsubscribeContracts = onSnapshot(collection(db, 'machine_contracts'), (snap) => {
      const cMap: Record<string, string> = {};
      const cSet = new Set<string>();
      const mSet = new Set<string>();
      const rawContracts: MachineContract[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        rawContracts.push({ id: docSnap.id, ...data } as MachineContract);
        if (data.companyName) cSet.add(data.companyName.trim());
        if (data.transferredToCompany) cSet.add(data.transferredToCompany.trim());
        if (data.machineName) mSet.add(data.machineName.trim());
      });

      // Use centralized resolution which accounts for active, transferred, and expired
      const mappings = buildMachineContractsMapping(rawContracts);
      Object.entries(mappings).forEach(([mName, res]) => {
        if (res.companyName) {
          cMap[mName.toLowerCase()] = res.companyName;
          cSet.add(res.companyName);
        }
      });

      allContractCompanies = Array.from(cSet);
      contractMachines = Array.from(mSet);
      setContractCompanyMap(cMap);
      recomputeLists();
    });

    // D. Machine Positions
    const unsubscribePositions = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const pMap: Record<string, string> = {};
      const mSet = new Set<string>();
      const cSet = new Set<string>();

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const mTrim = (data.machineName || docSnap.id || '').trim();
        if (mTrim) {
          mSet.add(mTrim);
          if (data.companyName) {
            cSet.add(data.companyName.trim());
            pMap[mTrim.toLowerCase()] = data.companyName.trim();
          }
        }
      });
      posMachines = Array.from(mSet);
      allPosCompanies = Array.from(cSet);
      setPositionCompanyMap(pMap);
      recomputeLists();
    });

    // E. Dedicated Companies Collection
    const unsubscribeCompanies = onSnapshot(collection(db, 'companies'), (snap) => {
      const cSet = new Set<string>();
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const name = (data.name || data.companyName || '').trim();
        if (name) cSet.add(name);
      });
      allDirectCompanies = Array.from(new Set([...allDirectCompanies, ...Array.from(cSet)]));
      recomputeLists();
    });

    return () => {
      unsubscribeSettings();
      unsubscribeEmployees();
      unsubscribeContracts();
      unsubscribePositions();
      unsubscribeCompanies();
    };
  }, []);

  // Handle user selecting machine from dropdown: updates machine and auto-fills company name
  const handleMachineChange = async (selectedMachine: string) => {
    setMachineName(selectedMachine);
    if (!editingId) {
      if (!selectedMachine) {
        setCompanyName('');
        return;
      }
      // Instant in-memory auto-fill
      const autoCo = findCompanyForMachine(selectedMachine);
      if (autoCo) {
        setCompanyName(autoCo);
        setCompaniesList(prev => prev.includes(autoCo) ? prev : [...prev, autoCo].sort());
      } else {
        // Asynchronous fallback query to contracts and employees
        try {
          const contractCo = await getCompanyByMachine(selectedMachine);
          if (contractCo) {
            setCompanyName(contractCo);
            setCompaniesList(prev => prev.includes(contractCo) ? prev : [...prev, contractCo].sort());
            return;
          }

          const empQ = query(collection(db, 'employees'), where('machineName', '==', selectedMachine));
          const empSnap = await getDocs(empQ);
          if (!empSnap.empty) {
            const firstEmp = empSnap.docs[0].data();
            if (firstEmp.companyName) {
              setCompanyName(firstEmp.companyName);
              setCompaniesList(prev => prev.includes(firstEmp.companyName) ? prev : [...prev, firstEmp.companyName].sort());
            }
          }
        } catch (err) {
          console.error("Error auto-fetching company for machine:", err);
        }
      }
    }
  };

  // 3. Listen to real-time machine movements
  useEffect(() => {
    const unsubscribeMovements = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list: MovementRecord[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          machineName: data.machineName || '',
          companyName: data.companyName || '',
          fromDateTime: data.fromDateTime || '',
          toDateTime: data.toDateTime || '',
          fromType: data.fromType || 'Block Time',
          toType: data.toType || 'Base Depot',
          fromZone: data.fromZone || '',
          fromDivision: data.fromDivision || '',
          toZone: data.toZone || '',
          toDivision: data.toDivision || '',
          createdAt: data.createdAt || '',
          createdBy: data.createdBy || '',
          employeeName: data.employeeName || 'Unknown'
        });
      });
      // Sort by creation time or start date descending
      list.sort((a, b) => b.fromDateTime.localeCompare(a.fromDateTime));
      setMovements(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading machine movements:", error);
      toast.error("Failed to load machine movements records.");
      setLoading(false);
    });

    return unsubscribeMovements;
  }, []);

  // Synchronize latest machine movement destination with machine_positions and employees collections
  const syncLatestMovementForMachine = async (machine: string) => {
    if (!machine) return;
    try {
      // 1. Fetch all movements for this machine
      const q = query(collection(db, 'machine_movements'), where('machineName', '==', machine));
      const snap = await getDocs(q);
      const machineMovements: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        machineMovements.push({ id: d.id, ...data });
      });

      // 2. Sort by fromDateTime descending to get the latest movement
      machineMovements.sort((a, b) => b.fromDateTime.localeCompare(a.fromDateTime));

      if (machineMovements.length > 0) {
        const latest = machineMovements[0];
        const latestZone = latest.toZone || '';
        const latestDivision = latest.toDivision || '';
        const latestCompany = latest.companyName || '';
        const shiftDate = latest.fromDateTime ? latest.fromDateTime.split('T')[0] : new Date().toISOString().split('T')[0];

        // Update global machine position
        await setDoc(doc(db, 'machine_positions', machine), {
          machineName: machine,
          zone: latestZone,
          division: latestDivision,
          companyName: latestCompany,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // Update all mapped employees
        const empQuery = query(collection(db, 'employees'), where('machineName', '==', machine));
        const empSnap = await getDocs(empQuery);
        for (const docSnap of empSnap.docs) {
          const empData = docSnap.data();
          const currentHist = empData.zoneDivisionHistory || [];
          const empDoj = empData.doj ? empData.doj.split('T')[0] : '';
          
          // Append new history entry if different or not present
          const hasThisEntry = currentHist.some((h: any) => h.fromDateTime === latest.fromDateTime && h.toDateTime === latest.toDateTime);
          let updatedHist = currentHist;
          if (!hasThisEntry) {
            updatedHist = [
              ...currentHist,
              {
                zone: latestZone,
                division: latestDivision,
                machineName: machine,
                companyName: empData.companyName || latestCompany || 'General',
                fromDateTime: latest.fromDateTime,
                toDateTime: latest.toDateTime,
                updatedAt: new Date().toISOString()
              }
            ];
          }

          // Rule 1: "only us employee ke date of joining se match kare data save hoye"
          const isBeforeDoj = empDoj && shiftDate < empDoj;

          // Rule 2: "yadi machine same division me hai to aur machine movement me hai to data carerr me save n hoye jab tak machine division se bahar n aaye tab tak data save n hoye"
          const prevDivision = (empData.division || latest.fromDivision || '').trim().toLowerCase();
          const newDivision = (latestDivision || '').trim().toLowerCase();
          const prevZone = (empData.zone || latest.fromZone || '').trim().toLowerCase();
          const newZone = (latestZone || '').trim().toLowerCase();
          const isSameDivision = prevDivision && newDivision && prevDivision === newDivision && prevZone === newZone;

          const originZone = latest.fromZone || empData.zone || 'N/A';
          const originDivision = latest.fromDivision || empData.division || 'N/A';
          const destZone = latestZone || 'N/A';
          const destDivision = latestDivision || 'N/A';

          // Career history transition (tracks kab se kab tak in division/zone, company, designation)
          let updatedCareer = empData.careerHistory || [];

          // Only save to career history if NOT before DOJ and machine has moved OUT of division
          if (!isBeforeDoj && !isSameDivision && (prevDivision !== newDivision || prevZone !== newZone)) {
            updatedCareer = recordCareerTransition({
              currentCareerHistory: updatedCareer,
              newPosting: {
                companyName: empData.companyName || latestCompany || 'General',
                machineName: machine,
                zone: destZone,
                division: destDivision,
                fromZone: originZone,
                fromDivision: originDivision,
                toZone: destZone,
                toDivision: destDivision,
                designation: empData.designation || 'Staff',
                fromDateTime: shiftDate,
                remarks: `Transferred: ${originZone} (${originDivision}) ➔ ${destZone} (${destDivision})`,
                status: 'active',
                addedBy: employeeProfile?.name || auth.currentUser?.email || 'Machine Movement Sync'
              },
              baselineEmployee: {
                doj: empData.doj,
                companyName: empData.companyName,
                machineName: machine,
                zone: originZone,
                division: originDivision,
                designation: empData.designation
              }
            });
          }

          await updateDoc(docSnap.ref, {
            zone: latestZone,
            division: latestDivision,
            zoneDivisionHistory: updatedHist,
            careerHistory: updatedCareer
          });
        }
      } else {
        // If no movements left for this machine, reset position and employee assignments
        await setDoc(doc(db, 'machine_positions', machine), {
          machineName: machine,
          zone: '',
          division: '',
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const empQuery = query(collection(db, 'employees'), where('machineName', '==', machine));
        const empSnap = await getDocs(empQuery);
        for (const docSnap of empSnap.docs) {
          await updateDoc(docSnap.ref, {
            zone: '',
            division: ''
          });
        }
      }
    } catch (err) {
      console.error("Error synchronizing latest machine movement:", err);
    }
  };

  // 4. Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineName) {
      toast.error("Please select or enter a Machine Name");
      return;
    }
    if (!companyName) {
      toast.error("Please select or enter a Company Name");
      return;
    }
    if (!toZone) {
      toast.error("Please select a destination Railway Zone");
      return;
    }
    if (!toDivision) {
      toast.error("Please select a destination Division");
      return;
    }
    if (!fromDateTime || !toDateTime) {
      toast.error("Please specify both From and To date-times");
      return;
    }
    if (new Date(fromDateTime) >= new Date(toDateTime)) {
      toast.error("To Date/Time must be after From Date/Time");
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      const rawUserName = employeeProfile?.name || user?.displayName || user?.email || 'Admin';
      const userName = formatCreatorName(rawUserName);

      const payload = {
        machineName,
        companyName,
        fromDateTime,
        toDateTime,
        fromType,
        toType,
        fromZone,
        fromDivision,
        toZone,
        toDivision,
        updatedAt: new Date().toISOString(),
        employeeName: userName,
        createdBy: user?.uid || 'Unknown'
      };

      if (editingId) {
        await updateDoc(doc(db, 'machine_movements', editingId), payload);
        toast.success("Machine movement record updated successfully!");
        setEditingId(null);
        // Sync both old and new machines if they differ
        await syncLatestMovementForMachine(machineName);
        if (originalMachineNameForEdit && originalMachineNameForEdit !== machineName) {
          await syncLatestMovementForMachine(originalMachineNameForEdit);
        }
        setOriginalMachineNameForEdit('');
      } else {
        await addDoc(collection(db, 'machine_movements'), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
        toast.success("Machine movement record saved successfully!");
        await syncLatestMovementForMachine(machineName);
      }

      // Reset form (except for static employee inputs)
      if (!isEmployee) {
        setMachineName('');
        setCompanyName('');
      }
      setFromDateTime('');
      setToDateTime('');
      setFromType('');
      setToType('');
      setFromZone('');
      setFromDivision('');
      setToZone('');
      setToDivision('');
    } catch (error) {
      console.error("Error saving machine movement:", error);
      handleFirestoreError(error, OperationType.CREATE, 'machine_movements');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (rec: MovementRecord) => {
    setEditingId(rec.id);
    setOriginalMachineNameForEdit(rec.machineName);
    setMachineName(rec.machineName);
    setCompanyName(rec.companyName);
    setFromDateTime(rec.fromDateTime);
    setToDateTime(rec.toDateTime);
    setFromType(rec.fromType || '');
    setToType(rec.toType || '');
    setFromZone(rec.fromZone || '');
    setFromDivision(rec.fromDivision || '');
    setToZone(rec.toZone || '');
    setToDivision(rec.toDivision || '');
  };

  const handleReset = () => {
    if (!isEmployee) {
      setMachineName('');
      setCompanyName('');
    }
    setFromDateTime('');
    setToDateTime('');
    setFromType('');
    setToType('');
    setFromZone('');
    setFromDivision('');
    setToZone('');
    setToDivision('');
    setEditingId(null);
    setOriginalMachineNameForEdit('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      {/* Top Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-indigo-950 flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/60">
                <ArrowRightLeft size={22} />
              </span>
              Machine Movement Tracker
            </h1>
            <p className="text-xs text-slate-500 font-semibold mt-1">
              Log machine transit schedules, origin and destination railway zones, divisions, and operational movements.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/report?tab=machine-movement"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black rounded-xl border border-indigo-200/60 transition-all shadow-xs active:scale-95"
            >
              <FileText size={15} />
              View Movement Report & Records
              <ArrowRight size={13} className="text-indigo-400" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content Area - Full Landscape Form */}
      <div className="flex-grow overflow-y-auto h-full pr-1 pb-16">
        {isReadOnlyAdmin ? (
          <div className="w-full max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200/80 p-10 shadow-sm text-center space-y-4 my-8">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-100">
              <ArrowRightLeft size={28} />
            </div>
            <h3 className="text-lg font-black text-slate-800">Read-Only Access</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto font-medium leading-relaxed">
              Your account has view-only permissions for machine movement logging. You can view, search, and export past transit logs in the Movement Report ledger.
            </p>
            <div className="pt-2">
              <Link
                to="/report?tab=machine-movement"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm active:scale-95"
              >
                <FileText size={16} />
                Open Machine Movement Report
              </Link>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl mx-auto bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm">
            {/* Landscape Form Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                  {editingId ? 'Edit Movement Record' : 'Log New Movement'}
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Complete machine, route, timing, and transit location details below.
                </p>
              </div>

              {latestMovementForSelectedMachine && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs font-bold text-indigo-900">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Latest Destination:</span>
                  <span className="text-indigo-700 font-extrabold">{latestMovementForSelectedMachine.toZone}</span>
                  <span className="text-slate-400">/</span>
                  <span className="text-indigo-700 font-extrabold">{latestMovementForSelectedMachine.toDivision}</span>
                  {latestMovementForSelectedMachine.toType && (
                    <span className="text-slate-500 font-normal">({latestMovementForSelectedMachine.toType})</span>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Row 1: Machine & Enterprise Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                    Machine Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Cpu className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={17} />
                    {!isEmployee ? (
                      <select
                        value={machineName}
                        onChange={(e) => handleMachineChange(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      >
                        <option value="">Select Machine</option>
                        {machinesList.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={machineName}
                        disabled
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                    Company Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={17} />
                    {!isEmployee ? (
                      <select
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      >
                        <option value="">Select Company</option>
                        {companyName && !companiesList.includes(companyName) && (
                          <option key={companyName} value={companyName}>{companyName}</option>
                        )}
                        {companiesList.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={companyName}
                        disabled
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Railway Origin & Destination (4 Columns Landscape Layout) */}
              <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-slate-600 uppercase tracking-wider">
                  <MapPin size={15} className="text-indigo-600" />
                  Railway Route & Locations (Origin → Destination)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* From Zone */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      From (Origin) Zone
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <select
                        value={fromZone}
                        onChange={(e) => {
                          setFromZone(e.target.value);
                          setFromDivision('');
                        }}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      >
                        <option value="">Select Origin Zone</option>
                        {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* From Division */}
                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      From (Origin) Division
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <select
                        value={fromDivision}
                        onChange={(e) => setFromDivision(e.target.value)}
                        disabled={!fromZone}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Origin Division</option>
                        {fromZone && RAILWAY_ZONES_DIVISIONS[fromZone]?.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* To Zone */}
                  <div>
                    <label className="block text-[11px] font-black text-indigo-900 uppercase tracking-wider mb-1.5">
                      To (Destination) Zone <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 z-10" size={15} />
                      <select
                        value={toZone}
                        onChange={(e) => {
                          setToZone(e.target.value);
                          setToDivision('');
                        }}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      >
                        <option value="">Select Destination Zone</option>
                        {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                          <option key={z} value={z}>{z}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* To Division */}
                  <div>
                    <label className="block text-[11px] font-black text-indigo-900 uppercase tracking-wider mb-1.5">
                      To (Destination) Division <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 z-10" size={15} />
                      <select
                        value={toDivision}
                        onChange={(e) => setToDivision(e.target.value)}
                        disabled={!toZone}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-indigo-950 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Destination Division</option>
                        {toZone && RAILWAY_ZONES_DIVISIONS[toZone]?.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Timings & Movement Types (4 Columns Landscape Layout) */}
              <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-slate-600 uppercase tracking-wider">
                  <Calendar size={15} className="text-indigo-600" />
                  Transit Timings & Movement Context
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      From (Start) Date & Time <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="datetime-local"
                        value={fromDateTime}
                        onChange={(e) => setFromDateTime(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      To (End) Date & Time <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" size={15} />
                      <input
                        type="datetime-local"
                        value={toDateTime}
                        onChange={(e) => setToDateTime(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      From Type (Origin Location)
                    </label>
                    <input
                      type="text"
                      value={fromType}
                      onChange={(e) => setFromType(e.target.value)}
                      placeholder="e.g. Block Time, Yard, Workshop"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
                      To Type (Destination Location)
                    </label>
                    <input
                      type="text"
                      value={toType}
                      onChange={(e) => setToType(e.target.value)}
                      placeholder="e.g. Base Depot, Station, Site"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Form Action Buttons (Horizontal Landscape Bar) */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-7 py-3 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all ${
                      editingId
                        ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 shadow-amber-600/25'
                        : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-emerald-600/25'
                    }`}
                  >
                    {submitting ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : editingId ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Plus size={16} />
                    )}
                    {editingId ? 'Update Movement Record' : 'Save Movement Record'}
                  </button>

                  {editingId ? (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50 transition-all"
                    >
                      Cancel Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="inline-flex items-center gap-1.5 px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50 transition-all"
                    >
                      <RotateCcw size={13} />
                      Reset
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-400 font-semibold text-center sm:text-right">
                  Destination updates machine coordinates across all modules automatically.
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </motion.div>
  );
}
