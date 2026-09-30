import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '../firebase';

export interface EmployeeProfile {
  id?: string;
  employeeId: string;
  loginId?: string;
  name: string;
  mobile: string;
  email: string;
  designation: string;
  address: string;
  doj: string;
  dob: string;
  photoUrl: string;
  employeeSigUrl?: string;
  status: 'active' | 'left';
  pfNo: string;
  esicNo: string;
  role?: string;
  gender?: 'Male' | 'Female' | 'Other';
  accessType?: 'full' | 'limited' | 'admin-light' | 'divisional-admin' | 'zonal-admin';
  machineName?: string;
  pin?: string;
  isPinCreated?: boolean;
  password?: string;
  registeredEmail?: string;
  isEmailVerified?: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
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
  department?: string;
  idNo?: string;
  aadharNo?: string;
  panNo?: string;
  accountNo?: string;
  ifscCode?: string;
  bankName?: string;
  branch?: string;
  zone?: string;
  division?: string;
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
    orderNo?: string;
    reason?: string;
    remarks?: string;
  }[];
  awards?: AwardRecord[];
  pmeRecords?: PmeRecord[];
  careerHistory?: CareerRecord[];
  zoneDivisionHistory?: any[];
  deletedSubRecords?: any[];
}

export interface CareerRecord {
  id?: string;
  companyName: string;
  machineName: string;
  zone: string;
  division: string;
  fromZone?: string;
  fromDivision?: string;
  toZone?: string;
  toDivision?: string;
  fromDateTime: string; // Start date
  toDateTime: string;   // End date or 'Ongoing'
  designation?: string;
  remarks?: string;
  status?: 'active' | 'transferred' | 'completed' | 'left';
  addedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AwardRecord {
  id?: string;
  title: string;
  givenBy?: string;
  date: string;
  category?: string;
  certificateNo?: string;
  remarks?: string;
  createdAt?: string;
}

export interface PmeRecord {
  id?: string;
  examDate: string;
  dueDate?: string;
  nextDueDate?: string;
  memoNo?: string;
  medicalCategory: string;
  otherMedicalCategory?: string;
  fitnessStatus: string;
  hospitalName?: string;
  doctorName?: string;
  certificateNo?: string;
  remarks?: string;
  pdfUrl?: string;
  pdfFileName?: string;
  pdfFileSize?: number;
  addedBy?: string;
  createdAt?: string;
}

export interface ProfileApprovalRequest {
  id: string;
  employeeId: string;
  uid: string;
  name: string;
  email: string;
  mobile: string;
  designation: string;
  gender: 'Male' | 'Female' | 'Other';
  address: string;
  dob: string;
  pfNo: string;
  esicNo: string;
  doj: string;
  photoUrl: string;
  employeeSigUrl?: string;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  createdAt: string;
  remarks?: string;
  authorityId?: string;
  authorityName?: string;
  machineName?: string;
  forwardedToAdmin?: boolean;
  forwardedToCompanyAdmin?: boolean;
  isFullAccessAdmin?: boolean;
  companyName?: string;
  accessType?: string;
  fatherName?: string;
  age?: string;
  sex?: string;
  validityDate?: string;
  department?: string;
  idNo?: string;
  aadharNo?: string;
  panNo?: string;
  accountNo?: string;
  ifscCode?: string;
  bankName?: string;
  branch?: string;
  zone?: string;
  division?: string;
  requestedFieldsDescription?: string; // Shows what was modified, like "Name, Mobile"
  forwardedTo?: string;
  forwardedToName?: string;
  forwardedToEmail?: string;
  forwardedToLoginId?: string;
  forwardedToPfNo?: string;
  forwardedToEmployeeId?: string;
  forwardedToUid?: string;
  isTopAdminRequest?: boolean;
  forwardedToZonalAdmin?: boolean;
  forwardedToDivisionalAdmin?: boolean;
  forwardedToCompanyName?: string;
  forwardedByUid?: string;
  forwardedByEmail?: string;
  forwardedByName?: string;
  forwardedByCompanyName?: string;
  forwardedAt?: string;
}

/**
 * Strictly verifies whether a profile update request is assigned/sent to the given user or employee account.
 * Follows the strict rule: A request is only visible to and actionable by the designated recipient account.
 */
export function isProfileRequestAssignedToUser(
  req: any,
  currentUser: { uid?: string; email?: string | null } | null,
  currentEmployee: (Partial<EmployeeProfile> & { id?: string; [key: string]: any }) | null,
  isTopAdmin: boolean
): boolean {
  if (!req || req.status !== 'pending') return false;
  if (!currentUser) return false;

  const currentAuthUid = (currentUser.uid || '').trim();
  const currentAuthEmail = (currentUser.email || '').trim().toLowerCase();

  // 1. The requester/creator of the request can NEVER be the reviewer/approver of their own request.
  if (req.uid && currentAuthUid && req.uid === currentAuthUid) {
    return false;
  }
  if (currentEmployee?.employeeId && req.employeeId && req.employeeId === currentEmployee.employeeId) {
    return false;
  }
  if (currentEmployee?.id && req.employeeId && req.employeeId === currentEmployee.id) {
    return false;
  }
  if (currentEmployee?.pfNo && req.pfNo && currentEmployee.pfNo.trim().toLowerCase() === req.pfNo.trim().toLowerCase()) {
    return false;
  }

  // Target fields from the request document
  const targetForwardedTo = (req.forwardedTo || '').trim();
  const targetAuthorityId = (req.authorityId || '').trim();
  const targetEmail = (req.forwardedToEmail || '').trim().toLowerCase();
  const targetLoginId = (req.forwardedToLoginId || '').trim().toLowerCase();
  const targetPfNo = (req.forwardedToPfNo || '').trim().toLowerCase();
  const targetEmpId = (req.forwardedToEmployeeId || '').trim();
  const targetUid = (req.forwardedToUid || '').trim();

  // Check if a specific recipient employee was designated
  const hasSpecificTargetEmployee = 
    (targetAuthorityId && targetAuthorityId !== 'admin' && targetAuthorityId !== 'company_admin') ||
    (targetForwardedTo && targetForwardedTo !== 'admin' && targetForwardedTo !== 'company_admin') ||
    Boolean(targetEmpId) ||
    Boolean(targetPfNo) ||
    (Boolean(targetEmail) && targetEmail !== 'imranansari399605@gmail.com' && targetEmail !== 'admin@billedapp.com');

  // 2. Check if the request was sent or forwarded directly to Master / Top Admin
  const isDirectlyForMasterAdmin = 
    !hasSpecificTargetEmployee && (
      req.forwardedToAdmin === true ||
      req.isTopAdminRequest === true ||
      targetForwardedTo === 'admin' ||
      targetAuthorityId === 'admin' ||
      (targetEmail && (targetEmail === 'imranansari399605@gmail.com' || targetEmail === 'admin@billedapp.com'))
    );

  if (isDirectlyForMasterAdmin) {
    // Only the Master / Top Admin can see and act on it
    return isTopAdmin;
  }

  // 3. Check if the request matches the current employee account
  if (currentEmployee) {
    const empId = (currentEmployee.id || '').trim();
    const empEmployeeId = (currentEmployee.employeeId || '').trim();
    const empPf = (currentEmployee.pfNo || '').trim().toLowerCase();
    const empLoginId = ((currentEmployee as any).loginId || '').trim().toLowerCase();
    const empIdNo = (currentEmployee.idNo || '').trim().toLowerCase();
    const empEmail = (currentEmployee.email || '').trim().toLowerCase();
    const empRegEmail = (currentEmployee.registeredEmail || '').trim().toLowerCase();

    // Check by employee Firestore document ID
    if (empId && (targetForwardedTo === empId || targetAuthorityId === empId)) {
      return true;
    }

    // Check by employeeId
    if (empEmployeeId && (targetForwardedTo === empEmployeeId || targetAuthorityId === empEmployeeId || targetEmpId === empEmployeeId)) {
      return true;
    }

    // Check by PF Number
    if (empPf && (targetForwardedTo.toLowerCase() === empPf || targetPfNo === empPf || targetLoginId === empPf)) {
      return true;
    }

    // Check by Login ID or ID No
    if (empLoginId && (targetForwardedTo.toLowerCase() === empLoginId || targetLoginId === empLoginId)) {
      return true;
    }
    if (empIdNo && (targetForwardedTo.toLowerCase() === empIdNo || targetLoginId === empIdNo)) {
      return true;
    }

    // Check by Auth UID
    if (currentAuthUid && (targetForwardedTo === currentAuthUid || targetUid === currentAuthUid || targetAuthorityId === currentAuthUid)) {
      return true;
    }

    // Check by Email
    if (targetEmail) {
      if (empEmail && targetEmail === empEmail) return true;
      if (empRegEmail && targetEmail === empRegEmail) return true;
      if (currentAuthEmail && targetEmail === currentAuthEmail) return true;
    }

    // Special case: if explicitly forwarded to company admin generally without individual ID
    if (req.forwardedToCompanyAdmin && !targetForwardedTo && req.forwardedToCompanyName) {
      const myCo = (currentEmployee.companyName || '').trim().toLowerCase();
      const targetCo = req.forwardedToCompanyName.trim().toLowerCase();
      if (currentEmployee.accessType === 'admin-light' && myCo === targetCo) {
        return true;
      }
    }
  }

  // 4. Fallback: match by email or UID on current user
  if (currentAuthUid && (targetForwardedTo === currentAuthUid || targetUid === currentAuthUid)) {
    return true;
  }
  if (targetEmail && currentAuthEmail && targetEmail === currentAuthEmail) {
    return true;
  }

  return false;
}

/**
 * Finds the corresponding employee document in the 'employees' collection
 * for a given authenticated user (uid and email).
 */
export async function findEmployeeForUser(userUid: string, userEmail: string | null): Promise<EmployeeProfile | null> {
  try {
    // 1. Try to get the user document from the 'users' collection to check if employeeId is already linked
    const userDocRef = doc(db, 'users', userUid);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      if (userData.employeeId) {
        const empDocSnap = await getDoc(doc(db, 'employees', userData.employeeId));
        if (empDocSnap.exists()) {
          const empData = empDocSnap.data();
          return {
            id: userData.employeeId,
            employeeId: userData.employeeId,
            name: empData.name || '',
            mobile: empData.mobile || '',
            email: empData.email || '',
            designation: empData.designation || '',
            address: empData.address || '',
            doj: empData.doj || '',
            dob: empData.dob || '',
            photoUrl: empData.photoUrl || '',
            status: empData.status || 'active',
            pfNo: empData.pfNo || '',
            esicNo: empData.esicNo || '',
            role: userData.role || 'employee',
            gender: empData.sex || userData.gender || 'Male',
            accessType: empData.accessType || 'limited',
            machineName: empData.machineName || '',
            pin: empData.pin || '',
            isPinCreated: empData.isPinCreated || false,
            password: empData.password || '',
            registeredEmail: empData.registeredEmail || empData.email || '',
            isEmailVerified: empData.isEmailVerified || empData.emailVerified || false,
            emailVerified: empData.emailVerified || empData.isEmailVerified || false,
            emailVerifiedAt: empData.emailVerifiedAt || '',
            companyName: empData.companyName || '',
            companyGst: empData.companyGst || '',
            companyMobile: empData.companyMobile || '',
            companyEmail: empData.companyEmail || '',
            companyAddress: empData.companyAddress || '',
            companyDept: empData.companyDept || '',
            fatherName: empData.fatherName || '',
            age: empData.age || '',
            sex: empData.sex || '',
            validityDate: empData.validityDate || '',
            department: empData.department || '',
            idNo: empData.idNo || '',
            aadharNo: empData.aadharNo || '',
            panNo: empData.panNo || '',
            accountNo: empData.accountNo || '',
            ifscCode: empData.ifscCode || '',
            bankName: empData.bankName || '',
            branch: empData.branch || '',
            zone: empData.zone || '',
            division: empData.division || '',
            employmentHistory: empData.employmentHistory || [],
            designationHistory: empData.designationHistory || [],
            employeeSigUrl: empData.employeeSigUrl || '',
            awards: empData.awards || [],
            pmeRecords: empData.pmeRecords || [],
            careerHistory: empData.careerHistory || [],
            zoneDivisionHistory: empData.zoneDivisionHistory || []
          };
        }
      }
    }

    // 2. Fallback: Search the 'employees' collection using the sanitized PF No or matching email
    const querySnapshot = await getDocs(collection(db, 'employees'));
    let foundEmp: EmployeeProfile | null = null;
    
    const isEmployeeEmail = userEmail?.endsWith('@employee.billedapp.com');
    const extractedPf = isEmployeeEmail ? userEmail!.split('@')[0].toLowerCase() : '';
    
    querySnapshot.forEach((d) => {
      const data = d.data();
      const sanitizedEmpPf = data.pfNo?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
      
      const emailMatches = userEmail && data.email && data.email.toLowerCase() === userEmail.toLowerCase();
      const pfMatches = extractedPf && sanitizedEmpPf === extractedPf;
      
      if (emailMatches || pfMatches) {
        foundEmp = {
          employeeId: d.id,
          name: data.name || '',
          mobile: data.mobile || '',
          email: data.email || '',
          designation: data.designation || '',
          address: data.address || '',
          doj: data.doj || '',
          dob: data.dob || '',
          photoUrl: data.photoUrl || '',
          status: data.status || 'active',
          pfNo: data.pfNo || '',
          esicNo: data.esicNo || '',
          role: 'employee',
          gender: data.sex || 'Male',
          accessType: data.accessType || 'limited',
          machineName: data.machineName || '',
          pin: data.pin || '',
          isPinCreated: data.isPinCreated || false,
          password: data.password || '',
          registeredEmail: data.registeredEmail || data.email || '',
          isEmailVerified: data.isEmailVerified || data.emailVerified || false,
          emailVerified: data.emailVerified || data.isEmailVerified || false,
          emailVerifiedAt: data.emailVerifiedAt || '',
          companyName: data.companyName || '',
          companyGst: data.companyGst || '',
          companyMobile: data.companyMobile || '',
          companyEmail: data.companyEmail || '',
          companyAddress: data.companyAddress || '',
          companyDept: data.companyDept || '',
          fatherName: data.fatherName || '',
          age: data.age || '',
          sex: data.sex || '',
          validityDate: data.validityDate || '',
          department: data.department || '',
          idNo: data.idNo || '',
          aadharNo: data.aadharNo || '',
          panNo: data.panNo || '',
          accountNo: data.accountNo || '',
          ifscCode: data.ifscCode || '',
          bankName: data.bankName || '',
          branch: data.branch || '',
          zone: data.zone || '',
          division: data.division || '',
          employmentHistory: data.employmentHistory || [],
          designationHistory: data.designationHistory || [],
          employeeSigUrl: data.employeeSigUrl || '',
          awards: data.awards || [],
          pmeRecords: data.pmeRecords || [],
          careerHistory: data.careerHistory || [],
          zoneDivisionHistory: data.zoneDivisionHistory || []
        };
      }
    });

    return foundEmp;
  } catch (error) {
    console.error('Error finding employee for user:', error);
    return null;
  }
}

