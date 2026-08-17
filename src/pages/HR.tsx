import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, getDoc, updateDoc, doc, query, where, setDoc, writeBatch, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Plus, Trash2, Download, Eye, EyeOff, Building2, X, Loader2, Camera, Upload, Edit2, Check, XCircle, UserCheck, Bell, Settings, ArrowUpRight, Undo, Factory, TrendingUp, History, Printer, MapPin, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { RAILWAY_ZONES_DIVISIONS } from '../utils/railway';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const maskValue = (value?: string, maskChar: string = '•') => {
  if (!value) return 'N/A';
  if (value.length <= 4) return maskChar.repeat(value.length);
  return maskChar.repeat(value.length - 4) + ' ' + value.slice(-4);
};

const getImgProps = (src?: string) => {
  if (!src) return {};
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/')) {
    return {};
  }
  return { crossOrigin: 'anonymous' as const, referrerPolicy: 'no-referrer' as const };
};

const TRANSPARENT_FALLBACK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const urlToBase64 = async (initialUrl: any): Promise<string> => {
  if (!initialUrl || typeof initialUrl !== 'string') return '';
  
  let url = initialUrl;
  if (url.startsWith('/')) {
    try {
      url = new URL(url, window.location.origin).href;
    } catch (e) {
      console.warn('Failed to parse relative URL:', url, e);
    }
  }

  if (url.startsWith('data:')) {
    return url;
  }

  // Robustly convert local blob: URLs to Base64 to bypass iframe sandbox restrictions in html2canvas
  if (url.startsWith('blob:')) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(TRANSPARENT_FALLBACK);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('Failed to convert blob URL to base64, using fallback:', err);
      return TRANSPARENT_FALLBACK;
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    
    // Set a timeout of 5 seconds to prevent hanging on slow or dead external URLs
    const timeoutId = setTimeout(() => {
      console.warn('urlToBase64 timed out for:', url);
      img.src = ''; // Cancel loading
      resolve(TRANSPARENT_FALLBACK);
    }, 5000);

    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve(TRANSPARENT_FALLBACK);
        }
      } catch (err) {
        console.error('Canvas conversion tainted, using fallback:', url, err);
        resolve(TRANSPARENT_FALLBACK);
      }
    };
    img.onerror = (err) => {
      clearTimeout(timeoutId);
      console.error('Failed to load image for base64 conversion, using fallback:', url, err);
      resolve(TRANSPARENT_FALLBACK);
    };
    img.src = url;
  });
};

const getFullZoneName = (zoneStr?: string): string => {
  if (!zoneStr) return "SOUTH EAST CENTRAL RAILWAY";
  
  // Remove any parenthetical abbreviations e.g. "Central Railway (CR)" -> "Central Railway"
  let clean = zoneStr.replace(/\s*\([^)]*\)/g, '').trim();

  // If the clean string is just an abbreviation, map it to the full name
  const abbrevMap: Record<string, string> = {
    "CR": "Central Railway",
    "ER": "Eastern Railway",
    "ECR": "East Central Railway",
    "ECOR": "East Coast Railway",
    "ECO_R": "East Coast Railway",
    "NR": "Northern Railway",
    "NCR": "North Central Railway",
    "NER": "North Eastern Railway",
    "NFR": "Northeast Frontier Railway",
    "NWR": "North Western Railway",
    "SR": "Southern Railway",
    "SCR": "South Central Railway",
    "SER": "South Eastern Railway",
    "SECR": "South East Central Railway",
    "SWR": "South Western Railway",
    "WR": "Western Railway",
    "WCR": "West Central Railway",
    "METRO": "Metro Railway"
  };

  const upperClean = clean.toUpperCase();
  if (abbrevMap[upperClean]) {
    return abbrevMap[upperClean].toUpperCase();
  }

  return clean.toUpperCase();
};

