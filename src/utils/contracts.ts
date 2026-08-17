import { collection, query, where, getDocs, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from './firestore-errors';

export interface MachineContract {
  id?: string;
  contractNo: string;
  machineName: string;
  companyName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  status: 'active' | 'transferred' | 'expired';
  transferredToCompany?: string;
  transferDate?: string;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch the active contract for a specific machine name
 */
export async function getActiveContractForMachine(machineName: string): Promise<MachineContract | null> {
  if (!machineName) return null;
  try {
    const q = query(
      collection(db, 'machine_contracts'),
      where('machineName', '==', machineName.trim()),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data() } as MachineContract;
    }
    return null;
  } catch (err) {
    console.error(`Error fetching active contract for machine ${machineName}:`, err);
    return null;
  }
}

/**
 * Get company name automatically associated with a machine
 */
export async function getCompanyByMachine(machineName: string): Promise<string> {
  const contract = await getActiveContractForMachine(machineName);
  return contract ? contract.companyName : '';
}

/**
 * Check if a machine is currently assigned under an active contract to a company
 */
export async function isMachineAssignedToCompany(machineName: string, targetCompany?: string): Promise<{ assigned: boolean; companyName?: string; contractNo?: string }> {
  const contract = await getActiveContractForMachine(machineName);
  if (contract) {
    if (targetCompany && contract.companyName === targetCompany) {
      return { assigned: true, companyName: contract.companyName, contractNo: contract.contractNo };
    }
    return { assigned: true, companyName: contract.companyName, contractNo: contract.contractNo };
  }
  return { assigned: false };
}