/**
 * Strips all internal dummy domain suffixes (.billedapp.com) and never displays .billedapp anywhere.
 */
export function cleanDisplayEmail(email?: string | null): string {
  if (!email) return '';
  const trimmed = email.trim();
  if (trimmed.toLowerCase().includes('billedapp.com') || trimmed.toLowerCase().includes('.billedapp')) {
    return '';
  }
  return trimmed;
}

/**
 * Strips internal dummy domains from display names and values.
 */
export function cleanDisplayName(nameOrIdentifier?: string | null): string {
  if (!nameOrIdentifier) return '';
  let cleaned = nameOrIdentifier.trim();
  if (cleaned.toLowerCase().includes('billedapp.com') || cleaned.toLowerCase().includes('.billedapp')) {
    cleaned = cleaned.replace(/@.*billedapp\.com/gi, '').replace(/\.billedapp(\.com)?/gi, '');
  }
  if (!cleaned || cleaned.toLowerCase() === 'admin' || cleaned.toLowerCase().startsWith('master.')) {
    return 'Master Administrator';
  }
  return cleaned;
}

/**
 * Seniority ranks for organizational hierarchy:
 * 100: Master / Top Root Admin (Full authority over all zones, divisions, companies, machines)
 *  80: Zonal Admin (Authority over their assigned Railway Zone)
 *  60: Divisional Admin (Authority over their assigned Railway Division)
 *  40: Admin-Light (Company Admin - authority over company machines and staff)
 *  20: Full Access Admin (Machine In-Charge - authority over specific machine operations)
 *  10: Limited Employee (Non-admin staff)
 */
