import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  setDoc,
  addDoc, 
  getDocs,
  writeBatch,
  deleteDoc
} from 'firebase/firestore';
import { findEmployeeForUser, EmployeeProfile } from '../utils/employee';
import { 
  Mail, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Send, 
  CornerUpLeft, 
  ArrowRight, 
  User, 
  FileText, 
  Check, 
  X, 
  CornerDownLeft, 
  Search, 
  RefreshCw,
  Sparkles,
  ClipboardList,
  MessageSquare,
  History,
  ArrowUpRight,
  Edit2,
  Trash2,
  PackageCheck,
  Upload,
  Building2,
  MapPin,
  Train,
  AlertCircle,
  Lock
} from 'lucide-react';
import { generateIssueNotePDF } from '../utils/pdfGenerator';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

// Firebase error handler guidelines conformity
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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
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
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface DemandItem {
  id: string;
  demandNo?: string;
  plNo: string;
  partNo: string;
  description: string;
  qty: number;
  date: string;
  whetherUse: string;
  remarks: string;
  status: 'pending' | 'completed' | 'rejected' | 'returned' | 'approved';
  giveQty?: number;
  approvedRate?: number;
  createdByUid: string;
  createdByEmail: string;
  createdByEmployeeName?: string;
  createdByPfNo?: string;
  forwardedTo: string;
  forwardedToName: string;
  forwardedToEmail: string;
  machineName?: string;
  imageUrl?: string;
  rejectReason?: string;
  forwardedToCompanyAdmin?: boolean;
  forwardedToAdmin?: boolean;
  forwardedToCompanyName?: string;
  forwardedByUid?: string;
  forwardedByEmail?: string;
  forwardedByName?: string;
  forwardedByCompanyName?: string;
  createdByCompanyName?: string;
  lastActionByUid?: string;
  lastActionByEmail?: string;
  lastActionByName?: string;
  lastActionByCompanyName?: string;
  receivedQty?: number;
  receivedDate?: string;
  isInterMachineIssue?: boolean;
  issuedFromMachine?: string;
  receipts?: Array<{
    qty: number;
    date: string;
    remarks?: string;
  }>;
  forwardedAt?: string;
  forwardedToCompanyAdminAt?: string;
  forwardedToAdminAt?: string;
}

interface ProfileRequest {
  id: string;
  name: string;
  email: string;
  designation: string;
  pfNo: string;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  createdAt: string;
  remarks?: string;
  authorityName?: string;
  companyName?: string;
  requestedFieldsDescription?: string;
  photoUrl?: string;
  forwardedToAdmin?: boolean;
  forwardedToCompanyAdmin?: boolean;
  isFullAccessAdmin?: boolean;
  forwardedToCompanyName?: string;
}

interface DemandLog {
  id: string;
  demandId: string;
  plNo: string;
  partNo: string;
  description: string;
  action: 'RETURN' | 'FORWARD' | 'REJECT' | 'APPROVAL';
  remark: string;
  performedByUid: string;
  performedByName: string;
  performedByEmail: string;
  timestamp: string;
  newForwardedToName?: string;
}

