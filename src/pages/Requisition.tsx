import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Search, CheckCircle, X, Loader2, Sparkles, Database, FileText, Check, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';

function findMatchingZone(zoneStr: string): string {
  if (!zoneStr) return 'Southeast Central Railway (SECR)';
  const clean = zoneStr.toLowerCase().replace(/[\s\-_]/g, '');
  if (clean === 'all') return 'ALL';
  
  for (const key of Object.keys(RAILWAY_ZONES_DIVISIONS)) {
    const keyClean = key.split(' (')[0].toLowerCase().replace(/[\s\-_]/g, '');
    if (clean === keyClean || clean === key.toLowerCase().replace(/[\s\-_]/g, '')) {
      return key;
    }
  }

  for (const key of Object.keys(RAILWAY_ZONES_DIVISIONS)) {
    const keyClean = key.split(' (')[0].toLowerCase().replace(/[\s\-_]/g, '');
    if (clean.includes(keyClean) || keyClean.includes(clean)) {
      return key;
    }
  }
  
  if (clean.includes('secr') || clean.includes('southeastcentral') || clean.includes('southeastcentralrly')) {
    return 'Southeast Central Railway (SECR)';
  }
  
  return 'Southeast Central Railway (SECR)'; // default fallback
}

function getDivisionsForZone(zoneName: string): string[] {
  if (!zoneName || zoneName.toLowerCase() === 'all') {
    const allDivs = new Set<string>();
    Object.values(RAILWAY_ZONES_DIVISIONS).forEach(divs => {
      divs.forEach(d => allDivs.add(d));
    });
    return Array.from(allDivs).sort();
  }

  if (RAILWAY_ZONES_DIVISIONS[zoneName]) {
    return RAILWAY_ZONES_DIVISIONS[zoneName];
  }

  const targetClean = zoneName.toUpperCase().trim();
  for (const [key, divisions] of Object.entries(RAILWAY_ZONES_DIVISIONS)) {
    const keyClean = key.split(' (')[0].toUpperCase().trim();
    if (keyClean === targetClean || key.toUpperCase() === targetClean) {
      return divisions;
    }
  }

  const targetFuzzy = targetClean.replace(/[\s\-_]/g, '');
  for (const [key, divisions] of Object.entries(RAILWAY_ZONES_DIVISIONS)) {
    const keyCleanFuzzy = key.toUpperCase().replace(/[\s\-_]/g, '');
    const shortCleanFuzzy = key.split(' (')[0].toUpperCase().replace(/[\s\-_]/g, '');
    if (targetFuzzy === keyCleanFuzzy || targetFuzzy === shortCleanFuzzy) {
      return divisions;
    }
  }

  for (const [key, divisions] of Object.entries(RAILWAY_ZONES_DIVISIONS)) {
    const keyClean = key.split(' (')[0].toUpperCase();
    if (keyClean.includes(targetClean) || targetClean.includes(keyClean)) {
      return divisions;
    }
  }

  return [];
}

interface Part {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
  machineName?: string;
  whetherUse?: string;
}

