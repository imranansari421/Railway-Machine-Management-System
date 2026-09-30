import type { Request, Response } from 'express';
import { createSmtpTransporter } from './_smtp.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: `Method ${req.method} not allowed.` });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { recipients, subject, htmlContent, textContent } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Recipients array is required.' });
    }

    if (recipients.length > 50) {
      return res.status(400).json({ success: false, error: 'Maximum 50 recipients per request.' });
    }

    const transporter = createSmtpTransporter();
    if (!transporter) {
      return res.status(503).json({
        success: false,
        error: 'SMTP credentials not configured in Vercel Environment Variables.'
      });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const validRecipients = recipients.filter((r: any) => {
      const email = typeof r === 'string' ? r.trim().toLowerCase() : r?.email?.trim().toLowerCase();
      return email && EMAIL_REGEX.test(email) && !email.endsWith('@employee.billedapp.com');
    });

    if (validRecipients.length === 0) {
      return res.status(200).json({ success: true, count: 0, message: 'No valid external email recipients found to dispatch.' });
    }

    let successCount = 0;
    const errors: string[] = [];

    for (const r of validRecipients) {
      const email = typeof r === 'string' ? r.trim().toLowerCase() : r.email?.trim().toLowerCase();
      try {
        await transporter.sendMail({
          from: `"Railway Machine Management System" <${fromEmail}>`,
          to: email,
          subject: subject || 'RMMS System Notification',
          text: textContent || 'You have a new update from the Railway Machine Management System.',
          html: htmlContent || `<p>${textContent || 'System Notification'}</p>`
        });
        successCount++;
      } catch (err: any) {
        console.warn(`[Bulk Email Partial Error] ${email}:`, err?.message || err);
        errors.push(`${email}: Delivery failed`);
      }
    }

    return res.status(200).json({
      success: true,
      dispatched: successCount,
      total: validRecipients.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('[Bulk Notification Failed]', error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to execute bulk email dispatch.' });
  }
}
