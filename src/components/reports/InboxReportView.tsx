import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, getDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../../firebase';
import { 
  Search, 
  Download, 
  FileText, 
  Calendar, 
  Mail, 
  Edit, 
  Trash2, 
  Eye, 
  X, 
  Clock, 
  User, 
  Building2, 
  Tag, 
  CheckCircle2,
  Trash,
  Phone,
  HelpCircle,
  UserCheck
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { exportReportToPdf, exportReportToExcel } from '../../utils/reportExportUtils';
import { cleanDisplayName, cleanDisplayEmail, EmployeeProfile, findEmployeeForUser } from '../../utils/employee';
import ReportPagination from './ReportPagination';
import EditReportRecordModal, { EditFieldConfig } from './EditReportRecordModal';
import { toast } from 'sonner';

export interface InboxReportItem {
  id: string;
  collectionName: 'profile_requests';
  timestamp: string;
  category: 'Profile Request';
  refNo: string;
  action: string;
  performedByName: string;
  performedByEmail: string;
  performedByDesignation?: string;
  performedByCompanyName?: string;
  targetPersonOrMachine?: string;
  subjectOrDetails: string;
  remarks: string;
  employeePf?: string;
  employeeMobile?: string;
  machineName?: string;
  rawStatus?: string;
  rawRequest?: any;
}

export function getRequestCurrentHolder(req: any, item?: InboxReportItem) {
  const rawStatus = (req?.status || item?.rawStatus || 'pending').toLowerCase();
  
  if (rawStatus === 'approved') {
    const approver = req?.approvedByName || req?.actionByName || req?.lastActionByName || req?.authorityName || 'Admin / Authority';
    return {
      holderName: cleanDisplayName(approver),
      holderRole: 'Approved & Finalized (कार्रवाई संपन्न)',
      statusBadgeText: 'Approved (मंजूर)',
      badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    };
  }

  if (rawStatus === 'rejected') {
    const rejector = req?.rejectedByName || req?.actionByName || req?.lastActionByName || req?.authorityName || 'Admin / Authority';
    return {
      holderName: cleanDisplayName(rejector),
      holderRole: 'Rejected & Closed (अस्वीकृत)',
      statusBadgeText: 'Rejected (अस्वीकृत)',
      badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
    };
  }

  if (rawStatus === 'returned') {
    const empName = cleanDisplayName(req?.name || item?.performedByName || 'Employee');
    return {
      holderName: `${empName} (Applicant Employee)`,
      holderRole: 'Returned for Employee Correction (संशोधन हेतु आवेदक के पास वापस)',
      statusBadgeText: 'Returned (वापस)',
      badgeClass: 'bg-orange-100 text-orange-900 border-orange-300',
    };
  }

  // Pending / Forwarded status
  let target = '';
  if (req?.forwardedToName) {
    target = req.forwardedToName;
  } else if (req?.authorityName) {
    target = req.authorityName;
  } else if (req?.forwardedToCompanyAdmin) {
    target = req.forwardedToCompanyName ? `${req.forwardedToCompanyName} Admin` : 'Company Admin';
  } else if (req?.forwardedToAdmin || req?.isTopAdminRequest || req?.forwardedTo === 'admin') {
    target = 'Master Administrator';
  } else if (item?.targetPersonOrMachine) {
    target = item.targetPersonOrMachine;
  } else {
    target = 'Assigned Reviewer / Admin';
  }

  return {
    holderName: cleanDisplayName(target),
    holderRole: 'Pending Review & Approval (समीक्षा एवं अनुमोदन हेतु इनके पास लंबित)',
    statusBadgeText: 'Pending (लंबित)',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
  };
}

interface Props {
  userCompany?: string;
  userMachine?: string;
  isFullAdmin: boolean;
  currentUser?: any;
  currentEmployee?: EmployeeProfile | null;
}

export default function InboxReportView({ userCompany, userMachine, isFullAdmin, currentUser, currentEmployee }: Props) {
  const [items, setItems] = useState<InboxReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Internal user and employee fallbacks
  const [internalUser, setInternalUser] = useState<any>(auth.currentUser);
  const [internalEmployee, setInternalEmployee] = useState<EmployeeProfile | null>(null);
  const [topAdminLoginId, setTopAdminLoginId] = useState<string>('');
  const [topAdminEmail, setTopAdminEmail] = useState<string>('');
  const [userActionedLogDemandIds, setUserActionedLogDemandIds] = useState<Set<string>>(new Set());

  // View Record Modal
  const [viewItem, setViewItem] = useState<InboxReportItem | null>(null);

  // Pagination state (10 rows per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Edit Modal state
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    recordId: string;
    collectionName: string;
    title: string;
    fields: EditFieldConfig[];
    initialData: Record<string, any>;
  }>({
    isOpen: false,
    recordId: '',
    collectionName: 'profile_requests',
    title: '',
    fields: [],
    initialData: {},
  });

  // Auth & Employee fallback listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setInternalUser(u);
      if (u && !currentEmployee) {
        try {
          const emp = await findEmployeeForUser(u.uid, u.email);
          setInternalEmployee(emp);
        } catch (e) {
          console.warn('Error loading employee in InboxReportView:', e);
        }
      }
    });
    return () => unsub();
  }, [currentEmployee]);

  // Load dynamic top admin credentials
  useEffect(() => {
    async function loadAdminCreds() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'admin_credentials'));
        if (snap.exists()) {
          const d = snap.data();
          if (d.adminLoginId) setTopAdminLoginId(d.adminLoginId);
          if (d.adminEmail) setTopAdminEmail(d.adminEmail);
        }
      } catch (err) {
        console.warn('Could not load dynamic admin credentials in InboxReportView:', err);
      }
    }
    loadAdminCreds();
  }, []);

  const activeUser = currentUser || internalUser || auth.currentUser;
  const activeEmployee = currentEmployee || internalEmployee;

  // Listen to demand_logs to track requests where current user took an action
  useEffect(() => {
    if (!activeUser) return;
    const unsubLogs = onSnapshot(collection(db, 'demand_logs'), (snap) => {
      const ids = new Set<string>();
      const userEmail = (activeUser.email || '').trim().toLowerCase();
      const userUid = activeUser.uid || '';
      const empName = (activeEmployee?.name || '').trim().toLowerCase();

      snap.docs.forEach(d => {
        const data = d.data();
        const pUid = data.performedByUid || '';
        const pEmail = (data.performedByEmail || '').trim().toLowerCase();
        const pName = (data.performedByName || '').trim().toLowerCase();

        const match =
          (userUid && pUid === userUid) ||
          (userEmail && pEmail === userEmail) ||
          (empName && pName && pName === empName);

        if (match && data.demandId) {
          ids.add(data.demandId);
        }
      });
      setUserActionedLogDemandIds(ids);
    }, (err) => {
      console.warn('Could not listen to demand_logs for user action tracking:', err);
    });

    return () => unsubLogs();
  }, [activeUser, activeEmployee]);

  // Determine if current account is strictly Master Admin (Top Admin only)
  const isMasterAdmin = useMemo(() => {
    const userEmail = (activeUser?.email || '').trim().toLowerCase();
    const adminEmailNorm = (topAdminEmail || '').trim().toLowerCase();
    const adminIdNorm = (topAdminLoginId || '').trim().toLowerCase();

    // Check specific known master admin emails
    if (
      userEmail === 'imranansari399605@gmail.com' ||
      userEmail === 'admin@billedapp.com' ||
      (adminEmailNorm && userEmail === adminEmailNorm) ||
      (adminIdNorm && userEmail === `${adminIdNorm}@billedapp.com`) ||
      userEmail.startsWith('master.') ||
      userEmail.endsWith('@admin.billedapp.com')
    ) {
      return true;
    }

    if (activeEmployee) {
      const empPf = (activeEmployee.pfNo || '').trim().toLowerCase();
      const empLoginId = ((activeEmployee as any).loginId || '').trim().toLowerCase();
      const empIdNo = (activeEmployee.idNo || '').trim().toLowerCase();
      const empDesignation = (activeEmployee.designation || '').trim().toLowerCase();
      if (adminIdNorm && (empPf === adminIdNorm || empLoginId === adminIdNorm || empIdNo === adminIdNorm)) {
        return true;
      }
      if (
        activeEmployee.accessType === 'full' &&
        (!activeEmployee.companyName || activeEmployee.companyName.toLowerCase() === 'master') &&
        (empDesignation.includes('admin') || !empDesignation)
      ) {
        return true;
      }
    }

    return false;
  }, [activeUser, activeEmployee, topAdminEmail, topAdminLoginId]);

  // Strictly fetch and track profile update requests
  useEffect(() => {
    setLoading(true);

    const unsubReqs = onSnapshot(collection(db, 'profile_requests'), (snap) => {
      const requestsList: InboxReportItem[] = snap.docs.map(d => {
        const data = d.data();
        const rawStatus = (data.status || 'pending').toLowerCase();
        const actionStr = (data.status || 'PENDING').toUpperCase();
        const timestamp = data.resubmittedAt || data.forwardedAt || data.approvedAt || data.rejectedAt || data.updatedAt || data.createdAt || '';
        
        return {
          id: d.id,
          collectionName: 'profile_requests' as const,
          timestamp,
          category: 'Profile Request' as const,
          refNo: data.pfNo ? `PF: ${data.pfNo}` : `PRF-${d.id.slice(0, 6).toUpperCase()}`,
          action: actionStr,
          rawStatus,
          performedByName: cleanDisplayName(data.name || data.forwardedByName || data.authorityName || 'Employee'),
          performedByEmail: cleanDisplayEmail(data.email || data.forwardedByEmail || ''),
          performedByDesignation: data.designation || '',
          performedByCompanyName: data.companyName || '',
          targetPersonOrMachine: data.forwardedToName || data.authorityName || (data.forwardedToCompanyAdmin ? 'Company Admin' : 'Admin'),
          subjectOrDetails: data.requestedFieldsDescription 
            ? `Changes: ${data.requestedFieldsDescription}` 
            : `Profile Update Request (${data.name || 'Employee'})`,
          remarks: data.remarks || data.previousRemarks || '',
          employeePf: data.pfNo || '',
          employeeMobile: data.mobile || '',
          machineName: data.machineName || '',
          rawRequest: data,
        };
      });

      requestsList.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setItems(requestsList);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching profile requests for Inbox Report:', err);
      setLoading(false);
    });

    return () => unsubReqs();
  }, []);

  // Strict User Account Filtering:
  // "inbox report me only use ka transection report kare jis employee ka hai other employee ka data show n kare
  //  jo action le ya jiske pass wah request jaye only uske account me wah request show inbox report me other kisi ke account me show n kare
  //  aur report MASTER ADMIN ke account me sabhi ka request show kare"
  const visibleItems = useMemo(() => {
    if (isMasterAdmin) {
      // In Master Admin account, all requests are shown
      return items;
    }

    if (!activeUser && !activeEmployee) {
      return [];
    }

    const currentAuthUid = (activeUser?.uid || '').trim();
    const currentAuthEmail = (activeUser?.email || '').trim().toLowerCase();

    const empId = (activeEmployee?.id || '').trim();
    const empEmployeeId = (activeEmployee?.employeeId || '').trim();
    const empPf = (activeEmployee?.pfNo || '').trim().toLowerCase();
    const empLoginId = ((activeEmployee as any)?.loginId || '').trim().toLowerCase();
    const empIdNo = (activeEmployee?.idNo || '').trim().toLowerCase();
    const empEmail = (activeEmployee?.email || '').trim().toLowerCase();
    const empRegEmail = (activeEmployee?.registeredEmail || '').trim().toLowerCase();
    const empName = (activeEmployee?.name || '').trim().toLowerCase();
    const empCompany = (activeEmployee?.companyName || userCompany || '').trim().toLowerCase();
    const empMachine = (activeEmployee?.machineName || userMachine || '').trim().toLowerCase();

    const matchesUid = (uid?: string) => Boolean(uid && currentAuthUid && uid.trim() === currentAuthUid);
    const matchesEmail = (email?: string) => {
      if (!email) return false;
      const clean = email.trim().toLowerCase();
      return Boolean(
        (currentAuthEmail && clean === currentAuthEmail) ||
        (empEmail && clean === empEmail) ||
        (empRegEmail && clean === empRegEmail)
      );
    };
    const matchesPf = (pf?: string) => {
      if (!pf) return false;
      const clean = pf.trim().toLowerCase();
      return Boolean(
        (empPf && clean === empPf) ||
        (empLoginId && clean === empLoginId) ||
        (empIdNo && clean === empIdNo)
      );
    };
    const matchesEmpId = (id?: string) => {
      if (!id) return false;
      const clean = id.trim();
      return Boolean(
        (empId && clean === empId) ||
        (empEmployeeId && clean === empEmployeeId) ||
        (currentAuthUid && clean === currentAuthUid)
      );
    };
    const matchesName = (name?: string) => {
      if (!name) return false;
      const clean = name.trim().toLowerCase();
      return Boolean(empName && clean === empName);
    };

    return items.filter(item => {
      const req = item.rawRequest || {};

      // If the request was created by the current employee, it was sent OUT to an authority/reviewer.
      // Rule: "inbox report me wahi report show kare jiske pass request jaye to only use ke account me wah request show kare aur inbox report me us ki account me add hoye other kisi ke account me n hoye"
      const isCreatorOfRequest = Boolean(
        matchesUid(req.uid) ||
        (req.pfNo && matchesPf(req.pfNo)) ||
        (req.email && matchesEmail(req.email)) ||
        (req.employeeId && matchesEmpId(req.employeeId)) ||
        (req.name && matchesName(req.name))
      );

      // Check if this request was sent / forwarded / assigned to current user ("jiske pass request jaye")
      const targetForwardedTo = (req.forwardedTo || '').trim();
      const targetAuthorityId = (req.authorityId || '').trim();

      const isRecipient = Boolean(
        matchesUid(req.forwardedToUid) ||
        matchesEmail(req.forwardedToEmail) ||
        matchesPf(req.forwardedToPfNo) ||
        matchesPf(req.forwardedToLoginId) ||
        matchesEmpId(req.forwardedToEmployeeId) ||
        matchesEmpId(targetForwardedTo) ||
        matchesEmpId(targetAuthorityId) ||
        matchesPf(targetForwardedTo) ||
        matchesPf(targetAuthorityId) ||
        matchesName(req.forwardedToName) ||
        matchesName(req.authorityName)
      );

      // Check if current user acted on this request as the designated recipient / reviewer / authority
      const isActionTaker = Boolean(
        matchesUid(req.actionByUid) ||
        matchesEmail(req.actionByEmail) ||
        matchesName(req.actionByName) ||
        matchesUid(req.approvedByUid) ||
        matchesEmail(req.approvedByEmail) ||
        matchesName(req.approvedByName) ||
        matchesUid(req.rejectedByUid) ||
        matchesEmail(req.rejectedByEmail) ||
        matchesName(req.rejectedByName) ||
        matchesUid(req.returnedByUid) ||
        matchesEmail(req.returnedByEmail) ||
        matchesName(req.returnedByName) ||
        matchesUid(req.forwardedByUid) ||
        matchesEmail(req.forwardedByEmail) ||
        matchesName(req.forwardedByName) ||
        matchesUid(req.lastActionByUid) ||
        matchesEmail(req.lastActionByEmail) ||
        matchesName(req.lastActionByName) ||
        (req.status && req.status !== 'pending' && (matchesEmpId(req.authorityId) || matchesName(req.authorityName))) ||
        (req.id && userActionedLogDemandIds.has(req.id))
      );

      // User requirement:
      // "td tag me wahi data record hoye jo us employee ke profile ka request aaye aur jiske pass wah request jaye only uski ke account me inbox report me data save hoye other kisi ki employee me nahi"
      // Record/display if:
      // 1) Current employee is the applicant whose profile request it is (isCreatorOfRequest)
      // 2) Current employee is the recipient to whom the request was sent/forwarded (isRecipient)
      // 3) Current employee took action on this request (isActionTaker)
      if (isCreatorOfRequest || isRecipient || isActionTaker) {
        return true;
      }

      // Other employees' records must NOT show
      return false;
    });
  }, [items, isMasterAdmin, activeUser, activeEmployee, userCompany, userMachine, userActionedLogDemandIds]);

  // Filter visible items by status, date range, and search
  const filteredItems = useMemo(() => {
    return visibleItems.filter(item => {
      if (selectedStatus !== 'all' && item.rawStatus !== selectedStatus) {
        return false;
      }

      if (startDate) {
        const itemDate = item.timestamp ? item.timestamp.slice(0, 10) : '';
        if (itemDate && itemDate < startDate) return false;
      }
      if (endDate) {
        const itemDate = item.timestamp ? item.timestamp.slice(0, 10) : '';
        if (itemDate && itemDate > endDate) return false;
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          item.refNo.toLowerCase().includes(q) ||
          item.action.toLowerCase().includes(q) ||
          item.performedByName.toLowerCase().includes(q) ||
          (item.employeePf && item.employeePf.toLowerCase().includes(q)) ||
          (item.performedByDesignation && item.performedByDesignation.toLowerCase().includes(q)) ||
          (item.performedByCompanyName && item.performedByCompanyName.toLowerCase().includes(q)) ||
          item.targetPersonOrMachine?.toLowerCase().includes(q) ||
          item.subjectOrDetails.toLowerCase().includes(q) ||
          item.remarks.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [visibleItems, selectedStatus, startDate, endDate, searchTerm]);

  // Reset page on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // Master Admin Delete Action
  const handleDelete = async (item: InboxReportItem) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can delete records');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete profile request ${item.refNo} (${item.performedByName})? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'profile_requests', item.id));
      toast.success('Profile request deleted successfully');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete record: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Clear All
  const handleClearAll = async () => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can clear records');
      return;
    }

    if (items.length === 0) return;

    if (!window.confirm(`Are you sure you want to delete all ${items.length} profile request records in Inbox Report? This action cannot be undone.`)) {
      return;
    }

    try {
      const batch = writeBatch(db);
      items.forEach((item) => {
        const ref = doc(db, 'profile_requests', item.id);
        batch.delete(ref);
      });
      await batch.commit();
      toast.success('All Inbox report records deleted successfully');
    } catch (err: any) {
      console.error('Clear all error:', err);
      toast.error('Failed to clear records: ' + (err?.message || 'Unknown error'));
    }
  };

  // Master Admin Edit Action
  const handleEdit = (item: InboxReportItem) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can edit records');
      return;
    }

    const fields: EditFieldConfig[] = [
      { key: 'status', label: 'Request Status (pending / approved / rejected / returned / forwarded)', type: 'text', required: true },
      { key: 'name', label: 'Employee Name', type: 'text' },
      { key: 'designation', label: 'Designation', type: 'text' },
      { key: 'companyName', label: 'Company Name', type: 'text' },
      { key: 'forwardedToName', label: 'Assigned / Forwarded Authority', type: 'text' },
      { key: 'requestedFieldsDescription', label: 'Changes Description', type: 'textarea' },
      { key: 'remarks', label: 'Remarks / Review Note', type: 'textarea' },
    ];

    setEditModal({
      isOpen: true,
      recordId: item.id,
      collectionName: 'profile_requests',
      title: `Edit Profile Request (${item.refNo})`,
      fields,
      initialData: {
        status: item.rawStatus || 'pending',
        name: item.performedByName,
        designation: item.performedByDesignation,
        companyName: item.performedByCompanyName,
        forwardedToName: item.targetPersonOrMachine,
        requestedFieldsDescription: item.subjectOrDetails.replace(/^Changes:\s*/, ''),
        remarks: item.remarks,
      },
    });
  };

  const handleExportExcel = () => {
    const excelData = filteredItems.map((item, idx) => ({
      'S.No': idx + 1,
      'REQUEST DATE & TIME': item.timestamp ? format(new Date(item.timestamp), 'dd-MM-yyyy HH:mm:ss') : '-',
      'INBOX CATEGORY': 'Profile Request',
      'REF / PF NO': item.refNo || '-',
      'REQUEST STATUS': item.action || '-',
      'EMPLOYEE NAME': item.performedByName + (item.performedByDesignation ? ` (${item.performedByDesignation})` : ''),
      'COMPANY': item.performedByCompanyName || '-',
      'ASSIGNED / FORWARDED TO': item.targetPersonOrMachine || '-',
      'REQUESTED CHANGES': item.subjectOrDetails || '-',
      'REMARKS / REASON': item.remarks || '-',
    }));
    exportReportToExcel(excelData, 'Inbox_Profile_Requests_Report');
  };

  const handleExportPdf = () => {
    const headers = ['S.No', 'Date & Time', 'Ref / PF No', 'Status', 'Employee Name', 'Assigned To', 'Requested Changes', 'Remarks'];
    const rows = filteredItems.map((item, idx) => [
      idx + 1,
      item.timestamp ? format(new Date(item.timestamp), 'dd-MM-yy HH:mm') : '-',
      item.refNo || '-',
      item.action || '-',
      item.performedByName + (item.performedByDesignation ? `\n(${item.performedByDesignation})` : ''),
      item.targetPersonOrMachine || '-',
      item.subjectOrDetails || '-',
      item.remarks || '-',
    ]);
    exportReportToPdf({
      title: 'INBOX PROFILE REQUESTS & AUDIT REPORT',
      subtitle: 'Official Ledger of Employee Profile Update Requests via Inbox (Materials Excluded)',
      filterSummary: `Status: ${selectedStatus.toUpperCase()} | Search: ${searchTerm || 'All'} | Total Records Exported: ${filteredItems.length}`,
      headers,
      rows,
    });
  };

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-300 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search employee, PF, status, changes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50 font-medium text-slate-800"
            />
          </div>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer shadow-xs"
          >
            <option value="all">All Request Statuses (सभी स्थितियां)</option>
            <option value="pending">Pending (लंबित)</option>
            <option value="approved">Approved (मंजूर)</option>
            <option value="rejected">Rejected (अस्वीकृत)</option>
            <option value="returned">Returned (संशोधन हेतु वापस)</option>
            <option value="forwarded">Forwarded (आगे भेजा गया)</option>
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-xl px-2 py-1">
            <Calendar size={13} className="text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-700 cursor-pointer"
              title="From Date"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-[11px] bg-transparent focus:outline-none font-medium text-slate-700 cursor-pointer"
              title="To Date"
            />
          </div>

          {(searchTerm || selectedStatus !== 'all' || startDate || endDate) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedStatus('all');
                setStartDate('');
                setEndDate('');
              }}
              className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-bold transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}

          {/* Clear All Data Button for Master Admin if items exist */}
          {isMasterAdmin && visibleItems.length > 0 && (
            <button
              onClick={handleClearAll}
              title="Delete all records currently in Inbox Report"
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl font-bold border border-rose-200 transition-colors cursor-pointer"
            >
              <Trash size={13} />
              <span>Clear All</span>
            </button>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={handleExportExcel}
            title={`Export complete data of all ${filteredItems.length} records to Excel`}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-emerald-400 cursor-pointer"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            title={`Export complete data of all ${filteredItems.length} records to PDF`}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all focus:ring-2 focus:ring-rose-400 cursor-pointer"
          >
            <FileText size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Table Container with Visible Grid Lines */}
      <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden">
        <div className="p-3.5 bg-slate-50 border-b border-slate-300 flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Mail size={16} className="text-indigo-600" />
            <h3 className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
              Inbox Profile Requests Ledger ({filteredItems.length})
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto border-x-0 border-b border-slate-300">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 text-slate-800 font-extrabold uppercase tracking-wider text-[11px] border-b border-slate-300 select-none">
              <tr>
                <th className="p-3 text-center w-12 border-r border-slate-300">#</th>
                <th className="p-3 border-r border-slate-300 whitespace-nowrap">Date & Time</th>
                <th className="p-3 border-r border-slate-300">Category</th>
                <th className="p-3 border-r border-slate-300 whitespace-nowrap">Ref / PF No</th>
                <th className="p-3 border-r border-slate-300 whitespace-nowrap">Status</th>
                <th className="p-3 border-r border-slate-300">Employee Name</th>
                <th className="p-3 border-r border-slate-300 whitespace-nowrap">Assigned / Currently With (किसके पास है)</th>
                <th className="p-3 border-r border-slate-300">Requested Changes</th>
                <th className="p-3 border-r border-slate-300">Remarks</th>
                <th className="p-3 text-center w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                    Loading Inbox profile requests ledger...
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                    No profile request records match your criteria.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, idx) => {
                  const absoluteIndex = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={item.id + idx} className="hover:bg-indigo-50/40 even:bg-slate-50/50 transition-colors">
                      <td className="p-2.5 text-center font-bold text-slate-500 border-r border-slate-300 font-mono text-[11px]">
                        {absoluteIndex}
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-slate-700 font-medium font-mono text-[11px] border-r border-slate-300">
                        {item.timestamp ? format(new Date(item.timestamp), 'dd-MM-yyyy HH:mm') : '-'}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono font-bold text-indigo-700 whitespace-nowrap border-r border-slate-300 text-xs">
                        {item.refNo}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          item.action.includes('APPROV')
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : item.action.includes('REJECT')
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : item.action.includes('FORWARD')
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : item.action.includes('RETURN')
                            ? 'bg-orange-50 text-orange-800 border-orange-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}>
                          {item.action}
                        </span>
                      </td>
                      <td className="p-2.5 font-semibold text-slate-800 border-r border-slate-300">
                        <div>{item.performedByName}</div>
                        {item.performedByDesignation && (
                          <div className="text-[10px] text-slate-500 font-normal">
                            {item.performedByDesignation} {item.performedByCompanyName ? `• ${item.performedByCompanyName}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 text-slate-800 font-medium border-r border-slate-300">
                        {(() => {
                          const holderInfo = getRequestCurrentHolder(item.rawRequest, item);
                          return (
                            <div className="space-y-0.5">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                <UserCheck size={13} className="text-indigo-600 shrink-0" />
                                <span>{holderInfo.holderName}</span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-medium">
                                {holderInfo.holderRole}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-2.5 text-slate-800 max-w-xs border-r border-slate-300 font-medium text-xs" title={item.subjectOrDetails}>
                        <span className="line-clamp-2 leading-relaxed">{item.subjectOrDetails}</span>
                      </td>
                      <td className="p-2.5 text-slate-600 italic max-w-xs border-r border-slate-300 text-[11px]" title={item.remarks}>
                        <span className="line-clamp-1">{item.remarks || '-'}</span>
                      </td>
                      <td className="p-2.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Eye button for record details */}
                          <button
                            onClick={() => setViewItem(item)}
                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 bg-blue-50/70 shadow-2xs cursor-pointer"
                            title="View Record Details"
                          >
                            <Eye size={14} />
                          </button>

                          {(isMasterAdmin || isFullAdmin) && (
                            <>
                              <button
                                onClick={() => handleEdit(item)}
                                className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200 bg-indigo-50/70 shadow-2xs cursor-pointer"
                                title="Edit Record"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(item)}
                                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-100 rounded-lg transition-colors border border-rose-200 bg-rose-50/70 shadow-2xs cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 10-Row Pagination */}
        <ReportPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredItems.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* View Item Details Modal */}
      <AnimatePresence>
        {viewItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black backdrop-blur-xs cursor-pointer"
              onClick={() => setViewItem(null)}
            />
            
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10 flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-indigo-50/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
                    <Mail size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight">
                      Profile Request Record
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Ref: <strong className="text-indigo-700 font-mono">{viewItem.refNo}</strong> • Category: <strong className="text-slate-700">{viewItem.category}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewItem(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                {/* Prominent Current Custodian: wah request kiske pass hai */}
                {(() => {
                  const holderInfo = getRequestCurrentHolder(viewItem.rawRequest, viewItem);
                  const req = viewItem.rawRequest || {};
                  return (
                    <div className="p-4 rounded-2xl bg-indigo-50/90 border-2 border-indigo-200 shadow-xs space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-indigo-200/80">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-indigo-900 uppercase tracking-wider block">
                            Request Currently With (यह रिक्वेस्ट वर्तमान में किसके पास है)
                          </span>
                          <div className="text-base font-black text-indigo-950 flex items-center gap-2">
                            <UserCheck size={19} className="text-indigo-600 shrink-0" />
                            <span>{holderInfo.holderName}</span>
                          </div>
                          <p className="text-xs text-indigo-800 font-bold">
                            {holderInfo.holderRole}
                          </p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border shrink-0 text-center ${holderInfo.badgeClass}`}>
                          {holderInfo.statusBadgeText}
                        </span>
                      </div>

                      {/* Routing Route Summary */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-white/85 p-2.5 rounded-xl border border-indigo-100/80">
                          <span className="text-slate-500 font-bold block mb-0.5">
                            Applicant (जिसका प्रोफाइल रिक्वेस्ट है):
                          </span>
                          <span className="font-bold text-slate-800">
                            {viewItem.performedByName} {viewItem.employeePf ? `(PF: ${viewItem.employeePf})` : ''}
                          </span>
                          {viewItem.performedByDesignation && (
                            <div className="text-slate-500 text-[10px]">{viewItem.performedByDesignation}</div>
                          )}
                        </div>
                        <div className="bg-white/85 p-2.5 rounded-xl border border-indigo-100/80">
                          <span className="text-slate-500 font-bold block mb-0.5">
                            Forwarded / Assigned To (भेजा गया):
                          </span>
                          <span className="font-bold text-indigo-800">
                            {req.forwardedToName || req.authorityName || viewItem.targetPersonOrMachine || 'Admin / Authority'}
                          </span>
                          {req.forwardedToCompanyName && (
                            <div className="text-slate-500 text-[10px]">Company: {req.forwardedToCompanyName}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50/80 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Reference / PF No</span>
                    <span className="font-mono font-black text-indigo-700 text-sm flex items-center gap-1.5">
                      <Tag size={13} className="text-indigo-500" />
                      {viewItem.refNo}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Current Status</span>
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-500" />
                      {viewItem.action}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Submitted / Updated On</span>
                    <span className="font-mono font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock size={13} className="text-slate-500" />
                      {viewItem.timestamp ? format(new Date(viewItem.timestamp), 'dd-MM-yyyy HH:mm') : '-'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Record Type</span>
                    <span className="font-bold text-slate-800">
                      {viewItem.category}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Employee Name</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User size={13} className="text-slate-500" />
                      {viewItem.performedByName}
                      {viewItem.performedByDesignation && ` (${viewItem.performedByDesignation})`}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Assigned / Reviewer</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-500" />
                      {viewItem.targetPersonOrMachine}
                    </span>
                  </div>

                  {viewItem.performedByCompanyName && (
                    <div className="col-span-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Company / Machine</span>
                      <span className="font-semibold text-slate-700">
                        {viewItem.performedByCompanyName} {viewItem.machineName ? `• Machine: ${viewItem.machineName}` : ''}
                      </span>
                    </div>
                  )}

                  {viewItem.employeeMobile && (
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Contact Mobile</span>
                      <span className="font-mono text-slate-700 flex items-center gap-1">
                        <Phone size={12} className="text-slate-400" />
                        {viewItem.employeeMobile}
                      </span>
                    </div>
                  )}

                  {viewItem.performedByEmail && (
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Email</span>
                      <span className="font-mono text-slate-700 truncate block">
                        {viewItem.performedByEmail}
                      </span>
                    </div>
                  )}
                </div>

                {/* Details / Subject */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                    Requested Changes / Subject
                  </span>
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-slate-800 font-medium whitespace-pre-wrap text-xs leading-relaxed">
                    {viewItem.subjectOrDetails || '-'}
                  </div>
                </div>

                {/* Remarks */}
                {viewItem.remarks && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                      Remarks / Notes / Reason
                    </span>
                    <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/80 text-slate-700 italic text-xs font-medium">
                      "{viewItem.remarks}"
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
                {isFullAdmin && (
                  <button
                    onClick={() => {
                      const item = viewItem;
                      setViewItem(null);
                      handleEdit(item);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Edit size={13} />
                    Edit Record
                  </button>
                )}
                <button
                  onClick={() => setViewItem(null)}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl font-bold text-xs transition-all shadow-xs cursor-pointer"
                >
                  Close View
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Record Modal for Master Admin */}
      <EditReportRecordModal
        isOpen={editModal.isOpen}
        title={editModal.title}
        recordId={editModal.recordId}
        collectionName={editModal.collectionName}
        fields={editModal.fields}
        initialData={editModal.initialData}
        onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
