import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export interface EmailDispatchOptions {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

/**
 * Dispatches a single email using the Backend SMTP Server, or fallback to Brevo/Resend/Web3Forms/EmailJS.
 */
export async function sendEmailNotification(options: EmailDispatchOptions): Promise<{ success: boolean; provider?: string; error?: string }> {
  const { toEmail, toName, subject, htmlContent, textContent } = options;

  if (!toEmail || !toEmail.includes('@') || toEmail.endsWith('@employee.billedapp.com')) {
    return { success: false, error: 'Invalid or dummy recipient email' };
  }

  // 1. Primary: Server-side SMTP Gateway
  try {
    const res = await fetchWithTimeout('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toEmail,
        toName: toName || 'User',
        subject,
        htmlContent,
        textContent: textContent || subject
      })
    }, 20000);

    if (res.ok) {
      const data = await res.json();
      if (data.delivered || data.success) {
        return { success: true, provider: 'SMTP Gateway' };
      }
    }
  } catch (err) {
    console.warn('[SMTP Single Email Dispatch Failed, trying Firestore fallback gateways]', err);
  }

  // 2. Fallback: Settings General Email Gateway
  try {
    const snap = await getDoc(doc(db, 'settings', 'general'));
    const gateway = snap.exists() ? snap.data().emailGateway || {} : {};

    const senderName = gateway.senderName?.trim() || 'Railway Machine Management System';
    const senderEmail = (gateway.senderEmail?.trim() && gateway.senderEmail.includes('@'))
      ? gateway.senderEmail.trim()
      : 'noreply@railway-portal.com';

    // Brevo fallback
    if (gateway.brevoApiKey && gateway.brevoApiKey.trim()) {
      const bRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': gateway.brevoApiKey.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: toEmail, name: toName || 'User' }],
          subject: subject,
          htmlContent: htmlContent,
          textContent: textContent || subject
        })
      });
      if (bRes.ok) return { success: true, provider: 'Brevo' };
    }

    // Resend fallback
    if (gateway.resendApiKey && gateway.resendApiKey.trim()) {
      const rRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gateway.resendApiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${senderName} <${senderEmail.includes('@') ? senderEmail : 'onboarding@resend.dev'}>`,
          to: [toEmail],
          subject: subject,
          html: htmlContent,
          text: textContent || subject
        })
      });
      if (rRes.ok) return { success: true, provider: 'Resend' };
    }

    // Web3Forms fallback
    if (gateway.web3formsKey && gateway.web3formsKey.trim()) {
      const wRes = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: gateway.web3formsKey.trim(),
          to_email: toEmail,
          subject: subject,
          from_name: senderName,
          message: textContent || subject,
          html_content: htmlContent
        })
      });
      if (wRes.ok) return { success: true, provider: 'Web3Forms' };
    }
  } catch (err) {
    console.warn('[Fallback Gateway Email Dispatch Failed]', err);
  }

  return { success: false, error: 'Could not deliver email through any configured gateway' };
}

/**
 * Dispatches bulk emails to an array of recipients.
 */
export async function sendBulkEmailNotifications(
  recipients: Array<{ email: string; name?: string }>,
  subject: string,
  htmlContent: string,
  textContent?: string
): Promise<{ dispatched: number; total: number }> {
  const validRecipients = recipients.filter(r => 
    r.email && r.email.includes('@') && !r.email.endsWith('@employee.billedapp.com')
  );

  if (validRecipients.length === 0) {
    return { dispatched: 0, total: 0 };
  }

  try {
    const res = await fetchWithTimeout('/api/send-bulk-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: validRecipients,
        subject,
        htmlContent,
        textContent: textContent || subject
      })
    }, 30000);

    if (res.ok) {
      const data = await res.json();
      return { dispatched: data.dispatched || 0, total: validRecipients.length };
    }
  } catch (err) {
    console.warn('[Bulk SMTP API Failed, dispatching individually]', err);
  }

  // Fallback: send individually
  let count = 0;
  for (const r of validRecipients) {
    const res = await sendEmailNotification({
      toEmail: r.email,
      toName: r.name,
      subject,
      htmlContent,
      textContent
    });
    if (res.success) count++;
  }

  return { dispatched: count, total: validRecipients.length };
}

/**
 * Helper to clean names and remove email IDs / internal domain artifacts so email address is NEVER shown in name fields
 */
export function cleanPersonName(nameOrEmail?: string): string {
  if (!nameOrEmail) return 'Administrator';
  let cleaned = nameOrEmail.trim();
  if (cleaned.includes('@')) {
    cleaned = cleaned.split('@')[0];
  }
  cleaned = cleaned.replace(/\.billedapp(\.com)?/gi, '').replace(/@.*$/g, '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'admin' || cleaned.toLowerCase() === 'master' || cleaned.toLowerCase().startsWith('master.')) {
    return 'Master Administrator';
  }
  return cleaned;
}

/**
 * Builds standard RMMS Notification Email Template
 */
export function buildNotificationEmailHtml(params: {
  title: string;
  message: string;
  senderName?: string;
  senderRole?: string;
  targetAudienceLabel?: string;
  companyName?: string;
  machineName?: string;
}): string {
  const { title, message, senderName, senderRole, targetAudienceLabel, companyName, machineName } = params;

  // Strict sanitization: ensure Issued By ONLY contains Name and Designation, NEVER an email address
  const displayName = cleanPersonName(senderName);
  const displayRole = (senderRole && !senderRole.includes('@')) ? senderRole.trim() : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 620px; margin: 0 auto; border-radius: 16px;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 26px 24px; border-radius: 14px 14px 0 0; text-align: center; color: #ffffff; border-bottom: 3px solid #6366f1;">
        <h1 style="margin: 0; font-size: 19px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase;">Indian Railway Management System</h1>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1; font-weight: 500;">Official Portal Announcement & Broadcast</p>
      </div>

      <!-- Main Content -->
      <div style="background-color: #ffffff; padding: 32px 26px; border-radius: 0 0 14px 14px; border: 1px solid #e2e8f0; border-top: none;">
        ${targetAudienceLabel ? `
          <div style="display: inline-block; background-color: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px;">
            Audience: ${targetAudienceLabel}
          </div>
        ` : ''}

        <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 16px 0; line-height: 1.3;">
          ${title}
        </h2>

        <div style="background: #f8fafc; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 18px 20px; margin: 20px 0;">
          <p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-wrap;">
            ${message}
          </p>
        </div>

        <!-- Meta Details -->
        <div style="background: #f1f5f9; border-radius: 10px; padding: 14px 16px; margin: 22px 0; font-size: 12px; color: #475569;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px 0; font-weight: 700; color: #64748b; width: 110px;">Issued By:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #1e293b;">${displayName} ${displayRole ? `(${displayRole})` : ''}</td>
            </tr>
            ${companyName ? `
              <tr>
                <td style="padding: 4px 0; font-weight: 700; color: #64748b;">Company / Unit:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${companyName}</td>
              </tr>
            ` : ''}
            ${machineName && machineName !== 'all' ? `
              <tr>
                <td style="padding: 4px 0; font-weight: 700; color: #64748b;">Machine:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${machineName}</td>
              </tr>
            ` : ''}
            <tr>
              <td style="padding: 4px 0; font-weight: 700; color: #64748b;">Date & Time:</td>
              <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 20px;">
          You are receiving this official alert as an authorized personnel in the Railway Machine Management System.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
          Railway Machine Management System (RMMS) • Automated Notification Service
        </p>
      </div>
    </div>
  `;
}

