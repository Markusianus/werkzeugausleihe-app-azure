require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const {
  normalizeEmailList,
  isMailConfigured,
  sendEmail,
  buildReservationEmail,
  buildStatusEmail,
  buildOverdueDigestEmail
} = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'admin123');
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || ADMIN_PASSWORD || 'toolhub-dev-admin-secret');
const ADMIN_TOKEN_TTL_HOURS = Math.max(1, Number.parseInt(process.env.ADMIN_TOKEN_TTL_HOURS || '12', 10) || 12);
const REQUEST_BODY_LIMIT = String(process.env.REQUEST_BODY_LIMIT || '2mb');
const TRUST_PROXY = String(process.env.TRUST_PROXY || '1').trim().toLowerCase();
const ALLOWED_TOOL_STATUSES = new Set(['verfuegbar', 'reserviert', 'ausgeliehen', 'defekt', 'reinigung', 'reparatur']);
const ALLOWED_DAMAGE_STATUSES = new Set(['offen', 'behoben']);
const ALLOWED_BOOKING_STATUSES = new Set(['reserviert', 'ausgeliehen', 'zurueckgegeben']);
const ALLOWED_RETURN_CONDITIONS = new Set(['gut', 'gebraucht', 'defekt', 'reinigung', 'reparatur']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = Math.max(64 * 1024, Number.parseInt(process.env.MAX_IMAGE_BYTES || String(2 * 1024 * 1024), 10) || 2 * 1024 * 1024);
const MAX_TEXT_LENGTH = {
  short: 120,
  medium: 255,
  long: 2000,
  note: 5000
};

if (TRUST_PROXY === '1' || TRUST_PROXY === 'true' || TRUST_PROXY === 'loopback') {
  app.set('trust proxy', 1);
}

// PostgreSQL Connection Pool
console.log('DB Config:', {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL
});
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

function parseDurationMs(rawValue, fallbackMs) {
  if (!rawValue) return fallbackMs;
  const value = String(rawValue).trim().toLowerCase();
  const match = value.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) return fallbackMs;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] || 'ms';
  const factor = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
  return amount * factor;
}

function parseAllowedOrigins() {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.ALLOWED_ORIGINS
  ]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return [...new Set(candidates)];
}

const allowedOrigins = parseAllowedOrigins();

function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

function createRateLimiter({ windowMs, max, keyGenerator, label }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : req.ip || 'unknown';
    const bucket = hits.get(key);

    if (!bucket || bucket.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: 'Zu viele Anfragen. Bitte später erneut versuchen.',
        code: 'rate_limited',
        scope: label,
        retry_after_seconds: retryAfterSeconds
      });
    }

    bucket.count += 1;
    next();
  };
}

const globalApiLimiter = createRateLimiter({
  windowMs: parseDurationMs(process.env.RATE_LIMIT_WINDOW_MS || '15m', 15 * 60 * 1000),
  max: Math.max(20, Number.parseInt(process.env.RATE_LIMIT_MAX || '300', 10) || 300),
  label: 'global_api'
});

const authLimiter = createRateLimiter({
  windowMs: parseDurationMs(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '15m', 15 * 60 * 1000),
  max: Math.max(3, Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10) || 10),
  label: 'admin_auth'
});

const adminActionLimiter = createRateLimiter({
  windowMs: parseDurationMs(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '5m', 5 * 60 * 1000),
  max: Math.max(5, Number.parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '60', 10) || 60),
  label: 'admin_actions'
});

// Middleware
app.use(applySecurityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalizedOrigin = String(origin).replace(/\/$/, '');
    if (!allowedOrigins.length || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin nicht erlaubt')); 
  },
  credentials: true
}));
app.use(bodyParser.json({ limit: REQUEST_BODY_LIMIT }));
app.use(bodyParser.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
app.use('/api', globalApiLimiter);

// Request logging (Helps debugging 404s in Azure)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.ip} ${req.method} ${req.originalUrl}`);
  next();
});

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createAdminToken() {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (ADMIN_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

function verifyAdminToken(token) {
  if (!token) return false;

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [issuedAt, expiresAt, nonce, signature] = decoded.split('.');
    if (!issuedAt || !expiresAt || !nonce || !signature) return false;

    const payload = `${issuedAt}.${expiresAt}.${nonce}`;
    const expectedSignature = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payload).digest('hex');
    const provided = Buffer.from(signature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');

    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return false;
    }

    return Number.parseInt(expiresAt, 10) > Date.now();
  } catch (error) {
    return false;
  }
}

function normalizeIsoDate(dateInput) {
  if (!dateInput) return null;
  const value = String(dateInput).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeDateInput(dateInput) {
  return normalizeIsoDate(dateInput);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function coercePositiveIntegerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function coerceNonNegativeIntegerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function coerceNullableText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function sanitizeText(value, { maxLength = MAX_TEXT_LENGTH.medium, allowEmpty = false } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const normalized = String(value).replace(/\0/g, '').trim();
  if (!normalized) return allowEmpty ? '' : null;
  return normalized.slice(0, maxLength);
}

function sanitizeEnum(value, allowedValues) {
  const normalized = sanitizeText(value, { maxLength: MAX_TEXT_LENGTH.short });
  if (!normalized) return null;
  return allowedValues.has(normalized) ? normalized : null;
}

function normalizeId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function validateBase64Image(value) {
  const input = sanitizeText(value, { maxLength: MAX_IMAGE_BYTES * 2, allowEmpty: false });
  if (!input) return { value: null, error: null };

  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return { value: null, error: 'Bild muss als gültige data:image/*;base64-URL übertragen werden' };
  }

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return { value: null, error: 'Nicht erlaubter Bildtyp' };
  }

  const base64Payload = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer.length) {
    return { value: null, error: 'Leeres Bild ist nicht erlaubt' };
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    return { value: null, error: `Bild ist zu groß (max. ${MAX_IMAGE_BYTES} Bytes)` };
  }

  return { value: `data:${mimeType};base64,${base64Payload}`, error: null };
}

function validateToolPayload(body, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  const assignRequiredText = (field, maxLength) => {
    const value = sanitizeText(body[field], { maxLength });
    if (!value && !partial) errors.push(`${field} ist erforderlich`);
    if (value) payload[field] = value;
  };

  const assignOptionalText = (field, maxLength) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = sanitizeText(body[field], { maxLength }) || null;
    }
  };

  assignRequiredText('name', MAX_TEXT_LENGTH.medium);
  assignRequiredText('inventarnummer', MAX_TEXT_LENGTH.short);
  assignOptionalText('icon', MAX_TEXT_LENGTH.short);
  assignOptionalText('beschreibung', MAX_TEXT_LENGTH.note);
  assignOptionalText('zustand', MAX_TEXT_LENGTH.short);
  assignOptionalText('kategorie', MAX_TEXT_LENGTH.short);
  assignOptionalText('lagerplatz', MAX_TEXT_LENGTH.short);
  assignOptionalText('wartung_notiz', MAX_TEXT_LENGTH.long);

  const bestandGesamt = coercePositiveIntegerOrNull(body.bestand_gesamt);
  if (Object.prototype.hasOwnProperty.call(body, 'bestand_gesamt')) {
    if (body.bestand_gesamt !== null && body.bestand_gesamt !== '' && bestandGesamt === null) {
      errors.push('bestand_gesamt muss eine positive Ganzzahl sein');
    }
    payload.bestand_gesamt = bestandGesamt;
  }

  const bestandDefekt = coerceNonNegativeIntegerOrNull(body.bestand_defekt);
  if (Object.prototype.hasOwnProperty.call(body, 'bestand_defekt')) {
    if (body.bestand_defekt !== null && body.bestand_defekt !== '' && bestandDefekt === null) {
      errors.push('bestand_defekt muss eine Ganzzahl ab 0 sein');
    }
    payload.bestand_defekt = bestandDefekt;
  }

  const bestandInWartung = coerceNonNegativeIntegerOrNull(body.bestand_in_wartung);
  if (Object.prototype.hasOwnProperty.call(body, 'bestand_in_wartung')) {
    if (body.bestand_in_wartung !== null && body.bestand_in_wartung !== '' && bestandInWartung === null) {
      errors.push('bestand_in_wartung muss eine Ganzzahl ab 0 sein');
    }
    payload.bestand_in_wartung = bestandInWartung;
  }

  if (
    bestandGesamt !== null &&
    bestandDefekt !== null &&
    bestandDefekt > bestandGesamt
  ) {
    errors.push('bestand_defekt darf nicht größer als bestand_gesamt sein');
  }

  if (
    bestandGesamt !== null &&
    bestandInWartung !== null &&
    bestandInWartung > bestandGesamt
  ) {
    errors.push('bestand_in_wartung darf nicht größer als bestand_gesamt sein');
  }

  if (
    bestandGesamt !== null &&
    bestandDefekt !== null &&
    bestandInWartung !== null &&
    (bestandDefekt + bestandInWartung) > bestandGesamt
  ) {
    errors.push('Defekte und Wartungseinheiten zusammen dürfen den Gesamtbestand nicht überschreiten');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = sanitizeEnum(body.status, ALLOWED_TOOL_STATUSES);
    if (!status) errors.push('Ungültiger Status');
    else payload.status = status;
  }

  const wartungsintervallTage = coercePositiveIntegerOrNull(body.wartungsintervall_tage);
  if (Object.prototype.hasOwnProperty.call(body, 'wartungsintervall_tage')) {
    if (body.wartungsintervall_tage !== null && body.wartungsintervall_tage !== '' && wartungsintervallTage === null) {
      errors.push('wartungsintervall_tage muss eine positive Ganzzahl sein');
    }
    payload.wartungsintervall_tage = wartungsintervallTage;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'letzte_wartung_am')) {
    const letzteWartungAm = body.letzte_wartung_am ? normalizeIsoDate(body.letzte_wartung_am) : null;
    if (body.letzte_wartung_am && !letzteWartungAm) {
      errors.push('letzte_wartung_am hat kein gültiges Datum');
    }
    payload.letzte_wartung_am = letzteWartungAm;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'foto')) {
    const foto = validateBase64Image(body.foto);
    if (foto.error) errors.push(`foto: ${foto.error}`);
    payload.foto = foto.value;
  }

  return { valid: errors.length === 0, errors, payload };
}

