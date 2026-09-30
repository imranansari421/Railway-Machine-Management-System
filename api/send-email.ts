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
    const { toEmail, subject, htmlContent, textContent } = body;

    const cleanEmail = typeof toEmail === 'string' ? toEmail.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Valid recipient email is required.' });
    }

    const transporter = createSmtpTransporter();
    if (!transporter) {
      return res.status(503).json({
        success: false,
        error: 'SMTP credentials not configured in Vercel Environment Variables.'
      });
    }

    const fromEmail = process.env.FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'noreply@railway-portal.com';
    const emailSubject = subject || 'RMMS System Notification';
    const emailBodyText = textContent || 'You have a new update from the Railway Machine Management System.';

    const info = await transporter.sendMail({
      from: `"Railway Machine Management System" <${fromEmail}>`,
      to: cleanEmail,
      subject: emailSubject,
      text: emailBodyText,
      html: htmlContent || `<p>${emailBodyText}</p>`
    });

    return res.status(200).json({
      success: true,
      delivered: true,
      provider: 'SMTP Server',
      messageId: info.messageId
    });
  } catch (error: any) {
    console.error('[Vercel send-email Failed]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to dispatch notification email.'
    });
  }
}
