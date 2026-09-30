import { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, query, where, doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, TrendingDown, Users, Package, ClipboardList, Calendar, MoreHorizontal, 
  AlertTriangle, Bell, Activity, ArrowUpRight, ArrowDownRight, Layers, ArrowRightLeft,
  FileCheck2, CheckCircle2, SlidersHorizontal, Clock
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, Legend 
} from 'recharts';
import { findEmployeeForUser, getFilterAccessPermissions } from '../utils/employee';
import { MachineContract, buildMachineContractsMapping } from '../utils/contracts';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { cn } from '../lib/utils';
import { TrackMachineLoader } from '../components/TrackMachineLoader';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}

import { motion } from 'motion/react';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalEmployees: 0,
    stockValue: 0,
    pendingDemands: 0,
    reviewDemands: 0,
    urgentDemands: 0,
    completedDemands: 0,
  });
  const [topParts, setTopParts] = useState<{ name: string; value: number }[]>([]);
  const [stockDistribution, setStockDistribution] = useState<{ name: string; value: number; color: string }[]>([]);
  const [lowStockParts, setLowStockParts] = useState<any[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  // Line Chart Controls
  const [chartTimeRange, setChartTimeRange] = useState<string>('6months');
  const [chartMetric, setChartMetric] = useState<'all' | 'issue' | 'demand' | 'pending'>('all');
  const [chartUnit, setChartUnit] = useState<'quantity' | 'count'>('quantity');

  // Stored raw records for instant timeline calculations
  const [fetchedDemands, setFetchedDemands] = useState<any[]>([]);
  const [fetchedTransactions, setFetchedTransactions] = useState<any[]>([]);
  const [fetchedStoreIssues, setFetchedStoreIssues] = useState<any[]>([]);
  const [fetchedEmployees, setFetchedEmployees] = useState<any[]>([]);

  const [currentUser, setCurrentUser] = useState<any>(() => auth.currentUser);
  const isEmployee = currentUser?.email?.endsWith('@employee.billedapp.com');
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [filterZone, setFilterZone] = useState(() => {
    const aType = auth.currentUser?.uid ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || '' : '';
    if (aType === 'zonal-admin' || aType === 'divisional-admin') {
      return (auth.currentUser?.uid && localStorage.getItem(`userZone_${auth.currentUser.uid}`)) || 'all';
    }
    return 'all';
  });
  const [filterDivision, setFilterDivision] = useState(() => {
    const aType = auth.currentUser?.uid ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || '' : '';
    if (aType === 'divisional-admin') {
      return (auth.currentUser?.uid && localStorage.getItem(`userDivision_${auth.currentUser.uid}`)) || 'all';
    }
    return 'all';
  });
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_positions'), (snap) => {
      const mapping: Record<string, { zone: string; division: string }> = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const mName = data.machineName || docSnap.id;
        if (mName) {
          mapping[mName] = {
            zone: data.zone || '',
            division: data.division || ''
          };
        }
      });
      setMachinePositions(mapping);
    });
    return () => unsub();
  }, []);
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [machineToCompany, setMachineToCompany] = useState<Record<string, string>>({});
  
  const [userMachine, setUserMachine] = useState<string>(() => {
    return (auth.currentUser?.uid && localStorage.getItem(`userMachineName_${auth.currentUser.uid}`)) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return (auth.currentUser?.uid && localStorage.getItem(`companyName_${auth.currentUser.uid}`)) || '';
  });
  const [currentUserAccessType, setCurrentUserAccessType] = useState<string>(() => {
    return (auth.currentUser?.uid && localStorage.getItem(`accessType_${auth.currentUser.uid}`)) || '';
  });
  const [currentUserZone, setCurrentUserZone] = useState<string>(() => {
    return (auth.currentUser?.uid && localStorage.getItem(`userZone_${auth.currentUser.uid}`)) || '';
  });
  const [currentUserDivision, setCurrentUserDivision] = useState<string>(() => {
    return (auth.currentUser?.uid && localStorage.getItem(`userDivision_${auth.currentUser.uid}`)) || '';
  });
  
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companyMachinesList, setCompanyMachinesList] = useState<string[]>([]);

  // Check if current user has any administrative privilege
  const isAnyAdmin = !isEmployee || 
    currentUserAccessType === 'admin-light' || 
    currentUserAccessType === 'zonal-admin' || 
    currentUserAccessType === 'divisional-admin' || 
    currentUserAccessType === 'full' || 
    currentUserAccessType === 'master';

  // Helper function to resolve machine zone from positions or employee records
  const getMachineZone = (m?: string): string => {
    if (!m) return '';
    if (machinePositions[m]?.zone) return machinePositions[m].zone;
    const empMatch = fetchedEmployees.find(e => e.machineName === m && e.zone);
    return empMatch?.zone || '';
  };

  // Helper function to resolve machine division from positions or employee records
  const getMachineDivision = (m?: string): string => {
    if (!m) return '';
    if (machinePositions[m]?.division) return machinePositions[m].division;
    const empMatch = fetchedEmployees.find(e => e.machineName === m && e.division);
    return empMatch?.division || '';
  };

  // Fetch / Sync configured machines list
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const checkAccessAndFetch = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const userIsEmployee = user.email?.endsWith('@employee.billedapp.com');
      if (userIsEmployee) {
        try {
          const emp = await findEmployeeForUser(user.uid, user.email);
          if (emp && user.uid) {
            setEmployeeProfile(emp);
            const mName = emp.machineName || '';
            setUserMachine(mName);
            localStorage.setItem(`userMachineName_${user.uid}`, mName);

            const coName = emp.companyName || '';
            setCurrentUserCompanyName(coName);
            localStorage.setItem(`companyName_${user.uid}`, coName);

            const aType = emp.accessType || '';
            setCurrentUserAccessType(aType);
            localStorage.setItem(`accessType_${user.uid}`, aType);

            const uZone = emp.zone || '';
            setCurrentUserZone(uZone);
            if (uZone) localStorage.setItem(`userZone_${user.uid}`, uZone);

            const uDiv = emp.division || '';
            setCurrentUserDivision(uDiv);
            if (uDiv) localStorage.setItem(`userDivision_${user.uid}`, uDiv);

            if (aType === 'zonal-admin' || aType === 'divisional-admin') {
              if (uZone) setFilterZone(uZone);
              if (aType === 'divisional-admin' && uDiv) setFilterDivision(uDiv);
            }
            if ((aType === 'full' || aType === 'limited' || aType === 'admin-light') && mName) {
              setSelectedMachine(mName);
            }
          }
        } catch (error) {
          console.error('Error loading employee info on dashboard:', error);
        }
      }
    };
    checkAccessAndFetch();
  }, [currentUser, isEmployee]);

  const isZonalAdmin = isEmployee && currentUserAccessType === 'zonal-admin';
  const isDivisionalAdmin = isEmployee && currentUserAccessType === 'divisional-admin';

  // Calculate centralized filter permissions based on employee access type and mappings
  const filterPerms = useMemo(() => {
    return getFilterAccessPermissions(isEmployee, currentUserAccessType, employeeProfile, {
      machineName: userMachine,
      zone: currentUserZone,
      division: currentUserDivision,
    });
  }, [isEmployee, currentUserAccessType, employeeProfile, userMachine, currentUserZone, currentUserDivision]);

  // Keep active filter selections strictly synchronized with locked permissions
  useEffect(() => {
    if (!filterPerms.canChangeMachine) {
      const lockMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      if (lockMachine && selectedMachine !== lockMachine) {
        setSelectedMachine(lockMachine);
      }
    }
    if (!filterPerms.canChangeZone) {
      const lockZone = currentUserZone || (userMachine ? getMachineZone(userMachine) : '') || localStorage.getItem(`userZone_${auth.currentUser?.uid}`) || '';
      if (lockZone && lockZone !== 'all' && filterZone !== lockZone) {
        setFilterZone(lockZone);
      }
    }
    if (!filterPerms.canChangeDivision) {
      const lockDiv = currentUserDivision || (userMachine ? getMachineDivision(userMachine) : '') || localStorage.getItem(`userDivision_${auth.currentUser?.uid}`) || '';
      if (lockDiv && lockDiv !== 'all' && filterDivision !== lockDiv) {
        setFilterDivision(lockDiv);
      }
    }
  }, [filterPerms, userMachine, currentUserZone, currentUserDivision, selectedMachine, filterZone, filterDivision, machinePositions]);

  // Compute machine options strictly based on employee role:
  // - Full admin mapped to a machine: only that machine
  // - Zonal admin: only machines in their zone
  // - Divisional admin: only machines in their division
  const availableMachines = useMemo(() => {
    // 1. Full Admin Employee:
    // If mapped to a machine, they can strictly access that machine only!
    if (isEmployee && currentUserAccessType === 'full') {
      const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      if (myMachine) {
        return [myMachine];
      }
      let list = companyMachinesList.length > 0 ? companyMachinesList : machinesList;
      if (filterZone !== 'all') {
        list = list.filter(m => {
          const z = getMachineZone(m);
          return !z || z === filterZone;
        });
      }
      if (filterDivision !== 'all') {
        list = list.filter(m => {
          const d = getMachineDivision(m);
          return !d || d === filterDivision;
        });
      }
      return list;
    }

    // 2. Zonal Admin: Only machines belonging to their assigned zone
    if (isEmployee && currentUserAccessType === 'zonal-admin') {
      const targetZone = currentUserZone || filterZone || localStorage.getItem(`userZone_${auth.currentUser?.uid}`) || '';
      if (targetZone && targetZone !== 'all') {
        let inZone = machinesList.filter(m => getMachineZone(m) === targetZone);
        if (filterDivision !== 'all') {
          inZone = inZone.filter(m => getMachineDivision(m) === filterDivision);
        }
        return inZone;
      }
      return [];
    }

    // 3. Divisional Admin: Only machines belonging to their assigned division
    if (isEmployee && currentUserAccessType === 'divisional-admin') {
      const targetDiv = currentUserDivision || filterDivision || localStorage.getItem(`userDivision_${auth.currentUser?.uid}`) || '';
      if (targetDiv && targetDiv !== 'all') {
        return machinesList.filter(m => getMachineDivision(m) === targetDiv);
      }
      return [];
    }

    // 4. Master Admin / Super Admin (non-employee)
    if (!isEmployee || currentUserAccessType === 'master') {
      if (filterZone !== 'all' || filterDivision !== 'all') {
        const filtered = machinesList.filter(m => {
          const z = getMachineZone(m);
          const d = getMachineDivision(m);
          if (filterZone !== 'all' && z && z !== filterZone) return false;
          if (filterDivision !== 'all' && d && d !== filterDivision) return false;
          return true;
        });
        return filtered;
      }
      return machinesList;
    }

    // 5. Company Admin (admin-light)
    if (currentUserAccessType === 'admin-light') {
      if (userMachine) return [userMachine];
      return companyMachinesList.length > 0 ? companyMachinesList : machinesList;
    }

    // 6. Limited / Machine Employee
    return userMachine ? [userMachine] : machinesList;
  }, [
    isEmployee, 
    currentUserAccessType, 
    currentUserZone, 
    currentUserDivision, 
    filterZone, 
    filterDivision, 
    machinesList, 
    machinePositions, 
    companyMachinesList, 
    userMachine,
    fetchedEmployees
  ]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchStats();
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [selectedMachine, selectedCompany, userMachine, currentUserCompanyName, currentUserAccessType, isEmployee, filterZone, filterDivision, machinePositions]);

  const fetchStats = async () => {
    try {
      let employeesSnap;
      try {
        employeesSnap = await getDocs(collection(db, 'employees'));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'employees');
        return;
      }
      
      const empList = employeesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      // Fetch machine_contracts to accurately resolve active contracts, transfers, and expirations
      let contractsSnap;
      try {
        contractsSnap = await getDocs(collection(db, 'machine_contracts'));
      } catch (cErr) {
        console.warn("Contracts fetch warning in Dashboard:", cErr);
      }
      const rawContracts: MachineContract[] = contractsSnap ? contractsSnap.docs.map(d => ({ id: d.id, ...d.data() } as MachineContract)) : [];
      const contractMappings = buildMachineContractsMapping(rawContracts);

      const m2c: Record<string, string> = {};
      // 1. Initial fallback from employee records
      empList.forEach(e => {
        if (e.machineName && e.companyName) {
          m2c[e.machineName] = e.companyName;
        }
      });
      // 2. Authoritative contract mapping overrides (handles active, transferred, and expired machines)
      Object.entries(contractMappings).forEach(([mName, res]) => {
        if (res.companyName) {
          m2c[mName] = res.companyName;
        }
      });
      setMachineToCompany(m2c);

      // Compute list of companies dynamically from all sources
      const contractCompanies = rawContracts.map(c => c.companyName).filter(Boolean);
      const transferredCompanies = rawContracts.map(c => c.transferredToCompany).filter(Boolean) as string[];
      const uniqueCos = Array.from(new Set([
        ...empList.map(e => e.companyName).filter((c): c is string => !!c),
        ...contractCompanies,
        ...transferredCompanies
      ]));
      setCompaniesList(uniqueCos);

      const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        const empMachs = empList.filter(e => e.companyName === myCompany).map(e => e.machineName).filter(Boolean);
        const contractedMachs = Object.entries(contractMappings)
          .filter(([_, res]) => res.companyName?.toLowerCase() === myCompany.toLowerCase())
          .map(([m]) => m);
        const companyMachines = Array.from(new Set([...empMachs, ...contractedMachs])) as string[];
        setCompanyMachinesList(companyMachines);
      }

      const filteredEmployees = empList.filter(emp => {
        if (emp.status !== 'active') return false;

        // Filter by company
        if (selectedCompany !== 'all' && emp.companyName !== selectedCompany) return false;

        // Zone Filter
        if (filterZone !== 'all') {
          const empZone = emp.zone || machinePositions[emp.machineName || '']?.zone;
          if (empZone !== filterZone) return false;
        }
        // Division Filter
        if (filterDivision !== 'all') {
          const empDiv = emp.division || machinePositions[emp.machineName || '']?.division;
          if (empDiv !== filterDivision) return false;
        }

        if (isEmployee) {
          const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
          if (myCompany && emp.companyName && emp.companyName !== myCompany) return false;

          if (currentUserAccessType === 'admin-light') {
            if (userMachine) return emp.machineName === userMachine;
            return selectedMachine === 'all' || emp.machineName === selectedMachine;
          } else if (currentUserAccessType === 'zonal-admin') {
            const z = currentUserZone || filterZone;
            const empZone = emp.zone || getMachineZone(emp.machineName || '');
            if (z && z !== 'all' && empZone !== z) return false;
            if (filterDivision !== 'all') {
              const empDiv = emp.division || getMachineDivision(emp.machineName || '');
              if (empDiv !== filterDivision) return false;
            }
            return selectedMachine === 'all' || emp.machineName === selectedMachine;
          } else if (currentUserAccessType === 'divisional-admin') {
            const d = currentUserDivision || filterDivision;
            const empDiv = emp.division || getMachineDivision(emp.machineName || '');
            if (d && d !== 'all' && empDiv !== d) return false;
            return selectedMachine === 'all' || emp.machineName === selectedMachine;
          } else if (currentUserAccessType === 'full') {
            const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            if (myMachine) return emp.machineName === myMachine;
            return selectedMachine === 'all' || emp.machineName === selectedMachine;
          } else {
            const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            if (myMachine) return emp.machineName === myMachine;
            return true;
          }
        } else {
          return selectedMachine === 'all' || emp.machineName === selectedMachine;
        }
      });
      const activeEmployees = filteredEmployees.length;

      let partsSnap;
      try {
        partsSnap = await getDocs(collection(db, 'parts'));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'parts');
        return;
      }

      const allParts = partsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      const lowStockList = allParts.filter((part: any) => {
        const stock = typeof part.stock === 'number' ? part.stock : 0;
        const minQty = typeof part.minQty === 'number' ? part.minQty : 5; // Default threshold is 5
        return stock < minQty;
      });
      setLowStockParts(lowStockList);

      const filteredParts = allParts.filter(part => {
        // Zone Filter
        if (filterZone !== 'all') {
          const pos = machinePositions[part.machineName || ''];
          if (!pos || pos.zone !== filterZone) return false;
        }
        // Division Filter
        if (filterDivision !== 'all') {
          const pos = machinePositions[part.machineName || ''];
          if (!pos || pos.division !== filterDivision) return false;
        }

        if (isEmployee) {
          const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
          if (myCompany) {
            const companyEmployees = empList.filter((e: any) => e.companyName === myCompany);
            const companyMachines = new Set(companyEmployees.map((e: any) => e.machineName).filter(Boolean));
            if (part.machineName && companyMachines.size > 0 && !companyMachines.has(part.machineName)) {
              return false;
            }
          }

          if (currentUserAccessType === 'admin-light') {
            if (userMachine) return part.machineName === userMachine;
            return selectedMachine === 'all' || part.machineName === selectedMachine;
          } else if (currentUserAccessType === 'zonal-admin') {
            const z = currentUserZone || filterZone;
            if (z && z !== 'all') {
              const pZone = getMachineZone(part.machineName);
              if (pZone && pZone !== z) return false;
            }
            if (filterDivision !== 'all') {
              const pDiv = getMachineDivision(part.machineName);
              if (pDiv && pDiv !== filterDivision) return false;
            }
            return selectedMachine === 'all' || part.machineName === selectedMachine;
          } else if (currentUserAccessType === 'divisional-admin') {
            const d = currentUserDivision || filterDivision;
            if (d && d !== 'all') {
              const pDiv = getMachineDivision(part.machineName);
              if (pDiv && pDiv !== d) return false;
            }
            return selectedMachine === 'all' || part.machineName === selectedMachine;
          } else if (currentUserAccessType === 'full') {
            const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            if (myMachine) return part.machineName === myMachine;
            return selectedMachine === 'all' || part.machineName === selectedMachine;
          } else {
            const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            if (myMachine) return part.machineName === myMachine;
            return true;
          }
        } else {
          return selectedMachine === 'all' || part.machineName === selectedMachine;
        }
      });

      // Compute total stock value
      const totalStockValue = filteredParts.reduce((acc, part) => {
        const val = part.totalValue;
        const numericVal = typeof val === 'number' && !Number.isNaN(val) ? val : 0;
        return acc + numericVal;
      }, 0);

      // Compute top 5 inventory items by value
      const parsedParts = filteredParts.map(part => {
        const value = typeof part.totalValue === 'number' && !Number.isNaN(part.totalValue) ? part.totalValue : 0;
        return {
          name: part.description || part.partNo || part.plNo || 'Unnamed Item',
          value: value
        };
      });
      const top5Parts = parsedParts
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      setTopParts(top5Parts);

      // Compute Stock Distribution based on Whether Use category
      const csCount = filteredParts.filter(part => part.whetherUse === 'CS').length;
      const msCount = filteredParts.filter(part => part.whetherUse === 'MS').length;
      const tpCount = filteredParts.filter(part => part.whetherUse === 'T&P').length;
      const otherCount = filteredParts.filter(part => {
        const u = part.whetherUse;
        return !u || !['CS', 'MS', 'T&P', 'Other'].includes(u);
      }).length;

      setStockDistribution([
        { name: 'CS', value: csCount, color: '#000666' },
        { name: 'MS', value: msCount, color: '#4F46E5' },
        { name: 'T&P', value: tpCount, color: '#10B981' },
        { name: 'Other', value: otherCount, color: '#F59E0B' },
      ]);

      let demandsSnap;
      try {
        demandsSnap = await getDocs(collection(db, 'demands'));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'demands');
        return;
      }
      const allDemands = demandsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      let transactionsSnap;
      try {
        transactionsSnap = await getDocs(collection(db, 'transactions'));
      } catch (error) {
        console.warn('Transactions fetch warning:', error);
      }
      const allTransactions = transactionsSnap ? transactionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })) : [];

      let storeIssuesSnap;
      try {
        storeIssuesSnap = await getDocs(collection(db, 'store_issues'));
      } catch (error) {
        console.warn('Store issues fetch warning:', error);
      }
      const allStoreIssues = storeIssuesSnap ? storeIssuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any })) : [];

      setFetchedEmployees(empList);
      setFetchedDemands(allDemands);
      setFetchedTransactions(allTransactions);
      setFetchedStoreIssues(allStoreIssues);

      const filteredDemands = allDemands.filter(d => {
        const creator = empList.find(e => 
          (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
          (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
          (e.id && d.createdByUid && e.id === d.createdByUid)
        );
        const demandCompany = creator ? creator.companyName || '' : d.companyName || '';
        const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';

        // Zone Filter
        if (filterZone !== 'all') {
          const pos = machinePositions[d.machineName || ''];
          if (!pos || pos.zone !== filterZone) return false;
        }
        // Division Filter
        if (filterDivision !== 'all') {
          const pos = machinePositions[d.machineName || ''];
          if (!pos || pos.division !== filterDivision) return false;
        }

        if (isEmployee) {
          if (currentUserAccessType === 'admin-light') {
            if (demandCompany && myCompany && demandCompany !== myCompany) return false;
            if (userMachine && d.machineName !== userMachine) return false;
            if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
          } else if (currentUserAccessType === 'zonal-admin') {
            const z = currentUserZone || filterZone;
            if (z && z !== 'all') {
              const dZone = getMachineZone(d.machineName);
              if (dZone && dZone !== z) return false;
            }
            if (filterDivision !== 'all') {
              const dDiv = getMachineDivision(d.machineName);
              if (dDiv && dDiv !== filterDivision) return false;
            }
            if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
          } else if (currentUserAccessType === 'divisional-admin') {
            const div = currentUserDivision || filterDivision;
            if (div && div !== 'all') {
              const dDiv = getMachineDivision(d.machineName);
              if (dDiv && dDiv !== div) return false;
            }
            if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
          } else if (currentUserAccessType === 'full') {
            const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            if (myMachine) {
              if (d.machineName !== myMachine) return false;
            } else if (selectedMachine !== 'all' && d.machineName !== selectedMachine) {
              return false;
            }
          } else {
            // limited machine employee
            if (userMachine && d.machineName !== userMachine) return false;
          }
        } else {
          // Master Admin / Non-employee
          if (selectedCompany !== 'all' && demandCompany !== selectedCompany) return false;
          if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
        }

        return true;
      });

      const pendingDemandsCount = filteredDemands.filter(d => 
        d.status !== 'completed' && d.status !== 'rejected' && d.status !== 'cancelled'
      ).length;
      const completedDemandsCount = filteredDemands.filter(d => d.status === 'completed').length;

      setStats({
        totalEmployees: activeEmployees,
        stockValue: totalStockValue,
        pendingDemands: pendingDemandsCount,
        reviewDemands: pendingDemandsCount,
        urgentDemands: pendingDemandsCount > 5 ? 5 : pendingDemandsCount,
        completedDemands: completedDemandsCount,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Month-wise Timeline Calculation for Issues, Demands & Pending Demands (3 Months to 1 Year)
  const monthlyTimelineData = useMemo(() => {
    const now = new Date();
    let monthsCount = 6;
    if (chartTimeRange === '3months') monthsCount = 3;
    else if (chartTimeRange === '6months') monthsCount = 6;
    else if (chartTimeRange === '9months') monthsCount = 9;
    else if (chartTimeRange === '12months') monthsCount = 12;

    const monthKeys: string[] = [];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      monthKeys.push(`${y}-${m}`);
    }

    const parseDateToKey = (val: any): string | null => {
      if (!val) return null;
      let d: Date;
      if (typeof val === 'object' && val && typeof val.toDate === 'function') {
        d = val.toDate();
      } else if (typeof val === 'string' || typeof val === 'number') {
        d = new Date(val);
      } else {
        return null;
      }
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    };

    const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';

    // Filter demands for timeline matching dashboard scope
    const scopedDemands = fetchedDemands.filter(d => {
      const creator = fetchedEmployees.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : d.companyName || '';

      if (filterZone !== 'all') {
        const pos = machinePositions[d.machineName || ''];
        if (!pos || pos.zone !== filterZone) return false;
      }
      if (filterDivision !== 'all') {
        const pos = machinePositions[d.machineName || ''];
        if (!pos || pos.division !== filterDivision) return false;
      }

      if (isEmployee) {
        if (currentUserAccessType === 'admin-light') {
          if (demandCompany && myCompany && demandCompany !== myCompany) return false;
          if (userMachine && d.machineName !== userMachine) return false;
          if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'zonal-admin') {
          const z = currentUserZone || filterZone;
          if (z && z !== 'all') {
            const dZone = getMachineZone(d.machineName);
            if (dZone && dZone !== z) return false;
          }
          if (filterDivision !== 'all') {
            const dDiv = getMachineDivision(d.machineName);
            if (dDiv && dDiv !== filterDivision) return false;
          }
          if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'divisional-admin') {
          const div = currentUserDivision || filterDivision;
          if (div && div !== 'all') {
            const dDiv = getMachineDivision(d.machineName);
            if (dDiv && dDiv !== div) return false;
          }
          if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'full') {
          const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
          if (myMachine) {
            if (d.machineName !== myMachine) return false;
          } else if (selectedMachine !== 'all' && d.machineName !== selectedMachine) {
            return false;
          }
        } else {
          if (userMachine && d.machineName !== userMachine) return false;
        }
      } else {
        if (selectedCompany !== 'all' && demandCompany !== selectedCompany) return false;
        if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
      }
      return true;
    });

    // Filter transactions (issued) for timeline
    const scopedTransactions = fetchedTransactions.filter(t => {
      const isIssued = t.type === 'issued' || t.type === 'issue' || t.type === 'ISSUE';
      if (!isIssued) return false;

      if (filterZone !== 'all') {
        const pos = machinePositions[t.machineName || ''];
        if (!pos || pos.zone !== filterZone) return false;
      }
      if (filterDivision !== 'all') {
        const pos = machinePositions[t.machineName || ''];
        if (!pos || pos.division !== filterDivision) return false;
      }

      if (isEmployee) {
        if (currentUserAccessType === 'admin-light') {
          if (userMachine && t.machineName !== userMachine) return false;
          if (selectedMachine !== 'all' && t.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'zonal-admin') {
          const z = currentUserZone || filterZone;
          if (z && z !== 'all') {
            const tZone = getMachineZone(t.machineName);
            if (tZone && tZone !== z) return false;
          }
          if (filterDivision !== 'all') {
            const tDiv = getMachineDivision(t.machineName);
            if (tDiv && tDiv !== filterDivision) return false;
          }
          if (selectedMachine !== 'all' && t.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'divisional-admin') {
          const div = currentUserDivision || filterDivision;
          if (div && div !== 'all') {
            const tDiv = getMachineDivision(t.machineName);
            if (tDiv && tDiv !== div) return false;
          }
          if (selectedMachine !== 'all' && t.machineName !== selectedMachine) return false;
        } else if (currentUserAccessType === 'full') {
          const myMachine = userMachine || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
          if (myMachine) {
            if (t.machineName !== myMachine) return false;
          } else if (selectedMachine !== 'all' && t.machineName !== selectedMachine) {
            return false;
          }
        } else {
          if (userMachine && t.machineName !== userMachine) return false;
        }
      } else {
        if (selectedMachine !== 'all' && t.machineName !== selectedMachine) return false;
      }
      return true;
    });

    // Filter store issues for timeline
    const scopedStoreIssues = fetchedStoreIssues.filter(s => {
      if (isEmployee && currentUserAccessType === 'admin-light' && myCompany) {
        if (s.issuingCompany && s.issuingCompany.toLowerCase() !== myCompany.toLowerCase()) return false;
      } else if (selectedCompany !== 'all' && s.issuingCompany) {
        if (s.issuingCompany.toLowerCase() !== selectedCompany.toLowerCase()) return false;
      }
      if (selectedMachine !== 'all' && s.targetMachine) {
        if (s.targetMachine !== selectedMachine) return false;
      }
      return true;
    });

    const bucketMap: Record<string, { 
      issueQty: number; 
      issueCount: number; 
      demandQty: number; 
      demandCount: number;
      pendingQty: number;
      pendingCount: number;
    }> = {};

    monthKeys.forEach(k => {
      bucketMap[k] = { 
        issueQty: 0, 
        issueCount: 0, 
        demandQty: 0, 
        demandCount: 0,
        pendingQty: 0,
        pendingCount: 0,
      };
    });

    scopedTransactions.forEach(t => {
      const k = parseDateToKey(t.date || t.createdAt);
      if (k && bucketMap[k]) {
        const q = Number(t.qty || t.quantity || 1);
        bucketMap[k].issueQty += isNaN(q) ? 1 : q;
        bucketMap[k].issueCount += 1;
      }
    });

    scopedStoreIssues.forEach(s => {
      const k = parseDateToKey(s.date || s.issueDate || s.createdAt);
      if (k && bucketMap[k]) {
        const q = Number(s.quantity || s.issuedQty || 1);
        bucketMap[k].issueQty += isNaN(q) ? 1 : q;
        bucketMap[k].issueCount += 1;
      }
    });

    scopedDemands.forEach(d => {
      const k = parseDateToKey(d.demandDate || d.date || d.createdAt);
      if (k && bucketMap[k]) {
        const q = Number(d.giveQty || d.qty || d.quantity || 1);
        const safeQ = isNaN(q) ? 1 : q;
        bucketMap[k].demandQty += safeQ;
        bucketMap[k].demandCount += 1;

        const isPending = d.status !== 'completed' && d.status !== 'rejected' && d.status !== 'cancelled';
        if (isPending) {
          bucketMap[k].pendingQty += safeQ;
          bucketMap[k].pendingCount += 1;
        }
      }
    });

    return monthKeys.map(k => {
      const [y, m] = k.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const yearShort = d.toLocaleDateString('en-US', { year: '2-digit' });
      const fullMonth = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const b = bucketMap[k];
      return {
        key: k,
        month: `${monthName} '${yearShort}`,
        fullMonth,
        issueQty: b.issueQty,
        issueCount: b.issueCount,
        demandQty: b.demandQty,
        demandCount: b.demandCount,
        pendingQty: b.pendingQty,
        pendingCount: b.pendingCount,
      };
    });
  }, [
    chartTimeRange, 
    fetchedDemands, 
    fetchedTransactions, 
    fetchedStoreIssues, 
    fetchedEmployees, 
    filterZone, 
    filterDivision, 
    selectedMachine, 
    selectedCompany, 
    userMachine, 
    currentUserCompanyName, 
    currentUserAccessType, 
    currentUserZone,
    currentUserDivision,
    isEmployee, 
    machinePositions
  ]);

  const timelineTotals = useMemo(() => {
    let totalIssueQty = 0;
    let totalIssueCount = 0;
    let totalDemandQty = 0;
    let totalDemandCount = 0;
    let totalPendingQty = 0;
    let totalPendingCount = 0;

    monthlyTimelineData.forEach(d => {
      totalIssueQty += d.issueQty;
      totalIssueCount += d.issueCount;
      totalDemandQty += d.demandQty;
      totalDemandCount += d.demandCount;
      totalPendingQty += d.pendingQty;
      totalPendingCount += d.pendingCount;
    });

    return {
      totalIssueQty,
      totalIssueCount,
      totalDemandQty,
      totalDemandCount,
      totalPendingQty,
      totalPendingCount,
    };
  }, [monthlyTimelineData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] py-12">
        <TrackMachineLoader 
          message="Loading Track Machine Operations Dashboard..." 
          subMessage="Aggregating performance metrics & division analytics"
          size="md" 
        />
      </div>
    );
  }

  const handleSelectMachine = (mach: string) => {
    if (!filterPerms.canChangeMachine) return;
    setSelectedMachine(mach);
    if (mach !== 'all') {
      const pos = machinePositions[mach];
      const mZone = pos?.zone || getMachineZone(mach);
      const mDiv = pos?.division || getMachineDivision(mach);
      if (mZone && filterPerms.canChangeZone) {
        setFilterZone(mZone);
      }
      if (mDiv && filterPerms.canChangeDivision) {
        setFilterDivision(mDiv);
      }
      const co = machineToCompany[mach];
      if (co && !isEmployee) {
        setSelectedCompany(co);
      }
    }
  };

  const handleSelectCompany = (comp: string) => {
    setSelectedCompany(comp);
    if (comp !== 'all' && selectedMachine !== 'all') {
      const machCo = machineToCompany[selectedMachine];
      if (machCo && machCo !== comp && filterPerms.canChangeMachine) {
        setSelectedMachine('all');
      }
    }
  };

  const handleSelectZone = (z: string) => {
    if (!filterPerms.canChangeZone) return;
    setFilterZone(z);
    if (filterPerms.canChangeDivision) {
      setFilterDivision('all');
    }
    if (z !== 'all' && selectedMachine !== 'all' && filterPerms.canChangeMachine) {
      const mZone = getMachineZone(selectedMachine);
      if (mZone && mZone !== z) {
        setSelectedMachine('all');
      }
    }
  };

  const handleSelectDivision = (d: string) => {
    if (!filterPerms.canChangeDivision) return;
    setFilterDivision(d);
    if (d !== 'all' && selectedMachine !== 'all' && filterPerms.canChangeMachine) {
      const mDiv = getMachineDivision(selectedMachine);
      if (mDiv && mDiv !== d) {
        setSelectedMachine('all');
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-10"
    >
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-primary font-bold tracking-widest uppercase text-xs mb-1">Industrial Intelligence</p>
          <h1 className="text-4xl font-black text-on-surface tracking-tight leading-none">Operational Dashboard</h1>
        </motion.div>
        <div className="flex flex-wrap items-center gap-3">
          {!isEmployee ? (
            <select
              id="dashboard-filter-company"
              className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all"
              value={selectedCompany}
              onChange={e => handleSelectCompany(e.target.value)}
            >
              <option value="all">All Companies</option>
              {companiesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            currentUserCompanyName && (
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-1.5 rounded-full font-bold">
                Company: {currentUserCompanyName}
              </span>
            )
          )}

          {isAnyAdmin ? (
            <select
              id="dashboard-filter-machine"
              className={cn(
                "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all",
                !filterPerms.canChangeMachine && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
              )}
              value={selectedMachine}
              disabled={!filterPerms.canChangeMachine}
              title={!filterPerms.canChangeMachine ? `Machine locked to assigned machine (${userMachine || selectedMachine})` : "Filter by Machine"}
              onChange={e => {
                if (!filterPerms.canChangeMachine) return;
                handleSelectMachine(e.target.value);
              }}
            >
              {filterPerms.canChangeMachine && (
                <option value="all">
                  {currentUserAccessType === 'zonal-admin'
                    ? `All Zone Machines (${currentUserZone || filterZone})`
                    : currentUserAccessType === 'divisional-admin'
                    ? `All Division Machines (${currentUserDivision || filterDivision})`
                    : 'All Machines'}
                </option>
              )}
              {availableMachines.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            userMachine && (
              <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded-full font-bold">
                Machine: {userMachine}
              </span>
            )
          )}

          {isAnyAdmin && (
            <>
              <select
                id="dashboard-filter-zone"
                className={cn(
                  "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all",
                  !filterPerms.canChangeZone && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                )}
                value={filterZone}
                disabled={!filterPerms.canChangeZone}
                title={!filterPerms.canChangeZone ? `Zone locked: ${currentUserZone || filterZone}` : "Filter by Zone"}
                onChange={(e) => {
                  if (!filterPerms.canChangeZone) return;
                  handleSelectZone(e.target.value);
                }}
              >
                {filterPerms.canChangeZone && <option value="all">All Zones</option>}
                {!filterPerms.canChangeZone && (currentUserZone || filterZone) && (currentUserZone || filterZone) !== 'all' ? (
                  <option value={currentUserZone || filterZone}>{currentUserZone || filterZone}</option>
                ) : (
                  Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))
                )}
              </select>

              <select
                id="dashboard-filter-division"
                className={cn(
                  "border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all disabled:opacity-50",
                  (!filterPerms.canChangeDivision || filterZone === 'all') && "bg-slate-100 cursor-not-allowed text-slate-500 opacity-90"
                )}
                value={filterDivision}
                disabled={!filterPerms.canChangeDivision || filterZone === 'all'}
                title={!filterPerms.canChangeDivision ? `Division locked: ${currentUserDivision || filterDivision}` : "Filter by Division"}
                onChange={(e) => {
                  if (!filterPerms.canChangeDivision) return;
                  handleSelectDivision(e.target.value);
                }}
              >
                {filterPerms.canChangeDivision && <option value="all">All Divisions</option>}
                {!filterPerms.canChangeDivision && (currentUserDivision || filterDivision) && (currentUserDivision || filterDivision) !== 'all' ? (
                  <option value={currentUserDivision || filterDivision}>{currentUserDivision || filterDivision}</option>
                ) : (
                  (filterZone !== 'all' ? RAILWAY_ZONES_DIVISIONS[filterZone] : (currentUserZone ? RAILWAY_ZONES_DIVISIONS[currentUserZone] : []))?.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))
                )}
              </select>
            </>
          )}
          <div className="bg-surface-container-high px-4 py-2 rounded flex items-center gap-2">
            <Calendar size={16} />
            <span className="text-sm font-medium">
              {new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          whileHover={{ scale: 1.02 }}
          className="bg-surface-container-lowest p-6 rounded shadow-sm border-l-4 border-primary relative overflow-hidden group"
        >
          <div className="relative z-10">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Total Employees</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-on-surface">{stats.totalEmployees.toLocaleString()}</span>
            </div>
            <div className="mt-4 h-1 w-full bg-secondary-container overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "75%" }}
                transition={{ duration: 1, delay: 0.5 }}
                className="h-full bg-primary"
              ></motion.div>
            </div>
          </div>
          <Users className="absolute -bottom-4 -right-4 text-8xl text-surface-container-high opacity-40 group-hover:scale-110 transition-transform duration-500" size={96} />
        </motion.div>

        <motion.div 
          whileHover={{ scale: 1.02 }}
          className="bg-surface-container-lowest p-6 rounded shadow-sm border-l-4 border-primary relative overflow-hidden group"
        >
          <div className="relative z-10">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Stock Value</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-on-surface">
                ₹{Number.isNaN(stats.stockValue) ? '0.0' : (stats.stockValue / 1000).toFixed(1)}K
              </span>
            </div>
            <div className="mt-4 h-1 w-full bg-secondary-container overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "42%" }}
                transition={{ duration: 1, delay: 0.7 }}
                className="h-full bg-primary"
              ></motion.div>
            </div>
          </div>
          <Package className="absolute -bottom-4 -right-4 text-8xl text-surface-container-high opacity-40 group-hover:scale-110 transition-transform duration-500" size={96} />
        </motion.div>

        <motion.div 
          whileHover={{ scale: 1.02 }}
          className="bg-surface-container-lowest p-6 rounded shadow-sm border-l-4 border-primary relative overflow-hidden group"
        >
          <div className="relative z-10">
            <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Pending Demands</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-on-surface">{stats.pendingDemands}</span>
              <span className="px-2 py-0.5 bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-black rounded ml-2 uppercase">Urgent</span>
            </div>
            <div className="mt-4 h-1 w-full bg-secondary-container overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "15%" }}
                transition={{ duration: 1, delay: 0.9 }}
                className="h-full bg-primary"
              ></motion.div>
            </div>
          </div>
          <ClipboardList className="absolute -bottom-4 -right-4 text-8xl text-surface-container-high opacity-40 group-hover:scale-110 transition-transform duration-500" size={96} />
        </motion.div>
      </section>

      {/* Monthly / Time-Range Issue, Demand & Pending Demands Activity Line Chart */}
      <motion.section 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded-full text-indigo-700 text-[10px] font-black tracking-wider uppercase">
              <Activity size={12} className="animate-pulse" />
              Activity & Consumption Trends
            </div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              Monthly Issue, Demand & Pending Trends
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Real-time timeline analysis of items issued, demands received, and pending requisitions across railway machines and store depots.
            </p>
          </div>

          {/* Controls Bar: Time Range Dropdown, Machine Filter, Metric Filter, and Unit Selector */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Months Selection Dropdown in styled container */}
            <div className="bg-slate-100 p-1.5 rounded-xl flex items-center gap-2 border border-slate-200 shadow-inner">
              <div className="flex items-center gap-1 pl-1 text-slate-700 font-bold text-xs">
                <Calendar size={14} className="text-indigo-600" />
                <span className="hidden sm:inline">Months:</span>
              </div>
              <select
                value={chartTimeRange}
                onChange={(e) => setChartTimeRange(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white font-bold text-slate-800 shadow-sm transition-all cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="3months">Last 3 Months</option>
                <option value="6months">Last 6 Months (Default)</option>
                <option value="9months">Last 9 Months</option>
                <option value="12months">Last 12 Months (1 Year)</option>
              </select>
            </div>

            {/* Machine Filter Dropdown for all admin roles */}
            {isAnyAdmin && (
              <div className="bg-slate-100 p-1.5 rounded-xl flex items-center gap-2 border border-slate-200 shadow-inner">
                <span className="text-xs font-bold text-slate-700 pl-1">Machine:</span>
                <select
                  value={selectedMachine}
                  onChange={(e) => handleSelectMachine(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white font-bold text-slate-800 shadow-sm transition-all cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="all">All Machines</option>
                  {availableMachines.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Metric Selector: All / Issue / Demand / Pending */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200 shadow-inner flex-wrap">
              <button
                type="button"
                onClick={() => setChartMetric('all')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  chartMetric === 'all'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Data
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('issue')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  chartMetric === 'issue'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Issued Only
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('demand')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  chartMetric === 'demand'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Demands Only
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('pending')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  chartMetric === 'pending'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pending Demands
              </button>
            </div>

            {/* Unit toggle: Quantity vs Record Count */}
            <select
              value={chartUnit}
              onChange={(e) => setChartUnit(e.target.value as 'quantity' | 'count')}
              className="border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="quantity">Metric: Total Quantity (Units)</option>
              <option value="count">Metric: Record Count (Vouchers)</option>
            </select>
          </div>
        </div>

        {/* Summary Badges: 4 Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-amber-800 text-[11px] font-bold uppercase tracking-wider block">Total Items Issued</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-amber-900">
                  {timelineTotals.totalIssueQty.toLocaleString()} <span className="text-xs font-bold text-amber-700">Units</span>
                </span>
              </div>
              <span className="text-[11px] text-amber-700 font-semibold mt-0.5 block">
                Across {timelineTotals.totalIssueCount} issue transactions
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <ArrowUpRight size={20} />
            </div>
          </div>

          <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-indigo-800 text-[11px] font-bold uppercase tracking-wider block">Total Demands Received</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-indigo-900">
                  {timelineTotals.totalDemandQty.toLocaleString()} <span className="text-xs font-bold text-indigo-700">Units</span>
                </span>
              </div>
              <span className="text-[11px] text-indigo-700 font-semibold mt-0.5 block">
                Across {timelineTotals.totalDemandCount} demand requisitions
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <ClipboardList size={20} />
            </div>
          </div>

          <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-rose-800 text-[11px] font-bold uppercase tracking-wider block">Pending Demands</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-900">
                  {timelineTotals.totalPendingQty.toLocaleString()} <span className="text-xs font-bold text-rose-700">Units</span>
                </span>
                <span className="px-1.5 py-0.5 bg-rose-200 text-rose-800 text-[9px] font-black rounded uppercase">
                  Active
                </span>
              </div>
              <span className="text-[11px] text-rose-700 font-semibold mt-0.5 block">
                Across {timelineTotals.totalPendingCount} pending requests
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-sm">
              <Clock size={20} />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-slate-600 text-[11px] font-bold uppercase tracking-wider block">Timeline Interval</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-base font-black text-slate-900 truncate max-w-[140px]">
                  {chartTimeRange === '3months' 
                    ? 'Last 3 Months' 
                    : chartTimeRange === '6months' 
                    ? 'Last 6 Months' 
                    : chartTimeRange === '9months' 
                    ? 'Last 9 Months' 
                    : 'Last 12 Months (1 Year)'}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-semibold mt-0.5 block">
                {monthlyTimelineData[0]?.month} — {monthlyTimelineData[monthlyTimelineData.length - 1]?.month}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-800 text-white flex items-center justify-center shadow-sm">
              <Calendar size={18} />
            </div>
          </div>
        </div>

        {/* The Recharts Line Chart */}
        <div className="h-[340px] w-full min-w-0 min-h-[340px] relative pt-2">
          {monthlyTimelineData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
              No historical data available for selected period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={340}>
              <LineChart data={monthlyTimelineData} margin={{ top: 10, right: 25, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  tick={{ fontSize: 11, fontWeight: 'bold', fill: '#475569' }} 
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 11, fontWeight: 'bold', fill: '#475569' }} 
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                  width={45}
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const itemData = payload[0]?.payload;
                      return (
                        <div className="bg-slate-950 text-white p-3.5 rounded-xl shadow-xl border border-slate-800 text-xs space-y-2 min-w-[220px]">
                          <div className="font-black text-slate-200 border-b border-slate-800 pb-1.5 flex items-center justify-between">
                            <span>{itemData?.fullMonth || label}</span>
                            <span className="text-[10px] text-slate-400 font-normal">Monthly Trends</span>
                          </div>
                          {(chartMetric === 'all' || chartMetric === 'issue') && (
                            <div className="flex items-center justify-between gap-4 text-amber-400 font-bold">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                Issued Items:
                              </span>
                              <span>
                                {itemData?.issueQty?.toLocaleString()} Qty ({itemData?.issueCount} Vouchers)
                              </span>
                            </div>
                          )}
                          {(chartMetric === 'all' || chartMetric === 'demand') && (
                            <div className="flex items-center justify-between gap-4 text-indigo-300 font-bold">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                                Demands Received:
                              </span>
                              <span>
                                {itemData?.demandQty?.toLocaleString()} Qty ({itemData?.demandCount} Demands)
                              </span>
                            </div>
                          )}
                          {(chartMetric === 'all' || chartMetric === 'pending') && (
                            <div className="flex items-center justify-between gap-4 text-rose-400 font-bold">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                Pending Demands:
                              </span>
                              <span>
                                {itemData?.pendingQty?.toLocaleString()} Qty ({itemData?.pendingCount} Demands)
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right" 
                  wrapperStyle={{ paddingBottom: '12px', fontSize: '12px', fontWeight: 'bold' }} 
                />
                {(chartMetric === 'all' || chartMetric === 'issue') && (
                  <Line 
                    type="monotone" 
                    dataKey={chartUnit === 'quantity' ? 'issueQty' : 'issueCount'} 
                    name={chartUnit === 'quantity' ? 'Issued Items (Qty)' : 'Issued Vouchers (Count)'} 
                    stroke="#F59E0B" 
                    strokeWidth={3.5}
                    dot={{ r: 4.5, fill: '#F59E0B', strokeWidth: 2, stroke: '#FFFFFF' }}
                    activeDot={{ r: 7, stroke: '#F59E0B', strokeWidth: 3, fill: '#FFFFFF' }}
                  />
                )}
                {(chartMetric === 'all' || chartMetric === 'demand') && (
                  <Line 
                    type="monotone" 
                    dataKey={chartUnit === 'quantity' ? 'demandQty' : 'demandCount'} 
                    name={chartUnit === 'quantity' ? 'Demands Received (Qty)' : 'Demands Received (Count)'} 
                    stroke="#4F46E5" 
                    strokeWidth={3.5}
                    dot={{ r: 4.5, fill: '#4F46E5', strokeWidth: 2, stroke: '#FFFFFF' }}
                    activeDot={{ r: 7, stroke: '#4F46E5', strokeWidth: 3, fill: '#FFFFFF' }}
                  />
                )}
                {(chartMetric === 'all' || chartMetric === 'pending') && (
                  <Line 
                    type="monotone" 
                    dataKey={chartUnit === 'quantity' ? 'pendingQty' : 'pendingCount'} 
                    name={chartUnit === 'quantity' ? 'Pending Demands (Qty)' : 'Pending Demands (Count)'} 
                    stroke="#EF4444" 
                    strokeWidth={3.5}
                    strokeDasharray={chartMetric === 'all' ? "4 4" : undefined}
                    dot={{ r: 4.5, fill: '#EF4444', strokeWidth: 2, stroke: '#FFFFFF' }}
                    activeDot={{ r: 7, stroke: '#EF4444', strokeWidth: 3, fill: '#FFFFFF' }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </motion.section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-7 bg-surface-container-low p-8 rounded shadow-sm"
        >
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
              <span className="w-2 h-2 bg-primary"></span> Top 5 Inventory Items by Value
            </h3>
            <MoreHorizontal className="text-outline cursor-pointer" size={20} />
          </div>
          <div className="h-[300px] w-full min-w-0 min-h-[300px] relative">
            {topParts.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
                No inventory items found.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                <BarChart data={topParts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                  <Tooltip formatter={(value: any) => [`₹${parseFloat(value).toLocaleString()}`, 'Total Value']} />
                  <Bar dataKey="value" fill="#000666" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <motion.div 
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            className="bg-surface-container-low p-8 rounded shadow-sm flex-1"
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2 mb-6">
              <span className="w-2 h-2 bg-primary"></span> Stock Distribution
            </h3>
            <div className="flex items-center gap-6 h-[200px] min-w-0 min-h-[200px]">
              <div className="w-1/2 h-full min-w-0 min-h-[200px] relative">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                  <PieChart>
                    <Pie
                      data={stockDistribution}
                      innerRadius={40}
                      outerRadius={60}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {stockDistribution.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-1/2 space-y-2 text-xs font-bold">
                {stockDistribution.map((item: any) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                    <span className="uppercase text-slate-700">{item.name}:</span>
                    <span className="text-primary font-black">{item.value} items</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 }}
            className="bg-surface-container-lowest p-8 rounded shadow-sm border border-outline-variant/10"
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-primary mb-6">Request Pipeline</h3>
            <div className="flex justify-between items-center px-4">
              <div className="text-center">
                <div className="text-2xl font-black text-on-surface">{stats.pendingDemands}</div>
                <div className="text-[10px] uppercase font-bold text-on-surface-variant">Pending</div>
              </div>
              <div className="w-px h-10 bg-outline-variant/30"></div>
              <div className="text-center">
                <div className="text-2xl font-black text-on-tertiary-container">{stats.urgentDemands}</div>
                <div className="text-[10px] uppercase font-bold text-on-surface-variant">Urgent</div>
              </div>
              <div className="w-px h-10 bg-outline-variant/30"></div>
              <div className="text-center">
                <div className="text-2xl font-black text-green-600">{stats.completedDemands}</div>
                <div className="text-[10px] uppercase font-bold text-on-surface-variant">Completed</div>
              </div>
            </div>
            <button 
              onClick={() => navigate('/demand')}
              className="w-full mt-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-[1.02] active:scale-95"
            >
              View Full Pipeline
            </button>
          </motion.div>
        </div>
      </section>
    </motion.div>
  );
}