function validateBookingPayload(body) {
  const errors = [];
  const mitarbeiter_name = sanitizeText(body.mitarbeiter_name, { maxLength: MAX_TEXT_LENGTH.medium });
  const mitarbeiter_email = normalizeEmail(body.mitarbeiter_email);
  const projektnummer = sanitizeText(body.projektnummer, { maxLength: MAX_TEXT_LENGTH.short });
  const datum_von = normalizeIsoDate(body.datum_von);
  const datum_bis = normalizeIsoDate(body.datum_bis);
  const werkzeuge = Array.isArray(body.werkzeuge)
    ? [...new Set(body.werkzeuge.map(normalizeId).filter(Boolean))]
    : [];

  if (!mitarbeiter_name) errors.push('mitarbeiter_name ist erforderlich');
  if (body.mitarbeiter_email && !mitarbeiter_email) errors.push('mitarbeiter_email ist ungültig');
  if (!projektnummer) {
    errors.push('projektnummer ist erforderlich');
  } else if (!/^T-\d{5}$/i.test(projektnummer)) {
    errors.push('projektnummer muss dem Format T-12345 entsprechen');
  }
  if (!datum_von || !datum_bis) errors.push('datum_von und datum_bis müssen gültige Datumswerte sein');
  if (datum_von && datum_bis && datum_von >= datum_bis) errors.push('Das Bis-Datum muss nach dem Von-Datum liegen');
  if (!werkzeuge.length) errors.push('Mindestens ein gültiges Werkzeug ist erforderlich');
  if (werkzeuge.length > 20) errors.push('Es dürfen maximal 20 Werkzeuge gleichzeitig reserviert werden');

  return {
    valid: errors.length === 0,
    errors,
    payload: {
      werkzeuge,
      mitarbeiter_name,
      mitarbeiter_email,
      projektnummer: projektnummer ? projektnummer.toUpperCase() : null,
      datum_von,
      datum_bis
    }
  };
}

function validateDamagePayload(body) {
  const errors = [];
  const werkzeug_id = normalizeId(body.werkzeug_id);
  const mitarbeiter_name = sanitizeText(body.mitarbeiter_name, { maxLength: MAX_TEXT_LENGTH.medium });
  const beschreibung = sanitizeText(body.beschreibung, { maxLength: MAX_TEXT_LENGTH.note });
  const foto = validateBase64Image(body.foto);

  if (!werkzeug_id) errors.push('werkzeug_id muss eine positive Ganzzahl sein');
  if (!mitarbeiter_name) errors.push('mitarbeiter_name ist erforderlich');
  if (!beschreibung) errors.push('beschreibung ist erforderlich');
  if (foto.error) errors.push(`foto: ${foto.error}`);

  return {
    valid: errors.length === 0,
    errors,
    payload: {
      werkzeug_id,
      mitarbeiter_name,
      beschreibung,
      foto: foto.value
    }
  };
}

function validateReturnPayload(body) {
  const errors = [];
  const rueckgabe_zustand = sanitizeEnum(body.rueckgabe_zustand, ALLOWED_RETURN_CONDITIONS);
  const rueckgabe_kommentar = sanitizeText(body.rueckgabe_kommentar, { maxLength: MAX_TEXT_LENGTH.long }) || null;

  if (!rueckgabe_zustand) errors.push('rueckgabe_zustand ist ungültig');

  return {
    valid: errors.length === 0,
    errors,
    payload: { rueckgabe_zustand, rueckgabe_kommentar }
  };
}

