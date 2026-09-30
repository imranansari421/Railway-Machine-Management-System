import { collection, doc, getDoc, setDoc, deleteDoc, addDoc, writeBatch, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { formatCreatorName } from './employee';

export interface DeletedRecord {
  id: string;
  originalCollection: string;
  originalId: string;
  data: any;
  moduleName: string;
  itemSummary: string;
  machineName?: string;
  companyName?: string;
  deletedAt: string;
  deletedByUid: string;
  deletedByName: string;
  deletedByEmail: string;
  deletedByRole: string;
}

export interface ArchiveOptions {
  originalCollection: string;
  originalId: string;
  data?: any;
  moduleName: string;
  itemSummary?: string;
  machineName?: string;
  companyName?: string;
  user?: any;
}

/**
 * Archives a record into the 'deleted_records' collection (Recycle Bin) before or during deletion.
 */
export async function archiveDeletedRecord(options: ArchiveOptions): Promise<string> {
  try {
    const { originalCollection, originalId, moduleName } = options;
    let data = options.data;

    // If data was not supplied, try to fetch it before it's deleted
    if (!data) {
      try {
        const snap = await getDoc(doc(db, originalCollection, originalId));
        if (snap.exists()) {
          data = snap.data();
        }
      } catch (e) {
        console.warn("Could not fetch document before archiving:", e);
      }
    }

    if (!data) {
      data = {};
    }

    const currentUser = options.user || auth.currentUser;
    const uid = currentUser?.uid || '';
    const email = currentUser?.email || '';

    // Determine user role and name cleanly
    let role = 'Master Admin';
    if (email.endsWith('@employee.billedapp.com')) {
      const savedRole = localStorage.getItem(`accessType_${uid}`);
      if (savedRole === 'admin-light') role = 'Company Admin';
      else if (savedRole === 'zonal-admin') role = 'Zonal Admin';
      else if (savedRole === 'divisional-admin') role = 'Divisional Admin';
      else if (savedRole === 'full') role = 'Full Admin (Employee)';
      else role = 'Employee';
    } else {
      role = 'Primary Admin';
    }

    let rawName = currentUser?.displayName || localStorage.getItem(`employeeName_${uid}`) || email.split('@')[0] || 'Admin';
    const deletedByName = formatCreatorName(rawName);

    const machineName = options.machineName || data.machineName || data.requestingMachineName || '';
    const companyName = options.companyName || data.companyName || data.createdByCompanyName || '';

    let itemSummary = options.itemSummary;
    if (!itemSummary) {
      // Generate intelligent fallback summary based on data fields
      if (data.plNo || data.partNo) {
        itemSummary = `Part: ${data.plNo || data.partNo} - ${data.description || 'Item'}`;
      } else if (data.date && (data.sections || data.attendedBy)) {
        itemSummary = `Maintenance: ${machineName || 'Machine'} (${data.date}) - ${data.attendedBy || 'Attended'}`;
      } else if (data.breakdownSection || data.breakdownReason) {
        itemSummary = `Breakdown: ${machineName || 'Machine'} - ${data.breakdownSection || data.breakdownReason || 'Failure'}`;
      } else if (data.engineerName) {
        itemSummary = `Service Engineer: ${data.engineerName} (${data.engineerCompanyName || 'OEM'}) - ${machineName || ''}`;
      } else if (data.fromDate && data.calculatedConsumption !== undefined) {
        itemSummary = `Consumption: ${machineName || ''} (${data.fromDate} to ${data.toDate}) - ${data.calculatedConsumption} L`;
      } else if (data.fromDateTime && (data.toZone || data.toLocation)) {
        itemSummary = `Movement: ${machineName || ''} (${data.fromZone || ''} -> ${data.toZone || ''})`;
      } else if (data.name && data.email && data.designation) {
        itemSummary = `Employee: ${data.name} (${data.designation || 'Staff'}) - PF: ${data.pfNo || 'N/A'}`;
      } else if (data.title && data.contractNumber) {
        itemSummary = `Contract: ${data.title || data.contractNumber} (${machineName || ''})`;
      } else {
        itemSummary = `${moduleName} Record (ID: ${originalId.substring(0, 8)}...)`;
      }
    }

    const archiveDoc = {
      originalCollection,
      originalId,
      data,
      moduleName,
      itemSummary,
      machineName: machineName || '',
      companyName: companyName || '',
      deletedAt: new Date().toISOString(),
      deletedByUid: uid,
      deletedByName,
      deletedByEmail: email,
      deletedByRole: role
    };

    const docRef = await addDoc(collection(db, 'deleted_records'), archiveDoc);
    return docRef.id;
  } catch (error) {
    console.error("Failed to archive deleted record:", error);
    return '';
  }
}

/**
 * Restores a deleted record back to its original collection.
 */
export async function restoreDeletedRecord(record: DeletedRecord): Promise<void> {
  const { originalCollection, originalId, data, id } = record;
  
  // 1. Check if this is an employee sub-record (PME or Award)
  if (data?.isSubRecord && data?.subRecordType && originalCollection === 'employees') {
    const empRef = doc(db, 'employees', originalId);
    const empSnap = await getDoc(empRef);
    if (empSnap.exists()) {
      const empData = empSnap.data();
      const sub = data.subRecord;
      if (data.subRecordType === 'pme') {
        const existing = empData.pmeRecords || [];
        const updated = [sub, ...existing.filter((r: any) => r.id !== sub.id)];
        const deletedExisting = (empData.deletedSubRecords || []).filter((r: any) => r.id !== sub.id);
        await setDoc(empRef, { pmeRecords: updated, deletedSubRecords: deletedExisting }, { merge: true });
      } else if (data.subRecordType === 'award') {
        const existing = empData.awards || [];
        const updated = [sub, ...existing.filter((r: any) => r.id !== sub.id)];
        const deletedExisting = (empData.deletedSubRecords || []).filter((r: any) => r.id !== sub.id);
        await setDoc(empRef, { awards: updated, deletedSubRecords: deletedExisting }, { merge: true });
      }
    }
  } else {
    // Standard full document restore
    await setDoc(doc(db, originalCollection, originalId), data);
  }

  // 2. Remove it from the recycle bin
  await deleteDoc(doc(db, 'deleted_records', id));
}

/**
 * Permanently deletes an archived record from the recycle bin.
 */
export async function permanentDeleteRecord(recordId: string): Promise<void> {
  await deleteDoc(doc(db, 'deleted_records', recordId));
}

/**
 * Completely empties the recycle bin (Master Admin only).
 */
export async function emptyRecycleBin(): Promise<number> {
  const snap = await getDocs(collection(db, 'deleted_records'));
  const batch = writeBatch(db);
  let count = 0;
  snap.forEach((d) => {
    batch.delete(d.ref);
    count++;
  });
  if (count > 0) {
    await batch.commit();
  }
  return count;
}
