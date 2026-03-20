require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*'
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Request logging (Helps debugging 404s in Azure)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

function normalizeIsoDate(dateInput) {
  if (!dateInput) return null;
  const value = String(dateInput).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
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

function coerceNullableText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
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
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === adminPassword) {
    const token = Buffer.from(`admin:${Date.now()}`).toString('base64');
    res.json({
      success: true,
      token: token,
      message: 'Admin-Modus aktiviert'
    });
  } else {
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

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const isValid = decoded.startsWith('admin:');

    res.json({ valid: isValid });
  } catch (err) {
    res.status(401).json({ valid: false });
  }
});

// ==================== WERKZEUGE ====================

app.get('/api/werkzeuge', async (req, res) => {
  try {
    const { kategorie, status, search } = req.query;

    let query = 'SELECT * FROM werkzeuge WHERE 1=1';
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

    query += ' ORDER BY name';

    const result = await pool.query(query, params);
    res.json(result.rows.map(row => ({
      ...row,
      wartungsstatus: calculateMaintenanceStatus(row.naechste_wartung_am)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/werkzeuge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM werkzeuge WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    res.json({
      ...result.rows[0],
      wartungsstatus: calculateMaintenanceStatus(result.rows[0].naechste_wartung_am)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/werkzeuge', async (req, res) => {
  try {
    const { name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, wartungsintervall_tage, letzte_wartung_am, wartung_notiz } = req.body;

    const wartungsintervallTage = coercePositiveIntegerOrNull(wartungsintervall_tage);
    const letzteWartungAm = normalizeIsoDate(letzte_wartung_am);
    const naechsteWartungAm = calculateNextMaintenanceDate(letzteWartungAm, wartungsintervallTage);

    const result = await pool.query(`
      INSERT INTO werkzeuge (
        name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, status,
        wartungsintervall_tage, letzte_wartung_am, naechste_wartung_am, wartung_notiz
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verfuegbar', $9, $10, $11, $12)
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
      wartungsintervallTage,
      letzteWartungAm,
      naechsteWartungAm,
      coerceNullableText(wartung_notiz)
    ]);

    res.status(201).json({
      ...result.rows[0],
      wartungsstatus: calculateMaintenanceStatus(result.rows[0].naechste_wartung_am)
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Inventarnummer bereits vorhanden' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/werkzeuge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      icon,
      beschreibung,
      inventarnummer,
      zustand,
      foto,
      kategorie,
      lagerplatz,
      status,
      wartungsintervall_tage,
      letzte_wartung_am,
      wartung_notiz
    } = req.body;

    const wartungsintervallTage = coercePositiveIntegerOrNull(wartungsintervall_tage);
    const letzteWartungAm = normalizeIsoDate(letzte_wartung_am);
    const naechsteWartungAm = calculateNextMaintenanceDate(letzteWartungAm, wartungsintervallTage);

    const result = await pool.query(`
      UPDATE werkzeuge
      SET name = $1,
          icon = $2,
          beschreibung = $3,
          inventarnummer = $4,
          zustand = $5,
          foto = COALESCE($6, foto),
          kategorie = $7,
          lagerplatz = $8,
          status = $9,
          wartungsintervall_tage = $10,
          letzte_wartung_am = $11,
          naechste_wartung_am = $12,
          wartung_notiz = $13,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [
      name,
      icon,
      beschreibung,
      inventarnummer,
      zustand,
      foto || null,
      kategorie,
      lagerplatz,
      status,
      wartungsintervallTage,
      letzteWartungAm,
      naechsteWartungAm,
      coerceNullableText(wartung_notiz),
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

    res.json({
      ...result.rows[0],
      wartungsstatus: calculateMaintenanceStatus(result.rows[0].naechste_wartung_am)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/werkzeuge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM werkzeuge WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }

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

app.get('/api/werkzeuge/:id/wartungen', async (req, res) => {
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

app.post('/api/werkzeuge/:id/wartungen', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { durchgefuehrt_am, notiz } = req.body;
    const durchgefuehrtAm = normalizeIsoDate(durchgefuehrt_am) || new Date().toISOString().slice(0, 10);

    await client.query('BEGIN');

    const werkzeugResult = await client.query(
      'SELECT id, wartungsintervall_tage FROM werkzeuge WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (werkzeugResult.rows.length === 0) {
      throw new Error('Werkzeug nicht gefunden');
    }

    const werkzeug = werkzeugResult.rows[0];
    const nextMaintenanceDate = calculateNextMaintenanceDate(durchgefuehrtAm, werkzeug.wartungsintervall_tage);

    const maintenanceResult = await client.query(`
      INSERT INTO wartungen (werkzeug_id, durchgefuehrt_am, notiz)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, durchgefuehrtAm, coerceNullableText(notiz)]);

    const toolResult = await client.query(`
      UPDATE werkzeuge
      SET letzte_wartung_am = $1,
          naechste_wartung_am = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [durchgefuehrtAm, nextMaintenanceDate, id]);

    await client.query('COMMIT');

    res.status(201).json({
      wartung: maintenanceResult.rows[0],
      werkzeug: {
        ...toolResult.rows[0],
        wartungsstatus: calculateMaintenanceStatus(toolResult.rows[0].naechste_wartung_am)
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== AUSLEIHEN ====================

app.get('/api/ausleihen', async (req, res) => {
  try {
    const { status, mitarbeiter_name, active_only } = req.query;

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
      params.push(mitarbeiter_name.trim());
      conditions.push(`LOWER(TRIM(a.mitarbeiter_name)) = LOWER(TRIM($${params.length}))`);
    }

    if (active_only === 'true') {
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
    const { from, days, werkzeug_id, kategorie, active_only } = req.query;
    const calendar = await getToolBookingCalendar({
      from,
      days,
      toolId: werkzeug_id ? Number.parseInt(werkzeug_id, 10) : null,
      category: kategorie || null,
      onlyActive: active_only !== 'false'
    });

    res.json(calendar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ausleihen/:id', async (req, res) => {
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
    const { werkzeuge, mitarbeiter_name, datum_von, datum_bis } = req.body;
    const startDate = normalizeIsoDate(datum_von);
    const endDate = normalizeIsoDate(datum_bis);

    if (!werkzeuge || werkzeuge.length === 0) {
      return res.status(400).json({ error: 'Keine Werkzeuge ausgewählt' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Ungültiger Reservierungszeitraum' });
    }

    if (startDate >= endDate) {
      return res.status(400).json({ error: 'Das Bis-Datum muss nach dem Von-Datum liegen' });
    }

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
        [werkzeugId, startDate, endDate]
      );

      if (overlapResult.rows.length > 0) {
        const konflikt = overlapResult.rows[0];
        throw new Error(`Werkzeug ${werkzeug.name} ist im Zeitraum ${konflikt.datum_von} bis ${konflikt.datum_bis} bereits ${konflikt.status}`);
      }

      const result = await client.query(`
        INSERT INTO ausleihen (werkzeug_id, mitarbeiter_name, datum_von, datum_bis, reserviert_am, status)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'reserviert')
        RETURNING *
      `, [werkzeugId, mitarbeiter_name, startDate, endDate]);

      await client.query(
        'UPDATE werkzeuge SET status = $1 WHERE id = $2',
        ['reserviert', werkzeugId]
      );

      reservierungen.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json(reservierungen);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/ausleihen/:id/ausgeben', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE ausleihen
      SET status = 'ausgeliehen', ausgeliehen_am = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      throw new Error('Ausleihe nicht gefunden');
    }

    await client.query(
      'UPDATE werkzeuge SET status = $1 WHERE id = $2',
      ['ausgeliehen', result.rows[0].werkzeug_id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/ausleihen/:id/rueckgabe', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { rueckgabe_zustand, rueckgabe_kommentar } = req.body;

    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE ausleihen
      SET status = 'zurueckgegeben',
          zurueckgegeben_am = CURRENT_TIMESTAMP,
          rueckgabe_zustand = $1,
          rueckgabe_kommentar = $2
      WHERE id = $3
      RETURNING *
    `, [rueckgabe_zustand, rueckgabe_kommentar, id]);

    if (result.rows.length === 0) {
      throw new Error('Ausleihe nicht gefunden');
    }

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
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/ausleihen/:id', async (req, res) => {
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
    res.json({ message: 'Ausleihe gelöscht' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== SCHÄDEN ====================

app.get('/api/schaeden', async (req, res) => {
  try {
    const { status } = req.query;

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
    const { werkzeug_id, mitarbeiter_name, beschreibung, foto } = req.body;

    await client.query('BEGIN');

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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/schaeden/:id/beheben', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE schaeden
      SET status = 'behoben'
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      throw new Error('Schaden nicht gefunden');
    }

    await refreshToolStatus(client, result.rows[0].werkzeug_id);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/schaeden/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM schaeden WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schaden nicht gefunden' });
    }

    res.json({ message: 'Schaden gelöscht', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATISTIKEN ====================

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'verfuegbar') as verfuegbar,
        COUNT(*) FILTER (WHERE status = 'reserviert') as reserviert,
        COUNT(*) FILTER (WHERE status = 'ausgeliehen') as ausgeliehen,
        COUNT(*) FILTER (WHERE status = 'defekt') as defekt,
        COUNT(*) as gesamt
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
      werkzeuge: stats.rows[0],
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

ensureMaintenanceSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 ToolHub Backend läuft auf Port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Wartungsschema konnte nicht initialisiert werden:', err);
    process.exit(1);
  });
