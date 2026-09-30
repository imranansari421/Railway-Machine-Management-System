import express from 'express';

/**
 * ============================================================================
 * INDIAN RAILWAYS RMMS - ADAPTIVE HONEYPOT TARPIT FIREWALL
 * ============================================================================
 * An active, deceptive cybersecurity defense mesh.
 * - Detects exploit attempts, bot scanners, SQLi, NoSQLi, RCE, Path Traversal,
 *   and malicious file probing.
 * - Dynamic Threat Escalation: The more an attacker probes/attacks, the
 *   stronger and slower the firewall becomes ("fairwall utna majbut hota rahe").
 * - Socket Tarpit: Progressively stalls and delays attacker connections
 *   to freeze scanners, consume their memory/threads, and prevent brute-force.
 * - Deceptive Honey-pot Labyrinth ("Idhar-Udhar Uljhana"): Returns realistic
 *   decoy data, fake encrypted tokens, and infinite recursive challenge routes
 *   to waste hacker time and computational resources without exposing any real data.
 * - 100% transparent and instant (0ms delay) for all legitimate railway staff & users.
 * ============================================================================
 */

interface ThreatRecord {
  ip: string;
  threatScore: number;
  attackCount: number;
  firstDetected: number;
  lastAttack: number;
  activeAttacks: string[];
  quarantineUntil?: number;
}

// In-memory persistent threat state
const threatStore = new Map<string, ThreatRecord>();

// Sliding window cleanup: decay threat score slowly every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of threatStore.entries()) {
    // If no attack for 1 hour, reduce threat score by half
    if (now - record.lastAttack > 60 * 60 * 1000) {
      record.threatScore = Math.max(0, Math.floor(record.threatScore / 2));
      record.attackCount = Math.max(0, Math.floor(record.attackCount / 2));
      if (record.threatScore === 0) {
        threatStore.delete(ip);
      }
    }
  }
}, 15 * 60 * 1000);

/**
 * Common exploit and probe path patterns used by automated scanners & hackers
 */
const HONEYPOT_PROBE_PATHS = [
  /^\/\.env(\..+)?$/i,
  /^\/\.git(\/.*)?$/i,
  /^\/\.svn(\/.*)?$/i,
  /^\/\.aws(\/.*)?$/i,
  /^\/\.ssh(\/.*)?$/i,
  /^\/(wp-admin|wp-login\.php|xmlrpc\.php|wp-content|wp-includes)(\/.*)?$/i,
  /^\/(phpmyadmin|pma|adminer|mysql|dbadmin)(\/.*)?$/i,
  /^\/(shell|c99|r57|wso|alfa|cmd|b374k|root)\.php$/i,
  /^\/(admin|login|system|backend)\.php$/i,
  /^\/(actuator|debug|telescope|solr|log4j)(\/.*)?$/i,
  /^\/(config|database|credentials|settings)\.(json|yml|yaml|ini|xml|bak)$/i,
  /^\/eval-stdin\.php$/i,
  /^\/server-status$/i,
  /^\/vendor\/phpunit(\/.*)?$/i,
  /^\/\.well-known\/security\.txt(\/.*)?$/i
];

/**
 * Malicious attack signatures across query, body, and URL parameters
 */