export const ROLE_HIERARCHY_RANKS: Record<string, number> = {
  'master-admin': 100,
  'zonal-admin': 80,
  'divisional-admin': 60,
  'admin-light': 40,
  'full': 20,
  'limited': 10
};

export function getEmployeeRoleRank(isEmployeeUser: boolean, accessType?: string): number {
  if (!isEmployeeUser) return ROLE_HIERARCHY_RANKS['master-admin'];
  if (accessType === 'zonal-admin') return ROLE_HIERARCHY_RANKS['zonal-admin'];
  if (accessType === 'divisional-admin') return ROLE_HIERARCHY_RANKS['divisional-admin'];
  if (accessType === 'admin-light') return ROLE_HIERARCHY_RANKS['admin-light'];
  if (accessType === 'full') return ROLE_HIERARCHY_RANKS['full'];
  return ROLE_HIERARCHY_RANKS['limited'];
}

export function isSeniorAuthority(
  callerIsEmployee: boolean,
  callerAccessType?: string,
  targetAccessType?: string
): boolean {
  if (!callerIsEmployee) return true; // Master Admin is senior to all
  const callerRank = getEmployeeRoleRank(callerIsEmployee, callerAccessType);
  const targetRank = getEmployeeRoleRank(true, targetAccessType);
  return callerRank > targetRank;
}

/**
 * Formats creator/author name cleanly for UI display and reports.
 */
export function formatCreatorName(name?: string): string {
  if (!name) return 'Admin';
  return name.trim();
}

export interface FilterAccessPermissions {
  isFullAdmin: boolean;
  canChangeMachine: boolean;
  canChangeZone: boolean;
  canChangeDivision: boolean;
}

