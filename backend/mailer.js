const nodemailer = require('nodemailer');

function normalizeEmailList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function buildBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
}

function buildFromAddress() {
  const rawFrom = String(process.env.MAIL_FROM || '').trim();
  if (rawFrom) return rawFrom;

  const fallbackUser = String(process.env.SMTP_USER || '').trim();
  if (fallbackUser && fallbackUser.includes('@')) {
    return fallbackUser;
  }

  return 'toolhub@example.invalid';
}

let transporter = null;
let transporterPromise = null;

function isMailConfigured() {
  return Boolean(
    String(process.env.SMTP_HOST || '').trim() &&
    String(process.env.SMTP_PORT || '').trim() &&
    buildFromAddress()
  );
}

async function getTransporter() {
  if (!isMailConfigured()) {
    return null;
  }

  if (transporter) {
    return transporter;
  }

  if (!transporterPromise) {
    transporterPromise = (async () => {
      const port = Number.parseInt(process.env.SMTP_PORT, 10) || 587;
      const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
      const requireAuth = parseBoolean(process.env.SMTP_REQUIRE_AUTH, false);
      const user = String(process.env.SMTP_USER || '').trim();
      const pass = String(process.env.SMTP_PASSWORD || '').trim();

      const candidate = nodemailer.createTransport({
        host: String(process.env.SMTP_HOST).trim(),
        port,
        secure,
        auth: requireAuth || user || pass ? {
          user,
          pass
        } : undefined,
        tls: {
          rejectUnauthorized: !parseBoolean(process.env.SMTP_ALLOW_SELF_SIGNED, false)
        }
      });

      if (parseBoolean(process.env.MAIL_VERIFY_ON_START, false)) {
        await candidate.verify();
      }

      transporter = candidate;
      return candidate;
    })().catch((error) => {
      transporterPromise = null;
      throw error;
    });
  }

  return transporterPromise;
}

function buildReservationEmail({ reservationGroup, recipient }) {
  const first = reservationGroup?.reservations?.[0] || {};
  const tools = (reservationGroup?.reservations || []).map(item => `- ${item.tool_name} (${item.inventarnummer || 'ohne Inventarnummer'})`).join('\n');
  const baseUrl = buildBaseUrl();
  const subjectPrefix = String(process.env.MAIL_SUBJECT_PREFIX || '[ToolHub]').trim();
  const subject = `${subjectPrefix} Reservierungsbestätigung`;

  const text = [
    `Hallo ${recipient.name || first.mitarbeiter_name || 'zusammen'},`,
    '',
    'deine Reservierung wurde erfasst.',
    '',
    `Zeitraum: ${first.datum_von} bis ${first.datum_bis}`,
    'Werkzeuge:',
    tools,
    '',
    baseUrl ? `Übersicht: ${baseUrl}` : null,
    '',
    'Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.'
  ].filter(Boolean).join('\n');

  const html = `
    <p>Hallo ${recipient.name || first.mitarbeiter_name || 'zusammen'},</p>
    <p>deine Reservierung wurde erfasst.</p>
    <p><strong>Zeitraum:</strong> ${first.datum_von} bis ${first.datum_bis}</p>
    <p><strong>Werkzeuge:</strong></p>
    <ul>${(reservationGroup?.reservations || []).map(item => `<li>${item.tool_name} (${item.inventarnummer || 'ohne Inventarnummer'})</li>`).join('')}</ul>
    ${baseUrl ? `<p><a href="${baseUrl}">Zur ToolHub-Übersicht</a></p>` : ''}
    <p style="color:#6b7280">Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.</p>
  `;

  return { subject, text, html };
}

