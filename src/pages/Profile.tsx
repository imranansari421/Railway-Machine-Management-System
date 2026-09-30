import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { 
  UserCircle, Save, Mail, Phone, MapPin, Briefcase, 
  User as UserIcon, Loader2, Calendar, Award, 
  ShieldAlert, Edit3, X, Send, Camera, Upload, CheckCircle,
  Lock, KeyRound, TrendingUp, History, Building2, Eye, EyeOff,
  ShieldCheck, RefreshCw, PartyPopper, Sparkles, AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { hashPin, isHashedPin } from '../utils/crypto';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser, EmployeeProfile, ProfileApprovalRequest, AwardRecord, PmeRecord, CareerRecord } from '../utils/employee';
import { archiveDeletedRecord } from '../utils/recycleBin';
import { sendProfileSubmittedEmail } from '../utils/emailNotifier';
import { sendOtp, verifyOtp } from '../utils/otp';
import { isBirthdayToday, getActivePmeDueStatus, checkAndTriggerPmeAndBirthdayForUser, sendEmployeeBirthdayCertificateNow } from '../utils/birthdayAndPmeService';
import { BirthdayCertificateModal } from '../components/BirthdayCertificateModal';
import { TrackMachineLoader } from '../components/TrackMachineLoader';
import { RMMSLogo } from '../components/RMMSLogo';
import { AppLogoManagerModal } from '../components/AppLogoManagerModal';
import { Image as ImageIcon } from 'lucide-react';
import { ProfileSectionTabs, ProfileSection, PROFILE_SECTIONS } from '../components/profile/ProfileSectionTabs';
import { PersonalDetailsSection } from '../components/profile/PersonalDetailsSection';
import { IdentityFinancialSection } from '../components/profile/IdentityFinancialSection';
import { ResidentialAddressSection } from '../components/profile/ResidentialAddressSection';
import { PhotoSignatureSection } from '../components/profile/PhotoSignatureSection';
import { ProfileOthersSection } from '../components/profile/ProfileOthersSection';
import { CareerSection } from '../components/profile/CareerSection';
import { SecuritySection } from '../components/profile/SecuritySection';
import { formatDateToDDMMYYYY } from '../utils/dateUtils';