export function getFilterAccessPermissions(
  isEmployee: boolean,
  accessType?: string,
  employeeProfile?: { machineName?: string; zone?: string; division?: string } | null,
  cachedData?: { machineName?: string; zone?: string; division?: string }
): FilterAccessPermissions {
  if (!isEmployee) {
    return {
      isFullAdmin: true,
      canChangeMachine: true,
      canChangeZone: true,
      canChangeDivision: true,
    };
  }

  const role = accessType || 'limited';
  const machine = (employeeProfile?.machineName || cachedData?.machineName || '').trim();
  const zone = (employeeProfile?.zone || cachedData?.zone || '').trim();
  const division = (employeeProfile?.division || cachedData?.division || '').trim();

  // Full Admin Employee: if mapped to a specific machine, locked strictly to that machine!
  if (role === 'full') {
    const hasMachine = !!machine;
    return {
      isFullAdmin: !hasMachine,
      canChangeMachine: !hasMachine,
      canChangeZone: !hasMachine && !zone,
      canChangeDivision: !hasMachine && !division,
    };
  }

  // Zonal Admin: zone is fixed & locked, division and machine can be filtered
  if (role === 'zonal-admin') {
    return {
      isFullAdmin: false,
      canChangeMachine: true,
      canChangeZone: false,
      canChangeDivision: true,
    };
  }

  // Divisional Admin: zone and division are fixed & locked, machine can be filtered
  if (role === 'divisional-admin') {
    return {
      isFullAdmin: false,
      canChangeMachine: true,
      canChangeZone: false,
      canChangeDivision: false,
    };
  }

  // Company Admin (admin-light)
  if (role === 'admin-light') {
    return {
      isFullAdmin: false,
      canChangeMachine: !machine, // locked if employee has an assigned machine
      canChangeZone: !zone,
      canChangeDivision: !division,
    };
  }

  // Limited / Regular employee:
  // Locked to their machine, zone, and division!
  return {
    isFullAdmin: false,
    canChangeMachine: false,
    canChangeZone: false,
    canChangeDivision: false,
  };
}

/**
 * Checks if a demand is self-created / raised by the currently logged-in user.
 */
export function isDemandSelfCreated(
  d: any,
  user: any | null,
  currentEmployee: EmployeeProfile | null
): boolean {
  if (!user && !currentEmployee) return false;
  const currentAuthEmail = (user?.email || '').trim().toLowerCase();
  const currentAuthUid = (user?.uid || '').trim();
  const currentPfNo = (currentEmployee?.pfNo || '').trim().toLowerCase();
  const currentLoginId = ((currentEmployee as any)?.loginId || '').trim().toLowerCase();
  const currentEmpId = (currentEmployee?.id || '').trim();
  const currentEmpEmployeeId = (currentEmployee?.employeeId || '').trim();
  const currentName = (currentEmployee?.name || '').trim().toLowerCase();

  return Boolean(
    (currentAuthUid && d.createdByUid && d.createdByUid === currentAuthUid) ||
    (currentAuthEmail && d.createdByEmail && d.createdByEmail.toLowerCase() === currentAuthEmail) ||
    (currentEmployee?.registeredEmail && d.createdByEmail && d.createdByEmail.toLowerCase() === currentEmployee.registeredEmail.toLowerCase()) ||
    (currentPfNo && d.createdByPfNo && d.createdByPfNo.toLowerCase() === currentPfNo) ||
    (currentLoginId && d.createdByPfNo && d.createdByPfNo.toLowerCase() === currentLoginId) ||
    (currentEmpId && d.createdByEmployeeId && d.createdByEmployeeId === currentEmpId) ||
    (currentEmpEmployeeId && d.createdByEmployeeId && d.createdByEmployeeId === currentEmpEmployeeId) ||
    (currentName && d.createdByEmployeeName && d.createdByEmployeeName.toLowerCase() === currentName) ||
    (currentEmpId && d.issuedToEmployeeId && d.issuedToEmployeeId === currentEmpId) ||
    (currentEmpEmployeeId && d.issuedToEmployeeId && d.issuedToEmployeeId === currentEmpEmployeeId) ||
    (currentPfNo && d.issuedToPfNo && d.issuedToPfNo.toLowerCase() === currentPfNo) ||
    (currentAuthUid && d.issuedToUid && d.issuedToUid === currentAuthUid) ||
    (currentAuthEmail && d.issuedToEmail && d.issuedToEmail.toLowerCase() === currentAuthEmail) ||
    (currentName && d.issuedToEmployeeName && d.issuedToEmployeeName.toLowerCase() === currentName)
  );
}

/**
 * Checks if a demand is explicitly forwarded/assigned to the currently logged-in user / account.
 * Handles Document ID, employeeId, Auth UID, Email, PF No, Login ID, Name,
 * Company Admin role forwarding, and Super Admin forwarding.
 */
