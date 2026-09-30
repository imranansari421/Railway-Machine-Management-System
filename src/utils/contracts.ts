import { collection, query, where, getDocs, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

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

export interface MachineContractResolution {
  machineName: string;
  companyName: string;
  contract: MachineContract | null;
  status: 'active' | 'transferred' | 'expired' | 'unassigned';
  isExpired: boolean;
  isTransferred: boolean;
  contractNo: string;
  transferredToCompany?: string;
  transferDate?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Get current date string formatted as YYYY-MM-DD
 */
export function getTodayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse date string from various formats (YYYY-MM-DD, DD-MM-YYYY, ISO)
 */
export function parseContractDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (!s) return null;

  // DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(s)) {
    const parts = s.split(/[-/]/);
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM-DD or standard ISO
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) {
    const parts = s.split(/[-/]/);
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2].slice(0, 2), 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Check if a contract has expired based on status or endDate
 */
export function isContractExpired(contract: { status?: string; endDate?: string }): boolean {
  if (!contract) return false;
  if (contract.status === 'expired') return true;
  if (!contract.endDate) return false;

  const endD = parseContractDate(contract.endDate);
  if (!endD) return false;

  // Start of today (local time)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // End of contract expiration date (23:59:59.999)
  const endOfDay = new Date(endD);
  endOfDay.setHours(23, 59, 59, 999);

  return endOfDay.getTime() < today.getTime();
}

/**
 * Get the effective computed status of a contract
 */
export function getEffectiveContractStatus(contract: MachineContract): 'active' | 'transferred' | 'expired' {
  if (contract.status === 'transferred') return 'transferred';
  if (contract.status === 'expired' || isContractExpired(contract)) return 'expired';
  return 'active';
}

/**
 * Resolve the effective contract and company for a machine from a list of all contracts.
 * Handles:
 * 1. Active valid contracts (endDate >= today)
 * 2. Transferred contracts (assigned to transferredToCompany or new contract)
 * 3. Expired contracts (time finished)
 */
export function resolveMachineContract(
  machineName: string,
  contracts: MachineContract[]
): MachineContractResolution {
  const cleanName = (machineName || '').trim().toLowerCase();
  if (!cleanName) {
    return {
      machineName: '',
      companyName: '',
      contract: null,
      status: 'unassigned',
      isExpired: false,
      isTransferred: false,
      contractNo: ''
    };
  }

  // Filter all contracts matching this machine name
  const machineContracts = contracts.filter(
    c => (c.machineName || '').trim().toLowerCase() === cleanName
  );

  if (machineContracts.length === 0) {
    return {
      machineName,
      companyName: '',
      contract: null,
      status: 'unassigned',
      isExpired: false,
      isTransferred: false,
      contractNo: ''
    };
  }

  // Sort contracts by date descending (latest first)
  const sorted = [...machineContracts].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || a.startDate || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || b.startDate || 0).getTime();
    return timeB - timeA;
  });

  // 1. Look for currently active, non-expired contracts first
  const activeContract = sorted.find(c => getEffectiveContractStatus(c) === 'active');
  if (activeContract) {
    return {
      machineName: activeContract.machineName,
      companyName: activeContract.companyName,
      contract: activeContract,
      status: 'active',
      isExpired: false,
      isTransferred: false,
      contractNo: activeContract.contractNo,
      startDate: activeContract.startDate,
      endDate: activeContract.endDate
    };
  }

  // 2. If no active contract, check if latest contract is transferred
  const transferredContract = sorted.find(c => c.status === 'transferred' || !!c.transferredToCompany);
  if (transferredContract) {
    const targetCompany = transferredContract.transferredToCompany || transferredContract.companyName;
    return {
      machineName: transferredContract.machineName,
      companyName: targetCompany,
      contract: transferredContract,
      status: 'transferred',
      isExpired: false,
      isTransferred: true,
      transferredToCompany: targetCompany,
      transferDate: transferredContract.transferDate,
      contractNo: transferredContract.contractNo,
      startDate: transferredContract.startDate,
      endDate: transferredContract.endDate
    };
  }

  // 3. Otherwise, the machine's contract has expired (time finished)
  const latestContract = sorted[0];
  return {
    machineName: latestContract.machineName,
    companyName: latestContract.companyName,
    contract: latestContract,
    status: 'expired',
    isExpired: true,
    isTransferred: false,
    contractNo: latestContract.contractNo,
    startDate: latestContract.startDate,
    endDate: latestContract.endDate
  };
}