const EXPLOIT_SIGNATURES: { name: string; score: number; regex: RegExp }[] = [
  // SQL Injection patterns
  {
    name: 'SQLI_UNION_SELECT',
    score: 30,
    regex: /\b(union\s+(all\s+)?select|select\s+.*\s+from|insert\s+into|delete\s+from|drop\s+table|update\s+.*\s+set|truncate\s+table)\b/i
  },
  {
    name: 'SQLI_BOOLEAN_OR_BENCHMARK',
    score: 25,
    regex: /(\bor\b|\band\b)\s+['"]?(\d+|true)['"]?\s*=\s*['"]?(\d+|true)['"]?|benchmark\s*\(|sleep\s*\(|waitfor\s+delay|load_file\s*\(/i
  },
  {
    name: 'SQLI_COMMENT_TRICK',
    score: 20,
    regex: /(--\s*$|\/\*!\d*|\bexec(\s|\+)+(s|x)p)/i
  },
  // NoSQL Injection patterns
  {
    name: 'NOSQL_INJECTION',
    score: 25,
    regex: /\$(where|regex|gt|gte|lt|lte|ne|nin|exists|expr|lookup)\b/i
  },
  // Remote Code Execution / Shell Command Injection
  {
    name: 'RCE_COMMAND_INJECTION',
    score: 35,
    regex: /(;\s*|\b(sh|bash|powershell|cmd)\b\s*-[ce]|\$\(|\`|\|)\s*(rm\s+-rf|curl|wget|nc|python|perl|whoami|uname|id|cat\s+\/etc)/i
  },
  // Path Traversal / LFI
  {
    name: 'PATH_TRAVERSAL_LFI',
    score: 25,
    regex: /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%252e%252e%252f|\/etc\/passwd|\/etc\/shadow|c:\\windows\\system32)/i
  },
  // Cross-Site Scripting / Malicious Script Tags in API Parameters
  {
    name: 'MALICIOUS_SCRIPT_TAG',
    score: 20,
    regex: /(<script\b[^>]*>|<\/script>|javascript:\s*|data:\s*text\/html|vbscript:|on(load|error|click|focus)\s*=)/i
  },
  // Automated Hacker Scanners User-Agent
  {
    name: 'HACKER_SCANNER_USER_AGENT',
    score: 20,
    regex: /(sqlmap|nikto|acunetix|dirbuster|gobuster|wpscan|hydra|nmap|masscan|zgrab|nessus|openvas|vega|arachni|havij|morfeus)/i
  }
];

/**
 * Extracts and normalizes client IP address
 */
function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Inspects all aspects of an incoming request for attack signatures
 */
function inspectRequest(req: express.Request): { isAttack: boolean; threatScore: number; reasons: string[] } {
  const reasons: string[] = [];
  let threatScore = 0;

  // 1. Check Path Probes (Honeypot Decoy)
  const path = req.path;
  for (const probeRegex of HONEYPOT_PROBE_PATHS) {
    if (probeRegex.test(path)) {
      reasons.push(`HONEYPOT_PATH_PROBE: ${path}`);
      threatScore += 30;
      break;
    }
  }

  // 2. Check User-Agent
  const userAgent = req.headers['user-agent'] || '';
  for (const sig of EXPLOIT_SIGNATURES) {
    if (sig.name === 'HACKER_SCANNER_USER_AGENT' && sig.regex.test(userAgent)) {
      reasons.push(`SCANNER_USER_AGENT: ${userAgent.slice(0, 40)}`);
      threatScore += sig.score;
    }
  }

  // 3. Check Query String & URL
  const originalUrl = decodeURIComponent(req.originalUrl || req.url || '');
  for (const sig of EXPLOIT_SIGNATURES) {
    if (sig.name !== 'HACKER_SCANNER_USER_AGENT' && sig.regex.test(originalUrl)) {
      reasons.push(`EXPLOIT_IN_URL: ${sig.name}`);
      threatScore += sig.score;
    }
  }

  // 4. Check JSON Body (if available)
  if (req.body && typeof req.body === 'object') {
    const bodyStr = JSON.stringify(req.body);
    for (const sig of EXPLOIT_SIGNATURES) {
      if (sig.name !== 'HACKER_SCANNER_USER_AGENT' && sig.regex.test(bodyStr)) {
        reasons.push(`EXPLOIT_IN_BODY: ${sig.name}`);
        threatScore += sig.score;
      }
    }
  }

  return {
    isAttack: reasons.length > 0,
    threatScore,
    reasons
  };
}

/**
 * Calculates adaptive tarpit delay in milliseconds.
 * Escalates dynamically with attack count ("fairwall utna majbut hota rahe").
 */
function calculateTarpitDelay(attackCount: number): number {
  if (attackCount <= 0) return 0;
  // Delay starts at 2.5s, grows exponentially up to 35s
  const baseDelay = 2500;
  const growth = Math.pow(1.65, Math.min(8, attackCount - 1));
  return Math.min(35000, Math.floor(baseDelay * growth));
}

/**
 * Generates realistic decoy responses for honeypot probes
 */
function generateDecoyHoneypot(path: string, ip: string, attackCount: number): { type: 'text' | 'json' | 'html'; content: any } {
  const seed = Math.floor(100000 + Math.random() * 900000);
  const fakeToken = `IR-SEC-T7-${Buffer.from(`${ip}:${seed}:${Date.now()}`).toString('hex').slice(0, 48).toUpperCase()}`;

  // Fake .env configuration
  if (path.includes('.env')) {
    return {
      type: 'text',
      content: `# =========================================================
# INDIAN RAILWAYS TRACK MACHINE MANAGEMENT SYSTEM (RMMS)
# SECURE QUANTUM GRID NODE CONFIGURATION (CLASSIFIED / LEVEL-4)
# =========================================================
RMMS_NODE_IDENTIFIER=NR-HQ-DELHI-SEC-CORE-092
GRID_ENVIRONMENT=PRODUCTION_SECURED
ENCRYPTED_VAULT_KEY=${fakeToken}
QUANTUM_CHALLENGE_ROUTER=/api/quantum-auth/labyrinth?phase=alpha&seed=${seed}&node=NR-HQ-DELHI-092
CIPHER_SUITE=CHACHA20-POLY1305-RAIL-GRID
DATABASE_CLUSTER=railway-cluster-sharded-node9.sec.rail.gov.in
VAULT_ROTATION_INTERVAL=300
AUTH_CHALLENGE_SIGNATURE=0x${Buffer.from(fakeToken).toString('hex').slice(0, 32)}
`
    };
  }

  // Fake WordPress / PHP / Admin Panel Honeypot
  if (path.includes('wp-') || path.includes('admin') || path.includes('php') || path.includes('shell')) {
    return {
      type: 'html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Indian Railways RMMS - Intranet Security Gate</title>
  <style>
    body { background: #0b0f19; color: #94a3b8; font-family: monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #f59e0b; font-size: 16px; margin-bottom: 8px; letter-spacing: 2px; }
    .status { color: #38bdf8; font-size: 12px; margin-bottom: 20px; }
    .hash { background: #070a12; padding: 12px; border-radius: 6px; font-size: 11px; word-break: break-all; color: #a78bfa; margin-bottom: 20px; border: 1px solid #312e81; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>INDIAN RAILWAYS RMMS GATEWAY</h1>
    <p class="status">● SECURE HARDENED SUBNET ROUTE [NODE 092]</p>
    <p style="font-size: 13px;">Multi-factor cryptographic biometric synchronization in progress. Challenge hash assigned:</p>
    <div class="hash">${fakeToken}</div>
    <p style="font-size: 11px; color: #64748b; margin-bottom: 24px;">Attempt logged: Sequence #${attackCount} | Security audit triggered.</p>
    <a href="/api/quantum-auth/labyrinth?phase=stage_${attackCount + 1}&seed=${seed}" class="btn">Proceed to Verification Stage</a>
  </div>
</body>
</html>`
    };
  }

  // Default JSON Decoy Quarantine response
  return {
    type: 'json',
    content: {
      status: 'QUANTUM_HONEYPOT_ACTIVE',
      defenseLevel: `ENHANCED_SHIELD_V4_LEVEL_${Math.min(5, attackCount)}`,
      quarantineToken: fakeToken,
      subsystem: 'Indian Railways Intranet Machine Cluster',
      integrityCheckpoint: `/api/quantum-auth/labyrinth?phase=checkpoint_${attackCount}&seed=${seed}`,
      message: 'Packet quarantined by dynamic neural heuristic mesh. Resynchronization challenge required.',
      retryAfterSeconds: Math.floor(calculateTarpitDelay(attackCount) / 1000)
    }
  };
}

/**
 * Express Middleware: Adaptive Honey-pot Tarpit Firewall
 */
export function adaptiveFirewallMiddleware() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Whitelist static production frontend assets and health endpoints for instant delivery
    const p = req.path;
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const isCloudProbe =
      p === '/healthz' || 
      p === '/health' || 
      p === '/' ||
      userAgent.includes('googlehc') ||
      userAgent.includes('kube-probe') ||
      userAgent.includes('healthcheck') ||
      Boolean(req.headers['x-google-cloud-run']);

    if (
      isCloudProbe ||
      p.startsWith('/assets/') || 
      p.endsWith('.js') || 
      p.endsWith('.css') || 
      p.endsWith('.png') || 
      p.endsWith('.jpg') || 
      p.endsWith('.svg') || 
      p.endsWith('.ico') ||
      p.endsWith('.woff2')
    ) {
      return next();
    }

    const clientIp = getClientIp(req);
    // Never tarpit local health check or loopback requests
    if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') {
      return next();
    }
    let record = threatStore.get(clientIp);

    // Check if IP is currently quarantined
    const now = Date.now();
    if (record && record.quarantineUntil && now < record.quarantineUntil) {
      const remainingSeconds = Math.ceil((record.quarantineUntil - now) / 1000);
      // Stall connection dynamically to consume hacker's scanner sockets
      await new Promise(resolve => setTimeout(resolve, 8000));
      return res.status(429).json({
        success: false,
        error: 'Terminal access quarantined due to persistent automated security policy violations.',
        retryAfter: remainingSeconds,
        quarantineNode: 'RMMS-AUTODEFENSE-LEVEL-5'
      });
    }

    // Inspect the incoming request
    const inspection = inspectRequest(req);

    // If clean legitimate request without exploit signature, proceed immediately with zero delay
    if (!inspection.isAttack) {
      return next();
    }

    // Initialize or update threat record
    if (!record) {
      record = {
        ip: clientIp,
        threatScore: 0,
        attackCount: 0,
        firstDetected: now,
        lastAttack: now,
        activeAttacks: []
      };
      threatStore.set(clientIp, record);
    }

    // Escalate threat metrics ("fairwall utna majbut hota rahe")
    record.attackCount += 1;
    record.threatScore += inspection.threatScore || 15;
    record.lastAttack = now;
    if (inspection.reasons.length > 0) {
      record.activeAttacks.push(...inspection.reasons);
      if (record.activeAttacks.length > 20) {
        record.activeAttacks = record.activeAttacks.slice(-20);
      }
    }

    // If attacks exceed threshold, quarantine the IP for 1 hour
    if (record.attackCount >= 8 || record.threatScore >= 120) {
      record.quarantineUntil = now + 60 * 60 * 1000;
    }

    // Calculate dynamic tarpit hold time (stalls automated attack bots)
    const tarpitDelay = calculateTarpitDelay(record.attackCount);

    console.warn(`[RMMS Honey-pot Active] IP ${clientIp} triggered attack signature! Count: ${record.attackCount}, Threat Score: ${record.threatScore}. Tarpitting for ${tarpitDelay}ms. Vectors: ${inspection.reasons.join(', ')}`);

    // Dynamic Socket Tarpit: Hold open connection to drain attacker threads
    await new Promise(resolve => setTimeout(resolve, tarpitDelay));

    // Serve Deceptive Decoy Honey-pot ("Idhar-Udhar Uljhana")
    const decoy = generateDecoyHoneypot(req.path, clientIp, record.attackCount);

    res.setHeader('X-Defense-Mesh', 'RMMS-Quantum-Shield-v4.9');
    res.setHeader('X-Threat-Level', String(Math.min(5, record.attackCount)));

    if (decoy.type === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(decoy.content);
    } else if (decoy.type === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(decoy.content);
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json(decoy.content);
    }
  };
}