export default function Requisition() {
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [searchResults, setSearchResults] = useState<Part[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  
  // Requisition main form state
  const [formData, setFormData] = useState({
    demandNo: '',
    demandDate: format(new Date(), 'yyyy-MM-dd'),
    railway: 'SOUTH EAST CENTRAL RLY',
    department: 'Engineering',
    userDepot: 'Track Machine',
    requisitionType: 'Normal' as 'Normal' | 'Loan',
    plNo: '',
    partNo: '',
    issuingDepot: '',
    description: '',
    availableQty: '0.000 Nos.',
    demandedQty: '',
    remarks: '',
  });

  // Search filter criteria (modal)
  const [searchFilters, setSearchFilters] = useState({
    railway: 'Southeast Central Railway (SECR)',
    department: 'Engineering',
    userDepot: '---All---',
    plNoOrDesc: '',
    enableAI: false
  });

  const [machineMovements, setMachineMovements] = useState<any[]>([]);
  const [settingsMachines, setSettingsMachines] = useState<string[]>([]);

  // Listen to general settings for configured machines
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setSettingsMachines(data.machines);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen to live machine movements in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'machine_movements'), (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMachineMovements(list);
    });
    return () => unsubscribe();
  }, []);

  // Compute unique list of all machines
  const uniqueMachines = useMemo(() => {
    const defaultMachines = ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
    const set = new Set<string>([...defaultMachines, ...settingsMachines]);
    machineMovements.forEach(m => {
      if (m.machineName) set.add(m.machineName.trim());
    });
    parts.forEach(p => {
      if (p.machineName) set.add(p.machineName.trim());
    });
    if (formData.userDepot) {
      set.add(formData.userDepot.trim());
    }
    if (profile?.machineName) {
      set.add(profile.machineName.trim());
    }
    return Array.from(set).filter(Boolean).sort();
  }, [machineMovements, settingsMachines, parts, formData.userDepot, profile?.machineName]);

  // Find latest movement details for the selected machine
  const latestMovement = useMemo(() => {
    if (!formData.userDepot) return null;
    const filtered = machineMovements.filter(
      m => m.machineName && m.machineName.toLowerCase() === formData.userDepot.toLowerCase()
    );
    if (filtered.length === 0) return null;
    
    // Sort descending by toDateTime or createdAt
    return filtered.sort((a, b) => {
      const dateA = a.toDateTime || a.createdAt || '';
      const dateB = b.toDateTime || b.createdAt || '';
      return dateB.localeCompare(dateA);
    })[0];
  }, [formData.userDepot, machineMovements]);

  // Sync Zone and Division from the latest machine movement automatically!
  useEffect(() => {
    if (latestMovement) {
      const matchedZone = findMatchingZone(latestMovement.toZone || '');
      const divs = getDivisionsForZone(matchedZone);
      const matchedDiv = divs.find(d => d.toLowerCase() === (latestMovement.toDivision || '').toLowerCase()) || divs[0] || 'ALL';
      setFormData(prev => ({
        ...prev,
        railway: matchedZone || prev.railway,
        department: matchedDiv || prev.department
      }));
    }
  }, [latestMovement]);

  const [showSearchModal, setShowSearchModal] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  useEffect(() => {
    // Generate random / sequential looking demand number initially
    const randNum = Math.floor(100000 + Math.random() * 900000);
    setFormData(prev => ({
      ...prev,
      demandNo: `REQ-${format(new Date(), 'yyyy')}-${randNum}`
    }));

    const fetchProfileAndParts = async () => {
      setLoading(true);
      try {
        if (auth.currentUser) {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          if (emp) {
            setProfile(emp);
            // Pre-fill my user depot details with employee profile
            setFormData(prev => {
              const matchedZone = findMatchingZone(emp.zone || 'SOUTH EAST CENTRAL RLY');
              const divs = getDivisionsForZone(matchedZone);
              const matchedDiv = divs.find(d => d.toLowerCase() === (emp.department || '').toLowerCase()) || divs[0] || 'ALL';

              return {
                ...prev,
                railway: matchedZone,
                department: matchedDiv,
                userDepot: emp.machineName || emp.companyName || 'Track Machine',
              };
            });
          }
        }

        // Fetch all parts
        const partsSnap = await getDocs(collection(db, 'parts'));
        const partsList = partsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Part[];
        setParts(partsList);
      } catch (err) {
        console.error('Error fetching data for Requisition page:', err);
        toast.error('Failed to load profile or inventory parts.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfileAndParts();
  }, []);

  // AI Semantic Dictionary for search matches
  const getSemanticKeywords = (queryStr: string): string[] => {
    const term = queryStr.toLowerCase().trim();
    if (!term) return [];
    
    // Core synonyms map for Indian Railways Track Machines terminology
    const synonyms: Record<string, string[]> = {
      'ring': ['ring', 'o-ring', 'sealing', 'piston ring', 'seal', 'washer', 'joint'],
      'filter': ['filter', 'element', 'filtration', 'strainer', 'cartridge', 'purifier'],
      'gasket': ['gasket', 'seal', 'joint', 'pack', 'sheet', 'washer', 'rubber'],
      'pump': ['pump', 'motor', 'hydraulic', 'injector', 'vane', 'piston pump'],
      'valve': ['valve', 'solenoid', 'check valve', 'direction', 'regulator', 'pressure'],
      'bearing': ['bearing', 'bush', 'roller', 'sleeve', 'shaft', 'housing'],
      'hose': ['hose', 'pipe', 'tube', 'flexible', 'coupling', 'connector'],
      'bolt': ['bolt', 'screw', 'nut', 'fastener', 'washer', 'pin', 'stud'],
      'card': ['card', 'pcb', 'circuit', 'board', 'electronic', 'display'],
      'sensor': ['sensor', 'encoder', 'probe', 'switch', 'transducer'],
      'oil': ['oil', 'grease', 'lubricant', 'mobil', 'hydraulic oil']
    };

    const matches = new Set<string>([term]);
    Object.keys(synonyms).forEach(key => {
      if (term.includes(key) || key.includes(term)) {
        synonyms[key].forEach(syn => matches.add(syn));
      }
    });

    return Array.from(matches);
  };

  const handleSearch = async () => {
    setSearching(true);
    
    if (searchFilters.enableAI) {
      setAiAnalyzing(true);
      // Simulate highly advanced AI mapping process with visual countdown
      await new Promise(resolve => setTimeout(resolve, 1500));
      setAiAnalyzing(false);
    }

    try {
      const term = searchFilters.plNoOrDesc.toLowerCase().trim();
      const selectedDepot = searchFilters.userDepot;
      const selectedDept = searchFilters.department;

      // Filter local parts list globally
      const results = parts.filter(part => {
        // Match department/consignee logic (assuming layout details or default values)
        const matchDepot = selectedDepot === '---All---' || 
          (part.location && part.location.toLowerCase().includes(selectedDepot.toLowerCase())) ||
          (part.machineName && part.machineName.toLowerCase() === selectedDepot.toLowerCase());

        if (!matchDepot) return false;

        // Match PL No or Description
        if (!term) return true; // match all if search term is empty

        if (searchFilters.enableAI) {
          // AI Semantic match! Match synonyms or partials
          const keywords = getSemanticKeywords(term);
          const desc = part.description.toLowerCase();
          const pl = part.plNo.toLowerCase();
          const partNo = (part.partNo || '').toLowerCase();

          return keywords.some(keyword => 
            desc.includes(keyword) || pl.includes(keyword) || partNo.includes(keyword)
          );
        } else {
          // Normal keyword matching
          return part.plNo.toLowerCase().includes(term) || 
            part.description.toLowerCase().includes(term) ||
            (part.partNo && part.partNo.toLowerCase().includes(term));
        }
      });

      setSearchResults(results);
      if (results.length === 0) {
        toast.info('No items match the search criteria across any machine or depot.');
      } else {
        toast.success(`Found ${results.length} matching items globally.`);
      }
    } catch (err) {
      console.error('Error during search:', err);
      toast.error('Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPart = (part: Part) => {
    setSelectedPartId(part.id);
    setFormData(prev => ({
      ...prev,
      plNo: part.plNo,
      partNo: part.partNo || '',
      description: part.description,
      availableQty: `${part.stock.toFixed(3)} Nos.`,
      issuingDepot: part.location || part.machineName || 'Depot',
      railway: searchFilters.railway.split(' (')[0], // Clean up zone name
      department: searchFilters.department,
    }));
    setShowSearchModal(false);
    toast.success(`Selected Item PL: ${part.plNo}`);
  };

  const handleResetForm = () => {
    const randNum = Math.floor(100000 + Math.random() * 900000);
    const matchedZone = findMatchingZone(profile?.zone || 'SOUTH EAST CENTRAL RLY');
    const divs = getDivisionsForZone(matchedZone);
    const matchedDiv = divs.find(d => d.toLowerCase() === (profile?.department || '').toLowerCase()) || divs[0] || 'ALL';

    setFormData({
      demandNo: `REQ-${format(new Date(), 'yyyy')}-${randNum}`,
      demandDate: format(new Date(), 'yyyy-MM-dd'),
      railway: matchedZone,
      department: matchedDiv,
      userDepot: profile?.machineName || profile?.companyName || 'Track Machine',
      requisitionType: 'Normal',
      plNo: '',
      partNo: '',
      issuingDepot: '',
      description: '',
      availableQty: '0.000 Nos.',
      demandedQty: '',
      remarks: '',
    });
    setSelectedPartId(null);
    toast.info('Form cleared.');
  };

  const handleSubmitRequisition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.plNo) {
      toast.error('Please click "Search Item" to select an inventory item first.');
      return;
    }
    const qtyNum = parseFloat(formData.demandedQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error('Please enter a valid demanded quantity greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      // Find full access employees to auto-forward to
      const employeesSnap = await getDocs(collection(db, 'employees'));
      const employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      
      // Attempt to route to an admin/full-access person of that machine or standard depot
      let autoForwardedUser = employees.find(emp => 
        (emp.accessType === 'full' || emp.accessType === 'admin-light') && 
        (emp.machineName === formData.issuingDepot || emp.companyName === profile?.companyName)
      );

      // Fallback: any full admin
      if (!autoForwardedUser) {
        autoForwardedUser = employees.find(emp => emp.accessType === 'full');
      }

      // Add to demands collection in Firestore
      const demandPayload = {
        plNo: formData.plNo,
        partNo: formData.partNo,
        description: formData.description,
        qty: qtyNum,
        date: formData.demandDate,
        status: 'pending',
        remarks: formData.remarks,
        whetherUse: formData.requisitionType === 'Normal' ? 'CS' : 'Loan',
        createdByUid: auth.currentUser?.uid || '',
        createdByEmail: auth.currentUser?.email || '',
        createdByEmployeeName: profile?.name || 'Employee',
        createdByPfNo: profile?.pfNo || '',
        createdByCompanyName: profile?.companyName || '',
        machineName: formData.issuingDepot || 'Depot',
        isRequisition: true,
        requisitionNo: formData.demandNo,
        requisitionType: formData.requisitionType,
        railway: formData.railway,
        department: formData.department,
        forwardedTo: autoForwardedUser?.id || '',
        forwardedToName: autoForwardedUser?.name || 'Administrator',
        forwardedToEmail: autoForwardedUser?.email || '',
      };

      const docRef = await addDoc(collection(db, 'demands'), demandPayload);

      // Log transaction/demand action
      await addDoc(collection(db, 'demand_logs'), {
        demandId: docRef.id,
        plNo: formData.plNo,
        partNo: formData.partNo,
        description: formData.description,
        action: 'CREATE_REQUISITION',
        remark: `Requisition placed: ${formData.requisitionType}. Remarks: ${formData.remarks || 'None'}`,
        performedByUid: auth.currentUser?.uid || '',
        performedByName: profile?.name || auth.currentUser?.email || 'Employee',
        performedByEmail: auth.currentUser?.email || '',
        timestamp: new Date().toISOString()
      });

      // Send Notification to recipient
      if (autoForwardedUser && autoForwardedUser.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: autoForwardedUser.email,
          title: 'Requisition Forwarded to You',
          message: `A new Requisition (${formData.demandNo}) for PL No. ${formData.plNo} has been submitted by ${profile?.name || 'an employee'}.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });
      }

      toast.success(`Requisition ${formData.demandNo} submitted successfully!`);
      handleResetForm();
    } catch (err) {
      console.error('Error submitting requisition:', err);
      toast.error('Failed to submit Requisition. Check your database connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasAllAuthority = !profile?.machineName || profile?.accessType === 'full' || profile?.accessType === 'admin-light' || profile?.role === 'admin' || !profile;

  // Helper calculation for total searched value
  const totalQtySearch = searchResults.reduce((sum, item) => sum + item.stock, 0);
  const totalValueSearch = searchResults.reduce((sum, item) => sum + (item.stock * item.rate), 0);

  return (
    <div id="requisition-page-container" className="p-4 md:p-6 bg-slate-50 min-h-screen text-slate-800">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Page Title Header */}
        <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-600" />
              Requisition System
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Search global depot parts and place normal or loan requisitions dynamically
            </p>
          </div>
          {profile?.companyName && (
            <div className="bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700">
              {profile.companyName}
            </div>
          )}
        </div>

        {/* 1. Machine Location & Movement Details */}
        <div id="user-depot-details-card" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-indigo-600 text-white px-4 py-3 text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Database className="w-4 h-4" />
              Machine Location & Live Movement Details
            </span>
            <div className="flex items-center gap-1 bg-indigo-500/35 border border-indigo-400 px-2.5 py-0.5 rounded-md text-[10px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping"></span>
              Live Tracking
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
            
            {/* Machine Name */}
            <div className="flex flex-col w-full">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Machine Name
              </label>
              {hasAllAuthority ? (
                <select
                  value={formData.userDepot}
                  onChange={(e) => setFormData(p => ({ ...p, userDepot: e.target.value }))}
                  className="w-full h-10 text-sm bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  {uniqueMachines.map(mName => (
                    <option key={mName} value={mName}>{mName}</option>
                  ))}
                </select>
              ) : (
                <input 
                  type="text" 
                  value={formData.userDepot} 
                  disabled 
                  className="w-full h-10 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-semibold truncate"
                />
              )}
            </div>

            {/* Zone */}
            <div className="flex flex-col w-full">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Zone
              </label>
              {hasAllAuthority ? (
                <select
                  value={formData.railway}
                  onChange={(e) => {
                    const selectedZone = e.target.value;
                    const divs = getDivisionsForZone(selectedZone);
                    const firstDiv = divs.includes('ALL') ? 'ALL' : (divs[0] || 'ALL');
                    setFormData(p => ({ 
                      ...p, 
                      railway: selectedZone,
                      department: firstDiv
                    }));
                  }}
                  className="w-full h-10 text-sm bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  <option value="ALL">ALL</option>
                  {Object.keys(RAILWAY_ZONES_DIVISIONS).map(zone => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              ) : (
                <input 
                  type="text" 
                  value={formData.railway} 
                  disabled 
                  className="w-full h-10 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-semibold"
                />
              )}
            </div>

            {/* Division */}
            <div className="flex flex-col w-full">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Division
              </label>
              {hasAllAuthority ? (
                <select
                  value={formData.department}
                  onChange={(e) => setFormData(p => ({ ...p, department: e.target.value }))}
                  className="w-full h-10 text-sm bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  <option value="ALL">ALL</option>
                  {getDivisionsForZone(formData.railway).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input 
                  type="text" 
                  value={formData.department} 
                  disabled 
                  className="w-full h-10 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-semibold"
                />
              )}
            </div>

            {/* Search Item Action button */}
            <div className="flex flex-col w-full">
              <label className="hidden sm:block text-xs font-bold text-transparent mb-1.5 select-none">
                &nbsp;
              </label>
              <button
                type="button"
                onClick={() => {
                  setSearchResults([]);
                  setShowSearchModal(true);
                }}
                className="w-full h-10 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold text-xs rounded-lg transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                Search Item
              </button>
              <div className="text-[10px] text-transparent mt-1.5 select-none">
                &nbsp;
              </div>
            </div>

          </div>
        </div>

        {/* 2. Details of Requisition/Demand Placed */}
        <form onSubmit={handleSubmitRequisition} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-800 text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
            <span>Details of Requisition/Demand placed</span>
            {formData.plNo && <span className="text-xs font-bold text-emerald-400">{formData.demandNo}</span>}
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Demand No.</label>
                <input
                  type="text"
                  value={formData.plNo ? formData.demandNo : ''}
                  disabled
                  placeholder="Blank until item selection"
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Demand Date</label>
                <input
                  type="date"
                  value={formData.demandDate}
                  disabled
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Type of Requisition</label>
                <div className="flex items-center gap-6 h-9">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <input
                      type="radio"
                      name="requisitionType"
                      value="Normal"
                      checked={formData.requisitionType === 'Normal'}
                      onChange={() => setFormData(p => ({ ...p, requisitionType: 'Normal' }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Normal
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <input
                      type="radio"
                      name="requisitionType"
                      value="Loan"
                      checked={formData.requisitionType === 'Loan'}
                      onChange={() => setFormData(p => ({ ...p, requisitionType: 'Loan' }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Loan
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Zone</label>
                <input
                  type="text"
                  value={formData.railway}
                  disabled
                  placeholder="Select from search item modal"
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Division</label>
                <input
                  type="text"
                  value={formData.department}
                  disabled
                  placeholder="Select from search item modal"
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">PL No. / Item Code</label>
                <input
                  type="text"
                  value={formData.plNo}
                  disabled
                  placeholder="Click 'Search Item' to fill"
                  className="w-full text-sm bg-yellow-50/50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Issuing Machine</label>
                <input
                  type="text"
                  value={formData.issuingDepot}
                  disabled
                  placeholder="Click 'Search Item' to fill"
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Available Qty.</label>
                <input
                  type="text"
                  value={formData.availableQty}
                  disabled
                  className="w-full text-sm bg-red-50 border border-red-200 text-red-600 font-bold rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
              <textarea
                value={formData.description}
                disabled
                rows={2}
                placeholder="Item detailed description will display here upon item selection"
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Demanded Qty. <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  disabled={!formData.plNo}
                  value={formData.demandedQty}
                  onChange={(e) => setFormData(p => ({ ...p, demandedQty: e.target.value }))}
                  placeholder={formData.plNo ? "Enter Qty." : "Select item first"}
                  className="w-full text-sm border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-950 font-medium"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Remarks / Purpose</label>
                <input
                  type="text"
                  value={formData.remarks}
                  onChange={(e) => setFormData(p => ({ ...p, remarks: e.target.value }))}
                  placeholder="Enter specific purpose, demand context or remarks"
                  className="w-full text-sm border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-950"
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleResetForm}
              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold rounded-lg text-sm transition-all flex items-center gap-1"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Form
            </button>
            <button
              type="submit"
              disabled={submitting || !formData.plNo}
              className={cn(
                "px-5 py-2 font-semibold rounded-lg text-sm transition-all flex items-center gap-2 shadow-sm text-white",
                formData.plNo 
                  ? "bg-indigo-600 hover:bg-indigo-700 active:scale-95" 
                  : "bg-slate-300 cursor-not-allowed"
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save & Submit Requisition
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* SEARCH ITEM MODAL (SCREENSHOT COPIES) */}
      <AnimatePresence>
        {showSearchModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              
              {/* Modal Header */}
              <div className="bg-indigo-600 text-white px-5 py-3 flex items-center justify-between">
                <h3 className="font-bold text-md flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Search Item
                </h3>
                <button 
                  onClick={() => setShowSearchModal(false)}
                  className="text-white hover:bg-white/10 p-1 rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body / Search Form */}
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  
                  {/* Select Zone */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Zone</label>
                    <select
                      value={searchFilters.railway}
                      onChange={(e) => setSearchFilters(p => ({ ...p, railway: e.target.value }))}
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500"
                    >
                      {Object.keys(RAILWAY_ZONES_DIVISIONS).map(zone => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                  </div>

                  {/* Select Division */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Division</label>
                    <select
                      value={searchFilters.department}
                      onChange={(e) => setSearchFilters(p => ({ ...p, department: e.target.value }))}
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="---All---">---All---</option>
                      {(RAILWAY_ZONES_DIVISIONS[searchFilters.railway] || []).map(div => (
                        <option key={div} value={div}>{div}</option>
                      ))}
                    </select>
                  </div>

                  {/* Select Machine */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Machine Name</label>
                    <select
                      value={searchFilters.userDepot}
                      onChange={(e) => setSearchFilters(p => ({ ...p, userDepot: e.target.value }))}
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="---All---">---All---</option>
                      {uniqueMachines.map(mName => (
                        <option key={mName} value={mName}>{mName}</option>
                      ))}
                    </select>
                  </div>

                  {/* Search Term */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">PL No. / Unified PL / Description</label>
                    <input
                      type="text"
                      value={searchFilters.plNoOrDesc}
                      onChange={(e) => setSearchFilters(p => ({ ...p, plNoOrDesc: e.target.value }))}
                      placeholder="Enter PL No. / Unified PL No. / Description"
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* AI-powered Search Flag and Search trigger */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-indigo-700">
                    <input
                      type="checkbox"
                      checked={searchFilters.enableAI}
                      onChange={(e) => setSearchFilters(p => ({ ...p, enableAI: e.target.checked }))}
                      className="rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 w-4 h-4"
                    />
                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-500" />
                    Enable Artificial Intelligence (AI) based Search
                  </label>

                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-6 py-2 rounded-lg transition-all shadow flex items-center justify-center gap-1.5 min-w-[120px]"
                  >
                    {searching ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        Search
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* AI-Loader simulation overlay/alert */}
              {aiAnalyzing && (
                <div className="bg-indigo-50/80 border-y border-indigo-100 px-5 py-3 flex items-center justify-center gap-2.5 text-xs text-indigo-800 font-semibold animate-pulse">
                  <Sparkles className="w-4 h-4 text-indigo-600 animate-spin" />
                  <span>AI Semantic Match engine analyzing query keywords, synonyms, and mapping part catalogs...</span>
                </div>
              )}

              {/* Results Table (Copy of Screenshot 155601) */}
              <div className="flex-1 overflow-y-auto p-5">
                {searching ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-2">
                    <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                    <p className="text-xs font-semibold text-slate-500">Searching global assets across all machine inventories...</p>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 uppercase font-bold text-[10px] tracking-wider">
                          <th className="p-3 text-center border-r border-slate-200">#</th>
                          <th className="p-3 border-r border-slate-200">Consignee</th>
                          <th className="p-3 border-r border-slate-200">Ledger Name</th>
                          <th className="p-3 border-r border-slate-200">PL No.</th>
                          <th className="p-3 border-r border-slate-200">Ledger Folio: Item Description</th>
                          <th className="p-3 text-right border-r border-slate-200">Stock Qty.</th>
                          <th className="p-3 text-right border-r border-slate-200">Unit Rate (Rs.)</th>
                          <th className="p-3 text-right border-r border-slate-200">Sparable Qty.</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {searchResults.map((item, index) => {
                          const isSelected = selectedPartId === item.id;
                          return (
                            <tr 
                              key={item.id} 
                              onClick={() => handleSelectPart(item)}
                              className={cn(
                                "hover:bg-indigo-50/40 cursor-pointer transition-colors",
                                isSelected ? "bg-indigo-50" : "even:bg-slate-50/30"
                              )}
                            >
                              <td className="p-3 text-center border-r border-slate-200 font-medium text-slate-500">{index + 1}</td>
                              <td className="p-3 border-r border-slate-200 font-semibold text-slate-700">
                                {item.location || item.machineName || 'Raipur SSE'} Engineering SECR
                              </td>
                              <td className="p-3 border-r border-slate-200 text-slate-600">
                                {item.whetherUse === 'CS' ? '002-Consumable Stock' : '001-MS Depot Stock'}
                              </td>
                              <td className="p-3 border-r border-slate-200 font-bold text-slate-900">{item.plNo}</td>
                              <td className="p-3 border-r border-slate-200 text-slate-600 max-w-xs truncate" title={item.description}>
                                <span className="font-semibold text-indigo-700 mr-1">000{index + 1}-</span>
                                {item.description}
                              </td>
                              <td className="p-3 text-right border-r border-slate-200 font-bold text-slate-900">
                                {item.stock.toFixed(3)} Nos.
                              </td>
                              <td className="p-3 text-right border-r border-slate-200 text-slate-700 font-medium">
                                ₹{item.rate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="p-3 text-right border-r border-slate-200 text-slate-500 font-medium">
                                {item.stock > 0 ? (item.stock - 1).toFixed(3) : '0.000'}
                              </td>
                              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="radio"
                                  name="selectedPartRadio"
                                  checked={isSelected}
                                  onChange={() => handleSelectPart(item)}
                                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-1 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                    <Database className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-500">No search results loaded.</p>
                    <p className="text-[10px] text-slate-400">Fill PL No / Description and click Search to query global inventories.</p>
                  </div>
                )}
              </div>

              {/* Modal Footer / Calculation Summary */}
              {searchResults.length > 0 && (
                <div className="bg-slate-50 border-t border-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 items-center gap-4 text-xs font-semibold text-slate-700">
                  <div className="flex gap-6 justify-center md:justify-start">
                    <span>Total Qty: <span className="text-indigo-600 font-bold">{totalQtySearch.toFixed(3)}</span></span>
                    <span>Unit: <span className="text-indigo-600 font-bold">Nos.</span></span>
                    <span>Total Value: <span className="text-indigo-600 font-bold">₹{totalValueSearch.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                  </div>
                  <div className="text-center md:text-right font-extrabold text-sm text-red-600">
                    Total Value = ₹{totalValueSearch.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
