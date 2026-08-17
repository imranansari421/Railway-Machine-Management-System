import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { 
  UserCircle, Save, Mail, Phone, MapPin, Briefcase, 
  User as UserIcon, Loader2, Calendar, Award, 
  ShieldAlert, Edit3, X, Send, Camera, Upload, CheckCircle,
  Lock, KeyRound, TrendingUp, History, Building2, Eye, EyeOff
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { hashPin, isHashedPin } from '../utils/crypto';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser, EmployeeProfile, ProfileApprovalRequest } from '../utils/employee';

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
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showIdentityDetails, setShowIdentityDetails] = useState(false);
  const [isEmployee, setIsEmployee] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<ProfileApprovalRequest | null>(null);
  const [authorities, setAuthorities] = useState<any[]>([]);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string>('');

  // Backup of the original profile to restore on Cancel
  const [originalProfile, setOriginalProfile] = useState<EmployeeProfile | null>(null);

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

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      toast.error('You must be logged in to update your password.');
      return;
    }
    if (!newPassword || !confirmNewPassword) {
      toast.error('Please fill in all password fields.');
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

    setUpdatingPassword(true);
    try {
      if (profile.accessType === 'admin-light') {
        if (!oldPassword) {
          toast.error('Please enter your current password.');
          setUpdatingPassword(false);
          return;
        }
        const { hashPassword, isHashedPassword } = await import('../utils/crypto');
        const saltSource = (profile as any).loginId || profile.employeeId || (profile as any).uid;
        
        let isOldPasswordCorrect = false;
        const storedPassword = (profile as any).password;
        if (isHashedPassword(storedPassword)) {
          const hashedOld = await hashPassword(oldPassword, saltSource);
          isOldPasswordCorrect = (storedPassword === hashedOld);
        } else {
          isOldPasswordCorrect = (storedPassword === oldPassword);
        }

        if (!isOldPasswordCorrect) {
          toast.error('Incorrect current password.');
          setUpdatingPassword(false);
          return;
        }
        if (newPassword === oldPassword) {
          toast.error('New password cannot be the same as old password.');
          setUpdatingPassword(false);
          return;
        }

        const hashedNew = await hashPassword(newPassword, saltSource);

        const { doc, updateDoc } = await import('firebase/firestore');
        const empRef = doc(db, 'employees', profile.employeeId);
        await updateDoc(empRef, {
          password: hashedNew
        });

        // Update local profile state
        setProfile(prev => ({ ...prev, password: hashedNew } as any));
        if (originalProfile) {
          setOriginalProfile(prev => prev ? ({ ...prev, password: hashedNew } as any) : null);
        }
        toast.success('Password changed successfully! Use your new password for future logins.');
      } else {
        // Master Admin
        const { updatePassword } = await import('firebase/auth');
        await updatePassword(auth.currentUser, newPassword);
        toast.success('Admin password updated successfully in system security!');
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
      const isEmpSession = auth.currentUser.email?.endsWith('@employee.billedapp.com') || false;
      setIsEmployee(isEmpSession);

      // Fetch the employee details using our robust helper
      const empProfile = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      
      if (empProfile) {
        setProfile(empProfile);
        setOriginalProfile(empProfile);
        
        // Fetch any pending request for this employee
        if (empProfile.employeeId) {
          await fetchPendingRequest(empProfile.employeeId);
        }

        // Fetch authorities (Full/Light Access/Operators)
        try {
          const snap = await getDocs(collection(db, 'employees'));
          const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

          // Filter list of employees
          const filtered = list.filter(emp => {
            const isNotMe = emp.id !== empProfile.employeeId && emp.id !== auth.currentUser?.uid;
            if (!isNotMe) return false;

            const myCompany = empProfile.companyName || '';
            const isOperator = emp.designation?.toLowerCase().includes('operator');
            const isSameCompany = !myCompany || !emp.companyName || emp.companyName === myCompany;

            if (empProfile.accessType === 'full') {
              // Full Access Admin can forward to Company Admin (admin-light) or Operator of their same company
              return isSameCompany && (emp.accessType === 'admin-light' || isOperator);
            }
            if (empProfile.accessType === 'admin-light') {
              // Company Admin can forward to Master Admin (full) or Operator of their company
              return emp.accessType === 'full' || (isOperator && isSameCompany);
            }
            // Standard employees (limited, etc.) can forward to Full Access (full) or Operator of their same company
            return emp.accessType === 'full' || (isOperator && isSameCompany);
          });

          // Sort so that those on the same machine are at the top
          filtered.sort((a: any, b: any) => {
            if (a.machineName === empProfile.machineName && b.machineName !== empProfile.machineName) return -1;
            if (a.machineName !== empProfile.machineName && b.machineName === empProfile.machineName) return 1;
            return 0;
          });

          const listWithAdmin = [
            { id: 'admin', name: 'Admin', designation: 'Top-Level Admin' },
            ...filtered
          ];

          setAuthorities(listWithAdmin);
          if (listWithAdmin.length > 0) {
            setSelectedAuthorityId(listWithAdmin[0].id);
          }
        } catch (err) {
          console.error('Error fetching section authorities:', err);
          setAuthorities([{ id: 'admin', name: 'Admin', designation: 'Top-Level Admin' }]);
          setSelectedAuthorityId('admin');
        }
      } else {
        // Fallback for Admin / regular users
        const docRef = doc(db, 'users', auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        const basicProfile: EmployeeProfile = {
          employeeId: '',
          name: auth.currentUser.displayName || '',
          email: auth.currentUser.email || '',
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
          const merged = { ...basicProfile, ...data } as EmployeeProfile;
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
      changes.push({ label: 'DOB (जन्म तिथि)', oldVal: originalProfile.dob || 'None', newVal: pendingRequest.dob || 'None' });
    }
    if ((originalProfile.pfNo || '') !== (pendingRequest.pfNo || '')) {
      changes.push({ label: 'PF Number (पीएफ संख्या)', oldVal: originalProfile.pfNo || 'None', newVal: pendingRequest.pfNo || 'None' });
    }
    if ((originalProfile.esicNo || '') !== (pendingRequest.esicNo || '')) {
      changes.push({ label: 'ESIC Number (ईएसआईसी संख्या)', oldVal: originalProfile.esicNo || 'None', newVal: pendingRequest.esicNo || 'None' });
    }
    if (originalProfile.doj !== pendingRequest.doj) {
      changes.push({ label: 'Date of Joining (ज्वाइनिंग तिथि)', oldVal: originalProfile.doj, newVal: pendingRequest.doj });
    }
    if ((originalProfile.fatherName || '') !== (pendingRequest.fatherName || '')) {
      changes.push({ label: "Father's Name (पिता का नाम)", oldVal: originalProfile.fatherName || 'None', newVal: pendingRequest.fatherName || 'None' });
    }
    if ((originalProfile.age || '') !== (pendingRequest.age || '')) {
      changes.push({ label: 'Age (उम्र)', oldVal: originalProfile.age || 'None', newVal: pendingRequest.age || 'None' });
    }
    if ((originalProfile.validityDate || '') !== (pendingRequest.validityDate || '')) {
      changes.push({ label: 'Validity Date (वैधता तिथि)', oldVal: originalProfile.validityDate || 'None', newVal: pendingRequest.validityDate || 'None' });
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
            width = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
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

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        const requestedFieldsDescription = getRequestedFieldsDescription(originalProfile, profile);

        const requestPayload = {
          employeeId: profile.employeeId,
          uid: auth.currentUser.uid,
          name: profile.name,
          email: profile.email,
          mobile: profile.mobile,
          designation: profile.designation,
          gender: profile.gender || 'Male',
          address: profile.address,
          dob: profile.dob || '',
          pfNo: profile.pfNo || '',
          esicNo: profile.esicNo || '',
          doj: profile.doj || '',
          photoUrl: profile.photoUrl || '',
          employeeSigUrl: profile.employeeSigUrl || '',
          status: 'pending',
          authorityId: selectedAuthorityId || '',
          authorityName: selectedAuthorityId === 'admin' ? 'Admin' : (selectedAuthority ? selectedAuthority.name : ''),
          machineName: profile.machineName || '',
          forwardedToAdmin: selectedAuthorityId === 'admin',
          isFullAccessAdmin: isFullAccessAdmin,
          companyName: profile.companyName || '',
          forwardedToCompanyAdmin: selectedAuthority ? selectedAuthority.accessType === 'admin-light' : false,
          forwardedTo: selectedAuthorityId || '',
          forwardedToName: selectedAuthorityId === 'admin' ? 'Admin' : (selectedAuthority ? selectedAuthority.name : ''),
          forwardedToEmail: selectedAuthority ? selectedAuthority.email : '',
          requestedFieldsDescription: requestedFieldsDescription,
          
          // Full form fields
          fatherName: profile.fatherName || '',
          age: profile.age || '',
          sex: profile.gender || '',
          validityDate: profile.validityDate || '',
          department: profile.department || '',
          idNo: profile.idNo || '',
          aadharNo: profile.aadharNo || '',
          panNo: profile.panNo || '',
          accountNo: profile.accountNo || '',
          ifscCode: profile.ifscCode || '',
          bankName: profile.bankName || '',
          branch: profile.branch || '',
          zone: profile.zone || '',
          division: profile.division || '',
          
          createdAt: new Date().toISOString()
        };

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
          
          if (selectedAuthorityId === 'admin') {
            toast.success('Your profile changes have been forwarded directly to the Master Admin!');
          } else if (selectedAuthority && selectedAuthority.accessType === 'admin-light') {
            toast.success('Your profile changes have been forwarded directly to your Company Admin!');
          } else if (selectedAuthority) {
            toast.success(`Your profile changes have been forwarded to ${selectedAuthority.name}!`);
          } else {
            toast.success('Your profile changes have been forwarded!');
          }
        }

        setIsEditing(false);
        await fetchPendingRequest(profile.employeeId);
      } else {
        // Direct save for Administrator
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          uid: auth.currentUser.uid,
          name: profile.name,
          email: profile.email,
          mobile: profile.mobile,
          designation: profile.designation,
          gender: profile.gender || 'Male',
          address: profile.address,
          role: 'admin',
        }, { merge: true });

        // Dispatch updated event for Layout header
        window.dispatchEvent(new Event('profile-updated'));

        toast.success('Administrator profile updated successfully!');
        setIsEditing(false);
        if (originalProfile) {
          setOriginalProfile({ ...profile });
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

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
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
      <div className="flex items-center justify-center h-64">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"
        ></motion.div>
      </div>
    );
  }

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
          {isEditing ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/60 shadow-sm w-full max-w-lg">
              <div className="relative w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border-2 border-slate-200 shadow-md group shrink-0">
                {profile.photoUrl ? (
                  <>
                    <img src={profile.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setProfile(prev => ({ ...prev, photoUrl: '' }))}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black uppercase tracking-wider"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <Camera size={28} className="text-slate-400/80" />
                    <span className="text-[10px] font-black uppercase tracking-wider mt-1">No Photo</span>
                  </div>
                )}
              </div>
              <div className="flex-1 w-full">
                <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-all bg-slate-50 hover:bg-slate-100/70 flex flex-col items-center justify-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <Upload size={20} className="text-indigo-600 mb-1.5" />
                  <p className="text-xs font-bold text-slate-700">Click or Drag Photo Here</p>
                  <p className="text-[10px] text-slate-400 mt-1 font-semibold">PNG, JPG, WEBP (Less than 50KB)</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-slate-200 border-2 border-indigo-100 flex items-center justify-center overflow-hidden shadow-md relative group shrink-0">
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
              </div>
            </div>
          )}
        </div>

        {!isEditing && (
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
        )}
      </section>

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
                Submitted on: {new Date(pendingRequest.createdAt).toLocaleDateString()}
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
                                <span className="italic font-medium text-slate-400">Photo change</span>
                              ) : (
                                <span className="font-mono bg-slate-100/60 px-1.5 py-0.5 rounded break-all">{change.oldVal || 'None'}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-indigo-700 font-bold max-w-[150px] truncate">
                              {change.isPhoto ? (
                                <span className="italic font-medium text-indigo-500">Photo change</span>
                              ) : (
                                <span className="font-mono bg-indigo-50/50 px-1.5 py-0.5 rounded break-all text-indigo-700 font-bold">{change.newVal || 'None'}</span>
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
        <form onSubmit={handleFormSubmit} className="p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Full Name */}
            {shouldShowField('name') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <UserIcon size={14} className="text-slate-400" /> Full Name
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.name}
                  onChange={e => setProfile({ ...profile, name: e.target.value })}
                  required
                />
              </div>
            )}

            {/* Email Address */}
            {shouldShowField('email') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Mail size={14} className="text-slate-400" /> Email Address
                </label>
                <input
                  type="email"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.email}
                  onChange={e => setProfile({ ...profile, email: e.target.value })}
                  required
                />
              </div>
            )}

            {/* Mobile Number */}
            {shouldShowField('mobile') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Phone size={14} className="text-slate-400" /> Mobile Number
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.mobile}
                  onChange={e => setProfile({ ...profile, mobile: e.target.value })}
                  required
                />
              </div>
            )}

            {/* Designation */}
            {shouldShowField('designation') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Briefcase size={14} className="text-slate-400" /> Designation
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.designation}
                  onChange={e => setProfile({ ...profile, designation: e.target.value })}
                />
              </div>
            )}

            {/* Company Name */}
            {isEmployee && shouldShowField('companyName') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Building2 size={14} className="text-slate-400" /> Company Name
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.companyName || ''}
                  onChange={e => setProfile({ ...profile, companyName: e.target.value })}
                />
              </div>
            )}

            {/* SECTION 1: PERSONAL PROFILE DETAILS */}
            {shouldShowSection(['fatherName', 'gender', 'age', 'dob']) && (
              <div className="md:col-span-2 border-b border-slate-100 pb-3">
                <h2 className="text-sm font-black uppercase text-indigo-950 tracking-wider flex items-center gap-2">
                  <UserIcon size={16} className="text-indigo-600" /> Personal Details (व्यक्तिगत विवरण)
                </h2>
              </div>
            )}

            {/* Father's Name */}
            {shouldShowField('fatherName') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Father's Name (पिता का नाम)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. Shri Late..."
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.fatherName || ''}
                  onChange={e => setProfile({ ...profile, fatherName: e.target.value })}
                />
              </div>
            )}

            {/* Gender / Sex */}
            {shouldShowField('gender') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Gender (लिंग)
                </label>
                <select
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.gender || 'Male'}
                  onChange={e => setProfile({ ...profile, gender: e.target.value as any })}
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            )}

            {/* Age */}
            {shouldShowField('age') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Age (उम्र)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. 28"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.age || ''}
                  onChange={e => setProfile({ ...profile, age: e.target.value })}
                />
              </div>
            )}

            {/* Date of Birth (DOB) */}
            {shouldShowField('dob') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Calendar size={14} className="text-slate-400" /> Date of Birth (DOB)
                </label>
                <input
                  type="date"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.dob || ''}
                  onChange={e => setProfile({ ...profile, dob: e.target.value })}
                />
              </div>
            )}


            {/* SECTION 2: COMPANY & OFFICIAL PLACEMENT DETAILS */}
            {shouldShowSection(['idNo', 'designation', 'companyName', 'doj', 'department', 'validityDate', 'zone', 'division', 'pfNo', 'esicNo']) && (
              <div className="md:col-span-2 border-b border-slate-100 pb-3 pt-4">
                <h2 className="text-sm font-black uppercase text-indigo-950 tracking-wider flex items-center gap-2">
                  <Briefcase size={16} className="text-indigo-600" /> Official Placement Details (आधिकारिक प्लेसमेंट विवरण)
                </h2>
              </div>
            )}

            {/* ID No. */}
            {shouldShowField('idNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  ID No. (आईडी संख्या)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. EMP-101"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.idNo || ''}
                  onChange={e => setProfile({ ...profile, idNo: e.target.value })}
                />
              </div>
            )}

            {/* Designation */}
            {shouldShowField('designation') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Briefcase size={14} className="text-slate-400" /> Designation (पद)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.designation || ''}
                  onChange={e => setProfile({ ...profile, designation: e.target.value })}
                />
              </div>
            )}

            {/* Company Name */}
            {shouldShowField('companyName') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Building2 size={14} className="text-slate-400" /> Company Name (कंपनी का नाम)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.companyName || ''}
                  onChange={e => setProfile({ ...profile, companyName: e.target.value })}
                />
              </div>
            )}

            {/* Date of Joining (DOJ) */}
            {shouldShowField('doj') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Calendar size={14} className="text-slate-400" /> Date of Joining (DOJ)
                </label>
                <input
                  type="date"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.doj || ''}
                  onChange={e => setProfile({ ...profile, doj: e.target.value })}
                />
              </div>
            )}

            {/* Department */}
            {shouldShowField('department') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Department (विभाग)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. Civil Engineering"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.department || ''}
                  onChange={e => setProfile({ ...profile, department: e.target.value })}
                />
              </div>
            )}

            {/* Validity of Date of I-Card */}
            {shouldShowField('validityDate') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Calendar size={14} className="text-slate-400" /> Validity of I-Card
                </label>
                <input
                  type="date"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.validityDate || ''}
                  onChange={e => setProfile({ ...profile, validityDate: e.target.value })}
                />
              </div>
            )}

            {/* Railway Zone */}
            {shouldShowField('zone') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Railway Zone (रेलवे जोन)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. West Central Railway"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.zone || ''}
                  onChange={e => setProfile({ ...profile, zone: e.target.value })}
                />
              </div>
            )}

            {/* Railway Division */}
            {shouldShowField('division') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Railway Division (रेलवे मंडल)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="e.g. Jabalpur"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.division || ''}
                  onChange={e => setProfile({ ...profile, division: e.target.value })}
                />
              </div>
            )}

            {/* PF Number */}
            {shouldShowField('pfNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Award size={14} className="text-slate-400" /> PF Number
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.pfNo || ''}
                  onChange={e => setProfile({ ...profile, pfNo: e.target.value })}
                />
              </div>
            )}

            {/* ESIC Number */}
            {shouldShowField('esicNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Award size={14} className="text-slate-400" /> ESIC Number (ईएसआईसी संख्या)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="31000123450001001"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.esicNo || ''}
                  onChange={e => setProfile({ ...profile, esicNo: e.target.value })}
                />
              </div>
            )}


            {/* SECTION 3: IDENTITY & FINANCIAL PROFILE DETAILS */}
            {shouldShowSection(['aadharNo', 'panNo', 'bankName', 'branch', 'accountNo', 'ifscCode']) && (
              <div className="md:col-span-2 border-b border-slate-100 pb-3 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h2 className="text-sm font-black uppercase text-indigo-950 tracking-wider flex items-center gap-2">
                  <Building2 size={16} className="text-indigo-600" /> Identity & Financial Details (पहचान और वित्तीय विवरण)
                </h2>
                <button
                  type="button"
                  onClick={() => setShowIdentityDetails(!showIdentityDetails)}
                  className="flex items-center gap-1.5 self-start sm:self-center px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all focus:outline-none shadow-sm"
                  id="profile-toggle-financial-details"
                >
                  {showIdentityDetails ? (
                    <>
                      <EyeOff size={14} /> Hide Details (विवरण छुपाएं)
                    </>
                  ) : (
                    <>
                      <Eye size={14} /> Show Details (विवरण दिखाएं)
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Aadhar No. */}
            {shouldShowField('aadharNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Aadhar No. (आधार संख्या)
                </label>
                <input
                  type={showIdentityDetails ? "text" : "password"}
                  disabled={!isEditing}
                  placeholder="12-digit Aadhar No."
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.aadharNo || ''}
                  onChange={e => setProfile({ ...profile, aadharNo: e.target.value })}
                />
              </div>
            )}

            {/* Pan No. */}
            {shouldShowField('panNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  PAN No. (पैन संख्या)
                </label>
                <input
                  type={showIdentityDetails ? "text" : "password"}
                  disabled={!isEditing}
                  placeholder="10-digit PAN No."
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.panNo || ''}
                  onChange={e => setProfile({ ...profile, panNo: e.target.value })}
                />
              </div>
            )}

            {/* Bank Name */}
            {shouldShowField('bankName') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Bank Name (बैंक का नाम)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="Bank Name"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.bankName || ''}
                  onChange={e => setProfile({ ...profile, bankName: e.target.value })}
                />
              </div>
            )}

            {/* Branch */}
            {shouldShowField('branch') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Branch (शाखा)
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder="Branch Name"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.branch || ''}
                  onChange={e => setProfile({ ...profile, branch: e.target.value })}
                />
              </div>
            )}

            {/* Account No. */}
            {shouldShowField('accountNo') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Account No. (खाता संख्या)
                </label>
                <input
                  type={showIdentityDetails ? "text" : "password"}
                  disabled={!isEditing}
                  placeholder="Bank Account Number"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.accountNo || ''}
                  onChange={e => setProfile({ ...profile, accountNo: e.target.value })}
                />
              </div>
            )}

            {/* IFSC Code */}
            {shouldShowField('ifscCode') && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  IFSC Code (आईएफएससी कोड)
                </label>
                <input
                  type={showIdentityDetails ? "text" : "password"}
                  disabled={!isEditing}
                  placeholder="IFSC Code"
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all font-mono",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.ifscCode || ''}
                  onChange={e => setProfile({ ...profile, ifscCode: e.target.value })}
                />
              </div>
            )}


            {/* SECTION 4: LOCATION & ADDRESS */}
            {shouldShowSection(['address']) && (
              <div className="md:col-span-2 border-b border-slate-100 pb-3 pt-4">
                <h2 className="text-sm font-black uppercase text-indigo-950 tracking-wider flex items-center gap-2">
                  <MapPin size={16} className="text-indigo-600" /> Residential Address (आवासीय पता)
                </h2>
              </div>
            )}

            {/* Residential Address */}
            {shouldShowField('address') && (
              <div className="space-y-2 md:col-span-2">
                <textarea
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all h-24 resize-none",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.address || ''}
                  onChange={e => setProfile({ ...profile, address: e.target.value })}
                />
              </div>
            )}

            {/* Signature Upload Option for Employees */}
            {isEmployee && shouldShowField('employeeSigUrl') && (
              <div className="space-y-2 md:col-span-2 border border-slate-100 rounded-2xl p-6 bg-slate-50/20">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  <Edit3 size={14} className="text-slate-400" /> Authorized Signature (अधिकृत हस्ताक्षर)
                </label>
                
                {isEditing ? (
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className={cn(
                      "border border-slate-200/80 rounded-xl bg-white flex items-center justify-center p-3 overflow-hidden shadow-inner relative group shrink-0 transition-all duration-300",
                      profile.employeeSigUrl ? "w-fit max-w-[320px] h-auto min-h-[70px] min-w-[140px]" : "w-full sm:w-1/2 max-w-[300px] h-28"
                    )}>
                      {profile.employeeSigUrl ? (
                        <div className="relative flex items-center justify-center">
                          <img 
                            src={profile.employeeSigUrl} 
                            alt="Signature Preview" 
                            className="max-w-full max-h-32 object-contain"
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              setSigDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setProfile(prev => ({ ...prev, employeeSigUrl: '' }));
                              setSigDimensions(null);
                            }}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase tracking-wider rounded-lg"
                          >
                            Remove Signature
                          </button>
                        </div>
                      ) : (
                        <div className="text-center text-slate-400">
                          <Edit3 size={24} className="mx-auto mb-1 text-slate-400/60" />
                          <span className="text-[10px] font-black uppercase tracking-wider block">No Signature</span>
                          <span className="text-[9px] text-slate-400">upload signature below</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 w-full">
                      <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSignatureUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={18} className="text-indigo-600 mb-1.5" />
                        <p className="text-xs font-bold text-slate-700">Click or Drag Signature Image</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">PNG (preferred for transparency) / JPG under 50KB</p>
                      </div>
                      {sigDimensions && profile.employeeSigUrl && (
                        <p className="text-[10px] font-mono text-indigo-600 mt-2 font-semibold text-center sm:text-left">
                          Dimensions: {sigDimensions.width} × {sigDimensions.height} px (Ratio: {parseFloat((sigDimensions.width / sigDimensions.height).toFixed(2))})
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                    <div className={cn(
                      "border border-slate-200/50 rounded-xl bg-slate-50 flex items-center justify-center p-3 overflow-hidden shadow-inner shrink-0 transition-all duration-300",
                      profile.employeeSigUrl ? "w-fit max-w-[320px] h-auto min-h-[70px] min-w-[140px]" : "w-full sm:w-1/2 max-w-[300px] h-28"
                    )}>
                      {profile.employeeSigUrl ? (
                        <img 
                          src={profile.employeeSigUrl} 
                          alt="Approved Signature" 
                          className="max-w-full max-h-32 object-contain"
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            setSigDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                          }}
                        />
                      ) : (
                        <div className="text-center text-slate-400/80">
                          <Edit3 size={24} className="mx-auto mb-1 text-slate-300" />
                          <span className="text-[10px] font-black uppercase tracking-wider block">No Signature Uploaded</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">Signature Verification State</p>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        This signature is used on official reports, service sheets, and breakdown tickets. If you update your signature, it will need to be approved by your supervisor or Section Authority before it becomes active.
                      </p>
                      {sigDimensions && profile.employeeSigUrl && (
                        <p className="text-[10px] font-mono text-indigo-600 mt-2 font-semibold">
                          Dimensions: {sigDimensions.width} × {sigDimensions.height} px (Ratio: {parseFloat((sigDimensions.width / sigDimensions.height).toFixed(2))})
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Employee Specific: Section Authority */}
            {isEmployee && isEditing && (
              <div className="space-y-2 md:col-span-2 bg-indigo-5/40 border border-indigo-100/60 rounded-2xl p-4">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-900">
                  <UserIcon size={14} className="text-indigo-600" /> Select Recipient / Authority (कर्मचारी या अधिकारी का चयन करें)
                </label>
                <select
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all mt-1"
                  value={selectedAuthorityId}
                  onChange={e => setSelectedAuthorityId(e.target.value)}
                  required
                >
                  {authorities.length === 0 ? (
                    <option value="">No recipient available</option>
                  ) : (
                    authorities.map(authEmp => {
                      if (authEmp.id === 'admin') {
                        return (
                          <option key="admin" value="admin">
                            Admin (Top-Level Admin)
                          </option>
                        );
                      }
                      return (
                        <option key={authEmp.id} value={authEmp.id}>
                          {authEmp.accessType === 'admin-light'
                            ? `${authEmp.companyName || authEmp.name.replace(' Admin', '')} (Company Administrator)`
                            : `${authEmp.name} (${authEmp.designation || 'Employee'}) - ${authEmp.companyName || 'No Company'}`}
                        </option>
                      );
                    })
                  )}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Your request will be sent to the selected recipient for review and approval.
                </p>
              </div>
            )}
          </div>

          {/* Career & Designation History (Read-only) */}
          {(!pendingRequest || isEditing) && isEmployee && profile.designationHistory && profile.designationHistory.length > 0 && (
            <div className="border-t border-slate-100 pt-6 mt-6 space-y-3">
              <h3 className="text-xs font-black uppercase text-indigo-900 tracking-wider flex items-center gap-2">
                <TrendingUp size={16} className="text-indigo-600" /> Career & Designation History
              </h3>
              <div className="relative pl-6 border-l-2 border-indigo-100 space-y-4 ml-2 pt-1">
                {profile.designationHistory.map((history, hIdx) => (
                  <div key={hIdx} className="relative">
                    {/* Timeline Dot */}
                    <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow" />
                    <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/40">
                      <div className="flex justify-between items-start gap-4">
                        <span className="font-bold text-xs text-slate-800">
                          {history.oldDesignation} ➡️ {history.newDesignation}
                        </span>
                        <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                          {history.type}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        Changed On: <span className="font-semibold text-slate-700">{history.updatedAt ? new Date(history.updatedAt).toLocaleDateString() : 'N/A'}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Previous Employment History (Read-only) */}
          {(!pendingRequest || isEditing) && isEmployee && profile.employmentHistory && profile.employmentHistory.length > 0 && (
            <div className="border-t border-slate-100 pt-6 mt-6 space-y-3">
              <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-2">
                <History size={16} className="text-amber-600" /> Previous Employment Records (PF-Matched)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {profile.employmentHistory.map((history, hIdx) => (
                  <div key={hIdx} className="bg-amber-50/40 p-3.5 rounded-xl border border-amber-200/30 flex justify-between items-center">
                    <div>
                      <p className="text-xs font-black text-amber-900">{history.companyName}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">{history.designation}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] bg-amber-100/60 border border-amber-200/50 text-amber-900 px-2 py-0.5 rounded-md font-bold block mb-1">
                        Left
                      </span>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {history.doj} to {history.leftDate}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form Actions */}
          <AnimatePresence>
            {isEditing && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-6 border-t border-slate-100 flex justify-end gap-3"
              >
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-sm transition-all flex items-center gap-2"
                >
                  <X size={16} />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={cn(
                    "bg-gradient-to-r text-white font-bold py-3 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
                    isEmployee ? "from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700" : "from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                  )}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : isEmployee ? (
                    <Send size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  <span>
                    {saving 
                      ? 'Processing...' 
                      : isEmployee 
                        ? 'Forward' 
                        : 'Save Profile Changes'
                    }
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </motion.div>

      {/* Credentials / Security section */}
      {(profile.accessType === 'admin-light' || !isEmployee) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6"
        >
          <div className="border-b border-slate-100 p-6 bg-slate-50/50">
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <KeyRound className="text-indigo-600" size={20} /> {profile.accessType === 'admin-light' ? 'Change Corporate Admin Password' : 'Change Admin Password'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Keep your account secure by periodically updating your credentials.
            </p>
          </div>

          <form onSubmit={handleUpdatePassword} className="p-8 space-y-6">
            <div className={cn(
              "grid grid-cols-1 gap-6",
              profile.accessType === 'admin-light' ? "sm:grid-cols-3" : "sm:grid-cols-2"
            )}>
              {/* Old Password */}
              {profile.accessType === 'admin-light' && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Lock size={14} className="text-slate-400" /> Current Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                    value={oldPassword}
                    onChange={e => setOldPassword(e.target.value)}
                    required
                    id="old-password-input"
                  />
                </div>
              )}

              {/* New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <KeyRound size={14} className="text-slate-400" /> New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  id="new-password-input"
                />
              </div>

              {/* Confirm New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <CheckCircle size={14} className="text-slate-400" /> Confirm New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  id="confirm-password-input"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={updatingPassword}
                className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3.5 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                id="update-password-btn"
              >
                {updatingPassword ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                <span>{profile.accessType === 'admin-light' ? 'Update Corporate Password' : 'Update Admin Password'}</span>
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {isEmployee && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
        >
          <div className="border-b border-slate-100 p-6 bg-slate-50/50">
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <KeyRound className="text-indigo-600" size={20} /> Change Security PIN
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Keep your account secure by periodically updating your 6-digit access PIN.
            </p>
          </div>

          <form onSubmit={handleUpdatePin} className="p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Old PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Lock size={14} className="text-slate-400" /> Current PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={oldPin}
                  onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="current-pin-input"
                />
              </div>

              {/* New PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <KeyRound size={14} className="text-slate-400" /> New PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="new-pin-input"
                />
              </div>

              {/* Confirm New PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <CheckCircle size={14} className="text-slate-400" /> Confirm New PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={confirmNewPin}
                  onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="confirm-pin-input"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={updatingPin}
                className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3.5 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                id="update-pin-btn"
              >
                {updatingPin ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                <span>Update Security PIN</span>
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </motion.div>
  );
}
