require('dotenv').config();
const { Pool } = require('pg');

async function initDatabase() {
  // First, connect to the default 'postgres' database to create our database
  const adminPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: 'postgres', // Connect to default postgres database
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🚀 Erstelle Datenbank falls sie nicht existiert...');
    
    // Create database if it doesn't exist
    await adminPool.query(`CREATE DATABASE "${process.env.DB_NAME}"`);
    console.log(`✅ Datenbank "${process.env.DB_NAME}" erstellt oder existiert bereits`);
    
  } catch (err) {
    if (err.code === '42P04') {
      console.log(`ℹ️ Datenbank "${process.env.DB_NAME}" existiert bereits`);
    } else {
      console.error('❌ Fehler beim Erstellen der Datenbank:', err);
      throw err;
    }
  } finally {
    await adminPool.end();
  }

  // Now connect to our target database
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

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
        bestand_gesamt INTEGER NOT NULL DEFAULT 1,
        bestand_defekt INTEGER NOT NULL DEFAULT 0,
        bestand_in_wartung INTEGER NOT NULL DEFAULT 0,
        einheitenmodell TEXT NOT NULL DEFAULT 'legacy_single',
        seriennummernpflicht BOOLEAN NOT NULL DEFAULT false,
        standard_hersteller TEXT,
        standard_modell TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabelle "werkzeuge" erstellt');

    await client.query(`
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
      );
    `);
    console.log('✅ Tabelle "werkzeug_einheiten" erstellt');

    await client.query(`
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
      );
    `);
    console.log('✅ Tabelle "werkzeug_einheit_historie" erstellt');

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
      CREATE INDEX IF NOT EXISTS idx_werkzeug_einheiten_werkzeug_id ON werkzeug_einheiten(werkzeug_id);
      CREATE INDEX IF NOT EXISTS idx_werkzeug_einheiten_status ON werkzeug_einheiten(status);
      CREATE INDEX IF NOT EXISTS idx_werkzeug_einheit_historie_einheit_id ON werkzeug_einheit_historie(werkzeug_einheit_id);
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
