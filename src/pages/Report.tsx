import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { findEmployeeForUser, getFilterAccessPermissions, FilterAccessPermissions } from '../utils/employee';
import { cn } from '../lib/utils';
import {
  FileText,
  Mail,
  Users,
  CalendarClock,
  Wrench,
  ArrowRightLeft,
  AlertTriangle,
  Share2,
  ClipboardCheck,
  Boxes,
  Droplet,
  UserCheck,
} from 'lucide-react';
import InboxReportView from '../components/reports/InboxReportView';
import HRReportView from '../components/reports/HRReportView';
import ContractsReportView from '../components/reports/ContractsReportView';
import MaintenanceReportView from '../components/reports/MaintenanceReportView';
import MachineMovementReportView from '../components/reports/MachineMovementReportView';
import BreakdownReportView from '../components/reports/BreakdownReportView';
import IssueReportView from '../components/reports/IssueReportView';
import AccountalReportView from '../components/reports/AccountalReportView';
import UnconnectedMaterialReportView from '../components/reports/UnconnectedMaterialReportView';
import ConsumptionReportView from '../components/reports/ConsumptionReportView';
import ServiceEngineerReportView from '../components/reports/ServiceEngineerReportView';

export type ReportTabId =
  | 'inbox'
  | 'hr'
  | 'contracts'
  | 'maintenance'
  | 'machine-movement'
  | 'break-down'
  | 'issue'
  | 'accountal'
  | 'unconnected-material'
  | 'consumption'
  | 'service-engineer';

interface TabDefinition {
  id: ReportTabId;
  label: string;
  icon: any;
  description: string;
}

const REPORT_TABS: TabDefinition[] = [
  {
    id: 'inbox',
    label: 'Inbox Report',
    icon: Mail,
    description: 'Employee profile requests, approvals, returns & audit history',
  },
  {
    id: 'hr',
    label: 'HR Report',
    icon: Users,
    description: 'All, current & left employees machine-wise',
  },
  {
    id: 'contracts',
    label: 'Machine Contracts Report',
    icon: CalendarClock,
    description: 'Company machine assignments, transfers & renewals',
  },
  {
    id: 'maintenance',
    label: 'Maintenance Report',
    icon: Wrench,
    description: 'Complete maintenance & servicing records',
  },
  {
    id: 'machine-movement',
    label: 'Machine Movement Report',
    icon: ArrowRightLeft,
    description: 'Machine movements & transit records',
  },
  {
    id: 'break-down',
    label: 'Break Down / Failure Report',
    icon: AlertTriangle,
    description: 'Breakdown stoppages & corrective logs',
  },
  {
    id: 'issue',
    label: 'Issue Report',
    icon: Share2,
    description: 'Items and spares issued against requisitions',
  },
  {
    id: 'accountal',
    label: 'Accountal Report',
    icon: ClipboardCheck,
    description: 'Items received and accounted for in stock',
  },
  {
    id: 'unconnected-material',
    label: 'Unconnected Material Report',
    icon: Boxes,
    description: 'Surplus, returned & unconnected material receipts',
  },
  {
    id: 'consumption',
    label: 'Consumption Report',
    icon: Droplet,
    description: 'Machine HSD fuel consumption logs, balances & engine hours registry',
  },
  {
    id: 'service-engineer',
    label: 'Services Engineer Report',
    icon: UserCheck,
    description: 'Logged services engineer visit histories & technical inspection reports',
  },
];