/**
 * Build a lookup map of all machines from contracts:
 * machineName -> MachineContractResolution
 */
export function buildMachineContractsMapping(
  contracts: MachineContract[]
): Record<string, MachineContractResolution> {
  const map: Record<string, MachineContractResolution> = {};
  const uniqueMachines = Array.from(
    new Set(contracts.map(c => (c.machineName || '').trim()).filter(Boolean))
  );

  uniqueMachines.forEach(m => {
    map[m.toLowerCase()] = resolveMachineContract(m, contracts);
    map[m] = map[m.toLowerCase()];
  });

  return map;
}

/**
 * Fetch all contracts for a specific machine name from Firestore
 */
export async function getContractsForMachine(machineName: string): Promise<MachineContract[]> {
  if (!machineName) return [];
  try {
    const q = query(
      collection(db, 'machine_contracts'),
      where('machineName', '==', machineName.trim())
    );
    const snap = await getDocs(q);
    const list: MachineContract[] = [];
    snap.forEach(d => {
      list.push({ id: d.id, ...d.data() } as MachineContract);
    });
    return list;
  } catch (err) {
    console.error(`Error fetching contracts for machine ${machineName}:`, err);
    return [];
  }
}

/**
 * Fetch the active or most relevant contract for a specific machine name
 */
export async function getActiveContractForMachine(machineName: string): Promise<MachineContract | null> {
  if (!machineName) return null;
  try {
    const contracts = await getContractsForMachine(machineName);
    const resolved = resolveMachineContract(machineName, contracts);
    return resolved.contract;
  } catch (err) {
    console.error(`Error resolving active contract for machine ${machineName}:`, err);
    return null;
  }
}

/**
 * Get company name automatically associated with a machine from machine_contracts.
 * Correctly accounts for:
 * - Current active contract company
 * - Transferred company (if transferred to another company)
 * - Expired contract's company (if time finished)
 */
export async function getCompanyByMachine(machineName: string): Promise<string> {
  if (!machineName) return '';
  try {
    const contracts = await getContractsForMachine(machineName);
    const resolved = resolveMachineContract(machineName, contracts);
    return resolved.companyName;
  } catch (err) {
    console.error(`Error getting company for machine ${machineName}:`, err);
    return '';
  }
}

/**
 * Get full contract status information for a machine
 */
export async function getMachineContractInfo(machineName: string): Promise<MachineContractResolution> {
  if (!machineName) {
    return {
      machineName: '',
      companyName: '',
      contract: null,
      status: 'unassigned',
      isExpired: false,
      isTransferred: false,
      contractNo: ''
    };
  }
  const contracts = await getContractsForMachine(machineName);
  return resolveMachineContract(machineName, contracts);
}

/**
 * Check if a machine is currently assigned under an active contract to a company
 */
export async function isMachineAssignedToCompany(
  machineName: string,
  targetCompany?: string
): Promise<{ assigned: boolean; companyName?: string; contractNo?: string; status?: string; isExpired?: boolean }> {
  const info = await getMachineContractInfo(machineName);
  if (info.contract && info.companyName) {
    const isTarget = targetCompany ? info.companyName.toLowerCase() === targetCompany.toLowerCase() : true;
    return {
      assigned: !info.isExpired && isTarget,
      companyName: info.companyName,
      contractNo: info.contractNo,
      status: info.status,
      isExpired: info.isExpired
    };
  }
  return { assigned: false };
}

/**
 * Synchronize expired contracts in Firestore (set status='expired' if endDate < today)
 */
export async function syncExpiredContractsInFirestore(contractsList?: MachineContract[]): Promise<number> {
  try {
    let toCheck = contractsList;
    if (!toCheck) {
      const snap = await getDocs(collection(db, 'machine_contracts'));
      toCheck = snap.docs.map(d => ({ id: d.id, ...d.data() } as MachineContract));
    }

    const todayStr = getTodayDateStr();
    let updatedCount = 0;

    for (const c of toCheck) {
      if (c.id && c.status === 'active' && isContractExpired(c)) {
        try {
          await updateDoc(doc(db, 'machine_contracts', c.id), {
            status: 'expired',
            updatedAt: new Date().toISOString()
          });
          updatedCount++;
        } catch (updateErr) {
          console.warn(`Failed to update expired status for contract ${c.id}:`, updateErr);
        }
      }
    }

    return updatedCount;
  } catch (err) {
    console.error('Error syncing expired contracts:', err);
    return 0;
  }
}
