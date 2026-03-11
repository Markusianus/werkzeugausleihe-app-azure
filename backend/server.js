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
  connectionTimeoutMillis: 10000, // Erhöht von 2000ms auf 10000ms
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*'
}));
app.use(bodyParser.json({ limit: '50mb' })); // Für Base64 Fotos
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

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
    // Einfache Token-basierte Auth (für Demo - in Produktion JWT verwenden)
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
    // Einfache Token-Verifizierung (für Demo)
    //TODO: In Produktion sollte hier eine robustere Methode verwendet werden (z.B. JWT mit Secret)
    const decoded = Buffer.from(token, 'base64').toString();
    const isValid = decoded.startsWith('admin:');

    res.json({ valid: isValid });
  } catch (err) {
    res.status(401).json({ valid: false });
  }
});

// ==================== WERKZEUGE ====================

// Alle Werkzeuge abrufen
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
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Einzelnes Werkzeug abrufen
app.get('/api/werkzeuge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM werkzeuge WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Neues Werkzeug erstellen
app.post('/api/werkzeuge', async (req, res) => {
  try {
    const { name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz } = req.body;
    
    const result = await pool.query(`
      INSERT INTO werkzeuge (name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verfuegbar')
      RETURNING *
    `, [name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Inventarnummer bereits vorhanden' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Werkzeug aktualisieren
app.put('/api/werkzeuge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, status } = req.body;
    
    const result = await pool.query(`
      UPDATE werkzeuge 
      SET name = $1, icon = $2, beschreibung = $3, inventarnummer = $4, zustand = $5, 
          foto = $6, kategorie = $7, lagerplatz = $8, status = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [name, icon, beschreibung, inventarnummer, zustand, foto, kategorie, lagerplatz, status, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Werkzeug nicht gefunden' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Werkzeug löschen
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

// ==================== AUSLEIHEN ====================

// Alle Ausleihen abrufen
app.get('/api/ausleihen', async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = `
      SELECT a.*, w.name as werkzeug_name, w.inventarnummer, w.icon
      FROM ausleihen a
      JOIN werkzeuge w ON a.werkzeug_id = w.id
    `;
    const params = [];
    
    if (status) {
      params.push(status);
      query += ` WHERE a.status = $${params.length}`;
    }
    
    query += ' ORDER BY a.datum_von DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Einzelne Ausleihe abrufen
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

// Neue Reservierung erstellen
app.post('/api/ausleihen', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { werkzeuge, mitarbeiter_name, datum_von, datum_bis } = req.body;
    
    if (!werkzeuge || werkzeuge.length === 0) {
      return res.status(400).json({ error: 'Keine Werkzeuge ausgewählt' });
    }
    
    await client.query('BEGIN');
    
    const reservierungen = [];
    
    for (const werkzeugId of werkzeuge) {
      // Prüfe ob Werkzeug verfügbar
      const werkzeugResult = await client.query(
        'SELECT status FROM werkzeuge WHERE id = $1 FOR UPDATE',
        [werkzeugId]
      );
      
      if (werkzeugResult.rows.length === 0) {
        throw new Error(`Werkzeug ${werkzeugId} nicht gefunden`);
      }
      
      if (werkzeugResult.rows[0].status !== 'verfuegbar') {
        throw new Error(`Werkzeug ${werkzeugId} ist nicht verfügbar`);
      }
      
      // Reservierung erstellen
      const result = await client.query(`
        INSERT INTO ausleihen (werkzeug_id, mitarbeiter_name, datum_von, datum_bis, reserviert_am, status)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'reserviert')
        RETURNING *
      `, [werkzeugId, mitarbeiter_name, datum_von, datum_bis]);
      
      // Werkzeug-Status aktualisieren
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

// Ausleihe ausgeben (Admin)
app.patch('/api/ausleihen/:id/ausgeben', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Status aktualisieren
    const result = await client.query(`
      UPDATE ausleihen 
      SET status = 'ausgeliehen', ausgeliehen_am = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Ausleihe nicht gefunden');
    }
    
    // Werkzeug-Status aktualisieren
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

// Rückgabe dokumentieren (Admin)
app.patch('/api/ausleihen/:id/rueckgabe', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { rueckgabe_zustand, rueckgabe_kommentar } = req.body;
    
    await client.query('BEGIN');
    
    // Ausleihe aktualisieren
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
    
    // Werkzeug-Status aktualisieren
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
    
    await client.query('COMMIT');
    res.json(result.rows[0]);
    
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Ausleihe löschen
app.delete('/api/ausleihen/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Ausleihe abrufen
    const ausleiheResult = await client.query('SELECT werkzeug_id FROM ausleihen WHERE id = $1', [id]);
    
    if (ausleiheResult.rows.length === 0) {
      throw new Error('Ausleihe nicht gefunden');
    }
    
    const werkzeugId = ausleiheResult.rows[0].werkzeug_id;
    
    // Ausleihe löschen
    await client.query('DELETE FROM ausleihen WHERE id = $1', [id]);
    
    // Werkzeug wieder verfügbar machen
    await client.query('UPDATE werkzeuge SET status = $1 WHERE id = $2', ['verfuegbar', werkzeugId]);
    
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

// Alle Schäden abrufen
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

// Schaden melden
app.post('/api/schaeden', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { werkzeug_id, mitarbeiter_name, beschreibung, foto } = req.body;
    
    await client.query('BEGIN');
    
    // Schaden erstellen
    const result = await client.query(`
      INSERT INTO schaeden (werkzeug_id, mitarbeiter_name, beschreibung, foto)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [werkzeug_id, mitarbeiter_name, beschreibung, foto]);
    
    // Werkzeug als defekt markieren
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

// Schaden beheben
app.patch('/api/schaeden/:id/beheben', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Schaden aktualisieren
    const result = await client.query(`
      UPDATE schaeden 
      SET status = 'behoben'
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Schaden nicht gefunden');
    }
    
    // Werkzeug wieder verfügbar machen
    await client.query(
      'UPDATE werkzeuge SET status = $1 WHERE id = $2',
      ['verfuegbar', result.rows[0].werkzeug_id]
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

// Schaden löschen
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

// Dashboard-Statistiken
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
    
    // Top 5 Werkzeuge
    const topWerkzeuge = await pool.query(`
      SELECT w.name, w.icon, COUNT(a.id) as anzahl_ausleihen
      FROM werkzeuge w
      LEFT JOIN ausleihen a ON w.id = a.werkzeug_id
      GROUP BY w.id, w.name, w.icon
      ORDER BY anzahl_ausleihen DESC
      LIMIT 5
    `);
    
    res.json({
      werkzeuge: stats.rows[0],
      ausleihen: ausleihenStats.rows[0],
      schaeden: schadenStats.rows[0],
      top_werkzeuge: topWerkzeuge.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CSV EXPORT ====================

app.get('/api/export/werkzeuge', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM werkzeuge ORDER BY name');
    
    let csv = 'Werkzeug,Beschreibung,Zustand,Inventarnummer,Kategorie,Lagerplatz,Status\n';
    result.rows.forEach(w => {
      csv += `"${w.name}","${w.beschreibung || ''}","${w.zustand || ''}","${w.inventarnummer}","${w.kategorie || ''}","${w.lagerplatz || ''}","${w.status}"\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=werkzeuge.csv');
    res.send('\uFEFF' + csv); // UTF-8 BOM
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 ToolHub Backend läuft auf Port ${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/api/health`);
});

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM empfangen, fahre Server herunter...');
  await pool.end();
  process.exit(0);
});