export function isDemandAssignedToUser(
  d: any,
  user: any | null,
  currentEmployee: EmployeeProfile | null,
  allEmployees?: any[]
): boolean {
  if (!user && !currentEmployee) return false;

  const currentAuthEmail = (user?.email || '').trim().toLowerCase();
  const currentAuthUid = (user?.uid || '').trim();
  const isTopAdmin = Boolean(
    currentAuthEmail === 'imranansari399605@gmail.com' ||
    (!currentAuthEmail.endsWith('@employee.billedapp.com') && 
      (currentEmployee?.accessType === 'full' || (!currentEmployee && currentAuthEmail)))
  );

  const targetForwardedTo = (d.forwardedTo || '').trim();
  const targetEmail = (d.forwardedToEmail || '').trim().toLowerCase();
  const targetUid = (d.forwardedToUid || '').trim();
  const targetPfNo = (d.forwardedToPfNo || '').trim().toLowerCase();
  const targetEmpId = (d.forwardedToEmployeeId || '').trim();
  const targetLoginId = (d.forwardedToLoginId || '').trim().toLowerCase();
  const targetName = (d.forwardedToName || '').trim().toLowerCase();

  // If the demand was never forwarded to any recipient, it is NOT assigned to anyone
  const hasForwardTarget = Boolean(
    targetForwardedTo ||
    targetEmail ||
    targetUid ||
    targetPfNo ||
    targetEmpId ||
    targetLoginId ||
    targetName ||
    d.forwardedToAdmin ||
    d.forwardedToCompanyAdmin
  );
  if (!hasForwardTarget) {
    return false;
  }

  // Resolve active employee: if currentEmployee state is loading/null, lookup from allEmployees
  let emp = currentEmployee;
  if (!emp && allEmployees && allEmployees.length > 0 && user) {
    emp = allEmployees.find((e: any) =>
      (currentAuthEmail && e.email && e.email.trim().toLowerCase() === currentAuthEmail) ||
      (currentAuthEmail && e.registeredEmail && e.registeredEmail.trim().toLowerCase() === currentAuthEmail) ||
      (currentAuthUid && e.uid && e.uid === currentAuthUid) ||
      (currentAuthUid && e.authUid && e.authUid === currentAuthUid)
    ) || null;
  }

  // Check if this demand is forwarded to a specific individual employee
  const isTargetSpecificEmployee = Boolean(
    targetForwardedTo ||
    targetEmail ||
    targetUid ||
    targetPfNo ||
    targetEmpId ||
    targetLoginId ||
    (targetName && targetName !== 'master admin' && targetName !== 'master super admin' && targetName !== 'depot official')
  );

  if (isTargetSpecificEmployee) {
    // STRICT ACCORDING TO USER DIRECTIVE:
    // "To user depot me wahi item show kare jisko demand item jis employee ke forward kre usi ke account me show kare baki kisi ke account me wah item visiable n hoye chahe wah ki bhe ho"
    // Only the exact matching employee account is allowed to see this demand item.
    // Absolutely nobody else (not even Super Admin, not Company Admin, no other employee).
    if (emp) {
      const empId = (emp.id || '').trim();
      const empEmployeeId = (emp.employeeId || '').trim();
      const empPf = (emp.pfNo || '').trim().toLowerCase();
      const empLoginId = ((emp as any).loginId || '').trim().toLowerCase();
      const empIdNo = (emp.idNo || '').trim().toLowerCase();
      const empEmail = (emp.email || '').trim().toLowerCase();
      const empRegEmail = (emp.registeredEmail || '').trim().toLowerCase();
      const empName = (emp.name || '').trim().toLowerCase();
      const empUid = ((emp as any).uid || (emp as any).authUid || '').trim();

      if (empId && (targetForwardedTo === empId || targetEmpId === empId)) return true;
      if (empEmployeeId && (targetForwardedTo === empEmployeeId || targetEmpId === empEmployeeId)) return true;
      if (empUid && (targetForwardedTo === empUid || targetUid === empUid)) return true;
      if (targetEmail) {
        if (empEmail && targetEmail === empEmail) return true;
        if (empRegEmail && targetEmail === empRegEmail) return true;
        if (currentAuthEmail && targetEmail === currentAuthEmail) return true;
      }
      if (empPf && (targetForwardedTo.toLowerCase() === empPf || targetPfNo === empPf || targetLoginId === empPf)) return true;
      if (empLoginId && (targetForwardedTo.toLowerCase() === empLoginId || targetLoginId === empLoginId || targetPfNo === empLoginId)) return true;
      if (empIdNo && (targetForwardedTo.toLowerCase() === empIdNo || targetLoginId === empIdNo)) return true;
      if (targetName && empName && targetName === empName) return true;
      if (targetForwardedTo && empName && targetForwardedTo.toLowerCase() === empName) return true;
    }

    // Direct auth fallback if no employee doc is loaded
    if (currentAuthUid && (targetForwardedTo === currentAuthUid || targetUid === currentAuthUid)) return true;
    if (targetEmail && currentAuthEmail && targetEmail === currentAuthEmail) return true;

    // Check if target matches employee machine name
    if (emp?.machineName && targetForwardedTo && targetForwardedTo.toLowerCase() === emp.machineName.trim().toLowerCase()) {
      return true;
    }

    // If it was targeted to a specific employee and the logged-in user did not match, DO NOT MATCH ANYONE ELSE!
    return false;
  }

  // If forwarded to Company Admin explicitly:
  if (d.forwardedToCompanyAdmin) {
    const isCompanyLightAdmin = emp?.accessType === 'admin-light';
    if (isCompanyLightAdmin) {
      if (!d.forwardedToCompanyName || !emp?.companyName || d.forwardedToCompanyName.trim().toLowerCase() === emp.companyName.trim().toLowerCase()) {
        return true;
      }
    }
    if (isTopAdmin) {
      return true;
    }
  }

  // If forwarded to a specific Machine depot:
  if (emp?.machineName) {
    const m = emp.machineName.trim().toLowerCase();
    if (d.forwardedToMachine && d.forwardedToMachine.trim().toLowerCase() === m) return true;
    if (d.targetMachineName && d.targetMachineName.trim().toLowerCase() === m) return true;
  }

  // If escalated to Master Admin explicitly (without an individual employee target):
  if (d.forwardedToAdmin && isTopAdmin) {
    return true;
  }

  return false;
}

/**
 * Strict Account Isolation for Accountal Module:
 * "Accountal me wahi items show kare jisko accountal item jaye baki kisi ke account me show n kare"
 * Shows ONLY items that were explicitly issued to / intended for the currently logged-in user's account.
 * Excludes items issued by the current user to others, or items meant for other employees/machines.
 */
