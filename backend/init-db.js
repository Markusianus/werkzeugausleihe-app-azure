require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Initialisiere ToolHub Datenbank...');
    
    // Werkzeuge Tabelle
    await client.query(`
      CREATE TABLE IF NOT EXISTS werkzeuge (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        beschreibung TEXT,
        inventarnummer TEXT UNIQUE NOT NULL,
        zustand TEXT,
        foto TEXT,
        status TEXT DEFAULT 'verfuegbar',
        kategorie TEXT,
        lagerplatz TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabelle "werkzeuge" erstellt');

    // Ausleihen Tabelle
    await client.query(`
      CREATE TABLE IF NOT EXISTS ausleihen (
        id SERIAL PRIMARY KEY,
        werkzeug_id INTEGER NOT NULL,
        mitarbeiter_name TEXT,
        datum_von DATE,
        datum_bis DATE,
        reserviert_am TIMESTAMP,
        ausgeliehen_am TIMESTAMP,
        zurueckgegeben_am TIMESTAMP,
        status TEXT DEFAULT 'reserviert',
        rueckgabe_zustand TEXT,
        rueckgabe_kommentar TEXT,
        FOREIGN KEY (werkzeug_id) REFERENCES werkzeuge(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ Tabelle "ausleihen" erstellt');

    // Schäden Tabelle
    await client.query(`
      CREATE TABLE IF NOT EXISTS schaeden (
        id SERIAL PRIMARY KEY,
        werkzeug_id INTEGER NOT NULL,
        mitarbeiter_name TEXT,
        beschreibung TEXT,
        foto TEXT,
        gemeldet_am TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'offen',
        FOREIGN KEY (werkzeug_id) REFERENCES werkzeuge(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ Tabelle "schaeden" erstellt');

    // Indexes für Performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_werkzeuge_status ON werkzeuge(status);
      CREATE INDEX IF NOT EXISTS idx_werkzeuge_kategorie ON werkzeuge(kategorie);
      CREATE INDEX IF NOT EXISTS idx_ausleihen_werkzeug ON ausleihen(werkzeug_id);
      CREATE INDEX IF NOT EXISTS idx_ausleihen_status ON ausleihen(status);
      CREATE INDEX IF NOT EXISTS idx_schaeden_werkzeug ON schaeden(werkzeug_id);
      CREATE INDEX IF NOT EXISTS idx_schaeden_status ON schaeden(status);
    `);
    console.log('✅ Indexes erstellt');

    // Demo-Daten einfügen (optional)
    const result = await client.query('SELECT COUNT(*) FROM werkzeuge');
    if (result.rows[0].count === '0') {
      console.log('📦 Füge Demo-Daten ein...');
      
      await client.query(`
        INSERT INTO werkzeuge (name, icon, beschreibung, inventarnummer, zustand, kategorie, lagerplatz, status) VALUES
        ('Bohrmaschine', '⚡', 'Makita 18V Akkubohrschrauber', 'WZ-001', 'Gut', 'Elektro', 'Regal A1', 'verfuegbar'),
        ('Hammer', '🔨', 'Schlosserhammer 500g', 'WZ-002', 'Neu', 'Hand', 'Schublade 3', 'verfuegbar'),
        ('Stichsäge', '🪚', 'Bosch PST 900 PEL', 'WZ-003', 'Gut', 'Elektro', 'Regal A2', 'verfuegbar'),
        ('Schraubenzieher-Set', '🔧', '12-teiliges Set mit Schlitz & Kreuz', 'WZ-004', 'Gut', 'Hand', 'Schublade 1', 'verfuegbar'),
        ('Zollstock', '📏', 'Meterstab 2m', 'WZ-005', 'Neu', 'Mess', 'Schublade 2', 'verfuegbar'),
        ('Akkuschrauber', '🔋', 'Dewalt 20V Max', 'WZ-006', 'Gut', 'Elektro', 'Regal A3', 'verfuegbar'),
        ('Wasserwaage', '📐', 'Stabila 60cm', 'WZ-007', 'Gut', 'Mess', 'Regal B1', 'verfuegbar'),
        ('Schutzbrille', '🥽', 'Uvex X-Trend', 'WZ-008', 'Neu', 'Sicherheit', 'Schrank 1', 'verfuegbar');
      `);
      
      console.log('✅ Demo-Daten eingefügt');
    }

    console.log('🎉 Datenbank erfolgreich initialisiert!');
    
  } catch (err) {
    console.error('❌ Fehler bei der Datenbankinitialisierung:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();
