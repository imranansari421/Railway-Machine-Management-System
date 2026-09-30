import { collection, addDoc, getDocs, query, where, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { EmployeeProfile, PmeRecord } from './employee';
import { sendPmeDueEmail, sendBirthdayEmailWithCertificate } from './emailNotifier';

/**
 * Checks if a given Date of Birth (DOB) string matches today's month and day.
 * Supports formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, etc.
 * Compares against both Local client time and Indian Standard Time (Asia/Kolkata).
 */
export function isBirthdayToday(dobString?: string): boolean {
  if (!dobString) return false;
  const clean = dobString.trim();
  if (!clean) return false;

  // Local Client Time
  const nowLocal = new Date();
  
  // Indian Standard Time (IST, UTC+5:30)
  let nowIST: Date;
  try {
    const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    nowIST = new Date(istString);
  } catch {
    nowIST = nowLocal;
  }

  const candidateDates = [
    { month: nowLocal.getMonth() + 1, day: nowLocal.getDate() },
    { month: nowIST.getMonth() + 1, day: nowIST.getDate() }
  ];

  let targetMonth = -1;
  let targetDay = -1;

  // Format 1: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    targetMonth = parseInt(ymdMatch[2], 10);
    targetDay = parseInt(ymdMatch[3], 10);
  }

  // Format 2: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  if (targetMonth === -1) {
    const dmyMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmyMatch) {
      targetDay = parseInt(dmyMatch[1], 10);
      targetMonth = parseInt(dmyMatch[2], 10);
    }
  }

  // Format 3: General Date parsing (e.g. 15 Jan 1990)
  if (targetMonth === -1) {
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      targetMonth = parsed.getMonth() + 1;
      targetDay = parsed.getDate();
    }
  }

  if (targetMonth === -1 || targetDay === -1) {
    return false;
  }

  // Check if targetDay and targetMonth match either local time or Indian time today
  return candidateDates.some(c => c.month === targetMonth && c.day === targetDay);
}

/**
 * Resolves the genuine external email address for an employee.
 * Filters out internal fake domains like '@employee.billedapp.com'.
 */
export function resolveEmployeeRealEmail(profile: EmployeeProfile): string {
  if (!profile) return '';

  const isReal = (email?: string) => {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    return clean.includes('@') && !clean.endsWith('@employee.billedapp.com') && !clean.includes('example.com');
  };

  if (isReal(profile.registeredEmail)) {
    return profile.registeredEmail!.trim().toLowerCase();
  }
  if (isReal(profile.email)) {
    return profile.email.trim().toLowerCase();
  }
  if (isReal(profile.companyEmail)) {
    return profile.companyEmail!.trim().toLowerCase();
  }

  return '';
}

/**
 * Checks if any PME record is due (e.g. nextDueDate is today, in the past, or within 30 days).
 */
export function getActivePmeDueStatus(pmeRecords?: PmeRecord[]): {
  isDue: boolean;
  dueDate?: string;
  memoNo?: string;
  medicalCategory?: string;
  daysRemaining?: number;
  record?: PmeRecord;
} {
  if (!pmeRecords || pmeRecords.length === 0) {
    return { isDue: false };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const record of pmeRecords) {
    const targetDueDate = record.dueDate || record.nextDueDate;
    if (!targetDueDate) continue;
    const dueDate = new Date(targetDueDate);
    if (isNaN(dueDate.getTime())) continue;
    dueDate.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    // If due date has passed or is upcoming within 30 days
    if (diffDays <= 30) {
      return {
        isDue: true,
        dueDate: targetDueDate,
        memoNo: record.memoNo || record.certificateNo,
        medicalCategory: record.medicalCategory,
        daysRemaining: diffDays,
        record
      };
    }
  }

  return { isDue: false };
}

/**
 * Checks and triggers automated notifications and emails for the employee:
 * 1. PME Due alert to their account and email
 * 2. Birthday Celebration alert & Official Certificate to their account and email
 */