/**
 * Resolves audience emails and broadcasts notification email to all target employees.
 */
export async function sendNotificationEmailsToAudience(params: {
  title: string;
  message: string;
  notifTargetType: 'all' | 'company' | 'machine' | 'company-machine' | 'employee' | 'division' | string;
  notifTargetCompany?: string;
  notifTargetZone?: string;
  notifTargetDivision?: string;
  notifTargetMachine?: string;
  notifTargetEmployeeId?: string;
  senderName?: string;
  senderRole?: string;
  currentUserAccessType?: string;
  currentUserCompanyName?: string;
  currentUserZone?: string;
  currentUserDivision?: string;
  userMachine?: string;
}): Promise<{ dispatched: number; total: number }> {
  try {
    const {
      title,
      message,
      notifTargetType,
      notifTargetCompany,
      notifTargetZone,
      notifTargetDivision,
      notifTargetMachine,
      notifTargetEmployeeId,
      senderName,
      senderRole,
      currentUserAccessType,
      currentUserCompanyName,
      currentUserZone,
      currentUserDivision,
      userMachine
    } = params;

    // Fetch all employees from Firestore
    const employeesSnap = await getDocs(collection(db, 'employees'));
    const allEmployees: any[] = [];
    employeesSnap.forEach(d => {
      allEmployees.push({ id: d.id, ...d.data() });
    });

    const targetRecipientsMap = new Map<string, { email: string; name: string }>();

    const addRecipientIfValid = (emp: any) => {
      // Exclude left/inactive/resigned employees until they are marked active again
      if (
        emp.status === 'left' ||
        emp.employmentStatus === 'left' ||
        emp.isLeft === true ||
        emp.status === 'inactive' ||
        emp.status === 'resigned'
      ) {
        return;
      }

      const email = (emp.registeredEmail || emp.email || '').trim();
      if (email && email.includes('@') && !email.endsWith('@employee.billedapp.com')) {
        targetRecipientsMap.set(email.toLowerCase(), {
          email,
          name: emp.name || 'Employee'
        });
      }
    };

    let audienceLabel = 'All Employees & Staff';

    if (currentUserAccessType === 'zonal-admin') {
      // Zonal Admin creating notification
      audienceLabel = `Zone: ${currentUserZone || 'Zonal'}`;
      const myZone = (currentUserZone || '').trim().toLowerCase();
      
      allEmployees.forEach(emp => {
        const empZone = (emp.zone || '').trim().toLowerCase();
        const zoneMatches = !myZone || !empZone || empZone === myZone || empZone.includes(myZone) || myZone.includes(empZone);
        
        if (zoneMatches) {
          if (notifTargetType === 'division' && notifTargetDivision && notifTargetDivision !== 'all') {
            const empDiv = (emp.division || '').trim().toLowerCase();
            const targetDiv = notifTargetDivision.trim().toLowerCase();
            if (empDiv === targetDiv || empDiv.includes(targetDiv) || targetDiv.includes(empDiv)) {
              addRecipientIfValid(emp);
            }
          } else if (notifTargetType === 'machine' && notifTargetMachine && notifTargetMachine !== 'all') {
            if (emp.machineName === notifTargetMachine) {
              addRecipientIfValid(emp);
            }
          } else if (notifTargetType === 'employee' && notifTargetEmployeeId && notifTargetEmployeeId !== 'all') {
            if (emp.id === notifTargetEmployeeId || emp.employeeId === notifTargetEmployeeId) {
              addRecipientIfValid(emp);
            }
          } else {
            addRecipientIfValid(emp);
          }
        }
      });
      // Also add Main Admin email
      targetRecipientsMap.set('imranansari399605@gmail.com', {
        email: 'imranansari399605@gmail.com',
        name: 'Master Admin'
      });
    } else if (currentUserAccessType === 'divisional-admin') {
      // Divisional Admin creating notification
      audienceLabel = `Division: ${currentUserDivision || 'Divisional'}`;
      const myDiv = (currentUserDivision || '').trim().toLowerCase();

      allEmployees.forEach(emp => {
        const empDiv = (emp.division || '').trim().toLowerCase();
        const divMatches = !myDiv || !empDiv || empDiv === myDiv || empDiv.includes(myDiv) || myDiv.includes(empDiv);

        if (divMatches) {
          if (notifTargetType === 'machine' && notifTargetMachine && notifTargetMachine !== 'all') {
            if (emp.machineName === notifTargetMachine) {
              addRecipientIfValid(emp);
            }
          } else if (notifTargetType === 'employee' && notifTargetEmployeeId && notifTargetEmployeeId !== 'all') {
            if (emp.id === notifTargetEmployeeId || emp.employeeId === notifTargetEmployeeId) {
              addRecipientIfValid(emp);
            }
          } else {
            addRecipientIfValid(emp);
          }
        }
      });
      // Also add Main Admin email
      targetRecipientsMap.set('imranansari399605@gmail.com', {
        email: 'imranansari399605@gmail.com',
        name: 'Master Admin'
      });
    } else if (currentUserAccessType === 'admin-light') {
      // Company Admin creating notification
      audienceLabel = `Company: ${currentUserCompanyName}`;
      allEmployees.forEach(emp => {
        if (emp.companyName === currentUserCompanyName) {
          if (notifTargetType === 'machine' && notifTargetMachine && notifTargetMachine !== 'all') {
            if (emp.machineName === notifTargetMachine) {
              addRecipientIfValid(emp);
            }
          } else if (notifTargetType === 'employee' && notifTargetEmployeeId && notifTargetEmployeeId !== 'all') {
            if (emp.id === notifTargetEmployeeId || emp.employeeId === notifTargetEmployeeId) {
              addRecipientIfValid(emp);
            }
          } else {
            addRecipientIfValid(emp);
          }
        }
      });
      // Also add Main Admin email
      targetRecipientsMap.set('imranansari399605@gmail.com', {
        email: 'imranansari399605@gmail.com',
        name: 'Master Admin'
      });
    } else if (currentUserAccessType === 'full') {
      // Machine Admin creating notification
      audienceLabel = `Machine: ${userMachine}`;
      allEmployees.forEach(emp => {
        if (emp.machineName === userMachine) {
          addRecipientIfValid(emp);
        }
      });
      // Also add Master Admin
      targetRecipientsMap.set('imranansari399605@gmail.com', {
        email: 'imranansari399605@gmail.com',
        name: 'Master Admin'
      });
    } else {
      // Main Master Admin
      if (notifTargetType === 'employee') {
        const emp = allEmployees.find(e => e.id === notifTargetEmployeeId || e.employeeId === notifTargetEmployeeId);
        if (emp) {
          addRecipientIfValid(emp);
          audienceLabel = `Employee: ${emp.name}`;
        }
      } else if (notifTargetType === 'company') {
        audienceLabel = `Company: ${notifTargetCompany}`;
        allEmployees.forEach(emp => {
          if (emp.companyName === notifTargetCompany) {
            addRecipientIfValid(emp);
          }
        });
      } else if (notifTargetType === 'machine') {
        audienceLabel = `Machine: ${notifTargetMachine}`;
        allEmployees.forEach(emp => {
          if (emp.machineName === notifTargetMachine) {
            addRecipientIfValid(emp);
          }
        });
      } else if (notifTargetType === 'company-machine') {
        audienceLabel = `Company: ${notifTargetCompany} / Machine: ${notifTargetMachine}`;
        allEmployees.forEach(emp => {
          if (emp.companyName === notifTargetCompany && emp.machineName === notifTargetMachine) {
            addRecipientIfValid(emp);
          }
        });
      } else {
        // 'all'
        audienceLabel = 'All Registered Employees';
        allEmployees.forEach(emp => {
          addRecipientIfValid(emp);
        });
      }
    }

    const recipients = Array.from(targetRecipientsMap.values());
    if (recipients.length === 0) {
      console.log('No valid email recipients found for notification target.');
      return { dispatched: 0, total: 0 };
    }

    const emailSubject = `🔔 New Notification: ${title}`;
    const emailHtml = buildNotificationEmailHtml({
      title,
      message,
      senderName: senderName || 'Administrator',
      senderRole: senderRole || 'RMMS Authority',
      targetAudienceLabel: audienceLabel,
      companyName: notifTargetCompany !== 'all' ? notifTargetCompany : currentUserCompanyName,
      machineName: notifTargetMachine !== 'all' ? notifTargetMachine : userMachine
    });

    console.log(`[Notification Email Dispatcher] Sending notification to ${recipients.length} recipients...`);
    return await sendBulkEmailNotifications(recipients, emailSubject, emailHtml, `${title}\n\n${message}`);
  } catch (error) {
    console.error('Error broadcasting notification emails:', error);
    return { dispatched: 0, total: 0 };
  }
}

