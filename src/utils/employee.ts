import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '../firebase';

export interface EmployeeProfile {
  employeeId: string;
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
  accessType?: 'full' | 'limited' | 'admin-light';
  machineName?: string;
  pin?: string;
  isPinCreated?: boolean;
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
  }[];
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
            employeeSigUrl: empData.employeeSigUrl || ''
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
          employeeSigUrl: data.employeeSigUrl || ''
        };
      }
    });

    return foundEmp;
  } catch (error) {
    console.error('Error finding employee for user:', error);
    return null;
  }
}