/**
 * Registers the infinite deceptive labyrinth routes ("Idhar-Udhar Uljhana")
 * Hacker automated tools or curious attackers following decoy clues get caught
 * in endless recursive simulated challenges that burn their resources.
 */
export function registerDeceptiveLabyrinthRoutes(app: express.Application) {
  // Infinite recursive cryptographic maze
  app.all('/api/quantum-auth/labyrinth', async (req, res) => {
    const clientIp = getClientIp(req);
    let record = threatStore.get(clientIp);
    const count = (record?.attackCount || 1) + 1;

    if (record) {
      record.attackCount = count;
      record.threatScore += 10;
      record.lastAttack = Date.now();
    }

    // Dynamic escalating delay
    const delay = calculateTarpitDelay(count);
    await new Promise(resolve => setTimeout(resolve, delay));

    const phase = (req.query.phase as string) || 'alpha';
    const nextPhases = ['beta', 'gamma', 'delta', 'epsilon', 'zeta', 'omega', 'prime', 'theta', 'alpha'];
    const currentIdx = nextPhases.indexOf(phase.toLowerCase());
    const nextPhase = nextPhases[(currentIdx + 1) % nextPhases.length];
    const newSeed = Math.floor(100000 + Math.random() * 900000);

    return res.json({
      status: 'LABYRINTH_STEP_VERIFIED',
      completedPhase: phase,
      nextPhaseRequirement: nextPhase,
      handshakeChallenge: `/api/quantum-auth/labyrinth?phase=${nextPhase}&seed=${newSeed}&checksum=0x${Buffer.from(`${newSeed}:${count}`).toString('hex')}`,
      algorithm: 'ECC-POLYNOMIAL-SHUFFLE-V9',
      entropyResidual: '0x' + Math.random().toString(16).slice(2, 10),
      message: 'Sub-system clearance verified. Advance to next cryptographic checkpoint within 60s.',
      systemLoadTarpit: `${delay}ms`
    });
  });

  // Diagnostic route for admin monitoring of blocked threats
  app.get('/api/security-status/health-summary', (req, res) => {
    // Only return aggregate statistics (no sensitive leak)
    let totalTracked = threatStore.size;
    let highThreatCount = 0;
    for (const rec of threatStore.values()) {
      if (rec.threatScore > 50) highThreatCount++;
    }

    res.json({
      status: 'active',
      engine: 'RMMS Adaptive Honeypot Tarpit Mesh v4.9',
      activeTrackedThreats: totalTracked,
      quarantinedAttackers: highThreatCount,
      timestamp: new Date().toISOString()
    });
  });
}