export async function checkAndTriggerPmeAndBirthdayForUser(
  userUid: string,
  profile: EmployeeProfile,
  options?: { forceBirthdayWish?: boolean }
) {
  if (!userUid || !profile) return;

  const currentYear = new Date().getFullYear();
  const todayStr = new Date().toISOString().split('T')[0];
  const empIdentifier = (profile.employeeId || profile.id || userUid || '').trim();
  const realEmail = resolveEmployeeRealEmail(profile);

  // =========================================================================
  // 1. PME DUE CHECK & AUTO NOTIFICATION / EMAIL
  // =========================================================================
  const pmeStatus = getActivePmeDueStatus(profile.pmeRecords);
  if (pmeStatus.isDue && pmeStatus.dueDate) {
    const pmeStorageKey = `pme_alert_sent_${empIdentifier || userUid}_${pmeStatus.dueDate}`;
    const alreadyTriggeredLocal = localStorage.getItem(pmeStorageKey);

    if (!alreadyTriggeredLocal) {
      try {
        // Query Firestore to avoid duplicate notifications
        const notifQuery = query(
          collection(db, 'notifications'),
          where('type', '==', 'pme_due'),
          where('pmeDueDate', '==', pmeStatus.dueDate)
        );
        const existingDocs = await getDocs(notifQuery);
        const alreadyInDb = existingDocs.docs.some(docSnap => {
          const d = docSnap.data();
          return d.uid === userUid || d.employeeId === empIdentifier || (realEmail && d.email === realEmail);
        });

        if (!alreadyInDb) {
          // 1. Insert in Notifications for the employee
          await addDoc(collection(db, 'notifications'), {
            uid: userUid,
            targetEmployeeId: empIdentifier,
            employeeId: empIdentifier,
            title: `🏥 PME Due Alert (आवधिक चिकित्सा परीक्षा सूचना)`,
            message: `Dear ${profile.name || 'Officer'}, your Periodic Medical Examination (PME) is due on ${pmeStatus.dueDate} (Medical Category: ${pmeStatus.medicalCategory || 'Operating Fit'}). Please report to Railway Hospital.`,
            type: 'pme_due',
            pmeDueDate: pmeStatus.dueDate,
            createdAt: new Date().toISOString(),
            read: false,
            email: realEmail || profile.email || '',
            targetEmail: realEmail || profile.email || ''
          });

          // 2. Dispatch Email to the employee
          if (realEmail) {
            await sendPmeDueEmail({
              empName: profile.name,
              empEmail: realEmail,
              dueDate: pmeStatus.dueDate,
              medicalCategory: pmeStatus.medicalCategory,
              memoNo: pmeStatus.memoNo,
              designation: profile.designation,
              machineName: profile.machineName,
              photoUrl: profile.photoUrl
            });
          }

          localStorage.setItem(pmeStorageKey, todayStr);
        } else {
          localStorage.setItem(pmeStorageKey, todayStr);
        }
      } catch (err) {
        console.error('Error triggering PME notification/email:', err);
      }
    }
  }

  // =========================================================================
  // 2. BIRTHDAY CHECK & AUTO NOTIFICATION / EMAIL WITH CERTIFICATE
  // =========================================================================
  if (profile.dob && isBirthdayToday(profile.dob)) {
    const bdayStorageKey = `birthday_sent_${empIdentifier || userUid}_${currentYear}`;
    const alreadySentTodayLocal = localStorage.getItem(bdayStorageKey);

    // If not forced and already sent locally, skip to avoid spam
    if (!options?.forceBirthdayWish && alreadySentTodayLocal === todayStr) {
      return;
    }

    try {
      // Check persistent Firestore document: birthday_wishes/{empIdentifier}_{currentYear}
      const wishDocId = `${empIdentifier || userUid}_${currentYear}`;
      const wishRef = doc(db, 'birthday_wishes', wishDocId);
      const wishSnap = await getDoc(wishRef);

      const alreadyDispatchedInDb = wishSnap.exists();

      if (!alreadyDispatchedInDb || options?.forceBirthdayWish) {
        // 1. Dispatch Email with Certificate and Photo to the employee's genuine email
        let emailSuccess = false;
        let lastErr: string | undefined;

        if (realEmail) {
          const emailRes = await sendBirthdayEmailWithCertificate({
            empName: profile.name,
            empEmail: realEmail,
            dob: profile.dob,
            designation: profile.designation,
            machineName: profile.machineName,
            division: profile.division,
            zone: profile.zone,
            photoUrl: profile.photoUrl,
            companyName: profile.companyName
          });
          emailSuccess = emailRes.success;
          lastErr = emailRes.error;
        } else {
          console.warn(`[Birthday Notice] Employee ${profile.name} (${empIdentifier}) has no real email configured.`);
        }

        // 2. Persist wish in birthday_wishes collection for audit and duplicate prevention
        await setDoc(wishRef, {
          empIdentifier,
          userUid,
          employeeName: profile.name || '',
          dob: profile.dob,
          celebrationYear: currentYear,
          celebrationDate: todayStr,
          sentEmail: realEmail || '',
          emailDelivered: emailSuccess,
          emailError: lastErr || null,
          deliveredAt: new Date().toISOString()
        }, { merge: true });

        // 3. Create or ensure Birthday Celebration Notification in employee's account
        const bdayNotifQuery = query(
          collection(db, 'notifications'),
          where('type', '==', 'birthday'),
          where('celebrationYear', '==', currentYear)
        );
        const existingBdayDocs = await getDocs(bdayNotifQuery);
        const hasNotif = existingBdayDocs.docs.some(docSnap => {
          const d = docSnap.data();
          return d.uid === userUid || d.employeeId === empIdentifier || (realEmail && d.email === realEmail);
        });

        if (!hasNotif) {
          await addDoc(collection(db, 'notifications'), {
            uid: userUid,
            targetEmployeeId: empIdentifier,
            employeeId: empIdentifier,
            title: `🎉 Happy Birthday, ${profile.name || 'Friend'}! (जन्मदिन की हार्दिक शुभकामनाएं)`,
            message: `Indian Railways & RMMS wish you a joyful Birthday! An official Birthday Celebration Certificate with your photograph has been generated in your account${realEmail ? ` and sent to your email (${realEmail})` : ''}.`,
            type: 'birthday',
            celebrationYear: currentYear,
            celebrationDate: todayStr,
            isBirthdayCelebration: true,
            createdAt: new Date().toISOString(),
            read: false,
            email: realEmail || profile.email || '',
            targetEmail: realEmail || profile.email || '',
            photoUrl: profile.photoUrl || '',
            designation: profile.designation || '',
            machineName: profile.machineName || '',
            division: profile.division || '',
            zone: profile.zone || ''
          });
        }

        localStorage.setItem(bdayStorageKey, todayStr);
      } else {
        localStorage.setItem(bdayStorageKey, todayStr);
      }
    } catch (err) {
      console.error('Error triggering Birthday notification/email:', err);
    }
  }
}