export default function Report() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTabParam = (searchParams.get('tab') || 'inbox').toLowerCase();
  const normalizedTab =
    rawTabParam === 'breakdown' ||
    rawTabParam === 'break_down' ||
    rawTabParam === 'break-down' ||
    rawTabParam === 'failure'
      ? 'break-down'
      : rawTabParam === 'movement' ||
        rawTabParam === 'machinemovement' ||
        rawTabParam === 'machine_movement'
      ? 'machine-movement'
      : rawTabParam === 'unconnected' ||
        rawTabParam === 'unconnected_material' ||
        rawTabParam === 'unconnected-receipts' ||
        rawTabParam === 'unconnected-material-report'
      ? 'unconnected-material'
      : rawTabParam === 'consumption' ||
        rawTabParam === 'fuel' ||
        rawTabParam === 'hsd'
      ? 'consumption'
      : rawTabParam === 'service-engineer' ||
        rawTabParam === 'service_engineer' ||
        rawTabParam === 'services-engineer' ||
        rawTabParam === 'services_engineer' ||
        rawTabParam === 'service' ||
        rawTabParam === 'engineer'
      ? 'service-engineer'
      : rawTabParam;

  const activeTab: ReportTabId = REPORT_TABS.some(t => t.id === normalizedTab) ? (normalizedTab as ReportTabId) : 'inbox';

  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [isEmployee, setIsEmployee] = useState(() => {
    return Boolean(auth.currentUser?.email?.endsWith('@employee.billedapp.com'));
  });
  const [userAccessType, setUserAccessType] = useState(() => {
    return localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
  });
  const [employeeProfile, setEmployeeProfile] = useState<any>(null);

  const [userMachine, setUserMachine] = useState(() => {
    return (auth.currentUser ? localStorage.getItem(`userMachineName_${auth.currentUser.uid}`) : '') || '';
  });
  const [userCompany, setUserCompany] = useState(() => {
    return (auth.currentUser ? localStorage.getItem(`userCompanyName_${auth.currentUser.uid}`) : '') || '';
  });
  const [userZone, setUserZone] = useState(() => {
    return (auth.currentUser ? localStorage.getItem(`userZone_${auth.currentUser.uid}`) : '') || '';
  });
  const [userDivision, setUserDivision] = useState(() => {
    return (auth.currentUser ? localStorage.getItem(`userDivision_${auth.currentUser.uid}`) : '') || '';
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        const emp = user.email?.endsWith('@employee.billedapp.com') || false;
        setIsEmployee(emp);
        const access = localStorage.getItem(`accessType_${user.uid}`) || 'limited';
        setUserAccessType(access);

        const prof = await findEmployeeForUser(user.uid, user.email);
        if (prof) {
          setEmployeeProfile(prof);
          if (prof.machineName) setUserMachine(prof.machineName);
          if (prof.companyName) setUserCompany(prof.companyName);
          if (prof.zone) setUserZone(prof.zone);
          if (prof.division) setUserDivision(prof.division);
        }
      }
    });
    return () => unsubAuth();
  }, []);

  const filterPerms: FilterAccessPermissions = getFilterAccessPermissions(
    isEmployee,
    userAccessType,
    employeeProfile,
    {
      machineName: userMachine,
      zone: userZone,
      division: userDivision,
    }
  );

  const activeTabDef = REPORT_TABS.find(t => t.id === activeTab) || REPORT_TABS[0];
  const ActiveIcon = activeTabDef.icon;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <ActiveIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-white uppercase">
                {activeTabDef.label}
              </h1>
              <p className="text-slate-400 text-xs mt-0.5">
                {activeTabDef.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Report View Body */}
      <div>
        {activeTab === 'inbox' && (
          <InboxReportView
            userCompany={userCompany}
            userMachine={userMachine}
            isFullAdmin={filterPerms.isFullAdmin}
            currentUser={currentUser}
            currentEmployee={employeeProfile}
          />
        )}

        {activeTab === 'hr' && (
          <HRReportView
            filterPerms={filterPerms}
            userCompany={userCompany}
            userMachine={userMachine}
            userZone={userZone}
            userDivision={userDivision}
          />
        )}

        {activeTab === 'contracts' && (
          <ContractsReportView
            filterPerms={filterPerms}
            userCompany={userCompany}
            userMachine={userMachine}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceReportView
            filterPerms={filterPerms}
            userMachine={userMachine}
            userCompany={userCompany}
          />
        )}

        {activeTab === 'machine-movement' && (
          <MachineMovementReportView
            filterPerms={filterPerms}
            userMachine={userMachine}
            userZone={userZone}
            userDivision={userDivision}
          />
        )}

        {activeTab === 'break-down' && (
          <BreakdownReportView
            filterPerms={filterPerms}
            userMachine={userMachine}
          />
        )}

        {activeTab === 'issue' && (
          <IssueReportView
            filterPerms={filterPerms}
            userCompany={userCompany}
            userMachine={userMachine}
            userZone={userZone}
            userDivision={userDivision}
            userAccessType={userAccessType}
          />
        )}

        {activeTab === 'accountal' && (
          <AccountalReportView
            filterPerms={filterPerms}
            userCompany={userCompany}
            userMachine={userMachine}
          />
        )}

        {activeTab === 'unconnected-material' && (
          <UnconnectedMaterialReportView
            filterPerms={filterPerms}
            userCompany={userCompany}
            userMachine={userMachine}
            userZone={userZone}
            userDivision={userDivision}
          />
        )}

        {activeTab === 'consumption' && (
          <ConsumptionReportView
            filterPerms={filterPerms}
            userMachine={userMachine}
            userCompany={userCompany}
            userZone={userZone}
            userDivision={userDivision}
          />
        )}

        {activeTab === 'service-engineer' && (
          <ServiceEngineerReportView
            filterPerms={filterPerms}
            userMachine={userMachine}
            userCompany={userCompany}
            userZone={userZone}
            userDivision={userDivision}
          />
        )}
      </div>
    </div>
  );
}