export default function Inbox() {
  const navigate = useNavigate();
  const [currentEmployee, setCurrentEmployee] = useState<EmployeeProfile | null>(null);
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [incomingDemands, setIncomingDemands] = useState<DemandItem[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [actionLogs, setActionLogs] = useState<DemandLog[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'demands' | 'profile_requests' | 'history'>('demands');
  
  // Selection & Action states
  const [selectedDemand, setSelectedDemand] = useState<DemandItem | null>(null);
  const [chosenAction, setChosenAction] = useState<'RETURN' | 'FORWARD' | 'REJECT' | 'APPROVAL' | 'FORWARD_TO_ADMIN' | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [forwardEmployeeId, setForwardEmployeeId] = useState('');
  const [approvalGiveQty, setApprovalGiveQty] = useState<number>(0);
  const [approvalRate, setApprovalRate] = useState<number>(0);
  const [submittingAction, setSubmittingAction] = useState(false);

  // States for receiving approved demands in action desk
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [receivedDate, setReceivedDate] = useState<string>('');
  const [receiveLocation, setReceiveLocation] = useState<string>('');
  const [receiveRate, setReceiveRate] = useState<number>(0);
  const [receiveRemarks, setReceiveRemarks] = useState<string>('');
  const [receivingPartStock, setReceivingPartStock] = useState<number>(0);

  // States for resubmitting returned or rejected demands
  const [resubmitQty, setResubmitQty] = useState<number>(0);
  const [resubmitRemarks, setResubmitRemarks] = useState<string>('');

  // Inter-machine Issue Modal state
  const [showIssueModal, setShowIssueModal] = useState<boolean>(false);
  const [issueDemand, setIssueDemand] = useState<any>(null);
  const [issueDescription, setIssueDescription] = useState<string>('');
  const [issuePlNo, setIssuePlNo] = useState<string>('');
  const [issuePartNo, setIssuePartNo] = useState<string>('');
  const [issueQty, setIssueQty] = useState<number>(1);
  const [issueRate, setIssueRate] = useState<number>(0);
  const [issueDate, setIssueDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [issueReceiverName, setIssueReceiverName] = useState<string>('');
  const [issueRemarks, setIssueRemarks] = useState<string>('');
  const [issuingStock, setIssuingStock] = useState<number>(0);
  const [submittingIssue, setSubmittingIssue] = useState<boolean>(false);
  const [targetMachineDetails, setTargetMachineDetails] = useState<{
    machineName: string;
    zone: string;
    division: string;
    companyName: string;
  }>({ machineName: '', zone: '', division: '', companyName: '' });

  const isNaOrEmpty = (val?: string) => {
    if (!val) return true;
    const clean = val.trim().toLowerCase();
    return clean === '' || clean === 'n/a' || clean === 'na' || clean === 'nil' || clean === '-' || clean === 'none';
  };

  const recheckStockForIssue = async (pl: string, part: string) => {
    const myMachine = currentEmployee?.machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
    if (!myMachine) return;

    let foundStock = 0;
    let foundRate = issueRate || issueDemand?.approvedRate || 0;

    try {
      const partsRef = collection(db, 'parts');
      const qParts = query(partsRef, where('machineName', '==', myMachine));
      const snap = await getDocs(qParts);
      snap.docs.forEach(d => {
        const data = d.data();
        const plMatch = pl && data.plNo && data.plNo.trim().toLowerCase() === pl.trim().toLowerCase();
        const partMatch = part && data.partNo && data.partNo.trim().toLowerCase() === part.trim().toLowerCase();
        const descMatch = issueDescription && data.description && data.description.trim().toLowerCase() === issueDescription.trim().toLowerCase();
        if (plMatch || partMatch || descMatch) {
          foundStock += Number(data.stock || 0);
          if (data.rate) foundRate = Number(data.rate);
        }
      });
    } catch (err) {
      console.error('Error rechecking issuing stock:', err);
    }

    setIssuingStock(foundStock);
    if (foundRate > 0) setIssueRate(foundRate);
  };

  const handleOpenIssueModal = async (demand: any) => {
    setIssueDemand(demand);
    setIssueDescription(demand.description || '');
    setIssuePlNo(demand.plNo || '');
    setIssuePartNo(demand.partNo || '');
    setIssueDate(format(new Date(), 'yyyy-MM-dd'));
    setIssueReceiverName(demand.createdByEmployeeName || 'Consignee Officer');
    setIssueRemarks(''); // Clear remarks so "Voucher Noted" or preset text is not hardcoded

    // 1. Fetch Target / Requesting Machine Details from machine_movements & employees
    const receivingMachine = demand.requestingMachineName || demand.machineName || '';
    let fetchedZone = demand.requestingZone || demand.zone || 'SECR';
    let fetchedDivision = demand.requestingDivision || demand.division || 'Raipur';
    let fetchedCompany = demand.requestingCompanyName || demand.createdByCompanyName || '';

    if (receivingMachine) {
      try {
        const qMov = query(collection(db, 'machine_movements'), where('machineName', '==', receivingMachine));
        const snapMov = await getDocs(qMov);
        if (!snapMov.empty) {
          const movs = snapMov.docs.map(d => d.data());
          movs.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
          const latestMov = movs[0];
          if (latestMov.toZone || latestMov.zone) fetchedZone = latestMov.toZone || latestMov.zone;
          if (latestMov.toDivision || latestMov.division) fetchedDivision = latestMov.toDivision || latestMov.division;
          if (latestMov.companyName) fetchedCompany = latestMov.companyName;
        }

        if (!fetchedCompany) {
          const qEmp = query(collection(db, 'employees'), where('machineName', '==', receivingMachine));
          const snapEmp = await getDocs(qEmp);
          if (!snapEmp.empty) {
            const empData = snapEmp.docs[0].data();
            if (empData.companyName) fetchedCompany = empData.companyName;
            if (empData.zone) fetchedZone = empData.zone;
            if (empData.division) fetchedDivision = empData.division;
          }
        }
      } catch (err) {
        console.warn('Error fetching machine details:', err);
      }
    }

    setTargetMachineDetails({
      machineName: receivingMachine || 'N/A',
      zone: fetchedZone || 'SECR',
      division: fetchedDivision || 'Raipur',
      companyName: fetchedCompany || 'N/A'
    });

    // 2. Lookup stock for this item in issuing machine's inventory (parts collection)
    const myMachine = currentEmployee?.machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
    let foundStock = 0;
    let foundRate = demand.approvedRate || 0;

    if (myMachine && (demand.plNo || demand.partNo)) {
      try {
        const partsRef = collection(db, 'parts');
        const qParts = query(partsRef, where('machineName', '==', myMachine));
        const snap = await getDocs(qParts);
        snap.docs.forEach(d => {
          const data = d.data();
          const plMatch = demand.plNo && data.plNo && data.plNo.trim().toLowerCase() === demand.plNo.trim().toLowerCase();
          const partMatch = demand.partNo && data.partNo && data.partNo.trim().toLowerCase() === demand.partNo.trim().toLowerCase();
          if (plMatch || partMatch) {
            foundStock += Number(data.stock || 0);
            if (data.rate) foundRate = Number(data.rate);
          }
        });
      } catch (err) {
        console.error('Error looking up issuing stock:', err);
      }
    }
    
    setIssuingStock(foundStock);
    setIssueRate(foundRate);

    // Default quantity to max available stock up to requested quantity
    const defaultQty = foundStock > 0 ? Math.min(demand.qty || 1, foundStock) : 0;
    setIssueQty(defaultQty);

    setShowIssueModal(true);
  };

  const handleConfirmIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueDemand) return;

    if (issuingStock <= 0) {
      toast.error('Depot has 0 stock available. Cannot issue material until stock is added.');
      return;
    }

    const validQty = Math.max(0.001, Number(issueQty) || 0);
    const validRate = Math.max(0, Number(issueRate) || 0);

    if (validQty <= 0) {
      toast.error('Please enter a valid issue quantity greater than 0.');
      return;
    }

    if (validQty > issuingStock) {
      const uom = issueDemand.unit || 'units';
      toast.error(`Cannot issue ${validQty} ${uom}. Maximum available depot stock is ${issuingStock} ${uom}.`);
      return;
    }

    setSubmittingIssue(true);
    try {
      const generatedIssueNoteNo = `ISS-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`;
      const issuingMachine = currentEmployee?.machineName || localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      const receivingMachine = targetMachineDetails.machineName || issueDemand.requestingMachineName || issueDemand.machineName || '';

      const finalPlNo = issuePlNo.trim() || issueDemand.plNo || '';
      const finalPartNo = issuePartNo.trim() || issueDemand.partNo || '';

      // 1. Deduct stock from issuing machine's parts inventory if available
      if (issuingMachine && (finalPlNo || finalPartNo || issueDescription)) {
        try {
          const partsRef = collection(db, 'parts');
          const qParts = query(partsRef, where('machineName', '==', issuingMachine));
          const snap = await getDocs(qParts);
          let remToDeduct = validQty;

          for (const docSnap of snap.docs) {
            if (remToDeduct <= 0) break;
            const pData = docSnap.data();
            const plMatch = finalPlNo && pData.plNo && pData.plNo.trim().toLowerCase() === finalPlNo.toLowerCase();
            const partMatch = finalPartNo && pData.partNo && pData.partNo.trim().toLowerCase() === finalPartNo.toLowerCase();
            const descMatch = issueDescription && pData.description && pData.description.trim().toLowerCase() === issueDescription.trim().toLowerCase();
            
            if (plMatch || partMatch || descMatch) {
              const currentPStock = Number(pData.stock || 0);
              const deductAmt = Math.min(currentPStock, remToDeduct);
              const newPStock = Math.max(0, currentPStock - deductAmt);
              remToDeduct -= deductAmt;

              const itemRate = Number(pData.rate) || validRate || 0;
              await updateDoc(doc(db, 'parts', docSnap.id), {
                stock: newPStock,
                totalValue: newPStock * itemRate,
                updatedAt: new Date().toISOString()
              });
            }
          }
        } catch (partsErr) {
          console.warn('Could not update parts inventory stock:', partsErr);
        }
      }

      // 2. Update Demand document
      const demandRef = doc(db, 'demands', issueDemand.id);
      const targetZone = targetMachineDetails.zone || issueDemand.requestingZone || issueDemand.zone || 'SECR';
      const targetDivision = targetMachineDetails.division || issueDemand.requestingDivision || issueDemand.division || 'Raipur';
      const targetCompany = targetMachineDetails.companyName || issueDemand.requestingCompanyName || issueDemand.createdByCompanyName || '';

      const updatedDesc = issueDescription.trim() || issueDemand.description || '';

      await updateDoc(demandRef, {
        status: 'approved',
        description: updatedDesc,
        plNo: finalPlNo,
        partNo: finalPartNo,
        giveQty: validQty,
        approvedRate: validRate,
        isInterMachineIssue: true,
        issuedFromMachine: issuingMachine || '',
        issuedToMachine: receivingMachine || '',
        issuedToZone: targetZone || 'SECR',
        issuedToDivision: targetDivision || 'Raipur',
        issuedToCompany: targetCompany || '',
        issueVoucherNo: generatedIssueNoteNo,
        issueRemarks: issueRemarks || '',
        remarks: `Issued ${validQty} pcs to ${receivingMachine || 'Machine'}. Voucher: ${generatedIssueNoteNo}`,
        lastActionByUid: auth.currentUser?.uid || '',
        lastActionByName: 'ADMIN',
        lastActionByEmail: auth.currentUser?.email || '',
        lastActionByCompanyName: currentEmployee?.companyName || '',
        issuedAt: new Date().toISOString()
      });

      // 3. Log into demand_logs
      await addDoc(collection(db, 'demand_logs'), {
        demandId: issueDemand.id || '',
        plNo: finalPlNo,
        partNo: finalPartNo,
        description: updatedDesc,
        action: 'APPROVAL',
        remark: `Issued ${validQty} pcs to ${receivingMachine || 'Machine'} (${targetZone}/${targetDivision}). Voucher: ${generatedIssueNoteNo}`,
        performedByUid: auth.currentUser?.uid || '',
        performedByName: 'ADMIN',
        performedByEmail: auth.currentUser?.email || '',
        timestamp: new Date().toISOString()
      });

      // 4. Log transaction record
      await addDoc(collection(db, 'transactions'), {
        voucherNo: generatedIssueNoteNo,
        date: issueDate || format(new Date(), 'yyyy-MM-dd'),
        plNo: finalPlNo,
        partNo: finalPartNo,
        description: updatedDesc,
        qty: validQty,
        rate: validRate,
        type: 'issued',
        machineName: issuingMachine || '',
        issuedToMachine: receivingMachine || '',
        receiverName: issueReceiverName || '',
        remarks: issueRemarks || '',
        createdByUid: auth.currentUser?.uid || '',
        createdByEmail: auth.currentUser?.email || '',
        createdAt: new Date().toISOString()
      });

      // 5. Generate & download Issue Note PDF
      const issuerName = currentEmployee?.name || auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'DEPOT OFFICIAL';
      const issuerDesignation = currentEmployee?.designation || '';
      try {
        await generateIssueNotePDF({
          issueNoteNo: generatedIssueNoteNo,
          date: issueDate || format(new Date(), 'yyyy-MM-dd'),
          plNo: finalPlNo || 'N/A',
          partNo: finalPartNo || 'N/A',
          description: updatedDesc,
          qty: validQty,
          rate: validRate,
          totalValue: validQty * validRate,
          issuingDepot: issuingMachine || 'Depot',
          machineName: receivingMachine || 'N/A',
          issuedTo: issueReceiverName || 'Consignee Officer',
          issuedBy: issuerName,
          officerName: issuerName,
          officerDesignation: issuerDesignation,
          consigneeDepot: receivingMachine ? `SSE/TM/${receivingMachine}` : 'Consignee Officer',
          remarks: issueRemarks || '',
          zone: targetZone || 'SECR'
        }, true);
      } catch (pdfErr) {
        console.error('PDF generation error:', pdfErr);
      }

      toast.success(`Item issued successfully! Sent to ${receivingMachine || 'target machine'}'s inbox.`);
      setShowIssueModal(false);
      setIssueDemand(null);
    } catch (err: any) {
      console.error('Error performing issue:', err);
      let errMsg = 'Failed to issue item.';
      if (err?.message) {
        errMsg = err.message;
        if (errMsg.startsWith('{')) {
          try {
            const parsed = JSON.parse(errMsg);
            errMsg = parsed.error || errMsg;
          } catch (e) {}
        }
      }
      toast.error(`Error performing issue: ${errMsg}`);
    } finally {
      setSubmittingIssue(false);
    }
  };

  const isEmployeeEmail = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const isAdmin = !isEmployeeEmail;
  const isAuthorizedForLogs = !isEmployeeEmail;

  // Action Logs Edit state
  const [editingLog, setEditingLog] = useState<DemandLog | null>(null);
  const [editLogRemark, setEditLogRemark] = useState('');
  const [editLogAction, setEditLogAction] = useState<'RETURN' | 'FORWARD' | 'REJECT' | 'APPROVAL'>('APPROVAL');

  const handleExportActionLogs = () => {
    const dataToExport = actionLogs.map(log => ({
      'Item Type / Details': log.plNo && (log.plNo.startsWith('PF:') || log.plNo === 'PROFILE') ? `👥 ${log.plNo}` : `📦 PL: ${log.plNo}`,
      Description: log.description || '',
      Action: log.action || '',
      Remark: log.remark || '',
      'Processed By': log.performedByName || '',
      Timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : ''
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Action History & Reports");
    XLSX.writeFile(wb, `Action_Logs_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Action logs exported successfully!');
  };

  const handleEditLog = (log: DemandLog) => {
    setEditingLog(log);
    setEditLogRemark(log.remark || '');
    setEditLogAction(log.action || 'APPROVAL');
  };

  const handleSaveEditLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLog) return;
    try {
      await updateDoc(doc(db, 'demand_logs', editingLog.id), {
        remark: editLogRemark,
        action: editLogAction,
      });
      toast.success('Action log updated successfully');
      setEditingLog(null);
    } catch (error) {
      console.error('Error updating log:', error);
      toast.error('Failed to update action log');
    }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!window.confirm('Are you sure you want to delete this action log? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'demand_logs', logId));
      toast.success('Action log deleted successfully');
    } catch (error) {
      console.error('Error deleting log:', error);
      toast.error('Failed to delete action log');
    }
  };

  // Sync receiving fields and fetch part stock when selected demand changes
  useEffect(() => {
    if (!selectedDemand) {
      setReceivingPartStock(0);
      return;
    }
    
    // Set initial receipt fields
    const allowedGiveQty = selectedDemand.giveQty !== undefined ? selectedDemand.giveQty : selectedDemand.qty;
    setReceivedQty(Math.max(0, allowedGiveQty - (selectedDemand.receivedQty || 0)));
    setReceivedDate(new Date().toISOString().split('T')[0]);
    setReceiveLocation('');
    setReceiveRate(selectedDemand.approvedRate || 0);
    setReceiveRemarks('');

    setApprovalGiveQty(allowedGiveQty);
    setApprovalRate(selectedDemand.approvedRate || 0);

    // Set initial resubmit fields
    setResubmitQty(selectedDemand.qty);
    setResubmitRemarks('');

    const fetchPartStock = async () => {
      try {
        let partsQuery;
        if (selectedDemand.plNo) {
          partsQuery = query(collection(db, 'parts'), where('plNo', '==', selectedDemand.plNo));
        } else if (selectedDemand.partNo) {
          partsQuery = query(collection(db, 'parts'), where('partNo', '==', selectedDemand.partNo));
        }
        if (partsQuery) {
          const snap = await getDocs(partsQuery);
          if (!snap.empty) {
            const allParts: any[] = snap.docs.map(docSnap => Object.assign({ id: docSnap.id }, docSnap.data()));
            
            // 1. Fetch stock for receiving user's machine
            const currentUserMachine = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
            const userPart = allParts.find(p => p.machineName && currentUserMachine && p.machineName.trim().toLowerCase() === currentUserMachine.trim().toLowerCase());
            
            if (userPart) {
              setReceivingPartStock(userPart.stock || 0);
            } else {
              setReceivingPartStock(allParts[0].stock || 0);
            }

            // 2. Fetch rate from issuer machine or approvedRate
            let issuerRate = selectedDemand.approvedRate || 0;
            if (!issuerRate) {
              const issuerMachine = selectedDemand.machineName || selectedDemand.forwardedByCompanyName || '';
              const issuerPart = allParts.find(p => p.machineName && issuerMachine && p.machineName.trim().toLowerCase() === issuerMachine.trim().toLowerCase());
              if (issuerPart && issuerPart.rate) {
                issuerRate = issuerPart.rate;
              } else {
                const partWithRate = allParts.find(p => p.rate && p.rate > 0);
                if (partWithRate) {
                  issuerRate = partWithRate.rate;
                } else if (allParts[0] && allParts[0].rate) {
                  issuerRate = allParts[0].rate;
                }
              }
            }

            if (issuerRate) {
              setReceiveRate(issuerRate);
              setApprovalRate(prev => prev || issuerRate);
            }
          } else {
            setReceivingPartStock(0);
          }
        }
      } catch (e) {
        console.error("Error fetching part stock:", e);
      }
    };
    fetchPartStock();
  }, [selectedDemand]);

  // Profile requests approvals additional states
  const [requestRemarks, setRequestRemarks] = useState<Record<string, string>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});
  const [actioningRequest, setActioningRequest] = useState<string | null>(null);

  // Profile Request Forwarding Modal States
  const [profileRequestToForward, setProfileRequestToForward] = useState<any | null>(null);
  const [selectedProfileForwardEmployeeId, setSelectedProfileForwardEmployeeId] = useState<string>('');
  const [showProfileForwardModal, setShowProfileForwardModal] = useState<boolean>(false);

  const [forwardCompanyName, setForwardCompanyName] = useState('');
  const [selectedProfileForwardCompanyName, setSelectedProfileForwardCompanyName] = useState<string>('');

  // Extract all unique company names dynamically from all employees
  const uniqueCompanies = React.useMemo(() => {
    const cos = new Set<string>();
    allEmployees.forEach(emp => {
      if (emp.companyName && emp.companyName.trim()) {
        cos.add(emp.companyName.trim());
      }
    });
    return Array.from(cos).sort();
  }, [allEmployees]);

  const getRequesterText = (demand: DemandItem) => {
    const email = demand.createdByEmail || '';
    const empName = demand.createdByEmployeeName || '';
    const pfNo = demand.createdByPfNo || '';

    const matchedEmp = allEmployees.find(emp => 
      (emp.email && email && emp.email.toLowerCase() === email.toLowerCase()) ||
      (emp.pfNo && pfNo && emp.pfNo.toLowerCase() === pfNo.toLowerCase()) ||
      (emp.id && demand.createdByUid && emp.id === demand.createdByUid)
    );

    const isEmployeeEmail = email.endsWith('@employee.billedapp.com');
    const isAdmin = !email || !isEmployeeEmail || empName.toLowerCase().includes('admin') || empName.endsWith('@billedapp.com');

    if (isAdmin) {
      let adminName = empName && !empName.endsWith('@employee.billedapp.com') ? empName : '';
      if (!adminName) {
        adminName = demand.createdByCompanyName ? `Admin (${demand.createdByCompanyName})` : 'Admin';
      }
      return adminName;
    } else {
      const name = matchedEmp?.name || empName || (email ? email.replace('@employee.billedapp.com', '') : 'Employee');
      const id = matchedEmp?.pfNo || pfNo || (email ? email.split('@')[0] : '');
      return `${name}${id ? ` (ID: ${id})` : ''}`;
    }
  };

  // Load context
  useEffect(() => {
    async function loadContext() {
      if (!auth.currentUser) return;
      try {
        const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
        setCurrentEmployee(emp);

        // Fetch all employees for diff display and forwarding
        const qEmp = query(collection(db, 'employees'));
        const snapEmp = await getDocs(qEmp);
        const listEmp = snapEmp.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllEmployees(listEmp);
      } catch (error) {
        console.error('Error loading inbox details:', error);
      } finally {
        setLoading(false);
      }
    }
    loadContext();
  }, []);

  // Listen to profile requests
  useEffect(() => {
    if (!auth.currentUser) return;
    const isEmployeeEmail = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const isAdmin = !isEmployeeEmail;

    // Query all profile requests to allow robust local filtering (including forwarded items)
    const q = query(collection(db, 'profile_requests'));

    const unsub = onSnapshot(q, (snap) => {
      let list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      
      list = list.filter(r => {
        // Always show to the creator
        if (r.uid === auth.currentUser?.uid) return true;
        
        // Show if specifically forwarded to the current employee (by ID or Email)
        const isForwardedToMe = r.forwardedTo === currentEmployee?.employeeId || (auth.currentUser?.email && r.forwardedToEmail?.toLowerCase() === auth.currentUser.email.toLowerCase());
        if (isForwardedToMe) return true;
        
        // Otherwise, apply default role-based visibility:
        if (currentEmployee && currentEmployee.accessType === 'full') {
          const myCompany = currentEmployee.companyName;
          const myMachine = currentEmployee.machineName;
          return r.companyName === myCompany && r.machineName === myMachine;
        } else if (currentEmployee && currentEmployee.accessType === 'admin-light') {
          const myCompany = currentEmployee.companyName;
          return r.companyName === myCompany || (r.forwardedToCompanyName === myCompany && r.forwardedToCompanyAdmin === true);
        }
        
        // Standard employee doesn't see other people's requests unless specifically forwarded to them (handled above)
        return false;
      });

      // Sort newest first
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProfileRequests(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'profile_requests');
    });

    return () => unsub();
  }, [currentEmployee]);

  // Listen to demands sent to current employee
  useEffect(() => {
    const path = 'demands';
    const unsub = onSnapshot(collection(db, 'demands'), (snap) => {
      const allDemands = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DemandItem[];
      
      // Filter demands sent to me
      // Show if current user's email matches forwardedToEmail OR employeeId matches forwardedTo
      const myDemands = allDemands.filter(d => {
        // Self-created / demanded by current user
        const isSelfCreated = Boolean(
          (d.createdByUid && d.createdByUid === auth.currentUser?.uid) ||
          (d.createdByEmail && auth.currentUser?.email && d.createdByEmail.toLowerCase() === auth.currentUser.email.toLowerCase()) ||
          (currentEmployee?.pfNo && d.createdByPfNo && d.createdByPfNo.toLowerCase() === currentEmployee.pfNo.toLowerCase())
        );

        // Pending demands explicitly assigned / sent to me or my company
        const isTargetEmail = Boolean(auth.currentUser?.email && d.forwardedToEmail?.toLowerCase() === auth.currentUser.email.toLowerCase());
        const isTargetId = Boolean(currentEmployee?.employeeId && d.forwardedTo === currentEmployee.employeeId);
        
        let isCompanyAdminMatch = false;
        if (currentEmployee?.accessType === 'admin-light' && d.forwardedToCompanyAdmin) {
          if (d.forwardedToCompanyName) {
            isCompanyAdminMatch = d.forwardedToCompanyName.toLowerCase() === currentEmployee.companyName?.toLowerCase();
          } else {
            const creator = allEmployees.find(emp => 
              (emp.email && d.createdByEmail && emp.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
              (emp.pfNo && d.createdByPfNo && emp.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
              (emp.uid && d.createdByUid && emp.uid === d.createdByUid)
            );
            const demandCompany = creator ? creator.companyName || '' : '';
            isCompanyAdminMatch = demandCompany === currentEmployee.companyName;
          }
        }

        // Rule: Show ONLY items in pending if explicitly SENT/FORWARDED to me ("jisko bheja jaye")
        // and do NOT show self-demanded items in pending ("jo demand kiya jaye wah inbox me show n kare")
        const isPendingForMe = (() => {
          if (isSelfCreated) return false;

          const isTargetMatch = isTargetEmail || isTargetId || isCompanyAdminMatch;
          if (!isTargetMatch) return false;
          
          if (d.status === 'pending') return true;
          
          // Company Admin (admin-light) should see approved demands in their inbox until they've approved the full requested quantity
          if (currentEmployee?.accessType === 'admin-light' && d.status === 'approved') {
            const totalGiven = d.giveQty || 0;
            return totalGiven < d.qty;
          }
          
          return false;
        })();

        // Check if current user or their company took the last action/decision
        const isLastActionTakerUid = d.lastActionByUid && d.lastActionByUid === auth.currentUser?.uid;
        const isLastActionTakerEmail = d.lastActionByEmail && auth.currentUser?.email && d.lastActionByEmail.toLowerCase() === auth.currentUser.email.toLowerCase();
        const isLastActionTakerCompany = currentEmployee?.accessType === 'admin-light' && d.lastActionByCompanyName && d.lastActionByCompanyName.toLowerCase() === currentEmployee.companyName?.toLowerCase();

        const isCurrentActionTaker = isLastActionTakerUid || isLastActionTakerEmail || isLastActionTakerCompany;

        // Approved, returned, or rejected demands waiting to be seen/received by the sender or creator
        let isActionedResultForMe = false;
        if (['approved', 'returned', 'rejected'].includes(d.status)) {
          if (d.isInterMachineIssue && currentEmployee?.machineName && d.machineName === currentEmployee.machineName) {
            // Show inter-machine issues to the recipient machine's inbox
            isActionedResultForMe = true;
          } else if (!isCurrentActionTaker) {
            const isSenderUid = d.forwardedByUid && d.forwardedByUid === auth.currentUser?.uid;
            const isSenderEmail = d.forwardedByEmail && auth.currentUser?.email && d.forwardedByEmail.toLowerCase() === auth.currentUser.email.toLowerCase();
            const isCreatorUid = d.createdByUid && d.createdByUid === auth.currentUser?.uid;
            const isCreatorEmail = d.createdByEmail && auth.currentUser?.email && d.createdByEmail.toLowerCase() === auth.currentUser.email.toLowerCase();

            // Handle company-to-company approved/returned/rejected items showing for the sender company admin
            const isSenderCompanyMatch = currentEmployee?.accessType === 'admin-light' && d.forwardedByCompanyName && d.forwardedByCompanyName.toLowerCase() === currentEmployee.companyName?.toLowerCase();
            const isCreatorCompanyMatch = currentEmployee?.accessType === 'admin-light' && d.createdByCompanyName && d.createdByCompanyName.toLowerCase() === currentEmployee.companyName?.toLowerCase();

            isActionedResultForMe = isSenderUid || isSenderEmail || isCreatorUid || isCreatorEmail || isSenderCompanyMatch || isCreatorCompanyMatch;
          }
        }

        return isPendingForMe || isActionedResultForMe;
      });

      // Sort newest first
      myDemands.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setIncomingDemands(myDemands);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsub();
  }, [currentEmployee]);

  // Listen to action logs reports
  useEffect(() => {
    if (!auth.currentUser) return;
    const path = 'demand_logs';
    const unsub = onSnapshot(collection(db, 'demand_logs'), (snap) => {
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DemandLog[];
      // Filter logs relevant to current user: either they performed it, or they are admin
      const isEmployeeEmail = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
      const filtered = logs.filter(l => {
        if (!isEmployeeEmail) return true; // admin sees all
        return l.performedByUid === auth.currentUser?.uid;
      });
      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setActionLogs(filtered);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsub();
  }, []);

  const getChangeDiff = (request: any) => {
    const original = allEmployees.find(emp => emp.id === request.employeeId || emp.employeeId === request.employeeId);
    if (!original) return null;

    const changes = [];
    if (original.name !== request.name) {
      changes.push({ label: 'Name (नाम)', oldVal: original.name, newVal: request.name });
    }
    if (original.mobile !== request.mobile) {
      changes.push({ label: 'Mobile (मोबाइल)', oldVal: original.mobile, newVal: request.mobile });
    }
    if (original.designation !== request.designation) {
      changes.push({ label: 'Designation (पद)', oldVal: original.designation, newVal: request.designation });
    }
    if ((original.address || '') !== (request.address || '')) {
      changes.push({ label: 'Address (पता)', oldVal: original.address || 'None', newVal: request.address || 'None' });
    }
    if ((original.dob || '') !== (request.dob || '')) {
      changes.push({ label: 'DOB (जन्म तिथि)', oldVal: original.dob || 'None', newVal: request.dob || 'None' });
    }
    if ((original.pfNo || '') !== (request.pfNo || '')) {
      changes.push({ label: 'PF Number (पीएफ संख्या)', oldVal: original.pfNo || 'None', newVal: request.pfNo || 'None' });
    }
    if ((original.esicNo || '') !== (request.esicNo || '')) {
      changes.push({ label: 'ESIC Number (ईएसआईसी संख्या)', oldVal: original.esicNo || 'None', newVal: request.esicNo || 'None' });
    }
    if (original.doj !== request.doj) {
      changes.push({ label: 'Date of Joining (ज्वाइनिंग तिथि)', oldVal: original.doj, newVal: request.doj });
    }
    
    // Extended Full Form Fields
    if ((original.fatherName || '') !== (request.fatherName || '')) {
      changes.push({ label: "Father's Name (पिता का नाम)", oldVal: original.fatherName || 'None', newVal: request.fatherName || 'None' });
    }
    if ((original.age || '') !== (request.age || '')) {
      changes.push({ label: 'Age (उम्र)', oldVal: original.age || 'None', newVal: request.age || 'None' });
    }
    if ((original.validityDate || '') !== (request.validityDate || '')) {
      changes.push({ label: 'Validity Date (वैधता तिथि)', oldVal: original.validityDate || 'None', newVal: request.validityDate || 'None' });
    }
    if ((original.department || '') !== (request.department || '')) {
      changes.push({ label: 'Department (विभाग)', oldVal: original.department || 'None', newVal: request.department || 'None' });
    }
    if ((original.idNo || '') !== (request.idNo || '')) {
      changes.push({ label: 'ID No (आईडी संख्या)', oldVal: original.idNo || 'None', newVal: request.idNo || 'None' });
    }
    if ((original.aadharNo || '') !== (request.aadharNo || '')) {
      changes.push({ label: 'Aadhar No (आधार)', oldVal: original.aadharNo || 'None', newVal: request.aadharNo || 'None' });
    }
    if ((original.panNo || '') !== (request.panNo || '')) {
      changes.push({ label: 'PAN No (पैन संख्या)', oldVal: original.panNo || 'None', newVal: request.panNo || 'None' });
    }
    if ((original.accountNo || '') !== (request.accountNo || '')) {
      changes.push({ label: 'Account No (खाता संख्या)', oldVal: original.accountNo || 'None', newVal: request.accountNo || 'None' });
    }
    if ((original.ifscCode || '') !== (request.ifscCode || '')) {
      changes.push({ label: 'IFSC Code (आईएफएससी)', oldVal: original.ifscCode || 'None', newVal: request.ifscCode || 'None' });
    }
    if ((original.bankName || '') !== (request.bankName || '')) {
      changes.push({ label: 'Bank Name (बैंक का नाम)', oldVal: original.bankName || 'None', newVal: request.bankName || 'None' });
    }
    if ((original.branch || '') !== (request.branch || '')) {
      changes.push({ label: 'Branch (शाखा)', oldVal: original.branch || 'None', newVal: request.branch || 'None' });
    }
    if ((original.zone || '') !== (request.zone || '')) {
      changes.push({ label: 'Railway Zone (रेलवे जोन)', oldVal: original.zone || 'None', newVal: request.zone || 'None' });
    }
    if ((original.division || '') !== (request.division || '')) {
      changes.push({ label: 'Railway Division (रेलवे मंडल)', oldVal: original.division || 'None', newVal: request.division || 'None' });
    }

    if ((original.photoUrl || '') !== (request.photoUrl || '')) {
      changes.push({ 
        label: 'Photo (फोटो)', 
        oldVal: 'Old Photo', 
        newVal: 'New Photo', 
        isPhoto: true, 
        oldPhoto: original.photoUrl, 
        newPhoto: request.photoUrl 
      });
    }
    if ((original.employeeSigUrl || '') !== (request.employeeSigUrl || '')) {
      changes.push({ 
        label: 'Signature (हस्ताक्षर)', 
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

  const getFilteredProfileRequests = () => {
    if (allEmployees.length === 0) return profileRequests;
    return profileRequests.filter(req => {
      const diff = getChangeDiff(req);
      return diff === null || diff.length > 0;
    });
  };

  const handleApproveRequest = async (request: any) => {
    setActioningRequest(request.id);
    try {
      // Find matching employee document id (could be pfNo, id or employeeId match)
      const targetEmp = allEmployees.find(emp => emp.id === request.employeeId || emp.employeeId === request.employeeId);
      if (!targetEmp) {
        toast.error('Associated employee document not found.');
        setActioningRequest(null);
        return;
      }

      // 1. Update the employee document
      const empRef = doc(db, 'employees', targetEmp.id);
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
        sex: request.sex || '',
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
      const performerName = currentEmployee?.name || user?.email || 'Employee';
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
    } catch (error) {
      console.error('Error approving profile request:', error);
      toast.error('Failed to approve profile update.');
      handleFirestoreError(error, OperationType.UPDATE, `profile_requests/${request.id}`);
    } finally {
      setActioningRequest(null);
    }
  };

  const handleRejectRequest = async (request: any) => {
    const remarks = requestRemarks[request.id]?.trim();
    if (!remarks) {
      toast.error('Please enter a reason/remarks for rejecting this request (अस्वीकार करने का कारण लिखना आवश्यक है).');
      return;
    }

    setActioningRequest(request.id);
    try {
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
      const performerName = currentEmployee?.name || user?.email || 'Employee';
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
    } catch (error) {
      console.error('Error rejecting profile request:', error);
      toast.error('Failed to reject profile request.');
      handleFirestoreError(error, OperationType.UPDATE, `profile_requests/${request.id}`);
    } finally {
      setActioningRequest(null);
    }
  };

  const handleReturnRequest = async (request: any) => {
    const remarks = requestRemarks[request.id]?.trim();
    if (!remarks) {
      toast.error('Please enter correction remarks to return this request (वापस भेजने के लिए आवश्यक संशोधन टिप्पणी लिखना आवश्यक है).');
      return;
    }

    setActioningRequest(request.id);
    try {
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
      const performerName = currentEmployee?.name || user?.email || 'Employee';
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
    } catch (error) {
      console.error('Error returning profile request:', error);
      toast.error('Failed to return profile request.');
      handleFirestoreError(error, OperationType.UPDATE, `profile_requests/${request.id}`);
    } finally {
      setActioningRequest(null);
    }
  };

  const handleForwardRequest = async (request: any, targetEmployee: any) => {
    setActioningRequest(request.id);
    try {
      const remarks = requestRemarks[request.id]?.trim() || '';
      const reqRef = doc(db, 'profile_requests', request.id);
      
      const targetEmp = allEmployees.find(emp => emp.id === request.employeeId || emp.employeeId === request.employeeId);
      const companyName = targetEmp?.companyName || request.companyName || '';

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

      // Create notification for the recipient employee
      if (targetEmployee.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: targetEmployee.email,
          title: 'Profile Request Forwarded to You',
          message: `A profile update request for ${request.name} has been forwarded to you by ${currentEmployee?.name || 'an Admin'} for review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // Add to Action History Reports
      const user = auth.currentUser;
      const performerName = currentEmployee?.name || user?.email || 'Employee';
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
    } catch (error) {
      console.error('Error forwarding profile request:', error);
      toast.error('Failed to forward profile request.');
      handleFirestoreError(error, OperationType.UPDATE, `profile_requests/${request.id}`);
    } finally {
      setActioningRequest(null);
    }
  };

  const handleForwardRequestToCompany = async (request: any, targetCompanyName: string) => {
    setActioningRequest(request.id);
    try {
      const remarks = requestRemarks[request.id]?.trim() || '';
      const reqRef = doc(db, 'profile_requests', request.id);
      
      const targetAdminLight = allEmployees.find(emp => emp.accessType === 'admin-light' && emp.companyName === targetCompanyName);

      await updateDoc(reqRef, {
        forwardedTo: targetAdminLight?.id || '',
        forwardedToName: targetAdminLight?.name || `Company Admin of ${targetCompanyName}`,
        forwardedToEmail: targetAdminLight?.email || '',
        forwardedToAdmin: false,
        forwardedToCompanyAdmin: true,
        forwardedToCompanyName: targetCompanyName,
        forwardedAt: new Date().toISOString(),
        remarks: remarks || request.remarks || ''
      });

      // Create a notification for the user about forwarding
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Forwarded',
          message: `Your profile update request was forwarded to ${targetCompanyName} Company Admin for review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // Create notification for the recipient company admin if found
      if (targetAdminLight?.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: targetAdminLight.email,
          title: 'Profile Request Forwarded to Your Company',
          message: `A profile update request for ${request.name} has been forwarded to your company (${targetCompanyName}) by ${currentEmployee?.name || 'an Admin'} for review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      // Add to Action History Reports
      const user = auth.currentUser;
      const performerName = currentEmployee?.name || user?.email || 'Employee';
      const performerEmail = user?.email || '';
      await addDoc(collection(db, 'demand_logs'), {
        demandId: request.id,
        plNo: request.pfNo ? `PF: ${request.pfNo}` : 'PROFILE',
        partNo: request.designation || 'Profile Update',
        description: `Profile Update Request for ${request.name}`,
        action: 'FORWARD',
        remark: remarks || `Forwarded to ${targetCompanyName} Company Admin.`,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString(),
        newForwardedToName: `${targetCompanyName} (Company Admin)`
      });

      toast.success(`Profile update request forwarded to ${targetCompanyName} successfully!`);
    } catch (error) {
      console.error('Error forwarding profile request to company:', error);
      toast.error('Failed to forward profile request to company.');
      handleFirestoreError(error, OperationType.UPDATE, `profile_requests/${request.id}`);
    } finally {
      setActioningRequest(null);
    }
  };

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemand || !chosenAction) return;

    if (!actionRemark.trim()) {
      toast.error('Remark is required to proceed (टिप्पणी लिखना आवश्यक है)');
      return;
    }

    if (chosenAction === 'FORWARD' && !forwardEmployeeId) {
      toast.error('Please select an employee to forward to (कृपया आगे भेजने के लिए कर्मचारी का चयन करें)');
      return;
    }

    setSubmittingAction(true);
    const demandPath = `demands/${selectedDemand.id}`;
    const logPath = 'demand_logs';
    const notificationPath = 'notifications';

    try {
      const user = auth.currentUser;
      const isUserAdmin = isAdmin || currentEmployee?.accessType === 'admin-light' || currentEmployee?.accessType === 'full' || chosenAction === 'APPROVAL';
      const performerName = isUserAdmin ? 'ADMIN' : (currentEmployee?.name || user?.email || 'Employee');
      const performerEmail = user?.email || '';

      let updatePayload: any = {};
      let logPayload: any = {
        demandId: selectedDemand.id,
        plNo: selectedDemand.plNo,
        partNo: selectedDemand.partNo,
        description: selectedDemand.description,
        action: chosenAction,
        remark: actionRemark,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString()
      };

      if (chosenAction === 'RETURN') {
        updatePayload = {
          status: 'returned',
          forwardedToCompanyAdmin: false
        };

        // Notify the creator
        if (selectedDemand.createdByEmail) {
          await addDoc(collection(db, 'notifications'), {
            targetEmail: selectedDemand.createdByEmail,
            title: 'Demand Returned',
            message: `Your demand for PL No. ${selectedDemand.plNo} has been returned by ${performerName}. Remark: ${actionRemark}`,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'announcement'
          });
        }
      } 
      else if (chosenAction === 'REJECT') {
        updatePayload = {
          status: 'rejected',
          rejectReason: actionRemark,
          forwardedToCompanyAdmin: false
        };

        // Notify the creator
        if (selectedDemand.createdByEmail) {
          await addDoc(collection(db, 'notifications'), {
            targetEmail: selectedDemand.createdByEmail,
            title: 'Demand Rejected',
            message: `Your demand for PL No. ${selectedDemand.plNo} was rejected by ${performerName}. Remark: ${actionRemark}`,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'rejection'
          });
        }
      } 
      else if (chosenAction === 'APPROVAL') {
        updatePayload = {
          status: 'approved',
          giveQty: approvalGiveQty,
          approvedRate: approvalRate,
          forwardedToCompanyAdmin: false
        };

        // Notify the creator
        if (selectedDemand.createdByEmail) {
          await addDoc(collection(db, 'notifications'), {
            targetEmail: selectedDemand.createdByEmail,
            title: 'Demand Approved (मांग स्वीकृत)',
            message: `Your demand for PL No. ${selectedDemand.plNo} has been approved with Given Qty: ${approvalGiveQty} and Rate: ${approvalRate} by ${performerName}! You can now receive it from your Inbox.`,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'approval'
          });
        }
      } 
      else if (chosenAction === 'FORWARD') {
        if (currentEmployee?.accessType === 'admin-light') {
          if (!forwardCompanyName) {
            toast.error('Please select a company to forward to (कृपया आगे भेजने के लिए कंपनी का चयन करें)');
            setSubmittingAction(false);
            return;
          }

          const targetAdminLight = allEmployees.find(emp => emp.accessType === 'admin-light' && emp.companyName === forwardCompanyName);

          updatePayload = {
            forwardedTo: targetAdminLight?.id || '',
            forwardedToName: targetAdminLight?.name || `Company Admin of ${forwardCompanyName}`,
            forwardedToEmail: targetAdminLight?.email || '',
            forwardedToCompanyAdmin: true,
            forwardedToAdmin: false,
            forwardedToCompanyName: forwardCompanyName,
            forwardedByUid: user?.uid || '',
            forwardedByEmail: performerEmail || '',
            forwardedByName: performerName || '',
            forwardedByCompanyName: currentEmployee?.companyName || '',
            forwardedAt: new Date().toISOString(),
            forwardedToCompanyAdminAt: new Date().toISOString()
          };

          logPayload.newForwardedToName = `${forwardCompanyName} (Company Admin)`;

          if (targetAdminLight?.email) {
            await addDoc(collection(db, 'notifications'), {
              targetEmail: targetAdminLight.email,
              title: 'Demand Forwarded to Your Company',
              message: `A demand for PL No. ${selectedDemand.plNo} has been forwarded to your company (${forwardCompanyName}) by ${performerName}. Remark: ${actionRemark}`,
              createdAt: new Date().toISOString(),
              read: false,
              type: 'announcement'
            });
          }
        } else {
          const targetEmp = allEmployees.find(emp => emp.id === forwardEmployeeId);
          if (!targetEmp) {
            toast.error('Selected employee profile not found.');
            setSubmittingAction(false);
            return;
          }

          updatePayload = {
            forwardedTo: targetEmp.id,
            forwardedToName: targetEmp.name,
            forwardedToEmail: targetEmp.email || '',
            forwardedToCompanyAdmin: targetEmp.accessType === 'admin-light' ? true : false,
            forwardedToAdmin: targetEmp.accessType === 'full' ? true : false,
            forwardedToCompanyAdminAt: targetEmp.accessType === 'admin-light' ? new Date().toISOString() : '',
            forwardedToAdminAt: targetEmp.accessType === 'full' ? new Date().toISOString() : '',
            forwardedByUid: user?.uid || '',
            forwardedByEmail: performerEmail || '',
            forwardedByName: performerName || '',
            forwardedByCompanyName: currentEmployee?.companyName || '',
            forwardedAt: new Date().toISOString()
          };

          logPayload.newForwardedToName = targetEmp.name;

          // Notify the newly forwarded employee
          if (targetEmp.email) {
            await addDoc(collection(db, 'notifications'), {
              targetEmail: targetEmp.email,
              title: 'Demand Forwarded to You',
              message: `A demand for PL No. ${selectedDemand.plNo} has been forwarded to you by ${performerName}. Remark: ${actionRemark}`,
              createdAt: new Date().toISOString(),
              read: false,
              type: 'announcement'
            });
          }
        }
      }
      else if (chosenAction === 'FORWARD_TO_ADMIN') {
        updatePayload = {
          forwardedToAdmin: true,
          forwardedToAdminAt: new Date().toISOString(),
          forwardedToCompanyAdmin: false,
          forwardedByUid: user?.uid || '',
          forwardedByEmail: performerEmail || '',
          forwardedByName: performerName || '',
          forwardedByCompanyName: currentEmployee?.companyName || '',
          forwardedAt: new Date().toISOString()
        };

        logPayload.newForwardedToName = 'Master Admin';

        await addDoc(collection(db, 'notifications'), {
          targetEmail: 'admin@billedapp.com',
          title: 'Demand Forwarded to Master Admin',
          message: `A demand for PL No. ${selectedDemand.plNo} has been forwarded to Master Admin by ${performerName}. Remark: ${actionRemark}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement'
        });
      }

      // 1. Update the demand with decision and lastAction metadata
      const finalPayload = {
        ...updatePayload,
        lastActionByUid: user?.uid || '',
        lastActionByEmail: performerEmail || '',
        lastActionByName: performerName || '',
        lastActionByCompanyName: currentEmployee?.companyName || ''
      };
      await updateDoc(doc(db, 'demands', selectedDemand.id), finalPayload);

      // 2. Add action log report
      await addDoc(collection(db, 'demand_logs'), logPayload);

      toast.success(`Action '${chosenAction}' processed successfully!`);
      
      // Reset states
      setSelectedDemand(null);
      setChosenAction(null);
      setActionRemark('');
      setForwardEmployeeId('');
      setForwardCompanyName('');

    } catch (error) {
      toast.error('An error occurred while saving. Please try again.');
      handleFirestoreError(error, OperationType.WRITE, demandPath);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleInboxReceiveDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemand) return;

    if (receivedQty <= 0) {
      toast.error('Received quantity must be greater than 0');
      return;
    }

    setSubmittingAction(true);
    const demandPath = `demands/${selectedDemand.id}`;
    try {
      let partsQuery;
      if (selectedDemand.plNo) {
        partsQuery = query(collection(db, 'parts'), where('plNo', '==', selectedDemand.plNo));
      } else if (selectedDemand.partNo) {
        partsQuery = query(collection(db, 'parts'), where('partNo', '==', selectedDemand.partNo));
      }

      if (!partsQuery) {
        toast.error('Demand has no PL No. or Part No.');
        setSubmittingAction(false);
        return;
      }

      const partsSnap = await getDocs(partsQuery);
      
      const currentUserMachine = localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
      const targetMachineName = (selectedDemand.machineName || currentUserMachine || '').trim();

      const matchingPartDoc = !partsSnap.empty ? partsSnap.docs.find(docSnap => {
        const mName = ((docSnap.data() as any).machineName || '').trim();
        if (targetMachineName) {
          return mName.toLowerCase() === targetMachineName.toLowerCase();
        }
        return true;
      }) : null;

      if (!matchingPartDoc) {
        toast.error("Phle Inventory me Item create karo uske baad hi item received hoga otherwise item not received", {
          duration: 6000
        });
        setSubmittingAction(false);
        return;
      }

      const batch = writeBatch(db);
      const partId = matchingPartDoc.id;
      const partData = matchingPartDoc.data() as any;
      const newStock = (partData.stock || 0) + receivedQty;
      const newRate = receiveRate || partData.rate || selectedDemand.approvedRate || 0;
      const newLocation = receiveLocation || partData.location || '';
      const newTotalValue = newStock * newRate;

      batch.update(doc(db, 'parts', partId), {
        stock: newStock,
        rate: newRate,
        location: newLocation,
        totalValue: newTotalValue,
      });

      const previouslyReceived = selectedDemand.receivedQty || 0;
      const totalReceived = previouslyReceived + receivedQty;

      // Validate against giveQty limit programmatically
      const allowedGiveQty = selectedDemand.giveQty !== undefined ? selectedDemand.giveQty : selectedDemand.qty;
      const allowedMax = allowedGiveQty - previouslyReceived;
      if (receivedQty > allowedMax) {
        toast.error(`You cannot receive more than the approved Given Qty (${allowedMax} items remaining)`);
        setSubmittingAction(false);
        return;
      }

      // When the total quantity received is greater than or equal to the original requested qty, set status to 'completed'.
      // Otherwise, keep it as 'approved' so the employee can continue to receive remaining quantity from their Inbox.
      const newStatus = totalReceived >= selectedDemand.qty ? 'completed' : 'approved';

      const existingReceipts = selectedDemand.receipts || [];
      const newReceipt = {
        qty: receivedQty,
        date: receivedDate,
        remarks: receiveRemarks || '',
      };
      const updatedReceipts = [...existingReceipts, newReceipt];

      // Update demand status & receipt records
      const demandRef = doc(db, 'demands', selectedDemand.id);
      batch.update(demandRef, {
        status: newStatus,
        receivedQty: totalReceived,
        receivedDate: receivedDate,
        receipts: updatedReceipts,
        remarks: `Received ${receivedQty} items. Total: ${totalReceived}/${selectedDemand.qty}. ${receiveRemarks ? `Remark: ${receiveRemarks}` : ''}`
      });

      // Add to transaction history
      const transRef = doc(collection(db, 'transactions'));
      const voucherNum = selectedDemand.demandNo || (selectedDemand.id ? `DEM-${format(new Date(), 'yy')}-${selectedDemand.id.slice(-6).toUpperCase()}` : `DEM-${format(new Date(), 'yy')}-${Math.floor(100000 + Math.random() * 900000)}`);
      batch.set(transRef, {
        partId: partId,
        type: 'received',
        qty: receivedQty,
        date: receivedDate,
        details: `Received from demand in Action Desk${receiveRemarks ? `: ${receiveRemarks}` : ''}`,
        remarks: receiveRemarks || '',
        machineName: selectedDemand.machineName || '',
        voucherNo: voucherNum,
      });

      // Log action in demand_logs
      const user = auth.currentUser;
      const performerName = currentEmployee?.name || user?.email || 'Employee';
      const performerEmail = user?.email || '';
      const logRef = doc(collection(db, 'demand_logs'));
      batch.set(logRef, {
        demandId: selectedDemand.id,
        plNo: selectedDemand.plNo,
        partNo: selectedDemand.partNo || '',
        description: selectedDemand.description || '',
        action: 'RECEIVE',
        remark: `Received ${receivedQty} items. ${receiveRemarks ? `Remark: ${receiveRemarks}` : ''}`,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: performerEmail,
        timestamp: new Date().toISOString()
      });

      await batch.commit();
      
      const isFullyReceived = totalReceived >= allowedGiveQty;
      toast.success(isFullyReceived 
        ? `Demand fully received (Given Qty: ${allowedGiveQty} pcs)! Stock updated.` 
        : `Partially received: ${totalReceived} of ${allowedGiveQty}. Received: ${receivedQty} pcs.`
      );

      // Reset selected demand
      setSelectedDemand(null);
    } catch (error) {
      console.error('Error receiving demand from Inbox:', error);
      toast.error('Failed to receive demand items.');
      handleFirestoreError(error, OperationType.WRITE, demandPath);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleInboxResubmitDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemand) return;

    if (resubmitQty <= 0) {
      toast.error('Resubmit quantity must be greater than zero.');
      return;
    }

    setSubmittingAction(true);
    try {
      const user = auth.currentUser;
      const performerName = currentEmployee?.name || user?.email || 'Employee';

      await updateDoc(doc(db, 'demands', selectedDemand.id), {
        status: 'pending',
        qty: resubmitQty,
        remarks: `Resubmitted by ${performerName}. Notes: ${resubmitRemarks || 'No additional remarks'}`,
        lastActionByUid: '',
        lastActionByEmail: '',
        lastActionByName: '',
        lastActionByCompanyName: ''
      });

      // Log to demand_logs
      await addDoc(collection(db, 'demand_logs'), {
        demandId: selectedDemand.id,
        plNo: selectedDemand.plNo || '',
        partNo: selectedDemand.partNo || '',
        description: selectedDemand.description || '',
        action: 'RESUBMIT',
        remark: `Resubmitted with Qty: ${resubmitQty}. Remarks: ${resubmitRemarks}`,
        performedByUid: user?.uid || '',
        performedByName: performerName,
        performedByEmail: user?.email || '',
        timestamp: new Date().toISOString()
      });

      toast.success('Demand successfully resubmitted!');
      setSelectedDemand(null);
    } catch (error) {
      console.error('Error resubmitting demand:', error);
      toast.error('Failed to resubmit demand.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleInboxDismissDemand = async () => {
    if (!selectedDemand) return;
    if (!window.confirm('Are you sure you want to delete/dismiss this demand? This action cannot be undone.')) {
      return;
    }

    setSubmittingAction(true);
    try {
      await deleteDoc(doc(db, 'demands', selectedDemand.id));
      toast.success('Demand successfully dismissed and deleted!');
      setSelectedDemand(null);
    } catch (error) {
      console.error('Error dismissing demand:', error);
      toast.error('Failed to dismiss demand.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'approved':
      case 'completed':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'rejected':
        return 'bg-rose-50 text-rose-700 border-rose-100';
      case 'returned':
        return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'pending':
      default:
        return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
        <p className="text-sm text-slate-500 font-semibold font-mono animate-pulse">Synchronizing Inbox...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-600">
            <Mail size={18} className="stroke-[2.5]" />
            <span className="text-xs font-black uppercase tracking-widest">Inbox Center</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
            Centralized Action Inbox
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Manage your Profile approvals status, process demand items, and view logs history.
          </p>
        </div>
        
        {/* Info card of current employee */}
        {currentEmployee && (
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <User size={18} className="stroke-[2]" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-800">{currentEmployee.name}</p>
              <p className="text-[10px] text-slate-500 font-mono">PF No: {currentEmployee.pfNo || 'N/A'}</p>
              {currentEmployee.accessType && currentEmployee.accessType !== 'limited' && (
                <p className="text-[10px] text-indigo-600 font-bold bg-indigo-50/50 px-1.5 py-0.5 rounded mt-0.5 inline-block capitalize">
                  {currentEmployee.accessType} Access
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('demands'); setSelectedDemand(null); }}
          className={`pb-3.5 px-6 text-sm font-black tracking-tight transition-all relative ${
            activeTab === 'demands' 
              ? 'text-indigo-600 border-b-2 border-indigo-600' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <ClipboardList size={16} />
            Demands Sent to Me
            {incomingDemands.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded-full font-black animate-pulse">
                {incomingDemands.length}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => { setActiveTab('profile_requests'); setSelectedDemand(null); }}
          className={`pb-3.5 px-6 text-sm font-black tracking-tight transition-all relative ${
            activeTab === 'profile_requests' 
              ? 'text-indigo-600 border-b-2 border-indigo-600' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <User size={16} />
            Profile Approval Tracker
            {getFilteredProfileRequests().filter(r => r.status === 'pending').length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-indigo-500 text-white rounded-full font-black">
                {getFilteredProfileRequests().filter(r => r.status === 'pending').length}
              </span>
            )}
          </div>
        </button>
        {isAuthorizedForLogs && (
          <button
            onClick={() => { setActiveTab('history'); setSelectedDemand(null); }}
            className={`pb-3.5 px-6 text-sm font-black tracking-tight transition-all relative ${
              activeTab === 'history' 
                ? 'text-indigo-600 border-b-2 border-indigo-600' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <History size={16} />
              Actions Logs & Reports
            </div>
          </button>
        )}
      </div>

      {/* Main Tab Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Lists */}
        <div className={selectedDemand ? "lg:col-span-7 space-y-4" : "lg:col-span-12 space-y-4"}>
          
          {activeTab === 'demands' && (
            <div className="space-y-4">
              {incomingDemands.length === 0 ? (
                <div className="bg-white p-12 text-center rounded-3xl border border-slate-100 flex flex-col items-center justify-center gap-3">
                  <Mail className="text-slate-300 stroke-[1.5]" size={40} />
                  <p className="text-sm font-bold text-slate-700">Your Action Inbox is empty</p>
                  <p className="text-xs text-slate-400 max-w-sm">
                    When a demand item is forwarded to your ID, it will appear here for your return, forward, rejection, or approval.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                  {incomingDemands.map((demand) => (
                    <div 
                      key={demand.id}
                      onClick={() => {
                        setSelectedDemand(demand);
                        setChosenAction(null);
                        setActionRemark('');
                        setForwardEmployeeId('');
                      }}
                      className={`p-5 bg-white rounded-2xl border transition-all cursor-pointer text-left hover:shadow-md ${
                        selectedDemand?.id === demand.id 
                          ? 'border-indigo-600 ring-2 ring-indigo-600/10 shadow-lg' 
                          : 'border-slate-100 hover:border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-black text-slate-400 font-mono uppercase tracking-wider">
                            PL NO. {demand.plNo || 'N/A'}
                          </p>
                          <h3 className="text-base font-black text-slate-900 tracking-tight">
                            {demand.description}
                          </h3>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2">
                            <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                              <span className="text-[10px] font-black uppercase text-slate-400">Part No:</span> {demand.partNo || '-'}
                            </span>
                            <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                              <span className="text-[10px] font-black uppercase text-slate-400">Qty:</span> {demand.qty}
                            </span>
                            <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                              <span className="text-[10px] font-black uppercase text-slate-400">Machine:</span> {demand.machineName || 'General'}
                            </span>
                            {demand.giveQty !== undefined && (
                              <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                                <span className="text-[10px] font-black uppercase text-emerald-500">Gived (दी गई Qty):</span> {demand.giveQty}
                              </span>
                            )}
                            {demand.giveQty !== undefined && demand.qty > demand.giveQty && (
                              <span className="text-xs font-bold text-amber-600 flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                <span className="text-[10px] font-black uppercase text-amber-500">Rem to Give (देना शेष):</span> {demand.qty - demand.giveQty}
                              </span>
                            )}
                          </div>
                        </div>
                        {(() => {
                          const isCompleted = demand.status === 'completed' || (demand.receivedQty !== undefined && demand.receivedQty >= (demand.qty || 0));
                          if (isCompleted) {
                            return (
                              <span className="shrink-0 border px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 bg-green-50 text-green-700 border-green-100">
                                <CheckCircle2 size={11} />
                                completed (पूर्ण)
                              </span>
                            );
                          }
                          return (
                            <span className={`shrink-0 border px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                              demand.status === 'approved'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              demand.status === 'returned'
                                ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              demand.status === 'rejected'
                                ? 'bg-rose-50 text-rose-700 border-rose-100' :
                                 'bg-yellow-50 text-yellow-700 border-yellow-100'
                            }`}>
                              {demand.status === 'approved' ? <CheckCircle2 size={11} /> :
                               demand.status === 'returned' ? <CornerUpLeft size={11} /> :
                               demand.status === 'rejected' ? <XCircle size={11} /> :
                               <Clock size={11} />}
                              {demand.status === 'approved' ? 'approved (स्वीकृत)' :
                               demand.status === 'returned' ? 'returned (वापस)' :
                               demand.status === 'rejected' ? 'rejected (अस्वीकृत)' :
                               `pending (${demand.status})`}
                            </span>
                          );
                        })()}
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span>Requested By: {getRequesterText(demand)}</span>
                        <div className="flex items-center gap-2">
                          {demand.status === 'pending' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenIssueModal(demand);
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[11px] px-3 py-1 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95"
                            >
                              <PackageCheck size={13} />
                              इशू फॉर्म (Issue)
                            </button>
                          )}
                          <span>Date: {demand.date}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile_requests' && (() => {
            const isEmployeeEmail = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
            const isAdmin = !isEmployeeEmail;
            const isAuthorityOrAdmin = isAdmin || (currentEmployee && (currentEmployee.accessType === 'full' || currentEmployee.accessType === 'admin-light'));

            if (isAuthorityOrAdmin) {
              // Admin & Authority Review view
              let requestsToReview = getFilteredProfileRequests().filter(req => req.status === 'pending');
              if (currentEmployee && currentEmployee.accessType === 'admin-light') {
                requestsToReview = requestsToReview.filter(req => 
                  (req.companyName === currentEmployee.companyName || req.forwardedToCompanyName === currentEmployee.companyName) && 
                  (req.forwardedToCompanyAdmin === true || req.isFullAccessAdmin === true)
                );
              }

              return (
                <div className="bg-white rounded-3xl border border-slate-100 p-6 space-y-6">
                  <div>
                    <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                      <Sparkles size={18} className="text-indigo-600 animate-pulse" />
                      Pending Profile Requests for Review & Verification
                    </h2>
                    <p className="text-xs text-slate-500 font-medium mt-1">
                      Review employee profile updates, compare files and details, and choose to approve, reject, or return for corrections.
                    </p>
                  </div>

                  {requestsToReview.length === 0 ? (
                    <div className="bg-slate-50/50 border border-slate-100/80 rounded-2xl p-16 text-center shadow-sm">
                      <div className="w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500">
                        <Check size={28} className="stroke-[3]" />
                      </div>
                      <h3 className="text-base font-black text-slate-800">All Requests Reviewed</h3>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        There are no pending employee profile update requests requiring your verification!
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6">
                      {requestsToReview.map((req) => {
                        const diff = getChangeDiff(req) || [];
                        const isExpanded = !!expandedRequests[req.id];

                        return (
                          <div key={req.id} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all relative overflow-hidden">
                            {actioningRequest === req.id && (
                              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] z-50 flex items-center justify-center flex-col gap-2">
                                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs font-black text-indigo-900">Processing Request...</span>
                              </div>
                            )}

                            {/* Request Card Header */}
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-50">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/60">
                                  {req.photoUrl ? (
                                    <img src={req.photoUrl} alt={req.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-base font-black text-slate-400">{req.name?.charAt(0)}</span>
                                  )}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-black text-slate-800 text-base leading-tight">{req.name}</h3>
                                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">
                                      PF: {req.pfNo || 'N/A'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-indigo-600 uppercase font-bold tracking-wider mt-0.5">{req.designation}</p>
                                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                                    Submitted: {new Date(req.createdAt).toLocaleString()}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {req.requestedFieldsDescription && (
                                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] px-2.5 py-1 rounded-lg font-black max-w-[200px] truncate" title={req.requestedFieldsDescription}>
                                    Fields: {req.requestedFieldsDescription}
                                  </span>
                                )}
                                {req.forwardedToAdmin && (
                                  <span className="bg-purple-50 text-purple-700 border border-purple-100 text-[9px] px-2 py-1 rounded-lg font-bold animate-pulse">
                                    Forwarded to Master Admin
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Expandable Comparison Diff Section */}
                            <div className="mt-4">
                              <button
                                onClick={() => setExpandedRequests(prev => ({ ...prev, [req.id]: !isExpanded }))}
                                className="w-full flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl text-xs font-black text-slate-700 transition-colors"
                              >
                                <span>{isExpanded ? 'Hide Requested Changes (बदलाव छुपाएं) ▲' : 'View Requested Changes (बदलाव देखें) ▼'}</span>
                                <span className="bg-white text-slate-600 text-[10px] px-2 py-0.5 rounded-full border border-slate-200">
                                  {diff.length} fields changed
                                </span>
                              </button>

                              {isExpanded && (
                                <div className="mt-3 border border-slate-100 rounded-xl overflow-hidden bg-slate-50/20">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                                        <th className="py-2.5 px-4">Field (विवरण)</th>
                                        <th className="py-2.5 px-4">Original Value (मूल)</th>
                                        <th className="py-2.5 px-4">Proposed Value (नया)</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {diff.map((change: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50/50">
                                          <td className="py-3 px-4 font-black text-slate-700">{change.label}</td>
                                          <td className="py-3 px-4 text-slate-500">
                                            {change.isPhoto ? (
                                              <div className="text-center w-20">
                                                {change.oldPhoto ? (
                                                  <img src={change.oldPhoto} className="h-10 w-10 object-cover rounded border border-slate-200 mx-auto" referrerPolicy="no-referrer" />
                                                ) : (
                                                  <span className="text-slate-400 italic text-[10px]">None</span>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="font-mono bg-slate-100/50 px-1.5 py-0.5 rounded break-all">{change.oldVal || 'N/A'}</span>
                                            )}
                                          </td>
                                          <td className="py-3 px-4 text-indigo-700 font-medium">
                                            {change.isPhoto ? (
                                              <div className="text-center w-20">
                                                {change.newPhoto ? (
                                                  <img src={change.newPhoto} className="h-12 w-12 object-cover rounded border-2 border-indigo-500 shadow-sm mx-auto" referrerPolicy="no-referrer" />
                                                ) : (
                                                  <span className="text-slate-400 italic text-[10px]">None</span>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="font-mono bg-indigo-50 px-1.5 py-0.5 rounded break-all text-indigo-700 font-bold">{change.newVal || 'N/A'}</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {/* Action section with Remarks Input */}
                            <div className="mt-5 pt-4 border-t border-slate-50 space-y-3">
                              <div>
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                                  Remarks / Correction Note (टिप्पणी / संशोधन निर्देश) <span className="text-rose-500">*Required for Return/Reject</span>
                                </label>
                                <textarea
                                  value={requestRemarks[req.id] || ''}
                                  onChange={(e) => setRequestRemarks(prev => ({ ...prev, [req.id]: e.target.value }))}
                                  placeholder="Enter the reason for rejection, return correction remarks, or general approval notes..."
                                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-semibold focus:outline-none focus:bg-white focus:border-indigo-500 transition-all placeholder:text-slate-400 min-h-[64px]"
                                />
                              </div>

                              <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                  onClick={() => handleApproveRequest(req)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center gap-1"
                                >
                                  <CheckCircle2 size={14} /> Approve (मंजूर करें)
                                </button>
                                
                                <button
                                  onClick={() => handleReturnRequest(req)}
                                  className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-black px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center gap-1"
                                >
                                  <CornerUpLeft size={14} /> Return (संशोधन हेतु वापस भेजें)
                                </button>

                                <button
                                  onClick={() => handleRejectRequest(req)}
                                  className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-black px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center gap-1"
                                >
                                  <XCircle size={14} /> Reject (अस्वीकार करें)
                                </button>

                                {currentEmployee?.accessType === 'full' && !req.forwardedToCompanyAdmin && (
                                  <button
                                    onClick={() => {
                                      setProfileRequestToForward(req);
                                      setSelectedProfileForwardEmployeeId('');
                                      setShowProfileForwardModal(true);
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center gap-1 ml-auto"
                                  >
                                    <Send size={14} /> Forward to Company Admin
                                  </button>
                                )}

                                {currentEmployee?.accessType === 'admin-light' && (
                                  <button
                                    onClick={() => {
                                      setProfileRequestToForward(req);
                                      setSelectedProfileForwardEmployeeId('');
                                      setSelectedProfileForwardCompanyName('');
                                      setShowProfileForwardModal(true);
                                    }}
                                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-black px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98] flex items-center gap-1 ml-auto"
                                  >
                                    <Send size={14} /> Forward to Company (कंपनी को भेजें)
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            } else {
              // Standard Employee tracker view
              return (
                <div className="bg-white rounded-3xl border border-slate-100 p-6 space-y-4">
                  <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <Sparkles size={18} className="text-indigo-600" />
                    Profile Update Requests Status Tracker
                  </h2>
                  <p className="text-xs text-slate-500 font-medium pb-2">
                    Here you can view the live status of profile requests you submitted to Admin for verification.
                  </p>

                  {getFilteredProfileRequests().length === 0 ? (
                    <div className="text-center p-8 text-slate-400 text-xs bg-slate-50/50 rounded-2xl border border-slate-100/50">
                      No profile requests found. Create a request from your Profile Settings page.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {getFilteredProfileRequests().map((req) => {
                        const isExpanded = !!expandedRequests[req.id];
                        const diff = getChangeDiff(req) || [];
                        
                        // Determine current possession of the request
                        let currentHolderText = '';
                        let currentHolderDesc = '';
                        let holderBadgeStyle = '';

                        if (req.status === 'approved') {
                          currentHolderText = 'Completed & Approved (मंजूर हो चुका है)';
                          currentHolderDesc = 'Your profile details have been verified and updated in the system database.';
                          holderBadgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        } else if (req.status === 'rejected') {
                          currentHolderText = 'Rejected (अस्वीकार किया गया)';
                          currentHolderDesc = 'Your profile update request was rejected. Please contact your admin for clarifications.';
                          holderBadgeStyle = 'bg-rose-50 text-rose-700 border-rose-200';
                        } else if (req.status === 'returned') {
                          currentHolderText = 'With You (आपके पास है - संशोधन हेतु)';
                          currentHolderDesc = 'This request requires corrections. Please read the Admin Remarks below, click "Correct & Resubmit Request" to update and send back.';
                          holderBadgeStyle = 'bg-amber-50 text-amber-700 border-amber-200';
                        } else {
                          // Pending status
                          if (req.forwardedToAdmin || req.forwardedToCompanyAdmin) {
                            currentHolderText = 'With Company Admin / Master Admin (कंपनी/मास्टर एडमिन के पास है)';
                            currentHolderDesc = 'The request has been forwarded to the Master/Company Admin for final review and approval.';
                            holderBadgeStyle = 'bg-purple-50 text-purple-700 border-purple-200';
                          } else {
                            currentHolderText = `With Section Authority (सेक्शन अथॉरिटी: ${req.authorityName || 'Section Authority'})`;
                            currentHolderDesc = `Currently with Section Authority: "${req.authorityName || 'Section Authority'}" for initial review and verification.`;
                            holderBadgeStyle = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                          }
                        }

                        return (
                          <div 
                            key={req.id} 
                            className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:border-slate-200 transition-all flex flex-col gap-3 text-left"
                          >
                            <div 
                              onClick={() => setExpandedRequests(prev => ({ ...prev, [req.id]: !isExpanded }))}
                              className="flex flex-col md:flex-row md:items-start justify-between gap-4 cursor-pointer select-none"
                            >
                              <div className="space-y-1.5 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-black text-slate-800">{req.name}</span>
                                  <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-50 px-1.5 py-0.5 rounded">
                                    PF: {req.pfNo || 'N/A'}
                                  </span>
                                </div>
                                
                                <p className="text-xs text-slate-500 font-medium">Designation: {req.designation}</p>
                                
                                {req.requestedFieldsDescription && (
                                  <p className="text-[11px] text-indigo-700 font-bold bg-indigo-50/60 px-2 py-1 rounded inline-block">
                                    <strong>Why Submitted (किस लिए):</strong> {req.requestedFieldsDescription}
                                  </p>
                                )}

                                <p className="text-[11px] text-slate-400">
                                  Submitted on: {new Date(req.createdAt).toLocaleDateString(undefined, {
                                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                  })}
                                </p>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusBadgeStyle(req.status)}`}>
                                  {req.status === 'returned' ? 'Returned (संशोधन के लिए वापस)' : req.status}
                                </span>

                                {req.status === 'returned' && (
                                  <Link
                                    to="/profile"
                                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition-all active:scale-[0.98] flex items-center gap-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <CornerUpLeft size={12} className="stroke-[2.5]" />
                                    Correct & Resubmit Request
                                  </Link>
                                )}

                                <span className="text-xs font-black text-indigo-600 bg-indigo-50/50 px-2.5 py-1 rounded-lg select-none">
                                  {isExpanded ? 'Hide Details ▲' : 'View Details ▼'}
                                </span>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mt-2 pt-4 border-t border-slate-100 space-y-4">
                                {/* Where is the Request Section */}
                                <div className={`p-4 border rounded-xl space-y-1 ${holderBadgeStyle}`}>
                                  <div className="flex items-center gap-2">
                                    <Clock size={15} className="shrink-0" />
                                    <span className="text-[10px] font-black uppercase tracking-wider">
                                      Current Location (आवेदन वर्तमान में किसके पास है)
                                    </span>
                                  </div>
                                  <p className="text-xs font-extrabold">{currentHolderText}</p>
                                  <p className="text-[11px] opacity-90 font-medium">{currentHolderDesc}</p>
                                </div>

                                {/* Proposed Changes details */}
                                <div className="space-y-2">
                                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                    Requested Modifications (संशोधित विवरण)
                                  </h4>

                                  {diff.length === 0 ? (
                                    <p className="text-[11px] text-slate-400 italic">No specific field modifications detected.</p>
                                  ) : (
                                    <div className="border border-slate-100 rounded-xl overflow-hidden bg-slate-50/20">
                                      <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                          <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                                            <th className="py-2.5 px-3">Field (विवरण)</th>
                                            <th className="py-2.5 px-3">Original Value (मूल)</th>
                                            <th className="py-2.5 px-3">Proposed Value (नया)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {diff.map((change: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 text-[11px]">
                                              <td className="py-2.5 px-3 font-black text-slate-700">{change.label}</td>
                                              <td className="py-2.5 px-3 text-slate-500 truncate max-w-[150px]">
                                                {change.isPhoto ? (
                                                  <span className="italic">Photo change</span>
                                                ) : (
                                                  <span className="font-mono bg-slate-100/50 px-1.5 py-0.5 rounded break-all">{change.oldVal || 'N/A'}</span>
                                                )}
                                              </td>
                                              <td className="py-2.5 px-3 text-indigo-700 font-bold truncate max-w-[150px]">
                                                {change.isPhoto ? (
                                                  <span className="italic">Photo change</span>
                                                ) : (
                                                  <span className="font-mono bg-indigo-50 px-1.5 py-0.5 rounded break-all text-indigo-700 font-bold">{change.newVal || 'N/A'}</span>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>

                                {/* Remarks (if any) */}
                                {req.remarks && (
                                  <div className={`p-3.5 border rounded-xl text-xs ${
                                    req.status === 'returned'
                                      ? 'bg-amber-50/50 border-amber-200/60 text-amber-900'
                                      : 'bg-rose-50/50 border-rose-200/60 text-rose-900'
                                  }`}>
                                    <div className="font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider mb-1">
                                      {req.status === 'returned' ? '⚠️ Correction Required (संशोधन निर्देश):' : '❌ Rejection Note (अस्वीकार टिप्पणी):'}
                                    </div>
                                    <span className="italic font-semibold">"{req.remarks}"</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
          })()}

          {activeTab === 'history' && isAuthorizedForLogs && (
            <div className="bg-white rounded-3xl border border-slate-100 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-3 border-b border-slate-100">
                <div className="space-y-1">
                  <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <History size={18} className="text-indigo-600" />
                    Action History & Reports (कार्रवाई इतिहास और रिपोर्ट)
                  </h2>
                  <p className="text-xs text-slate-500 font-medium">
                    Logs of all processed items (Demands & Profile Requests) representing action history report.
                  </p>
                </div>
                {isAuthorizedForLogs && (
                  <button
                    onClick={handleExportActionLogs}
                    className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-md hover:from-emerald-700 hover:to-green-700 transition-all active:scale-[0.98] shrink-0"
                  >
                    Export Excel (एक्सेल निर्यात)
                  </button>
                )}
              </div>

              {actionLogs.length === 0 ? (
                <div className="text-center p-8 text-slate-400 text-xs">
                  No logs recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-4">Item Type / Details</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Remark</th>
                        <th className="py-3 px-4">Processed By</th>
                        <th className="py-3 px-4">Timestamp</th>
                        {(isAdmin || (currentEmployee && currentEmployee.accessType === 'full')) && (
                          <th className="py-3 px-4 text-right">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actionLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50">
                          <td className="py-3.5 px-4 font-medium text-slate-800 max-w-[200px] truncate">
                            {log.plNo && (log.plNo.startsWith('PF:') || log.plNo === 'PROFILE') ? (
                              <span className="font-mono text-emerald-600 block font-black text-[10px]">👥 {log.plNo}</span>
                            ) : (
                              <span className="font-mono text-indigo-600 block font-black">📦 PL: {log.plNo}</span>
                            )}
                            <span className="text-slate-500 truncate block mt-0.5">{log.description}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                              log.action === 'APPROVAL' ? 'bg-emerald-50 text-emerald-700' :
                              log.action === 'REJECT' ? 'bg-rose-50 text-rose-700' :
                              log.action === 'RETURN' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'
                            }`}>
                              {log.action}
                            </span>
                            {log.newForwardedToName && (
                              <span className="block text-[9px] text-slate-400 mt-1">To: {log.newForwardedToName}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 italic max-w-[180px] break-words">
                            "{log.remark}"
                          </td>
                          <td className="py-3.5 px-4 text-slate-700 font-bold">
                            {log.action === 'APPROVAL' || log.performedByName === 'ADMIN' || log.performedByName?.toUpperCase().includes('ADMIN') || log.performedByEmail === 'admin@gmail.com' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-black uppercase tracking-wider border border-emerald-200">
                                ADMIN
                              </span>
                            ) : (
                              log.performedByName
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400">
                            {new Date(log.timestamp).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </td>
                          {(isAdmin || (currentEmployee && currentEmployee.accessType === 'full')) && (
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => handleEditLog(log)}
                                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                  title="Edit Log"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteLog(log.id)}
                                  className="p-1 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="Delete Log"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Interactive Action Box */}
        {selectedDemand && (
          <div className="lg:col-span-5 bg-white rounded-3xl border border-indigo-100 shadow-xl p-6 space-y-6 self-start">
            <div className="flex justify-between items-start">
              <div className="space-y-1 text-left">
                <span className="text-[10px] font-black bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md uppercase tracking-widest inline-block">
                  ACTION DESK (कार्रवाई डेस्क)
                </span>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Item Action Processing
                </h2>
              </div>
              <button 
                onClick={() => setSelectedDemand(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Selected Demand Detail card */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-xs font-mono font-black text-slate-500">PL NO: {selectedDemand.plNo || 'N/A'}</span>
                <span className="text-xs font-mono font-bold text-slate-600">Qty: {selectedDemand.qty}</span>
              </div>
              <p className="text-sm font-extrabold text-slate-800 leading-tight">
                {selectedDemand.description}
              </p>
              <div className="text-[11px] text-slate-500 space-y-1">
                <p><strong>Requested By:</strong> {getRequesterText(selectedDemand)}</p>
                <p><strong>Part No:</strong> {selectedDemand.partNo || '-'}</p>
                <p><strong>Machine Target:</strong> {selectedDemand.machineName || 'General'}</p>
                {selectedDemand.remarks && (
                  <p className="text-slate-400 italic"><strong>Orig. Remarks:</strong> "{selectedDemand.remarks}"</p>
                )}
              </div>
            </div>

            {/* Actions Switcher / Receipt Form */}
            {selectedDemand.status === 'approved' ? (
              <form onSubmit={handleInboxReceiveDemand} className="space-y-4 text-left">
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-xs text-emerald-800 space-y-1">
                  <div className="font-extrabold flex items-center gap-1.5 text-emerald-900">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    APPROVED DEMAND (स्वीकृत मांग)
                  </div>
                  <p>This demand was approved and is ready to be received into your inventory.</p>
                  {selectedDemand.giveQty !== undefined && (
                    <p className="font-extrabold text-[11px] text-emerald-950 bg-emerald-100/50 px-2 py-1 rounded mt-1.5 inline-block">
                      Approved Given Quantity (स्वीकृत दी जाने वाली मात्रा): {selectedDemand.giveQty} units
                    </p>
                  )}
                  <p className="font-extrabold text-[11px] mt-2">
                    Current Inventory Stock for this item: {receivingPartStock} units
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {(() => {
                    const allowedMax = (selectedDemand.giveQty !== undefined ? selectedDemand.giveQty : selectedDemand.qty) - (selectedDemand.receivedQty || 0);
                    return (
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                          Receive Qty (प्राप्त मात्रा) *
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={allowedMax}
                          value={receivedQty}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-500 focus:outline-none cursor-not-allowed font-mono"
                          disabled
                          required
                        />
                        <p className="text-[10px] text-slate-400 font-medium font-mono">
                          Fixed to Given Qty: {allowedMax} (Total requested: {selectedDemand.qty})
                        </p>
                      </div>
                    );
                  })()}

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                      Receive Date (प्राप्त तिथि) *
                    </label>
                    <input
                      type="date"
                      value={receivedDate}
                      onChange={(e) => setReceivedDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500 font-mono"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                      Location (भंडार स्थान - Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Rack A-12"
                      value={receiveLocation}
                      onChange={(e) => setReceiveLocation(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                      Rate / Unit (दर प्रति इकाई)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="No rate set"
                      value={receiveRate || ''}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-500 focus:outline-none cursor-not-allowed font-mono"
                      disabled
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                    Receive Remarks (प्राप्ति टिप्पणी - Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={receiveRemarks}
                    onChange={(e) => setReceiveRemarks(e.target.value)}
                    placeholder="Enter notes about this receipt..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingAction || receivedQty <= 0}
                  className="w-full py-3 text-xs font-black rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:pointer-events-none"
                >
                  {submittingAction ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      Processing Receipt...
                    </>
                  ) : (
                    <>
                      <Check size={14} className="stroke-[2.5]" />
                      Receive Item & Update Inventory
                    </>
                  )}
                </button>
              </form>
            ) : ['returned', 'rejected'].includes(selectedDemand.status) ? (
              <div className="space-y-4 text-left">
                <div className={`p-4 rounded-xl text-xs space-y-1.5 border ${
                  selectedDemand.status === 'returned'
                    ? 'bg-amber-50 text-amber-800 border-amber-100'
                    : 'bg-rose-50 text-rose-800 border-rose-100'
                }`}>
                  <div className="font-extrabold flex items-center gap-1.5 text-sm">
                    {selectedDemand.status === 'returned' ? (
                      <>
                        <CornerUpLeft size={16} className="text-amber-600" />
                        Returned Demand (संशोधन के लिए वापस किया गया)
                      </>
                    ) : (
                      <>
                        <XCircle size={16} className="text-rose-600" />
                        Rejected Demand (अस्वीकृत मांग)
                      </>
                    )}
                  </div>
                  <p className="font-medium text-[11px] leading-relaxed">
                    This demand was {selectedDemand.status} by <strong>{selectedDemand.lastActionByName || 'Admin'}</strong> from <strong>{selectedDemand.lastActionByCompanyName || 'Company'}</strong>.
                  </p>
                  <div className="mt-2 p-2 bg-white/70 rounded-lg text-slate-700 font-semibold text-[11px] font-mono">
                    <strong>Reason/Remarks:</strong> "{selectedDemand.remarks || selectedDemand.rejectReason || 'No remark entered'}"
                  </div>
                </div>

                <form onSubmit={handleInboxResubmitDemand} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                      Edit/Adjust Quantity (मात्रा संशोधित करें) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={resubmitQty}
                      onChange={(e) => setResubmitQty(parseInt(e.target.value) || 0)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500 font-mono"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                      Resubmit Remarks (पुनः सबमिशन टिप्पणी) *
                    </label>
                    <textarea
                      rows={2}
                      value={resubmitRemarks}
                      onChange={(e) => setResubmitRemarks(e.target.value)}
                      placeholder="Explain changes or request resubmission..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleInboxDismissDemand}
                      disabled={submittingAction}
                      className="flex-1 py-3 text-xs font-black rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <XCircle size={14} />
                      Dismiss & Delete
                    </button>
                    <button
                      type="submit"
                      disabled={submittingAction || resubmitQty <= 0 || !resubmitRemarks.trim()}
                      className="flex-1 py-3 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {submittingAction ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          Resubmitting...
                        </>
                      ) : (
                        <>
                          <Check size={14} className="stroke-[2.5]" />
                          Resubmit Demand
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <form onSubmit={handleExecuteAction} className="space-y-4 text-left">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                    Select Decision (निर्णय चुनें)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => { setChosenAction('RETURN'); setForwardEmployeeId(''); }}
                      className={`flex items-center justify-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition-all ${
                        chosenAction === 'RETURN'
                          ? 'bg-amber-50 text-amber-800 border-amber-300 ring-2 ring-amber-400/15'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <CornerUpLeft size={14} />
                      RETURN
                    </button>
                    <button
                      type="button"
                      onClick={() => { setChosenAction('FORWARD'); }}
                      className={`flex items-center justify-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition-all ${
                        chosenAction === 'FORWARD'
                          ? 'bg-indigo-50 text-indigo-800 border-indigo-300 ring-2 ring-indigo-400/15'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <ArrowRight size={14} />
                      FORWARD
                    </button>
                    <button
                      type="button"
                      onClick={() => { setChosenAction('REJECT'); setForwardEmployeeId(''); }}
                      className={`flex items-center justify-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition-all ${
                        chosenAction === 'REJECT'
                          ? 'bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-400/15'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <XCircle size={14} />
                      REJECT
                    </button>
                    <button
                      type="button"
                      onClick={() => { 
                        setChosenAction(null); 
                        setForwardEmployeeId(''); 
                        if (selectedDemand) {
                          handleOpenIssueModal(selectedDemand);
                        }
                      }}
                      className="flex items-center justify-center gap-1.5 p-3 rounded-xl border border-emerald-300 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all shadow-sm active:scale-95"
                    >
                      <PackageCheck size={14} />
                      इशू फॉर्म (Issue)
                    </button>
                  </div>
                </div>

                {/* Conditional Forward Employee or Company Select */}
                {chosenAction === 'FORWARD' && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    {currentEmployee?.accessType === 'admin-light' ? (
                      <>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                          Forward to Company (कंपनी का चयन करें)
                        </label>
                        <select
                          value={forwardCompanyName}
                          onChange={(e) => setForwardCompanyName(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold focus:outline-none focus:border-indigo-500"
                          required
                        >
                          <option value="">-- Choose Company --</option>
                          {uniqueCompanies.map((coName) => (
                            <option key={coName} value={coName}>
                              {coName}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                          Forward to Employee (कर्मचारी का चयन करें)
                        </label>
                        <select
                          value={forwardEmployeeId}
                          onChange={(e) => setForwardEmployeeId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold focus:outline-none focus:border-indigo-500"
                          required
                        >
                          <option value="">-- Choose Employee --</option>
                          {allEmployees
                            .filter(emp => {
                              const isNotMe = emp.id !== currentEmployee?.employeeId;
                              if (!isNotMe) return false;

                              const myCompany = currentEmployee?.companyName || '';
                              const isOperator = emp.designation?.toLowerCase().includes('operator');
                              const isSameCompany = !myCompany || !emp.companyName || emp.companyName === myCompany;

                              if (currentEmployee?.accessType === 'full') {
                                // Full Access Admin can only forward to their own company's Company Admin (admin-light) or Operator
                                return isSameCompany && (emp.accessType === 'admin-light' || isOperator);
                              }
                              if (currentEmployee?.accessType === 'admin-light') {
                                // Company Admin can forward to Master Admin (full) or Operator of their company
                                return emp.accessType === 'full' || (isOperator && isSameCompany);
                              }
                              return emp.accessType === 'full' || (isOperator && isSameCompany);
                            })
                            .map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.accessType === 'admin-light'
                                  ? `${emp.companyName || emp.name.replace(' Admin', '')} (Company Administrator)`
                                  : `${emp.name} (${emp.designation || 'No Designation'}) - ${emp.companyName || 'No Company'}`}
                              </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}

                {/* Mandatory Remark Area */}
                {chosenAction && (
                  <div className="space-y-1.5 animate-in fade-in duration-200">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide flex justify-between items-center">
                      <span>REMARK / COMMENT (टिप्पणी लिखें) *</span>
                      <span className="text-[10px] text-red-500 font-bold lowercase">Required</span>
                    </label>
                    <textarea
                      rows={3}
                      value={actionRemark}
                      onChange={(e) => setActionRemark(e.target.value)}
                      placeholder={`Enter your remark for this ${chosenAction.toLowerCase()} action...`}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                )}

                {/* Action Submit button */}
                {chosenAction ? (
                  <button
                    type="submit"
                    disabled={submittingAction || !actionRemark.trim() || (chosenAction === 'FORWARD' && !forwardEmployeeId && currentEmployee?.accessType !== 'admin-light')}
                    className={`w-full py-3 text-xs font-black rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 ${
                      chosenAction === 'APPROVAL' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
                      chosenAction === 'REJECT' ? 'bg-rose-600 hover:bg-rose-700 text-white' :
                      chosenAction === 'RETURN' ? 'bg-amber-600 hover:bg-amber-700 text-white' :
                      'bg-indigo-600 hover:bg-indigo-700 text-white'
                    } disabled:opacity-50 disabled:pointer-events-none`}
                  >
                    {submittingAction ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Check size={14} className="stroke-[2.5]" />
                        Complete {chosenAction} Action
                      </>
                    )}
                  </button>
                ) : (
                  <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/40 text-[11px] text-indigo-700 font-bold text-center">
                    Please select one of the action choices above to input remarks.
                  </div>
                )}
              </form>
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
              <h2 className="text-lg font-bold text-slate-800">
                {currentEmployee?.accessType === 'admin-light' ? 'Forward Profile Request to Company' : 'Forward Profile Request'}
              </h2>
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
                if (!profileRequestToForward) return;
                
                if (currentEmployee?.accessType === 'admin-light') {
                  if (!selectedProfileForwardCompanyName) return;
                  await handleForwardRequestToCompany(profileRequestToForward, selectedProfileForwardCompanyName);
                } else {
                  if (!selectedProfileForwardEmployeeId) return;
                  const targetEmp = allEmployees.find(emp => emp.id === selectedProfileForwardEmployeeId);
                  if (!targetEmp) return;
                  await handleForwardRequest(profileRequestToForward, targetEmp);
                }
                setShowProfileForwardModal(false);
              }} 
              className="p-6 space-y-4"
            >
              <p className="text-xs text-slate-600 font-medium">
                {currentEmployee?.accessType === 'admin-light' ? (
                  <>Select a company to forward the profile request for <strong>{profileRequestToForward?.name}</strong>.</>
                ) : (
                  <>Select an employee to forward the profile request for <strong>{profileRequestToForward?.name}</strong>.</>
                )}
              </p>
              <div>
                {currentEmployee?.accessType === 'admin-light' ? (
                  <>
                    <label className="block text-xs font-black uppercase text-indigo-600 mb-1.5 tracking-wide">
                      Recipient Company (कंपनी का चयन करें)
                    </label>
                    <select
                      className="w-full border border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs font-bold bg-white"
                      value={selectedProfileForwardCompanyName}
                      onChange={e => setSelectedProfileForwardCompanyName(e.target.value)}
                      required
                    >
                      <option value="">-- Choose Company --</option>
                      {uniqueCompanies.map(coName => (
                        <option key={coName} value={coName}>
                          {coName}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
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
                      {allEmployees
                        .filter(emp => {
                          const isNotMe = emp.id !== currentEmployee?.employeeId;
                          if (!isNotMe) return false;

                          const myCompany = currentEmployee?.companyName || '';
                          const isOperator = emp.designation?.toLowerCase().includes('operator');
                          const isSameCompany = !myCompany || !emp.companyName || emp.companyName === myCompany;

                          if (currentEmployee?.accessType === 'full') {
                            // Full Access forwards to admin-light (Company Admin) or Operator of their company
                            return isSameCompany && (emp.accessType === 'admin-light' || isOperator);
                          }
                          if (currentEmployee?.accessType === 'admin-light') {
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
                  </>
                )}
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
                  disabled={currentEmployee?.accessType === 'admin-light' ? !selectedProfileForwardCompanyName : !selectedProfileForwardEmployeeId}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  Forward
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Action Log Modal */}
      {editingLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden text-left"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <div>
                <h3 className="text-base font-black text-slate-900">Edit Action Log</h3>
                <p className="text-[11px] text-slate-500 font-medium">Modify log information for PL: {editingLog.plNo}</p>
              </div>
              <button
                onClick={() => setEditingLog(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditLog} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-700 uppercase tracking-wide block">
                  Action Type (कार्रवाई प्रकार)
                </label>
                <select
                  value={editLogAction}
                  onChange={(e) => setEditLogAction(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white"
                  required
                >
                  <option value="APPROVAL">APPROVAL</option>
                  <option value="REJECT">REJECT</option>
                  <option value="RETURN">RETURN</option>
                  <option value="FORWARD">FORWARD</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-700 uppercase tracking-wide block">
                  Remark / Note (टिप्पणी)
                </label>
                <textarea
                  rows={3}
                  value={editLogRemark}
                  onChange={(e) => setEditLogRemark(e.target.value)}
                  placeholder="Enter custom remarks..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLog(null)}
                  className="flex-1 py-2.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all active:scale-95 text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-md active:scale-95 text-center"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Issue Material Form Modal */}
      {showIssueModal && issueDemand && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-100 overflow-hidden my-8 text-left"
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white p-6 flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2">
                  <PackageCheck className="text-amber-400" size={24} />
                  <h3 className="text-lg font-black tracking-tight">
                    Issue Material to Requesting Machine (सामग्री इशू फॉर्म)
                  </h3>
                </div>
                <p className="text-xs text-indigo-200 mt-1 font-mono">
                  Demand No: <strong className="text-white">{issueDemand.demandNo || issueDemand.id}</strong>
                </p>
              </div>
              <button 
                onClick={() => { setShowIssueModal(false); setIssueDemand(null); }}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmIssue} className="p-6 space-y-5">
              {/* Recipient / Target Machine Details Card */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-indigo-900 font-black text-xs uppercase tracking-wider">
                  <Train size={16} className="text-indigo-600" />
                  Target / Requesting Machine Details (जिस मशीन को इशू किया जा रहा है)
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-indigo-100/60">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Machine Name</span>
                    <strong className="text-slate-800 font-extrabold text-sm">{targetMachineDetails.machineName}</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-indigo-100/60">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Zone</span>
                    <strong className="text-slate-800 font-bold">{targetMachineDetails.zone}</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-indigo-100/60">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Division</span>
                    <strong className="text-slate-800 font-bold">{targetMachineDetails.division}</strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-indigo-100/60">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Company</span>
                    <strong className="text-slate-800 font-bold">{targetMachineDetails.companyName}</strong>
                  </div>
                </div>
              </div>

              {/* Zero Stock Warning */}
              {issuingStock <= 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-center gap-3 text-rose-800 text-xs font-bold">
                  <AlertCircle size={20} className="text-rose-600 shrink-0" />
                  <div>
                    <p className="font-extrabold text-rose-900">Out of Stock in Depot (स्टॉक उपलब्ध नहीं है)</p>
                    <p className="text-[11px] text-rose-700 mt-0.5">
                      You cannot issue this material until depot stock is available. Current Depot Stock: 0 units.
                    </p>
                  </div>
                </div>
              )}

              {/* Item Details */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Requested Item Details</span>
                  <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${
                    issuingStock > 0
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-100 text-rose-800 border border-rose-200'
                  }`}>
                    Depot Stock: {issuingStock} units
                  </span>
                </div>

                {/* Editable Description */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block">
                    Description / सामग्री विवरण (Editable) *
                  </label>
                  <textarea
                    rows={2}
                    value={issueDescription}
                    onChange={(e) => setIssueDescription(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                    placeholder="Edit description..."
                    required
                  />
                </div>

                {/* PL No, Part No, Demanded Qty */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
                  {/* PL No Field */}
                  <div className={`p-2.5 rounded-xl border ${isNaOrEmpty(issueDemand.plNo) ? 'bg-amber-50/70 border-amber-300/80 shadow-sm' : 'bg-white border-slate-200/70'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">PL No</span>
                      {isNaOrEmpty(issueDemand.plNo) ? (
                        <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-amber-200">
                          <Edit2 size={9} /> Editable (N/A)
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200">
                          <Lock size={9} /> Locked
                        </span>
                      )}
                    </div>
                    {isNaOrEmpty(issueDemand.plNo) ? (
                      <input
                        type="text"
                        value={issuePlNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setIssuePlNo(val);
                          recheckStockForIssue(val, issuePartNo);
                        }}
                        placeholder="Type PL No..."
                        className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={issuePlNo}
                        disabled
                        className="w-full bg-slate-100/90 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-700 cursor-not-allowed"
                      />
                    )}
                  </div>

                  {/* Part No Field */}
                  <div className={`p-2.5 rounded-xl border ${isNaOrEmpty(issueDemand.partNo) ? 'bg-amber-50/70 border-amber-300/80 shadow-sm' : 'bg-white border-slate-200/70'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Part No</span>
                      {isNaOrEmpty(issueDemand.partNo) ? (
                        <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-amber-200">
                          <Edit2 size={9} /> Editable (N/A)
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200">
                          <Lock size={9} /> Locked
                        </span>
                      )}
                    </div>
                    {isNaOrEmpty(issueDemand.partNo) ? (
                      <input
                        type="text"
                        value={issuePartNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setIssuePartNo(val);
                          recheckStockForIssue(issuePlNo, val);
                        }}
                        placeholder="Type Part No..."
                        className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={issuePartNo}
                        disabled
                        className="w-full bg-slate-100/90 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-700 cursor-not-allowed"
                      />
                    )}
                  </div>

                  {/* Demanded Qty */}
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/70 flex flex-col justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Demanded Qty</span>
                    <strong className="text-indigo-700 font-extrabold text-sm">{issueDemand.qty} units</strong>
                  </div>
                </div>
              </div>

              {/* Issue Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide flex justify-between">
                    <span>Issue Quantity (इशू की जाने वाली मात्रा) *</span>
                    <span className="text-[11px] font-black text-indigo-600 uppercase">{issueDemand.unit || 'Nos'}</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={issuingStock > 0 ? 0.001 : 0}
                    max={Math.min(issueDemand.qty, issuingStock)}
                    value={issueQty}
                    onChange={(e) => {
                      const maxAllowed = Math.min(issueDemand.qty, issuingStock);
                      const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      setIssueQty(Math.max(0, Math.min(maxAllowed, val)));
                    }}
                    placeholder="e.g. 1 or 0.1"
                    disabled={issuingStock <= 0}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-50"
                    required
                  />
                  <p className="text-[10px] text-slate-400 font-medium">
                    {issuingStock > 0 
                      ? `Max allowed based on depot stock: ${Math.min(issueDemand.qty, issuingStock)} ${issueDemand.unit || 'units'}`
                      : `0 ${issueDemand.unit || 'units'} available in depot stock`}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                    Rate per Unit (दर ₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={issueRate}
                    onChange={(e) => setIssueRate(parseFloat(e.target.value) || 0)}
                    disabled={issuingStock <= 0}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                    Issue Date (इशू तिथि) *
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    disabled={issuingStock <= 0}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-50"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                    Receiver / Consignee Name (प्राप्तकर्ता नाम) *
                  </label>
                  <input
                    type="text"
                    value={issueReceiverName}
                    onChange={(e) => setIssueReceiverName(e.target.value)}
                    placeholder="Enter receiver name..."
                    disabled={issuingStock <= 0}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-50"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-700 uppercase tracking-wide block">
                  Issue Remarks (रिमार्क्स)
                </label>
                <textarea
                  rows={2}
                  value={issueRemarks}
                  onChange={(e) => setIssueRemarks(e.target.value)}
                  placeholder="Enter remarks..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowIssueModal(false); setIssueDemand(null); }}
                  className="flex-1 py-3 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all active:scale-95 text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingIssue || issuingStock <= 0 || issueQty <= 0}
                  className="flex-1 py-3 text-xs font-extrabold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-lg active:scale-95 text-center flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submittingIssue ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing Issue...
                    </>
                  ) : issuingStock <= 0 ? (
                    <>
                      <AlertCircle size={16} />
                      Cannot Issue (Out of Stock)
                    </>
                  ) : (
                    <>
                      <PackageCheck size={16} />
                      Confirm Issue & Download Voucher (इशू जारी करें)
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}