/**
 * Builds HTML template for Profile Update Request Response (Approved, Rejected, Returned, Forwarded)
 */
export function buildProfileResponseEmailHtml(params: {
  type: 'approved' | 'rejected' | 'returned' | 'forwarded';
  request: any;
  reviewerName?: string;
  reviewerRole?: string;
  remarks?: string;
  forwardedToName?: string;
}): string {
  const { type, request, reviewerName, reviewerRole, remarks, forwardedToName } = params;

  let statusTitle = 'Profile Update Request Approved';
  let badgeBg = '#dcfce7';
  let badgeColor = '#15803d';
  let badgeBorder = '#86efac';
  let badgeText = 'APPROVED ✅';
  let bannerHeader = 'Your Profile Update Has Been Approved';
  let messageBody = `Great news! Your request to update your employee profile details has been reviewed and successfully approved. The changes are now active in the system.`;

  if (type === 'rejected') {
    statusTitle = 'Profile Update Request Rejected';
    badgeBg = '#ffe4e6';
    badgeColor = '#be123c';
    badgeBorder = '#fda4af';
    badgeText = 'REJECTED ❌';
    bannerHeader = 'Profile Update Request Rejected';
    messageBody = `Your profile update request has been reviewed and rejected by the authority. Please check the reason below.`;
  } else if (type === 'returned') {
    statusTitle = 'Profile Update Request Returned for Correction';
    badgeBg = '#fef3c7';
    badgeColor = '#b45309';
    badgeBorder = '#fde68a';
    badgeText = 'RETURNED ⚠️';
    bannerHeader = 'Profile Update Request Needs Corrections';
    messageBody = `Your profile update request was returned by the authority for necessary corrections or missing information. Please edit and resubmit your profile.`;
  } else if (type === 'forwarded') {
    statusTitle = 'Profile Update Request Forwarded';
    badgeBg = '#e0e7ff';
    badgeColor = '#4338ca';
    badgeBorder = '#a5b4fc';
    badgeText = 'FORWARDED 🔄';
    bannerHeader = 'Profile Update Request Forwarded';
    messageBody = `Your profile update request has been forwarded to ${forwardedToName || 'the designated supervisor/authority'} for further verification and approval.`;
  }

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 620px; margin: 0 auto; border-radius: 16px;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 26px 24px; border-radius: 14px 14px 0 0; text-align: center; color: #ffffff; border-bottom: 3px solid #6366f1;">
        <h1 style="margin: 0; font-size: 19px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase;">Indian Railway Management System</h1>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1; font-weight: 500;">HR & Employee Profile Service</p>
      </div>

      <!-- Main Content -->
      <div style="background-color: #ffffff; padding: 32px 26px; border-radius: 0 0 14px 14px; border: 1px solid #e2e8f0; border-top: none;">
        <div style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-size: 12px; font-weight: 800; padding: 5px 12px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">
          ${badgeText}
        </div>

        <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0;">
          ${bannerHeader}
        </h2>

        <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 18px;">
          Hello <strong>${request.name || 'Employee'}</strong>${request.pfNo ? ` (PF / Staff No: <strong>${request.pfNo}</strong>)` : ''},
        </p>

        <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
          ${messageBody}
        </p>

        ${remarks ? `
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #92400e; margin-bottom: 6px;">
              Reviewer Reason / Remarks (टिप्पणी):
            </div>
            <div style="font-size: 14px; color: #78350f; font-weight: 600; line-height: 1.5;">
              "${remarks}"
            </div>
          </div>
        ` : ''}

        <!-- Profile Snapshot Details -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 24px 0;">
          <h3 style="font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 0 0 12px 0;">
            Submitted Profile Details
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 6px 0; font-weight: 700; color: #64748b; width: 130px;">Name:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${request.name || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Designation:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${request.designation || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Mobile No:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${request.mobile || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Company / Unit:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${request.companyName || '-'}</td>
            </tr>
            ${reviewerName ? `
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Actioned By:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${reviewerName} ${reviewerRole ? `(${reviewerRole})` : ''}</td>
              </tr>
            ` : ''}
            <tr>
              <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Action Time:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 20px;">
          You can log in to your RMMS Employee Portal anytime to review your updated profile information.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
          Railway Machine Management System (RMMS) • HR & Employee Notification Service
        </p>
      </div>
    </div>
  `;
}

/**
 * Sends response email to user for their profile update request.
 */
export async function sendProfileResponseEmail(params: {
  type: 'approved' | 'rejected' | 'returned' | 'forwarded';
  request: any;
  reviewerName?: string;
  reviewerRole?: string;
  remarks?: string;
  forwardedToName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { type, request, reviewerName, reviewerRole, remarks, forwardedToName } = params;

    const toEmail = (request.registeredEmail || request.email || '').trim();
    if (!toEmail || !toEmail.includes('@') || toEmail.endsWith('@employee.billedapp.com')) {
      console.log('No valid recipient email on profile request:', toEmail);
      return { success: false, error: 'No valid recipient email on profile request' };
    }

    const typeLabels = {
      approved: 'Approved ✅',
      rejected: 'Rejected ❌',
      returned: 'Returned for Correction ⚠️',
      forwarded: 'Forwarded 🔄'
    };

    const subject = `📋 Profile Update Request ${typeLabels[type] || 'Status Update'}`;
    const htmlContent = buildProfileResponseEmailHtml({
      type,
      request,
      reviewerName,
      reviewerRole,
      remarks,
      forwardedToName
    });

    return await sendEmailNotification({
      toEmail,
      toName: request.name || 'Employee',
      subject,
      htmlContent,
      textContent: `Your Profile Update Request has been ${type}. ${remarks ? `Remarks: ${remarks}` : ''}`
    });
  } catch (error: any) {
    console.error('Error sending profile response email:', error);
    return { success: false, error: error?.message || 'Failed to dispatch email' };
  }
}

/**
 * Sends acknowledgment email when employee submits a profile update request.
 */
export async function sendProfileSubmittedEmail(params: {
  request: any;
  reviewerName?: string;
  reviewerEmail?: string;
}): Promise<void> {
  try {
    const { request, reviewerName, reviewerEmail } = params;

    const toEmail = (request.registeredEmail || request.email || '').trim();
    if (toEmail && toEmail.includes('@') && !toEmail.endsWith('@employee.billedapp.com')) {
      const subject = '📝 Profile Update Request Submitted for Review';
      const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 18px; font-weight: 800; text-transform: uppercase;">Indian Railway Management System</h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #cbd5e1;">Employee Profile Update Request</p>
          </div>
          <div style="background-color: #ffffff; padding: 30px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
            <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0;">Request Received Successfully</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Hello <strong>${request.name || 'Employee'}</strong>,
            </p>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Your profile update request has been successfully submitted and forwarded to <strong>${reviewerName || 'the reviewing administrator'}</strong> for verification.
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px;">
              <div><strong>Designation:</strong> ${request.designation || '-'}</div>
              <div style="margin-top: 4px;"><strong>Company / Machine:</strong> ${request.companyName || '-'} / ${request.machineName || '-'}</div>
              <div style="margin-top: 4px;"><strong>Submitted On:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
            </div>
            <p style="font-size: 13px; color: #64748b;">
              You will receive an automated email notification as soon as your request is reviewed.
            </p>
          </div>
        </div>
      `;

      await sendEmailNotification({
        toEmail,
        toName: request.name,
        subject,
        htmlContent
      });
    }

    // Also notify the reviewer if valid email provided
    if (reviewerEmail && reviewerEmail.includes('@') && !reviewerEmail.endsWith('@employee.billedapp.com')) {
      const subject = `📬 New Profile Update Request: ${request.name || 'Employee'}`;
      const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 18px; font-weight: 800; text-transform: uppercase;">Indian Railway Management System</h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #cbd5e1;">Reviewer Action Required</p>
          </div>
          <div style="background-color: #ffffff; padding: 30px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
            <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0;">New Profile Update Request Pending Review</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Hello <strong>${reviewerName || 'Reviewer'}</strong>,
            </p>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              A profile update request has been submitted by <strong>${request.name}</strong>${request.pfNo ? ` (PF: ${request.pfNo})` : ''} and is awaiting your review in the Inbox / HR portal.
            </p>
            <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
              Please log in to the RMMS portal to approve, reject, or return this request.
            </p>
          </div>
        </div>
      `;

      await sendEmailNotification({
        toEmail: reviewerEmail,
        toName: reviewerName,
        subject,
        htmlContent
      });
    }
  } catch (err) {
    console.warn('Error sending profile submitted notification emails:', err);
  }
}

/**
 * Sends real-time email notification when an employee is marked as 'left' (relieved) or reactivated as 'active'.
 */
export async function sendEmployeeStatusChangeEmail(params: {
  type: 'left' | 'active';
  employee: any;
  performerName?: string;
  performerRole?: string;
  exitDate?: string;
  remarks?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { type, employee, performerName, performerRole, exitDate, remarks } = params;
    const recipientEmail = (employee.registeredEmail || employee.email || '').trim();

    if (!recipientEmail || !recipientEmail.includes('@') || recipientEmail.toLowerCase().includes('.billedapp') || recipientEmail.endsWith('@employee.billedapp.com')) {
      return { success: false, error: 'Recipient has no valid email address' };
    }

    const isLeft = type === 'left';
    const statusLabel = isLeft ? 'Relieved / Deactivated (Left)' : 'Reactivated / Resumed (Active)';
    const statusColor = isLeft ? '#dc2626' : '#16a34a';
    const statusBg = isLeft ? '#fef2f2' : '#f0fdf4';
    const statusBorder = isLeft ? '#fecaca' : '#bbf7d0';

    const subject = isLeft 
      ? `Important: Your Employee Account Status is now Relieved/Left - Indian Railways`
      : `Important: Your Employee Account has been Reactivated - Indian Railways`;

    const cleanPerformer = cleanPersonName(performerName) || 'System Administrator';
    const cleanRole = (performerRole && !performerRole.includes('@')) ? performerRole : 'Administrator';

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 620px; margin: 0 auto; border-radius: 16px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 26px 24px; border-radius: 14px 14px 0 0; text-align: center; color: #ffffff; border-bottom: 3px solid ${isLeft ? '#ef4444' : '#22c55e'};">
          <h1 style="margin: 0; font-size: 19px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase;">Indian Railway Management System</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1; font-weight: 500;">Personnel Service & Status Notification</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #ffffff; padding: 32px 26px; border-radius: 0 0 14px 14px; border: 1px solid #e2e8f0; border-top: none;">
          <!-- Status Banner -->
          <div style="background-color: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; text-align: center;">
            <span style="font-size: 11px; font-weight: 800; color: ${statusColor}; text-transform: uppercase; letter-spacing: 0.5px;">Account Status Update</span>
            <h2 style="font-size: 18px; font-weight: 800; color: ${statusColor}; margin: 4px 0 0 0;">${statusLabel}</h2>
          </div>

          <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">
            Dear <strong>${employee.name || 'Employee'}</strong>,
          </p>

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px 0;">
            ${isLeft 
              ? `This is an official communication that your service record in the Railway Machine Management System has been updated to <strong>Left / Relieved</strong> as of <strong>${exitDate || new Date().toISOString().split('T')[0]}</strong>.`
              : `This is an official communication that your service record in the Railway Machine Management System has been successfully <strong>Reactivated</strong> and your portal credentials are now active.`
            }
          </p>

          <!-- Employee Details Summary -->
          <div style="background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; padding: 16px 18px; margin-bottom: 22px; font-size: 13px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b; width: 140px;">Employee Name:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${employee.name || 'N/A'}</td>
              </tr>
              ${employee.pfNo ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">PF / ID No:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #334155;">${employee.pfNo}</td>
              </tr>
              ` : ''}
              ${employee.designation ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Designation:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #334155;">${employee.designation}</td>
              </tr>
              ` : ''}
              ${employee.companyName ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Company / Contractor:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #334155;">${employee.companyName}</td>
              </tr>
              ` : ''}
              ${employee.machineName ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Machine Assigned:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #334155;">${employee.machineName}</td>
              </tr>
              ` : ''}
              ${isLeft && exitDate ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Relieved / Exit Date:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #dc2626;">${exitDate}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Issued By:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #1e293b;">${cleanPerformer} (${cleanRole})</td>
              </tr>
              ${remarks ? `
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Remarks:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #475569;">${remarks}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 5px 0; font-weight: 700; color: #64748b;">Timestamp:</td>
                <td style="padding: 5px 0; font-weight: 600; color: #334155;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              </tr>
            </table>
          </div>

          <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 20px;">
            ${isLeft 
              ? 'If you believe this status change was made in error or have any queries regarding your final settlement/service certificate, please contact your administration authority immediately.'
              : 'You may now log in to the portal using your registered credentials to access your assignments and records.'
            }
          </p>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Railway Machine Management System (RMMS) • Automated Personnel Service
          </p>
        </div>
      </div>
    `;

    return await sendEmailNotification({
      toEmail: recipientEmail,
      toName: employee.name || 'Employee',
      subject,
      htmlContent
    });
  } catch (error: any) {
    console.error('Error dispatching employee status email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sends a welcome and onboarding email notification when a new employee is added to the system.
 * Includes Company Name, Employee Name, PF Number, Mobile Number, Designation, Assigned Machine, and 16-Digit Login Password with Website Login Link.
 */
export async function sendEmployeeWelcomeEmail(params: {
  employee: {
    name?: string;
    email?: string;
    pfNo?: string;
    mobile?: string;
    designation?: string;
    companyName?: string;
    machineName?: string;
    department?: string;
  };
  temporaryPassword?: string;
  websiteUrl?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { employee, temporaryPassword, websiteUrl } = params;
    const recipientEmail = (employee.email || '').trim();

    if (!recipientEmail || !recipientEmail.includes('@') || recipientEmail.toLowerCase().includes('.billedapp') || recipientEmail.endsWith('@employee.billedapp.com')) {
      return { success: false, error: 'Recipient has no valid email address' };
    }

    // Resolve portal domain URL
    let portalUrl = (websiteUrl || '').trim();
    if (!portalUrl || portalUrl === '#') {
      try {
        const snap = await getDoc(doc(db, 'settings', 'general'));
        if (snap.exists()) {
          const data = snap.data();
          portalUrl = data.portalDomain || data.websiteUrl || data.webLink || '';
        }
      } catch (err) {
        console.warn('Could not fetch portal domain setting:', err);
      }
    }

    if (!portalUrl || portalUrl === '#') {
      portalUrl = 'https://railway-machine-management-system.vercel.app';
    } else if (!portalUrl.startsWith('http://') && !portalUrl.startsWith('https://')) {
      portalUrl = `https://${portalUrl}`;
    }

    const empName = cleanPersonName(employee.name) || 'Employee';
    const compName = (employee.companyName || 'Active Engineers Railway').trim();
    const pfNumber = (employee.pfNo || 'N/A').trim();
    const mobNumber = (employee.mobile || 'N/A').trim();
    const desig = (employee.designation || 'Staff').trim();
    const machine = (employee.machineName || 'General / Unassigned').trim();
    const dept = (employee.department || '').trim();

    const subject = `Welcome to ${compName} - Your Railway Portal Login Details`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; padding: 24px; color: #1e293b; max-width: 620px; margin: 0 auto; border-radius: 16px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 28px 24px; border-radius: 14px 14px 0 0; text-align: center; color: #ffffff; border-bottom: 3px solid #3b82f6;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase;">Indian Railway Management System</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #93c5fd; font-weight: 600;">Official Employee Onboarding & Account Credentials</p>
        </div>

        <!-- Main Card -->
        <div style="background-color: #ffffff; padding: 32px 26px; border-radius: 0 0 14px 14px; border: 1px solid #e2e8f0; border-top: none;">
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; text-align: center;">
            <span style="font-size: 11px; font-weight: 800; color: #16a34a; text-transform: uppercase; letter-spacing: 0.5px;">Account Enrolled Successfully</span>
            <h2 style="font-size: 17px; font-weight: 800; color: #15803d; margin: 4px 0 0 0;">Welcome, ${empName}!</h2>
          </div>

          <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">
            You have been successfully added to the <strong>Railway Machine Management System</strong>. Below are your official profile, assigned machine, and account login details:
          </p>

          <!-- Key Information Table -->
          <div style="background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b; width: 140px;">Company Name:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #1e1b4b; text-transform: uppercase;">${compName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Employee Name:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #0f172a; text-transform: uppercase;">${empName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Assigned Machine:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #0284c7; text-transform: uppercase;">${machine}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">PF Number:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #2563eb; font-family: monospace; font-size: 14px;">${pfNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Designation:</td>
                <td style="padding: 6px 0; font-weight: 700; color: #334155; text-transform: uppercase;">${desig}</td>
              </tr>
              ${dept ? `<tr><td style="padding: 6px 0; font-weight: 700; color: #64748b;">Department:</td><td style="padding: 6px 0; font-weight: 600; color: #334155;">${dept}</td></tr>` : ''}
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Mobile Number:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #334155;">${mobNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: 700; color: #64748b;">Registered Email:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #334155;">${recipientEmail}</td>
              </tr>
            </table>
          </div>

          <!-- Credentials Box -->
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #1e3a8a 100%); color: #ffffff; border-radius: 12px; padding: 22px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
            <h3 style="font-size: 14px; font-weight: 800; color: #93c5fd; margin: 0 0 14px 0; text-transform: uppercase; letter-spacing: 0.5px;">
              🔑 Your Portal Login Credentials (लॉगिन क्रेडेंशियल्स)
            </h3>
            <div style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #ffffff;">
                <tr>
                  <td style="padding: 5px 0; color: #cbd5e1; width: 140px; font-weight: 600;">Portal Link:</td>
                  <td style="padding: 5px 0; font-weight: 700;">
                    <a href="${portalUrl}" style="color: #60a5fa; text-decoration: underline;" target="_blank">${portalUrl}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 5px 0; color: #cbd5e1; font-weight: 600;">Login ID / PF No:</td>
                  <td style="padding: 5px 0; font-family: monospace; font-size: 14px; font-weight: 800; color: #ffffff;">${pfNumber}</td>
                </tr>
                ${temporaryPassword ? `
                <tr>
                  <td style="padding: 6px 0; color: #cbd5e1; font-weight: 600;">16-Digit Password:</td>
                  <td style="padding: 6px 0;">
                    <span style="display: inline-block; font-family: monospace; font-size: 15px; font-weight: 900; color: #1e1b4b; background: #ffffff; padding: 6px 12px; border-radius: 6px; letter-spacing: 1.5px; border: 1px solid #93c5fd; word-break: break-all;">
                      ${temporaryPassword}
                    </span>
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            <p style="margin: 0; font-size: 11.5px; line-height: 1.5; color: #fde047; font-weight: 600;">
              ⚠️ <strong>Important Security Policy:</strong> When you log in for the first time with this 16-digit password, a mandatory password reset window will open requiring you to set your own permanent password.
            </p>
          </div>

          <!-- Login Instructions -->
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <h3 style="font-size: 14px; font-weight: 800; color: #1e3a8a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">
              🔐 How to Login to Portal (पोर्टल पर लॉगिन कैसे करें):
            </h3>
            <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8; color: #1e40af;">
              <li>Visit the official portal link: <a href="${portalUrl}" style="color: #2563eb; font-weight: 700; text-decoration: underline;" target="_blank">${portalUrl}</a></li>
              <li>Select <strong>Employee Login</strong>.</li>
              <li>Enter your registered <strong>PF Number (${pfNumber})</strong>.</li>
              <li>Enter your <strong>16-digit password</strong> shown above.</li>
              <li>On first-time login, set and confirm your new personalized password to securely access your dashboard, shift duties, digital ID card, and maintenance records.</li>
            </ol>
            <div style="text-align: center; margin-top: 18px;">
              <a href="${portalUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; padding: 12px 28px; font-weight: 800; font-size: 14px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                Open Railway Portal (पोर्टल खोलें) &rarr;
              </a>
            </div>
          </div>

          <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin-top: 20px;">
            If you have any questions or require credentials assistance, please contact your company supervisor or system administration.
          </p>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Railway Machine Management System (RMMS) • Official Personnel Notification
          </p>
        </div>
      </div>
    `;

    return await sendEmailNotification({
      toEmail: recipientEmail,
      toName: empName,
      subject,
      htmlContent
    });
  } catch (error: any) {
    console.error('Error dispatching employee welcome email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Dispatches an automated PME Due Alert email to the employee.
 */
export async function sendPmeDueEmail(params: {
  empName: string;
  empEmail: string;
  dueDate: string;
  medicalCategory?: string;
  memoNo?: string;
  designation?: string;
  machineName?: string;
  photoUrl?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { empName, empEmail, dueDate, medicalCategory, memoNo, designation, machineName, photoUrl } = params;

    if (!empEmail || !empEmail.includes('@') || empEmail.endsWith('@employee.billedapp.com')) {
      return { success: false, error: 'Valid employee email not provided' };
    }

    const subject = `🏥 PME Due Notice: Periodic Medical Examination Due (${dueDate}) - Indian Railways`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color: #ffffff; padding: 26px 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">
            INDIAN RAILWAYS • भारतीय रेल
          </h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #93c5fd; font-weight: 600;">
            Railway Machine Management System (RMMS) • Personnel Medical Branch
          </p>
        </div>

        <div style="padding: 28px 24px;">
          <!-- Alert Badge -->
          <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
            <span style="display: inline-block; background: #e11d48; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
              Mandatory Safety Notice
            </span>
            <h2 style="font-size: 18px; font-weight: 800; color: #9f1239; margin: 4px 0 6px 0;">
              Periodic Medical Examination (PME) Due
            </h2>
            <p style="font-size: 13px; color: #be123c; margin: 0; font-weight: 600;">
              आवधिक चिकित्सा परीक्षा सूचना • Scheduled Due Date: <span style="font-size: 15px; font-weight: 900; text-decoration: underline;">${dueDate}</span>
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
            ${photoUrl ? `
              <div style="width: 72px; height: 72px; border-radius: 50%; overflow: hidden; border: 3px solid #3b82f6; flex-shrink: 0;">
                <img src="${photoUrl}" alt="${empName}" style="width: 100%; height: 100%; object-fit: cover;" />
              </div>
            ` : ''}
            <div>
              <p style="font-size: 15px; color: #1e293b; margin: 0; line-height: 1.5;">
                Dear <strong>${empName}</strong>,
              </p>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">
                ${designation ? designation : 'Railway Machine Personnel'} ${machineName ? `• Machine: ${machineName}` : ''}
              </p>
            </div>
          </div>

          <p style="font-size: 13.5px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
            This is an automated safety compliance alert informing you that your <strong>Periodic Medical Examination (PME)</strong> is due for renewal on <strong>${dueDate}</strong> as mandated under Indian Railways operating and safety regulations.
          </p>

          <!-- Medical Record Particulars -->
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <h3 style="font-size: 13px; font-weight: 800; color: #1e3a8a; margin: 0 0 12px 0; text-transform: uppercase;">
              📋 Examination Details:
            </h3>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; width: 150px; font-weight: 600;">Medical Category:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #0f172a;">${medicalCategory || 'A-1 / B-1 Railway Operating Fit'}</td>
              </tr>
              ${memoNo ? `
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Previous Memo No:</td>
                <td style="padding: 6px 0; font-weight: 700; color: #0f172a; font-family: monospace;">${memoNo}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Due / Renewal Date:</td>
                <td style="padding: 6px 0; font-weight: 900; color: #e11d48; font-size: 14px;">${dueDate}</td>
              </tr>
            </table>
          </div>

          <div style="background: #f1f5f9; border-left: 4px solid #3b82f6; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #334155; font-weight: 600;">
              ⚠️ <strong>Instructions for Employee:</strong> Please collect your Medical Memo from your Section Supervisor / Depot in-charge and report to your nominated Divisional Railway Hospital.
            </p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Railway Machine Management System (RMMS) • Automated Health & Safety Alert
          </p>
        </div>
      </div>
    `;

    return await sendEmailNotification({
      toEmail: empEmail,
      toName: empName,
      subject,
      htmlContent
    });
  } catch (error: any) {
    console.error('Error sending PME Due Email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Dispatches an automated Birthday Celebration email with an embedded Certificate and employee photo.
 */
export async function sendBirthdayEmailWithCertificate(params: {
  empName: string;
  empEmail: string;
  dob: string;
  designation?: string;
  machineName?: string;
  division?: string;
  zone?: string;
  photoUrl?: string;
  companyName?: string;
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const { empName, empEmail, designation, machineName, division, zone, photoUrl, companyName } = params;

    const cleanEmail = (empEmail || '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.endsWith('@employee.billedapp.com')) {
      return { success: false, error: 'Valid employee email address not provided' };
    }

    const todayDateFormatted = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const subject = `🎉 Happy Birthday, ${empName}! Your Official Celebration Certificate from Indian Railways RMMS`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; background-color: #0f172a; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 2px solid #b45309;">
        
        <!-- Top Festive Celebration Header -->
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4338ca 100%); color: #ffffff; padding: 36px 24px 28px 24px; text-align: center; position: relative;">
          <div style="font-size: 38px; line-height: 1; margin-bottom: 12px; letter-spacing: 6px;">🎂 ✨ 🎈 🌟 🎉</div>
          <div style="display: inline-block; padding: 4px 16px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; border-radius: 20px; font-size: 11px; font-weight: 800; color: #fde047; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">
            SPECIAL BIRTHDAY TRIBUTE • जन्मदिन अभिनंदन
          </div>
          <h1 style="margin: 0; font-size: 26px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.4);">
            HAPPY BIRTHDAY, ${empName.toUpperCase()}!
          </h1>
          <p style="margin: 8px 0 0 0; font-size: 15px; color: #fde047; font-weight: 800;">
            जन्मदिन की हार्दिक शुभकामनाएं एवं मंगलकामनाएं
          </p>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #c7d2fe; font-weight: 600;">
            Railway Machine Management System (RMMS) • Personnel & Operations Wing
          </p>
        </div>

        <div style="padding: 28px 20px; background-color: #f8fafc;">
          <!-- Warm Opening Note -->
          <div style="text-align: center; margin-bottom: 22px; padding: 0 10px;">
            <p style="font-size: 14.5px; color: #334155; line-height: 1.6; margin: 0; font-weight: 500;">
              On this auspicious day, the Indian Railways administration and the entire RMMS family extend our warmest congratulations, profound appreciation, and heartfelt blessings to you for your exemplary service and tireless commitment to the nation.
            </p>
          </div>

          <!-- ======================================================== -->
          <!-- OFFICIAL ROYAL BIRTHDAY CERTIFICATE                      -->
          <!-- ======================================================== -->
          <div style="background: #ffffff; border: 6px double #d97706; border-radius: 20px; padding: 32px 24px; text-align: center; box-shadow: 0 8px 24px rgba(217, 119, 6, 0.15); position: relative; margin: 10px 0 24px 0;">
            
            <!-- Ornate Top Header -->
            <div style="color: #b45309; font-size: 15px; letter-spacing: 6px; font-weight: 900; margin-bottom: 4px;">
              ❖ ❖ ❖ ★ ❖ ❖ ❖
            </div>

            <div style="font-size: 13px; font-weight: 900; color: #1e3a8a; text-transform: uppercase; letter-spacing: 3px;">
              INDIAN RAILWAYS • भारतीय रेल
            </div>
            <div style="font-size: 10px; color: #92400e; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px;">
              RAILWAY MACHINE MANAGEMENT SYSTEM (RMMS)
            </div>

            <h2 style="font-size: 22px; font-weight: 900; color: #92400e; margin: 18px 0 2px 0; text-transform: uppercase; letter-spacing: 1.5px; font-family: Georgia, 'Times New Roman', serif;">
              CERTIFICATE OF BIRTHDAY CELEBRATION
            </h2>
            <p style="font-size: 12px; font-weight: 800; color: #b45309; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 12px 0;">
              जन्मदिन अभिनंदन एवं सम्मान प्रमाण पत्र
            </p>

            <div style="width: 180px; height: 3px; background: linear-gradient(90deg, transparent, #d97706, transparent); margin: 0 auto 16px auto;"></div>

            <!-- Employee Photograph (Framed in Royal Gold) -->
            <div style="margin: 14px auto 14px auto; text-align: center;">
              ${photoUrl ? `
                <img src="${photoUrl}" alt="${empName}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 4px solid #d97706; box-shadow: 0 6px 14px rgba(217, 119, 6, 0.25); display: inline-block;" />
              ` : `
                <div style="width: 86px; height: 86px; border-radius: 50%; background: #fef3c7; color: #b45309; font-size: 36px; line-height: 86px; border: 4px solid #d97706; margin: 0 auto; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                  👤
                </div>
              `}
            </div>

            <p style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 4px 0; font-weight: 700;">
              This certificate of honor & best wishes is proudly presented to:
            </p>

            <h3 style="font-size: 24px; font-weight: 900; color: #1e1b4b; margin: 0 0 6px 0; letter-spacing: 0.5px;">
              ${empName}
            </h3>

            <!-- Designation / Machine / Division Ribbon -->
            <div style="display: inline-block; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 30px; padding: 6px 18px; margin: 0 auto 16px auto;">
              <span style="font-size: 12.5px; font-weight: 800; color: #3730a3;">
                ${designation || 'Railway Personnel'}
              </span>
              ${machineName ? `<span style="color: #6366f1; font-weight: 900; margin: 0 6px;">•</span><span style="font-size: 12px; font-weight: 700; color: #4338ca;">Machine: ${machineName}</span>` : ''}
              ${division || zone ? `<span style="color: #6366f1; font-weight: 900; margin: 0 6px;">•</span><span style="font-size: 11.5px; font-weight: 700; color: #475569;">${division ? `${division} Div` : ''} ${zone ? `(${zone})` : ''}</span>` : ''}
              ${companyName ? `<div style="font-size: 11px; font-weight: 600; color: #64748b; margin-top: 2px;">${companyName}</div>` : ''}
            </div>

            <!-- Heartfelt Birthday Blessing Quote -->
            <div style="background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 12px; padding: 14px 18px; margin: 0 auto 20px auto; max-width: 520px;">
              <p style="font-size: 13px; font-style: italic; color: #78350f; margin: 0; line-height: 1.6; font-weight: 500;">
                "May your special day bring you good health, joy, and peace. We salute your relentless spirit and contribution in keeping our nation’s railway infrastructure safe, efficient, and strong. Wishing you a year of immense success and milestones!"
              </p>
            </div>

            <!-- Date, Seal, and Signatures Row -->
            <table style="width: 100%; margin-top: 16px; border-collapse: collapse;">
              <tr>
                <td style="text-align: left; width: 38%; vertical-align: bottom;">
                  <span style="display: block; font-size: 9.5px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Date of Celebration</span>
                  <span style="display: block; font-size: 13px; font-weight: 800; color: #1e293b;">${todayDateFormatted}</span>
                </td>
                <td style="text-align: center; width: 24%; vertical-align: middle;">
                  <div style="display: inline-block; width: 56px; height: 56px; border-radius: 50%; background: #fef3c7; border: 3px solid #d97706; line-height: 52px; font-size: 24px; box-shadow: 0 2px 6px rgba(217, 119, 6, 0.2);">
                    🎖️
                  </div>
                </td>
                <td style="text-align: right; width: 38%; vertical-align: bottom;">
                  <span style="display: block; font-size: 9.5px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Authorized By</span>
                  <span style="display: block; font-size: 13px; font-weight: 900; color: #1e3a8a;">Chief Administration</span>
                  <span style="display: block; font-size: 9.5px; font-weight: 600; color: #64748b;">Indian Railways RMMS</span>
                </td>
              </tr>
            </table>

          </div>

          <!-- Bottom Footer Notice -->
          <div style="text-align: center; margin-top: 16px;">
            <p style="font-size: 12px; color: #64748b; margin: 0; font-weight: 500;">
              ✨ You can also view, print, and download your Digital Birthday Certificate anytime directly from your <strong>RMMS Employee Profile</strong>.
            </p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0 14px 0;" />
          <p style="font-size: 10.5px; color: #94a3b8; text-align: center; margin: 0; font-weight: 500;">
            Railway Machine Management System (RMMS) • Automated Personnel Celebration System
          </p>
        </div>
      </div>
    `;

    return await sendEmailNotification({
      toEmail: cleanEmail,
      toName: empName,
      subject,
      htmlContent
    });
  } catch (error: any) {
    console.error('Error sending Birthday Email with Certificate:', error);
    return { success: false, error: error.message };
  }
}


