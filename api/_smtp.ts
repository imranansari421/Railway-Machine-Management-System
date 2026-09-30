import nodemailer from 'nodemailer';

export interface SmtpConfigStatus {
  hostPresent: boolean;
  userPresent: boolean;
  passPresent: boolean;
  fromPresent: boolean;
  port: string;
  configured: boolean;
}

export function getSmtpStatus(): SmtpConfigStatus {
  const host = process.env.SMTP_HOST?.trim() || '';
  const port = process.env.SMTP_PORT?.trim() || '587';
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS?.trim() || '';
  const from = process.env.FROM_EMAIL?.trim() || '';

  const configured = Boolean(user && pass && (host || user.includes('@gmail.com')));

  return {
    hostPresent: Boolean(host),
    userPresent: Boolean(user),
    passPresent: Boolean(pass),
    fromPresent: Boolean(from),
    port,
    configured
  };
}

let cachedTransporter: nodemailer.Transporter | null = null;
let lastTransporterConfigKey = '';

export function createSmtpTransporter() {
  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT?.trim() || '587', 10);
  const user = process.env.SMTP_USER?.trim() || '';
  let pass = process.env.SMTP_PASS?.trim() || '';

  if (!user || !pass) {
    return null;
  }

  // Strip spaces if user copied Google App Password with spaces (e.g. "pkgq hwle bcrg rvuc")
  if (pass.replace(/\s+/g, '').length === 16) {
    pass = pass.replace(/\s+/g, '');
  }

  const configKey = `${host}_${port}_${user}_${pass.slice(0, 4)}`;
  if (cachedTransporter && lastTransporterConfigKey === configKey) {
    return cachedTransporter;
  }

  const isGmail = host.toLowerCase().includes('gmail') || user.toLowerCase().includes('@gmail.com');

  if (isGmail) {
    cachedTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: port === 465 ? 465 : 587,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false }
    });
  } else {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false }
    });
  }

  lastTransporterConfigKey = configKey;
  return cachedTransporter;
}