function buildStatusEmail({ booking, recipient, actionLabel }) {
  const subjectPrefix = String(process.env.MAIL_SUBJECT_PREFIX || '[ToolHub]').trim();
  const subject = `${subjectPrefix} ${actionLabel}`;
  const baseUrl = buildBaseUrl();
  const text = [
    `Hallo ${recipient.name || booking.mitarbeiter_name || 'zusammen'},`,
    '',
    `${actionLabel} für ${booking.tool_name}.`,
    '',
    `Werkzeug: ${booking.tool_name} (${booking.inventarnummer || 'ohne Inventarnummer'})`,
    `Zeitraum: ${booking.datum_von} bis ${booking.datum_bis}`,
    booking.ausgeliehen_am ? `Ausgegeben am: ${booking.ausgeliehen_am}` : null,
    booking.zurueckgegeben_am ? `Zurückgegeben am: ${booking.zurueckgegeben_am}` : null,
    booking.rueckgabe_zustand ? `Rückgabezustand: ${booking.rueckgabe_zustand}` : null,
    booking.rueckgabe_kommentar ? `Kommentar: ${booking.rueckgabe_kommentar}` : null,
    '',
    baseUrl ? `Übersicht: ${baseUrl}` : null,
    '',
    'Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.'
  ].filter(Boolean).join('\n');

  const html = `
    <p>Hallo ${recipient.name || booking.mitarbeiter_name || 'zusammen'},</p>
    <p>${actionLabel} für <strong>${booking.tool_name}</strong>.</p>
    <ul>
      <li><strong>Werkzeug:</strong> ${booking.tool_name} (${booking.inventarnummer || 'ohne Inventarnummer'})</li>
      <li><strong>Zeitraum:</strong> ${booking.datum_von} bis ${booking.datum_bis}</li>
      ${booking.ausgeliehen_am ? `<li><strong>Ausgegeben am:</strong> ${booking.ausgeliehen_am}</li>` : ''}
      ${booking.zurueckgegeben_am ? `<li><strong>Zurückgegeben am:</strong> ${booking.zurueckgegeben_am}</li>` : ''}
      ${booking.rueckgabe_zustand ? `<li><strong>Rückgabezustand:</strong> ${booking.rueckgabe_zustand}</li>` : ''}
      ${booking.rueckgabe_kommentar ? `<li><strong>Kommentar:</strong> ${booking.rueckgabe_kommentar}</li>` : ''}
    </ul>
    ${baseUrl ? `<p><a href="${baseUrl}">Zur ToolHub-Übersicht</a></p>` : ''}
    <p style="color:#6b7280">Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.</p>
  `;

  return { subject, text, html };
}

function buildOverdueDigestEmail({ rows, recipient }) {
  const subjectPrefix = String(process.env.MAIL_SUBJECT_PREFIX || '[ToolHub]').trim();
  const subject = `${subjectPrefix} Überfällige Ausleihen (${rows.length})`;
  const baseUrl = buildBaseUrl();
  const lines = rows.map(row => `- ${row.tool_name} (${row.inventarnummer || 'ohne Inventarnummer'}) · ${row.mitarbeiter_name || '-'} · fällig seit ${row.datum_bis}`);
  const text = [
    `Hallo ${recipient.name || 'Admin'},`,
    '',
    `es gibt aktuell ${rows.length} überfällige Ausleihe${rows.length === 1 ? '' : 'n'}:`,
    '',
    ...lines,
    '',
    baseUrl ? `Übersicht: ${baseUrl}` : null,
    '',
    'Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.'
  ].filter(Boolean).join('\n');

  const html = `
    <p>Hallo ${recipient.name || 'Admin'},</p>
    <p>es gibt aktuell <strong>${rows.length}</strong> überfällige Ausleihe${rows.length === 1 ? '' : 'n'}:</p>
    <ul>${rows.map(row => `<li>${row.tool_name} (${row.inventarnummer || 'ohne Inventarnummer'}) · ${row.mitarbeiter_name || '-'} · fällig seit ${row.datum_bis}</li>`).join('')}</ul>
    ${baseUrl ? `<p><a href="${baseUrl}">Zur ToolHub-Übersicht</a></p>` : ''}
    <p style="color:#6b7280">Hinweis: Diese E-Mail wurde automatisch von ToolHub versendet.</p>
  `;

  return { subject, text, html };
}

async function sendEmail({ to, cc, bcc, subject, text, html }) {
  const mailer = await getTransporter();
  if (!mailer) {
    return { skipped: true, reason: 'mail_not_configured' };
  }

  const info = await mailer.sendMail({
    from: buildFromAddress(),
    to,
    cc,
    bcc,
    subject,
    text,
    html
  });

  return {
    skipped: false,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected
  };
}

module.exports = {
  normalizeEmailList,
  isMailConfigured,
  sendEmail,
  buildReservationEmail,
  buildStatusEmail,
  buildOverdueDigestEmail
};