export default function Profile() {
  const [profile, setProfile] = useState<EmployeeProfile>({
    employeeId: '',
    name: '',
    mobile: '',
    email: '',
    designation: '',
    gender: 'Male',
    address: '',
    doj: '',
    dob: '',
    photoUrl: '',
    employeeSigUrl: '',
    status: 'active',
    pfNo: '',
    esicNo: '',
    fatherName: '',
    age: '',
    sex: '',
    validityDate: '',
    department: '',
    idNo: '',
    aadharNo: '',
    panNo: '',
    accountNo: '',
    ifscCode: '',
    bankName: '',
    branch: '',
    zone: '',
    division: '',
    careerHistory: [],
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showIdentityDetails, setShowIdentityDetails] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSection>('personal');
  const [isEmployee, setIsEmployee] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<ProfileApprovalRequest | null>(null);
  const [authorities, setAuthorities] = useState<any[]>([]);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string>('');
  const [showLogoModal, setShowLogoModal] = useState(false);

  const accessType = auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  const isMainAdminOnly = (!isEmployee || auth.currentUser?.email === 'imranansari399605@gmail.com') && 
                          accessType !== 'admin-light' && 
                          accessType !== 'zonal-admin' && 
                          accessType !== 'divisional-admin';

  // Backup of the original profile to restore on Cancel
  const [originalProfile, setOriginalProfile] = useState<EmployeeProfile | null>(null);

  // Email OTP verification states for profile edit
  const [showEmailOtpModal, setShowEmailOtpModal] = useState(false);
  const [emailOtpInput, setEmailOtpInput] = useState('');
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailOtpSending, setEmailOtpSending] = useState(false);
  const [emailOtpCooldown, setEmailOtpCooldown] = useState(0);
  const [emailOtpError, setEmailOtpError] = useState('');
  const [isEmailVerifiedForSave, setIsEmailVerifiedForSave] = useState(false);
  const [verifiedEmailValue, setVerifiedEmailValue] = useState('');

  // States for PIN management
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [updatingPin, setUpdatingPin] = useState(false);

  // States for Password management (Company Admin / admin-light)
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // State to hold signature image dimensions
  const [sigDimensions, setSigDimensions] = useState<{ width: number; height: number } | null>(null);

  // Birthday Certificate Modal State
  const [showBirthdayModal, setShowBirthdayModal] = useState(false);

  // Determine user role and delete permissions
  const isEmpEmail = Boolean(auth.currentUser?.email?.endsWith('@employee.billedapp.com'));
  const loginPortal = auth.currentUser ? localStorage.getItem(`loginPortal_${auth.currentUser.uid}`) || '' : '';
  const storedAccessType = auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || '' : '';
  const currentViewerAccessType = storedAccessType || profile.accessType || 'limited';

  const isCompanyAdmin = currentViewerAccessType === 'admin-light';
  const isZonalAdmin = currentViewerAccessType === 'zonal-admin';
  const isDivisionalAdmin = currentViewerAccessType === 'divisional-admin';

  // Strictly Master Admin: Primary Master Admin (imranansari399605@gmail.com) OR root Master Admin session (non-employee, admin portal)
  const isMasterAdmin = Boolean(
    auth.currentUser?.email === 'imranansari399605@gmail.com' || (
      !isEmployee &&
      !isEmpEmail &&
      loginPortal === 'admin' &&
      !profile.employeeId &&
      currentViewerAccessType === 'full' &&
      !isCompanyAdmin &&
      !isZonalAdmin &&
      !isDivisionalAdmin
    )
  );
  const canDelete = isMasterAdmin; // restricted to Master Admin only

  // Birthday & PME Status
  const isBirthday = isBirthdayToday(profile.dob);
  const pmeStatus = getActivePmeDueStatus(profile.pmeRecords);
  const [sendingBirthdayEmail, setSendingBirthdayEmail] = useState(false);

  const handleSendBirthdayEmail = async () => {
    setSendingBirthdayEmail(true);
    try {
      const res = await sendEmployeeBirthdayCertificateNow(profile);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dispatch birthday certificate.');
    } finally {
      setSendingBirthdayEmail(false);
    }
  };

  // Auto-trigger PME and Birthday notifications/emails
  useEffect(() => {
    if (auth.currentUser && (profile.dob || (profile.pmeRecords && profile.pmeRecords.length > 0))) {
      checkAndTriggerPmeAndBirthdayForUser(auth.currentUser.uid, profile);
    }
  }, [profile.dob, profile.pmeRecords, auth.currentUser]);

  const handleUpdatePassword = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!auth.currentUser) {
      toast.error('You must be logged in to update your password.');
      return;
    }
    if (!oldPassword || !newPassword || !confirmNewPassword) {
      toast.error('Please fill in all password fields (Current Password, New Password, and Confirm Password).');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New password and Confirm password do not match.');
      return;
    }
    if (newPassword === oldPassword) {
      toast.error('New password cannot be the same as your old password.');
      return;
    }

    setUpdatingPassword(true);
    try {
      const { hashPassword, isHashedPassword } = await import('../utils/crypto');
      const isEmpSession = auth.currentUser.email?.endsWith('@employee.billedapp.com') || false;
      const isMasterAdmin = !isEmpSession && (!profile.employeeId || profile.accessType === 'full') && (profile.accessType !== 'admin-light' && profile.accessType !== 'divisional-admin' && profile.accessType !== 'zonal-admin');

      if (!isMasterAdmin && (profile.employeeId || isEmpSession || profile.accessType)) {
        // 1. Employee / Corporate Admin / Divisional / Zonal Account Password Change
        const empId = profile.employeeId || auth.currentUser.uid;
        const empRef = doc(db, 'employees', empId);
        const empSnap = await getDoc(empRef);

        let employeeData = empSnap.exists() ? empSnap.data() : null;
        if (!employeeData) {
          // Try query by pfNo or registeredEmail or loginId
          const employeesRef = collection(db, 'employees');
          const pfVal = profile.pfNo || '';
          if (pfVal) {
            const q = query(employeesRef, where('pfNo', '==', pfVal));
            const snap = await getDocs(q);
            if (!snap.empty) {
              employeeData = snap.docs[0].data();
            }
          }
        }

        const storedPassword = (employeeData?.password || (profile as any).password || '').trim();
        const storedRawTemp = (employeeData?.rawTempPassword || '').trim();

        // Candidates for salt: loginId, pfNo, employeeId, email
        const saltCandidates = [
          (employeeData?.loginId || (profile as any).loginId || '').trim().toLowerCase(),
          (employeeData?.pfNo || profile.pfNo || '').trim().toLowerCase(),
          (empId || '').trim().toLowerCase(),
          (employeeData?.email || profile.email || '').trim().toLowerCase(),
          (employeeData?.registeredEmail || profile.registeredEmail || '').trim().toLowerCase()
        ].filter(Boolean);

        let isOldPasswordCorrect = false;

        if (storedRawTemp && oldPassword === storedRawTemp) {
          isOldPasswordCorrect = true;
        } else if (storedPassword) {
          if (storedPassword === oldPassword) {
            isOldPasswordCorrect = true;
          } else if (isHashedPassword(storedPassword)) {
            for (const salt of saltCandidates) {
              const hashed = await hashPassword(oldPassword, salt);
              if (hashed === storedPassword) {
                isOldPasswordCorrect = true;
                break;
              }
            }
          }
        } else {
          // If no password was set yet, allow changing if old password matches default or empty
          isOldPasswordCorrect = true;
        }

        if (!isOldPasswordCorrect) {
          toast.error('Old password does not match. Please enter your correct current password.');
          setUpdatingPassword(false);
          return;
        }

        const primarySalt = saltCandidates[0] || (profile.pfNo || empId || 'employee').trim().toLowerCase();
        const hashedNew = await hashPassword(newPassword, primarySalt);

        const { updateDoc } = await import('firebase/firestore');
        if (empSnap.exists()) {
          await updateDoc(empRef, {
            password: hashedNew,
            firstTimeLogin: false,
            mustChangePassword: false,
            rawTempPassword: ''
          });
        }

        // If this employee is an admin (e.g. admin-light or full access), also update settings/admin_credentials
        const empAccessType = (profile as any)?.accessType;
        if (empAccessType === 'admin-light' || empAccessType === 'full' || (profile as any)?.role === 'admin' || (profile as any)?.loginId) {
          try {
            const adminEmailToSave = ((profile as any)?.registeredEmail || profile.email || auth.currentUser?.email || 'admin@billedapp.com').trim().toLowerCase();
            const masterHashedEmail = await hashPassword(newPassword, adminEmailToSave);
            const masterHashedAdmin = await hashPassword(newPassword, 'admin');
            const cleanEmpLoginId = ((profile as any)?.loginId || (profile as any)?.pfNo || empId || 'admin').trim().toLowerCase();
            const masterHashedLoginId = await hashPassword(newPassword, cleanEmpLoginId);

            await setDoc(doc(db, 'settings', 'admin_credentials'), {
              adminEmail: adminEmailToSave,
              adminLoginId: cleanEmpLoginId,
              password: masterHashedEmail,
              passwordAdminSalt: masterHashedAdmin,
              passwordInputSalt: masterHashedLoginId,
              rawPassword: newPassword,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (credErr) {
            console.warn("Could not save to settings/admin_credentials:", credErr);
          }
        }

        // Also update users collection document if exists
        try {
          await setDoc(doc(db, 'users', auth.currentUser.uid), {
            password: hashedNew
          }, { merge: true });
        } catch (uErr) {
          console.warn('Could not sync password to users collection:', uErr);
        }

        // Update local profile state
        setProfile(prev => ({ ...prev, password: hashedNew } as any));
        if (originalProfile) {
          setOriginalProfile(prev => prev ? ({ ...prev, password: hashedNew } as any) : null);
        }

        toast.success('Password changed successfully! Use your new password for all future logins.');
      } else {
        // 2. Master Admin Password Change
        let isOldPasswordCorrect = false;
        let adminCreds: any = null;

        try {
          const credDoc = await getDoc(doc(db, 'settings', 'admin_credentials'));
          if (credDoc.exists()) {
            adminCreds = credDoc.data();
            const storedAdminPass = adminCreds.password || '';
            const storedAdminSaltPass = adminCreds.passwordAdminSalt || '';
            const storedInputSaltPass = adminCreds.passwordInputSalt || '';
            const storedRawPass = adminCreds.rawPassword || '';

            if (storedRawPass && oldPassword === storedRawPass) {
              isOldPasswordCorrect = true;
            } else if (storedAdminPass) {
              const adminEmail = (adminCreds.adminEmail || auth.currentUser?.email || '').trim().toLowerCase();
              const hashWithEmail = adminEmail ? await hashPassword(oldPassword, adminEmail) : '';
              const hashWithAdmin = await hashPassword(oldPassword, 'admin');
              const hashWithLoginId = adminCreds.adminLoginId ? await hashPassword(oldPassword, adminCreds.adminLoginId.trim().toLowerCase()) : '';

              if (
                (hashWithEmail && hashWithEmail === storedAdminPass) || 
                hashWithAdmin === storedAdminSaltPass || 
                hashWithAdmin === storedAdminPass ||
                (hashWithLoginId && (hashWithLoginId === storedInputSaltPass || hashWithLoginId === storedAdminPass))
              ) {
                isOldPasswordCorrect = true;
              }
            }
          }
        } catch (cErr) {
          console.warn("Could not check settings/admin_credentials:", cErr);
        }

        // If credentials document didn't exist or didn't match, verify via Firebase Auth
        if (!isOldPasswordCorrect) {
          try {
            const { EmailAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
            const cred = EmailAuthProvider.credential(auth.currentUser.email || 'admin@billedapp.com', oldPassword);
            await reauthenticateWithCredential(auth.currentUser, cred);
            isOldPasswordCorrect = true;
          } catch (reauthErr) {
            console.warn("Re-authentication failed:", reauthErr);
          }
        }

        if (!isOldPasswordCorrect && adminCreds) {
          toast.error('Old password does not match. Please enter your correct current admin password.');
          setUpdatingPassword(false);
          return;
        }

        // Update Firebase Auth password if possible
        const { updatePassword } = await import('firebase/auth');
        try {
          await updatePassword(auth.currentUser, newPassword);
        } catch (authErr) {
          console.warn("Direct Firebase auth updatePassword skipped:", authErr);
        }

        try {
          const adminEmailToSave = (auth.currentUser?.email || profile.email || '').trim().toLowerCase();
          const cleanAdminId = ((profile as any)?.loginId || (profile as any)?.pfNo || 'admin').trim().toLowerCase();
          const masterHashedEmail = adminEmailToSave ? await hashPassword(newPassword, adminEmailToSave) : '';
          const masterHashedAdmin = await hashPassword(newPassword, 'admin');
          const masterHashedId = cleanAdminId ? await hashPassword(newPassword, cleanAdminId) : '';

          await setDoc(doc(db, 'settings', 'admin_credentials'), {
            adminEmail: adminEmailToSave,
            adminLoginId: cleanAdminId,
            password: masterHashedEmail,
            passwordAdminSalt: masterHashedAdmin,
            passwordInputSalt: masterHashedId,
            updatedAt: new Date().toISOString()
          }, { merge: true });

          // Also synchronize new password to any matching employee document in employees collection
          try {
            const { getDocs, query, where, updateDoc } = await import('firebase/firestore');
            if (cleanAdminId) {
              const q1 = await getDocs(query(collection(db, 'employees'), where('pfNo', '==', cleanAdminId)));
              q1.forEach(async (d) => {
                await updateDoc(doc(db, 'employees', d.id), {
                  password: masterHashedId,
                  rawTempPassword: '',
                  firstTimeLogin: false,
                  mustChangePassword: false
                });
              });
            }
            const q2 = await getDocs(query(collection(db, 'employees'), where('email', '==', adminEmailToSave)));
            q2.forEach(async (d) => {
              await updateDoc(doc(db, 'employees', d.id), {
                password: masterHashedEmail,
                rawTempPassword: '',
                firstTimeLogin: false,
                mustChangePassword: false
              });
            });
          } catch (empSyncErr) {
            console.warn("Could not sync admin password to employees collection:", empSyncErr);
          }

          // Sync to users collection
          if (auth.currentUser) {
            await setDoc(doc(db, 'users', auth.currentUser.uid), {
              password: masterHashedAdmin
            }, { merge: true });
          }
        } catch (credErr) {
          console.warn("Could not save to settings/admin_credentials:", credErr);
        }

        toast.success('Admin password changed successfully! Your old password has been invalidated.');
      }

      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (error.code === 'auth/requires-recent-login') {
        toast.error('For security reasons, this operation requires recent authentication. Please log out, log in again, and retry.');
      } else {
        toast.error('Failed to change password. Please try again.');
      }
    } finally {
      setUpdatingPassword(false);
    }
  };

  const fetchProfile = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      // Fetch the employee details using our robust helper
      const empProfile = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      const isEmpSession = 
        auth.currentUser.email?.endsWith('@employee.billedapp.com') || 
        empProfile?.accessType === 'limited' ||
        (!!empProfile && empProfile.accessType !== 'full' && auth.currentUser.email !== 'imranansari399605@gmail.com');
      setIsEmployee(Boolean(isEmpSession));
      
      if (empProfile) {
        setProfile(empProfile);
        setOriginalProfile(empProfile);
        
        // Fetch any pending request for this employee
        if (empProfile.employeeId) {
          await fetchPendingRequest(empProfile.employeeId);
        }

        // Fetch authorities (All same company employees, whether same designation or same access type)
        try {
          const snap = await getDocs(collection(db, 'employees'));
          const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

          const myCompany = (empProfile.companyName || '').trim().toLowerCase();

          // Filter list of employees: Include all employees of the same company (regardless of same designation or same access level), excluding only self
          const filtered = list.filter(emp => {
            const isNotMe = emp.id !== empProfile.employeeId && emp.id !== auth.currentUser?.uid && emp.id !== empProfile.id;
            if (!isNotMe) return false;

            // Remove pure master admin without company
            if (emp.isTopAdmin || emp.id === 'admin' || (emp.accessType === 'full' && !emp.companyName)) return false;

            // Strictly same company if user has a company assigned (case-insensitive)
            if (myCompany) {
              const empCo = (emp.companyName || '').trim().toLowerCase();
              return empCo === myCompany;
            }
            return true;
          });

          // Sort so colleagues on the same machine or admin-light are at top, then alphabetically
          filtered.sort((a: any, b: any) => {
            if (a.accessType === 'admin-light' && b.accessType !== 'admin-light') return -1;
            if (a.accessType !== 'admin-light' && b.accessType === 'admin-light') return 1;
            return (a.name || '').localeCompare(b.name || '');
          });

          setAuthorities(filtered);
          if (filtered.length > 0) {
            setSelectedAuthorityId(filtered[0].id);
          } else {
            setSelectedAuthorityId('');
          }
        } catch (err) {
          console.error('Error fetching section authorities:', err);
          setAuthorities([]);
          setSelectedAuthorityId('');
        }
      } else {
        // Fallback for Master Admin / regular users
        let activeAdminEmail = 'imranansari399605@gmail.com';
        let activeAdminName = 'Master Administrator';
        try {
          const credsSnap = await getDoc(doc(db, 'settings', 'admin_credentials'));
          if (credsSnap.exists()) {
            const credsData = credsSnap.data();
            if (credsData.adminEmail && !credsData.adminEmail.includes('billedapp.com')) {
              activeAdminEmail = credsData.adminEmail;
            }
            if (credsData.adminName) {
              activeAdminName = credsData.adminName;
            }
          }
        } catch (credErr) {
          console.warn("Could not read admin credentials for profile:", credErr);
        }

        const docRef = doc(db, 'users', auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        const basicProfile: EmployeeProfile = {
          employeeId: '',
          name: activeAdminName,
          email: activeAdminEmail,
          mobile: '',
          designation: 'Administrator',
          gender: 'Male',
          address: '',
          doj: '',
          dob: '',
          photoUrl: '',
          employeeSigUrl: '',
          status: 'active',
          pfNo: '',
          esicNo: '',
        };

        if (docSnap.exists()) {
          const data = docSnap.data();
          let effectiveEmail = (data.email || data.registeredEmail || activeAdminEmail).trim();
          if (effectiveEmail.includes('billedapp.com') || effectiveEmail.startsWith('master.')) {
            effectiveEmail = activeAdminEmail;
          }
          const merged = { ...basicProfile, ...data, email: effectiveEmail, name: data.name || activeAdminName } as EmployeeProfile;
          setProfile(merged);
          setOriginalProfile(merged);
        } else {
          setProfile(basicProfile);
          setOriginalProfile(basicProfile);
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast.error('Failed to load profile details.');
      handleFirestoreError(error, OperationType.GET, auth.currentUser ? `users/${auth.currentUser.uid}` : 'users');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequest = async (employeeId: string) => {
    try {
      if (!auth.currentUser) return;
      const q = query(
        collection(db, 'profile_requests'),
        where('uid', '==', auth.currentUser.uid)
      );
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const reqList = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ProfileApprovalRequest))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const latest = reqList[0];
        if (latest.status === 'pending' || latest.status === 'returned') {
          setPendingRequest(latest);
        } else {
          setPendingRequest(null);
        }
      } else {
        setPendingRequest(null);
      }
    } catch (error) {
      console.error('Error fetching pending profile requests:', error);
      handleFirestoreError(error, OperationType.LIST, 'profile_requests');
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const shouldShowField = (fieldName: string) => {
    if (isEditing) return true;
    if (!pendingRequest || (pendingRequest.status !== 'pending' && pendingRequest.status !== 'returned')) {
      return true;
    }
    if (!originalProfile) return true;
    
    const origVal = (originalProfile as any)[fieldName];
    const reqVal = (pendingRequest as any)[fieldName];
    
    if (fieldName === 'photoUrl') {
      return (originalProfile.photoUrl || '') !== (pendingRequest.photoUrl || '');
    }
    if (fieldName === 'employeeSigUrl') {
      return (originalProfile.employeeSigUrl || '') !== (pendingRequest.employeeSigUrl || '');
    }
    if (fieldName === 'gender') {
      return (originalProfile.gender || originalProfile.sex || '') !== (pendingRequest.gender || pendingRequest.sex || '');
    }
    
    return (origVal || '') !== (reqVal || '');
  };

  const shouldShowSection = (sectionFields: string[]) => {
    if (isEditing) return true;
    if (!pendingRequest || (pendingRequest.status !== 'pending' && pendingRequest.status !== 'returned')) {
      return true;
    }
    return sectionFields.some(field => shouldShowField(field));
  };

  const getChangeDiff = () => {
    if (!originalProfile || !pendingRequest) return [];
    
    const changes: any[] = [];
    if (originalProfile.name !== pendingRequest.name) {
      changes.push({ label: 'Name (नाम)', oldVal: originalProfile.name, newVal: pendingRequest.name });
    }
    if (originalProfile.mobile !== pendingRequest.mobile) {
      changes.push({ label: 'Mobile (मोबाइल)', oldVal: originalProfile.mobile, newVal: pendingRequest.mobile });
    }
    if (originalProfile.designation !== pendingRequest.designation) {
      changes.push({ label: 'Designation (पद)', oldVal: originalProfile.designation, newVal: pendingRequest.designation });
    }
    if ((originalProfile.address || '') !== (pendingRequest.address || '')) {
      changes.push({ label: 'Address (पता)', oldVal: originalProfile.address || 'None', newVal: pendingRequest.address || 'None' });
    }
    if ((originalProfile.dob || '') !== (pendingRequest.dob || '')) {
      changes.push({ 
        label: 'DOB (जन्म तिथि)', 
        oldVal: originalProfile.dob ? formatDateToDDMMYYYY(originalProfile.dob) : 'None', 
        newVal: pendingRequest.dob ? formatDateToDDMMYYYY(pendingRequest.dob) : 'None' 
      });
    }
    if ((originalProfile.pfNo || '') !== (pendingRequest.pfNo || '')) {
      changes.push({ label: 'PF Number (पीएफ संख्या)', oldVal: originalProfile.pfNo || 'None', newVal: pendingRequest.pfNo || 'None' });
    }
    if ((originalProfile.esicNo || '') !== (pendingRequest.esicNo || '')) {
      changes.push({ label: 'ESIC Number (ईएसआईसी संख्या)', oldVal: originalProfile.esicNo || 'None', newVal: pendingRequest.esicNo || 'None' });
    }
    if (originalProfile.doj !== pendingRequest.doj) {
      changes.push({ 
        label: 'Date of Joining (ज्वाइनिंग तिथि)', 
        oldVal: originalProfile.doj ? formatDateToDDMMYYYY(originalProfile.doj) : 'None', 
        newVal: pendingRequest.doj ? formatDateToDDMMYYYY(pendingRequest.doj) : 'None' 
      });
    }
    if ((originalProfile.fatherName || '') !== (pendingRequest.fatherName || '')) {
      changes.push({ label: "Father's Name (पिता का नाम)", oldVal: originalProfile.fatherName || 'None', newVal: pendingRequest.fatherName || 'None' });
    }
    if ((originalProfile.age || '') !== (pendingRequest.age || '')) {
      changes.push({ label: 'Age (उम्र)', oldVal: originalProfile.age || 'None', newVal: pendingRequest.age || 'None' });
    }
    if ((originalProfile.validityDate || '') !== (pendingRequest.validityDate || '')) {
      changes.push({ 
        label: 'Validity Date (वैधता तिथि)', 
        oldVal: originalProfile.validityDate ? formatDateToDDMMYYYY(originalProfile.validityDate) : 'None', 
        newVal: pendingRequest.validityDate ? formatDateToDDMMYYYY(pendingRequest.validityDate) : 'None' 
      });
    }
    if ((originalProfile.department || '') !== (pendingRequest.department || '')) {
      changes.push({ label: 'Department (विभाग)', oldVal: originalProfile.department || 'None', newVal: pendingRequest.department || 'None' });
    }
    if ((originalProfile.idNo || '') !== (pendingRequest.idNo || '')) {
      changes.push({ label: 'ID No (आईडी संख्या)', oldVal: originalProfile.idNo || 'None', newVal: pendingRequest.idNo || 'None' });
    }
    if ((originalProfile.aadharNo || '') !== (pendingRequest.aadharNo || '')) {
      changes.push({ label: 'Aadhar No (आधार)', oldVal: originalProfile.aadharNo || 'None', newVal: pendingRequest.aadharNo || 'None' });
    }
    if ((originalProfile.panNo || '') !== (pendingRequest.panNo || '')) {
      changes.push({ label: 'PAN No (पैन संख्या)', oldVal: originalProfile.panNo || 'None', newVal: pendingRequest.panNo || 'None' });
    }
    if ((originalProfile.accountNo || '') !== (pendingRequest.accountNo || '')) {
      changes.push({ label: 'Account No (खाता संख्या)', oldVal: originalProfile.accountNo || 'None', newVal: pendingRequest.accountNo || 'None' });
    }
    if ((originalProfile.ifscCode || '') !== (pendingRequest.ifscCode || '')) {
      changes.push({ label: 'IFSC Code (आईएफएससी)', oldVal: originalProfile.ifscCode || 'None', newVal: pendingRequest.ifscCode || 'None' });
    }
    if ((originalProfile.bankName || '') !== (pendingRequest.bankName || '')) {
      changes.push({ label: 'Bank Name (बैंक का नाम)', oldVal: originalProfile.bankName || 'None', newVal: pendingRequest.bankName || 'None' });
    }
    if ((originalProfile.branch || '') !== (pendingRequest.branch || '')) {
      changes.push({ label: 'Branch (शाखा)', oldVal: originalProfile.branch || 'None', newVal: pendingRequest.branch || 'None' });
    }
    if ((originalProfile.zone || '') !== (pendingRequest.zone || '')) {
      changes.push({ label: 'Railway Zone (रेलवे जोन)', oldVal: originalProfile.zone || 'None', newVal: pendingRequest.zone || 'None' });
    }
    if ((originalProfile.division || '') !== (pendingRequest.division || '')) {
      changes.push({ label: 'Railway Division (रेलवे मंडल)', oldVal: originalProfile.division || 'None', newVal: pendingRequest.division || 'None' });
    }
    if ((originalProfile.photoUrl || '') !== (pendingRequest.photoUrl || '')) {
      changes.push({ 
        label: 'Photo (फोटो)', 
        isPhoto: true, 
        oldPhoto: originalProfile.photoUrl, 
        newPhoto: pendingRequest.photoUrl 
      });
    }
    if ((originalProfile.employeeSigUrl || '') !== (pendingRequest.employeeSigUrl || '')) {
      changes.push({ 
        label: 'Signature (हस्ताक्षर)', 
        isPhoto: true, 
        isSignature: true, 
        oldPhoto: originalProfile.employeeSigUrl, 
        newPhoto: pendingRequest.employeeSigUrl 
      });
    }
    
    return changes;
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
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
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          setProfile(prev => ({ ...prev, photoUrl: compressedBase64 }));
          toast.success('Photo updated in form. Remember to submit for approval/save changes.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          const compressedBase64 = canvas.toDataURL('image/png');
          setProfile(prev => ({ ...prev, employeeSigUrl: compressedBase64 }));
          toast.success('Signature updated in form. Remember to submit for approval/save changes.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    if (originalProfile) {
      setProfile(originalProfile);
    }
    setIsEditing(false);
    setShowEmailOtpModal(false);
    setIsEmailVerifiedForSave(false);
    setVerifiedEmailValue('');
    setEmailOtpInput('');
    setEmailOtpError('');
  };

  const getRequestedFieldsDescription = (orig: any, current: any) => {
    const changes: string[] = [];
    if (!orig) return "Full Profile Creation";
    if (orig.name !== current.name) changes.push("Name");
    if (orig.email !== current.email) changes.push("Email");
    if (orig.mobile !== current.mobile) changes.push("Mobile");
    if (orig.gender !== current.gender) changes.push("Gender");
    if (orig.address !== current.address) changes.push("Address");
    if (orig.fatherName !== current.fatherName) changes.push("Father's Name");
    if (orig.aadharNo !== current.aadharNo) changes.push("Aadhar No");
    if (orig.panNo !== current.panNo) changes.push("PAN No");
    if (orig.accountNo !== current.accountNo) changes.push("Bank Account No");
    if (orig.ifscCode !== current.ifscCode) changes.push("IFSC Code");
    if (orig.bankName !== current.bankName) changes.push("Bank Name");
    if (orig.branch !== current.branch) changes.push("Branch");
    if (orig.department !== current.department) changes.push("Department");
    if (orig.validityDate !== current.validityDate) changes.push("I-Card Validity Date");
    if (orig.photoUrl !== current.photoUrl) changes.push("Photo");
    if (orig.employeeSigUrl !== current.employeeSigUrl) changes.push("Signature");
    return changes.length > 0 ? changes.join(", ") : "Profile Information Review";
  };

  useEffect(() => {
    if (emailOtpCooldown <= 0) return;
    const timer = setInterval(() => {
      setEmailOtpCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [emailOtpCooldown]);

  const handleSendNewEmailOtp = async (targetEmail: string) => {
    if (!targetEmail || !targetEmail.includes('@')) {
      setEmailOtpError('Please enter a valid email address.');
      toast.error('Invalid email address');
      return;
    }
    setEmailOtpSending(true);
    setEmailOtpError('');
    try {
      const res = await sendOtp(targetEmail, 'email_verification', {
        name: profile.name,
        pfNo: profile.pfNo
      });
      if (res.success) {
        setEmailOtpCooldown(60);
        toast.success("Verification OTP sent to your email!");
      } else {
        setEmailOtpError(res.message);
        toast.error(res.message);
      }
    } catch (err) {
      console.error('Error sending email OTP:', err);
      setEmailOtpError('Failed to send verification code. Please check email and retry.');
    } finally {
      setEmailOtpSending(false);
    }
  };

  const handleVerifyEmailOtpAndProceed = async () => {
    const cleanNewEmail = (profile.email || '').trim().toLowerCase();
    if (!emailOtpInput || emailOtpInput.trim().length !== 6) {
      setEmailOtpError('Please enter a valid 6-digit OTP code.');
      return;
    }

    setEmailOtpLoading(true);
    setEmailOtpError('');
    try {
      const verifyRes = await verifyOtp(cleanNewEmail, emailOtpInput.trim(), 'email_verification');
      if (verifyRes.success) {
        setIsEmailVerifiedForSave(true);
        setVerifiedEmailValue(cleanNewEmail);
        setShowEmailOtpModal(false);
        toast.success('New email verified successfully!');
        // Proceed with actual profile save/forward
        await executeProfileSave(cleanNewEmail);
      } else {
        setEmailOtpError(verifyRes.message || 'Invalid or expired OTP code.');
        toast.error(verifyRes.message || 'Verification failed.');
      }
    } catch (err: any) {
      console.error('Error verifying email OTP:', err);
      setEmailOtpError('Failed to verify OTP code.');
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const handleSaveSubRecord = async (type: 'pme' | 'award' | 'promotion' | 'demotion', data: any) => {
    if (!auth.currentUser) {
      toast.error('Authentication required');
      return;
    }
    if ((type === 'award' || type === 'promotion' || type === 'demotion') && !isMasterAdmin) {
      toast.error('Only Full Admin and Master Admin can record awards, promotions, or demotions.');
      return;
    }
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);

      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
            targetDocSnap = qSnap.docs[0];
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      if (type === 'pme') {
        const recordWithMeta: PmeRecord = {
          ...data,
          id: 'pme_' + Date.now(),
          addedBy: profile.name || auth.currentUser.email || 'Employee',
          createdAt: new Date().toISOString()
        };
        const updatedList = [recordWithMeta, ...(profile.pmeRecords || [])];
        await setDoc(targetDocRef, { pmeRecords: updatedList }, { merge: true });
        setProfile(prev => ({ ...prev, pmeRecords: updatedList }));
        setOriginalProfile(prev => prev ? { ...prev, pmeRecords: updatedList } : null);
        toast.success('PME record saved successfully!');
      } else if (type === 'award') {
        const recordWithMeta: AwardRecord = {
          ...data,
          id: 'award_' + Date.now(),
          createdAt: new Date().toISOString()
        };
        const updatedList = [recordWithMeta, ...(profile.awards || [])];
        await setDoc(targetDocRef, { awards: updatedList }, { merge: true });
        setProfile(prev => ({ ...prev, awards: updatedList }));
        setOriginalProfile(prev => prev ? { ...prev, awards: updatedList } : null);
        toast.success('Award recorded successfully!');
      } else if (type === 'promotion' || type === 'demotion') {
        const historyEntry = {
          oldDesignation: data.oldDesignation || profile.designation,
          newDesignation: data.newDesignation,
          updatedAt: data.updatedAt || new Date().toISOString(),
          type: type,
          orderNo: data.orderNo || '',
          reason: data.reason || '',
          remarks: data.remarks || ''
        };
        const updatedList = [historyEntry, ...(profile.designationHistory || [])];
        await setDoc(targetDocRef, { designationHistory: updatedList }, { merge: true });
        setProfile(prev => ({ ...prev, designationHistory: updatedList }));
        setOriginalProfile(prev => prev ? { ...prev, designationHistory: updatedList } : null);
        toast.success(`${type === 'promotion' ? 'Promotion' : 'Demotion'} record saved successfully!`);
      }
    } catch (err) {
      console.error('Error saving sub-record:', err);
      toast.error('Failed to save record.');
    }
  };

  const handleUpdateSubRecord = async (type: 'pme' | 'award', index: number, updatedData: any) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can edit saved entries.');
      return;
    }
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      if (type === 'pme') {
        const currentList = [...(profile.pmeRecords || [])];
        if (index >= 0 && index < currentList.length) {
          currentList[index] = {
            ...currentList[index],
            ...updatedData,
            updatedAt: new Date().toISOString(),
            updatedBy: auth.currentUser.email || 'Master Admin'
          };
          await setDoc(targetDocRef, { pmeRecords: currentList }, { merge: true });
          setProfile(prev => ({ ...prev, pmeRecords: currentList }));
          setOriginalProfile(prev => prev ? { ...prev, pmeRecords: currentList } : null);
          toast.success('PME record updated successfully!');
        }
      } else if (type === 'award') {
        const currentList = [...(profile.awards || [])];
        if (index >= 0 && index < currentList.length) {
          currentList[index] = {
            ...currentList[index],
            ...updatedData,
            updatedAt: new Date().toISOString(),
            updatedBy: auth.currentUser.email || 'Master Admin'
          };
          await setDoc(targetDocRef, { awards: currentList }, { merge: true });
          setProfile(prev => ({ ...prev, awards: currentList }));
          setOriginalProfile(prev => prev ? { ...prev, awards: currentList } : null);
          toast.success('Award record updated successfully!');
        }
      }
    } catch (err) {
      console.error('Error updating record:', err);
      toast.error('Failed to update record.');
    }
  };

  const handleDeleteSubRecord = async (type: 'pme' | 'award' | 'history', index: number) => {
    if (!isMasterAdmin) {
      toast.error('Deletion of records in the Others section is restricted strictly to Master Admin only.');
      return;
    }
    if (!confirm('Are you sure you want to remove this record? Master Admin can recover it if needed.')) return;
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      const roleName = isMasterAdmin ? 'Master Admin' : isCompanyAdmin ? 'Company Admin' : isZonalAdmin ? 'Zonal Admin' : 'Divisional Admin';

      if (type === 'pme') {
        const currentList = profile.pmeRecords || [];
        const deletedItem = currentList[index];
        const updated = currentList.filter((_, i) => i !== index);

        // Archive for Master Admin recovery
        const archivedRecord = {
          ...deletedItem,
          id: deletedItem?.id || 'pme_del_' + Date.now(),
          subRecordType: 'pme',
          deletedAt: new Date().toISOString(),
          deletedBy: auth.currentUser.email || 'Admin',
          deletedByRole: roleName
        };
        const updatedDeleted = [archivedRecord, ...(profile.deletedSubRecords || [])];

        await setDoc(targetDocRef, { pmeRecords: updated, deletedSubRecords: updatedDeleted }, { merge: true });
        setProfile(prev => ({ ...prev, pmeRecords: updated, deletedSubRecords: updatedDeleted }));
        setOriginalProfile(prev => prev ? { ...prev, pmeRecords: updated, deletedSubRecords: updatedDeleted } : null);

        // Also save to centralized recycle bin
        try {
          await archiveDeletedRecord({
            originalCollection: 'employees',
            originalId: targetDocRef.id,
            moduleName: 'PME Records',
            itemSummary: `PME Record: ${deletedItem.medicalCategory || ''} (${deletedItem.examDate || ''}) - ${profile.name || profile.pfNo}`,
            data: {
              isSubRecord: true,
              subRecordType: 'pme',
              subRecord: deletedItem,
              employeeName: profile.name,
              pfNo: profile.pfNo,
            }
          });
        } catch (archErr) {
          console.warn('Central archive note:', archErr);
        }

        toast.success('PME record removed. (Master Admin can recover this record if needed)');
      } else if (type === 'award') {
        const currentList = profile.awards || [];
        const deletedItem = currentList[index];
        const updated = currentList.filter((_, i) => i !== index);

        const archivedRecord = {
          ...deletedItem,
          id: deletedItem?.id || 'award_del_' + Date.now(),
          subRecordType: 'award',
          deletedAt: new Date().toISOString(),
          deletedBy: auth.currentUser.email || 'Admin',
          deletedByRole: roleName
        };
        const updatedDeleted = [archivedRecord, ...(profile.deletedSubRecords || [])];

        await setDoc(targetDocRef, { awards: updated, deletedSubRecords: updatedDeleted }, { merge: true });
        setProfile(prev => ({ ...prev, awards: updated, deletedSubRecords: updatedDeleted }));
        setOriginalProfile(prev => prev ? { ...prev, awards: updated, deletedSubRecords: updatedDeleted } : null);

        try {
          await archiveDeletedRecord({
            originalCollection: 'employees',
            originalId: targetDocRef.id,
            moduleName: 'Award Records',
            itemSummary: `Award: ${deletedItem.title || ''} (${deletedItem.date || ''}) - ${profile.name || profile.pfNo}`,
            data: {
              isSubRecord: true,
              subRecordType: 'award',
              subRecord: deletedItem,
              employeeName: profile.name,
              pfNo: profile.pfNo,
            }
          });
        } catch (archErr) {
          console.warn('Central archive note:', archErr);
        }

        toast.success('Award removed. (Master Admin can recover this record if needed)');
      } else if (type === 'history') {
        const updated = (profile.designationHistory || []).filter((_, i) => i !== index);
        await setDoc(targetDocRef, { designationHistory: updated }, { merge: true });
        setProfile(prev => ({ ...prev, designationHistory: updated }));
        setOriginalProfile(prev => prev ? { ...prev, designationHistory: updated } : null);
        toast.success('Record removed.');
      }
    } catch (err) {
      console.error('Error removing record:', err);
      toast.error('Failed to remove record.');
    }
  };

  const handleSaveCareerRecord = async (record: CareerRecord) => {
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      const recordWithId: CareerRecord = {
        ...record,
        id: 'career_' + Date.now(),
        addedBy: profile.name || auth.currentUser.email || 'Admin',
        createdAt: new Date().toISOString()
      };

      const updatedList = [recordWithId, ...(profile.careerHistory || [])];
      await setDoc(targetDocRef, { careerHistory: updatedList }, { merge: true });
      setProfile(prev => ({ ...prev, careerHistory: updatedList }));
      setOriginalProfile(prev => prev ? { ...prev, careerHistory: updatedList } : null);
    } catch (err) {
      console.error('Error saving career record:', err);
      throw err;
    }
  };

  const handleUpdateCareerRecord = async (index: number, updatedRecord: CareerRecord) => {
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      const currentList = [...(profile.careerHistory || [])];
      if (index >= 0 && index < currentList.length) {
        currentList[index] = {
          ...currentList[index],
          ...updatedRecord,
          updatedAt: new Date().toISOString(),
          updatedBy: auth.currentUser.email || 'Admin'
        };
        await setDoc(targetDocRef, { careerHistory: currentList }, { merge: true });
        setProfile(prev => ({ ...prev, careerHistory: currentList }));
        setOriginalProfile(prev => prev ? { ...prev, careerHistory: currentList } : null);
      }
    } catch (err) {
      console.error('Error updating career record:', err);
      throw err;
    }
  };

  const handleDeleteCareerRecord = async (index: number) => {
    if (!canDelete) {
      toast.error('Deletion is restricted to Company Admin, Zonal Admin, Divisional Admin, and Master Admin only.');
      return;
    }
    if (!confirm('Are you sure you want to remove this career record?')) return;
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      const currentList = profile.careerHistory || [];
      const deletedItem = currentList[index];
      const updated = currentList.filter((_, i) => i !== index);

      if (deletedItem) {
        try {
          await archiveDeletedRecord({
            originalCollection: 'employees',
            originalId: targetDocRef.id,
            moduleName: 'Career Records',
            itemSummary: `Career Record: ${deletedItem.companyName || ''} - ${deletedItem.machineName || ''} (${deletedItem.fromDateTime || ''}) - ${profile.name || profile.pfNo}`,
            data: {
              isSubRecord: true,
              subRecordType: 'career',
              subRecord: deletedItem,
              employeeName: profile.name,
              pfNo: profile.pfNo,
            }
          });
        } catch (archErr) {
          console.warn("Could not archive deleted career record:", archErr);
        }
      }

      await setDoc(targetDocRef, { careerHistory: updated }, { merge: true });
      setProfile(prev => ({ ...prev, careerHistory: updated }));
      setOriginalProfile(prev => prev ? { ...prev, careerHistory: updated } : null);
      toast.success('Career record deleted successfully!');
    } catch (err) {
      console.error('Error deleting career record:', err);
      toast.error('Failed to delete career record.');
    }
  };

  const handleRecoverSubRecord = async (recordToRecover: any) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can recover deleted records.');
      return;
    }
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }

      const { subRecordType, deletedAt, deletedBy, deletedByRole, ...cleanRecord } = recordToRecover;
      const remainingDeleted = (profile.deletedSubRecords || []).filter((r: any) => r.id !== recordToRecover.id);

      if (subRecordType === 'pme') {
        const updatedPme = [cleanRecord, ...(profile.pmeRecords || [])];
        await setDoc(targetDocRef, { pmeRecords: updatedPme, deletedSubRecords: remainingDeleted }, { merge: true });
        setProfile(prev => ({ ...prev, pmeRecords: updatedPme, deletedSubRecords: remainingDeleted }));
        setOriginalProfile(prev => prev ? { ...prev, pmeRecords: updatedPme, deletedSubRecords: remainingDeleted } : null);
        toast.success('PME record recovered successfully!');
      } else if (subRecordType === 'award') {
        const updatedAwards = [cleanRecord, ...(profile.awards || [])];
        await setDoc(targetDocRef, { awards: updatedAwards, deletedSubRecords: remainingDeleted }, { merge: true });
        setProfile(prev => ({ ...prev, awards: updatedAwards, deletedSubRecords: remainingDeleted }));
        setOriginalProfile(prev => prev ? { ...prev, awards: updatedAwards, deletedSubRecords: remainingDeleted } : null);
        toast.success('Award record recovered successfully!');
      }
    } catch (err) {
      console.error('Error recovering record:', err);
      toast.error('Failed to recover record.');
    }
  };

  const handlePermanentDeleteSubRecord = async (recordId: string) => {
    if (!isMasterAdmin) {
      toast.error('Only Master Admin can permanently delete records.');
      return;
    }
    if (!confirm('Are you sure you want to permanently delete this record from archive? This cannot be undone.')) return;
    if (!auth.currentUser) return;
    try {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      let targetDocRef = doc(db, 'employees', currentEmpId);
      let targetDocSnap = await getDoc(targetDocRef);
      if (!targetDocSnap.exists()) {
        if (profile.pfNo) {
          const empQuery = query(collection(db, 'employees'), where('pfNo', '==', profile.pfNo));
          const qSnap = await getDocs(empQuery);
          if (!qSnap.empty) {
            targetDocRef = doc(db, 'employees', qSnap.docs[0].id);
          } else {
            targetDocRef = doc(db, 'users', auth.currentUser.uid);
          }
        } else {
          targetDocRef = doc(db, 'users', auth.currentUser.uid);
        }
      }
      const remainingDeleted = (profile.deletedSubRecords || []).filter((r: any) => r.id !== recordId);
      await setDoc(targetDocRef, { deletedSubRecords: remainingDeleted }, { merge: true });
      setProfile(prev => ({ ...prev, deletedSubRecords: remainingDeleted }));
      setOriginalProfile(prev => prev ? { ...prev, deletedSubRecords: remainingDeleted } : null);
      toast.success('Record permanently removed from archive.');
    } catch (err) {
      console.error('Error deleting record:', err);
      toast.error('Failed to delete record.');
    }
  };

  const executeProfileSave = async (cleanNewEmail: string) => {
    if (!auth.currentUser) return;
    setSaving(true);

    try {
      if (isEmployee) {
        // Forwarding to Admin for Approval
        if (!profile.employeeId) {
          toast.error('Unable to find associated employee record to request changes.');
          setSaving(false);
          return;
        }

        if (pendingRequest && pendingRequest.status === 'pending') {
          toast.error('You already have a pending profile update request waiting for Admin approval.');
          setSaving(false);
          return;
        }

        const isFullAccessAdmin = profile.accessType === 'full';

        if (authorities.length > 0 && !selectedAuthorityId) {
          toast.error('Please select a Recipient / Authority to forward your request to.');
          setSaving(false);
          return;
        }

        const selectedAuthority = authorities.find(a => a.id === selectedAuthorityId);
        const requestedFieldsDescription = getRequestedFieldsDescription(originalProfile, {
          ...profile,
          email: cleanNewEmail
        });

        const targetLoginId = selectedAuthority?.pfNo || selectedAuthority?.loginId || selectedAuthority?.id || '';
        const targetEmail = selectedAuthority?.email || '';
        const isTargetTopAdmin = selectedAuthorityId === 'admin' || (selectedAuthority as any)?.isTopAdmin;

        const rawPayload: Record<string, any> = {
          employeeId: profile.employeeId || '',
          uid: auth.currentUser.uid || '',
          name: profile.name || '',
          email: cleanNewEmail,
          mobile: profile.mobile || '',
          designation: profile.designation || '',
          gender: profile.gender || profile.sex || 'Male',
          address: profile.address || '',
          dob: profile.dob || '',
          pfNo: profile.pfNo || '',
          esicNo: profile.esicNo || '',
          doj: profile.doj || '',
          photoUrl: profile.photoUrl || '',
          employeeSigUrl: profile.employeeSigUrl || '',
          status: 'pending',
          authorityId: selectedAuthorityId || '',
          authorityName: selectedAuthority ? (selectedAuthority.name || '') : '',
          machineName: profile.machineName || '',
          forwardedToAdmin: Boolean(isTargetTopAdmin),
          isTopAdminRequest: Boolean(isTargetTopAdmin),
          forwardedToLoginId: targetLoginId,
          forwardedToPfNo: selectedAuthority?.pfNo || '',
          forwardedToEmployeeId: selectedAuthority?.employeeId || selectedAuthority?.id || '',
          forwardedToUid: selectedAuthority?.uid || (selectedAuthority as any)?.authUid || '',
          isFullAccessAdmin: isFullAccessAdmin || false,
          companyName: profile.companyName || '',
          forwardedToCompanyAdmin: selectedAuthority ? (selectedAuthority.accessType === 'admin-light') : false,
          forwardedTo: selectedAuthorityId || '',
          forwardedToName: selectedAuthority ? (selectedAuthority.name || '') : '',
          forwardedToEmail: targetEmail,
          requestedFieldsDescription: requestedFieldsDescription || '',
          
          // Full form fields (retain locked zone & division)
          fatherName: profile.fatherName || '',
          age: profile.age || '',
          sex: profile.gender || profile.sex || '',
          validityDate: profile.validityDate || '',
          department: profile.department || '',
          idNo: profile.idNo || '',
          aadharNo: profile.aadharNo || '',
          panNo: profile.panNo || '',
          accountNo: profile.accountNo || '',
          ifscCode: profile.ifscCode || '',
          bankName: profile.bankName || '',
          branch: profile.branch || '',
          zone: profile.zone || originalProfile?.zone || '',
          division: profile.division || originalProfile?.division || '',
          
          createdAt: new Date().toISOString()
        };

        // Remove any undefined keys to strictly satisfy Firestore requirements
        const requestPayload = Object.fromEntries(
          Object.entries(rawPayload).filter(([_, v]) => v !== undefined)
        );

        if (pendingRequest && pendingRequest.status === 'returned') {
          // UPDATE the returned request to set its status back to 'pending'
          await setDoc(doc(db, 'profile_requests', pendingRequest.id), {
            ...requestPayload,
            resubmittedAt: new Date().toISOString(),
            previousRemarks: pendingRequest.remarks || '',
            remarks: null // Clear remarks as it is resubmitted
          }, { merge: true });
          
          toast.success('Your returned profile request has been updated and resubmitted successfully!');
        } else {
          // Create a new request
          await addDoc(collection(db, 'profile_requests'), requestPayload);
          
          if (selectedAuthority && selectedAuthority.accessType === 'admin-light') {
            toast.success('Your profile changes have been forwarded directly to your Company Admin!');
          } else if (selectedAuthority) {
            toast.success(`Your profile changes have been forwarded to ${selectedAuthority.name}!`);
          } else {
            toast.success('Your profile changes have been forwarded!');
          }
        }

        // Asynchronously dispatch confirmation & reviewer notification emails
        sendProfileSubmittedEmail({
          request: requestPayload,
          reviewerName: selectedAuthority?.name,
          reviewerEmail: selectedAuthority?.email
        }).catch(err => console.warn('Profile submission email warning:', err));

        setIsEditing(false);
        setIsEmailVerifiedForSave(false);
        setVerifiedEmailValue('');
        await fetchPendingRequest(profile.employeeId);
      } else {
        // Direct save for Administrator
        const cleanAdminEmail = cleanNewEmail || 'imranansari399605@gmail.com';
        const cleanAdminName = profile.name || 'Master Administrator';

        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          uid: auth.currentUser.uid,
          name: cleanAdminName,
          email: cleanAdminEmail,
          registeredEmail: cleanAdminEmail,
          mobile: profile.mobile || '',
          designation: profile.designation || 'Administrator',
          gender: profile.gender || 'Male',
          address: profile.address || '',
          photoUrl: profile.photoUrl || '',
          role: 'admin',
        }, { merge: true });

        try {
          await setDoc(doc(db, 'settings', 'admin_credentials'), {
            adminEmail: cleanAdminEmail,
            adminName: cleanAdminName
          }, { merge: true });

          await setDoc(doc(db, 'settings', 'general'), {
            adminEmail: cleanAdminEmail
          }, { merge: true });
        } catch (settingsSyncErr) {
          console.warn("Could not sync admin email to settings:", settingsSyncErr);
        }

        // Dispatch updated event for Layout header
        window.dispatchEvent(new Event('profile-updated'));

        toast.success('Administrator profile updated successfully!');
        setIsEditing(false);
        setIsEmailVerifiedForSave(false);
        setVerifiedEmailValue('');
        if (originalProfile) {
          setOriginalProfile({ ...profile, email: cleanAdminEmail, name: cleanAdminName });
        }
      }
    } catch (error) {
      console.error('Error submitting profile:', error);
      toast.error('Failed to update profile. Please check your credentials.');
      handleFirestoreError(error, OperationType.WRITE, isEmployee ? 'profile_requests' : `users/${auth.currentUser?.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const cleanNewEmail = (profile.email || '').trim().toLowerCase();
    const cleanOldEmail = (originalProfile?.email || '').trim().toLowerCase();
    const isOldPlaceholder = !cleanOldEmail || cleanOldEmail.endsWith('@employee.billedapp.com');
    const isEmailChanged = Boolean(cleanNewEmail && (isOldPlaceholder || cleanNewEmail !== cleanOldEmail));

    // Check if email already belongs to another registered employee
    if (cleanNewEmail && !cleanNewEmail.endsWith('@employee.billedapp.com') && !cleanNewEmail.endsWith('@billedapp.com')) {
      const currentEmpId = profile.employeeId || auth.currentUser.uid;
      try {
        const qEmail = query(collection(db, 'employees'), where('email', '==', cleanNewEmail));
        const snapEmail = await getDocs(qEmail);
        const dupEmail = snapEmail.docs.find(d => d.id !== currentEmpId && d.data().status !== 'deleted');
        if (dupEmail) {
          const d = dupEmail.data();
          toast.error(`Email address "${cleanNewEmail}" is already registered to ${d.name || 'another employee'} (PF: ${d.pfNo || 'N/A'}). Ek email sirf ek employee ke liye allowed hai.`);
          return;
        }

        const qReg = query(collection(db, 'employees'), where('registeredEmail', '==', cleanNewEmail));
        const snapReg = await getDocs(qReg);
        const dupReg = snapReg.docs.find(d => d.id !== currentEmpId && d.data().status !== 'deleted');
        if (dupReg) {
          const d = dupReg.data();
          toast.error(`Email address "${cleanNewEmail}" is already registered to ${d.name || 'another employee'} (PF: ${d.pfNo || 'N/A'}). Ek email sirf ek employee ke liye allowed hai.`);
          return;
        }
      } catch (checkErr) {
        console.warn("Could not verify email uniqueness in Firestore:", checkErr);
      }
    }

    // If email is changed/added and not yet verified for this new email, trigger OTP verification
    if (isEmailChanged && (verifiedEmailValue !== cleanNewEmail || !isEmailVerifiedForSave)) {
      setShowEmailOtpModal(true);
      setEmailOtpInput('');
      setEmailOtpError('');
      await handleSendNewEmailOtp(cleanNewEmail);
      return;
    }

    await executeProfileSave(cleanNewEmail);
  };

  const handleUpdatePin = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!profile.employeeId) {
      toast.error('No employee profile associated with this account.');
      return;
    }
    if (!oldPin || !newPin || !confirmNewPin) {
      toast.error('Please fill in all security PIN fields.');
      return;
    }

    // Verify old PIN (support both legacy plain text and secure salted hash)
    const isStoredHashed = isHashedPin(profile.pin);
    let isCurrentPinValid = false;

    if (isStoredHashed) {
      const hashedOldPin = await hashPin(oldPin, profile.employeeId);
      isCurrentPinValid = (hashedOldPin === profile.pin);
    } else {
      isCurrentPinValid = (oldPin === profile.pin);
    }

    if (!isCurrentPinValid) {
      toast.error('Incorrect current PIN code.');
      return;
    }
    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      toast.error('New PIN must be exactly 6 digits.');
      return;
    }
    if (newPin !== confirmNewPin) {
      toast.error('New PIN and Confirm PIN do not match.');
      return;
    }
    if (newPin === oldPin) {
      toast.error('New PIN cannot be the same as your old PIN.');
      return;
    }

    setUpdatingPin(true);
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const empRef = doc(db, 'employees', profile.employeeId);
      
      const hashedNewPin = await hashPin(newPin, profile.employeeId);

      await updateDoc(empRef, {
        pin: hashedNewPin,
        isPinCreated: true
      });

      // Update local profile state
      setProfile(prev => ({ ...prev, pin: hashedNewPin }));
      if (originalProfile) {
        setOriginalProfile(prev => prev ? { ...prev, pin: hashedNewPin } : null);
      }

      toast.success('Security PIN changed successfully! Use your new PIN for future logins.');
      setOldPin('');
      setNewPin('');
      setConfirmNewPin('');
    } catch (error) {
      console.error('Error updating PIN:', error);
      toast.error('Failed to change PIN. Please try again.');
    } finally {
      setUpdatingPin(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] py-12">
        <TrackMachineLoader 
          message="Loading Railway Employee Profile..." 
          subMessage="Fetching designations, credentials & division records"
          size="md" 
        />
      </div>
    );
  }

  const currentSectionIndex = PROFILE_SECTIONS.findIndex(s => s.id === activeSection);
  const goToPrevSection = () => {
    if (currentSectionIndex > 0) {
      setActiveSection(PROFILE_SECTIONS[currentSectionIndex - 1].id);
    }
  };
  const goToNextSection = () => {
    if (currentSectionIndex < PROFILE_SECTIONS.length - 1) {
      setActiveSection(PROFILE_SECTIONS[currentSectionIndex + 1].id);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      {/* Header section */}
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 p-6 rounded-2xl border border-slate-200/40">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 w-full md:w-auto">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-200 border-2 border-indigo-100 flex items-center justify-center overflow-hidden shadow-md relative group shrink-0">
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.name} className="w-full h-full object-cover" />
              ) : (
                <UserCircle size={64} className="text-slate-400" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">{profile.name}</h1>
              <p className="text-slate-500 text-xs mt-1.5 font-bold uppercase tracking-widest flex items-center gap-1.5">
                <Award size={14} className="text-indigo-600" />
                {profile.designation} {isEmployee ? `(Employee - ${profile.companyName || 'No Company'})` : '(Admin)'}
              </p>
              {isEditing && (
                <span className="inline-block mt-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-full">
                  Editing Mode Active (संशोधन मोड)
                </span>
              )}
            </div>
          </div>
        </div>

        {!isEditing ? (
          pendingRequest && pendingRequest.status === 'pending' ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm">
              <ShieldAlert size={14} className="text-amber-600 animate-pulse" />
              <span>Pending Review - Non Editable</span>
            </div>
          ) : (
            <button
              onClick={() => {
                setIsEditing(true);
                if (pendingRequest && pendingRequest.status === 'returned') {
                  const { status, id, ...restOfRequest } = pendingRequest as any;
                  setProfile(prev => ({
                    ...prev,
                    ...restOfRequest
                  }));
                }
              }}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-indigo-900 border border-slate-200 px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all transform hover:scale-[1.02] active:scale-95"
            >
              <Edit3 size={16} />
              <span>{pendingRequest && pendingRequest.status === 'returned' ? 'Correct & Resubmit Request' : 'Edit Profile'}</span>
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2 rounded-xl font-bold text-xs shadow-xs transition-all"
          >
            <X size={14} />
            <span>Cancel Editing</span>
          </button>
        )}
      </section>

      {/* Birthday Celebration Banner in Account */}
      {isBirthday && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-3xl bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 text-white shadow-xl relative overflow-hidden border-2 border-yellow-300/60"
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5 relative z-10">
            <div className="flex items-center gap-4 text-center sm:text-left">
              <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-3xl shadow-inner shrink-0 border border-white/30 animate-bounce">
                🎂
              </div>
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-yellow-100 text-xs font-black uppercase tracking-wider mb-1">
                  <Sparkles size={13} className="text-yellow-200" />
                  <span>Birthday Celebration • जन्मदिन की हार्दिक शुभकामनाएं</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Happy Birthday, {profile.name}!
                </h3>
                <p className="text-xs sm:text-sm text-yellow-100/90 max-w-xl mt-1">
                  Indian Railways and the entire RMMS family celebrate your special day! An official Birthday Certificate with your photograph has been generated.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowBirthdayModal(true)}
                className="px-5 py-2.5 bg-white text-amber-900 hover:bg-yellow-50 rounded-2xl font-black text-xs sm:text-sm transition-all shadow-lg flex items-center gap-2 shrink-0 active:scale-95"
              >
                <PartyPopper size={16} className="text-amber-600" />
                <span>View & Download Certificate</span>
              </button>
              <button
                type="button"
                disabled={sendingBirthdayEmail}
                onClick={handleSendBirthdayEmail}
                className="px-4 py-2.5 bg-amber-950/40 hover:bg-amber-950/60 text-yellow-100 border border-yellow-200/50 rounded-2xl font-black text-xs sm:text-sm transition-all shadow-md flex items-center gap-2 shrink-0 active:scale-95 disabled:opacity-60"
              >
                {sendingBirthdayEmail ? (
                  <>
                    <div className="w-4 h-4 border-2 border-yellow-200 border-t-transparent rounded-full animate-spin" />
                    <span>Sending Certificate...</span>
                  </>
                ) : (
                  <>
                    <Mail size={16} className="text-yellow-200" />
                    <span>Send to My Email</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* PME Due Urgent Notice Banner in Account */}
      {pmeStatus.isDue && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 sm:p-5 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 shadow-sm flex items-start sm:items-center justify-between gap-4"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-600 text-white shrink-0 animate-pulse">
              <AlertCircle size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-rose-800 uppercase tracking-wider">
                  Medical Compliance Notice (आवधिक चिकित्सा परीक्षा सूचना)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white">
                  PME DUE
                </span>
              </div>
              <h4 className="text-sm font-black text-rose-950 mt-0.5">
                Your Periodic Medical Examination (PME) is due on: <span className="underline decoration-rose-500 font-extrabold">{pmeStatus.dueDate}</span>
              </h4>
              <p className="text-xs text-rose-700 mt-0.5">
                {pmeStatus.daysRemaining !== undefined && pmeStatus.daysRemaining <= 0
                  ? 'Your PME is currently OVERDUE. Please attend medical checkup immediately at Railway Hospital.'
                  : `Due in ${pmeStatus.daysRemaining} days. Notification has been logged and sent to your registered email.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('others')}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0 transition-colors shadow-xs"
          >
            Check Details &rarr;
          </button>
        </motion.div>
      )}

      {/* Pending Request Status Badge */}
      <AnimatePresence>
        {pendingRequest && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn(
              "border p-5 rounded-2xl flex items-start gap-4 shadow-sm",
              pendingRequest.status === 'returned' 
                ? "bg-rose-50 border-rose-200 text-rose-800" 
                : "bg-amber-50 border-amber-200/70 text-amber-800"
            )}
          >
            <ShieldAlert className={pendingRequest.status === 'returned' ? "text-rose-600 shrink-0 mt-0.5" : "text-amber-600 shrink-0 mt-0.5"} size={20} />
            <div className="text-xs font-bold uppercase tracking-widest space-y-1.5 leading-relaxed flex-1 w-full">
              <div className={cn("text-sm font-black", pendingRequest.status === 'returned' ? "text-rose-900" : "text-amber-900")}>
                {pendingRequest.status === 'returned' ? 'Returned by Section Authority' : 'Pending Approval'}
              </div>
              <div>
                {pendingRequest.status === 'returned' 
                  ? `Your profile update request was returned by ${pendingRequest.authorityName || 'Section Authority'} for corrections. Please review and re-submit.` 
                  : `Your profile update request was forwarded to ${pendingRequest.authorityName || 'Section Authority'} and is pending review.`
                }
              </div>
              {pendingRequest.remarks && (
                <div className={cn("px-3 py-2 rounded-lg border font-semibold mt-1 normal-case", pendingRequest.status === 'returned' ? "bg-rose-100/40 border-rose-200 text-rose-900" : "bg-amber-100/40 border-amber-200 text-amber-900")}>
                  Reason: <span className="font-normal">{pendingRequest.remarks}</span>
                </div>
              )}
              <div className={pendingRequest.status === 'returned' ? "text-[10px] text-rose-500" : "text-[10px] text-amber-600"}>
                Submitted on: {formatDateToDDMMYYYY(pendingRequest.createdAt)}
              </div>

              {/* Requested Modifications List (संशोधित विवरण) */}
              {getChangeDiff().length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200/50 w-full">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">
                    Requested Changes (आपके द्वारा किए गए बदलाव):
                  </div>
                  <div className="border border-slate-200/60 rounded-xl overflow-hidden bg-white/70 max-w-full">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 text-slate-500 font-bold uppercase tracking-wider text-[9px] border-b border-slate-100">
                          <th className="py-2 px-3">Field (विवरण)</th>
                          <th className="py-2 px-3">Original (मूल)</th>
                          <th className="py-2 px-3">Proposed (नया)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {getChangeDiff().map((change: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/30 text-[11px] normal-case">
                            <td className="py-2 px-3 font-black text-slate-700">{change.label}</td>
                            <td className="py-2 px-3 text-slate-500 max-w-[150px] truncate">
                              {change.isPhoto ? (
                                change.oldPhoto ? (
                                  <div className="flex items-center gap-1.5">
                                    <img src={change.oldPhoto} className="w-8 h-8 rounded-full object-cover border border-slate-200" alt="Previous" />
                                    <span className="text-[10px] text-slate-400">Previous</span>
                                  </div>
                                ) : (
                                  <span className="italic font-medium text-slate-400">None</span>
                                )
                              ) : (
                                <span className="font-mono bg-slate-100/60 px-1.5 py-0.5 rounded break-all">{formatDateToDDMMYYYY(change.oldVal) || 'None'}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-indigo-700 font-bold max-w-[150px] truncate">
                              {change.isPhoto ? (
                                change.newPhoto ? (
                                  <div className="flex items-center gap-1.5">
                                    <img src={change.newPhoto} className="w-8 h-8 rounded-full object-cover border-2 border-indigo-500 shadow-xs" alt="New" />
                                    <span className="text-[10px] text-indigo-600 font-bold">New</span>
                                  </div>
                                ) : (
                                  <span className="italic font-medium text-indigo-500">None</span>
                                )
                              ) : (
                                <span className="font-mono bg-indigo-50/50 px-1.5 py-0.5 rounded break-all text-indigo-700 font-bold">{formatDateToDDMMYYYY(change.newVal) || 'None'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
      >
        <form onSubmit={handleFormSubmit} className="p-6 sm:p-8 space-y-8">
          {/* Section Navigation Tabs */}
          <ProfileSectionTabs
            activeSection={activeSection}
            onChangeSection={setActiveSection}
            careerBadgeCount={(profile.careerHistory?.length || 0)}
            othersBadgeCount={(profile.awards?.length || 0) + (profile.pmeRecords?.length || 0) + (profile.designationHistory?.length || 0)}
          />

          {/* Sectional Content Panel */}
          <div className="pt-2 min-h-[360px]">
            {activeSection === 'personal' && (
              <PersonalDetailsSection
                profile={profile}
                setProfile={setProfile}
                isEditing={isEditing}
                isEmployee={isEmployee}
                shouldShowField={shouldShowField}
                onOpenBirthdayModal={() => setShowBirthdayModal(true)}
              />
            )}

            {activeSection === 'career' && (
              <CareerSection
                profile={profile}
                isEmployee={isEmployee}
                canManageAdminRecords={canDelete}
                isMasterAdmin={isMasterAdmin}
                onSaveCareerRecord={handleSaveCareerRecord}
                onUpdateCareerRecord={handleUpdateCareerRecord}
                onDeleteCareerRecord={handleDeleteCareerRecord}
              />
            )}

            {activeSection === 'identity' && (
              <IdentityFinancialSection
                profile={profile}
                setProfile={setProfile}
                isEditing={isEditing}
                showIdentityDetails={showIdentityDetails}
                setShowIdentityDetails={setShowIdentityDetails}
                shouldShowField={shouldShowField}
              />
            )}

            {activeSection === 'address' && (
              <ResidentialAddressSection
                profile={profile}
                setProfile={setProfile}
                isEditing={isEditing}
                shouldShowField={shouldShowField}
              />
            )}

            {activeSection === 'photo_sig' && (
              <PhotoSignatureSection
                profile={profile}
                setProfile={setProfile}
                isEditing={isEditing}
                handlePhotoUpload={handlePhotoUpload}
                handleSignatureUpload={handleSignatureUpload}
                sigDimensions={sigDimensions}
                setSigDimensions={setSigDimensions}
                shouldShowField={shouldShowField}
              />
            )}

            {activeSection === 'others' && (
              <ProfileOthersSection
                profile={profile}
                isEmployee={isEmployee}
                canDelete={canDelete}
                isMasterAdmin={isMasterAdmin}
                isCompanyAdmin={isCompanyAdmin}
                isZonalAdmin={isZonalAdmin}
                isDivisionalAdmin={isDivisionalAdmin}
                onSaveSubRecord={handleSaveSubRecord}
                onUpdateSubRecord={handleUpdateSubRecord}
                onDeleteSubRecord={handleDeleteSubRecord}
                onRecoverSubRecord={handleRecoverSubRecord}
                onPermanentDeleteSubRecord={handlePermanentDeleteSubRecord}
              />
            )}

            {activeSection === 'security' && (
              <SecuritySection
                oldPassword={oldPassword}
                setOldPassword={setOldPassword}
                newPassword={newPassword}
                setNewPassword={setNewPassword}
                confirmNewPassword={confirmNewPassword}
                setConfirmNewPassword={setConfirmNewPassword}
                handleUpdatePassword={handleUpdatePassword}
                updatingPassword={updatingPassword}
                isEmployee={isEmployee}
                oldPin={oldPin}
                setOldPin={setOldPin}
                newPin={newPin}
                setNewPin={setNewPin}
                confirmNewPin={confirmNewPin}
                setConfirmNewPin={setConfirmNewPin}
                handleUpdatePin={handleUpdatePin}
                updatingPin={updatingPin}
              />
            )}
          </div>

          {/* Employee Specific Recipient Selector when Editing */}
          {isEmployee && isEditing && (
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 space-y-2 mt-6">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-900">
                <UserIcon size={14} className="text-indigo-600" /> Forward Request To Recipient / Authority (कर्मचारी या अधिकारी का चयन करें) *
              </label>
              <select
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all"
                value={selectedAuthorityId}
                onChange={e => setSelectedAuthorityId(e.target.value)}
                required
              >
                {authorities.length === 0 ? (
                  <option value="">No colleague / authority available in your company</option>
                ) : (
                  authorities.map(authEmp => (
                    <option key={authEmp.id} value={authEmp.id}>
                      {authEmp.name} - {authEmp.designation || 'Designation N/A'} ({authEmp.companyName || 'Company'}{authEmp.accessType === 'admin-light' ? ' • Company Admin' : ' • ' + (authEmp.accessType || 'Standard')})
                    </option>
                  ))
                )}
              </select>
              <p className="text-[11px] text-slate-500">
                Any modifications made will be securely forwarded to your company colleague/administrator for review.
              </p>
            </div>
          )}

          {/* Bottom Bar: Section Stepper (Prev/Next) & Edit Action Buttons */}
          <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
              {currentSectionIndex > 0 ? (
                <button
                  type="button"
                  onClick={goToPrevSection}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-1.5"
                >
                  <span>← Previous</span>
                  <span className="hidden sm:inline">({PROFILE_SECTIONS[currentSectionIndex - 1].label})</span>
                </button>
              ) : <div />}

              {currentSectionIndex < PROFILE_SECTIONS.length - 1 ? (
                <button
                  type="button"
                  onClick={goToNextSection}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 transition-all flex items-center gap-1.5"
                >
                  <span>Next</span>
                  <span className="hidden sm:inline">({PROFILE_SECTIONS[currentSectionIndex + 1].label})</span>
                  <span>→</span>
                </button>
              ) : <div />}
            </div>

            {isEditing && (
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-5 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5"
                >
                  <X size={15} />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={cn(
                    "bg-gradient-to-r text-white font-bold py-2.5 px-6 rounded-xl text-xs transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed",
                    isEmployee ? "from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-indigo-600/20" : "from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-600/20"
                  )}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : isEmployee ? (
                    <Send size={15} />
                  ) : (
                    <Save size={15} />
                  )}
                  <span>
                    {saving 
                      ? 'Processing...' 
                      : isEmployee 
                        ? 'Forward Changes for Review' 
                        : 'Save Profile Changes'
                    }
                  </span>
                </button>
              </div>
            )}
          </div>
        </form>

      </motion.div>

      {/* Main Admin Only: System Branding & Logo Settings */}
      {isMainAdminOnly && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6"
        >
          <div className="border-b border-slate-100 p-6 bg-gradient-to-r from-amber-50/70 via-slate-50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-white border border-amber-200/80 flex items-center justify-center p-1 shadow-2xs overflow-hidden shrink-0">
                <RMMSLogo variant="icon" className="w-full h-full" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <ImageIcon className="text-amber-600" size={20} /> Application Logo & Branding
                  </h2>
                  <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full border border-amber-300">
                    Main Admin Only
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Change the system logo displayed across the navigation bar, login gateway, and official PDF documents.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-xs transition-all active:scale-95 flex items-center justify-center gap-2 shrink-0"
            >
              <ImageIcon size={16} />
              <span>Change / Manage Logo</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Email Verification OTP Modal */}
      <AnimatePresence>
        {showEmailOtpModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100"
              id="email-otp-verification-modal"
            >
              {/* Header */}
              <div className="p-6 bg-gradient-to-r from-indigo-900 to-indigo-800 text-white flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                    <ShieldCheck size={22} className="text-indigo-200" />
                  </div>
                  <div>
                    <h3 className="text-base font-black tracking-tight">Email Verification (ईमेल सत्यापन)</h3>
                    <p className="text-xs text-indigo-200 font-medium">Verify your new email address</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailOtpModal(false);
                    setEmailOtpError('');
                  }}
                  className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">
                <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-950 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-indigo-900">
                    <Mail size={14} className="text-indigo-600" />
                    <span>New Email: {profile.email}</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    A 6-digit OTP has been sent to your new email. Please enter it below to verify your email and forward your profile update.
                  </p>
                </div>

                {emailOtpError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl p-3 flex items-center gap-2">
                    <ShieldAlert size={16} className="shrink-0 text-rose-600" />
                    <span>{emailOtpError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600">
                    Enter 6-Digit OTP (6 अंकों का ओटीपी दर्ज करें)
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="••••••"
                    className="w-full text-center tracking-[0.5em] text-2xl font-mono font-black py-3.5 border-2 border-indigo-200 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 rounded-2xl outline-none bg-slate-50 focus:bg-white transition-all text-slate-800"
                    value={emailOtpInput}
                    onChange={e => {
                      setEmailOtpInput(e.target.value.replace(/\D/g, ''));
                      setEmailOtpError('');
                    }}
                    autoFocus
                  />
                </div>

                {/* Resend Action */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-500 font-medium">Didn't receive code?</span>
                  {emailOtpCooldown > 0 ? (
                    <span className="text-slate-400 font-semibold">Resend in {emailOtpCooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      disabled={emailOtpSending}
                      onClick={() => handleSendNewEmailOtp((profile.email || '').trim().toLowerCase())}
                      className="text-indigo-600 font-bold hover:text-indigo-800 flex items-center gap-1 hover:underline disabled:opacity-50"
                    >
                      {emailOtpSending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      <span>Resend OTP (ओटीपी पुनः भेजें)</span>
                    </button>
                  )}
                </div>

                {/* Modal Buttons */}
                <div className="pt-3 border-t border-slate-100 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailOtpModal(false);
                      setEmailOtpError('');
                    }}
                    className="flex-1 py-3 px-4 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={emailOtpLoading || emailOtpInput.length !== 6}
                    onClick={handleVerifyEmailOtpAndProceed}
                    className="flex-1 py-3 px-4 rounded-xl text-xs font-bold text-white bg-indigo-900 hover:bg-indigo-800 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {emailOtpLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle size={14} />
                    )}
                    <span>Verify & Forward</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Admin Only: App Logo Management Modal */}
      {isMainAdminOnly && (
        <AppLogoManagerModal
          isOpen={showLogoModal}
          onClose={() => setShowLogoModal(false)}
        />
      )}

      {/* Birthday Celebration Certificate Modal */}
      <BirthdayCertificateModal
        profile={profile}
        isOpen={showBirthdayModal}
        onClose={() => setShowBirthdayModal(false)}
      />
    </motion.div>
  );
}