export function isAccountalItemForUser(
  d: any,
  currentUser: any | null,
  currentEmployee: EmployeeProfile | null,
  allEmployees?: any[]
): boolean {
  if (!d) return false;
  if (!currentUser && !currentEmployee) return false;

  // Active user / employee identifiers
  const myUid = (currentUser?.uid || '').trim();
  const myEmail = (currentUser?.email || '').trim().toLowerCase();

  // Resolve employee doc if not passed directly
  let emp = currentEmployee;
  if (!emp && allEmployees && allEmployees.length > 0) {
    emp = allEmployees.find((e: any) =>
      (myEmail && e.email && e.email.trim().toLowerCase() === myEmail) ||
      (myEmail && e.registeredEmail && e.registeredEmail.trim().toLowerCase() === myEmail) ||
      (myUid && (e.uid === myUid || e.authUid === myUid))
    ) || null;
  }

  const myRegEmail = (emp?.registeredEmail || '').trim().toLowerCase();
  const myEmpId = (emp?.employeeId || emp?.id || '').trim();
  const myPf = (emp?.pfNo || '').trim().toLowerCase();
  const myLoginId = ((emp as any)?.loginId || '').trim().toLowerCase();
  const myName = (emp?.name || currentUser?.displayName || '').trim().toLowerCase();
  const myMachine = (emp?.machineName || '').trim().toLowerCase();

  // Demand recipient identifiers (who the item went to / was issued to)
  const issuedToUid = (d.issuedToUid || '').trim();
  const issuedToEmail = (d.issuedToEmail || '').trim().toLowerCase();
  const issuedToEmpId = (d.issuedToEmployeeId || '').trim();
  const issuedToPf = (d.issuedToPfNo || '').trim().toLowerCase();
  const issuedToName = (d.issuedToEmployeeName || d.issuedToName || d.issuedTo || '').trim().toLowerCase();
  const receiverName = (d.receiverName || d.receipts?.[0]?.receiverName || '').trim().toLowerCase();

  // Demand creator / requester identifiers (the person who requested the item to be issued to their account)
  const createdByUid = (d.createdByUid || '').trim();
  const createdByEmail = (d.createdByEmail || '').trim().toLowerCase();
  const createdByEmpId = (d.createdByEmployeeId || '').trim();
  const createdByPf = (d.createdByPfNo || '').trim().toLowerCase();
  const createdByName = (d.createdByEmployeeName || '').trim().toLowerCase();

  // Target machine
  const destMachine = (d.requestingMachineName || d.machineName || d.issuedToMachine || '').trim().toLowerCase();

  // Issuer / Sender identifiers (the depot or official who issued the item out)
  const issuedByUid = (d.issuedByUid || d.lastActionByUid || '').trim();
  const issuedByEmail = (d.issuedByEmail || d.lastActionByEmail || '').trim().toLowerCase();
  const issuedByEmpId = (d.issuedByEmployeeId || '').trim();
  const issuedByPf = (d.issuedByPfNo || '').trim().toLowerCase();
  const issuedByName = (d.issuedBy || d.lastActionByName || '').trim().toLowerCase();
  const forwardedToUid = (d.forwardedToUid || '').trim();
  const forwardedToEmail = (d.forwardedToEmail || '').trim().toLowerCase();
  const forwardedToEmpId = (d.forwardedToEmployeeId || '').trim();
  const forwardedToPf = (d.forwardedToPfNo || '').trim().toLowerCase();
  const forwardedToName = (d.forwardedToName || d.forwardedTo || '').trim().toLowerCase();

  // 1. Check if the current user is the ISSUER / FORWARDED OFFICIAL who issued the item to someone else.
  // The issuer must NEVER see the issued item in their own Accountal register, because they issued it OUT!
  const isSenderOrForwardedAuthority = Boolean(
    (myUid && ((issuedByUid && issuedByUid === myUid) || (forwardedToUid && forwardedToUid === myUid))) ||
    (myEmail && ((issuedByEmail && issuedByEmail === myEmail) || (forwardedToEmail && forwardedToEmail === myEmail))) ||
    (myEmpId && ((issuedByEmpId && issuedByEmpId === myEmpId) || (forwardedToEmpId && forwardedToEmpId === myEmpId))) ||
    (myPf && ((issuedByPf && issuedByPf === myPf) || (forwardedToPf && forwardedToPf === myPf))) ||
    (myName && ((issuedByName && issuedByName === myName) || (forwardedToName && forwardedToName === myName)))
  );

  // 2. Check if the current user is the actual intended RECIPIENT of the item.
  const isDirectRecipient = Boolean(
    // Matched by Auth UID
    (myUid && ((issuedToUid && issuedToUid === myUid) || (!issuedToUid && createdByUid && createdByUid === myUid))) ||
    // Matched by Email
    (myEmail && (
      (issuedToEmail && issuedToEmail === myEmail) ||
      (!issuedToEmail && createdByEmail && createdByEmail === myEmail)
    )) ||
    (myRegEmail && (
      (issuedToEmail && issuedToEmail === myRegEmail) ||
      (!issuedToEmail && createdByEmail && createdByEmail === myRegEmail)
    )) ||
    // Matched by Employee ID
    (myEmpId && (
      (issuedToEmpId && (issuedToEmpId === myEmpId || issuedToEmpId === emp?.id || issuedToEmpId === emp?.employeeId)) ||
      (!issuedToEmpId && createdByEmpId && (createdByEmpId === myEmpId || createdByEmpId === emp?.id || createdByEmpId === emp?.employeeId))
    )) ||
    // Matched by PF Number / Login ID
    (myPf && (
      (issuedToPf && issuedToPf === myPf) ||
      (!issuedToPf && createdByPf && createdByPf === myPf)
    )) ||
    (myLoginId && (
      (issuedToPf && issuedToPf === myLoginId) ||
      (!issuedToPf && createdByPf && createdByPf === myLoginId)
    )) ||
    // Matched by Name
    (myName && (
      (issuedToName && (issuedToName === myName || issuedToName.includes(myName) || myName.includes(issuedToName))) ||
      (receiverName && (receiverName === myName || receiverName.includes(myName) || myName.includes(receiverName))) ||
      (!issuedToName && createdByName && (createdByName === myName || createdByName.includes(myName) || myName.includes(createdByName)))
    ))
  );

  // If current user is the issuer who issued it out to someone else, they must NOT see it in their Accountal
  if (isSenderOrForwardedAuthority && !isDirectRecipient) {
    return false;
  }

  // If this demand has specific recipient employee info:
  const hasSpecificTarget = Boolean(
    issuedToEmpId ||
    issuedToUid ||
    issuedToEmail ||
    issuedToPf ||
    issuedToName ||
    createdByEmpId ||
    createdByUid ||
    createdByEmail ||
    createdByPf ||
    createdByName
  );

  if (hasSpecificTarget) {
    // If it has a specific recipient, ONLY that exact recipient gets to see it!
    return isDirectRecipient;
  }

  // Fallback for generic legacy items without individual employee info:
  // Must match the user's assigned machine, and must not be from the machine itself if it was the issuing depot
  if (myMachine && destMachine && myMachine === destMachine) {
    const issuingDepot = (d.issuedFromMachine || d.issuedFromDepot || d.issuingCompany || d.sourceDepot || '').trim().toLowerCase();
    if (issuingDepot && issuingDepot === myMachine && isSenderOrForwardedAuthority) {
      return false;
    }
    return true;
  }

  return false;
}

export interface CareerTransitionParams {
  currentCareerHistory?: CareerRecord[];
  newPosting: {
    companyName: string;
    machineName: string;
    zone: string;
    division: string;
    fromZone?: string;
    fromDivision?: string;
    toZone?: string;
    toDivision?: string;
    designation?: string;
    fromDateTime: string; // The shift or transfer date
    remarks?: string;
    status?: 'active' | 'transferred' | 'completed' | 'left';
    addedBy?: string;
  };
  baselineEmployee?: {
    doj?: string;
    companyName?: string;
    machineName?: string;
    zone?: string;
    division?: string;
    designation?: string;
  };
}

/**
 * Automates career history updates when an employee changes assignment,
 * their machine shifts to another division/zone, or they come from another company.
 */