const CurvedText = ({ 
  text, 
  radius, 
  startAngle, 
  endAngle, 
  cx = 50, 
  cy = 50, 
  fontSize, 
  fontWeight, 
  fill,
  reverse = false
}: { 
  text: string; 
  radius: number; 
  startAngle: number; 
  endAngle: number; 
  cx?: number; 
  cy?: number; 
  fontSize: string; 
  fontWeight: string; 
  fill: string;
  reverse?: boolean;
}) => {
  const chars = text.split('');
  const len = chars.length;
  if (len === 0) return null;
  
  return (
    <>
      {chars.map((char, idx) => {
        const fraction = len > 1 ? idx / (len - 1) : 0.5;
        const angleDeg = startAngle + fraction * (endAngle - startAngle);
        const angleRad = (angleDeg * Math.PI) / 180;
        const x = cx + radius * Math.cos(angleRad);
        const y = cy + radius * Math.sin(angleRad);
        const charRotation = reverse ? angleDeg - 90 : angleDeg + 90;
        
        return (
          <text
            key={idx}
            x={x}
            y={y}
            fill={fill}
            fontSize={fontSize}
            fontWeight={fontWeight}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${charRotation}, ${x}, ${y})`}
          >
            {char}
          </text>
        );
      })}
    </>
  );
};

const compressImage = (input: string | File | Blob, maxDim = 400, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const processDataUrl = (dataUrl: string) => {
      if (!dataUrl || dataUrl.length < 100000) {
        return resolve(dataUrl);
      }
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const mime = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          resolve(canvas.toDataURL(mime, quality));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };

    if (typeof input === 'string') {
      processDataUrl(input);
    } else if (input instanceof File || input instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => processDataUrl(e.target?.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(input);
    } else {
      resolve('');
    }
  });
};

interface Employee {
  id: string;
  name: string;
  mobile: string;
  email: string;
  designation: string;
  address: string;
  doj: string;
  dob?: string;
  photoUrl: string;
  status: 'active' | 'left';
  employeeId?: string;
  doe?: string;
  pfNo?: string;
  esicNo?: string;
  accessType?: 'full' | 'limited' | 'admin-light';
  machineName?: string;
  qualification?: string;
  companyName?: string;
  companyGst?: string;
  companyMobile?: string;
  companyEmail?: string;
  companyAddress?: string;
  companyDept?: string;
  fatherName?: string;
  age?: string;
  sex?: string;
  validityDate?: string;
  bloodGroup?: string;
  department?: string;
  zone?: string;
  division?: string;
  idNo?: string;
  aadharNo?: string;
  panNo?: string;
  accountNo?: string;
  ifscCode?: string;
  bankName?: string;
  branch?: string;
  employmentHistory?: {
    companyName: string;
    designation: string;
    doj: string;
    leftDate: string;
    status: 'left';
  }[];
  designationHistory?: {
    oldDesignation: string;
    newDesignation: string;
    updatedAt: string;
    type: 'promotion' | 'demotion' | 'correction' | 'initial';
  }[];
  employeeSigUrl?: string;
  contractorSigUrl?: string;
  railwaySigUrl?: string;
  logoUrl?: string;
  contractNo?: string;
  zoneDivisionHistory?: {
    zone: string;
    division: string;
    machineName: string;
    startDate: string;
    endDate?: string;
  }[];
}

// Dynamically compute employee zone/division placement history by intersecting assignments with machine movements
function computeDynamicEmployeeHistory(
  doj: string,
  zoneDivisionHistory: any[],
  currentMachine: string,
  currentCompany: string,
  allMovements: any[],
  positionsMap: Record<string, { zone: string; division: string }>,
  employeeFallbackZone: string,
  employeeFallbackDivision: string
): any[] {
  const joinDate = doj || new Date().toISOString().split('T')[0];

  // 1. Reconstruct raw assignment periods of the employee
  let assignments: any[] = [];
  if (zoneDivisionHistory && zoneDivisionHistory.length > 0) {
    assignments = zoneDivisionHistory.map((h: any) => ({
      machineName: (h.machineName || 'General').trim(),
      companyName: (h.companyName || currentCompany || 'General').trim(),
      fromDateTime: h.fromDateTime || h.startDate || joinDate,
      toDateTime: h.toDateTime || h.endDate || 'Ongoing'
    }));
  } else {
    assignments = [{
      machineName: (currentMachine || 'General').trim(),
      companyName: (currentCompany || 'General').trim(),
      fromDateTime: joinDate,
      toDateTime: 'Ongoing'
    }];
  }

  // Sort assignments ascending by start date
  assignments.sort((a, b) => (a.fromDateTime || '').localeCompare(b.fromDateTime || ''));

  const resolvedTimeline: any[] = [];

  for (const assign of assignments) {
    const M = assign.machineName;
    const C = assign.companyName;
    const assignStart = (assign.fromDateTime || '').split('T')[0];
    const assignEnd = assign.toDateTime === 'Ongoing' ? 'Ongoing' : (assign.toDateTime || '').split('T')[0];

    // Ensure we start strictly from the joining date onwards, never show details before it
    const tenureStart = assignStart < joinDate ? joinDate : assignStart;
    const tenureEnd = assignEnd;

    // If assignment ends before the join date, skip it completely
    if (tenureEnd !== 'Ongoing' && tenureEnd < joinDate) {
      continue;
    }

    // Fallback location for this machine
    const pos = positionsMap[M];
    const fallbackZ = pos?.zone || employeeFallbackZone || 'N/A';
    const fallbackD = pos?.division || employeeFallbackDivision || 'N/A';

    if (M === 'General' || !M) {
      resolvedTimeline.push({
        machineName: M,
        companyName: C,
        zone: fallbackZ,
        division: fallbackD,
        fromDateTime: tenureStart,
        toDateTime: tenureEnd
      });
      continue;
    }

    // Filter and sort movements for machine M
    const mMoves = allMovements.filter((mov: any) => (mov.machineName || '').trim() === M);
    mMoves.sort((a, b) => (a.fromDateTime || '').localeCompare(b.fromDateTime || ''));

    // Check overlaps of movements with the employee's tenure on this machine [tenureStart, tenureEnd]
    const overlappingMovements: any[] = [];
    for (const mov of mMoves) {
      const movStart = (mov.fromDateTime || '').split('T')[0];
      const movEnd = (mov.toDateTime || '').split('T')[0];

      const overlapStart = tenureStart > movStart ? tenureStart : movStart;
      let overlapEnd = '';
      if (tenureEnd === 'Ongoing' && movEnd === 'Ongoing') {
        overlapEnd = 'Ongoing';
      } else if (tenureEnd === 'Ongoing') {
        overlapEnd = movEnd;
      } else if (movEnd === 'Ongoing') {
        overlapEnd = tenureEnd;
      } else {
        overlapEnd = tenureEnd < movEnd ? tenureEnd : movEnd;
      }

      if (overlapEnd === 'Ongoing' || overlapStart <= overlapEnd) {
        overlappingMovements.push({
          mov,
          overlapStart,
          overlapEnd
        });
      }
    }

    // Sort overlapping movements ascending by overlapStart
    overlappingMovements.sort((a, b) => a.overlapStart.localeCompare(b.overlapStart));

    let currentDate = tenureStart;

    for (const { mov, overlapStart, overlapEnd } of overlappingMovements) {
      // 1. Is there a gap before the overlapping movement?
      if (currentDate < overlapStart) {
        // Machine is at its starting location/source before this movement, or fallback
        resolvedTimeline.push({
          machineName: M,
          companyName: C,
          zone: mov.fromZone || fallbackZ,
          division: mov.fromDivision || fallbackD,
          fromDateTime: currentDate,
          toDateTime: overlapStart
        });
      }

      // 2. Add the actual overlapping machine movement
      resolvedTimeline.push({
        machineName: M,
        companyName: mov.companyName || C,
        zone: mov.toZone || fallbackZ,
        division: mov.toDivision || fallbackD,
        fromDateTime: overlapStart,
        toDateTime: overlapEnd
      });

      currentDate = overlapEnd;
    }

    // 3. Is there a gap after the last overlapping movement?
    if (tenureEnd === 'Ongoing') {
      if (currentDate !== 'Ongoing') {
        resolvedTimeline.push({
          machineName: M,
          companyName: C,
          zone: fallbackZ,
          division: fallbackD,
          fromDateTime: currentDate,
          toDateTime: 'Ongoing'
        });
      }
    } else if (currentDate < tenureEnd) {
      resolvedTimeline.push({
        machineName: M,
        companyName: C,
        zone: fallbackZ,
        division: fallbackD,
        fromDateTime: currentDate,
        toDateTime: tenureEnd
      });
    }
  }

  // Merge adjacent timeline entries if they have the same location and machine/company
  const mergedTimeline: any[] = [];
  for (const item of resolvedTimeline) {
    if (mergedTimeline.length === 0) {
      mergedTimeline.push(item);
    } else {
      const last = mergedTimeline[mergedTimeline.length - 1];
      const isSameLocation =
        last.machineName === item.machineName &&
        last.companyName === item.companyName &&
        last.zone === item.zone &&
        last.division === item.division;

      if (isSameLocation) {
        if (last.toDateTime !== 'Ongoing') {
          last.toDateTime = item.toDateTime;
        }
      } else {
        mergedTimeline.push(item);
      }
    }
  }

  // Sort by fromDateTime descending so newest is first
  mergedTimeline.sort((a, b) => (b.fromDateTime || '').localeCompare(a.fromDateTime || ''));

  return mergedTimeline;
}

export default function HR() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  
  const [showBankDetailsAdd, setShowBankDetailsAdd] = useState(false);
  const [showBankDetailsEdit, setShowBankDetailsEdit] = useState(false);
  const [showBankDetailsView, setShowBankDetailsView] = useState(false);
  
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [designationChangeType, setDesignationChangeType] = useState<'promotion' | 'demotion' | 'correction' | 'initial'>('promotion');
  const [silentCorrection, setSilentCorrection] = useState(false);
  const [companyMachineSearch, setCompanyMachineSearch] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [exitDate, setExitDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // States to hold the fetched history by PF number and cached machine movements
  const [selectedEmpMachineMovements, setSelectedEmpMachineMovements] = useState<any[]>([]);
  const [fetchedEmployeeHistory, setFetchedEmployeeHistory] = useState<any[] | null>(null);
  const [dynamicEmployeeHistory, setDynamicEmployeeHistory] = useState<any[] | null>(null);

  useEffect(() => {
    if (!selectedEmployee) {
      setSelectedEmpMachineMovements([]);
      setFetchedEmployeeHistory(null);
      setDynamicEmployeeHistory(null);
      return;
    }

    let isSubscribed = true;

    async function loadData() {
      try {
        const pf = selectedEmployee.pfNo || '';
        const name = selectedEmployee.name || '';
        const currentMachine = selectedEmployee.machineName || '';

        let historyList = selectedEmployee.zoneDivisionHistory || [];
        let empDocData = selectedEmployee;

        // 1. Fetch full employee document by PF Number to get the most up-to-date and complete machine change details
        if (pf) {
          const qEmp = query(collection(db, 'employees'), where('pfNo', '==', pf));
          const snapEmp = await getDocs(qEmp);
          if (!snapEmp.empty) {
            const empDoc = snapEmp.docs[0];
            empDocData = { id: empDoc.id, ...empDoc.data() } as any;
            if (empDocData.zoneDivisionHistory) {
              historyList = empDocData.zoneDivisionHistory;
            }
          }
        }

        if (isSubscribed) {
          setFetchedEmployeeHistory(historyList);
        }

        // 2. Fetch all machine movements and positions in parallel
        const [snapMov, snapPos] = await Promise.all([
          getDocs(collection(db, 'machine_movements')),
          getDocs(collection(db, 'machine_positions'))
        ]);

        const allMovementsList: any[] = [];
        snapMov.forEach((docSnap) => {
          allMovementsList.push({ id: docSnap.id, ...docSnap.data() });
        });

        const positionsMap: Record<string, { zone: string; division: string }> = {};
        snapPos.forEach((docSnap) => {
          const d = docSnap.data();
          positionsMap[docSnap.id] = {
            zone: d.zone || '',
            division: d.division || ''
          };
        });

        // 3. Filter machine movements matching the machines the employee has worked on (for showing the log list)
        const machines = new Set<string>();
        if (empDocData.machineName) {
          machines.add(empDocData.machineName);
        }
        historyList.forEach((h: any) => {
          if (h.machineName) {
            machines.add(h.machineName);
          }
        });

        const matchedMovements: any[] = [];
        allMovementsList.forEach((mov) => {
          const mName = mov.machineName || '';
          const empName = mov.employeeName || '';

          const isMachineMatch = mName && machines.has(mName);
          const isNameMatch = empName && (
            empName.toLowerCase() === name.toLowerCase() ||
            empName.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(empName.toLowerCase())
          );

          if (isMachineMatch || isNameMatch) {
            matchedMovements.push(mov);
          }
        });

        // Sort movements by date descending (latest first)
        matchedMovements.sort((a, b) => {
          const tA = a.fromDateTime || '';
          const tB = b.fromDateTime || '';
          return tB.localeCompare(tA);
        });

        if (isSubscribed) {
          setSelectedEmpMachineMovements(matchedMovements);
        }

        // 4. Compute the employee's dynamic history based on actual machine movements and locations at those dates
        const computedDynamicHist = computeDynamicEmployeeHistory(
          empDocData.doj || '',
          historyList,
          empDocData.machineName || '',
          empDocData.companyName || '',
          allMovementsList,
          positionsMap,
          empDocData.zone || '',
          empDocData.division || ''
        );

        if (isSubscribed) {
          setDynamicEmployeeHistory(computedDynamicHist);
        }
      } catch (err) {
        console.error("Error loading movement history by PF No:", err);
      }
    }

    loadData();

    return () => {
      isSubscribed = false;
    };
  }, [selectedEmployee?.id, selectedEmployee?.pfNo, selectedEmployee?.machineName]);

  // New tab and request states for profile approvals
  const [activeTab, setActiveTab] = useState<'employees' | 'approvals' | 'companies'>('employees');
  const [selectedCompanyForView, setSelectedCompanyForView] = useState<string | null>(null);
  const [profileRequests, setProfileRequests] = useState<any[]>([]);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');
  const [requestRemarks, setRequestRemarks] = useState<Record<string, string>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});

  // Profile Request Forwarding Modal States
  const [profileRequestToForward, setProfileRequestToForward] = useState<any | null>(null);
  const [selectedProfileForwardEmployeeId, setSelectedProfileForwardEmployeeId] = useState<string>('');
  const [showProfileForwardModal, setShowProfileForwardModal] = useState<boolean>(false);

  const [isEmployee, setIsEmployee] = useState(() => {
    return auth.currentUser?.email?.endsWith('@employee.billedapp.com') || false;
  });
  const [currentUserAccessType, setCurrentUserAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmp = auth.currentUser?.email?.endsWith('@employee.billedapp.com') || false;
    if (!isEmp) return true;
    const storedAccess = auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) : null;
    return storedAccess === 'full' || storedAccess === 'admin-light';
  });

  // Machine management states
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedZone, setSelectedZone] = useState('all');
  const [selectedDivision, setSelectedDivision] = useState('all');
  const [printEmployees, setPrintEmployees] = useState<Employee[] | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Dynamically set document.title for browser print saving as PDF based on single vs multiple employees
  useEffect(() => {
    if (printEmployees && printEmployees.length > 0) {
      const defaultAppTitle = 'RMMS - Railway Machine Management System';
      let targetTitle = '';
      if (printEmployees.length === 1) {
        targetTitle = printEmployees[0].name || 'Employee_ID_Card';
      } else {
        const firstCompName = printEmployees[0].companyName || 'Company';
        targetTitle = `${firstCompName} employee's`;
      }

      document.title = targetTitle;

      // Try to set parent document title if same-origin (to handle iframes perfectly)
      try {
        if (window.parent && window.parent !== window) {
          window.parent.document.title = targetTitle;
        }
      } catch (e) {
        // Safe to ignore CORS error
      }

      return () => {
        document.title = defaultAppTitle;
        try {
          if (window.parent && window.parent !== window) {
            window.parent.document.title = defaultAppTitle;
          }
        } catch (e) {
          // Safe to ignore CORS error
        }
      };
    }
  }, [printEmployees]);
  const [idCardDesign, setIdCardDesign] = useState<'classic' | 'modern' | 'minimal' | 'tech'>('classic');
  const [idCardColor, setIdCardColor] = useState<'red' | 'blue' | 'green'>('blue');
  const [idCardTemplate, setIdCardTemplate] = useState<'standard' | 'railway_pass'>('standard');
  const [batchContractorSig, setBatchContractorSig] = useState<string>(() => localStorage.getItem('batchContractorSig') || '');
  const [batchRailwaySig, setBatchRailwaySig] = useState<string>(() => localStorage.getItem('batchRailwaySig') || '');
  const [batchLogo, setBatchLogo] = useState<string>(() => localStorage.getItem('batchLogo') || '');
  const [template2Logo, setTemplate2Logo] = useState<string>(() => localStorage.getItem('template2Logo') || '');
  const [demandLogo, setDemandLogo] = useState<string>(() => localStorage.getItem('demandLogo') || '');
  const [machineContractsMap, setMachineContractsMap] = useState<Record<string, string>>({});

  // Real-time listener for machine_contracts to map machineName -> active contractNo
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machine_contracts'), (snapshot) => {
      const map: Record<string, string> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.machineName && data.contractNo && (data.status === 'active' || !data.status)) {
          map[data.machineName.trim()] = data.contractNo;
        }
      });
      setMachineContractsMap(map);
    }, (error) => {
      console.error('Error listening to machine_contracts in HR:', error);
    });
    return () => unsub();
  }, []);
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');

  const [machinesList, setMachinesList] = useState<string[]>(() => {
    return ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
  });

  // Group employees by company dynamically
  const companiesListComputed = React.useMemo(() => {
    const map: Record<string, {
      name: string;
      gst: string;
      mobile: string;
      email: string;
      address: string;
      dept: string;
      employeesCount: number;
      adminLightEmployees: string[];
      machineCounts: Record<string, number>;
    }> = {};

    employees.forEach(emp => {
      const cName = emp.companyName?.trim();
      if (!cName) return;
      if (!map[cName]) {
        map[cName] = {
          name: cName,
          gst: '',
          mobile: '',
          email: '',
          address: '',
          dept: '',
          employeesCount: 0,
          adminLightEmployees: [],
          machineCounts: {},
        };
      }
      if (emp.status === 'active') {
        map[cName].employeesCount += 1;
        if (emp.machineName) {
          const mName = emp.machineName.trim();
          map[cName].machineCounts[mName] = (map[cName].machineCounts[mName] || 0) + 1;
        }
      }
      
      // If this employee is admin-light, capture company details
      if (emp.accessType === 'admin-light') {
        map[cName].gst = emp.companyGst || map[cName].gst;
        map[cName].mobile = emp.companyMobile || map[cName].mobile;
        map[cName].email = emp.companyEmail || map[cName].email;
        map[cName].address = emp.companyAddress || map[cName].address;
        map[cName].dept = emp.companyDept || map[cName].dept;
        map[cName].adminLightEmployees.push(emp.name);
      }
    });

    return Object.values(map);
  }, [employees]);

  const filteredCompanies = React.useMemo(() => {
    if (companyFilter === 'all') return companiesListComputed;
    return companiesListComputed.filter(c => c.name === companyFilter);
  }, [companiesListComputed, companyFilter]);
  const [appTitle, setAppTitle] = useState(() => {
    return localStorage.getItem('appTitle') || "Active Engineers Railway";
  });
  const [fbLink, setFbLink] = useState("https://www.facebook.com/share/19u6U4CPNy/");
  const [igLink, setIgLink] = useState("https://www.instagram.com/imran_ansari000_?igsh=MTRqdGpuNDc2OHV1bA==");
  const [webLink, setWebLink] = useState("#");
  const [tgLink, setTgLink] = useState("https://t.me/+0LJ53SSjdXFmZDk1");

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsAppTitle, setSettingsAppTitle] = useState("");
  const [settingsFbLink, setSettingsFbLink] = useState("");
  const [settingsIgLink, setSettingsIgLink] = useState("");
  const [settingsWebLink, setSettingsWebLink] = useState("");
  const [settingsTgLink, setSettingsTgLink] = useState("");

  const [newMachineInput, setNewMachineInput] = useState("");
  const [editingMachineIndex, setEditingMachineIndex] = useState<number | null>(null);
  const [editingMachineValue, setEditingMachineValue] = useState("");

  const [newEmployee, setNewEmployee] = useState({
    name: '',
    mobile: '',
    email: '',
    designation: '',
    address: '',
    doj: format(new Date(), 'yyyy-MM-dd'),
    dob: '',
    photoUrl: '',
    pfNo: '',
    esicNo: '',
    qualification: '',
    accessType: 'limited' as 'full' | 'limited' | 'admin-light',
    machineName: '',
    companyName: '',
    companyGst: '',
    companyMobile: '',
    companyEmail: '',
    companyAddress: '',
    companyDept: '',
    fatherName: '',
    age: '',
    sex: '',
    validityDate: '',
    bloodGroup: '',
    department: '',
    zone: '',
    division: '',
    idNo: '',
    aadharNo: '',
    panNo: '',
    accountNo: '',
    ifscCode: '',
    bankName: '',
    branch: '',
    employeeSigUrl: '',
    contractorSigUrl: '',
    railwaySigUrl: '',
    logoUrl: '',
    contractNo: '',
  });

  function calculateAgeInYears(dobString: string): string {
    if (!dobString) return 'N/A';
    try {
      const birthDate = new Date(dobString);
      if (isNaN(birthDate.getTime())) return 'N/A';
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age >= 0 ? String(age) : 'N/A';
    } catch (e) {
      return 'N/A';
    }
  }

  // Auto-calculate age for newEmployee
  useEffect(() => {
    if (!newEmployee.dob) {
      setNewEmployee(prev => ({ ...prev, age: 'N/A' }));
      return;
    }
    const ageY = calculateAgeInYears(newEmployee.dob);
    setNewEmployee(prev => ({ ...prev, age: ageY }));
  }, [newEmployee.dob]);

  // Auto-calculate age for editingEmployee
  useEffect(() => {
    if (!editingEmployee) return;
    if (!editingEmployee.dob) {
      setEditingEmployee(prev => prev ? ({ ...prev, age: 'N/A' }) : null);
      return;
    }
    const ageY = calculateAgeInYears(editingEmployee.dob);
    setEditingEmployee(prev => prev ? ({ ...prev, age: ageY }) : null);
  }, [editingEmployee?.dob]);

  // Dynamic Zone and Division resolver for newEmployee
  useEffect(() => {
    const machineName = newEmployee.machineName;
    const targetDate = newEmployee.doj || new Date().toISOString().split('T')[0];
    if (!machineName) {
      return;
    }

    let isSubscribed = true;

    async function resolvePosition() {
      try {
        const fallbackDoc = await getDoc(doc(db, 'machine_positions', machineName));
        let fallbackZone = '';
        let fallbackDivision = '';
        if (fallbackDoc.exists()) {
          fallbackZone = fallbackDoc.data().zone || '';
          fallbackDivision = fallbackDoc.data().division || '';
        }

        const q = query(collection(db, 'machine_movements'), where('machineName', '==', machineName));
        const snap = await getDocs(q);
        const movementsList: any[] = [];
        snap.forEach((d) => {
          movementsList.push({ id: d.id, ...d.data() });
        });

        if (!isSubscribed) return;

        // Sort movements by fromDateTime ascending to reconstruct history
        const sorted = [...movementsList].sort((a, b) => {
          const tA = a.fromDateTime || '';
          const tB = b.fromDateTime || '';
          return tA.localeCompare(tB);
        });

        let resolvedZone = fallbackZone || 'No Zone Assigned';
        let resolvedDivision = fallbackDivision || 'No Division Assigned';

        for (const m of sorted) {
          const depDate = (m.fromDateTime || '').split('T')[0];
          const reachDate = (m.toDateTime || '').split('T')[0];

          if (depDate && targetDate >= depDate) {
            if (reachDate && targetDate >= reachDate) {
              resolvedZone = m.toZone || resolvedZone;
              resolvedDivision = m.toDivision || resolvedDivision;
            } else {
              resolvedZone = m.fromZone || resolvedZone;
              resolvedDivision = m.fromDivision || resolvedDivision;
            }
          }
        }

        setNewEmployee(prev => ({
          ...prev,
          zone: resolvedZone,
          division: resolvedDivision,
          contractNo: prev.contractNo || (machineName ? (machineContractsMap[machineName] || '') : '')
        }));
      } catch (err) {
        console.error("Error resolving machine position for newEmployee:", err);
      }
    }

    resolvePosition();
    return () => {
      isSubscribed = false;
    };
  }, [newEmployee.machineName, newEmployee.doj]);

  // Dynamic Zone and Division resolver for editingEmployee
  useEffect(() => {
    if (!editingEmployee) return;
    const machineName = editingEmployee.machineName;
    const targetDate = editingEmployee.doj || new Date().toISOString().split('T')[0];
    if (!machineName) {
      return;
    }

    let isSubscribed = true;

    async function resolvePosition() {
      try {
        const fallbackDoc = await getDoc(doc(db, 'machine_positions', machineName));
        let fallbackZone = '';
        let fallbackDivision = '';
        if (fallbackDoc.exists()) {
          fallbackZone = fallbackDoc.data().zone || '';
          fallbackDivision = fallbackDoc.data().division || '';
        }

        const q = query(collection(db, 'machine_movements'), where('machineName', '==', machineName));
        const snap = await getDocs(q);
        const movementsList: any[] = [];
        snap.forEach((d) => {
          movementsList.push({ id: d.id, ...d.data() });
        });

        if (!isSubscribed) return;

        // Sort movements by fromDateTime ascending to reconstruct history
        const sorted = [...movementsList].sort((a, b) => {
          const tA = a.fromDateTime || '';
          const tB = b.fromDateTime || '';
          return tA.localeCompare(tB);
        });

        let resolvedZone = fallbackZone || 'No Zone Assigned';
        let resolvedDivision = fallbackDivision || 'No Division Assigned';

        for (const m of sorted) {
          const depDate = (m.fromDateTime || '').split('T')[0];
          const reachDate = (m.toDateTime || '').split('T')[0];

          if (depDate && targetDate >= depDate) {
            if (reachDate && targetDate >= reachDate) {
              resolvedZone = m.toZone || resolvedZone;
              resolvedDivision = m.toDivision || resolvedDivision;
            } else {
              resolvedZone = m.fromZone || resolvedZone;
              resolvedDivision = m.fromDivision || resolvedDivision;
            }
          }
        }

        setEditingEmployee(prev => prev ? ({
          ...prev,
          zone: resolvedZone,
          division: resolvedDivision,
          contractNo: prev.contractNo || (machineName ? (machineContractsMap[machineName] || '') : '')
        }) : null);
      } catch (err) {
        console.error("Error resolving machine position for editingEmployee:", err);
      }
    }

    resolvePosition();
    return () => {
      isSubscribed = false;
    };
  }, [editingEmployee?.machineName, editingEmployee?.doj]);

  // Create Company states
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [newCompanyData, setNewCompanyData] = useState({
    name: '',
    gst: '',
    mobile: '',
    email: '',
    address: '',
    dept: '',
    loginId: '',
    password: '',
  });

  const handleCreateCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyData.name || !newCompanyData.gst || !newCompanyData.loginId || !newCompanyData.password) {
      toast.error("Please fill in all required company details.");
      return;
    }
    setSubmitting(true);
    try {
      const { hashPassword } = await import('../utils/crypto');
      const loginIdClean = newCompanyData.loginId.trim().toLowerCase();
      const hashedPasswordVal = await hashPassword(newCompanyData.password, loginIdClean);

      // Create company admin-light employee document
      await addDoc(collection(db, 'employees'), {
        name: newCompanyData.name,
        mobile: newCompanyData.mobile,
        email: newCompanyData.email,
        designation: 'Company Administrator',
        address: newCompanyData.address,
        doj: new Date().toISOString().split('T')[0],
        dob: '',
        photoUrl: '',
        status: 'active',
        pfNo: `COMP-${loginIdClean.toUpperCase()}`,
        esicNo: '',
        accessType: 'admin-light',
        machineName: '',
        companyName: newCompanyData.name,
        companyGst: newCompanyData.gst,
        companyMobile: newCompanyData.mobile,
        companyEmail: newCompanyData.email,
        companyAddress: newCompanyData.address,
        companyDept: newCompanyData.dept,
        loginId: loginIdClean,
        password: hashedPasswordVal,
        firstTimeLogin: true,
      });

      toast.success(`Company ${newCompanyData.name} created successfully! Admin login ID is: ${newCompanyData.loginId}`);
      setShowCreateCompanyModal(false);
      setNewCompanyData({
        name: '',
        gst: '',
        mobile: '',
        email: '',
        address: '',
        dept: '',
        loginId: '',
        password: '',
      });
      fetchEmployees();
    } catch (error) {
      console.error("Error creating company:", error);
      toast.error("Failed to create company.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany || !editingCompany.companyName || !editingCompany.companyGst || !editingCompany.loginId || !editingCompany.password) {
      toast.error("Please fill in all required company details.");
      return;
    }
    setSubmitting(true);
    try {
      const originalEmp = employees.find(e => e.id === editingCompany.id);
      const originalCompanyName = originalEmp ? (originalEmp.companyName || '') : '';
      const newCompanyName = editingCompany.companyName;

      const { hashPassword, isHashedPassword } = await import('../utils/crypto');
      const loginIdClean = editingCompany.loginId.trim().toLowerCase();
      let finalPassword = editingCompany.password;
      if (!isHashedPassword(finalPassword)) {
        finalPassword = await hashPassword(finalPassword, loginIdClean || editingCompany.id);
      }

      const { doc, updateDoc, writeBatch, collection, query, where, getDocs } = await import('firebase/firestore');
      const empRef = doc(db, 'employees', editingCompany.id);
      const batch = writeBatch(db);

      batch.update(empRef, {
        name: newCompanyName,
        mobile: editingCompany.mobile || '',
        email: editingCompany.email || '',
        address: editingCompany.companyAddress || '',
        companyName: newCompanyName,
        companyGst: editingCompany.companyGst,
        companyMobile: editingCompany.mobile || '',
        companyEmail: editingCompany.email || '',
        companyAddress: editingCompany.companyAddress || '',
        companyDept: editingCompany.companyDept || '',
        loginId: loginIdClean,
        password: finalPassword,
      });

      if (originalCompanyName && originalCompanyName !== newCompanyName) {
        // Query other employees under the old company and update their companyName and GST
        const employeesRef = collection(db, 'employees');
        const empQuery = query(employeesRef, where('companyName', '==', originalCompanyName));
        const empDocs = await getDocs(empQuery);
        empDocs.forEach((d) => {
          if (d.id !== editingCompany.id) {
            batch.update(doc(db, 'employees', d.id), {
              companyName: newCompanyName,
              companyGst: editingCompany.companyGst,
            });
          }
        });

        // Query profile_requests for the old company and update their companyName
        const reqsRef = collection(db, 'profile_requests');
        const reqQuery = query(reqsRef, where('companyName', '==', originalCompanyName));
        const reqDocs = await getDocs(reqQuery);
        reqDocs.forEach((d) => {
          batch.update(doc(db, 'profile_requests', d.id), {
            companyName: newCompanyName
          });
        });
      }

      await batch.commit();

      toast.success(`Company ${newCompanyName} profile updated successfully!`);
      setEditingCompany(null);
      fetchEmployees();
    } catch (error) {
      console.error("Error editing company:", error);
      toast.error("Failed to update company profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCompany = async (companyName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete company "${companyName}"? All employees and profile update requests associated with this company will be deleted.`)) {
      return;
    }
    setSubmitting(true);
    try {
      const { collection, query, where, getDocs, doc, writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);

      // Query and delete all employees under this company
      const employeesRef = collection(db, 'employees');
      const empQuery = query(employeesRef, where('companyName', '==', companyName));
      const empDocs = await getDocs(empQuery);
      empDocs.forEach((d) => {
        batch.delete(doc(db, 'employees', d.id));
      });

      // Query and delete all profile requests under this company
      const reqsRef = collection(db, 'profile_requests');
      const reqQuery = query(reqsRef, where('companyName', '==', companyName));
      const reqDocs = await getDocs(reqQuery);
      reqDocs.forEach((d) => {
        batch.delete(doc(db, 'profile_requests', d.id));
      });

      await batch.commit();

      toast.success(`Company "${companyName}" and all associated data deleted successfully.`);
      fetchEmployees();
    } catch (error) {
      console.error("Error deleting company:", error);
      toast.error("Failed to delete company.");
    } finally {
      setSubmitting(false);
    }
  };

  // Admin Notification Modal states
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationTarget, setNotificationTarget] = useState('all');
  const [notifTargetType, setNotifTargetType] = useState('all'); // 'all', 'company', 'machine', 'employee', 'company-machine'
  const [notifTargetCompany, setNotifTargetCompany] = useState('all');
  const [notifTargetMachine, setNotifTargetMachine] = useState('all');
  const [notifTargetEmployeeId, setNotifTargetEmployeeId] = useState('all');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isEmp = user.email?.endsWith('@employee.billedapp.com') || false;
        setIsEmployee(isEmp);
        
        let hasFullAccess = !isEmp;
        if (isEmp && user.email) {
          try {
            const emp = await findEmployeeForUser(user.uid, user.email);
            if (emp) {
              hasFullAccess = emp.accessType === 'full' || emp.accessType === 'admin-light';
              setIsAdmin(hasFullAccess);
              setCurrentUserAccessType(emp.accessType || 'limited');
              setCurrentUserCompanyName(emp.companyName || '');
              setCurrentEmployeeId(emp.employeeId || '');
              const mName = emp.machineName || '';
              setUserMachine(mName);
              localStorage.setItem(`userMachineName_${user.uid}`, mName);
              localStorage.setItem(`accessType_${user.uid}`, emp.accessType || 'limited');
              localStorage.setItem(`companyName_${user.uid}`, emp.companyName || '');
            } else {
              setIsAdmin(false);
            }
          } catch (error) {
            console.error('Error verifying employee full access:', error);
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(true);
        }
        
        fetchEmployees(hasFullAccess);
        fetchPendingRequests(hasFullAccess);
      } else {
        setIsEmployee(false);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!showEditModal) {
      setSilentCorrection(false);
    }
  }, [showEditModal]);

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
        if (data.appTitle) {
          setAppTitle(data.appTitle);
          localStorage.setItem('appTitle', data.appTitle);
        }
        if (data.fbLink !== undefined) setFbLink(data.fbLink);
        if (data.igLink !== undefined) setIgLink(data.igLink);
        if (data.webLink !== undefined) setWebLink(data.webLink);
        if (data.tgLink !== undefined) setTgLink(data.tgLink);
        if (data.batchLogo !== undefined) {
          setBatchLogo(data.batchLogo || '');
          if (data.batchLogo) {
            localStorage.setItem('batchLogo', data.batchLogo);
          } else {
            localStorage.removeItem('batchLogo');
          }
        }
        if (data.demandLogo !== undefined) {
          setDemandLogo(data.demandLogo || '');
          if (data.demandLogo) {
            localStorage.setItem('demandLogo', data.demandLogo);
          } else {
            localStorage.removeItem('demandLogo');
          }
        }
        if (data.batchContractorSig !== undefined) {
          setBatchContractorSig(data.batchContractorSig || '');
          if (data.batchContractorSig) {
            localStorage.setItem('batchContractorSig', data.batchContractorSig);
          } else {
            localStorage.removeItem('batchContractorSig');
          }
        }
        if (data.batchRailwaySig !== undefined) {
          setBatchRailwaySig(data.batchRailwaySig || '');
          if (data.batchRailwaySig) {
            localStorage.setItem('batchRailwaySig', data.batchRailwaySig);
          } else {
            localStorage.removeItem('batchRailwaySig');
          }
        }
        if (data.template2Logo !== undefined) {
          setTemplate2Logo(data.template2Logo || '');
          if (data.template2Logo) {
            localStorage.setItem('template2Logo', data.template2Logo);
          } else {
            localStorage.removeItem('template2Logo');
          }
        }
      } else {
        // Create default settings if not exists
        setDoc(doc(db, 'settings', 'general'), {
          appTitle: "Active Engineers Railway",
          machines: ["MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"],
          fbLink: "https://www.facebook.com/share/19u6U4CPNy/",
          igLink: "https://www.instagram.com/imran_ansari000_?igsh=MTRqdGpuNDc2OHV1bA==",
          webLink: "#",
          tgLink: "https://t.me/+0LJ53SSjdXFmZDk1",
          batchLogo: "",
          batchContractorSig: "",
          batchRailwaySig: ""
        }).catch(err => console.error("Error creating default settings:", err));
      }
    }, (error) => {
      console.warn("Failed to listen to general settings in HR:", error);
    });

    return () => unsubscribeSettings();
  }, []);

  const fetchEmployees = async (hasFullAccessOverride?: boolean) => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'employees'));
      let empList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      
      const fullAccess = hasFullAccessOverride !== undefined ? hasFullAccessOverride : isAdmin;
      
      // If the logged in user is an employee and doesn't have full access, do not show admin/non-employee data in the list
      if (isEmployee && !fullAccess) {
        empList = empList.filter(emp => emp.email && emp.email.endsWith('@employee.billedapp.com'));
      }

      // Extract custom machine names dynamically
      const uniqueMachines = Array.from(new Set(empList.map(e => e.machineName).filter((m): m is string => !!m)));
      const extraMachines = uniqueMachines.filter(m => !machinesList.includes(m));
      setCustomMachines(extraMachines);
      
      setEmployees(empList);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees.');
      handleFirestoreError(error, OperationType.LIST, 'employees');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequests = async (hasFullAccessOverride?: boolean) => {
    try {
      const q = query(collection(db, 'profile_requests'), where('status', '==', 'pending'));
      const querySnapshot = await getDocs(q);
      let reqList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const fullAccess = hasFullAccessOverride !== undefined ? hasFullAccessOverride : isAdmin;
      
      // Filter out admin profile requests if logged in user is an employee without full access
      if (isEmployee && !fullAccess) {
        reqList = reqList.filter((req: any) => req.email && req.email.endsWith('@employee.billedapp.com'));
      }
      
      setProfileRequests(reqList);
    } catch (error) {
      console.error('Error fetching profile requests:', error);
      handleFirestoreError(error, OperationType.LIST, 'profile_requests');
    }
  };

  const handleApproveRequest = async (request: any) => {
    try {
      // 1. Update the employee document with all fields to prevent data erasure
      const empRef = doc(db, 'employees', request.employeeId);
      await updateDoc(empRef, {
        name: request.name,
        mobile: request.mobile,
        email: request.email,
        designation: request.designation,
        address: request.address,
        dob: request.dob || '',
        pfNo: request.pfNo || '',
        esicNo: request.esicNo || '',
        doj: request.doj || '',
        photoUrl: request.photoUrl || '',
        employeeSigUrl: request.employeeSigUrl || '',
        
        // Extended full form fields
        fatherName: request.fatherName || '',
        age: request.age || '',
        sex: request.sex || request.gender || '',
        validityDate: request.validityDate || '',
        department: request.department || '',
        idNo: request.idNo || '',
        aadharNo: request.aadharNo || '',
        panNo: request.panNo || '',
        accountNo: request.accountNo || '',
        ifscCode: request.ifscCode || '',
        bankName: request.bankName || '',
        branch: request.branch || '',
        zone: request.zone || '',
        division: request.division || '',
      });

      // 2. Also update their user profile in 'users' collection
      if (request.uid) {
        const userRef = doc(db, 'users', request.uid);
        await setDoc(userRef, {
          name: request.name,
          email: request.email,
          mobile: request.mobile,
          designation: request.designation,
          gender: request.gender || 'Male',
          address: request.address,
        }, { merge: true });
      }

      // 3. Mark the request as approved
      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        forwardedToCompanyAdmin: false,
      });

      // 4. Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Approved',
          message: `Your profile update request has been approved by the admin.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // 5. Add to Action History Reports
      const user = auth.currentUser;
      const performerName = employees.find(e => e.id === currentEmployeeId || e.employeeId === currentEmployeeId)?.name || user?.email || 'Admin';
      const performerEmail = user?.email || '';
      await addDoc(collection(db, 'demand_logs'), {
        demandId: request.id,
        plNo: request.pfNo ? `PF: ${request.pfNo}` : 'PROFILE',
        partNo: request.designation || 'Profile Update',
        description: `Profile Update Request for ${request.name}`,
        action: 'APPROVAL',
        remark: 'Approved profile update request.',
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString()
      });

      toast.success(`Profile update for ${request.name} approved successfully!`);
      
      // Dispatch layout event to refresh any layout elements instantly
      window.dispatchEvent(new Event('profile-updated'));

      fetchEmployees();
      fetchPendingRequests();
    } catch (error) {
      console.error('Error approving profile request:', error);
      toast.error('Failed to approve profile update.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleRejectRequest = async (request: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim();
      if (!remarks) {
        toast.error('Please enter a reason/remarks for rejecting this request.');
        return;
      }

      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        remarks: remarks,
        forwardedToCompanyAdmin: false,
      });

      // Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Rejected',
          message: `Your profile update request has been rejected. Reason: ${remarks}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'rejection'
        });
      }

      // Add to Action History Reports
      const user = auth.currentUser;
      const performerName = employees.find(e => e.id === currentEmployeeId || e.employeeId === currentEmployeeId)?.name || user?.email || 'Admin';
      const performerEmail = user?.email || '';
      await addDoc(collection(db, 'demand_logs'), {
        demandId: request.id,
        plNo: request.pfNo ? `PF: ${request.pfNo}` : 'PROFILE',
        partNo: request.designation || 'Profile Update',
        description: `Profile Update Request for ${request.name}`,
        action: 'REJECT',
        remark: remarks,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString()
      });

      toast.success('Profile update request rejected.');
      fetchPendingRequests();
    } catch (error) {
      console.error('Error rejecting profile request:', error);
      toast.error('Failed to reject profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleReturnRequest = async (request: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim();
      if (!remarks) {
        toast.error('Please enter a reason/remarks for returning this request.');
        return;
      }

      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'returned',
        remarks: remarks,
        returnedAt: new Date().toISOString(),
        forwardedToCompanyAdmin: false,
      });

      // Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Returned',
          message: `Your profile update request was returned for correction. Reason: ${remarks}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'rejection'
        });
      }

      // Add to Action History Reports
      const user = auth.currentUser;
      const performerName = employees.find(e => e.id === currentEmployeeId || e.employeeId === currentEmployeeId)?.name || user?.email || 'Admin';
      const performerEmail = user?.email || '';
      await addDoc(collection(db, 'demand_logs'), {
        demandId: request.id,
        plNo: request.pfNo ? `PF: ${request.pfNo}` : 'PROFILE',
        partNo: request.designation || 'Profile Update',
        description: `Profile Update Request for ${request.name}`,
        action: 'RETURN',
        remark: remarks,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString()
      });

      toast.success('Profile update request returned to employee for corrections.');
      fetchPendingRequests();
    } catch (error) {
      console.error('Error returning profile request:', error);
      toast.error('Failed to return profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleForwardRequest = async (request: any, targetEmployee: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim() || '';
      const reqRef = doc(db, 'profile_requests', request.id);
      
      // Determine company context of the employee requesting profile changes
      const empRecord = employees.find(e => e.pfNo === request.pfNo || e.employeeId === request.employeeId);
      const companyName = empRecord?.companyName || request.companyName || '';

      await updateDoc(reqRef, {
        forwardedTo: targetEmployee.id,
        forwardedToName: targetEmployee.name,
        forwardedToEmail: targetEmployee.email || '',
        forwardedToAdmin: targetEmployee.accessType === 'full' ? true : false,
        forwardedToCompanyAdmin: targetEmployee.accessType === 'admin-light' ? true : false,
        companyName: companyName,
        forwardedAt: new Date().toISOString(),
        remarks: remarks || request.remarks || ''
      });

      // Create a notification for the user about forwarding
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Forwarded',
          message: `Your profile update request was forwarded to ${targetEmployee.name} for review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // Create a notification for the recipient employee as well!
      if (targetEmployee.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: targetEmployee.email,
          title: 'Profile Request Forwarded to You',
          message: `A profile update request for ${request.name} has been forwarded to you by ${auth.currentUser?.email || 'an Admin'} for review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // Add to Action History Reports
      const user = auth.currentUser;
      const performerName = employees.find(e => e.id === currentEmployeeId || e.employeeId === currentEmployeeId)?.name || user?.email || 'Admin';
      const performerEmail = user?.email || '';
      await addDoc(collection(db, 'demand_logs'), {
        demandId: request.id,
        plNo: request.pfNo ? `PF: ${request.pfNo}` : 'PROFILE',
        partNo: request.designation || 'Profile Update',
        description: `Profile Update Request for ${request.name}`,
        action: 'FORWARD',
        remark: remarks || 'Forwarded for review.',
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString(),
        newForwardedToName: targetEmployee.name
      });

      toast.success(`Profile update request forwarded to ${targetEmployee.name} successfully!`);
      fetchPendingRequests();
    } catch (error) {
      console.error('Error forwarding profile request:', error);
      toast.error('Failed to forward profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const getChangeDiff = (request: any) => {
    const original = employees.find(emp => emp.id === request.employeeId);
    if (!original) return null;

    const changes = [];
    if (original.name !== request.name) {
      changes.push({ label: 'Name', oldVal: original.name, newVal: request.name });
    }
    if (original.mobile !== request.mobile) {
      changes.push({ label: 'Mobile', oldVal: original.mobile, newVal: request.mobile });
    }
    if (original.designation !== request.designation) {
      changes.push({ label: 'Designation', oldVal: original.designation, newVal: request.designation });
    }
    if ((original.address || '') !== (request.address || '')) {
      changes.push({ label: 'Address', oldVal: original.address || 'None', newVal: request.address || 'None' });
    }
    if ((original.dob || '') !== (request.dob || '')) {
      changes.push({ label: 'DOB', oldVal: original.dob || 'None', newVal: request.dob || 'None' });
    }
    if ((original.pfNo || '') !== (request.pfNo || '')) {
      changes.push({ label: 'PF Number', oldVal: original.pfNo || 'None', newVal: request.pfNo || 'None' });
    }
    if ((original.esicNo || '') !== (request.esicNo || '')) {
      changes.push({ label: 'ESIC Number', oldVal: original.esicNo || 'None', newVal: request.esicNo || 'None' });
    }
    if (original.doj !== request.doj) {
      changes.push({ label: 'Date of Joining', oldVal: original.doj, newVal: request.doj });
    }
    if ((original.photoUrl || '') !== (request.photoUrl || '')) {
      changes.push({ 
        label: 'Photo', 
        oldVal: 'Old Photo', 
        newVal: 'New Photo', 
        isPhoto: true, 
        oldPhoto: original.photoUrl, 
        newPhoto: request.photoUrl 
      });
    }
    if ((original.employeeSigUrl || '') !== (request.employeeSigUrl || '')) {
      changes.push({ 
        label: 'Signature', 
        oldVal: 'Old Signature', 
        newVal: 'New Signature', 
        isPhoto: true, 
        isSignature: true, 
        oldPhoto: original.employeeSigUrl, 
        newPhoto: request.employeeSigUrl 
      });
    }

    return changes;
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 50 * 1024) {
      toast.error('Image size must be less than 50KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          if (isEdit) {
            setEditingEmployee(prev => prev ? { ...prev, photoUrl: compressedBase64 } : null);
          } else {
            setNewEmployee(prev => ({ ...prev, photoUrl: compressedBase64 }));
          }
          toast.success('Photo uploaded and processed successfully');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSignatureUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'employee' | 'contractor' | 'railway' | 'logo',
    isEdit = false
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 100 * 1024) {
      toast.error('Signature size must be less than 100KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 250;
        const MAX_HEIGHT = 100;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/png'); // Preserve transparency for signatures
          
          if (type === 'employee') {
            if (isEdit) {
              setEditingEmployee(prev => prev ? { ...prev, employeeSigUrl: compressedBase64 } : null);
            } else {
              setNewEmployee(prev => ({ ...prev, employeeSigUrl: compressedBase64 }));
            }
          } else if (type === 'contractor') {
            if (isEdit) {
              setEditingEmployee(prev => prev ? { ...prev, contractorSigUrl: compressedBase64 } : null);
            } else {
              setNewEmployee(prev => ({ ...prev, contractorSigUrl: compressedBase64 }));
            }
          } else if (type === 'railway') {
            if (isEdit) {
              setEditingEmployee(prev => prev ? { ...prev, railwaySigUrl: compressedBase64 } : null);
            } else {
              setNewEmployee(prev => ({ ...prev, railwaySigUrl: compressedBase64 }));
            }
          } else if (type === 'logo') {
            if (isEdit) {
              setEditingEmployee(prev => prev ? { ...prev, logoUrl: compressedBase64 } : null);
            } else {
              setNewEmployee(prev => ({ ...prev, logoUrl: compressedBase64 }));
            }
          }
          toast.success('Asset uploaded and processed successfully');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const addMachineToConfigIfNeeded = async (machineName: string) => {
    if (!machineName) return;
    if (!machinesList.includes(machineName)) {
      try {
        const updatedList = [...machinesList, machineName];
        await setDoc(doc(db, 'settings', 'general'), {
          machines: updatedList
        }, { merge: true });
      } catch (error) {
        console.error("Error auto-adding custom machine to settings:", error);
      }
    }
  };

  const handleSaveAppTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsAppTitle.trim()) {
      toast.error("App title cannot be empty.");
      return;
    }
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        appTitle: settingsAppTitle.trim()
      }, { merge: true });
      toast.success("App Title updated successfully!");
    } catch (error) {
      console.error("Error saving app title:", error);
      toast.error("Failed to update app title.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveFooterLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        fbLink: settingsFbLink.trim(),
        igLink: settingsIgLink.trim(),
        webLink: settingsWebLink.trim(),
        tgLink: settingsTgLink.trim()
      }, { merge: true });
      toast.success("Footer links updated successfully!");
    } catch (error) {
      console.error("Error saving footer links:", error);
      toast.error("Failed to update footer links.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachineInput.trim()) {
      toast.error("Machine name cannot be empty.");
      return;
    }
    const val = newMachineInput.trim();
    if (machinesList.includes(val)) {
      toast.error("Machine name already exists.");
      return;
    }
    const updated = [...machinesList, val];
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });
      setNewMachineInput("");
      toast.success("Machine added successfully!");
    } catch (error) {
      console.error("Error adding machine:", error);
      toast.error("Failed to add machine.");
    }
  };

  const handleEditMachineSave = async (index: number) => {
    if (!editingMachineValue.trim()) {
      toast.error("Machine name cannot be empty.");
      return;
    }
    const val = editingMachineValue.trim();
    if (machinesList.includes(val) && machinesList[index] !== val) {
      toast.error("Machine name already exists.");
      return;
    }
    const oldVal = machinesList[index];
    const updated = [...machinesList];
    updated[index] = val;
    setSubmitting(true);
    try {
      // 1. Update general settings
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });

      // 2. Cascade rename to collections if the name changed
      if (oldVal && oldVal !== val) {
        const { writeBatch, query, collection, where, getDocs } = await import('firebase/firestore');
        const batch = writeBatch(db);

        // Update employees
        const empsSnap = await getDocs(query(collection(db, 'employees'), where('machineName', '==', oldVal)));
        empsSnap.forEach((d) => {
          batch.update(doc(db, 'employees', d.id), { machineName: val });
        });

        // Update parts
        const partsSnap = await getDocs(query(collection(db, 'parts'), where('machineName', '==', oldVal)));
        partsSnap.forEach((d) => {
          batch.update(doc(db, 'parts', d.id), { machineName: val });
        });

        // Update demands
        const demandsSnap = await getDocs(query(collection(db, 'demands'), where('machineName', '==', oldVal)));
        demandsSnap.forEach((d) => {
          batch.update(doc(db, 'demands', d.id), { machineName: val });
        });

        await batch.commit();
        toast.success(`Machine renamed and changes propagated to associated records!`);
      } else {
        toast.success("Machine updated successfully!");
      }

      setEditingMachineIndex(null);
      setEditingMachineValue("");
      fetchEmployees();
    } catch (error) {
      console.error("Error updating machine:", error);
      toast.error("Failed to update machine.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMachine = async (index: number) => {
    if (!window.confirm("Are you sure you want to delete this machine?")) return;
    const updated = machinesList.filter((_, idx) => idx !== index);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });
      toast.success("Machine deleted successfully!");
    } catch (error) {
      console.error("Error deleting machine:", error);
      toast.error("Failed to delete machine.");
    }
  };

  const checkAndAutofillPfNo = (pfVal: string) => {
    if (!pfVal) return;
    const cleanPf = pfVal.trim().toUpperCase();
    if (cleanPf.length < 3) return;
    
    const match = employees.find(e => e.pfNo?.trim().toUpperCase() === cleanPf);
    if (match) {
      const joinDate = match.doj ? new Date(match.doj) : null;
      const exitDate = match.doe ? new Date(match.doe) : (match.status === 'left' ? new Date() : null);
      let days = 0;
      if (joinDate && exitDate) {
        const diffTime = Math.abs(exitDate.getTime() - joinDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      } else if (joinDate) {
        const diffTime = Math.abs(new Date().getTime() - joinDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      setNewEmployee(prev => ({
        ...prev,
        name: match.name || prev.name,
        mobile: match.mobile || prev.mobile,
        email: match.email || prev.email,
        designation: match.designation || prev.designation,
        address: match.address || prev.address,
        dob: match.dob || prev.dob,
        photoUrl: match.photoUrl || prev.photoUrl,
        qualification: match.qualification || prev.qualification,
        fatherName: match.fatherName || prev.fatherName,
        esicNo: match.esicNo || prev.esicNo,
        employmentHistory: [
          ...(match.employmentHistory || []),
          {
            companyName: match.companyName || 'Previous Company',
            designation: match.designation || 'Employee',
            doj: match.doj || '',
            leftDate: match.doe || new Date().toISOString().split('T')[0],
            status: 'left'
          }
        ]
      }));

      setAutofillMessage(`✨ Previous profile loaded! Worked at "${match.companyName || 'Previous Company'}" for ${days} days (${match.doj || 'N/A'} to ${match.doe || 'N/A'}).`);
      toast.success("Previous employee profile loaded and career history updated!");
    } else {
      setAutofillMessage(null);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      const canSelectMachine = !isEmployee || currentUserAccessType === 'full' || currentUserAccessType === 'admin-light';
      const machineToAssign = canSelectMachine ? newEmployee.machineName : userMachine;
      if (machineToAssign) {
        await addMachineToConfigIfNeeded(machineToAssign);
      }
      
      const finalCompanyName = isEmployee ? currentUserCompanyName : newEmployee.companyName;

      let finalZone = newEmployee.zone || '';
      let finalDivision = newEmployee.division || '';
      let initialZoneDivisionHistory: any[] = [
        {
          zone: finalZone || 'N/A',
          division: finalDivision || 'N/A',
          machineName: machineToAssign || 'General',
          companyName: finalCompanyName || 'General',
          fromDateTime: newEmployee.doj || new Date().toISOString().split('T')[0],
          toDateTime: 'Ongoing',
          updatedAt: new Date().toISOString()
        }
      ];

      const finalContractNo = newEmployee.contractNo || (machineToAssign ? (machineContractsMap[machineToAssign] || '') : '');

      await addDoc(collection(db, 'employees'), {
        ...newEmployee,
        contractNo: finalContractNo,
        companyName: finalCompanyName || '',
        machineName: machineToAssign || '',
        accessType: newEmployee.accessType || 'limited',
        status: 'active',
        zone: finalZone,
        division: finalDivision,
        zoneDivisionHistory: initialZoneDivisionHistory
      });
      toast.success('Employee added successfully');
      setShowAddModal(false);
      fetchEmployees();
      setNewEmployee({
        name: '',
        mobile: '',
        email: '',
        designation: '',
        address: '',
        doj: format(new Date(), 'yyyy-MM-dd'),
        dob: '',
        photoUrl: '',
        pfNo: '',
        esicNo: '',
        qualification: '',
        accessType: 'limited' as 'full' | 'limited' | 'admin-light',
        machineName: '',
        companyName: '',
        companyGst: '',
        companyMobile: '',
        companyEmail: '',
        companyAddress: '',
        companyDept: '',
        fatherName: '',
        age: '',
        sex: '',
        validityDate: '',
        bloodGroup: '',
        department: '',
        zone: '',
        division: '',
        idNo: '',
        aadharNo: '',
        panNo: '',
        accountNo: '',
        ifscCode: '',
        bankName: '',
        branch: '',
        employeeSigUrl: '',
        contractorSigUrl: '',
        railwaySigUrl: '',
        logoUrl: '',
        contractNo: '',
      });
      setAutofillMessage(null);
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
    } catch (error) {
      console.error('Error adding employee:', error);
      toast.error('Failed to add employee. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      const empRef = doc(db, 'employees', editingEmployee.id);
      const canSelectMachine = !isEmployee || currentUserAccessType === 'full' || currentUserAccessType === 'admin-light';
      const machineToAssign = canSelectMachine ? editingEmployee.machineName : userMachine;
      if (machineToAssign) {
        await addMachineToConfigIfNeeded(machineToAssign);
      }

      const originalEmployee = employees.find(e => e.id === editingEmployee.id);
      let updatedDesignationHistory = editingEmployee.designationHistory || [];
      
      const isSilent = !isEmployee && silentCorrection;
      if (originalEmployee && originalEmployee.designation !== editingEmployee.designation && !isSilent) {
        let periodStart = originalEmployee.doj || '';
        if (originalEmployee.designationHistory && originalEmployee.designationHistory.length > 0) {
          const lastHistory = originalEmployee.designationHistory[originalEmployee.designationHistory.length - 1];
          if (lastHistory.updatedAt) {
            periodStart = lastHistory.updatedAt;
          }
        }
        
        const periodEnd = new Date().toISOString().split('T')[0];
        
        const historyEntry = {
          oldDesignation: originalEmployee.designation,
          newDesignation: editingEmployee.designation,
          updatedAt: periodEnd,
          type: designationChangeType,
          periodStart: periodStart,
          periodEnd: periodEnd,
        };
        
        updatedDesignationHistory = [...updatedDesignationHistory, historyEntry];
      }

      let finalZone = editingEmployee.zone || '';
      let finalDivision = editingEmployee.division || '';
      const finalMachine = machineToAssign || 'General';
      const finalCompany = editingEmployee.companyName || '';

      let updatedZoneDivisionHistory = [...((originalEmployee as any)?.zoneDivisionHistory || [])];

      const origZone = originalEmployee?.zone || '';
      const origDivision = originalEmployee?.division || '';
      const origMachine = originalEmployee?.machineName || 'General';
      const origCompany = originalEmployee?.companyName || '';

      const hasZoneChanged = finalZone !== origZone;
      const hasDivisionChanged = finalDivision !== origDivision;
      const hasMachineChanged = finalMachine !== origMachine;
      const hasCompanyChanged = finalCompany !== origCompany;

      if (hasZoneChanged || hasDivisionChanged || hasMachineChanged || hasCompanyChanged) {
        const currentDateStr = new Date().toISOString().split('T')[0];

        // If the history is empty, initialize it with the original state starting from DOJ
        if (updatedZoneDivisionHistory.length === 0) {
          updatedZoneDivisionHistory.push({
            zone: origZone || 'N/A',
            division: origDivision || 'N/A',
            machineName: origMachine || 'General',
            companyName: origCompany || 'General',
            fromDateTime: originalEmployee?.doj || currentDateStr,
            toDateTime: currentDateStr,
            updatedAt: new Date().toISOString()
          });
        } else {
          // Close the last active entry
          const ongoingIndex = updatedZoneDivisionHistory.findIndex(h => h.toDateTime === 'Ongoing');
          if (ongoingIndex !== -1) {
            updatedZoneDivisionHistory[ongoingIndex] = {
              ...updatedZoneDivisionHistory[ongoingIndex],
              toDateTime: currentDateStr
            };
          } else {
            const lastIdx = updatedZoneDivisionHistory.length - 1;
            if (lastIdx >= 0) {
              updatedZoneDivisionHistory[lastIdx] = {
                ...updatedZoneDivisionHistory[lastIdx],
                toDateTime: currentDateStr
              };
            }
          }
        }

        // Add the new record
        updatedZoneDivisionHistory.push({
          zone: finalZone || 'N/A',
          division: finalDivision || 'N/A',
          machineName: finalMachine,
          companyName: finalCompany || 'General',
          fromDateTime: currentDateStr,
          toDateTime: 'Ongoing',
          updatedAt: new Date().toISOString()
        });
      }

      await updateDoc(empRef, {
        name: editingEmployee.name,
        mobile: editingEmployee.mobile,
        email: editingEmployee.email,
        designation: editingEmployee.designation,
        designationHistory: updatedDesignationHistory,
        address: editingEmployee.address || '',
        doj: editingEmployee.doj,
        dob: editingEmployee.dob || '',
        photoUrl: editingEmployee.photoUrl || '',
        pfNo: editingEmployee.pfNo || '',
        esicNo: editingEmployee.esicNo || '',
        qualification: editingEmployee.qualification || '',
        accessType: editingEmployee.accessType || 'limited',
        machineName: machineToAssign || '',
        companyName: editingEmployee.companyName || '',
        companyGst: editingEmployee.companyGst || '',
        companyMobile: editingEmployee.companyMobile || '',
        companyEmail: editingEmployee.companyEmail || '',
        companyAddress: editingEmployee.companyAddress || '',
        companyDept: editingEmployee.companyDept || '',
        fatherName: editingEmployee.fatherName || '',
        age: editingEmployee.age || '',
        sex: editingEmployee.sex || '',
        validityDate: editingEmployee.validityDate || '',
        bloodGroup: editingEmployee.bloodGroup || '',
        department: editingEmployee.department || '',
        zone: finalZone,
        division: finalDivision,
        zoneDivisionHistory: updatedZoneDivisionHistory,
        idNo: editingEmployee.idNo || '',
        aadharNo: editingEmployee.aadharNo || '',
        panNo: editingEmployee.panNo || '',
        accountNo: editingEmployee.accountNo || '',
        ifscCode: editingEmployee.ifscCode || '',
        bankName: editingEmployee.bankName || '',
        branch: editingEmployee.branch || '',
        employeeSigUrl: editingEmployee.employeeSigUrl || '',
        contractorSigUrl: editingEmployee.contractorSigUrl || '',
        railwaySigUrl: editingEmployee.railwaySigUrl || '',
        logoUrl: editingEmployee.logoUrl || '',
        contractNo: editingEmployee.contractNo || (machineToAssign ? (machineContractsMap[machineToAssign] || '') : ''),
      });

      // Sync accessType to 'users' collection if a user document exists with this email or employeeId
      try {
        let usersSnap = await getDocs(query(collection(db, 'users'), where('employeeId', '==', editingEmployee.id)));
        if (usersSnap.empty) {
          usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', editingEmployee.email)));
        }
        if (!usersSnap.empty) {
          const userDoc = usersSnap.docs[0];
          await updateDoc(doc(db, 'users', userDoc.id), {
            accessType: editingEmployee.accessType || 'limited'
          });
        }
      } catch (err) {
        console.error('Error syncing accessType to users:', err);
      }

      toast.success('Employee updated successfully');
      setShowEditModal(false);
      fetchEmployees();
    } catch (error) {
      console.error('Error updating employee:', error);
      toast.error('Failed to update employee.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveHistoryEntry = (employeeId: string, entryIndex: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete History Entry",
      message: "Are you sure you want to remove this history entry from this employee's career history?",
      onConfirm: async () => {
        try {
          const emp = employees.find(e => e.id === employeeId) || selectedEmployee;
          if (!emp || emp.id !== employeeId) {
            toast.error("Employee data not found.");
            return;
          }
          
          const updatedHistory = [...(emp.designationHistory || [])];
          updatedHistory.splice(entryIndex, 1);
          
          await updateDoc(doc(db, 'employees', employeeId), {
            designationHistory: updatedHistory
          });
          
          // Update selectedEmployee state so the UI updates immediately
          if (selectedEmployee && selectedEmployee.id === employeeId) {
            setSelectedEmployee({
              ...selectedEmployee,
              designationHistory: updatedHistory
            });
          }
          
          // Refresh employees list
          fetchEmployees();
          toast.success("History entry removed successfully!");
        } catch (error) {
          console.error("Error removing designation history entry:", error);
          toast.error("Failed to remove history entry.");
        }
      }
    });
  };

  const handleCreateNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notificationTitle || !notificationMessage) {
      toast.error('Please enter a title and message.');
      return;
    }
    setSubmitting(true);
    try {
      const notifData: any = {
        isMaster: true,
        title: notificationTitle,
        message: notificationMessage,
        createdAt: new Date().toISOString(),
        type: 'announcement',
        createdByUid: auth.currentUser?.uid || '',
        createdByAccessType: currentUserAccessType,
        createdByMachine: userMachine,
        createdByCompany: currentUserCompanyName,
      };

      if (!isEmployee) {
        // Main Admin:
        // "admin create company, machine & employee wise notifications create kar sake"
        notifData.createdByAccessType = 'admin';
        
        if (notifTargetType === 'company') {
          notifData.targetCompany = notifTargetCompany;
          notifData.targetMachine = 'all';
          notifData.targetEmployeeId = 'all';
        } else if (notifTargetType === 'machine') {
          notifData.targetCompany = 'all';
          notifData.targetMachine = notifTargetMachine;
          notifData.targetEmployeeId = 'all';
        } else if (notifTargetType === 'employee') {
          notifData.targetCompany = 'all';
          notifData.targetMachine = 'all';
          notifData.targetEmployeeId = notifTargetEmployeeId;
        } else if (notifTargetType === 'company-machine') {
          notifData.targetCompany = notifTargetCompany;
          notifData.targetMachine = notifTargetMachine;
          notifData.targetEmployeeId = 'all';
        } else {
          // 'all'
          notifData.targetCompany = 'all';
          notifData.targetMachine = 'all';
          notifData.targetEmployeeId = 'all';
        }
      } else if (currentUserAccessType === 'admin-light') {
        // Admin Light Company:
        // "aur admin light company create kare to us company me jitne bhe employee hai usko show kare or admin ko bhe aur company ko machine wise bhe notificaton create kar sake"
        notifData.createdByAccessType = 'admin-light';
        notifData.createdByCompany = currentUserCompanyName;

        if (notifTargetType === 'machine') {
          notifData.targetMachine = notifTargetMachine;
        } else {
          notifData.targetMachine = 'all';
        }
      } else if (currentUserAccessType === 'full') {
        // Full Access Admin:
        // "Full access admin jab notification create kare to uska notifications only us machine ke employee ko show kare or admin light company, Admin ko show kare"
        notifData.createdByAccessType = 'full';
        notifData.createdByMachine = userMachine;
      }

      await addDoc(collection(db, 'notifications'), notifData);
      toast.success('Notification created and queued for targeting successfully!');

      setShowNotificationModal(false);
      setNotificationTitle('');
      setNotificationMessage('');
      setNotifTargetType('all');
      setNotifTargetCompany('all');
      setNotifTargetMachine('all');
      setNotifTargetEmployeeId('all');
    } catch (error) {
      console.error('Error creating notification:', error);
      toast.error('Failed to send notification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExitEmployee = async () => {
    if (!selectedEmployee) return;
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'employees', selectedEmployee.id), {
        status: 'left',
        doe: exitDate,
      });
      toast.success('Employee status updated');
      setShowExitModal(false);
      fetchEmployees();
    } catch (error) {
      console.error('Error updating employee status:', error);
      toast.error('Failed to update employee status.');
    } finally {
      setSubmitting(false);
    }
  };

  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) || '' : '';
  });

  const canSelectMachine = !isEmployee || currentUserAccessType === 'full' || currentUserAccessType === 'admin-light';

  const filteredEmployees = employees.filter(emp => {
    // Exclude admin-light (Company Accounts) from regular employee list
    if (emp.accessType === 'admin-light') return false;

    // 1. If logged-in user is admin-light (Company Admin)
    if (isEmployee && currentUserAccessType === 'admin-light') {
      const companyMatches = emp.companyName === currentUserCompanyName;
      if (!companyMatches) return false;
      
      if (selectedMachine !== 'all' && emp.machineName !== selectedMachine) {
        return false;
      }
      if (selectedZone !== 'all' && emp.zone !== selectedZone) {
        return false;
      }
      if (selectedDivision !== 'all' && emp.division !== selectedDivision) {
        return false;
      }
      return true;
    }
    
    // 2. If logged-in user is a non-admin-light employee
    if (isEmployee) {
      if (currentUserCompanyName) {
        if (emp.companyName !== currentUserCompanyName) return false;
      }
      if (userMachine) {
        if (emp.machineName !== userMachine) return false;
      }
    }
    
    // 3. If master admin (Top-Level Admin), apply dropdown filters
    if (!isEmployee) {
      if (selectedMachine !== 'all' && emp.machineName !== selectedMachine) {
        return false;
      }
      if (selectedCompany !== 'all' && emp.companyName !== selectedCompany) {
        return false;
      }
      if (selectedZone !== 'all' && emp.zone !== selectedZone) {
        return false;
      }
      if (selectedDivision !== 'all' && emp.division !== selectedDivision) {
        return false;
      }
    }
    return true;
  });

  const filteredProfileRequests = profileRequests.filter(req => {
    // If specifically forwarded to current employee (by ID or Email)
    const isForwardedToMe = req.forwardedTo === currentEmployeeId || (auth.currentUser?.email && req.forwardedToEmail?.toLowerCase() === auth.currentUser.email.toLowerCase());
    if (isForwardedToMe && req.status === 'pending') return true;

    // 1. If logged-in user is an employee with admin-light access (Company Admin)
    if (isEmployee && currentUserAccessType === 'admin-light') {
      return (req.forwardedToCompanyAdmin === true || req.isFullAccessAdmin === true) && 
             req.companyName === currentUserCompanyName && 
             req.status === 'pending';
    }
    // 2. If logged-in user is an employee with full access (Section Authority)
    if (isEmployee && currentUserAccessType === 'full') {
      return req.authorityId === currentEmployeeId && req.status === 'pending' && !req.forwardedToAdmin;
    }
    // 3. If master (Top-Level) admin
    if (!isEmployee) {
      if (req.status !== 'pending') return false;
      // Show if it is a general request (no authorityId) OR if it has been forwarded to admin
      const isGeneralOrForwarded = !req.authorityId || req.forwardedToAdmin === true;
      if (!isGeneralOrForwarded) return false;

      if (selectedMachine !== 'all') {
        return req.machineName === selectedMachine;
      }
      return true;
    }
    return false;
  });

  const exportLeftEmployees = () => {
    const leftEmployees = filteredEmployees.filter(emp => emp.status === 'left');
    const ws = XLSX.utils.json_to_sheet(leftEmployees);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Left Employees");
    XLSX.writeFile(wb, "Left_Employees_Report.xlsx");
  };

  const exportAllEmployees = () => {
    const ws = XLSX.utils.json_to_sheet(filteredEmployees);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Employees");
    XLSX.writeFile(wb, "All_Employees_Report.xlsx");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden"
    >
      <div className="flex-shrink-0 mb-4 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">HR Management</h1>
          {(!isEmployee || currentUserAccessType === 'admin-light') ? (
            <div className="flex flex-wrap gap-2">
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                value={selectedMachine}
                onChange={e => setSelectedMachine(e.target.value)}
              >
                <option value="all">All Machines</option>
                {(isEmployee && currentUserAccessType === 'admin-light'
                  ? Array.from(new Set(employees.filter(e => e.companyName === (currentUserCompanyName || localStorage.getItem(`companyName_${auth.currentUser?.uid}`) || '')).map(e => e.machineName).filter(Boolean)))
                  : Array.from(new Set([...machinesList, ...customMachines]))
                ).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {!isEmployee && (
                <select
                  className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                  value={selectedCompany}
                  onChange={e => setSelectedCompany(e.target.value)}
                >
                  <option value="all">All Companies</option>
                  {companiesListComputed.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              )}

              {(!isEmployee || currentUserAccessType === 'admin-light') && (
                <>
                  <select
                    className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                    value={selectedZone}
                    onChange={e => {
                      setSelectedZone(e.target.value);
                      setSelectedDivision('all');
                    }}
                  >
                    <option value="all">All Zones</option>
                    {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>

                  <select
                    className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                    value={selectedDivision}
                    onChange={e => setSelectedDivision(e.target.value)}
                    disabled={selectedZone === 'all'}
                  >
                    <option value="all">All Divisions</option>
                    {selectedZone !== 'all' && RAILWAY_ZONES_DIVISIONS[selectedZone]?.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : (
            userMachine && (
              <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded-full font-bold">
                Machine: {userMachine}
              </span>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
              >
                <Plus size={18} /> Add Employee
              </button>
              <button
                onClick={() => setShowNotificationModal(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-amber-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
              >
                <Bell size={18} /> Create Notification
              </button>
              {(!isEmployee || currentUserAccessType === 'admin-light') && (
                <button
                  onClick={() => {
                    setSettingsAppTitle(appTitle);
                    setSettingsFbLink(fbLink);
                    setSettingsIgLink(igLink);
                    setSettingsWebLink(webLink);
                    setSettingsTgLink(tgLink);
                    setShowSettingsModal(true);
                  }}
                  className="flex items-center gap-2 bg-gradient-to-r from-slate-600 to-zinc-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-slate-700 hover:to-zinc-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
                >
                  <Settings size={18} /> Settings
                </button>
              )}
            </>
          )}
          <button
            onClick={exportLeftEmployees}
            className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
          >
            <Download size={18} /> Export Left
          </button>
          <button
            onClick={exportAllEmployees}
            className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-teal-700 hover:to-cyan-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
          >
            <Download size={18} /> Export All
          </button>
          {isAdmin && (
            <button
              onClick={() => {
                const activeOnly = filteredEmployees.filter(emp => emp.status !== 'left');
                setPrintEmployees(activeOnly);
              }}
              className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
            >
              <Printer size={18} /> Print ID Cards
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-100 pb-px">
        <button
          onClick={() => setActiveTab('employees')}
          className={cn(
            "pb-3 text-sm font-bold uppercase tracking-wider border-b-2 px-1 transition-all",
            activeTab === 'employees' 
              ? "border-indigo-900 text-indigo-900" 
              : "border-transparent text-slate-500 hover:text-indigo-700"
          )}
        >
          Employee Directory
        </button>
        {!isEmployee && (
          <button
            onClick={() => setActiveTab('companies')}
            className={cn(
              "pb-3 text-sm font-bold uppercase tracking-wider border-b-2 px-1 transition-all flex items-center gap-2",
              activeTab === 'companies' 
                ? "border-indigo-900 text-indigo-900" 
                : "border-transparent text-slate-500 hover:text-indigo-700"
            )}
          >
            <span>Companies</span>
            {companiesListComputed.length > 0 && (
              <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                {companiesListComputed.length}
              </span>
            )}
          </button>
        )}
      </div>
      </div>

      <div className="flex-grow flex flex-col min-h-0 pr-1 pb-16">
        {activeTab === 'employees' ? (
        <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-auto flex-grow min-h-0">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Photo</th>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Name</th>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Designation</th>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Mobile</th>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Status</th>
                <th className="sticky top-0 bg-slate-100 px-6 py-4 text-xs font-bold uppercase tracking-wider text-right shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              <AnimatePresence mode="popLayout">
                {filteredEmployees.map((emp, idx) => (
                  <motion.tr 
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.05 }}
                    key={emp.id} 
                    className="hover:bg-surface-container-low transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden">
                        {emp.photoUrl ? (
                          <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-outline">{emp.name.charAt(0)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-on-surface">{emp.name}</div>
                      <div className="text-xs text-on-surface-variant">{emp.email?.replace('@employee.billedapp.com', '')}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-on-surface">{emp.designation}</div>
                      <div className="text-[10px] text-on-surface-variant flex flex-col gap-0.5 mt-0.5 font-medium">
                        {emp.pfNo && (
                          <span>{emp.accessType === 'admin-light' ? 'ID No' : 'PF No'}: <span className="text-primary font-bold">{emp.pfNo}</span></span>
                        )}
                        {emp.esicNo && (
                          <span>{emp.accessType === 'admin-light' ? 'GST No' : 'ESIC No'}: <span className="text-primary font-bold">{emp.esicNo}</span></span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">{emp.mobile}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded text-[10px] font-black uppercase",
                        emp.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          setSelectedEmployee(emp);
                          setShowViewModal(true);
                        }}
                        className="p-2 text-secondary hover:text-primary transition-colors"
                        title="View Details"
                      >
                        <Eye size={18} />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setPrintEmployees([emp])}
                          className="p-2 text-secondary hover:text-purple-600 transition-colors"
                          title="Print ID Card"
                        >
                          <Printer size={18} />
                        </button>
                      )}
                      {emp.status === 'active' && isAdmin && (
                        <>
                          <button
                            onClick={() => {
                              setEditingEmployee({ ...emp });
                              const mName = emp.machineName || '';
                              if (mName && !machinesList.includes(mName)) {
                                setIsCustomMachineEdit(true);
                                setCustomMachineEditInput(mName);
                              } else {
                                setIsCustomMachineEdit(false);
                                setCustomMachineEditInput('');
                              }
                              setShowEditModal(true);
                            }}
                            className="p-2 text-secondary hover:text-blue-600 transition-colors"
                            title="Edit Employee"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedEmployee(emp);
                              setShowExitModal(true);
                            }}
                            className="p-2 text-secondary hover:text-red-600 transition-colors"
                            title="Mark as Left"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                      {emp.status === 'left' && isAdmin && (
                        <>
                          {!isEmployee && (
                            <button
                              onClick={async () => {
                                if (window.confirm(`Are you sure you want to reactivate employee "${emp.name}"?`)) {
                                  try {
                                    await updateDoc(doc(db, 'employees', emp.id), {
                                      status: 'active',
                                      doe: '' // clear exit date
                                    });
                                    toast.success(`Employee "${emp.name}" reactivated successfully!`);
                                    fetchEmployees();
                                  } catch (error) {
                                    console.error("Error reactivating employee:", error);
                                    toast.error("Failed to reactivate employee.");
                                  }
                                }
                              }}
                              className="p-2 text-secondary hover:text-green-600 transition-colors"
                              title="Reactivate Employee"
                            >
                              <UserCheck size={18} />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingEmployee({ ...emp });
                              const mName = emp.machineName || '';
                              if (mName && !machinesList.includes(mName)) {
                                setIsCustomMachineEdit(true);
                                setCustomMachineEditInput(mName);
                              } else {
                                setIsCustomMachineEdit(false);
                                setCustomMachineEditInput('');
                              }
                              setShowEditModal(true);
                            }}
                            className="p-2 text-secondary hover:text-blue-600 transition-colors"
                            title="Edit Left Employee"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              if (window.confirm(`Are you sure you want to permanently delete left employee "${emp.name}"?`)) {
                                try {
                                  await deleteDoc(doc(db, 'employees', emp.id));
                                  toast.success(`Employee "${emp.name}" removed from registry.`);
                                  fetchEmployees();
                                } catch (error) {
                                  console.error("Error deleting employee:", error);
                                  toast.error("Failed to delete employee.");
                                }
                              }
                            }}
                            className="p-2 text-secondary hover:text-red-600 transition-colors"
                            title="Delete Employee permanently"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      ) : activeTab === 'companies' ? (
        /* Companies View */
        <div className="space-y-6 overflow-y-auto flex-grow min-h-0 pr-1">
          <div className="flex flex-col lg:flex-row justify-between lg:items-center bg-slate-50 p-5 rounded-2xl border border-slate-200/60 gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 leading-tight">Company Registry</h2>
              <p className="text-xs text-slate-500 font-semibold">Create and manage registered corporate profiles and Admin-light logins.</p>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase text-slate-500 whitespace-nowrap">Filter by Company:</span>
                <select
                  className="border border-slate-200/80 rounded-xl px-3 py-2 text-xs font-bold bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={companyFilter}
                  onChange={e => setCompanyFilter(e.target.value)}
                >
                  <option value="all">All Companies</option>
                  {companiesListComputed.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {isAdmin && !isEmployee && (
                <button
                  onClick={() => setShowCreateCompanyModal(true)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md hover:shadow-indigo-600/10 transition-all transform hover:scale-[1.02] active:scale-[0.98] text-xs whitespace-nowrap"
                >
                  <Plus size={16} /> Create Company Profile
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCompanies.length === 0 ? (
              <div className="col-span-full bg-white border border-slate-100 rounded-2xl p-16 text-center shadow-sm">
                <Factory size={48} className="text-slate-300 mx-auto mb-4 animate-pulse" />
                <h3 className="text-lg font-bold text-slate-800">No Companies Found</h3>
                <p className="text-sm text-slate-500 mt-1">Adjust your filter or create registered profiles to populate this list.</p>
              </div>
            ) : (
              filteredCompanies.map((company, index) => (
                <div key={index} className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="p-3 bg-amber-50 text-amber-700 rounded-xl border border-amber-100">
                        <Factory size={24} />
                      </div>
                      <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                        {company.employeesCount} {company.employeesCount === 1 ? 'Employee' : 'Employees'}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-800 leading-tight mb-2.5">{company.name}</h3>
                    
                    <div className="space-y-2 text-xs text-slate-600 font-medium">
                      {company.gst && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">GST:</span>
                          <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded">{company.gst}</span>
                        </div>
                      )}
                      {company.dept && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">Dept:</span>
                          <span>{company.dept}</span>
                        </div>
                      )}
                      {(company.mobile || company.email) && (
                        <div className="border-t border-slate-100 pt-2 mt-2 space-y-1">
                          {company.mobile && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">📞</span>
                              <span>{company.mobile}</span>
                            </div>
                          )}
                          {company.email && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">✉️</span>
                              <span className="truncate">{company.email}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {company.address && (
                        <div className="border-t border-slate-100 pt-2 mt-2">
                          <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Address:</p>
                          <p className="text-slate-500 leading-relaxed text-[11px] line-clamp-2">{company.address}</p>
                        </div>
                      )}

                      {/* Machine breakdown metrics */}
                      <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 flex items-center gap-1">
                          <Factory size={10} /> Machine-wise Assignments:
                        </p>
                        {Object.keys(company.machineCounts).length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic font-medium">No active machine assignments yet</p>
                        ) : companyMachineSearch === 'all' ? (
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(company.machineCounts).map(([mName, mCount]) => (
                              <div key={mName} className="flex justify-between items-center text-[10px] bg-white px-2 py-1 rounded-md border border-slate-100/60 font-semibold text-slate-600">
                                <span className="truncate">{mName}</span>
                                <span className="bg-slate-100 text-slate-800 text-[9px] font-bold px-1.5 py-0.2 rounded-full">{mCount}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex justify-between items-center text-[11px] bg-indigo-50 border border-indigo-100/70 p-2 rounded-lg font-bold text-indigo-950">
                            <span className="truncate">Machine {companyMachineSearch}</span>
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                              {company.machineCounts[companyMachineSearch] || 0}
                            </span>
                          </div>
                        )}
                      </div>
                      {company.adminLightEmployees.length > 0 && (
                        <div className="bg-amber-50/40 border border-amber-100/50 p-2.5 rounded-xl mt-3.5">
                          <p className="text-[10px] text-amber-800 font-bold uppercase mb-1">Company Admin:</p>
                          <div className="flex flex-wrap gap-1">
                            {company.adminLightEmployees.map((adm, aIdx) => (
                              <span key={aIdx} className="bg-amber-100/60 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                {adm}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 mt-5 flex gap-2">
                    <button
                      onClick={() => setSelectedCompanyForView(company.name)}
                      className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 transition-all active:scale-[0.98] flex items-center justify-center gap-1"
                    >
                      <Eye size={14} /> Check Employees
                    </button>
                    {company.adminLightEmployees.length > 0 && (
                      <button
                        onClick={() => {
                          const adminEmp = employees.find(e => e.companyName === company.name && e.accessType === 'admin-light');
                          if (adminEmp) {
                            setEditingCompany(adminEmp);
                          }
                        }}
                        className="p-2 border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                        title="Edit Company Details"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                    {isAdmin && !isEmployee && (
                      <button
                        onClick={() => handleDeleteCompany(company.name)}
                        className="p-2 border border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Delete Company Permanently"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Approvals View */
        <div className="space-y-4 overflow-y-auto flex-grow min-h-0 pr-1">
          {filteredProfileRequests.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-16 text-center shadow-sm">
              <UserCheck size={48} className="text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-800">No Pending Approvals</h3>
              <p className="text-sm text-slate-500 mt-1">All employee profile update requests have been reviewed!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {filteredProfileRequests.map((req) => (
                <div key={req.id} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div 
                      className="flex items-center gap-4 cursor-pointer select-none group flex-1"
                      onClick={() => setExpandedRequests(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                      title="Click to view/hide requested changes"
                    >
                      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/60 group-hover:border-indigo-400 transition-colors">
                        {req.photoUrl ? (
                          <img src={req.photoUrl} alt={req.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg font-black text-slate-400">{req.name.charAt(0)}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-slate-800 text-lg leading-tight group-hover:text-indigo-600 transition-colors">{req.name}</h3>
                          <span className="text-[10px] text-indigo-500 font-bold bg-indigo-50 px-1.5 py-0.5 rounded opacity-80 group-hover:opacity-100 transition-all flex items-center gap-1">
                            {expandedRequests[req.id] ? 'Hide Changes ▲' : 'Click to View Changes ▼'}
                          </span>
                        </div>
                        <p className="text-xs text-indigo-700 uppercase font-black tracking-widest mt-1">{req.designation}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <p className="text-[10px] text-slate-400 font-semibold">Submitted: {new Date(req.createdAt).toLocaleString()}</p>
                          {req.authorityName && (
                            <span className="bg-blue-50 text-blue-700 border border-blue-100 text-[9px] px-1.5 py-0.5 rounded font-bold">
                              Authority: {req.authorityName}
                            </span>
                          )}
                          {req.forwardedToAdmin && (
                            <span className="bg-purple-50 text-purple-700 border border-purple-100 text-[9px] px-1.5 py-0.5 rounded font-bold animate-pulse">
                              Forwarded to Master Admin
                            </span>
                          )}
                        </div>
                        
                        {/* Action Remarks / Reason */}
                        <div className="mt-3 max-w-md" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Enter remarks/reason (Required for Return or Reject)..."
                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white transition-all placeholder:text-slate-400"
                            value={requestRemarks[req.id] || ''}
                            onChange={e => setRequestRemarks(prev => ({ ...prev, [req.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {isEmployee && isAdmin ? (
                        <>
                          <button
                            onClick={() => handleReturnRequest(req)}
                            className="px-3 py-2 border border-amber-200 hover:bg-amber-50 text-amber-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1 shadow-sm"
                            title="Return to Employee for corrections"
                          >
                            <Undo size={14} /> Return
                          </button>
                          {currentUserAccessType === 'full' && !req.forwardedToCompanyAdmin && (
                            <button
                              onClick={() => {
                                setProfileRequestToForward(req);
                                setSelectedProfileForwardEmployeeId('');
                                setShowProfileForwardModal(true);
                              }}
                              className="px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-1"
                              title="Forward to Company Admin"
                            >
                              <ArrowUpRight size={14} /> Forward to Company Admin
                            </button>
                          )}
                          {currentUserAccessType === 'admin-light' && !req.forwardedToAdmin && (
                            <button
                              onClick={() => {
                                setProfileRequestToForward(req);
                                setSelectedProfileForwardEmployeeId('');
                                setShowProfileForwardModal(true);
                              }}
                              className="px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-1"
                              title="Forward to Master Admin"
                            >
                              <ArrowUpRight size={14} /> Forward to Master Admin
                            </button>
                          )}
                          <button
                            onClick={() => handleRejectRequest(req)}
                            className="px-3 py-2 border border-red-200 hover:bg-red-50 text-red-600 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1 shadow-sm"
                            title="Reject completely"
                          >
                            <XCircle size={14} /> Reject
                          </button>
                          <button
                            onClick={() => handleApproveRequest(req)}
                            className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-md flex items-center gap-1"
                            title="Approve directly"
                          >
                            <Check size={14} /> Approve
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRejectRequest(req)}
                            className="px-4 py-2.5 border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm"
                          >
                            <XCircle size={14} /> Reject Request
                          </button>
                          <button
                            onClick={() => handleApproveRequest(req)}
                            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-600/10 flex items-center gap-1.5"
                          >
                            <Check size={14} /> Approve & Save
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Changes Grid */}
                  {expandedRequests[req.id] && (
                    <div className="mt-5 border-t border-slate-50 pt-4">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Requested Changes</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {getChangeDiff(req)?.map((change: any, cIdx: number) => (
                          <div key={cIdx} className="bg-slate-50/50 border border-slate-100 rounded-xl p-3.5 flex flex-col gap-1.5 shadow-inner">
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-900">{change.label}</span>
                            <div className="flex flex-col gap-1 text-xs">
                              {change.isPhoto ? (
                                <div className="flex items-center gap-4 mt-1">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Old</span>
                                    <div className={cn(
                                      change.isSignature ? "w-20 h-8 rounded-lg bg-slate-50 flex items-center justify-center p-1" : "w-10 h-10 rounded-full",
                                      "overflow-hidden border"
                                    )}>
                                      {change.oldPhoto ? <img src={change.oldPhoto} className={cn("w-full h-full", change.isSignature ? "object-contain" : "object-cover")} /> : <span className="text-[8px] text-slate-400">None</span>}
                                    </div>
                                  </div>
                                  <span className="text-indigo-900 font-bold">→</span>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-600">New</span>
                                    <div className={cn(
                                      change.isSignature ? "w-20 h-8 rounded-lg bg-white flex items-center justify-center p-1 border-emerald-500 shadow-sm" : "w-10 h-10 rounded-full border-emerald-500 shadow-sm",
                                      "overflow-hidden border"
                                    )}>
                                      {change.newPhoto ? <img src={change.newPhoto} className={cn("w-full h-full", change.isSignature ? "object-contain" : "object-cover")} /> : <span className="text-[8px] text-slate-400">None</span>}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-400 line-through truncate font-medium">Was: {change.oldVal || 'None'}</span>
                                  <span className="text-emerald-700 font-black truncate">To: {change.newVal || 'None'}</span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Profile Request Forward Modal */}
      {showProfileForwardModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl text-left"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
              <h2 className="text-lg font-bold text-slate-800">Forward Profile Request</h2>
              <button 
                onClick={() => setShowProfileForwardModal(false)} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XCircle size={22} />
              </button>
            </div>
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                if (!profileRequestToForward || !selectedProfileForwardEmployeeId) return;
                const targetEmp = employees.find(emp => emp.id === selectedProfileForwardEmployeeId);
                if (!targetEmp) return;
                await handleForwardRequest(profileRequestToForward, targetEmp);
                setShowProfileForwardModal(false);
              }} 
              className="p-6 space-y-4"
            >
              <p className="text-xs text-slate-600 font-medium">
                Select an employee to forward the profile request for <strong>{profileRequestToForward?.name}</strong>.
              </p>
              <div>
                <label className="block text-xs font-black uppercase text-indigo-600 mb-1.5 tracking-wide">
                  Recipient Employee (कर्मचारी का चयन करें)
                </label>
                <select
                  className="w-full border border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs font-bold bg-white"
                  value={selectedProfileForwardEmployeeId}
                  onChange={e => setSelectedProfileForwardEmployeeId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Employee --</option>
                  {employees
                    .filter(emp => {
                      const isNotMe = emp.id !== currentEmployeeId;
                      if (!isNotMe) return false;

                      const myCompany = currentUserCompanyName || '';
                      const isOperator = emp.designation?.toLowerCase().includes('operator');
                      const isSameCompany = !myCompany || !emp.companyName || emp.companyName === myCompany;

                      if (currentUserAccessType === 'full') {
                        // Full Access forwards to admin-light (Company Admin) or Operator of their company
                        return isSameCompany && (emp.accessType === 'admin-light' || isOperator);
                      }
                      if (currentUserAccessType === 'admin-light') {
                        // Company Admin forwards to Master Admin (full) or Operator of their company
                        return emp.accessType === 'full' || (isOperator && isSameCompany);
                      }
                      return emp.accessType === 'full' || (isOperator && isSameCompany);
                    })
                    .map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.accessType === 'admin-light'
                          ? `${emp.companyName || emp.name.replace(' Admin', '')} (Company Administrator)`
                          : `${emp.name} (${emp.designation || 'No Designation'}) - ${emp.companyName || 'No Company'}`}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProfileForwardModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 border border-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedProfileForwardEmployeeId}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  Forward
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Add Employee Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Add New Employee</h2>
                <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddEmployee} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.name}
                      onChange={e => setNewEmployee({ ...newEmployee, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Mobile</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.mobile}
                      onChange={e => setNewEmployee({ ...newEmployee, mobile: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.email}
                      onChange={e => setNewEmployee({ ...newEmployee, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Designation</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.designation}
                      onChange={e => setNewEmployee({ ...newEmployee, designation: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Joining</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.doj}
                      onChange={e => setNewEmployee({ ...newEmployee, doj: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Birth (DOB)</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.dob}
                      onChange={e => setNewEmployee({ ...newEmployee, dob: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PF Number</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        placeholder="e.g. MH/BAN/12345/678"
                        value={newEmployee.pfNo}
                        onChange={e => setNewEmployee({ ...newEmployee, pfNo: e.target.value })}
                        onBlur={e => checkAndAutofillPfNo(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => checkAndAutofillPfNo(newEmployee.pfNo || '')}
                        className="px-3 py-1 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-bold transition-all whitespace-nowrap"
                      >
                        Find PF
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">Press Tab or click Find PF to auto-fill if they worked here previously</p>
                    {autofillMessage && (
                      <div className="mt-2 p-2.5 bg-green-50/80 border border-green-200/50 rounded-lg text-[11px] text-green-800 font-bold leading-relaxed shadow-sm">
                        {autofillMessage}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ESIC Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 31000123450001001"
                      value={newEmployee.esicNo}
                      onChange={e => setNewEmployee({ ...newEmployee, esicNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Qualification</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. B.Tech Mechanical"
                      value={newEmployee.qualification || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, qualification: e.target.value })}
                    />
                  </div>
                  {(!isEmployee || currentUserAccessType !== 'admin-light') && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Company Name</label>
                      {!isEmployee ? (
                        <select
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                          value={newEmployee.companyName || ''}
                          onChange={e => {
                            const selectedCoName = e.target.value;
                            const matchedCo = companiesListComputed.find(c => c.name === selectedCoName);
                            setNewEmployee(prev => ({
                              ...prev,
                              companyName: selectedCoName,
                              companyGst: matchedCo?.gst || prev.companyGst,
                              companyMobile: matchedCo?.mobile || prev.companyMobile,
                              companyEmail: matchedCo?.email || prev.companyEmail,
                              companyAddress: matchedCo?.address || prev.companyAddress,
                              companyDept: matchedCo?.dept || prev.companyDept,
                            }));
                          }}
                        >
                          <option value="">Select Company...</option>
                          {companiesListComputed.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          disabled
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-slate-50 cursor-not-allowed"
                          value={currentUserCompanyName || ''}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={canSelectMachine ? (isCustomMachineNew ? "Other" : (newEmployee.machineName || '')) : userMachine}
                      disabled={!canSelectMachine}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "Other") {
                          setIsCustomMachineNew(true);
                          setNewEmployee(prev => ({ ...prev, machineName: '' }));
                        } else {
                          setIsCustomMachineNew(false);
                          setNewEmployee(prev => ({ ...prev, machineName: val }));
                        }
                      }}
                      required
                    >
                      <option value="">Select Machine</option>
                      {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {canSelectMachine && <option value="Other">Other (Type custom...)</option>}
                    </select>
                  </div>
                  {isCustomMachineNew && canSelectMachine && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Custom Machine Name</label>
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        value={customMachineNewInput}
                        onChange={e => {
                          setCustomMachineNewInput(e.target.value);
                          setNewEmployee(prev => ({ ...prev, machineName: e.target.value }));
                        }}
                        placeholder="Type machine name..."
                        required
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Contract No. / LOA (अनुबंध संख्या)</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono bg-slate-50"
                      placeholder="e.g. EL-20..-28-01 / Fetched from Admin Machine Contracts"
                      value={newEmployee.contractNo || (newEmployee.machineName ? (machineContractsMap[newEmployee.machineName] || '') : '')}
                      onChange={e => setNewEmployee(prev => ({ ...prev, contractNo: e.target.value }))}
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5 font-medium">Auto-fetched from ADMIN machine contacts/contracts</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Father's Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. Shri Late..."
                      value={newEmployee.fatherName || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, fatherName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Age</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 28"
                      value={newEmployee.age || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, age: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Sex</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={newEmployee.sex || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, sex: e.target.value })}
                    >
                      <option value="">Select Sex...</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Validity of Date of I-Card</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.validityDate || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, validityDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Blood Group (रक्त समूह)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-bold uppercase"
                        placeholder="e.g. B+, O+, A+"
                        value={newEmployee.bloodGroup || ''}
                        onChange={e => setNewEmployee({ ...newEmployee, bloodGroup: e.target.value.toUpperCase() })}
                      />
                      <select
                        className="border border-outline/20 rounded px-2 py-2 text-xs bg-slate-50 font-bold shrink-0"
                        onChange={e => {
                          if (e.target.value) {
                            setNewEmployee({ ...newEmployee, bloodGroup: e.target.value });
                          }
                        }}
                        value=""
                      >
                        <option value="">Quick Select</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Department</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. Civil Engineering / S&T"
                      value={newEmployee.department || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, department: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ID No.</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. EMP-101"
                      value={newEmployee.idNo || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, idNo: e.target.value })}
                    />
                  </div>
                  {/* Identity & Bank Details Section Header with Eye Toggle */}
                  <div className="md:col-span-3 border-t border-slate-100 pt-5 mt-4 flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                      <Building2 size={14} className="text-indigo-600" /> Identity & Bank Details (पहचान और बैंक विवरण)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowBankDetailsAdd(!showBankDetailsAdd)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-all focus:outline-none"
                    >
                      {showBankDetailsAdd ? (
                        <>
                          <EyeOff size={14} /> Hide Details (छुपाएं)
                        </>
                      ) : (
                        <>
                          <Eye size={14} /> Show Details (दिखाएं)
                        </>
                      )}
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Aadhar No.</label>
                    <input
                      type={showBankDetailsAdd ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="12-digit Aadhar No."
                      value={newEmployee.aadharNo || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, aadharNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Pan No.</label>
                    <input
                      type={showBankDetailsAdd ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="10-digit PAN No."
                      value={newEmployee.panNo || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, panNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Account No.</label>
                    <input
                      type={showBankDetailsAdd ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="Bank Account Number"
                      value={newEmployee.accountNo || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, accountNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">IFSC Code</label>
                    <input
                      type={showBankDetailsAdd ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="IFSC Code"
                      value={newEmployee.ifscCode || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, ifscCode: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Bank Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="Bank Name"
                      value={newEmployee.bankName || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, bankName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Branch</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="Branch Name"
                      value={newEmployee.branch || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, branch: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Railway Zone</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={newEmployee.zone || ''}
                      onChange={e => {
                        const z = e.target.value;
                        setNewEmployee(prev => ({ ...prev, zone: z, division: '' }));
                      }}
                    >
                      <option value="">Select Zone...</option>
                      {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                        <option key={z} value={z}>{z}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Railway Division</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={newEmployee.division || ''}
                      onChange={e => setNewEmployee(prev => ({ ...prev, division: e.target.value }))}
                      disabled={!newEmployee.zone}
                    >
                      <option value="">Select Division...</option>
                      {newEmployee.zone && RAILWAY_ZONES_DIVISIONS[newEmployee.zone]?.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold uppercase text-secondary mb-2">Employee Photo</label>
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline/10">
                      <div className="relative w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border-2 border-primary/20 shadow-md group">
                        {newEmployee.photoUrl ? (
                          <>
                            <img src={newEmployee.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setNewEmployee(prev => ({ ...prev, photoUrl: '' }))}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center text-outline">
                            <Camera size={28} className="text-secondary/60" />
                            <span className="text-[10px] font-black uppercase tracking-wider mt-1">No Photo</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="relative border-2 border-dashed border-outline-variant/30 hover:border-primary/50 rounded-xl p-4 text-center cursor-pointer transition-all bg-surface-container-low hover:bg-surface-container-high flex flex-col items-center justify-center">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePhotoUpload(e, false)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <Upload size={20} className="text-primary mb-1.5" />
                          <p className="text-xs font-bold text-on-surface">Click or Drag Photo Here</p>
                          <p className="text-[10px] text-outline mt-1 font-semibold">PNG, JPG, WEBP (Auto-compressed to fit database)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ID Card Signatures Section */}
                  <div className="md:col-span-3 border-t border-outline/10 pt-4 mt-2">
                    <h4 className="text-xs font-black uppercase text-indigo-950 tracking-wider mb-3 flex items-center gap-1.5">
                      ✍️ ID Card Signatures (Signature of Contractor, Employee & Railway Countersign)
                    </h4>
                    <p className="text-[11px] text-slate-500 font-semibold mb-3 leading-relaxed">
                      Upload transparent PNG signature images to print them directly on the employee's ID card. If left blank, a traditional signature line will be printed.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      {/* Company/ID Card Logo */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">ID Card Custom Logo</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {newEmployee.logoUrl ? (
                              <>
                                <img src={newEmployee.logoUrl} alt="ID Card Logo" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setNewEmployee(prev => ({ ...prev, logoUrl: '' }))}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider text-slate-400">Default Logo</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'logo', false)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Logo
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Employee Signature */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Employee Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className={cn(
                            "relative w-full bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group transition-all duration-300",
                            newEmployee.employeeSigUrl ? "h-24 p-1" : "h-16"
                          )}>
                            {newEmployee.employeeSigUrl ? (
                              <>
                                <img src={newEmployee.employeeSigUrl} alt="Employee Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setNewEmployee(prev => ({ ...prev, employeeSigUrl: '' }))}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'employee', false)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Contractor Signature & Stamp */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Contractor Stamp & Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {newEmployee.contractorSigUrl ? (
                              <>
                                <img src={newEmployee.contractorSigUrl} alt="Contractor Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setNewEmployee(prev => ({ ...prev, contractorSigUrl: '' }))}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'contractor', false)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Railway Representative Signature */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Railway Representative Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {newEmployee.railwaySigUrl ? (
                              <>
                                <img src={newEmployee.railwaySigUrl} alt="Railway Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setNewEmployee(prev => ({ ...prev, railwaySigUrl: '' }))}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'railway', false)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {(!isEmployee || (isEmployee && currentUserAccessType === 'admin-light')) && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 space-y-2">
                    <label className="block text-xs font-black uppercase text-indigo-900 tracking-wider">Access Control</label>
                    <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                      Choose whether this employee has full administrative access or non-access (profile-only).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="addAccessType"
                          value="full"
                          checked={newEmployee.accessType === 'full'}
                          onChange={() => setNewEmployee({ ...newEmployee, accessType: 'full' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Full Access (Admin)
                        </span>
                      </label>
                      {!isEmployee && (
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="addAccessType"
                            value="admin-light"
                            checked={newEmployee.accessType === 'admin-light'}
                            onChange={() => setNewEmployee({ ...newEmployee, accessType: 'admin-light' })}
                            className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                          />
                          <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                            Admin-light (Company Admin)
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="addAccessType"
                          value="limited"
                          checked={newEmployee.accessType === 'limited'}
                          onChange={() => setNewEmployee({ ...newEmployee, accessType: 'limited' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Non-Access (Profile-only)
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {newEmployee.accessType === 'admin-light' && (
                  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/40 space-y-3">
                    <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-1.5">
                      <Factory size={14} /> Company Settings (Required for Admin-light)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Name</label>
                        <input
                          type="text"
                          required={newEmployee.accessType === 'admin-light'}
                          placeholder="e.g. Acme Corporation"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyName || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">GST Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 27AAAAA1111A1Z1"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyGst || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyGst: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Mobile</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 9876543210"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyMobile || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyMobile: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Email</label>
                        <input
                          type="email"
                          placeholder="e.g. contact@acme.com"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyEmail || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyEmail: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Department Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Engineering & IT"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyDept || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyDept: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Address</label>
                        <textarea
                          placeholder="Full address of the company..."
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white h-12 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                          value={newEmployee.companyAddress || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyAddress: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Address</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={newEmployee.address}
                    onChange={e => setNewEmployee({ ...newEmployee, address: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Save Employee
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Employee Modal */}
      <AnimatePresence>
        {showEditModal && editingEmployee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Edit Employee Details</h2>
                <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleEditEmployee} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.name}
                      onChange={e => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Mobile</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.mobile}
                      onChange={e => setEditingEmployee({ ...editingEmployee, mobile: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.email}
                      onChange={e => setEditingEmployee({ ...editingEmployee, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Designation</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.designation}
                      onChange={e => setEditingEmployee({ ...editingEmployee, designation: e.target.value })}
                      required
                    />
                    {/* Show designation update type if changed */}
                    {employees.find(e => e.id === editingEmployee.id)?.designation !== editingEmployee.designation && (
                      <div className="mt-2 p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg space-y-1">
                        <label className="block text-[10px] font-black uppercase text-indigo-900">Career Event Type</label>
                        <select
                          className="w-full border border-indigo-200 rounded px-2 py-1 text-xs bg-white font-bold text-indigo-950 focus:outline-none"
                          value={designationChangeType}
                          onChange={e => setDesignationChangeType(e.target.value as any)}
                        >
                          <option value="promotion">📈 Promotion (Role Upgrade)</option>
                          <option value="demotion">📉 Demotion (Role Downgrade)</option>
                          <option value="correction">⚙️ Correction (Typo Fix / Restructure)</option>
                        </select>
                        <p className="text-[9px] text-slate-500">This categorizes the career progression entry logged to the employee profile.</p>
                        
                        {!isEmployee && (
                          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-indigo-100/50">
                            <input
                              type="checkbox"
                              id="silent-correction-checkbox"
                              className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                              checked={silentCorrection}
                              onChange={e => setSilentCorrection(e.target.checked)}
                            />
                            <label htmlFor="silent-correction-checkbox" className="text-[10px] font-bold text-indigo-950 cursor-pointer select-none">
                              🤫 Silent Correction (Do not log to Career History)
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Joining</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.doj}
                      onChange={e => setEditingEmployee({ ...editingEmployee, doj: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Birth (DOB)</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.dob || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, dob: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PF Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. MH/BAN/12345/678"
                      value={editingEmployee.pfNo || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, pfNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ESIC Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 31000123450001001"
                      value={editingEmployee.esicNo || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, esicNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Qualification</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. B.Tech Mechanical"
                      value={editingEmployee.qualification || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, qualification: e.target.value })}
                    />
                  </div>
                  {(!isEmployee || currentUserAccessType !== 'admin-light') && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Company Name</label>
                      {!isEmployee ? (
                        <select
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                          value={editingEmployee.companyName || ''}
                          onChange={e => {
                            const selectedCoName = e.target.value;
                            const matchedCo = companiesListComputed.find(c => c.name === selectedCoName);
                            setEditingEmployee(prev => prev ? ({
                              ...prev,
                              companyName: selectedCoName,
                              companyGst: matchedCo?.gst || prev.companyGst,
                              companyMobile: matchedCo?.mobile || prev.companyMobile,
                              companyEmail: matchedCo?.email || prev.companyEmail,
                              companyAddress: matchedCo?.address || prev.companyAddress,
                              companyDept: matchedCo?.dept || prev.companyDept,
                            }) : null);
                          }}
                        >
                          <option value="">Select Company...</option>
                          {companiesListComputed.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          disabled
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-slate-50 cursor-not-allowed"
                          value={currentUserCompanyName || ''}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={canSelectMachine ? (isCustomMachineEdit ? "Other" : (editingEmployee.machineName || '')) : userMachine}
                      disabled={!canSelectMachine}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "Other") {
                          setIsCustomMachineEdit(true);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: '' } : null);
                        } else {
                          setIsCustomMachineEdit(false);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: val } : null);
                        }
                      }}
                      required
                    >
                      <option value="">Select Machine</option>
                      {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {canSelectMachine && <option value="Other">Other (Type custom...)</option>}
                    </select>
                  </div>
                  {isCustomMachineEdit && canSelectMachine && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Custom Machine Name</label>
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        value={customMachineEditInput}
                        onChange={e => {
                          setCustomMachineEditInput(e.target.value);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: e.target.value } : null);
                        }}
                        placeholder="Type machine name..."
                        required
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Contract No. / LOA (अनुबंध संख्या)</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono bg-slate-50"
                      placeholder="e.g. EL-20..-28-01 / Fetched from Admin Machine Contracts"
                      value={editingEmployee.contractNo || (editingEmployee.machineName ? (machineContractsMap[editingEmployee.machineName] || '') : '')}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, contractNo: e.target.value }) : null)}
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5 font-medium">Auto-fetched from ADMIN machine contacts/contracts</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Father's Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. Shri Late..."
                      value={editingEmployee.fatherName || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, fatherName: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Age</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 28"
                      value={editingEmployee.age || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, age: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Sex</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={editingEmployee.sex || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, sex: e.target.value }) : null)}
                    >
                      <option value="">Select Sex...</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Validity of Date of I-Card</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.validityDate || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, validityDate: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Blood Group (रक्त समूह)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-bold uppercase"
                        placeholder="e.g. B+, O+, A+"
                        value={editingEmployee.bloodGroup || ''}
                        onChange={e => {
                          const val = e.target.value.toUpperCase();
                          setEditingEmployee(prev => prev ? ({ ...prev, bloodGroup: val }) : null);
                        }}
                      />
                      <select
                        className="border border-outline/20 rounded px-2 py-2 text-xs bg-slate-50 font-bold shrink-0"
                        onChange={e => {
                          if (e.target.value) {
                            const val = e.target.value;
                            setEditingEmployee(prev => prev ? ({ ...prev, bloodGroup: val }) : null);
                          }
                        }}
                        value=""
                      >
                        <option value="">Quick Select</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Department</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. Civil Engineering / S&T"
                      value={editingEmployee.department || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, department: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ID No.</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. EMP-101"
                      value={editingEmployee.idNo || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, idNo: e.target.value }) : null)}
                    />
                  </div>
                  {/* Identity & Bank Details Section Header with Eye Toggle */}
                  <div className="md:col-span-3 border-t border-slate-100 pt-5 mt-4 flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                      <Building2 size={14} className="text-indigo-600" /> Identity & Bank Details (पहचान और बैंक विवरण)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowBankDetailsEdit(!showBankDetailsEdit)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-all focus:outline-none"
                    >
                      {showBankDetailsEdit ? (
                        <>
                          <EyeOff size={14} /> Hide Details (छुपाएं)
                        </>
                      ) : (
                        <>
                          <Eye size={14} /> Show Details (दिखाएं)
                        </>
                      )}
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Aadhar No.</label>
                    <input
                      type={showBankDetailsEdit ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="12-digit Aadhar No."
                      value={editingEmployee.aadharNo || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, aadharNo: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Pan No.</label>
                    <input
                      type={showBankDetailsEdit ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="10-digit PAN No."
                      value={editingEmployee.panNo || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, panNo: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Account No.</label>
                    <input
                      type={showBankDetailsEdit ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="Bank Account Number"
                      value={editingEmployee.accountNo || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, accountNo: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">IFSC Code</label>
                    <input
                      type={showBankDetailsEdit ? "text" : "password"}
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-mono"
                      placeholder="IFSC Code"
                      value={editingEmployee.ifscCode || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, ifscCode: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Bank Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="Bank Name"
                      value={editingEmployee.bankName || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, bankName: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Branch</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="Branch Name"
                      value={editingEmployee.branch || ''}
                      onChange={e => setEditingEmployee(prev => prev ? ({ ...prev, branch: e.target.value }) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Railway Zone</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={editingEmployee.zone || ''}
                      onChange={e => {
                        const z = e.target.value;
                        setEditingEmployee(prev => prev ? ({ ...prev, zone: z, division: '' }) : null);
                      }}
                    >
                      <option value="">Select Zone...</option>
                      {Object.keys(RAILWAY_ZONES_DIVISIONS).map(z => (
                        <option key={z} value={z}>{z}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Railway Division</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={editingEmployee.division || ''}
                      onChange={e => {
                        const d = e.target.value;
                        setEditingEmployee(prev => prev ? ({ ...prev, division: d }) : null);
                      }}
                      disabled={!editingEmployee.zone}
                    >
                      <option value="">Select Division...</option>
                      {editingEmployee.zone && RAILWAY_ZONES_DIVISIONS[editingEmployee.zone]?.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold uppercase text-secondary mb-2">Employee Photo</label>
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline/10">
                      <div className="relative w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border-2 border-primary/20 shadow-md group">
                        {editingEmployee.photoUrl ? (
                          <>
                            <img src={editingEmployee.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setEditingEmployee(prev => prev ? { ...prev, photoUrl: '' } : null)}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center text-outline">
                            <Camera size={28} className="text-secondary/60" />
                            <span className="text-[10px] font-black uppercase tracking-wider mt-1">No Photo</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="relative border-2 border-dashed border-outline-variant/30 hover:border-primary/50 rounded-xl p-4 text-center cursor-pointer transition-all bg-surface-container-low hover:bg-surface-container-high flex flex-col items-center justify-center">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePhotoUpload(e, true)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <Upload size={20} className="text-primary mb-1.5" />
                          <p className="text-xs font-bold text-on-surface">Click or Drag Photo Here</p>
                          <p className="text-[10px] text-outline mt-1 font-semibold">PNG, JPG, WEBP (Auto-compressed to fit database)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ID Card Signatures Section */}
                  <div className="md:col-span-3 border-t border-outline/10 pt-4 mt-2">
                    <h4 className="text-xs font-black uppercase text-indigo-950 tracking-wider mb-3 flex items-center gap-1.5">
                      ✍️ ID Card Signatures (Signature of Contractor, Employee & Railway Countersign)
                    </h4>
                    <p className="text-[11px] text-slate-500 font-semibold mb-3 leading-relaxed">
                      Upload transparent PNG signature images to print them directly on the employee's ID card. If left blank, a traditional signature line will be printed.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      {/* Company/ID Card Logo */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">ID Card Custom Logo</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {editingEmployee.logoUrl ? (
                              <>
                                <img src={editingEmployee.logoUrl} alt="ID Card Logo" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployee(prev => prev ? { ...prev, logoUrl: '' } : null)}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider text-slate-400">Default Logo</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'logo', true)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Logo
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Employee Signature */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Employee Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className={cn(
                            "relative w-full bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group transition-all duration-300",
                            editingEmployee.employeeSigUrl ? "h-24 p-1" : "h-16"
                          )}>
                            {editingEmployee.employeeSigUrl ? (
                              <>
                                <img src={editingEmployee.employeeSigUrl} alt="Employee Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployee(prev => prev ? { ...prev, employeeSigUrl: '' } : null)}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'employee', true)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Contractor Signature & Stamp */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Contractor Stamp & Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {editingEmployee.contractorSigUrl ? (
                              <>
                                <img src={editingEmployee.contractorSigUrl} alt="Contractor Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployee(prev => prev ? { ...prev, contractorSigUrl: '' } : null)}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'contractor', true)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Railway Representative Signature */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-secondary">Railway Representative Signature</label>
                        <div className="flex flex-col items-center gap-2 bg-surface-container-lowest p-3 rounded-lg border border-outline/10">
                          <div className="relative w-full h-16 bg-surface-container-high flex items-center justify-center overflow-hidden border border-primary/10 rounded group">
                            {editingEmployee.railwaySigUrl ? (
                              <>
                                <img src={editingEmployee.railwaySigUrl} alt="Railway Signature" className="max-w-full max-h-full object-contain p-1" />
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployee(prev => prev ? { ...prev, railwaySigUrl: '' } : null)}
                                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-outline uppercase font-black tracking-wider">No Signature</span>
                            )}
                          </div>
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleSignatureUpload(e, 'railway', true)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="w-full text-center bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold py-1 px-2 rounded flex items-center justify-center gap-1">
                              <Upload size={12} /> Upload Signature
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {(!isEmployee || (isEmployee && currentUserAccessType === 'admin-light')) && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 space-y-2">
                    <label className="block text-xs font-black uppercase text-indigo-900 tracking-wider">Access Control</label>
                    <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                      Choose whether this employee has full administrative access or non-access (profile-only).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="editAccessType"
                          value="full"
                          checked={editingEmployee.accessType === 'full'}
                          onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'full' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Full Access (Admin)
                        </span>
                      </label>
                      {!isEmployee && (
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="editAccessType"
                            value="admin-light"
                            checked={editingEmployee.accessType === 'admin-light'}
                            onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'admin-light' })}
                            className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                          />
                          <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                            Admin-light (Company Admin)
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="editAccessType"
                          value="limited"
                          checked={editingEmployee.accessType === 'limited'}
                          onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'limited' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Non-Access (Profile-only)
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {editingEmployee.accessType === 'admin-light' && (
                  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/40 space-y-3">
                    <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-1.5">
                      <Factory size={14} /> Company Settings (Required for Admin-light)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Name</label>
                        <input
                          type="text"
                          required={editingEmployee.accessType === 'admin-light'}
                          placeholder="e.g. Acme Corporation"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyName || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">GST Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 27AAAAA1111A1Z1"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyGst || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyGst: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Mobile</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 9876543210"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyMobile || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyMobile: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Email</label>
                        <input
                          type="email"
                          placeholder="e.g. contact@acme.com"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyEmail || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyEmail: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Department Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Engineering & IT"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyDept || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyDept: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Address</label>
                        <textarea
                          placeholder="Full address of the company..."
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white h-12 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                          value={editingEmployee.companyAddress || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyAddress: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Address</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={editingEmployee.address || ''}
                    onChange={e => setEditingEmployee({ ...editingEmployee, address: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Check Employees of Company Modal */}
      <AnimatePresence>
        {selectedCompanyForView && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                    <Factory size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 leading-tight">{selectedCompanyForView}</h2>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">All registered employees under this company</p>
                  </div>
                </div>
                <button onClick={() => setSelectedCompanyForView(null)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>

              <div className="px-6 pb-6 pt-0 overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Photo</th>
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Name</th>
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Designation</th>
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Access Type</th>
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Mobile</th>
                      <th className="sticky top-0 bg-slate-50 px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] z-10">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                    {employees.filter(emp => emp.companyName === selectedCompanyForView).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-medium">No employees found in this company.</td>
                      </tr>
                    ) : (
                      employees.filter(emp => emp.companyName === selectedCompanyForView).map(emp => (
                        <tr key={emp.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/50">
                              {emp.photoUrl ? (
                                <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs font-bold text-slate-400">{emp.name.charAt(0)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-bold text-slate-800">{emp.name}</div>
                            <div className="text-[10px] text-slate-400 font-medium">{emp.email?.replace('@employee.billedapp.com', '')}</div>
                          </td>
                          <td className="px-4 py-2 text-slate-600">{emp.designation}</td>
                          <td className="px-4 py-2">
                            {emp.accessType === 'full' && (
                              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">Admin</span>
                            )}
                            {emp.accessType === 'admin-light' && (
                              <span className="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded">Admin-light</span>
                            )}
                            {(!emp.accessType || emp.accessType === 'limited') && (
                              <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded">Non-Access</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-500">{emp.mobile}</td>
                          <td className="px-4 py-2">
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                              emp.status === 'active' ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                            )}>
                              {emp.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForView(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors active:scale-95"
                >
                  Close Directory
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Exit Modal */}
      <AnimatePresence>
        {showExitModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Employee Exit</h2>
                <button onClick={() => setShowExitModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-on-surface-variant">
                  Are you sure you want to mark <strong>{selectedEmployee?.name}</strong> as left? This will move them to the "Leave Employee" section.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Exit</label>
                  <input
                    type="date"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={exitDate}
                    onChange={e => setExitDate(e.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowExitModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExitEmployee}
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Confirm Exit
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Company Modal */}
      <AnimatePresence>
        {showCreateCompanyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-black text-slate-800">Create New Company</h2>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">Define corporate attributes and initial admin login credentials.</p>
                </div>
                <button onClick={() => setShowCreateCompanyModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleCreateCompanySubmit}>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  
                  {/* General Profile Info */}
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950">1. Company Profile</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Acme Corporation"
                          value={newCompanyData.name}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, name: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">GST Number <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold"
                          placeholder="e.g. 27AADCB2230F1ZT"
                          value={newCompanyData.gst}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, gst: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Mobile Number</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. +91 9876543210"
                          value={newCompanyData.mobile}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, mobile: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Email Address</label>
                        <input
                          type="email"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. admin@acme.com"
                          value={newCompanyData.email}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Department Name</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Human Resources"
                          value={newCompanyData.dept}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, dept: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Address</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Suite 402, Business District"
                          value={newCompanyData.address}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, address: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Credentials Info */}
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900">2. Initial Admin-Light Credentials</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Login ID <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold text-indigo-900"
                          placeholder="e.g. acme_admin"
                          value={newCompanyData.loginId}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, loginId: e.target.value }))}
                          required
                        />
                        <p className="text-[10px] text-indigo-600 font-medium mt-1">This ID is used for first-time login verification.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Initial Password <span className="text-red-500">*</span></label>
                        <input
                          type="password"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono text-indigo-900"
                          placeholder="••••••••"
                          value={newCompanyData.password}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, password: e.target.value }))}
                          required
                        />
                        <p className="text-[10px] text-indigo-600 font-medium mt-1">The company admin will be prompted to change this upon login.</p>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateCompanyModal(false)}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-indigo-600/15 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Create & Provision
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {editingCompany && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-black text-slate-800">Edit Company Profile</h2>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">Modify company attributes and administrator credentials.</p>
                </div>
                <button onClick={() => setEditingCompany(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleEditCompanySubmit}>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  
                  {/* General Profile Info */}
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950">1. Company Profile</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Acme Corporation"
                          value={editingCompany.companyName || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyName: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">GST Number <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold"
                          placeholder="e.g. 27AADCB2230F1ZT"
                          value={editingCompany.companyGst || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyGst: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Mobile Number</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. +91 9876543210"
                          value={editingCompany.mobile || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, mobile: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Email Address</label>
                        <input
                          type="email"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. admin@acme.com"
                          value={editingCompany.email || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Department Name</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Human Resources"
                          value={editingCompany.companyDept || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyDept: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Address</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Suite 402, Business District"
                          value={editingCompany.companyAddress || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyAddress: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Credentials Info */}
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900">2. Admin-Light Credentials</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Login ID <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold text-indigo-900"
                          placeholder="e.g. acme_admin"
                          value={editingCompany.loginId || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, loginId: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Password <span className="text-red-500">*</span></label>
                        <input
                          type="password"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono text-indigo-900"
                          placeholder="••••••••"
                          value={editingCompany.password || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, password: e.target.value }))}
                          required
                        />
                      </div>
                    </div>
                  </div>

                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingCompany(null)}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-indigo-600/15 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Save Company Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Details Modal */}
      <AnimatePresence>
        {showViewModal && selectedEmployee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Employee Details</h2>
                <button onClick={() => setShowViewModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-8 max-h-[65vh] overflow-y-auto">
                <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                  <div className="w-32 h-32 rounded-2xl bg-surface-container-high flex items-center justify-center overflow-hidden shadow-inner border-2 border-outline-variant/20">
                    {selectedEmployee.photoUrl ? (
                      <img src={selectedEmployee.photoUrl} alt={selectedEmployee.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl font-black text-outline">{selectedEmployee.name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Full Name</label>
                      <p className="text-lg font-bold text-on-surface">{selectedEmployee.name}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Status</label>
                      <div>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                          selectedEmployee.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        )}>
                          {selectedEmployee.status}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Designation</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.designation}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Mobile</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.mobile}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Email</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.email?.replace('@employee.billedapp.com', '')}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Joining</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.doj}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Birth (DOB)</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.dob || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">
                        {selectedEmployee.accessType === 'admin-light' ? 'ID Number' : 'PF Number'}
                      </label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.pfNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">
                        {selectedEmployee.accessType === 'admin-light' ? 'GST Number' : 'ESIC Number'}
                      </label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.esicNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Qualification</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.qualification || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Father's Name</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.fatherName || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Age</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.age || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Sex</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.sex || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Validity of Card</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.validityDate || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Department</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.department || selectedEmployee.companyDept || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Railway Zone</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.zone || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Railway Division</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.division || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Contract No. (LOA)</label>
                      <p className="text-sm font-bold font-mono text-indigo-700">
                        {selectedEmployee.contractNo || (selectedEmployee.machineName ? machineContractsMap[selectedEmployee.machineName] : '') || 'N/A'}
                      </p>
                    </div>
                    {/* Identity & Bank Details Section Header with Eye Toggle */}
                    <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                        <Building2 size={14} className="text-indigo-600" /> Identity & Bank Details (पहचान और बैंक विवरण)
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowBankDetailsView(!showBankDetailsView)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-all focus:outline-none"
                      >
                        {showBankDetailsView ? (
                          <>
                            <EyeOff size={14} /> Hide Details (छुपाएं)
                          </>
                        ) : (
                          <>
                            <Eye size={14} /> Show Details (दिखाएं)
                          </>
                        )}
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">ID No.</label>
                      <p className="text-sm font-bold text-on-surface-variant">
                        {showBankDetailsView ? (selectedEmployee.idNo || 'N/A') : maskValue(selectedEmployee.idNo)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Aadhar No.</label>
                      <p className="text-sm font-bold text-on-surface-variant">
                        {showBankDetailsView ? (selectedEmployee.aadharNo || 'N/A') : maskValue(selectedEmployee.aadharNo)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Pan No.</label>
                      <p className="text-sm font-bold text-on-surface-variant">
                        {showBankDetailsView ? (selectedEmployee.panNo || 'N/A') : maskValue(selectedEmployee.panNo)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Account No.</label>
                      <p className="text-sm font-bold text-on-surface-variant">
                        {showBankDetailsView ? (selectedEmployee.accountNo || 'N/A') : maskValue(selectedEmployee.accountNo)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">IFSC Code</label>
                      <p className="text-sm font-bold text-on-surface-variant">
                        {showBankDetailsView ? (selectedEmployee.ifscCode || 'N/A') : maskValue(selectedEmployee.ifscCode)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Bank Name</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.bankName || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Branch</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.branch || 'N/A'}</p>
                    </div>
                    {!isEmployee && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline">Access Control</label>
                        <p className="text-sm font-bold text-on-surface-variant">
                          {selectedEmployee.accessType === 'full' ? 'Full Access (Admin-like privileges)' : 'Non-Access (Profile-only, changes forward to Admin)'}
                        </p>
                      </div>
                    )}
                    {selectedEmployee.status === 'left' && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Exit</label>
                        <p className="text-sm font-bold text-red-600">{selectedEmployee.doe}</p>
                      </div>
                    )}
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Address</label>
                      <p className="text-sm text-on-surface-variant leading-relaxed">{selectedEmployee.address || 'No address provided'}</p>
                    </div>

                    {/* Career & Designation History (Promotions / Demotions) */}
                    {selectedEmployee.designationHistory && selectedEmployee.designationHistory.length > 0 && (
                      <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                          <TrendingUp size={14} className="text-indigo-600" /> Career & Designation History
                        </h4>
                        <div className="relative border-l-2 border-indigo-100 pl-4 ml-2 space-y-4">
                          {selectedEmployee.designationHistory.map((hist: any, hIdx: number) => (
                            <div key={hIdx} className="relative group">
                              {/* Pulse point */}
                              <span className="absolute -left-[21px] top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-indigo-600 ring-4 ring-white" />
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5 flex-1">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                    <span className="text-xs font-bold text-slate-800">
                                      {hist.oldDesignation} &rarr; <span className="text-indigo-700 font-extrabold">{hist.newDesignation}</span>
                                    </span>
                                    <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold">
                                      {hist.type?.toUpperCase() || 'UPDATE'} • {hist.updatedAt}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 font-medium">
                                    Period: {hist.periodStart || 'N/A'} to {hist.periodEnd || 'N/A'}
                                  </p>
                                </div>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleRemoveHistoryEntry(selectedEmployee.id, hIdx)}
                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors self-start"
                                    title="Delete History Entry"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Previous Employment History */}
                    {selectedEmployee.employmentHistory && selectedEmployee.employmentHistory.length > 0 && (
                      <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                          <History size={14} className="text-amber-600" /> Previous Employment Records
                        </h4>
                        <div className="relative border-l-2 border-amber-100 pl-4 ml-2 space-y-4">
                          {selectedEmployee.employmentHistory.map((job: any, jIdx: number) => (
                            <div key={jIdx} className="relative">
                              {/* Pulse point */}
                              <span className="absolute -left-[21px] top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-amber-600 ring-4 ring-white" />
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-xs font-bold text-slate-800">
                                  Company: <span className="text-amber-800 font-extrabold">{job.companyName}</span>
                                </span>
                                <span className="text-[10px] font-mono bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">
                                  {job.designation || 'Employee'}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                Duration: {job.doj || 'N/A'} to {job.leftDate || job.doe || 'N/A'} ({job.status || 'Left'})
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Current Placement & Deployment History (वर्तमान स्थान एवं स्थानांतरण इतिहास) */}
                    <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 space-y-4">
                      {/* Current Placement Banner */}
                      <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-4 text-left space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-black text-emerald-800 uppercase tracking-wider">
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Current Placement (अभी कार्यरत स्थान)
                          </span>
                          <span className="text-[10px] bg-emerald-100/80 text-emerald-800 px-2 py-0.5 rounded-md font-mono font-black">
                            ACTIVE
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                          <div className="space-y-0.5">
                            <span className="text-[9px] font-black uppercase text-emerald-600/80 tracking-widest block">Current Railway Zone</span>
                            <span className="text-xs font-black text-slate-800">{selectedEmployee.zone || 'N/A'}</span>
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-[9px] font-black uppercase text-emerald-600/80 tracking-widest block">Current Railway Division</span>
                            <span className="text-xs font-black text-slate-800">{selectedEmployee.division || 'N/A'}</span>
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-[9px] font-black uppercase text-emerald-600/80 tracking-widest block">Assigned Machine</span>
                            <span className="text-xs font-black text-indigo-700 font-mono">{selectedEmployee.machineName || 'General'}</span>
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1.5 pt-1 border-t border-emerald-100/50">
                          <MapPin size={12} className="text-emerald-600" />
                          <span>Currently stationed since: <strong>{selectedEmployee.doj || 'Joining Date'}</strong></span>
                        </div>
                      </div>

                      {/* Timeline History */}
                      {(() => {
                        const historyList = dynamicEmployeeHistory || fetchedEmployeeHistory || selectedEmployee.zoneDivisionHistory || [];
                        const isSamePlacementAllTime = (() => {
                          if (historyList.length === 0) return true;
                          if (historyList.length === 1) return true;
                          
                          const first = historyList[0];
                          const firstZone = (first.zone || '').trim();
                          const firstDiv = (first.division || '').trim();
                          const firstMach = (first.machineName || '').trim();
                          const firstComp = (first.companyName || '').trim();
                          
                          return historyList.every((h: any) => 
                            (h.zone || '').trim() === firstZone &&
                            (h.division || '').trim() === firstDiv &&
                            (h.machineName || '').trim() === firstMach &&
                            (h.companyName || '').trim() === firstComp
                          );
                        })();

                        return (
                          <div className="space-y-4 pt-2">
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                              <History size={14} className="text-indigo-600" /> Zone & Division Deployment History (स्थानांतरण एवं कार्यकाल विवरण)
                            </h4>
                            
                            {isSamePlacementAllTime ? (
                              <div className="bg-emerald-50/60 border border-emerald-300 rounded-2xl p-5 text-left shadow-sm space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center gap-2 text-xs font-black text-emerald-800 uppercase tracking-wider">
                                    <span className="flex h-3 w-3 relative">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-600"></span>
                                    </span>
                                    Continuous Single Placement (स्थानांतरण रहित एक ही स्थान पर कार्यरत)
                                  </span>
                                  <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-md font-mono font-black border border-emerald-200">
                                    SINCE {selectedEmployee.doj || 'Joining'}
                                  </span>
                                </div>
                                
                                <p className="text-xs text-emerald-800 font-bold leading-relaxed">
                                  यह कर्मचारी अपनी नियुक्ति तिथि (Joining Date) से बिना किसी स्थान, कंपनी या मशीन बदलाव के एक ही स्थान पर निरंतर कार्यरत है:
                                </p>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 bg-white/70 p-3.5 rounded-xl border border-emerald-100">
                                  <div>
                                    <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Company (कंपनी)</span>
                                    <span className="text-xs font-black text-slate-800">{selectedEmployee.companyName || 'General'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Division (डिवीजन)</span>
                                    <span className="text-xs font-black text-slate-800">{selectedEmployee.division || 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Machine (मशीन)</span>
                                    <span className="text-xs font-black text-indigo-700 font-mono">{selectedEmployee.machineName || 'General'}</span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="relative border-l-2 border-indigo-100 pl-4 ml-2 space-y-5">
                                {historyList.map((hist: any, hIdx: number) => {
                                  const isLast = hIdx === historyList.length - 1 || hist.toDateTime === 'Ongoing';
                                  
                                  const isCurrentDivision = (hist.division || '').trim() === (selectedEmployee.division || '').trim() && (hist.zone || '').trim() === (selectedEmployee.zone || '').trim();
                                  const isCurrentMachine = (hist.machineName || '').trim() === (selectedEmployee.machineName || '').trim();
                                  
                                  let cardType = 'other';
                                  if (isLast) {
                                    cardType = 'current';
                                  } else if (isCurrentDivision && !isCurrentMachine) {
                                    cardType = 'same-division-diff-machine';
                                  } else if (!isCurrentDivision) {
                                    cardType = 'different-zone-division';
                                  }

                                  return (
                                    <div key={hIdx} className="relative">
                                      <span className={cn(
                                        "absolute -left-[21px] top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full ring-4 ring-white",
                                        cardType === 'current' 
                                          ? "bg-emerald-600 animate-pulse ring-emerald-50" 
                                          : cardType === 'same-division-diff-machine'
                                            ? "bg-amber-500 ring-amber-50"
                                            : "bg-indigo-600 ring-indigo-50"
                                      )} />
                                      
                                      <div className={cn(
                                        "p-4 rounded-xl text-left space-y-2 border shadow-sm transition-all hover:shadow-md",
                                        cardType === 'current'
                                          ? "bg-emerald-50/60 border-emerald-200"
                                          : cardType === 'same-division-diff-machine'
                                            ? "bg-amber-50/60 border-amber-200"
                                            : "bg-slate-50 border-slate-200"
                                      )}>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-dashed pb-1.5 border-slate-200">
                                          <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                                            {cardType === 'current' && (
                                              <span className="text-emerald-800 font-extrabold">● Current Active Placement (अभी कार्यरत स्थान)</span>
                                            )}
                                            {cardType === 'same-division-diff-machine' && (
                                              <span className="text-amber-800 font-extrabold font-mono">▲ Same Division, Previous Machine (समान डिवीजन - पिछला मशीन प्लेसमेंट)</span>
                                            )}
                                            {cardType === 'different-zone-division' && (
                                              <span className="text-indigo-800 font-extrabold">■ Previous Zone, Division & Company (पिछला जोन, डिवीजन एवं कंपनी प्लेसमेंट)</span>
                                            )}
                                          </span>
                                          <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 font-black flex items-center gap-1 shrink-0 text-slate-700 shadow-xs">
                                            <Calendar size={11} className="text-slate-500" />
                                            {hist.fromDateTime ? hist.fromDateTime.split('T')[0] : 'N/A'} &rarr; {hist.toDateTime === 'Ongoing' ? 'Ongoing (अभी तक)' : (hist.toDateTime ? hist.toDateTime.split('T')[0] : 'N/A')}
                                          </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                                          <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Company (कंपनी)</span>
                                            <span className="font-black text-slate-800">{hist.companyName || selectedEmployee.companyName || 'General'}</span>
                                          </div>
                                          <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Division (डिवीजन)</span>
                                            <span className="font-black text-slate-800">{hist.division || 'N/A'}</span>
                                          </div>
                                          <div>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Machine Name (मशीन का नाम)</span>
                                            <span className="font-black text-indigo-700 font-mono">{hist.machineName || 'General'}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Cached Associated Machine Movements section removed per user request */}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-surface-container-low flex justify-end">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-8 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-black rounded-lg shadow-md hover:from-indigo-700 hover:to-blue-700 transition-all active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Notification Modal */}
      <AnimatePresence>
        {showNotificationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Create Announcement Notification</h2>
                <button onClick={() => setShowNotificationModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleCreateNotification} className="p-6 space-y-4">
                {/* Dynamic Target options depending on Role */}
                {!isEmployee ? (
                  // Main Root Admin Form fields
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-500 mb-1">Target Audience Type</label>
                      <select
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                        value={notifTargetType}
                        onChange={e => setNotifTargetType(e.target.value)}
                      >
                        <option value="all">All Registered App Users (Global)</option>
                        <option value="company">Company Wise</option>
                        <option value="machine">Machine Wise</option>
                        <option value="employee">Employee Wise</option>
                        <option value="company-machine">Company & Machine Wise</option>
                      </select>
                    </div>

                    {(notifTargetType === 'company' || notifTargetType === 'company-machine') && (
                      <div>
                        <label className="block text-xs font-black uppercase text-slate-500 mb-1">Select Company</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                          value={notifTargetCompany}
                          onChange={e => setNotifTargetCompany(e.target.value)}
                        >
                          <option value="all">All Companies</option>
                          {companiesListComputed.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(notifTargetType === 'machine' || notifTargetType === 'company-machine') && (
                      <div>
                        <label className="block text-xs font-black uppercase text-slate-500 mb-1">Select Machine</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                          value={notifTargetMachine}
                          onChange={e => setNotifTargetMachine(e.target.value)}
                        >
                          <option value="all">All Machines</option>
                          {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {notifTargetType === 'employee' && (
                      <div>
                        <label className="block text-xs font-black uppercase text-slate-500 mb-1">Select Employee</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                          value={notifTargetEmployeeId}
                          onChange={e => setNotifTargetEmployeeId(e.target.value)}
                        >
                          <option value="all">Select Employee</option>
                          {filteredEmployees.map(emp => (
                            <option key={emp.id} value={emp.employeeId || emp.id}>
                              {emp.name} ({emp.designation})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : currentUserAccessType === 'admin-light' ? (
                  // Admin Light Company Form fields
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-black uppercase text-slate-500 mb-1">Target Audience Type</label>
                      <select
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                        value={notifTargetType}
                        onChange={e => setNotifTargetType(e.target.value)}
                      >
                        <option value="all">All Employees in My Company ({currentUserCompanyName})</option>
                        <option value="machine">Machine Wise in My Company</option>
                      </select>
                    </div>

                    {notifTargetType === 'machine' && (
                      <div>
                        <label className="block text-xs font-black uppercase text-slate-500 mb-1">Select Machine</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white font-bold"
                          value={notifTargetMachine}
                          onChange={e => setNotifTargetMachine(e.target.value)}
                        >
                          <option value="all">All Machines</option>
                          {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  // Full Access Admin Form field message
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                    <p className="text-xs text-indigo-800 font-bold leading-normal">
                      📢 This announcement will target employees working on your machine: <span className="underline">{userMachine || 'Not Assigned'}</span>, Admin Light Companies, and the Root Admin.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={notificationTitle}
                    onChange={e => setNotificationTitle(e.target.value)}
                    placeholder="e.g. System Announcement"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Message Body</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-28"
                    value={notificationMessage}
                    onChange={e => setNotificationMessage(e.target.value)}
                    placeholder="Type the announcement details here..."
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNotificationModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-amber-700 hover:to-orange-700 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Send Broadcast
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* App Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                  <Settings size={22} className="text-indigo-600" /> App Settings
                </h2>
                <button onClick={() => setShowSettingsModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {currentUserAccessType !== 'admin-light' && (
                  <>
                    {/* 1. App Heading Settings */}
                    <form onSubmit={handleSaveAppTitle} className="space-y-3 pb-6 border-b border-slate-100">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">App Header Title</h3>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 border border-outline/20 rounded px-3 py-2 text-sm"
                          value={settingsAppTitle}
                          onChange={e => setSettingsAppTitle(e.target.value)}
                          placeholder="e.g. Active Engineers Railway"
                          required
                        />
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 disabled:opacity-50"
                        >
                          Save Title
                        </button>
                      </div>
                    </form>

                    {/* 3. Manage Footer Links Settings */}
                    <form onSubmit={handleSaveFooterLinks} className="space-y-4 pb-6 border-b border-slate-100">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">Manage Footer Links</h3>
                      
                      <div className="space-y-2.5">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Facebook Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsFbLink}
                            onChange={e => setSettingsFbLink(e.target.value)}
                            placeholder="e.g. https://www.facebook.com/..."
                          />
                        </div>
                        
                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Instagram Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsIgLink}
                            onChange={e => setSettingsIgLink(e.target.value)}
                            placeholder="e.g. https://www.instagram.com/..."
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Website Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsWebLink}
                            onChange={e => setSettingsWebLink(e.target.value)}
                            placeholder="e.g. https://example.com or #"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Telegram Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsTgLink}
                            onChange={e => setSettingsTgLink(e.target.value)}
                            placeholder="e.g. https://t.me/..."
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {submitting && <Loader2 size={14} className="animate-spin" />}
                          Save Links
                        </button>
                      </div>
                    </form>
                  </>
                )}

                {/* 2. Machine Names Settings */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">Manage Machine Names</h3>
                  
                  {/* Add Machine Form */}
                  <form onSubmit={handleAddMachine} className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newMachineInput}
                      onChange={e => setNewMachineInput(e.target.value)}
                      placeholder="Add new machine name..."
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 flex items-center gap-1"
                    >
                      <Plus size={16} /> Add
                    </button>
                  </form>

                  {/* List of Machines */}
                  <div className="border border-outline/15 rounded-lg overflow-hidden bg-slate-50 max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {machinesList.length === 0 ? (
                      <p className="p-4 text-xs text-secondary text-center">No machine names configured.</p>
                    ) : (
                      machinesList.map((machine, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-white hover:bg-slate-50 transition-colors">
                          {editingMachineIndex === index ? (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="text"
                                className="flex-1 border border-outline/30 rounded px-2.5 py-1 text-sm bg-white"
                                value={editingMachineValue}
                                onChange={e => setEditingMachineValue(e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleEditMachineSave(index)}
                                className="p-1.5 text-emerald-600 hover:text-emerald-700 transition-colors"
                                title="Save"
                              >
                                <Check size={18} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMachineIndex(null);
                                  setEditingMachineValue("");
                                }}
                                className="p-1.5 text-red-500 hover:text-red-600 transition-colors"
                                title="Cancel"
                              >
                                <X size={18} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-semibold text-slate-700">{machine}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMachineIndex(index);
                                    setEditingMachineValue(machine);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
                                  title="Edit Machine Name"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMachine(index)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                                  title="Delete Machine"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-surface-container-low border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg transition-all active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                  <Trash2 size={20} />
                </div>
                <h3 className="text-base font-black text-slate-800">{confirmDialog.title}</h3>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-600 font-medium leading-relaxed">{confirmDialog.message}</p>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await confirmDialog.onConfirm();
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Print ID Card Modal */}
      <AnimatePresence>
        {printEmployees && printEmployees.length > 0 && (
          <div id="id-card-print-modal" className="fixed inset-0 z-[150] flex flex-col bg-slate-900/95 backdrop-blur-md p-4 md:p-8 overflow-y-auto print:static print:block print:w-full print:h-auto print:bg-white print:p-0 print:m-0 print:overflow-visible animate-fade-in">
            <style>{`
              .id-card-watermark {
                position: absolute !important;
                left: 50% !important;
                top: 33mm !important;
                transform: translate(-50%, -50%) !important;
                -webkit-transform: translate(-50%, -50%) !important;
                width: 32mm !important;
                height: 32mm !important;
                pointer-events: none !important;
                z-index: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
              }

              @media print {
                @page {
                  size: A4 portrait;
                  margin: 8mm 4mm;
                }
                
                *, *::before, *::after {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                }

                /* Hide non-printable elements */
                header, nav, aside, footer, button, .print\\:hidden {
                  display: none !important;
                }

                html, body, #root, #root > div {
                  margin: 0 !important;
                  padding: 0 !important;
                  width: 100% !important;
                  height: auto !important;
                  min-height: auto !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                  overflow: visible !important;
                }

                /* Hide all elements on page by default */
                body * {
                  visibility: hidden !important;
                }

                /* Reveal print modal and all its contents */
                #id-card-print-modal,
                #id-card-print-modal * {
                  visibility: visible !important;
                }

                #id-card-print-modal {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  height: auto !important;
                  background: #ffffff !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  overflow: visible !important;
                  box-shadow: none !important;
                  inset: auto !important;
                  z-index: 999999 !important;
                }

                #id-card-print-modal .print\\:hidden,
                #id-card-print-modal .print\\:hidden * {
                  display: none !important;
                  visibility: hidden !important;
                }

                #id-card-print-modal > div {
                  width: 100% !important;
                  max-width: 100% !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  height: auto !important;
                  display: block !important;
                  background: #ffffff !important;
                }

                #id-card-print-area {
                  display: flex !important;
                  flex-direction: column !important;
                  align-items: center !important;
                  width: 100% !important;
                  height: auto !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  background: #ffffff !important;
                  overflow: visible !important;
                }

                .print-card-pair {
                  page-break-inside: avoid !important;
                  break-inside: avoid !important;
                  display: flex !important;
                  flex-direction: row !important;
                  justify-content: center !important;
                  align-items: center !important;
                  gap: 8mm !important;
                  width: 100% !important;
                  margin: 0 auto 8mm auto !important;
                  padding: 2mm 0 !important;
                  background: transparent !important;
                  border: none !important;
                  box-shadow: none !important;
                  box-sizing: border-box !important;
                }

                .id-card-container {
                  position: relative !important;
                  width: 85.6mm !important;
                  height: 54.0mm !important;
                  min-width: 85.6mm !important;
                  min-height: 54.0mm !important;
                  max-width: 85.6mm !important;
                  max-height: 54.0mm !important;
                  overflow: hidden !important;
                  box-sizing: border-box !important;
                  border: 1px solid #475569 !important;
                  border-radius: 10px !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  color-adjust: exact !important;
                  margin: 0 !important;
                  flex-shrink: 0 !important;
                }

                .id-card-watermark {
                  position: absolute !important;
                  left: 50% !important;
                  top: 33mm !important;
                  transform: translate(-50%, -50%) !important;
                  -webkit-transform: translate(-50%, -50%) !important;
                  width: 32mm !important;
                  height: 32mm !important;
                  pointer-events: none !important;
                  z-index: 0 !important;
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                }

                .print-card-pair:not(:last-child) {
                  page-break-after: always !important;
                  break-after: page !important;
                }
              }
            `}</style>
            
            <div className="w-full max-w-5xl mx-auto flex flex-col h-full print:block print:w-full print:h-auto print:overflow-visible">
              {/* Header inside Preview */}
              <div className="flex flex-col bg-slate-800 text-white p-5 rounded-t-2xl shadow-lg flex-shrink-0 print:hidden space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-extrabold flex items-center gap-2">
                      <Printer size={20} className="text-purple-400" />
                      ID Card Print Preview ({printEmployees.length} Card{printEmployees.length > 1 ? 's' : ''})
                    </h2>
                    <p className="text-xs text-slate-300 font-semibold mt-0.5">Double check details before printing or saving as PDF.</p>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={() => {
                        let targetTitle = '';
                        if (printEmployees && printEmployees.length === 1) {
                          targetTitle = printEmployees[0].name || 'Employee_ID_Card';
                        } else if (printEmployees && printEmployees.length > 1) {
                          const firstCompName = printEmployees[0].companyName || 'Company';
                          targetTitle = `${firstCompName} employee's`;
                        }

                        if (targetTitle) {
                          document.title = targetTitle;
                          try {
                            if (window.parent && window.parent !== window) {
                              window.parent.document.title = targetTitle;
                            }
                          } catch (e) {
                            // ignore CORS error
                          }
                        }

                        window.focus();
                        window.print();
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-sm px-5 py-2 rounded-lg shadow transition-all active:scale-95 flex items-center gap-2"
                    >
                      <Printer size={16} /> Print Now
                    </button>
                    <button
                      onClick={() => setPrintEmployees(null)}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-extrabold text-sm px-4 py-2 rounded-lg transition-all"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* 🎨 ID Card Template & Color Selection */}
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 flex flex-col lg:flex-row items-center justify-between gap-4">
                  {/* Template Selector */}
                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                    <span className="text-xs font-black uppercase text-purple-300 tracking-wider whitespace-nowrap">
                      🪪 Template (टेम्पलेट चुनें):
                    </span>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setIdCardTemplate('standard')}
                        className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 border ${
                          idCardTemplate === 'standard'
                            ? "bg-purple-600 border-purple-500 text-white shadow-lg ring-2 ring-purple-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        📇 Template 1 (Standard ID)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIdCardTemplate('railway_pass')}
                        className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 border ${
                          idCardTemplate === 'railway_pass'
                            ? "bg-blue-600 border-blue-500 text-white shadow-lg ring-2 ring-blue-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        🎫 Template 2 (Railway Division Pass)
                      </button>
                    </div>
                  </div>

                  {/* Color Selector */}
                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                    <span className="text-xs font-black uppercase text-purple-300 tracking-wider whitespace-nowrap">
                      🎨 Color (रंग):
                    </span>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setIdCardColor('red')}
                        className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 border ${
                          idCardColor === 'red'
                            ? "bg-red-600 border-red-500 text-white shadow-lg ring-2 ring-red-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white/25"></span>
                        RED
                      </button>
                      <button
                        type="button"
                        onClick={() => setIdCardColor('blue')}
                        className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 border ${
                          idCardColor === 'blue'
                            ? "bg-blue-600 border-blue-500 text-white shadow-lg ring-2 ring-blue-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-white/25"></span>
                        BLUE
                      </button>
                      <button
                        type="button"
                        onClick={() => setIdCardColor('green')}
                        className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 border ${
                          idCardColor === 'green'
                            ? "bg-emerald-600 border-emerald-500 text-white shadow-lg ring-2 ring-emerald-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white/25"></span>
                        GREEN
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bulk signatures and styles setup */}
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50">
                  <h3 className="text-xs font-black uppercase text-purple-300 tracking-wider mb-3 flex items-center gap-2">
                    ✍️ Bulk Signatures, Stamps & Logo (Applies to all printed cards in this batch if not uploaded individually)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Bulk Logo */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-800/80 p-3 rounded-lg border border-slate-700/40">
                      <div className="w-16 h-10 bg-slate-950 flex items-center justify-center overflow-hidden rounded border border-slate-700/60 shrink-0">
                        {batchLogo ? (
                          <img src={batchLogo} alt="Batch Logo" className="max-w-full max-h-full object-contain p-0.5" />
                        ) : (
                          <span className="text-[8px] text-slate-500 uppercase font-bold text-center leading-none">Default ID Logo</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-slate-300 mb-1">ID Card Custom Logo</label>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const val = event.target?.result as string;
                                  const compressed = await compressImage(val, 400, 0.7);
                                  setBatchLogo(compressed);
                                  localStorage.setItem('batchLogo', compressed);
                                  try {
                                    await setDoc(doc(db, 'settings', 'general'), {
                                      batchLogo: compressed
                                    }, { merge: true });
                                    toast.success('Batch ID Card Logo saved to system settings!');
                                  } catch (err) {
                                    console.error("Error saving batch logo to database:", err);
                                    toast.success('Batch ID Card Logo loaded!');
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <button type="button" className="text-center bg-slate-700 hover:bg-slate-600 text-white text-[9px] font-bold py-1 px-2.5 rounded-md flex items-center justify-center gap-1">
                            <Upload size={10} /> Choose Image
                          </button>
                        </div>
                      </div>
                      {batchLogo && (
                        <button
                          type="button"
                          onClick={async () => {
                            setBatchLogo('');
                            localStorage.removeItem('batchLogo');
                            try {
                              await setDoc(doc(db, 'settings', 'general'), {
                                batchLogo: ""
                              }, { merge: true });
                              toast.success('Batch ID Card Logo cleared from system settings!');
                            } catch (err) {
                              console.error("Error clearing batch logo from database:", err);
                            }
                          }}
                          className="text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase shrink-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Contractor stamp/sig */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-800/80 p-3 rounded-lg border border-slate-700/40">
                      <div className="w-16 h-10 bg-slate-950 flex items-center justify-center overflow-hidden rounded border border-slate-700/60 shrink-0">
                        {batchContractorSig ? (
                          <img src={batchContractorSig} alt="Contractor Signature" className="max-w-full max-h-full object-contain p-0.5" />
                        ) : (
                          <span className="text-[8px] text-slate-500 uppercase font-bold text-center leading-none">No Contractor Stamp</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-slate-300 mb-1">Contractor Stamp & Signature</label>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const val = event.target?.result as string;
                                  try {
                                    const compressed = await compressImage(val, 400, 0.7);
                                    setBatchContractorSig(compressed);
                                    localStorage.setItem('batchContractorSig', compressed);
                                    await setDoc(doc(db, 'settings', 'general'), {
                                      batchContractorSig: compressed
                                    }, { merge: true });
                                    toast.success('Contractor Stamp saved to system settings!');
                                  } catch (err) {
                                    console.error("Error saving contractor stamp to database:", err);
                                    toast.success('Contractor Stamp saved locally on this machine!');
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                              e.target.value = '';
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <button type="button" className="text-center bg-slate-700 hover:bg-slate-600 text-white text-[9px] font-bold py-1 px-2.5 rounded-md flex items-center justify-center gap-1">
                            <Upload size={10} /> Choose Image
                          </button>
                        </div>
                      </div>
                      {batchContractorSig && (
                        <button
                          type="button"
                          onClick={async () => {
                            setBatchContractorSig('');
                            localStorage.removeItem('batchContractorSig');
                            try {
                              await setDoc(doc(db, 'settings', 'general'), {
                                batchContractorSig: ""
                              }, { merge: true });
                              toast.success('Contractor Stamp cleared from system settings!');
                            } catch (err) {
                              console.error("Error clearing contractor stamp from database:", err);
                            }
                          }}
                          className="text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase shrink-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Railway stamp/sig */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-800/80 p-3 rounded-lg border border-slate-700/40">
                      <div className="w-16 h-10 bg-slate-950 flex items-center justify-center overflow-hidden rounded border border-slate-700/60 shrink-0">
                        {batchRailwaySig ? (
                          <img src={batchRailwaySig} alt="Railway Signature" className="max-w-full max-h-full object-contain p-0.5" />
                        ) : (
                          <span className="text-[8px] text-slate-500 uppercase font-bold text-center leading-none">No Railway Stamp</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-slate-300 mb-0.5">Railway Rep Signature</label>
                        <span className="block text-[8px] text-emerald-400 font-semibold mb-1">सिस्टम सेटिंग्स में सेव और सिंक होगा</span>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const val = event.target?.result as string;
                                  try {
                                    const compressed = await compressImage(val, 400, 0.7);
                                    setBatchRailwaySig(compressed);
                                    localStorage.setItem('batchRailwaySig', compressed);
                                    await setDoc(doc(db, 'settings', 'general'), {
                                      batchRailwaySig: compressed
                                    }, { merge: true });
                                    toast.success('Railway Rep Countersign saved & synced!');
                                  } catch (err) {
                                    console.error("Error saving batch railway sig:", err);
                                    toast.error('Failed to process image');
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                              e.target.value = '';
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <button type="button" className="text-center bg-slate-700 hover:bg-slate-600 text-white text-[9px] font-bold py-1 px-2.5 rounded-md flex items-center justify-center gap-1">
                            <Upload size={10} /> Choose Image
                          </button>
                        </div>
                      </div>
                      {batchRailwaySig && (
                        <button
                          type="button"
                          onClick={async () => {
                            setBatchRailwaySig('');
                            localStorage.removeItem('batchRailwaySig');
                            try {
                              await setDoc(doc(db, 'settings', 'general'), {
                                batchRailwaySig: ""
                              }, { merge: true });
                              toast.success('Railway Rep Countersign cleared!');
                            } catch (err) {
                              console.error("Error clearing railway sig:", err);
                            }
                          }}
                          className="text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase shrink-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Template 2 Specific Logo */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-800/80 p-3 rounded-lg border border-blue-500/40">
                      <div className="w-16 h-10 bg-slate-950 flex items-center justify-center overflow-hidden rounded border border-slate-700/60 shrink-0">
                        {template2Logo ? (
                          <img src={template2Logo} alt="Template 2 Logo" className="max-w-full max-h-full object-contain p-0.5" />
                        ) : (
                          <span className="text-[8px] text-blue-400 uppercase font-bold text-center leading-none">Template 2 Custom Logo</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-blue-300 mb-0.5">Template 2 Custom Logo</label>
                        <span className="block text-[8px] text-sky-400 font-semibold mb-1">केवल Template 2 में बदलेगा</span>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const val = event.target?.result as string;
                                  try {
                                    const compressed = await compressImage(val, 400, 0.7);
                                    setTemplate2Logo(compressed);
                                    localStorage.setItem('template2Logo', compressed);
                                    await setDoc(doc(db, 'settings', 'general'), {
                                      template2Logo: compressed
                                    }, { merge: true });
                                    toast.success('Template 2 Logo updated!');
                                  } catch (err) {
                                    console.error("Error saving template 2 logo:", err);
                                    toast.error('Failed to process logo');
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                              e.target.value = '';
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <button type="button" className="text-center bg-blue-700 hover:bg-blue-600 text-white text-[9px] font-bold py-1 px-2.5 rounded-md flex items-center justify-center gap-1">
                            <Upload size={10} /> Choose Logo
                          </button>
                        </div>
                      </div>
                      {template2Logo && (
                        <button
                          type="button"
                          onClick={async () => {
                            setTemplate2Logo('');
                            localStorage.removeItem('template2Logo');
                            try {
                              await setDoc(doc(db, 'settings', 'general'), {
                                template2Logo: ""
                              }, { merge: true });
                              toast.success('Template 2 Logo cleared!');
                            } catch (err) {
                              console.error("Error clearing template 2 logo:", err);
                            }
                          }}
                          className="text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase shrink-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Demand Voucher PDF Logo */}
                    {!isEmployee && (
                      <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-800/80 p-3 rounded-lg border border-slate-700/40">
                        <div className="w-16 h-10 bg-slate-950 flex items-center justify-center overflow-hidden rounded border border-slate-700/60 shrink-0">
                          {demandLogo ? (
                            <img src={demandLogo} alt="Demand Logo" className="max-w-full max-h-full object-contain p-0.5" />
                          ) : (
                            <span className="text-[8px] text-amber-400/90 uppercase font-bold text-center leading-none">Default IR Logo</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="block text-[10px] font-bold text-slate-300 mb-1">Demand PDF Logo (माँग पत्र लोगो)</label>
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  try {
                                    const val = await compressImage(file, 400, 0.7);
                                    setDemandLogo(val);
                                    localStorage.setItem('demandLogo', val);
                                    try {
                                      await setDoc(doc(db, 'settings', 'general'), {
                                        demandLogo: val
                                      }, { merge: true });
                                      toast.success('Demand Voucher PDF Logo saved & synced!');
                                    } catch (dbErr) {
                                      console.error("Error saving demand logo to database:", dbErr);
                                      toast.success('Demand Voucher PDF Logo saved locally!');
                                    }
                                  } catch (err: any) {
                                    console.error("Error processing demand logo:", err);
                                    toast.error('Error processing demand logo: ' + (err?.message || 'Failed'));
                                  } finally {
                                    e.target.value = '';
                                  }
                                }
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                            <button type="button" className="text-center bg-slate-700 hover:bg-slate-600 text-white text-[9px] font-bold py-1 px-2.5 rounded-md flex items-center justify-center gap-1">
                              <Upload size={10} /> Choose Image
                            </button>
                          </div>
                        </div>
                        {demandLogo && (
                          <button
                            type="button"
                            onClick={async () => {
                              setDemandLogo('');
                              localStorage.removeItem('demandLogo');
                              try {
                                await setDoc(doc(db, 'settings', 'general'), {
                                  demandLogo: ""
                                }, { merge: true });
                                toast.success('Demand Voucher PDF Logo reset to default!');
                              } catch (err) {
                                console.error("Error clearing demand logo from database:", err);
                              }
                            }}
                            className="text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase shrink-0"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Scrollable Preview Space */}
              <div className="flex-1 bg-slate-100 p-8 overflow-y-auto rounded-b-2xl shadow-xl space-y-8 flex flex-col items-center print:block print:bg-white print:p-0 print:shadow-none print:w-full print:h-auto print:overflow-visible">
                <div className="text-center max-w-md text-slate-500 text-xs font-semibold pb-4 print:hidden">
                  💡 Tips: Ensure backgrounds/watermarks are enabled in your browser print settings under <strong>"More settings" &rarr; "Background graphics"</strong>.
                </div>

                <div id="id-card-print-area" className="flex flex-col items-center gap-8 w-full print:block print:gap-0">
                  {printEmployees.map((emp, idx) => {
                    const idString = emp.pfNo || emp.employeeId || emp.id.substring(0, 8);
                    const currentZone = getFullZoneName(emp.zone);
                    const currentDivision = emp.division || "";
                    const displayHeading = currentDivision ? `${currentZone}, ${currentDivision}` : currentZone;

                    const cardTheme = {
                      red: {
                        bg: "border-red-300 bg-gradient-to-br from-[#fffafb] via-white to-[#fff0f2] text-slate-800 print:border-red-450",
                        headerBg: "bg-gradient-to-r from-red-700 via-rose-50 to-red-700 border-red-200/50",
                        headerSpanBg: "bg-white px-[4.5mm] py-[1.5px] rounded-full border border-red-300 shadow-sm flex items-center justify-center",
                        headerText: "text-red-700 font-black",
                        badgeBg: "bg-red-600 text-white border-red-700/20",
                        nameText: "text-red-700 font-black"
                      },
                      blue: {
                        bg: "border-slate-350 bg-gradient-to-br from-[#f8fafc] via-white to-[#f0f9ff] text-slate-800 print:border-slate-450",
                        headerBg: "bg-gradient-to-r from-[#1e3a8a] via-[#f0f9ff] to-[#1e3a8a] border-blue-200/50",
                        headerSpanBg: "bg-white px-[4.5mm] py-[1.5px] rounded-full border border-blue-300 shadow-sm flex items-center justify-center",
                        headerText: "text-[#b91c1c]",
                        badgeBg: "bg-[#ffd200] text-black border-amber-500/20",
                        nameText: "text-[#1e3a8a] font-black"
                      },
                      green: {
                        bg: "border-emerald-350 bg-gradient-to-br from-white via-stone-50 to-emerald-50/20 text-stone-800 print:border-emerald-450",
                        headerBg: "bg-gradient-to-r from-emerald-800 via-emerald-50 to-emerald-800 border-emerald-200/50",
                        headerSpanBg: "bg-white px-[4.5mm] py-[1.5px] rounded-full border border-emerald-300 shadow-sm flex items-center justify-center",
                        headerText: "text-emerald-700 font-black",
                        badgeBg: "bg-[#059669] text-white border-emerald-500/20",
                        nameText: "text-emerald-800 font-bold"
                      }
                    }[idCardColor];

                     // High-fidelity Red Indian Railways emblem SVG
                    const RedRailwayLogo = ({ size = 26 }: { size?: number }) => (
                      <svg width={size} height={size} viewBox="0 0 100 100" className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] select-none">
                        {/* Solid Red Base Circle */}
                        <circle cx="50" cy="50" r="49" fill="#da251d" />
                        
                        {/* Outer White Boundary Rings */}
                        <circle cx="50" cy="50" r="47" fill="none" stroke="#ffffff" strokeWidth="1" />
                        <circle cx="50" cy="50" r="34" fill="none" stroke="#ffffff" strokeWidth="1.2" />

                        {/* Horizontal Track Lines */}
                        <g stroke="#ffffff" strokeWidth="0.8" opacity="0.85">
                          <line x1="22" y1="38" x2="78" y2="38" />
                          <line x1="20" y1="42" x2="80" y2="42" />
                          <line x1="19" y1="46" x2="81" y2="46" />
                          <line x1="19" y1="50" x2="81" y2="50" />
                          <line x1="19" y1="54" x2="81" y2="54" />
                          <line x1="20" y1="58" x2="80" y2="58" />
                          <line x1="22" y1="62" x2="78" y2="62" />
                        </g>

                        {/* Streamlined Train Engine */}
                        <path d="M 26 71 L 34 64 L 40 40 C 45 33, 55 33, 60 40 L 66 64 L 74 71 Z" fill="#da251d" stroke="#ffffff" strokeWidth="1.2" />
                        <line x1="34" y1="64" x2="66" y2="64" stroke="#ffffff" strokeWidth="1" />
                        <line x1="36" y1="67" x2="64" y2="67" stroke="#ffffff" strokeWidth="1" />
                        <line x1="38" y1="70" x2="62" y2="70" stroke="#ffffff" strokeWidth="1" />

                        {/* Central Boiler Shield (Ashoka Emblem) */}
                        <circle cx="50" cy="50" r="11" fill="#da251d" stroke="#ffffff" strokeWidth="1.2" />
                        <circle cx="50" cy="50" r="9.5" fill="none" stroke="#ffffff" strokeWidth="0.6" />
                        <g fill="#ffffff">
                          <path d="M 48 43.5 Q 50 42 52 43.5 L 52.5 46 L 47.5 46 Z" />
                          <rect x="48.5" y="46.5" width="3" height="4" rx="0.5" />
                          <circle cx="50" cy="52" r="1.5" fill="none" stroke="#ffffff" strokeWidth="0.5" />
                          <path d="M 46.5 54.5 L 53.5 54.5 L 52.5 56 L 47.5 56 Z" />
                        </g>

                        {/* Curved Text Top Arc: INDIAN RAILWAYS & भारतीय रेल */}
                        <CurvedText
                          text="INDIAN RAILWAYS"
                          radius={40}
                          startAngle={-145}
                          endAngle={-35}
                          fontSize="6.8px"
                          fontWeight="900"
                          fill="#ffffff"
                        />
                        <CurvedText
                          text="भारतीय रेल"
                          radius={40}
                          startAngle={145}
                          endAngle={35}
                          fontSize="6.2px"
                          fontWeight="900"
                          fill="#ffffff"
                          reverse={true}
                        />

                        {/* Border Stars */}
                        <g fill="#ffffff">
                          <polygon points="50,92 51,94.5 53.5,94.5 51.5,96 52.2,98.5 50,97 47.8,98.5 48.5,96 46.5,94.5 49,94.5" />
                          <polygon points="40,90.5 41,93 43.5,93 41.5,94.5 42.2,97 40,95.5 37.8,97 38.5,94.5 36.5,93 39,93" />
                          <polygon points="60,90.5 61,93 63.5,93 61.5,94.5 62.2,97 60,95.5 57.8,97 58.5,94.5 56.5,93 59,93" />
                          <polygon points="30,86 31,88.5 33.5,88.5 31.5,90 32.2,92.5 30,91 27.8,92.5 28.5,90 26.5,88.5 29,88.5" />
                          <polygon points="70,86 71,88.5 73.5,88.5 71.5,90 72.2,92.5 70,91 67.8,92.5 68.5,90 66.5,88.5 69,88.5" />
                          <polygon points="21,79 22,81.5 24.5,81.5 22.5,83 23.2,85.5 21,84 18.8,85.5 19.5,83 17.5,81.5 20,81.5" />
                          <polygon points="79,79 80,81.5 82.5,81.5 80.5,83 81.2,85.5 79,84 76.8,85.5 77.5,83 75.5,81.5 78,81.5" />
                        </g>
                      </svg>
                    );

                    // High-fidelity Contractor Ink Stamp SVG
                    const ContractorStamp = () => (
                      <svg className="w-full h-full opacity-85 select-none pointer-events-none" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#1d4ed8" strokeWidth="2.2" strokeDasharray="1.5 1" />
                        <circle cx="50" cy="50" r="41" fill="none" stroke="#1d4ed8" strokeWidth="1" />
                        <circle cx="50" cy="50" r="28" fill="none" stroke="#1d4ed8" strokeWidth="1" strokeDasharray="2 2" />
                        <CurvedText
                          text="M/S ACTIVE ENGINEERS"
                          radius={34.5}
                          startAngle={-155}
                          endAngle={-25}
                          fontSize="6.2px"
                          fontWeight="900"
                          fill="#1d4ed8"
                        />
                        <CurvedText
                          text="* RAIPUR (C.G.) *"
                          radius={34.5}
                          startAngle={155}
                          endAngle={25}
                          fontSize="6.8px"
                          fontWeight="900"
                          fill="#1d4ed8"
                          reverse={true}
                        />
                        {/* Organic ink handwritten scribble */}
                        <path d="M35,45 Q48,25 50,55 T65,45" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" />
                        <path d="M40,55 Q50,65 60,40" fill="none" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    );

                    // High-fidelity Railway Rep Stamp SVG
                    const RailwayRepStamp = () => (
                      <svg className="w-full h-full opacity-80 select-none pointer-events-none" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#4f46e5" strokeWidth="2.2" strokeDasharray="2 1" />
                        <circle cx="50" cy="50" r="41" fill="none" stroke="#4f46e5" strokeWidth="1" />
                        <circle cx="50" cy="50" r="25" fill="none" stroke="#4f46e5" strokeWidth="1" />
                        <CurvedText
                          text="SR. SEC. ENGINEER (TM)"
                          radius={32}
                          startAngle={-160}
                          endAngle={-20}
                          fontSize="5.8px"
                          fontWeight="900"
                          fill="#4f46e5"
                        />
                        <CurvedText
                          text="* SECR RAIPUR *"
                          radius={32}
                          startAngle={160}
                          endAngle={20}
                          fontSize="6.8px"
                          fontWeight="900"
                          fill="#4f46e5"
                          reverse={true}
                        />
                        {/* Organic ink handwritten signature */}
                        <path d="M32,48 C45,35 55,30 50,55 C45,80 65,55 68,45" fill="none" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    );

                    const logoToShow = batchLogo || emp.logoUrl;
                    const logoForTemplate2 = template2Logo || emp.logoUrl;
                    const contractNoVal = emp.contractNo || (emp.machineName ? (machineContractsMap[emp.machineName.trim()] || '') : '') || '';

                    const isValidSigUrl = (url?: string): boolean => {
                      if (!url) return false;
                      const trimmed = url.trim();
                      if (
                        !trimmed || 
                        trimmed === 'null' || 
                        trimmed === 'undefined' || 
                        trimmed === 'none' || 
                        trimmed === 'false' || 
                        trimmed === 'no' ||
                        trimmed.length < 5
                      ) return false;
                      return (
                        trimmed.startsWith('data:image/') ||
                        trimmed.startsWith('http://') ||
                        trimmed.startsWith('https://') ||
                        trimmed.startsWith('blob:') ||
                        trimmed.startsWith('/')
                      );
                    };

                    const contractorSigVal = (() => {
                      if (emp.contractorSigUrl !== undefined && emp.contractorSigUrl !== null && emp.contractorSigUrl !== '') {
                        if (isValidSigUrl(emp.contractorSigUrl)) return emp.contractorSigUrl.trim();
                        return '';
                      }
                      return isValidSigUrl(batchContractorSig) ? batchContractorSig.trim() : '';
                    })();

                    const railwaySigVal = (() => {
                      if (emp.railwaySigUrl !== undefined && emp.railwaySigUrl !== null && emp.railwaySigUrl !== '') {
                        if (isValidSigUrl(emp.railwaySigUrl)) return emp.railwaySigUrl.trim();
                        return '';
                      }
                      return isValidSigUrl(batchRailwaySig) ? batchRailwaySig.trim() : '';
                    })();

                    return idCardTemplate === 'railway_pass' ? (
                      /* ================= TEMPLATE 2: RAILWAY DIVISION PASS (Image 1 & 2) ================= */
                      <div key={emp.id} style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }} className="print-card-pair flex flex-col md:flex-row gap-6 p-4 bg-slate-200/50 rounded-2xl border border-slate-300/40 print:p-0 print:bg-transparent print:border-none print:mb-8 print:flex-row print:justify-center">
                        
                        {/* FRONT SIDE (Railway Pass Format: 85.6mm x 54.0mm) */}
                        <div 
                          style={{ width: "85.6mm", height: "54.0mm" }}
                          className="id-card-container border-[1.5px] border-blue-900 rounded-[8px] bg-white relative shadow-lg flex flex-col overflow-hidden select-none shrink-0 print:shadow-none print:border-[1px]"
                        >
                          {/* Top Banner (Header) */}
                          <div className="h-[13mm] bg-gradient-to-r from-[#0d3b82] via-[#1e40af] to-[#0f2d6b] flex items-center justify-between px-[2mm] py-[1mm] relative w-full shrink-0 z-10 text-white">
                            {/* Left: Circle Badge with Logo */}
                            <div className="shrink-0 h-[10mm] w-[10mm] bg-white rounded-full p-0.5 border border-blue-200 shadow-sm flex items-center justify-center overflow-hidden">
                              {logoForTemplate2 ? (
                                <img src={logoForTemplate2} alt="Logo" className="max-h-full max-w-full object-contain" {...getImgProps(logoForTemplate2)} />
                              ) : (
                                <RedRailwayLogo size={32} />
                              )}
                            </div>

                            {/* Center/Right: Zone and Division Title */}
                            <div className="flex-1 flex flex-col items-center justify-center text-center px-1 pr-2">
                              <span 
                                className="text-[13px] font-black uppercase tracking-wide leading-none text-white drop-shadow-xs"
                                style={{ fontFamily: '"Cooper Black", serif' }}
                              >
                                {currentZone || 'WESTERN RAILWAY'}
                              </span>
                              <span className="text-[11px] font-black uppercase tracking-wider leading-none text-sky-200 mt-[2px]">
                                {(emp.division ? `${emp.division} DIVISION` : currentDivision ? `${currentDivision} DIVISION` : 'RATLAM DIVISION')}
                              </span>
                            </div>
                          </div>

                          {/* Sub-Header Bar with Centered IDENTITY CARD Pill */}
                          <div className="h-[4.8mm] bg-[#0284c7] flex items-center justify-between px-[2mm] text-white shrink-0 z-10 border-t border-b border-blue-400/40 relative">
                            <div className="absolute left-1/2 -translate-x-1/2 bg-white text-[#0284c7] px-3.5 py-[0.5px] rounded-full text-[8.5px] font-black uppercase tracking-wider border border-blue-200 shadow-xs">
                              IDENTITY CARD
                            </div>
                            <div className="ml-auto text-[7.5px] font-bold tracking-tight text-white/95">
                              Date of Issue :- <span className="font-extrabold text-white">{emp.doj ? (emp.doj.includes('-') ? emp.doj.split('-').reverse().join('/') : emp.doj) : '30/12/2023'}</span>
                            </div>
                          </div>

                          {/* Front Card Body */}
                          <div className="flex-1 flex flex-row p-[1.5mm] pt-[1mm] pb-[1mm] relative z-10 w-full bg-white leading-tight">
                            {/* Left Column: Photo & Contractor Signature */}
                            <div className="w-[24mm] flex flex-col items-center justify-between shrink-0 pr-[1.5mm] border-r border-slate-200">
                              <div className="w-full text-left text-[8px] font-black text-slate-900 tracking-tight leading-none mb-0.5">
                                ID CARD NO :- <span className="text-blue-800 font-black">{emp.idNo || emp.pfNo || '59'}</span>
                              </div>

                              {/* Photo Box Container */}
                              <div className="relative w-[18.5mm] h-[21.5mm] my-auto">
                                <div className="w-full h-full bg-slate-50 border border-slate-400 rounded overflow-hidden flex items-center justify-center">
                                  {emp.photoUrl ? (
                                    <img src={emp.photoUrl} alt="Employee" className="w-full h-full object-cover" {...getImgProps(emp.photoUrl)} />
                                  ) : (
                                    <div className="flex flex-col items-center text-slate-400">
                                      <span className="text-[11px] font-black uppercase">{emp.name.charAt(0)}</span>
                                      <span className="text-[4px] font-bold uppercase">PHOTO</span>
                                    </div>
                                  )}
                                </div>
                                {/* Contractor Stamp Overlay - Shifted lower down so face/upper photo stays clear */}
                                {contractorSigVal && (
                                  <div className="absolute -bottom-3.5 -left-4 w-[16mm] h-[16mm] pointer-events-none z-20 opacity-90 transform -rotate-12">
                                    <img 
                                      src={contractorSigVal} 
                                      alt="Stamp" 
                                      className="w-full h-full object-contain filter drop-shadow-xs" 
                                      {...getImgProps(contractorSigVal)}
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="w-full text-center text-[6.5px] font-extrabold text-slate-800 uppercase tracking-tighter leading-none mt-[1px]">
                                Signature Of Contractor With Stamp
                              </div>
                            </div>

                            {/* Right Column: Employee Info & Work Details */}
                            <div className="flex-1 flex flex-col justify-between pl-[1.5mm] min-w-0">
                              <div className="space-y-[2.5px] text-[8.5px]">
                                <div className="flex items-center min-w-0">
                                  <span className="font-black text-slate-800 shrink-0 text-[9.2px]">Name of Employee :-</span>
                                  <span className="font-black text-slate-950 uppercase truncate ml-1 text-[10.5px]">{emp.name}</span>
                                </div>
                                <div className="flex items-center min-w-0">
                                  <span className="font-black text-slate-800 shrink-0 text-[9.2px]">Father Name :-</span>
                                  <span className="font-black text-slate-900 uppercase truncate ml-1 text-[9.5px]">{emp.fatherName || 'N/A'}</span>
                                </div>
                                <div className="flex items-center min-w-0">
                                  <span className="font-black text-slate-800 shrink-0 text-[9.2px]">Designation :-</span>
                                  <span className="font-black text-slate-900 uppercase truncate ml-1 text-[9.5px]">{emp.designation || 'HELPER'}</span>
                                </div>
                              </div>

                              {/* Blue Box with Contract Work Details */}
                              <div className="bg-[#0284c7] text-white p-[1.2mm] rounded-[4px] space-y-[1.5px] text-[8px] leading-[1.2] my-[1px] shadow-xs">
                                <div className="truncate">
                                  <span className="font-black text-sky-100">Name of Work :- </span>
                                  <span className="font-black text-white uppercase">{emp.department || emp.companyDept || 'AC Coach Electrical Attendant'}</span>
                                </div>
                                <div className="truncate">
                                  <span className="font-black text-sky-100">Name of Contractor :- </span>
                                  <span className="font-black text-white uppercase">{emp.companyName || 'Dhara Rail Projects Pvt. Ltd.'}</span>
                                </div>
                                <div className="truncate">
                                  <span className="font-black text-sky-100">LOA :- </span>
                                  <span className="font-bold text-sky-50">{contractNoVal ? `LOA.${contractNoVal}` : (emp.pfNo ? `LOA.${emp.pfNo}` : 'LOA.EL-20..-28-01 / 00888230132065 Dt. 23/08/2023')}</span>
                                </div>
                              </div>

                              {/* Employee Signature Row */}
                              <div className="flex flex-col items-end justify-end pt-[0.5mm] border-t border-dashed border-slate-300 w-full mt-auto">
                                <div className="h-[5.5mm] max-w-[24mm] flex items-center justify-end">
                                  {emp.employeeSigUrl ? (
                                    <img src={emp.employeeSigUrl} alt="Emp Sig" className="max-h-full object-contain" {...getImgProps(emp.employeeSigUrl)} />
                                  ) : (
                                    <span className="text-[7.5px] font-bold text-slate-800 italic">{emp.name}</span>
                                  )}
                                </div>
                                <div className="text-[6.5px] font-black text-slate-800 uppercase tracking-tighter text-right">
                                  Signature Of Employee
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* BACK SIDE (Railway Pass Format: 85.6mm x 54.0mm) */}
                        <div 
                          style={{ width: "85.6mm", height: "54.0mm" }}
                          className="id-card-container border-[1.5px] border-blue-900 rounded-[8px] bg-white relative shadow-lg flex flex-col justify-between p-[2.5mm] overflow-hidden select-none shrink-0 print:shadow-none print:border-[1px]"
                        >
                          {/* Background Watermark Centered */}
                          <div className="id-card-watermark w-[34mm] h-[34mm] opacity-[0.08] pointer-events-none z-0 flex items-center justify-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                            {logoForTemplate2 ? (
                              <img src={logoForTemplate2} alt="Watermark" className="max-h-full max-w-full object-contain filter grayscale" {...getImgProps(logoForTemplate2)} />
                            ) : (
                              <RedRailwayLogo size={90} />
                            )}
                          </div>

                          {/* Back Information List with Bigger & Bolder Text */}
                          <div className="relative z-10 space-y-[3px] text-[9.5px] leading-tight pt-0.5">
                            <div className="grid grid-cols-[33mm_1fr] items-center">
                              <span className="font-black text-slate-800 uppercase">Blood Group :-</span>
                              <span className="font-black text-slate-900 uppercase pl-1 text-[10.5px]">{emp.bloodGroup || 'B+'}</span>
                            </div>
                            <div className="grid grid-cols-[33mm_1fr] items-center">
                              <span className="font-black text-slate-800 uppercase">Aadhar Card No :-</span>
                              <span className="font-black text-slate-900 tracking-wide pl-1 text-[10.5px]">{emp.aadharNo || maskValue(emp.pfNo) || '8239 5623 0001'}</span>
                            </div>
                            <div className="grid grid-cols-[33mm_1fr] items-center">
                              <span className="font-black text-slate-800 uppercase">Valid Till Date :-</span>
                              <span className="font-black text-red-600 pl-1 text-[10.5px]">{emp.validityDate || '31/12/2026'}</span>
                            </div>
                            <div className="grid grid-cols-[33mm_1fr] items-center">
                              <span className="font-black text-slate-800 uppercase">Mobile No. :-</span>
                              <span className="font-black text-slate-900 pl-1 text-[10.5px]">{emp.mobile || 'N/A'}</span>
                            </div>
                            <div className="grid grid-cols-[33mm_1fr] items-start">
                              <span className="font-black text-slate-800 uppercase">Employee Address :-</span>
                              <span className="font-bold text-slate-900 pl-1 break-words text-[9px] max-w-[46mm]">{emp.address || 'N/A'}</span>
                            </div>
                          </div>

                          {/* Bottom Official Railway Signature & Stamp (CENTERED) */}
                          <div className="relative z-10 border-t border-slate-300 pt-1 flex flex-col items-center justify-center text-center w-full min-h-[17mm] mx-auto mt-auto">
                            <div className="text-[7.5px] font-black text-slate-900 uppercase tracking-tight text-center w-full mb-0.5">
                              Signature of Rly. Official With Stamp
                            </div>

                            {/* Name & Designation Text container with Overlay Signature Image */}
                            <div className="relative w-full flex flex-col items-center justify-center my-0.5 min-h-[10mm]">
                              <div className="text-[7px] font-black text-slate-800 text-center leading-tight space-y-[0.5px] z-10 relative">
                                <div>Name : .....................................................</div>
                                <div>Designation : .....................................................</div>
                              </div>

                              {/* Railway Stamp & Signature (Moved HIGHER UP above Name & Designation) */}
                              {railwaySigVal && (
                                <div className="absolute -top-5 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none z-20">
                                  <img 
                                    src={railwaySigVal} 
                                    alt="Railway Stamp" 
                                    className="h-[14mm] max-w-[40mm] object-contain filter drop-shadow-xs opacity-95" 
                                    {...getImgProps(railwaySigVal)}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                      </div>
                    ) : (
                      /* ================= TEMPLATE 1: STANDARD ID CARD (UNCHANGED) ================= */
                      <div key={emp.id} style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }} className="print-card-pair flex flex-col md:flex-row gap-6 p-4 bg-slate-200/50 rounded-2xl border border-slate-300/40 print:p-0 print:bg-transparent print:border-none print:mb-8 print:flex-row print:justify-center">
                        
                        {/* FRONT SIDE (Standard ID-1/CR-80 Format: 85.6mm x 54.0mm - Landscape) */}
                        <div 
                          style={{ width: "85.6mm", height: "54.0mm" }}
                          className={`id-card-container border-[1px] rounded-[10px] relative shadow-lg flex flex-col overflow-hidden select-none shrink-0 print:shadow-none print:border-[1px] ${cardTheme.bg}`}
                        >
                          {/* Faint Background Watermark Logo */}
                          <div className="id-card-watermark w-[32mm] h-[32mm] opacity-[0.13] pointer-events-none z-0 flex items-center justify-center" style={{ position: 'absolute', left: '50%', top: '33mm', transform: 'translate(-50%, -50%)' }}>
                            {logoToShow ? (
                              <img src={logoToShow} alt="Watermark" className="max-h-full max-w-full object-contain filter grayscale brightness-95" {...getImgProps(logoToShow)} />
                            ) : (
                              <RedRailwayLogo size={100} />
                            )}
                          </div>

                          {/* Top Banner (Header) */}
                          <div className={`h-[11.8mm] flex items-center justify-between px-[3.5mm] relative w-full shrink-0 z-10 ${cardTheme.headerBg}`}>
                            <div className="shrink-0 h-[8.5mm] w-[8.5mm] flex items-center justify-center">
                              {logoToShow ? (
                                <img src={logoToShow} alt="Logo" className="max-h-full max-w-full object-contain" {...getImgProps(logoToShow)} />
                              ) : (
                                <RedRailwayLogo size={28} />
                              )}
                            </div>
                            <div className="flex-1 flex justify-center mx-[1.5mm]">
                              <div className={cardTheme.headerSpanBg}>
                                <span className={`text-[11.2px] font-black tracking-[0.4px] uppercase whitespace-nowrap leading-none ${cardTheme.headerText}`}>
                                  {currentZone}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0 w-[8.5mm]" />
                          </div>

                          {/* Body Area */}
                          <div className="flex-1 flex flex-row justify-between p-[2.5mm] pt-[2.2mm] pb-[1.8px] relative z-10 w-full">
                            {/* Left panel: Fields & Signatures */}
                            <div className="w-[58mm] flex flex-col justify-between h-full pr-[1.5mm]">
                              
                              {/* Fields Grid */}
                              <div className="space-y-[2.8px] mt-[1.5px]">
                                {/* Sr. No. / ID Number */}
                                <div className="grid grid-cols-[25mm_1fr] min-w-0 items-center text-[7px] leading-tight">
                                  <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">SR. NO. OF THE EMPLOYEE</span>
                                  <span className="text-slate-900 font-black tracking-wide pl-1 min-w-0 truncate">{emp.idNo || emp.pfNo || 'N/A'}</span>
                                </div>

                                {/* Name of the Establishment */}
                                <div className="grid grid-cols-[25mm_1fr] min-w-0 items-center text-[7px] leading-tight">
                                  <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">NAME OF THE ESTABLISHMENT</span>
                                  <span className="text-slate-900 font-black tracking-wide pl-1 uppercase truncate min-w-0 max-w-[32mm]" title={emp.companyName || 'M/S ACTIVE ENGINEERS'}>
                                    {emp.companyName || 'M/S ACTIVE ENGINEERS'}
                                  </span>
                                </div>

                                {/* Name of the Employee */}
                                <div className="grid grid-cols-[25mm_1fr] min-w-0 items-center text-[7px] leading-tight">
                                  <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">NAME OF THE EMPLOYEE</span>
                                  <span className={`font-black text-[8.5px] tracking-tight pl-1 uppercase truncate min-w-0 max-w-[32mm] ${cardTheme.nameText}`}>
                                    {emp.name}
                                  </span>
                                </div>

                                {/* Address */}
                                <div className="grid grid-cols-[25mm_1fr] min-w-0 items-start text-[7px] leading-tight">
                                  <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">ADDRESS</span>
                                  <span className={`text-slate-900 font-black pl-1 select-all min-w-0 max-w-[32mm] break-words whitespace-normal leading-[1.15] ${
                                    (emp.address || 'N/A').length > 120 ? 'text-[4.8px]' :
                                    (emp.address || 'N/A').length > 80 ? 'text-[5.4px]' :
                                    (emp.address || 'N/A').length > 50 ? 'text-[6px]' : 'text-[6.8px]'
                                  }`}>
                                    {emp.address || 'N/A'}
                                  </span>
                                </div>

                                {/* DOB & Sex */}
                                <div className="grid grid-cols-[25mm_1fr] min-w-0 items-center text-[7px] leading-tight">
                                  <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">DOB</span>
                                  <div className="flex items-center gap-1 pl-1 min-w-0">
                                    <span className="text-slate-900 font-black text-[7.2px] shrink-0">
                                      {emp.dob ? (emp.dob.includes('-') ? emp.dob.split('-').reverse().join('-') : emp.dob) : 'N/A'}
                                    </span>
                                    <span className="text-slate-600 font-extrabold uppercase tracking-tight ml-3 shrink-0">SEX</span>
                                    <span className="text-slate-900 font-black text-[7.2px] pl-0.5 shrink-0">
                                      {emp.sex ? (emp.sex.toLowerCase().startsWith('f') ? 'Female' : 'Male') : 'Male'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Signatures at the bottom */}
                              <div className="flex justify-between items-end mb-[0.5mm] w-full">
                                {/* Left: Contractor Stamp & Sig */}
                                <div className="w-[27mm] flex flex-col justify-end">
                                  <div className="h-[10.5mm] flex items-center justify-start pl-1 relative">
                                    {contractorSigVal && (
                                      <img 
                                        src={contractorSigVal} 
                                        alt="Contractor Signature" 
                                        className="max-h-[10.5mm] w-auto object-contain filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] scale-[1.3] origin-bottom-left" 
                                        {...getImgProps(contractorSigVal)}
                                      />
                                    )}
                                  </div>
                                  <div className="border-t border-dashed border-slate-350 pt-[1.5px] leading-none text-[4.8px] font-black text-slate-500 uppercase tracking-tighter">
                                    Signature & Stamp of Contractor
                                  </div>
                                </div>

                                {/* Right: Authorized Railway Representative */}
                                <div className="w-[29mm] flex flex-col justify-end">
                                  <div className="h-[10.5mm] flex flex-col justify-end relative">
                                    {railwaySigVal && (
                                      <div className="absolute bottom-0 left-0 h-[10.5mm] flex items-center justify-start pl-1">
                                        <img 
                                          src={railwaySigVal} 
                                          alt="Railway Representative Signature" 
                                          className="max-h-[10.5mm] w-auto object-contain filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] scale-[1.3] origin-bottom-left" 
                                          {...getImgProps(railwaySigVal)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <div className="border-t border-dashed border-slate-350 pt-[1.5px] leading-none text-[4.6px] font-black text-slate-500 uppercase tracking-tighter">
                                    Countersign & Stamp of Authorized Railway Representative
                                  </div>
                                </div>
                              </div>

                            </div>

                            {/* Right panel: Badge, Photo & Employee Signature */}
                            <div className="w-[21mm] flex flex-col items-center justify-between h-full pl-[1mm] border-l border-slate-100/50">
                              
                              {/* Yellow Badge */}
                              <div className={`w-full py-[1.5px] px-0.5 rounded-[2px] shadow-xs flex items-center justify-center border ${cardTheme.badgeBg}`}>
                                <span className="text-[6.8px] font-black tracking-[0.6px] uppercase whitespace-nowrap leading-none">
                                  IDENTITY CARD
                                </span>
                              </div>

                              {/* Photo Box wrapper allowing overflow stamp */}
                              <div className="relative w-[15.5mm] h-[19mm] shrink-0 mt-[-5px]">
                                <div className="w-full h-full bg-white border-[0.5px] border-slate-400 shadow-sm flex items-center justify-center overflow-hidden rounded-[2px]">
                                  {emp.photoUrl ? (
                                    <img src={emp.photoUrl} alt="Employee" className="w-full h-full object-cover" {...getImgProps(emp.photoUrl)} />
                                  ) : (
                                    <div className="flex flex-col items-center text-slate-300">
                                      <span className="text-[12px] font-black uppercase leading-none">{emp.name.charAt(0)}</span>
                                      <span className="text-[3px] uppercase font-bold tracking-wider mt-0.5">Photo</span>
                                    </div>
                                  )}
                                </div>

                                {/* Contractor Stamp & Signature Overlay - Overlaps photo and body */}
                                {(emp.contractorSigUrl || batchContractorSig) && (
                                  <div className="absolute -bottom-[5mm] -left-[9mm] w-[18mm] h-[18mm] pointer-events-none z-20 transform -rotate-[10deg]">
                                    <img 
                                      src={emp.contractorSigUrl || batchContractorSig} 
                                      alt="Contractor Stamp Overlay" 
                                      className="w-full h-full object-contain filter drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.25)]" 
                                      {...getImgProps(emp.contractorSigUrl || batchContractorSig)}
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Employee Signature */}
                              <div className="w-full flex flex-col items-center mt-1">
                                <div className="h-[8.5mm] w-full flex items-center justify-center relative">
                                  {emp.employeeSigUrl && (
                                    <img 
                                      src={emp.employeeSigUrl} 
                                      alt="Employee Signature" 
                                      className="max-h-full max-w-full object-contain filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] scale-[1.35] origin-center" 
                                      {...getImgProps(emp.employeeSigUrl)}
                                    />
                                  )}
                                </div>
                                <div className="w-full border-t border-dashed border-slate-350 pt-[1px] leading-none text-[4.8px] font-black text-slate-500 uppercase tracking-tighter text-center">
                                  Signature of the Employee
                                </div>
                              </div>

                            </div>
                          </div>

                        </div>

                        {/* BACK SIDE (Standard ID-1/CR-80 Format: 85.6mm x 54.0mm - Landscape) */}
                        <div 
                          style={{ width: "85.6mm", height: "54.0mm" }}
                          className={`id-card-container border-[1px] rounded-[10px] relative shadow-lg flex flex-col overflow-hidden select-none shrink-0 print:shadow-none print:border-[1px] ${cardTheme.bg}`}
                        >
                          {/* Faint Background Watermark Logo */}
                          <div className="id-card-watermark w-[32mm] h-[32mm] opacity-[0.13] pointer-events-none z-0 flex items-center justify-center" style={{ position: 'absolute', left: '50%', top: '33mm', transform: 'translate(-50%, -50%)' }}>
                            {logoToShow ? (
                              <img src={logoToShow} alt="Watermark" className="max-h-full max-w-full object-contain filter grayscale brightness-95" {...getImgProps(logoToShow)} />
                            ) : (
                              <RedRailwayLogo size={100} />
                            )}
                          </div>

                          {/* Top Banner (Header) */}
                          <div className={`h-[11.8mm] flex items-center justify-between px-[3.5mm] relative w-full shrink-0 z-10 ${cardTheme.headerBg}`}>
                            <div className="shrink-0 h-[8.5mm] w-[8.5mm] flex items-center justify-center">
                              {logoToShow ? (
                                <img src={logoToShow} alt="Logo" className="max-h-full max-w-full object-contain" {...getImgProps(logoToShow)} />
                              ) : (
                                <RedRailwayLogo size={28} />
                              )}
                            </div>
                            <div className="flex-1 flex justify-center mx-[1.5mm]">
                              <div className={cardTheme.headerSpanBg}>
                                <span className={`text-[11.2px] font-black tracking-[0.4px] uppercase whitespace-nowrap leading-none ${cardTheme.headerText}`}>
                                  {currentZone}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0 w-[8.5mm]" />
                          </div>

                          {/* Back Body Area */}
                          <div className="relative flex-1 flex flex-col justify-start p-[2.5mm] pt-[1.8mm] pb-[1.8px] z-10 w-full">
                            <div className="space-y-[2.2px] mt-[2.5px] w-full px-[1.5mm]">
                              {/* Father's Name */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">FATHER'S NAME</span>
                                <span className="text-slate-900 font-black pl-2 uppercase truncate min-w-0 max-w-[38mm]">{emp.fatherName || 'N/A'}</span>
                              </div>

                              {/* Mobile No. */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">MOBILE NO.</span>
                                <span className="text-slate-900 font-black pl-2 min-w-0">{emp.mobile || 'N/A'}</span>
                              </div>

                              {/* Date of Entry */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">DATE OF ENTRY IN SERVICE</span>
                                <span className="text-slate-900 font-black pl-2 min-w-0">{emp.doj || ''}</span>
                              </div>

                              {/* Designation */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">DESIGNATION/NATURE OF WORK</span>
                                <span className="text-slate-900 font-black pl-2 uppercase truncate min-w-0 max-w-[38mm]">{emp.designation || 'HELPER'}</span>
                              </div>

                              {/* Department */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">DEPARTMENT</span>
                                <span className="text-slate-900 font-black pl-2 uppercase truncate min-w-0 max-w-[38mm]">
                                  {emp.department || emp.companyDept || 'TRACK MACHINE'}
                                </span>
                              </div>

                              {/* Validity of Date of I-Card */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">VALIDITY OF DATE OF I-CARD</span>
                                <span className="text-[#b91c1c] font-black pl-2 min-w-0">{emp.validityDate || '02/05/2027'}</span>
                              </div>

                              {/* EPF No. */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">EPF NO.</span>
                                <span className="text-slate-900 font-black pl-2 tracking-wide truncate min-w-0 max-w-[38mm]">
                                  {emp.pfNo || '102220971984'}
                                </span>
                              </div>

                              {/* ESIC No. */}
                              <div className="grid grid-cols-[38mm_1fr] min-w-0 items-center text-[8.5px] leading-tight">
                                <span className="text-slate-600 font-extrabold uppercase tracking-tight shrink-0">ESIC NO.</span>
                                <span className="text-slate-900 font-black pl-2 tracking-wide truncate min-w-0 max-w-[38mm]">
                                  {emp.esicNo || 'NA'}
                                </span>
                              </div>
                            </div>
                          </div>

                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Reusable Railway logo SVG
export function RailwayLogo({ className = "", size = 48 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Solid Red Base Circle */}
      <circle cx="50" cy="50" r="49" fill="#da251d" />
      
      {/* Outer White Boundary Rings */}
      <circle cx="50" cy="50" r="47" fill="none" stroke="#ffffff" strokeWidth="1" />
      <circle cx="50" cy="50" r="34" fill="none" stroke="#ffffff" strokeWidth="1.2" />

      {/* Horizontal Track Lines */}
      <g stroke="#ffffff" strokeWidth="0.8" opacity="0.85">
        <line x1="22" y1="38" x2="78" y2="38" />
        <line x1="20" y1="42" x2="80" y2="42" />
        <line x1="19" y1="46" x2="81" y2="46" />
        <line x1="19" y1="50" x2="81" y2="50" />
        <line x1="19" y1="54" x2="81" y2="54" />
        <line x1="20" y1="58" x2="80" y2="58" />
        <line x1="22" y1="62" x2="78" y2="62" />
      </g>

      {/* Streamlined Train Engine */}
      <path d="M 26 71 L 34 64 L 40 40 C 45 33, 55 33, 60 40 L 66 64 L 74 71 Z" fill="#da251d" stroke="#ffffff" strokeWidth="1.2" />
      <line x1="34" y1="64" x2="66" y2="64" stroke="#ffffff" strokeWidth="1" />
      <line x1="36" y1="67" x2="64" y2="67" stroke="#ffffff" strokeWidth="1" />
      <line x1="38" y1="70" x2="62" y2="70" stroke="#ffffff" strokeWidth="1" />

      {/* Central Boiler Shield (Ashoka Emblem) */}
      <circle cx="50" cy="50" r="11" fill="#da251d" stroke="#ffffff" strokeWidth="1.2" />
      <circle cx="50" cy="50" r="9.5" fill="none" stroke="#ffffff" strokeWidth="0.6" />
      <g fill="#ffffff">
        <path d="M 48 43.5 Q 50 42 52 43.5 L 52.5 46 L 47.5 46 Z" />
        <rect x="48.5" y="46.5" width="3" height="4" rx="0.5" />
        <circle cx="50" cy="52" r="1.5" fill="none" stroke="#ffffff" strokeWidth="0.5" />
        <path d="M 46.5 54.5 L 53.5 54.5 L 52.5 56 L 47.5 56 Z" />
      </g>

      {/* Curved Text Top Arc: INDIAN RAILWAYS & भारतीय रेल */}
      <CurvedText
        text="INDIAN RAILWAYS"
        radius={40}
        startAngle={-145}
        endAngle={-35}
        fontSize="6.8px"
        fontWeight="900"
        fill="#ffffff"
      />
      <CurvedText
        text="भारतीय रेल"
        radius={40}
        startAngle={145}
        endAngle={35}
        fontSize="6.2px"
        fontWeight="900"
        fill="#ffffff"
        reverse={true}
      />

      {/* Border Stars */}
      <g fill="#ffffff">
        <polygon points="50,92 51,94.5 53.5,94.5 51.5,96 52.2,98.5 50,97 47.8,98.5 48.5,96 46.5,94.5 49,94.5" />
        <polygon points="40,90.5 41,93 43.5,93 41.5,94.5 42.2,97 40,95.5 37.8,97 38.5,94.5 36.5,93 39,93" />
        <polygon points="60,90.5 61,93 63.5,93 61.5,94.5 62.2,97 60,95.5 57.8,97 58.5,94.5 56.5,93 59,93" />
        <polygon points="30,86 31,88.5 33.5,88.5 31.5,90 32.2,92.5 30,91 27.8,92.5 28.5,90 26.5,88.5 29,88.5" />
        <polygon points="70,86 71,88.5 73.5,88.5 71.5,90 72.2,92.5 70,91 67.8,92.5 68.5,90 66.5,88.5 69,88.5" />
        <polygon points="21,79 22,81.5 24.5,81.5 22.5,83 23.2,85.5 21,84 18.8,85.5 19.5,83 17.5,81.5 20,81.5" />
        <polygon points="79,79 80,81.5 82.5,81.5 80.5,83 81.2,85.5 79,84 76.8,85.5 77.5,83 75.5,81.5 78,81.5" />
      </g>
    </svg>
  );
}
