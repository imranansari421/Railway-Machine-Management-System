import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Users, Package, ClipboardList, Calendar, MoreHorizontal, AlertTriangle, Bell } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { findEmployeeForUser } from '../utils/employee';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';

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

  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [machinePositions, setMachinePositions] = useState<Record<string, { zone: string; division: string }>>({});

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
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) || '' : '';
  });
  const [currentUserAccessType, setCurrentUserAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || '' : '';
  });
  
  const [machinesList, setMachinesList] = useState<string[]>(["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"]);
  const [companyMachinesList, setCompanyMachinesList] = useState<string[]>([]);

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
      if (auth.currentUser && isEmployee) {
        try {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          if (emp) {
            const mName = emp.machineName || '';
            setUserMachine(mName);
            localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);

            const coName = emp.companyName || '';
            setCurrentUserCompanyName(coName);
            localStorage.setItem(`companyName_${auth.currentUser.uid}`, coName);

            const aType = emp.accessType || '';
            setCurrentUserAccessType(aType);
            localStorage.setItem(`accessType_${auth.currentUser.uid}`, aType);
          }
        } catch (error) {
          console.error('Error loading employee info on dashboard:', error);
        }
      }
    };
    checkAccessAndFetch();
  }, [isEmployee]);

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
      
      // Compute list of companies dynamically
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      const myCompany = currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '';
      if (myCompany) {
        const companyMachines = Array.from(new Set(empList.filter(e => e.companyName === myCompany).map(e => e.machineName).filter(Boolean))) as string[];
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
      const allDemands = demandsSnap.docs.map(doc => doc.data());
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
          if (currentUserAccessType === 'full' || currentUserAccessType === 'admin-light') {
            if (demandCompany !== myCompany) return false;
          } else {
            // limited or other
            if (userMachine) {
              if (d.machineName !== userMachine) return false;
            }
          }
        } else {
          // Admin / Non-employee
          if (selectedCompany !== 'all' && demandCompany !== selectedCompany) return false;
          if (selectedMachine !== 'all' && d.machineName !== selectedMachine) return false;
        }

        return true;
      });

      const pendingDemandsCount = filteredDemands.filter(d => d.status !== 'completed').length;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

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
              className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all"
              value={selectedCompany}
              onChange={e => setSelectedCompany(e.target.value)}
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

          {(!isEmployee || currentUserAccessType === 'admin-light') ? (
            <select
              className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all"
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value)}
            >
              <option value="all">All Machines</option>
              {(isEmployee && currentUserAccessType === 'admin-light' && companyMachinesList.length > 0
                ? companyMachinesList
                : machinesList
              ).map(m => (
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

          {(!isEmployee || currentUserAccessType === 'admin-light') && (
            <>
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all"
                value={filterZone}
                onChange={(e) => {
                  setFilterZone(e.target.value);
                  setFilterDivision('all');
                }}
              >
                <option value="all">All Zones</option>
                {Object.keys(RAILWAY_ZONES_DIVISIONS).map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>

              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm transition-all disabled:opacity-50"
                value={filterDivision}
                disabled={filterZone === 'all'}
                onChange={(e) => setFilterDivision(e.target.value)}
              >
                <option value="all">All Divisions</option>
                {filterZone !== 'all' && RAILWAY_ZONES_DIVISIONS[filterZone]?.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
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