export function recordCareerTransition(params: CareerTransitionParams): CareerRecord[] {
  const { currentCareerHistory = [], newPosting, baselineEmployee } = params;
  const history: CareerRecord[] = [...currentCareerHistory];
  const shiftDate = (newPosting.fromDateTime || new Date().toISOString().split('T')[0]).trim();

  // Check if there is an active record currently
  const activeIdx = history.findIndex(
    h => h.toDateTime === 'Ongoing' || h.status === 'active' || !h.toDateTime
  );

  if (activeIdx !== -1) {
    const active = history[activeIdx];
    // Check if everything is identical
    const isSame =
      (active.companyName || '').trim() === (newPosting.companyName || '').trim() &&
      (active.machineName || '').trim() === (newPosting.machineName || '').trim() &&
      (active.zone || '').trim() === (newPosting.zone || '').trim() &&
      (active.division || '').trim() === (newPosting.division || '').trim() &&
      (!newPosting.designation || (active.designation || '').trim() === (newPosting.designation || '').trim());

    if (!isSame) {
      // Close the previous active record up to shiftDate
      history[activeIdx] = {
        ...active,
        toDateTime: shiftDate,
        fromZone: active.fromZone || active.zone,
        fromDivision: active.fromDivision || active.division,
        toZone: newPosting.zone,
        toDivision: newPosting.division,
        status: (newPosting.status === 'left' ? 'left' : 'transferred'),
        updatedAt: new Date().toISOString(),
        updatedBy: newPosting.addedBy || 'System'
      };

      // Add the new active record starting from shiftDate
      history.unshift({
        id: `career_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        companyName: newPosting.companyName || 'General',
        machineName: newPosting.machineName || 'General',
        zone: newPosting.zone || 'N/A',
        division: newPosting.division || 'N/A',
        fromZone: active.zone || newPosting.fromZone || newPosting.zone,
        fromDivision: active.division || newPosting.fromDivision || newPosting.division,
        toZone: newPosting.toZone || newPosting.zone,
        toDivision: newPosting.toDivision || newPosting.division,
        designation: newPosting.designation || active.designation || baselineEmployee?.designation || 'Staff',
        fromDateTime: shiftDate,
        toDateTime: 'Ongoing',
        status: 'active',
        remarks: newPosting.remarks || '',
        addedBy: newPosting.addedBy || 'System',
        createdAt: new Date().toISOString()
      });
    }
  } else {
    // If no prior active record exists in careerHistory
    const baselineDoj = (baselineEmployee?.doj || '').trim();
    if (baselineDoj && baselineDoj < shiftDate) {
      const priorCompany = baselineEmployee?.companyName || newPosting.companyName || 'General';
      const priorMachine = baselineEmployee?.machineName || newPosting.machineName || 'General';
      const priorZone = baselineEmployee?.zone || newPosting.zone || 'N/A';
      const priorDivision = baselineEmployee?.division || newPosting.division || 'N/A';
      const priorDesignation = baselineEmployee?.designation || newPosting.designation || 'Staff';

      // Insert prior posting from DOJ to shiftDate
      history.push({
        id: `career_${Date.now() - 1000}_${Math.random().toString(36).substring(2, 7)}`,
        companyName: priorCompany,
        machineName: priorMachine,
        zone: priorZone,
        division: priorDivision,
        fromZone: priorZone,
        fromDivision: priorDivision,
        toZone: newPosting.zone || 'N/A',
        toDivision: newPosting.division || 'N/A',
        designation: priorDesignation,
        fromDateTime: baselineDoj,
        toDateTime: shiftDate,
        status: 'transferred',
        remarks: `Transferred: ${priorZone} (${priorDivision}) ➔ ${newPosting.zone} (${newPosting.division})`,
        addedBy: newPosting.addedBy || 'System',
        createdAt: new Date().toISOString()
      });
    }

    // Add new active record starting from shiftDate
    history.unshift({
      id: `career_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyName: newPosting.companyName || 'General',
      machineName: newPosting.machineName || 'General',
      zone: newPosting.zone || 'N/A',
      division: newPosting.division || 'N/A',
      fromZone: newPosting.fromZone || baselineEmployee?.zone || newPosting.zone,
      fromDivision: newPosting.fromDivision || baselineEmployee?.division || newPosting.division,
      toZone: newPosting.toZone || newPosting.zone,
      toDivision: newPosting.toDivision || newPosting.division,
      designation: newPosting.designation || baselineEmployee?.designation || 'Staff',
      fromDateTime: shiftDate,
      toDateTime: 'Ongoing',
      status: 'active',
      remarks: newPosting.remarks || '',
      addedBy: newPosting.addedBy || 'System',
      createdAt: new Date().toISOString()
    });
  }

  // Sort chronologically (Ongoing on top, then descending by fromDateTime)
  history.sort((a, b) => {
    const isAOngoing = a.toDateTime === 'Ongoing' || !a.toDateTime || a.status === 'active';
    const isBOngoing = b.toDateTime === 'Ongoing' || !b.toDateTime || b.status === 'active';
    if (isAOngoing && !isBOngoing) return -1;
    if (isBOngoing && !isAOngoing) return 1;
    return (b.fromDateTime || '').localeCompare(a.fromDateTime || '');
  });

  return history;
}

/**
 * Reconciles and compiles a complete career timeline for an employee directly
 * from machine movement history and previous employment records.
 * 
 * Rules:
 * 1. Determines where the machine was stationed at employee's date of joining (DOJ).
 * 2. If machine moves within the same zone and same division -> NOT saved in career history.
 * 3. If machine moves to a different division/zone -> the tenure in the previous division
 *    is saved in past career history (from start date to shift date), and a new posting
 *    begins from the shift date in the new division.
 * 4. Preserves prior company history before joining.
 */
export function buildComprehensiveCareerHistory(
  employee: EmployeeProfile,
  machineMovements?: any[]
): CareerRecord[] {
  const result: CareerRecord[] = [];
  const empCompany = (employee.companyName || '').trim();
  const empMachine = (employee.machineName || '').trim();
  const empDoj = (employee.doj ? employee.doj.split('T')[0] : '').trim();
  const empDesignation = employee.designation || 'Staff';

  // 1. Include past records from prior companies or records prior to employee joining
  if (employee.careerHistory && Array.isArray(employee.careerHistory)) {
    employee.careerHistory.forEach(rec => {
      if (!rec) return;
      const isOtherCompany =
        rec.companyName &&
        empCompany &&
        rec.companyName.trim().toLowerCase() !== empCompany.toLowerCase();
      const isPriorDoj =
        empDoj &&
        rec.toDateTime &&
        rec.toDateTime !== 'Ongoing' &&
        rec.toDateTime <= empDoj;

      if (isOtherCompany || isPriorDoj || rec.status === 'left') {
        result.push({
          ...rec,
          fromDateTime: rec.fromDateTime ? rec.fromDateTime.split('T')[0] : '',
          toDateTime: rec.toDateTime ? rec.toDateTime.split('T')[0] : ''
        });
      }
    });
  }

  // 2. Derive machine deployment history directly from machineMovements
  if (empMachine && empMachine !== 'General' && machineMovements && machineMovements.length > 0) {
    // Filter all movements for this machine and sort chronologically by movement date
    const relevantMovements = [...machineMovements]
      .filter(m => (m.machineName || '').trim().toLowerCase() === empMachine.toLowerCase())
      .sort((a, b) => {
        const dA = a.fromDateTime || a.createdAt || '';
        const dB = b.fromDateTime || b.createdAt || '';
        return dA.localeCompare(dB);
      });

    // Step A: Determine where the machine was when employee joined (empDoj)
    const movsBeforeOrOnDoj = empDoj
      ? relevantMovements.filter(m => (m.fromDateTime || '').split('T')[0] <= empDoj)
      : [];
    const firstMovAfterDoj = empDoj
      ? relevantMovements.find(m => (m.fromDateTime || '').split('T')[0] > empDoj)
      : relevantMovements[0];

    let initialZone = employee.zone || 'West Central Railway';
    let initialDivision = employee.division || 'Jabalpur';

    if (movsBeforeOrOnDoj.length > 0) {
      const lastMov = movsBeforeOrOnDoj[movsBeforeOrOnDoj.length - 1];
      if (lastMov.toDivision) {
        initialZone = lastMov.toZone || initialZone;
        initialDivision = lastMov.toDivision;
      }
    } else if (firstMovAfterDoj) {
      if (firstMovAfterDoj.fromDivision) {
        initialZone = firstMovAfterDoj.fromZone || initialZone;
        initialDivision = firstMovAfterDoj.fromDivision;
      }
    }

    // Step B: Track machine movements after employee joined
    let currentZone = initialZone;
    let currentDivision = initialDivision;
    let currentStartDate = empDoj || (relevantMovements[0]?.fromDateTime ? relevantMovements[0].fromDateTime.split('T')[0] : new Date().toISOString().split('T')[0]);

    const movsAfterDoj = empDoj
      ? relevantMovements.filter(m => (m.fromDateTime || '').split('T')[0] > empDoj)
      : relevantMovements;

    for (const mov of movsAfterDoj) {
      const shiftDate = mov.fromDateTime ? mov.fromDateTime.split('T')[0] : '';
      if (!shiftDate) continue;

      const destZone = mov.toZone || currentZone;
      const destDivision = mov.toDivision || currentDivision;
      const originZone = mov.fromZone || currentZone;
      const originDivision = mov.fromDivision || currentDivision;

      // Rule: "if machine movement same zone or same division than not save data in carrer"
      const isSameDivision =
        destDivision.trim().toLowerCase() === currentDivision.trim().toLowerCase() &&
        destZone.trim().toLowerCase() === currentZone.trim().toLowerCase();

      if (isSameDivision) {
        // Machine moved inside same division/zone -> do not save career record, continuous tenure continues
        continue;
      }

      // Machine moved to a different division!
      // "aur us waqt ka data cairrer me save ho jaye"
      if (currentStartDate < shiftDate) {
        result.push({
          id: `mov_${mov.id || Math.random().toString(36).substring(2, 7)}_${shiftDate}`,
          companyName: mov.companyName || empCompany || 'General',
          machineName: empMachine,
          zone: currentZone,
          division: currentDivision,
          fromZone: originZone,
          fromDivision: originDivision,
          toZone: destZone,
          toDivision: destDivision,
          designation: empDesignation,
          fromDateTime: currentStartDate,
          toDateTime: shiftDate,
          status: 'transferred',
          remarks: `Shifted: ${originZone} (${originDivision}) ➔ ${destZone} (${destDivision}) with machine ${empMachine}`,
          createdAt: mov.createdAt || new Date().toISOString()
        });
      }

      // "dusre zone ya dusre divison ka data waha se new start kare"
      currentZone = destZone;
      currentDivision = destDivision;
      currentStartDate = shiftDate;
    }

    // Current active posting in the latest division
    result.push({
      id: `career_current_${empMachine}`,
      companyName: empCompany || 'General',
      machineName: empMachine,
      zone: currentZone,
      division: currentDivision,
      fromZone: currentZone,
      fromDivision: currentDivision,
      toZone: currentZone,
      toDivision: currentDivision,
      designation: empDesignation,
      fromDateTime: currentStartDate,
      toDateTime: 'Ongoing',
      status: 'active',
      remarks: 'Current continuous placement with assigned machine',
      createdAt: new Date().toISOString()
    });
  } else {
    // If no machine movements or no assigned machine, use employee baseline
    result.push({
      id: `career_base_${Date.now()}`,
      companyName: empCompany || 'General',
      machineName: empMachine || 'General',
      zone: employee.zone || 'West Central Railway',
      division: employee.division || 'Jabalpur',
      fromZone: employee.zone || 'West Central Railway',
      fromDivision: employee.division || 'Jabalpur',
      toZone: employee.zone || 'West Central Railway',
      toDivision: employee.division || 'Jabalpur',
      designation: empDesignation,
      fromDateTime: empDoj || new Date().toISOString().split('T')[0],
      toDateTime: 'Ongoing',
      status: 'active',
      remarks: 'Current placement since appointment',
      createdAt: new Date().toISOString()
    });
  }

  // Sort descending: Ongoing/active records first, followed by newest to oldest
  result.sort((a, b) => {
    const isAOngoing = a.toDateTime === 'Ongoing' || !a.toDateTime || a.status === 'active';
    const isBOngoing = b.toDateTime === 'Ongoing' || !b.toDateTime || b.status === 'active';
    if (isAOngoing && !isBOngoing) return -1;
    if (isBOngoing && !isAOngoing) return 1;
    return (b.fromDateTime || '').localeCompare(a.fromDateTime || '');
  });

  return result;
}