/**
 * Manually sends or resends the employee's Birthday Celebration Certificate to their email.
 */
export async function sendEmployeeBirthdayCertificateNow(
  profile: EmployeeProfile
): Promise<{ success: boolean; message: string; email?: string }> {
  if (!profile) {
    return { success: false, message: 'Employee profile not provided.' };
  }

  const realEmail = resolveEmployeeRealEmail(profile);
  if (!realEmail) {
    return {
      success: false,
      message: 'No valid registered email address found in profile. Please update email first.'
    };
  }

  try {
    const res = await sendBirthdayEmailWithCertificate({
      empName: profile.name,
      empEmail: realEmail,
      dob: profile.dob || '',
      designation: profile.designation,
      machineName: profile.machineName,
      division: profile.division,
      zone: profile.zone,
      photoUrl: profile.photoUrl,
      companyName: profile.companyName
    });

    if (res.success) {
      return {
        success: true,
        message: `Birthday Certificate sent successfully to ${realEmail}!`,
        email: realEmail
      };
    } else {
      return {
        success: false,
        message: res.error || 'Failed to dispatch email. Please check SMTP settings.',
        email: realEmail
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Error occurred while sending certificate email.',
      email: realEmail
    };
  }
}

/**
 * Background routine to scan all employees and trigger PME and Birthday alerts.
 * Runs on application mount for all authenticated sessions.
 */
export async function scanAllEmployeesForBirthdayAndPme(force = false) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const lastScanKey = `rmms_last_bday_pme_scan`;
    const lastScan = localStorage.getItem(lastScanKey);

    // Scan once per calendar day per browser session unless force is true
    if (!force && lastScan === todayStr) {
      return;
    }

    const empSnapshot = await getDocs(collection(db, 'employees'));
    if (empSnapshot.empty) return;

    for (const empDoc of empSnapshot.docs) {
      const empData = empDoc.data() as EmployeeProfile;
      const targetUid = empData.id || empDoc.id;
      if (empData.status !== 'left') {
        await checkAndTriggerPmeAndBirthdayForUser(targetUid, {
          ...empData,
          id: empDoc.id,
          employeeId: empData.employeeId || empDoc.id
        });
      }
    }

    localStorage.setItem(lastScanKey, todayStr);
  } catch (err) {
    console.warn('Scan all employees for birthday/pme warning:', err);
  }
}