function validateMaintenancePayload(body) {
  const errors = [];
  const durchgefuehrt_am = body.durchgefuehrt_am ? normalizeIsoDate(body.durchgefuehrt_am) : new Date().toISOString().slice(0, 10);
  const notiz = sanitizeText(body.notiz, { maxLength: MAX_TEXT_LENGTH.long }) || null;

  if (body.durchgefuehrt_am && !durchgefuehrt_am) errors.push('durchgefuehrt_am ist ungültig');

  return {
    valid: errors.length === 0,
    errors,
    payload: { durchgefuehrt_am, notiz }
  };
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function buildPersonContact(name, email) {
  const normalizedEmail = normalizeEmail(email);
  return {
    name: String(name || '').trim(),
    email: normalizedEmail
  };
}

function calculateNextMaintenanceDate(lastMaintenanceDate, intervalDays) {
  if (!lastMaintenanceDate || !intervalDays) return null;
  return addDays(lastMaintenanceDate, intervalDays);
}

function calculateMaintenanceStatus(nextMaintenanceDate) {
  if (!nextMaintenanceDate) return 'kein_intervall';

  const today = new Date().toISOString().slice(0, 10);
  if (nextMaintenanceDate < today) return 'ueberfaellig';
  if (nextMaintenanceDate === today) return 'faellig';
  return 'geplant';
}

function escapePdfText(value) {
  return String(value ?? '').trim() || '-';
}

function mailNotificationsEnabled() {
  return isMailConfigured();
}

function getNotificationSettings() {
  return {
    reservationConfirmation: String(process.env.MAIL_SEND_RESERVATION_CONFIRMATION || 'true').trim().toLowerCase() !== 'false',
    checkoutConfirmation: String(process.env.MAIL_SEND_CHECKOUT_CONFIRMATION || 'true').trim().toLowerCase() !== 'false',
    returnConfirmation: String(process.env.MAIL_SEND_RETURN_CONFIRMATION || 'true').trim().toLowerCase() !== 'false',
    overdueDigest: String(process.env.MAIL_SEND_OVERDUE_DIGEST || 'true').trim().toLowerCase() !== 'false'
  };
}

async function sendBestEffortEmail(messageFactory, contextLabel) {
  if (!mailNotificationsEnabled()) {
    return { skipped: true, reason: 'mail_not_configured' };
  }

  try {
    const payload = await messageFactory();
    if (!payload || !payload.to) {
      return { skipped: true, reason: 'missing_recipient' };
    }
    return await sendEmail(payload);
  } catch (error) {
    console.error(`✉️ Mailversand fehlgeschlagen (${contextLabel}):`, error.message);
    return { skipped: false, error: error.message };
  }
}

async function fetchBookingWithTool(client, bookingId) {
  const result = await client.query(`
    SELECT
      a.*, w.name AS tool_name, w.inventarnummer, w.icon
    FROM ausleihen a
    JOIN werkzeuge w ON w.id = a.werkzeug_id
    WHERE a.id = $1
  `, [bookingId]);

  return result.rows[0] || null;
}

async function ensureEmailSchema() {
  await pool.query(`
    ALTER TABLE ausleihen
    ADD COLUMN IF NOT EXISTS mitarbeiter_email TEXT
  `);
  await pool.query(`
    ALTER TABLE ausleihen
    ADD COLUMN IF NOT EXISTS projektnummer TEXT
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_notifications_log (
      id SERIAL PRIMARY KEY,
      notification_type TEXT NOT NULL,
      recipient TEXT,
      metadata JSONB,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}


async function ensureAuditLogSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      ip_address TEXT,
      actor TEXT,
      success BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC)
  `);
}

async function logEmailNotification(client, notificationType, recipient, metadata = {}) {
  await client.query(`
    INSERT INTO email_notifications_log (notification_type, recipient, metadata)
    VALUES ($1, $2, $3::jsonb)
  `, [notificationType, recipient || null, JSON.stringify(metadata || {})]);
}

async function logAdminAudit({ req, action, success = true, actor = 'admin', metadata = {} }) {
  try {
    await pool.query(`
      INSERT INTO admin_audit_log (action, path, method, ip_address, actor, success, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [
      action,
      req.originalUrl,
      req.method,
      req.ip || null,
      actor,
      success,
      JSON.stringify(metadata || {})
    ]);
  } catch (error) {
    console.error('Audit-Log fehlgeschlagen:', error.message);
  }
}

async function hasEmailNotificationBeenSentToday(client, notificationType, recipient) {
  if (!recipient) return false;

  const result = await client.query(`
    SELECT 1
    FROM email_notifications_log
    WHERE notification_type = $1
      AND recipient = $2
      AND (sent_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
    LIMIT 1
  `, [notificationType, recipient]);

  return result.rows.length > 0;
}

async function runOverdueDigest(client, { force = false } = {}) {
  const settings = getNotificationSettings();
  if (!mailNotificationsEnabled()) {
    return { skipped: true, reason: 'mail_not_configured', sent: 0, overdueCount: 0 };
  }

  if (!settings.overdueDigest) {
    return { skipped: true, reason: 'overdue_digest_disabled', sent: 0, overdueCount: 0 };
  }

  const adminRecipients = normalizeEmailList(process.env.MAIL_OVERDUE_RECIPIENTS || process.env.MAIL_ADMIN_TO || '');
  if (!adminRecipients.length) {
    return { skipped: true, reason: 'missing_admin_recipients', sent: 0, overdueCount: 0 };
  }

  const overdueResult = await client.query(`
    SELECT
      a.id,
      a.mitarbeiter_name,
      a.mitarbeiter_email,
      a.datum_von,
      a.datum_bis,
      a.status,
      w.name AS tool_name,
      w.inventarnummer
    FROM ausleihen a
    JOIN werkzeuge w ON w.id = a.werkzeug_id
    WHERE a.status = 'ausgeliehen'
      AND a.datum_bis < CURRENT_DATE
    ORDER BY a.datum_bis ASC, a.id ASC
  `);

  const rows = overdueResult.rows;
  if (!rows.length) {
    return { skipped: true, reason: 'no_overdue_items', sent: 0, overdueCount: 0 };
  }

  let sent = 0;
  for (const recipient of adminRecipients) {
    if (!force) {
      const alreadySent = await hasEmailNotificationBeenSentToday(client, 'overdue_digest', recipient);
      if (alreadySent) {
        continue;
      }
    }

    const mail = buildOverdueDigestEmail({ rows, recipient: { email: recipient, name: 'Admin' } });
    const result = await sendBestEffortEmail(() => ({ to: recipient, ...mail }), `overdue_digest:${recipient}`);
    if (!result.skipped && !result.error) {
      await logEmailNotification(client, 'overdue_digest', recipient, {
        count: rows.length,
        booking_ids: rows.map(row => row.id)
      });
      sent += 1;
    }
  }

  return {
    skipped: false,
    sent,
    overdueCount: rows.length,
    recipients: adminRecipients.length
  };
}

function startDailyOverdueScheduler() {
  const enabled = String(process.env.MAIL_ENABLE_OVERDUE_SCHEDULER || 'false').trim().toLowerCase() === 'true';
  if (!enabled) {
    console.log('ℹ️ Overdue-Scheduler deaktiviert');
    return;
  }

  if (!mailNotificationsEnabled()) {
    console.log('ℹ️ Overdue-Scheduler nicht gestartet: Mail-Konfiguration fehlt');
    return;
  }

  const runOnce = async () => {
    const client = await pool.connect();
    try {
      const result = await runOverdueDigest(client);
      console.log('📧 Overdue-Digest Lauf:', result);
    } catch (error) {
      console.error('❌ Overdue-Digest Lauf fehlgeschlagen:', error.message);
    } finally {
      client.release();
    }
  };

  const intervalHours = Math.max(1, Number.parseInt(process.env.MAIL_OVERDUE_INTERVAL_HOURS || '24', 10) || 24);
  const startupDelayMs = Math.max(10, Number.parseInt(process.env.MAIL_OVERDUE_STARTUP_DELAY_MS || '10000', 10) || 10000);

  setTimeout(runOnce, startupDelayMs);
  setInterval(runOnce, intervalHours * 60 * 60 * 1000);
  console.log(`📅 Overdue-Scheduler aktiv (alle ${intervalHours}h)`);
}

function buildToolQrUrl(req, toolId) {
  const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  const fallbackOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  const baseUrl = frontendUrl || fallbackOrigin;
  return `${baseUrl}?tool=${toolId}`;
}

function normalizeInventoryCounts(row) {
  const bestandGesamt = Math.max(1, Number.parseInt(row.bestand_gesamt, 10) || 1);
  const bestandDefekt = Math.max(0, Number.parseInt(row.bestand_defekt, 10) || 0);
  const bestandInWartung = Math.max(0, Number.parseInt(row.bestand_in_wartung, 10) || 0);
  const aktivAusgeliehen = Math.max(0, Number.parseInt(row.aktiv_ausgeliehen, 10) || 0);
  const aktivReserviert = Math.max(0, Number.parseInt(row.aktiv_reserviert, 10) || 0);
  const nichtEinsatzfaehig = Math.min(bestandGesamt, bestandDefekt + bestandInWartung);
  const verfuegbar = Math.max(0, bestandGesamt - nichtEinsatzfaehig - aktivAusgeliehen - aktivReserviert);

  return {
    bestand_gesamt: bestandGesamt,
    bestand_defekt: Math.min(bestandDefekt, bestandGesamt),
    bestand_in_wartung: Math.min(bestandInWartung, bestandGesamt),
    aktiv_ausgeliehen: aktivAusgeliehen,
    aktiv_reserviert: aktivReserviert,
    verfuegbare_einheiten: verfuegbar,
    belegte_einheiten: aktivAusgeliehen + aktivReserviert,
    nicht_einsatzfaehige_einheiten: nichtEinsatzfaehig,
    hat_mehrfachbestand: bestandGesamt > 1
  };
}

function enrichToolRow(row) {
  const inventory = normalizeInventoryCounts(row);
  const wartungsstatus = calculateMaintenanceStatus(row.naechste_wartung_am);
  const derivedStatus = inventory.verfuegbare_einheiten > 0
    ? 'verfuegbar'
    : (inventory.aktiv_ausgeliehen > 0 ? 'ausgeliehen' : (inventory.aktiv_reserviert > 0 ? 'reserviert' : row.status));

  return {
    ...row,
    ...inventory,
    status_abgeleitet: derivedStatus,
    wartungsstatus
  };
}

function buildDefaultUnitLabel(row, index) {
  const base = sanitizeText(row.name, { maxLength: 80 }) || 'Werkzeug';
  return `${base} Einheit ${index}`;
}

async function createToolLabelPdfBuffer(req, tools) {
  const MM_TO_PT = 72 / 25.4;
  const labelWidth = 70 * MM_TO_PT;
  const labelHeight = 37 * MM_TO_PT;
  const columns = 3;
  const rows = 8;
  const pagePaddingX = 0;
  const pagePaddingY = 0;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `QR-Etiketten Werkzeuge (${tools.length})`,
      Author: 'ToolHub',
      Subject: 'Werkzeug QR-Etiketten'
    }
  });

  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const totalGridWidth = columns * labelWidth;
  const totalGridHeight = rows * labelHeight;
  const offsetX = Math.max(pagePaddingX, (doc.page.width - totalGridWidth) / 2);
  const offsetY = Math.max(pagePaddingY, (doc.page.height - totalGridHeight) / 2);
  const labelsPerPage = columns * rows;
  const innerPadding = 6;
  const qrSize = Math.min(labelHeight - innerPadding * 2, 78);
  const textX = innerPadding + qrSize + 6;
  const textWidth = labelWidth - textX - innerPadding;

  for (let index = 0; index < tools.length; index += 1) {
    if (index > 0 && index % labelsPerPage === 0) {
      doc.addPage();
    }

    const slotIndex = index % labelsPerPage;
    const column = slotIndex % columns;
    const row = Math.floor(slotIndex / columns);
    const x = offsetX + column * labelWidth;
    const y = offsetY + row * labelHeight;
    const tool = tools[index];
    const qrValue = String(tool.inventarnummer || '').trim() || String(tool.id);
    const qrDataUrl = await QRCode.toDataURL(qrValue, {
      margin: 0,
      width: 256,
      errorCorrectionLevel: 'M'
    });
    const qrImage = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    const qrX = x + innerPadding;
    const qrY = y + (labelHeight - qrSize) / 2;
    const line1Y = y + innerPadding;
    const line2Y = y + innerPadding + 11;
    const line3Y = y + innerPadding + 22;

    doc.save();
    doc.rect(x, y, labelWidth, labelHeight).lineWidth(0.5).strokeColor('#d1d5db').stroke();
    doc.restore();

    doc.image(qrImage, qrX, qrY, { width: qrSize, height: qrSize });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
    doc.text(escapePdfText(tool.name || 'Werkzeug'), x + textX, line1Y, {
      width: textWidth,
      height: 10,
      ellipsis: true,
      lineBreak: false
    });

    doc.font('Helvetica').fontSize(7).fillColor('#374151');
    doc.text(`Inv.: ${escapePdfText(qrValue)}`, x + textX, line2Y, {
      width: textWidth,
      height: 9,
      ellipsis: true,
      lineBreak: false
    });

    doc.text(`Lager: ${escapePdfText(tool.lagerplatz || 'Nicht angegeben')}`, x + textX, line3Y, {
      width: textWidth,
      height: 9,
      ellipsis: true,
      lineBreak: false
    });
  }

  doc.end();
  return finished;
}

function buildSafeUnitInventoryNumber(baseInventarnummer, toolId, index) {
  const base = sanitizeText(baseInventarnummer, { maxLength: 120 }) || `WZ-${toolId}`;
  return index === 1 ? base : `${base}::${String(index).padStart(2, '0')}`;
}

async function ensureInventorySchema() {
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS bestand_gesamt INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS bestand_defekt INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS bestand_in_wartung INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS einheitenmodell TEXT NOT NULL DEFAULT 'legacy_single'
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS seriennummernpflicht BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS standard_hersteller TEXT
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS standard_modell TEXT
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS werkzeug_einheiten (
      id SERIAL PRIMARY KEY,
      werkzeug_id INTEGER NOT NULL,
      einheiten_code TEXT UNIQUE NOT NULL,
      inventarnummer TEXT UNIQUE,
      seriennummer TEXT,
      bezeichnung TEXT,
      status TEXT NOT NULL DEFAULT 'verfuegbar',
      zustand TEXT,
      lagerplatz TEXT,
      anschaffungsdatum DATE,
      hersteller TEXT,
      modell TEXT,
      qr_code TEXT,
      aktiv BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (werkzeug_id) REFERENCES werkzeuge(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS werkzeug_einheit_historie (
      id SERIAL PRIMARY KEY,
      werkzeug_einheit_id INTEGER NOT NULL,
      event_typ TEXT NOT NULL,
      event_status TEXT,
      referenz_typ TEXT,
      referenz_id INTEGER,
      notiz TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (werkzeug_einheit_id) REFERENCES werkzeug_einheiten(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_werkzeug_einheiten_werkzeug_id ON werkzeug_einheiten(werkzeug_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_werkzeug_einheiten_status ON werkzeug_einheiten(status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_werkzeug_einheit_historie_einheit_id ON werkzeug_einheit_historie(werkzeug_einheit_id, created_at DESC)
  `);
  await pool.query(`
    UPDATE werkzeuge
    SET bestand_gesamt = 1
    WHERE bestand_gesamt IS NULL OR bestand_gesamt < 1
  `);
  await pool.query(`
    UPDATE werkzeuge
    SET bestand_defekt = GREATEST(COALESCE(bestand_defekt, 0), 0),
        bestand_in_wartung = GREATEST(COALESCE(bestand_in_wartung, 0), 0)
  `);

  const toolRows = await pool.query(`
    SELECT id, name, inventarnummer, zustand, lagerplatz, status, bestand_gesamt, bestand_defekt, bestand_in_wartung,
           einheitenmodell, standard_hersteller, standard_modell
    FROM werkzeuge
    ORDER BY id ASC
  `);

  for (const row of toolRows.rows) {
    const targetCount = Math.max(1, Number.parseInt(row.bestand_gesamt, 10) || 1);
    const existingUnits = await pool.query(
      'SELECT id FROM werkzeug_einheiten WHERE werkzeug_id = $1 ORDER BY id ASC',
      [row.id]
    );

    if (!existingUnits.rows.length) {
      const defectCount = Math.min(targetCount, Math.max(0, Number.parseInt(row.bestand_defekt, 10) || 0));
      const maintenanceCount = Math.min(targetCount - defectCount, Math.max(0, Number.parseInt(row.bestand_in_wartung, 10) || 0));

      for (let index = 1; index <= targetCount; index += 1) {
        let unitStatus = 'verfuegbar';
        if (index <= defectCount) unitStatus = 'defekt';
        else if (index <= defectCount + maintenanceCount) unitStatus = 'reparatur';
        else if (targetCount === 1 && row.status) unitStatus = row.status;

        const unitCode = `WZE-${row.id}-${String(index).padStart(3, '0')}`;
        const unitInventarnummer = buildSafeUnitInventoryNumber(row.inventarnummer, row.id, index);
        const unitLabel = buildDefaultUnitLabel(row, index);

        const inserted = await pool.query(`
          INSERT INTO werkzeug_einheiten (
            werkzeug_id, einheiten_code, inventarnummer, bezeichnung, status, zustand, lagerplatz, hersteller, modell, qr_code
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          row.id,
          unitCode,
          unitInventarnummer,
          unitLabel,
          unitStatus,
          row.zustand || null,
          row.lagerplatz || null,
          row.standard_hersteller || null,
          row.standard_modell || null,
          unitCode
        ]);

        await pool.query(`
          INSERT INTO werkzeug_einheit_historie (werkzeug_einheit_id, event_typ, event_status, referenz_typ, notiz, metadata)
          VALUES ($1, 'bootstrap', $2, 'werkzeug', $3, $4::jsonb)
        `, [
          inserted.rows[0].id,
          unitStatus,
          'Automatisch aus bestehendem Werkzeugbestand angelegt',
          JSON.stringify({ werkzeug_id: row.id, index, source: 'ensureInventorySchema' })
        ]);
      }
    }

    await pool.query(`
      UPDATE werkzeuge
      SET einheitenmodell = CASE WHEN bestand_gesamt > 1 THEN 'tracked_units' ELSE einheitenmodell END
      WHERE id = $1
    `, [row.id]);
  }
}

async function ensureMaintenanceSchema() {
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS wartungsintervall_tage INTEGER
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS letzte_wartung_am DATE
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS naechste_wartung_am DATE
  `);
  await pool.query(`
    ALTER TABLE werkzeuge
    ADD COLUMN IF NOT EXISTS wartung_notiz TEXT
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wartungen (
      id SERIAL PRIMARY KEY,
      werkzeug_id INTEGER NOT NULL,
      durchgefuehrt_am DATE NOT NULL,
      notiz TEXT,
      erstellt_am TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (werkzeug_id) REFERENCES werkzeuge(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_werkzeuge_naechste_wartung_am ON werkzeuge(naechste_wartung_am)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wartungen_werkzeug_id ON wartungen(werkzeug_id)
  `);

  await pool.query(`
    UPDATE werkzeuge
    SET naechste_wartung_am =
      CASE
        WHEN wartungsintervall_tage IS NOT NULL AND wartungsintervall_tage > 0 AND letzte_wartung_am IS NOT NULL
          THEN letzte_wartung_am + wartungsintervall_tage
        ELSE NULL
      END
    WHERE
      (wartungsintervall_tage IS NOT NULL OR letzte_wartung_am IS NOT NULL)
      AND (
        (wartungsintervall_tage IS NOT NULL AND wartungsintervall_tage > 0 AND letzte_wartung_am IS NOT NULL AND naechste_wartung_am IS DISTINCT FROM (letzte_wartung_am + wartungsintervall_tage))
        OR ((wartungsintervall_tage IS NULL OR wartungsintervall_tage <= 0 OR letzte_wartung_am IS NULL) AND naechste_wartung_am IS NOT NULL)
      )
  `);
}

async function getToolBookingCalendar({ from, days, toolId, category, onlyActive = true }) {
  const normalizedFrom = normalizeIsoDate(from) || new Date().toISOString().slice(0, 10);
  const normalizedDays = Math.min(parsePositiveInt(days, 28), 84);
  const normalizedTo = addDays(normalizedFrom, normalizedDays - 1);

  const toolParams = [];
  const toolConditions = [];

  if (toolId) {
    toolParams.push(toolId);
    toolConditions.push(`w.id = $${toolParams.length}`);
  }

  if (category) {
    toolParams.push(category);
    toolConditions.push(`w.kategorie = $${toolParams.length}`);
  }

  const toolQuery = `
    SELECT w.id, w.name, w.icon, w.inventarnummer, w.status, w.kategorie
    FROM werkzeuge w
    ${toolConditions.length ? `WHERE ${toolConditions.join(' AND ')}` : ''}
    ORDER BY w.name
  `;
  const toolResult = await pool.query(toolQuery, toolParams);
  const tools = toolResult.rows;

  if (tools.length === 0) {
    return {
      from: normalizedFrom,
      to: normalizedTo,
      days: normalizedDays,
      generated_at: new Date().toISOString(),
      date_headers: [],
      tools: []
    };
  }

  const bookingParams = [normalizedFrom, normalizedTo, tools.map(t => t.id)];
  const bookingConditions = [
    'a.datum_von <= $2::date',
    'a.datum_bis >= $1::date',
    'a.werkzeug_id = ANY($3::int[])'
  ];

  if (onlyActive) {
    bookingConditions.push(`a.status IN ('reserviert', 'ausgeliehen')`);
  }

  const bookingQuery = `
    SELECT
      a.id,
      a.werkzeug_id,
      a.mitarbeiter_name,
      a.datum_von,
      a.datum_bis,
      a.status,
      a.reserviert_am,
      a.ausgeliehen_am,
      a.zurueckgegeben_am
    FROM ausleihen a
    WHERE ${bookingConditions.join(' AND ')}
    ORDER BY a.datum_von, a.id
  `;

  const bookingResult = await pool.query(bookingQuery, bookingParams);
  const bookingsByTool = new Map();

  for (const booking of bookingResult.rows) {
    if (!bookingsByTool.has(booking.werkzeug_id)) {
      bookingsByTool.set(booking.werkzeug_id, []);
    }
    bookingsByTool.get(booking.werkzeug_id).push(booking);
  }

  const dateHeaders = [];
  for (let offset = 0; offset < normalizedDays; offset += 1) {
    dateHeaders.push(addDays(normalizedFrom, offset));
  }

  const enrichedTools = tools.map(tool => ({
    ...tool,
    bookings: bookingsByTool.get(tool.id) || []
  }));

  return {
    from: normalizedFrom,
    to: normalizedTo,
    days: normalizedDays,
    generated_at: new Date().toISOString(),
    date_headers: dateHeaders,
    tools: enrichedTools
  };
}

async function refreshToolStatus(client, werkzeugId) {
  const bookingResult = await client.query(
    `
      SELECT status
      FROM ausleihen
      WHERE werkzeug_id = $1
        AND status IN ('reserviert', 'ausgeliehen')
      ORDER BY CASE status WHEN 'ausgeliehen' THEN 0 ELSE 1 END, datum_von ASC, id ASC
      LIMIT 1
    `,
    [werkzeugId]
  );

  if (bookingResult.rows.length > 0) {
    await client.query(
      'UPDATE werkzeuge SET status = $1 WHERE id = $2',
      [bookingResult.rows[0].status, werkzeugId]
    );
    return bookingResult.rows[0].status;
  }

  const toolResult = await client.query('SELECT status FROM werkzeuge WHERE id = $1', [werkzeugId]);
  if (toolResult.rows.length === 0) {
    throw new Error(`Werkzeug ${werkzeugId} nicht gefunden`);
  }

  const currentStatus = toolResult.rows[0].status;
  const fallbackStatus = ['defekt', 'reinigung', 'reparatur'].includes(currentStatus)
    ? currentStatus
    : 'verfuegbar';

  await client.query(
    'UPDATE werkzeuge SET status = $1 WHERE id = $2',
    [fallbackStatus, werkzeugId]
  );

  return fallbackStatus;
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token || !verifyAdminToken(token)) {
    return res.status(401).json({
      error: 'Tool-Admin-Anmeldung erforderlich',
      code: 'TOOL_ADMIN_AUTH_REQUIRED',
      detail: 'Für diese Aktion wird eine gültige Anmeldung im Tool-Admin-Bereich benötigt. Die Anmeldung fehlt oder ist abgelaufen.'
    });
  }
  next();
}

function validateIdParam(req, res, next) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }
  req.params.id = String(id);
  next();
}

function handleValidation(result, res) {
  if (result.valid) return false;
  res.status(400).json({ error: 'Validierung fehlgeschlagen', details: result.errors });
  return true;
}

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'ok', timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Admin Authentifizierung
app.post('/api/admin/auth', authLimiter, async (req, res) => {
  const password = String(req.body?.password || '');

  if (!password) {
    return res.status(400).json({ success: false, message: 'Passwort fehlt' });
  }

  const passwordBuffer = Buffer.from(password);
  const adminPasswordBuffer = Buffer.from(ADMIN_PASSWORD);
  const matches = passwordBuffer.length === adminPasswordBuffer.length
    && crypto.timingSafeEqual(passwordBuffer, adminPasswordBuffer);

  if (matches) {
    const token = createAdminToken();
    await logAdminAudit({
      req,
      action: 'admin.auth.success',
      success: true,
      actor: 'admin-login',
      metadata: { password_hash: hashValue(password).slice(0, 12) }
    });
    res.json({
      success: true,
      token,
      message: 'Tool-Admin-Modus aktiviert',
      expires_in_hours: ADMIN_TOKEN_TTL_HOURS
    });
  } else {
    await logAdminAudit({
      req,
      action: 'admin.auth.failure',
      success: false,
      actor: 'admin-login',
      metadata: { password_hash: hashValue(password).slice(0, 12) }
    });
    res.status(401).json({
      success: false,
      message: 'Falsches Passwort'
    });
  }
});

// Admin Token verifizieren
app.get('/api/admin/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ valid: false });
  }

  res.json({ valid: verifyAdminToken(token) });
});

// ==================== WERKZEUGE ====================

app.get('/api/werkzeuge', async (req, res) => {
  try {
    const kategorie = sanitizeText(req.query.kategorie, { maxLength: MAX_TEXT_LENGTH.short });
    const status = sanitizeEnum(req.query.status, ALLOWED_TOOL_STATUSES);
    const search = sanitizeText(req.query.search, { maxLength: MAX_TEXT_LENGTH.medium });
    const verfuegbarVon = normalizeDateInput(req.query.verfuegbar_von);
    const verfuegbarBis = normalizeDateInput(req.query.verfuegbar_bis);

    if ((verfuegbarVon && !verfuegbarBis) || (!verfuegbarVon && verfuegbarBis)) {
      return res.status(400).json({ error: 'Bitte Start- und Enddatum gemeinsam setzen' });
    }

    if (verfuegbarVon && verfuegbarBis && verfuegbarBis < verfuegbarVon) {
      return res.status(400).json({ error: 'Das Enddatum muss am oder nach dem Startdatum liegen' });
    }

    let query = `
      SELECT
        w.*,
        COUNT(*) FILTER (WHERE a.status = 'reserviert')::int AS aktiv_reserviert,
        COUNT(*) FILTER (WHERE a.status = 'ausgeliehen')::int AS aktiv_ausgeliehen
      FROM werkzeuge w
      LEFT JOIN ausleihen a ON a.werkzeug_id = w.id AND a.status IN ('reserviert', 'ausgeliehen')
      WHERE 1=1
    `;
    const params = [];

    if (kategorie) {
      params.push(kategorie);
      query += ` AND kategorie = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR beschreibung ILIKE $${params.length} OR inventarnummer ILIKE $${params.length})`;
    }

    if (verfuegbarVon && verfuegbarBis) {
      params.push(verfuegbarVon);
      const fromParam = `$${params.length}`;
      params.push(verfuegbarBis);
      const toParam = `$${params.length}`;
      query += `
        AND w.status NOT IN ('defekt', 'reinigung', 'reparatur')
        AND NOT EXISTS (
          SELECT 1
          FROM ausleihen a_conflict
          WHERE a_conflict.werkzeug_id = w.id
            AND a_conflict.status IN ('reserviert', 'ausgeliehen')
            AND a_conflict.datum_von <= ${toParam}::date
            AND a_conflict.datum_bis >= ${fromParam}::date
        )
      `;
    }

    query += ' GROUP BY w.id ORDER BY w.name';

    const result = await pool.query(query, params);
    res.json(result.rows.map(enrichToolRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/werkzeuge/:id', validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        w.*,
        COUNT(*) FILTER (WHERE a.status = 'reserviert')::int AS aktiv_reserviert,
        COUNT(*) FILTER (WHERE a.status = 'ausgeliehen')::int AS aktiv_ausgeliehen
      FROM werkzeuge w
      LEFT JOIN ausleihen a ON a.werkzeug_id = w.id AND a.status IN ('reserviert', 'ausgeliehen')
      WHERE w.id = $1
      GROUP BY w.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    res.json(enrichToolRow(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/werkzeuge/:id/einheiten', validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const toolExists = await pool.query('SELECT id, name FROM werkzeuge WHERE id = $1', [id]);
    if (!toolExists.rows.length) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    const result = await pool.query(`
      SELECT
        e.*,
        (
          SELECT json_build_object(
            'event_typ', h.event_typ,
            'event_status', h.event_status,
            'referenz_typ', h.referenz_typ,
            'referenz_id', h.referenz_id,
            'notiz', h.notiz,
            'created_at', h.created_at
          )
          FROM werkzeug_einheit_historie h
          WHERE h.werkzeug_einheit_id = e.id
          ORDER BY h.created_at DESC
          LIMIT 1
        ) AS letztes_historien_event
      FROM werkzeug_einheiten e
      WHERE e.werkzeug_id = $1
      ORDER BY e.id ASC
    `, [id]);

    res.json({
      werkzeug_id: Number(id),
      werkzeug_name: toolExists.rows[0].name,
      einheiten: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/werkzeuge', requireAdmin, adminActionLimiter, async (req, res) => {
  try {
    const validation = validateToolPayload(req.body);
    if (handleValidation(validation, res)) return;

    const {
      name,
      icon,
      beschreibung,
      inventarnummer,
      zustand,
      foto,
      kategorie,
      lagerplatz,
      wartungsintervall_tage,
      letzte_wartung_am,
      wartung_notiz,
      bestand_gesamt,
      bestand_defekt,
      bestand_in_wartung
    } = validation.payload;
    const naechsteWartungAm = calculateNextMaintenanceDate(letzte_wartung_am, wartungsintervall_tage);

    const result = await pool.query(`
      INSERT INTO werkzeuge (
        name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, status,
        wartungsintervall_tage, letzte_wartung_am, naechste_wartung_am, wartung_notiz,
        bestand_gesamt, bestand_defekt, bestand_in_wartung, einheitenmodell
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verfuegbar', $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      name,
      icon,
      beschreibung,
      inventarnummer,
      zustand,
      foto,
      kategorie,
      lagerplatz,
      wartungsintervall_tage,
      letzte_wartung_am,
      naechsteWartungAm,
      coerceNullableText(wartung_notiz),
      bestand_gesamt || 1,
      bestand_defekt || 0,
      bestand_in_wartung || 0,
      (bestand_gesamt || 1) > 1 ? 'tracked_units' : 'legacy_single'
    ]);

    await logAdminAudit({
      req,
      action: 'tool.create',
      metadata: { toolId: result.rows[0].id, inventarnummer }
    });

    if ((bestand_gesamt || 1) > 0) {
      for (let index = 1; index <= (bestand_gesamt || 1); index += 1) {
        const unitStatus = index <= (bestand_defekt || 0)
          ? 'defekt'
          : (index <= ((bestand_defekt || 0) + (bestand_in_wartung || 0)) ? 'reparatur' : 'verfuegbar');
        const unitCode = `WZE-${result.rows[0].id}-${String(index).padStart(3, '0')}`;
        const unitInventarnummer = buildSafeUnitInventoryNumber(inventarnummer, result.rows[0].id, index);
        const inserted = await pool.query(`
          INSERT INTO werkzeug_einheiten (
            werkzeug_id, einheiten_code, inventarnummer, bezeichnung, status, zustand, lagerplatz, qr_code
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          result.rows[0].id,
          unitCode,
          unitInventarnummer,
          buildDefaultUnitLabel(result.rows[0], index),
          unitStatus,
          zustand || null,
          lagerplatz || null,
          unitCode
        ]);

        await pool.query(`
          INSERT INTO werkzeug_einheit_historie (werkzeug_einheit_id, event_typ, event_status, referenz_typ, referenz_id, notiz, metadata)
          VALUES ($1, 'created', $2, 'werkzeug', $3, $4, $5::jsonb)
        `, [
          inserted.rows[0].id,
          unitStatus,
          result.rows[0].id,
          'Einheit beim Anlegen des Werkzeugtyps erstellt',
          JSON.stringify({ source: 'tool.create', index })
        ]);
      }
    }

    res.status(201).json(enrichToolRow(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Inventarnummer bereits vorhanden' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/werkzeuge/:id', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const validation = validateToolPayload(req.body, { partial: true });
    if (handleValidation(validation, res)) return;

    const currentResult = await pool.query('SELECT * FROM werkzeuge WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    const current = currentResult.rows[0];
    const merged = { ...current, ...validation.payload };
    const naechsteWartungAm = calculateNextMaintenanceDate(merged.letzte_wartung_am, merged.wartungsintervall_tage);

    const result = await pool.query(`
      UPDATE werkzeuge
      SET name = $1,
          icon = $2,
          beschreibung = $3,
          inventarnummer = $4,
          zustand = $5,
          foto = $6,
          kategorie = $7,
          lagerplatz = $8,
          status = $9,
          wartungsintervall_tage = $10,
          letzte_wartung_am = $11,
          naechste_wartung_am = $12,
          wartung_notiz = $13,
          bestand_gesamt = $14,
          bestand_defekt = $15,
          bestand_in_wartung = $16,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $17
      RETURNING *
    `, [
      merged.name,
      merged.icon,
      merged.beschreibung,
      merged.inventarnummer,
      merged.zustand,
      merged.foto,
      merged.kategorie,
      merged.lagerplatz,
      merged.status,
      merged.wartungsintervall_tage,
      merged.letzte_wartung_am,
      naechsteWartungAm,
      coerceNullableText(merged.wartung_notiz),
      merged.bestand_gesamt || 1,
      merged.bestand_defekt || 0,
      merged.bestand_in_wartung || 0,
      id
    ]);

    await logAdminAudit({
      req,
      action: 'tool.update',
      metadata: { toolId: Number(id), inventarnummer: merged.inventarnummer }
    });

    res.json(enrichToolRow(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Inventarnummer bereits vorhanden' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/werkzeuge/:id', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM werkzeuge WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    await logAdminAudit({
      req,
      action: 'tool.delete',
      metadata: { toolId: Number(id), inventarnummer: result.rows[0].inventarnummer }
    });

    res.json({ message: 'Werkzeug gelöscht', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wartungen', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        w.id,
        w.name,
        w.icon,
        w.inventarnummer,
        w.status,
        w.kategorie,
        w.wartungsintervall_tage,
        w.letzte_wartung_am,
        w.naechste_wartung_am,
        w.wartung_notiz,
        (
          SELECT MAX(durchgefuehrt_am)
          FROM wartungen wa
          WHERE wa.werkzeug_id = w.id
        ) AS letzte_wartung_dokumentiert_am
      FROM werkzeuge w
      WHERE w.wartungsintervall_tage IS NOT NULL
      ORDER BY w.naechste_wartung_am ASC NULLS LAST, w.name ASC
    `);

    res.json(result.rows.map(row => ({
      ...row,
      wartungsstatus: calculateMaintenanceStatus(row.naechste_wartung_am)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/werkzeuge/:id/wartungen', validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT id, werkzeug_id, durchgefuehrt_am, notiz, erstellt_am
      FROM wartungen
      WHERE werkzeug_id = $1
      ORDER BY durchgefuehrt_am DESC, id DESC
      LIMIT 20
    `, [id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/werkzeuge/:id/wartungen', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const validation = validateMaintenancePayload(req.body);
    if (handleValidation(validation, res)) return;
    const { durchgefuehrt_am, notiz } = validation.payload;

    await client.query('BEGIN');

    const werkzeugResult = await client.query(
      'SELECT id, wartungsintervall_tage FROM werkzeuge WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (werkzeugResult.rows.length === 0) {
      throw new Error('Werkzeug nicht gefunden');
    }

    const werkzeug = werkzeugResult.rows[0];
    const nextMaintenanceDate = calculateNextMaintenanceDate(durchgefuehrt_am, werkzeug.wartungsintervall_tage);

    const maintenanceResult = await client.query(`
      INSERT INTO wartungen (werkzeug_id, durchgefuehrt_am, notiz)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, durchgefuehrt_am, coerceNullableText(notiz)]);

    const toolResult = await client.query(`
      UPDATE werkzeuge
      SET letzte_wartung_am = $1,
          naechste_wartung_am = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [durchgefuehrt_am, nextMaintenanceDate, id]);

    await client.query('COMMIT');

    await logAdminAudit({
      req,
      action: 'maintenance.create',
      metadata: { toolId: Number(id), maintenanceId: maintenanceResult.rows[0].id }
    });

    res.status(201).json({
      wartung: maintenanceResult.rows[0],
      werkzeug: {
        ...toolResult.rows[0],
        wartungsstatus: calculateMaintenanceStatus(toolResult.rows[0].naechste_wartung_am)
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'Werkzeug nicht gefunden') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== AUSLEIHEN ====================

app.get('/api/ausleihen', async (req, res) => {
  try {
    const status = sanitizeEnum(req.query.status, ALLOWED_BOOKING_STATUSES);
    const mitarbeiter_name = sanitizeText(req.query.mitarbeiter_name, { maxLength: MAX_TEXT_LENGTH.medium });
    const activeOnly = normalizeBoolean(req.query.active_only, false);

    let query = `
      SELECT a.*, w.name as werkzeug_name, w.inventarnummer, w.icon
      FROM ausleihen a
      JOIN werkzeuge w ON a.werkzeug_id = w.id
    `;
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    if (mitarbeiter_name) {
      params.push(mitarbeiter_name);
      conditions.push(`LOWER(TRIM(a.mitarbeiter_name)) = LOWER(TRIM($${params.length}))`);
    }

    if (activeOnly) {
      conditions.push(`a.status IN ('reserviert', 'ausgeliehen')`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += " ORDER BY CASE a.status WHEN 'ausgeliehen' THEN 0 WHEN 'reserviert' THEN 1 ELSE 2 END, a.datum_bis ASC NULLS LAST, a.datum_von DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ausleihen/kalender', async (req, res) => {
  try {
    const toolId = req.query.werkzeug_id ? normalizeId(req.query.werkzeug_id) : null;
    if (req.query.werkzeug_id && !toolId) {
      return res.status(400).json({ error: 'werkzeug_id ist ungültig' });
    }

    const calendar = await getToolBookingCalendar({
      from: req.query.from,
      days: req.query.days,
      toolId,
      category: sanitizeText(req.query.kategorie, { maxLength: MAX_TEXT_LENGTH.short }) || null,
      onlyActive: normalizeBoolean(req.query.active_only, true)
    });

    res.json(calendar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ausleihen/:id', validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT a.*, w.name as werkzeug_name, w.inventarnummer, w.icon
      FROM ausleihen a
      JOIN werkzeuge w ON a.werkzeug_id = w.id
      WHERE a.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ausleihe nicht gefunden' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ausleihen', async (req, res) => {
  const client = await pool.connect();

  try {
    const validation = validateBookingPayload(req.body);
    if (handleValidation(validation, res)) return;
    const { werkzeuge, mitarbeiter_name, mitarbeiter_email, projektnummer, datum_von, datum_bis } = validation.payload;

    await client.query('BEGIN');

    const reservierungen = [];

    for (const werkzeugId of werkzeuge) {
      const werkzeugResult = await client.query(
        'SELECT id, name, status FROM werkzeuge WHERE id = $1 FOR UPDATE',
        [werkzeugId]
      );

      if (werkzeugResult.rows.length === 0) {
        throw new Error(`Werkzeug ${werkzeugId} nicht gefunden`);
      }

      const werkzeug = werkzeugResult.rows[0];
      if (['defekt', 'reinigung', 'reparatur'].includes(werkzeug.status)) {
        throw new Error(`Werkzeug ${werkzeug.name} ist aktuell nicht reservierbar (${werkzeug.status})`);
      }

      const overlapResult = await client.query(
        `
          SELECT a.id, a.status, a.datum_von, a.datum_bis, a.mitarbeiter_name
          FROM ausleihen a
          WHERE a.werkzeug_id = $1
            AND a.status IN ('reserviert', 'ausgeliehen')
            AND a.datum_von <= $3::date
            AND a.datum_bis >= $2::date
          ORDER BY a.datum_von ASC
          LIMIT 1
        `,
        [werkzeugId, datum_von, datum_bis]
      );

      if (overlapResult.rows.length > 0) {
        const konflikt = overlapResult.rows[0];
        throw new Error(`Werkzeug ${werkzeug.name} ist im Zeitraum ${konflikt.datum_von} bis ${konflikt.datum_bis} bereits ${konflikt.status}`);
      }

      const contact = buildPersonContact(mitarbeiter_name, mitarbeiter_email);
      const result = await client.query(`
        INSERT INTO ausleihen (werkzeug_id, mitarbeiter_name, mitarbeiter_email, projektnummer, datum_von, datum_bis, reserviert_am, status)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'reserviert')
        RETURNING *
      `, [werkzeugId, mitarbeiter_name, contact.email, projektnummer, datum_von, datum_bis]);

      await client.query(
        'UPDATE werkzeuge SET status = $1 WHERE id = $2',
        ['reserviert', werkzeugId]
      );

      reservierungen.push(result.rows[0]);
    }

    await client.query('COMMIT');

    const notificationSettings = getNotificationSettings();
    const contact = buildPersonContact(mitarbeiter_name, mitarbeiter_email);
    if (notificationSettings.reservationConfirmation && contact.email) {
      const enrichedReservations = [];
      for (const reservation of reservierungen) {
        const fullReservation = await fetchBookingWithTool(client, reservation.id);
        if (fullReservation) enrichedReservations.push(fullReservation);
      }

      await sendBestEffortEmail(() => ({
        to: contact.email,
        ...buildReservationEmail({
          reservationGroup: { reservations: enrichedReservations },
          recipient: contact
        })
      }), `reservation_confirmation:${contact.email}`);
    }

    res.status(201).json(reservierungen);
  } catch (err) {
    await client.query('ROLLBACK');
    if (/nicht gefunden|nicht reservierbar|bereits/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/ausleihen/:id/ausgeben', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const current = await client.query('SELECT * FROM ausleihen WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows.length) {
      throw new Error('Ausleihe nicht gefunden');
    }
    if (current.rows[0].status !== 'reserviert') {
      throw new Error('Nur reservierte Ausleihen können ausgegeben werden');
    }

    const result = await client.query(`
      UPDATE ausleihen
      SET status = 'ausgeliehen', ausgeliehen_am = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    await client.query(
      'UPDATE werkzeuge SET status = $1 WHERE id = $2',
      ['ausgeliehen', result.rows[0].werkzeug_id]
    );

    await client.query('COMMIT');

    await logAdminAudit({
      req,
      action: 'booking.checkout',
      metadata: { bookingId: Number(id), toolId: result.rows[0].werkzeug_id }
    });

    const notificationSettings = getNotificationSettings();
    if (notificationSettings.checkoutConfirmation) {
      const booking = await fetchBookingWithTool(client, id);
      const contact = buildPersonContact(booking?.mitarbeiter_name, booking?.mitarbeiter_email);
      if (booking && contact.email) {
        await sendBestEffortEmail(() => ({
          to: contact.email,
          ...buildStatusEmail({ booking, recipient: contact, actionLabel: 'Ausgabebestätigung' })
        }), `checkout_confirmation:${contact.email}`);
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (/nicht gefunden|können ausgegeben/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/ausleihen/:id/rueckgabe', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const validation = validateReturnPayload(req.body);
    if (handleValidation(validation, res)) return;
    const { rueckgabe_zustand, rueckgabe_kommentar } = validation.payload;

    await client.query('BEGIN');

    const current = await client.query('SELECT * FROM ausleihen WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows.length) {
      throw new Error('Ausleihe nicht gefunden');
    }
    if (current.rows[0].status !== 'ausgeliehen') {
      throw new Error('Nur ausgeliehene Ausleihen können zurückgegeben werden');
    }

    const result = await client.query(`
      UPDATE ausleihen
      SET status = 'zurueckgegeben',
          zurueckgegeben_am = CURRENT_TIMESTAMP,
          rueckgabe_zustand = $1,
          rueckgabe_kommentar = $2
      WHERE id = $3
      RETURNING *
    `, [rueckgabe_zustand, rueckgabe_kommentar, id]);

    let neuerStatus = 'verfuegbar';
    if (rueckgabe_zustand === 'defekt') {
      neuerStatus = 'defekt';
    } else if (rueckgabe_zustand === 'reinigung') {
      neuerStatus = 'reinigung';
    } else if (rueckgabe_zustand === 'reparatur') {
      neuerStatus = 'reparatur';
    }

    await client.query(
      'UPDATE werkzeuge SET status = $1, zustand = $2 WHERE id = $3',
      [neuerStatus, rueckgabe_zustand, result.rows[0].werkzeug_id]
    );

    if (neuerStatus === 'verfuegbar') {
      await refreshToolStatus(client, result.rows[0].werkzeug_id);
    }

    await client.query('COMMIT');

    await logAdminAudit({
      req,
      action: 'booking.return',
      metadata: { bookingId: Number(id), toolId: result.rows[0].werkzeug_id, rueckgabe_zustand }
    });

    const notificationSettings = getNotificationSettings();
    if (notificationSettings.returnConfirmation) {
      const booking = await fetchBookingWithTool(client, id);
      const contact = buildPersonContact(booking?.mitarbeiter_name, booking?.mitarbeiter_email);
      if (booking && contact.email) {
        await sendBestEffortEmail(() => ({
          to: contact.email,
          ...buildStatusEmail({ booking, recipient: contact, actionLabel: 'Rückgabebestätigung' })
        }), `return_confirmation:${contact.email}`);
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (/nicht gefunden|können zurückgegeben/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/ausleihen/:id', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const ausleiheResult = await client.query('SELECT werkzeug_id FROM ausleihen WHERE id = $1', [id]);

    if (ausleiheResult.rows.length === 0) {
      throw new Error('Ausleihe nicht gefunden');
    }

    const werkzeugId = ausleiheResult.rows[0].werkzeug_id;

    await client.query('DELETE FROM ausleihen WHERE id = $1', [id]);

    await refreshToolStatus(client, werkzeugId);

    await client.query('COMMIT');

    await logAdminAudit({
      req,
      action: 'booking.delete',
      metadata: { bookingId: Number(id), toolId: werkzeugId }
    });

    res.json({ message: 'Ausleihe gelöscht' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'Ausleihe nicht gefunden') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== SCHÄDEN ====================

app.get('/api/schaeden', async (req, res) => {
  try {
    const status = sanitizeEnum(req.query.status, ALLOWED_DAMAGE_STATUSES);

    let query = `
      SELECT s.*, w.name as werkzeug_name, w.inventarnummer, w.icon
      FROM schaeden s
      JOIN werkzeuge w ON s.werkzeug_id = w.id
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE s.status = $${params.length}`;
    }

    query += ' ORDER BY s.gemeldet_am DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schaeden', async (req, res) => {
  const client = await pool.connect();

  try {
    const validation = validateDamagePayload(req.body);
    if (handleValidation(validation, res)) return;
    const { werkzeug_id, mitarbeiter_name, beschreibung, foto } = validation.payload;

    await client.query('BEGIN');

    const toolResult = await client.query('SELECT id FROM werkzeuge WHERE id = $1 FOR UPDATE', [werkzeug_id]);
    if (!toolResult.rows.length) {
      throw new Error('Werkzeug nicht gefunden');
    }

    const result = await client.query(`
      INSERT INTO schaeden (werkzeug_id, mitarbeiter_name, beschreibung, foto)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [werkzeug_id, mitarbeiter_name, beschreibung, foto]);

    await client.query(
      'UPDATE werkzeuge SET status = $1 WHERE id = $2',
      ['defekt', werkzeug_id]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'Werkzeug nicht gefunden') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/schaeden/:id/beheben', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE schaeden
      SET status = 'behoben'
      WHERE id = $1 AND status = 'offen'
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      throw new Error('Schaden nicht gefunden oder bereits behoben');
    }

    await refreshToolStatus(client, result.rows[0].werkzeug_id);

    await client.query('COMMIT');

    await logAdminAudit({
      req,
      action: 'damage.resolve',
      metadata: { damageId: Number(id), toolId: result.rows[0].werkzeug_id }
    });

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (/nicht gefunden/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/schaeden/:id', requireAdmin, adminActionLimiter, validateIdParam, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM schaeden WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schaden nicht gefunden' });
    }

    await logAdminAudit({
      req,
      action: 'damage.delete',
      metadata: { damageId: Number(id), toolId: result.rows[0].werkzeug_id }
    });

    res.json({ message: 'Schaden gelöscht', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/notifications/overdue/run', requireAdmin, adminActionLimiter, async (req, res) => {
  const client = await pool.connect();

  try {
    const force = String(req.query.force || '').trim().toLowerCase() === 'true';
    const result = await runOverdueDigest(client, { force });
    await logAdminAudit({
      req,
      action: 'admin.notifications.overdue.run',
      metadata: { force, sent: result.sent, overdueCount: result.overdueCount }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/audit-log', requireAdmin, adminActionLimiter, async (req, res) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);
    const result = await pool.query(`
      SELECT id, action, path, method, ip_address, actor, success, metadata, created_at
      FROM admin_audit_log
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATISTIKEN ====================

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COALESCE(SUM(GREATEST(COALESCE(bestand_gesamt, 1) - COALESCE(bestand_defekt, 0) - COALESCE(bestand_in_wartung, 0), 0)), 0) as verfuegbar,
        COALESCE(SUM(COALESCE(bestand_gesamt, 1)), 0) as gesamt,
        COALESCE(SUM(COALESCE(bestand_defekt, 0)), 0) as defekt,
        COALESCE(SUM(COALESCE(bestand_in_wartung, 0)), 0) as in_wartung,
        COUNT(*) as werkzeugtypen
      FROM werkzeuge
    `);

    const ausleihenStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'reserviert') as reserviert,
        COUNT(*) FILTER (WHERE status = 'ausgeliehen') as ausgeliehen,
        COUNT(*) FILTER (WHERE datum_bis < CURRENT_DATE AND status = 'ausgeliehen') as ueberfaellig
      FROM ausleihen
    `);

    const schadenStats = await pool.query(`
      SELECT COUNT(*) as offen
      FROM schaeden
      WHERE status = 'offen'
    `);

    const wartungStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE wartungsintervall_tage IS NOT NULL) as mit_intervall,
        COUNT(*) FILTER (WHERE naechste_wartung_am < CURRENT_DATE) as ueberfaellig,
        COUNT(*) FILTER (WHERE naechste_wartung_am = CURRENT_DATE) as heute,
        COUNT(*) FILTER (WHERE naechste_wartung_am BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') as naechste_7_tage
      FROM werkzeuge
    `);

    const topWerkzeuge = await pool.query(`
      SELECT w.name, w.icon, COUNT(a.id) as anzahl_ausleihen
      FROM werkzeuge w
      LEFT JOIN ausleihen a ON w.id = a.werkzeug_id
      GROUP BY w.id, w.name, w.icon
      ORDER BY anzahl_ausleihen DESC
      LIMIT 5
    `);

    const dueMaintenance = await pool.query(`
      SELECT id, name, icon, inventarnummer, naechste_wartung_am, wartungsintervall_tage, status
      FROM werkzeuge
      WHERE naechste_wartung_am IS NOT NULL
        AND naechste_wartung_am <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY naechste_wartung_am ASC, name ASC
      LIMIT 10
    `);

    res.json({
      werkzeuge: {
        ...stats.rows[0],
        reserviert: ausleihenStats.rows[0]?.reserviert || 0,
        ausgeliehen: ausleihenStats.rows[0]?.ausgeliehen || 0
      },
      ausleihen: ausleihenStats.rows[0],
      schaeden: schadenStats.rows[0],
      wartungen: wartungStats.rows[0],
      top_werkzeuge: topWerkzeuge.rows,
      faellige_wartungen: dueMaintenance.rows.map(row => ({
        ...row,
        wartungsstatus: calculateMaintenanceStatus(row.naechste_wartung_am)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CSV EXPORT ====================

app.get('/api/export/werkzeuge/pdf-labels', async (req, res) => {
  try {
    const rawIds = String(req.query.ids || '')
      .split(',')
      .map(value => Number.parseInt(value, 10))
      .filter(value => Number.isInteger(value) && value > 0);

    const uniqueIds = [...new Set(rawIds)];
    const query = uniqueIds.length
      ? 'SELECT id, name, inventarnummer, kategorie FROM werkzeuge WHERE id = ANY($1::int[]) ORDER BY name'
      : 'SELECT id, name, inventarnummer, kategorie FROM werkzeuge ORDER BY name';
    const params = uniqueIds.length ? [uniqueIds] : [];
    const result = await pool.query(query, params);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Keine Werkzeuge für PDF-Export gefunden' });
    }

    const pdfBuffer = await createToolLabelPdfBuffer(req, result.rows);
    const suffix = uniqueIds.length ? `-${result.rows.length}-werkzeuge` : '-alle-werkzeuge';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="qr-etiketten${suffix}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/werkzeuge', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM werkzeuge ORDER BY name');

    let csv = 'Werkzeug,Beschreibung,Zustand,Inventarnummer,Kategorie,Lagerplatz,Status,WartungsintervallTage,LetzteWartung,NaechsteWartung,Wartungsnotiz\n';
    result.rows.forEach(w => {
      csv += `"${w.name}","${w.beschreibung || ''}","${w.zustand || ''}","${w.inventarnummer}","${w.kategorie || ''}","${w.lagerplatz || ''}","${w.status}","${w.wartungsintervall_tage || ''}","${w.letzte_wartung_am || ''}","${w.naechste_wartung_am || ''}","${w.wartung_notiz || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=werkzeuge.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err && err.message === 'Origin nicht erlaubt') {
    return res.status(403).json({ error: 'Origin nicht erlaubt' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request-Body zu groß' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

Promise.all([ensureMaintenanceSchema(), ensureEmailSchema(), ensureAuditLogSchema()])
  .then(async () => {
    try {
      await ensureInventorySchema();
      console.log('✅ Inventory-Schema geprüft/aktualisiert');
    } catch (err) {
      console.error('⚠️ Inventory-Schema-Initialisierung fehlgeschlagen, Backend startet trotzdem weiter:', err);
    }

    app.listen(PORT, () => {
      console.log(`🚀 ToolHub Backend läuft auf Port ${PORT}`);
      startDailyOverdueScheduler();
    });
  })
  .catch((err) => {
    console.error('❌ Schema konnte nicht initialisiert werden:', err);
    process.exit(1);
  });
