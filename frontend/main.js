// ToolHub - API Version
// Alle Datenbankoperationen über REST API

let currentMode = 'mitarbeiter';
let warenkorb = [];
let isAdmin = false;
let gespeicherterMitarbeiterName = localStorage.getItem('mitarbeiterName') || '';

// ==================== Initialization ====================

async function initApp() {
    // Prüfen ob Admin-Token noch gültig ist
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
        try {
            const response = await apiCall('/admin/verify');
            if (response.valid) {
                isAdmin = true;
                currentMode = 'admin';
            } else {
                localStorage.removeItem('adminToken');
            }
        } catch (err) {
            localStorage.removeItem('adminToken');
        }
    }

    // Initial mode setzen
    switchMode(currentMode);

    setMitarbeiterName(gespeicherterMitarbeiterName);
}

// ==================== API Helper ====================

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


async function apiCall(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
        ...options
    };

    // Admin-Token hinzufügen falls vorhanden
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
        defaultOptions.headers.Authorization = `Bearer ${adminToken}`;
    }

    try {
        const response = await fetch(buildApiUrl(endpoint), defaultOptions);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        // Bei 204 No Content kein JSON parsen
        if (response.status === 204) {
            return null;
        }

        return await response.json();
    } catch (err) {
        console.error('API Error:', err);
        throw err;
    }
}

function buildApiUrl(endpoint) {
    // Use window.API_URL when available, otherwise fallback to current origin
    const base = (window.API_URL && (window.API_URL + '').replace(/\/$/, '')) || window.location.origin;
    const rawBase = base.replace(/\/$/, '');

    // If endpoint already starts with /api, append directly
    if (endpoint.startsWith('/api')) return rawBase + endpoint;

    // If rawBase already contains /api at end, just join
    if (rawBase.endsWith('/api')) return rawBase + endpoint;

    // Otherwise insert /api
    return rawBase + '/api' + endpoint;
}

// ==================== Mode Switching ====================

function switchMode(mode) {
    currentMode = mode;
    
    if (mode === 'mitarbeiter') {
        document.getElementById('mitarbeiterMode').classList.remove('hidden');
        document.getElementById('adminMode').classList.add('hidden');
        document.getElementById('mitarbeiterBtn').className = 'btn-primary';
        document.getElementById('adminBtn').className = 'btn-secondary';
        loadWerkzeuge();
        loadMeineAusleihen();
    } else {
        if (!isAdmin) {
            showAdminLogin();
            return;
        }
        document.getElementById('mitarbeiterMode').classList.add('hidden');
        document.getElementById('adminMode').classList.remove('hidden');
        document.getElementById('mitarbeiterBtn').className = 'btn-secondary';
        document.getElementById('adminBtn').className = 'btn-primary';
        loadDashboard();
    }
}

async function showAdminLogin() {
    const password = prompt('Admin-Passwort eingeben:');
    if (!password) {
        switchMode('mitarbeiter');
        return;
    }

    try {
        const response = await apiCall('/admin/auth', {
            method: 'POST',
            body: JSON.stringify({ password: password })
        });

        if (response.success) {
            isAdmin = true;
            localStorage.setItem('adminToken', response.token);
            switchMode('admin');
        } else {
            alert('Falsches Passwort!');
            switchMode('mitarbeiter');
        }
    } catch (err) {
        alert('Authentifizierungsfehler: ' + err.message);
        switchMode('mitarbeiter');
    }
}

function logout() {
    isAdmin = false;
    localStorage.removeItem('adminToken');
    switchMode('mitarbeiter');
}

// ==================== Werkzeuge laden ====================

function getInitialToolIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('tool');
    if (!raw) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function buildWerkzeugDetailHtml(w) {
    const isVerfuegbar = w.status === 'verfuegbar';
    return `
        ${w.foto ? `<img src="${escapeHtml(w.foto)}" alt="${escapeHtml(w.name)}" style="max-width:100%;border-radius:12px;margin-bottom:16px;">` : ''}
        <div class="werkzeug-icon" style="margin-bottom:12px;">${escapeHtml(w.icon || '🔧')}</div>
        <h3>${escapeHtml(w.name)}</h3>
        <p>${escapeHtml(w.beschreibung || '')}</p>
        <div class="werkzeug-meta" style="margin:16px 0;">
            <span>📦 ${escapeHtml(w.inventarnummer || '-')}</span>
            ${w.kategorie ? `<span>🏷️ ${escapeHtml(w.kategorie)}</span>` : ''}
            ${w.lagerplatz ? `<span>📍 ${escapeHtml(w.lagerplatz)}</span>` : ''}
        </div>
        <div style="margin-bottom:16px;">${getStatusBadge(w.status)}</div>
        <button class="btn-primary" onclick="addToWarenkorb(${Number(w.id)}); closeModal('toolDetailModal');" ${!isVerfuegbar ? 'disabled' : ''}>
            ${isVerfuegbar ? '➕ In den Warenkorb' : 'Nicht verfügbar'}
        </button>
    `;
}

async function showWerkzeugDetail(id) {
    try {
        const werkzeug = await apiCall(`/werkzeuge/${id}`);
        document.getElementById('toolDetailContent').innerHTML = buildWerkzeugDetailHtml(werkzeug);
        document.getElementById('toolDetailModal').classList.add('active');
        const url = new URL(window.location.href);
        url.searchParams.set('tool', id);
        window.history.replaceState({}, '', url);
    } catch (err) {
        showToast('❌ Werkzeug aus QR-Code nicht gefunden');
        const url = new URL(window.location.href);
        url.searchParams.delete('tool');
        window.history.replaceState({}, '', url);
    }
}

async function loadWerkzeuge(filter = {}) {
    try {
        let endpoint = '/werkzeuge?';
        if (filter.kategorie) endpoint += `kategorie=${filter.kategorie}&`;
        if (filter.search) endpoint += `search=${filter.search}&`;
        
        const werkzeuge = await apiCall(endpoint);
        
        const container = document.getElementById('werkzeugeList');
        container.innerHTML = '';
        
        if (werkzeuge.length === 0) {
            container.innerHTML = '<p style="text-align:center;padding:40px;">Keine Werkzeuge gefunden</p>';
            return;
        }
        
        werkzeuge.forEach(w => {
            const card = document.createElement('div');
            card.className = 'werkzeug-card';
            
            const isVerfuegbar = w.status === 'verfuegbar';
            const statusBadge = getStatusBadge(w.status);
            
            card.innerHTML = `
                ${w.foto ? `<img src="${w.foto}" alt="${w.name}">` : ''}
                <div class="werkzeug-icon">${w.icon || '🔧'}</div>
                <div class="werkzeug-info">
                    <h3>${w.name}</h3>
                    <p>${w.beschreibung || ''}</p>
                    <div class="werkzeug-meta">
                        <span>📦 ${w.inventarnummer}</span>
                        ${w.kategorie ? `<span>🏷️ ${w.kategorie}</span>` : ''}
                        ${w.lagerplatz ? `<span>📍 ${w.lagerplatz}</span>` : ''}
                    </div>
                    ${statusBadge}
                </div>
                <button class="btn-secondary" onclick="showWerkzeugDetail(${w.id})">ℹ️ Details</button>
                <button 
                    class="btn-primary" 
                    onclick="addToWarenkorb(${w.id})" 
                    ${!isVerfuegbar ? 'disabled' : ''}>
                    ${isVerfuegbar ? '➕ In den Warenkorb' : 'Nicht verfügbar'}
                </button>
                <button class="btn-warning btn-small" onclick="showSchadenMelden(${w.id})">🔧 Schaden melden</button>
            `;
            
            container.appendChild(card);
        });
    } catch (err) {
        showToast('❌ Fehler beim Laden der Werkzeuge');
        console.error(err);
    }
}

function getStatusBadge(status) {
    const badges = {
        'verfuegbar': '<span class="status-badge status-verfuegbar">✅ Verfügbar</span>',
        'reserviert': '<span class="status-badge status-reserviert">🔖 Reserviert</span>',
        'ausgeliehen': '<span class="status-badge status-ausgeliehen">📤 Ausgeliehen</span>',
        'defekt': '<span class="status-badge status-defekt">⚠️ Defekt</span>',
        'reinigung': '<span class="status-badge status-reinigung">🧹 In Reinigung</span>',
        'reparatur': '<span class="status-badge status-reparatur">🔧 In Reparatur</span>'
    };
    return badges[status] || status;
}

// ==================== Warenkorb ====================

function addToWarenkorb(werkzeugId) {
    if (!warenkorb.includes(werkzeugId)) {
        warenkorb.push(werkzeugId);
        updateWarenkorbBadge();
        showToast('✓ Zum Warenkorb hinzugefügt');
    } else {
        showToast('ℹ️ Bereits im Warenkorb');
    }
}

function updateWarenkorbBadge() {
    document.getElementById('warenkorbBadge').textContent = warenkorb.length;
}

async function showWarenkorb() {
    if (warenkorb.length === 0) {
        alert('Warenkorb ist leer!');
        return;
    }
    
    try {
        const werkzeuge = await apiCall('/werkzeuge');
        const ausgewaehlte = werkzeuge.filter(w => warenkorb.includes(w.id));
        
        let html = '<h3>Ausgewählte Werkzeuge:</h3><ul>';
        ausgewaehlte.forEach(w => {
            html += `<li>${w.icon || '🔧'} ${w.name} (${w.inventarnummer}) 
                     <button class="btn-danger btn-small" onclick="removeFromWarenkorb(${w.id})">❌</button></li>`;
        });
        html += '</ul>';
        
        html += `
            <div class="form-group">
                <label>Ihr Name *</label>
                <input type="text" id="reservierungName" placeholder="Max Mustermann">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Von *</label>
                    <input type="date" id="reservierungVon">
                </div>
                <div class="form-group">
                    <label>Bis *</label>
                    <input type="date" id="reservierungBis">
                </div>
            </div>
            <button class="btn-success" onclick="submitReservierung()">✓ Reservieren</button>
            <button class="btn-secondary" onclick="closeModal('warenkorbModal')">Abbrechen</button>
        `;
        
        document.getElementById('warenkorbContent').innerHTML = html;
        document.getElementById('warenkorbModal').classList.add('active');
    } catch (err) {
        alert('Fehler beim Laden: ' + err.message);
    }
}

function removeFromWarenkorb(werkzeugId) {
    warenkorb = warenkorb.filter(id => id !== werkzeugId);
    updateWarenkorbBadge();
    showWarenkorb(); // Refresh
}

async function submitReservierung() {
    const name = document.getElementById('reservierungName').value;
    const von = document.getElementById('reservierungVon').value;
    const bis = document.getElementById('reservierungBis').value;
    
    if (!name || !von || !bis) {
        alert('Bitte alle Felder ausfüllen!');
        return;
    }
    
    if (new Date(bis) <= new Date(von)) {
        alert('Das "Bis"-Datum muss nach dem "Von"-Datum liegen!');
        return;
    }
    
    try {
        await apiCall('/ausleihen', {
            method: 'POST',
            body: JSON.stringify({
                werkzeuge: warenkorb,
                mitarbeiter_name: name,
                datum_von: von,
                datum_bis: bis
            })
        });
        
        setMitarbeiterName(name);
        showToast('✓ Reservierung erfolgreich!');
        warenkorb = [];
        updateWarenkorbBadge();
        closeModal('warenkorbModal');
        loadWerkzeuge();
        loadMeineAusleihen();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}


function normalizeMitarbeiterName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function setMitarbeiterName(name) {
    gespeicherterMitarbeiterName = normalizeMitarbeiterName(name);
    const input = document.getElementById('meineAusleihenName');
    if (input && input.value !== gespeicherterMitarbeiterName) {
        input.value = gespeicherterMitarbeiterName;
    }
    if (gespeicherterMitarbeiterName) {
        localStorage.setItem('mitarbeiterName', gespeicherterMitarbeiterName);
    } else {
        localStorage.removeItem('mitarbeiterName');
    }
}

function renderMeineAusleihen(ausleihen, mitarbeiterName) {
    const list = document.getElementById('meineAusleihenList');
    const empty = document.getElementById('meineAusleihenEmpty');
    if (!list || !empty) return;

    list.innerHTML = '';

    if (!mitarbeiterName) {
        empty.textContent = 'Name eingeben, um aktive eigene Ausleihen zu sehen.';
        return;
    }

    if (!ausleihen.length) {
        empty.textContent = `Keine aktiven Ausleihen für ${mitarbeiterName} gefunden.`;
        return;
    }

    empty.textContent = `${ausleihen.length} aktive Ausleihe${ausleihen.length === 1 ? '' : 'n'} für ${mitarbeiterName}.`;

    ausleihen.forEach(a => {
        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.style.textAlign = 'left';

        const isUeberfaellig = a.status === 'ausgeliehen' && a.datum_bis && new Date(a.datum_bis) < new Date();
        const dateRange = `${formatDate(a.datum_von)} – ${formatDate(a.datum_bis)}`;
        const extraHint = a.status === 'reserviert'
            ? '<p style="margin-top:8px;font-size:0.9em;opacity:0.9;">Noch nicht ausgegeben</p>'
            : (isUeberfaellig
                ? '<p style="margin-top:8px;font-size:0.9em;color:#fecaca;">⚠️ Rückgabe überfällig</p>'
                : '<p style="margin-top:8px;font-size:0.9em;opacity:0.9;">Aktuell ausgeliehen</p>');

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                    <div style="font-size:1.6em; margin-bottom:8px;">${escapeHtml(a.icon || '🔧')}</div>
                    <h3 style="font-size:1.2em; margin-bottom:6px;">${escapeHtml(a.werkzeug_name)}</h3>
                    <p style="font-size:0.9em; opacity:0.9;">${escapeHtml(a.inventarnummer || '-')}</p>
                </div>
                <div>${getAusleiheStatusBadge(a.status)}</div>
            </div>
            <div style="margin-top:14px; font-size:0.95em; line-height:1.5;">
                <div><strong>Zeitraum:</strong> ${escapeHtml(dateRange)}</div>
                ${a.reserviert_am ? `<div><strong>Reserviert am:</strong> ${escapeHtml(formatDate(a.reserviert_am))}</div>` : ''}
                ${a.ausgeliehen_am ? `<div><strong>Ausgegeben am:</strong> ${escapeHtml(formatDate(a.ausgeliehen_am))}</div>` : ''}
            </div>
            ${extraHint}
        `;
        list.appendChild(card);
    });
}

async function loadMeineAusleihen() {
    const input = document.getElementById('meineAusleihenName');
    const mitarbeiterName = normalizeMitarbeiterName(input?.value || gespeicherterMitarbeiterName);
    setMitarbeiterName(mitarbeiterName);

    if (!mitarbeiterName) {
        renderMeineAusleihen([], '');
        return;
    }

    try {
        const ausleihen = await apiCall(`/ausleihen?active_only=true&mitarbeiter_name=${encodeURIComponent(mitarbeiterName)}`);
        renderMeineAusleihen(ausleihen, mitarbeiterName);
    } catch (err) {
        const empty = document.getElementById('meineAusleihenEmpty');
        const list = document.getElementById('meineAusleihenList');
        if (list) list.innerHTML = '';
        if (empty) empty.textContent = `Fehler beim Laden der Ausleihen: ${err.message}`;
    }
}

// ==================== Schaden melden ====================

async function showSchadenMelden(werkzeugId) {
    document.getElementById('schadenWerkzeugId').value = werkzeugId;
    document.getElementById('schadenForm').reset();
    document.getElementById('schadenFotoPreview').innerHTML = '';
    document.getElementById('schadenModal').classList.add('active');
}

function previewSchadenFoto(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('schadenFotoPreview').innerHTML = 
                `<img src="${e.target.result}" style="max-width:200px;margin-top:10px;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function submitSchaden(event) {
    event.preventDefault();
    
    const werkzeugId = document.getElementById('schadenWerkzeugId').value;
    const name = document.getElementById('schadenMitarbeiter').value;
    const beschreibung = document.getElementById('schadenBeschreibung').value;
    
    let foto = null;
    const fotoInput = document.getElementById('schadenFoto');
    if (fotoInput.files && fotoInput.files[0]) {
        foto = await fileToBase64(fotoInput.files[0]);
    }
    
    try {
        await apiCall('/schaeden', {
            method: 'POST',
            body: JSON.stringify({
                werkzeug_id: werkzeugId,
                mitarbeiter_name: name,
                beschreibung: beschreibung,
                foto: foto
            })
        });
        
        showToast('✓ Schaden gemeldet!');
        closeModal('schadenModal');
        loadWerkzeuge();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== Admin Dashboard ====================

async function loadDashboard() {
    try {
        const stats = await apiCall('/stats');
        
        // Safely set dashboard stats only if elements exist
        const setStat = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (value !== undefined && value !== null) ? value : 0;
        };

        setStat('statVerfuegbar', stats.werkzeuge?.verfuegbar);
        setStat('statReserviert', stats.werkzeuge?.reserviert);
        setStat('statAusgeliehen', stats.werkzeuge?.ausgeliehen);
        setStat('statDefekt', stats.werkzeuge?.defekt);
        setStat('statGesamt', stats.werkzeuge?.gesamt);

        setStat('statAusleihenReserviert', stats.ausleihen?.reserviert);
        setStat('statAusleihenAusgeliehen', stats.ausleihen?.ausgeliehen);
        setStat('statAusleihenUeberfaellig', stats.ausleihen?.ueberfaellig);

        setStat('statSchaeden', stats.schaeden?.offen);

        // Top 5 Werkzeuge (if container exists)
        const topList = document.getElementById('topWerkzeugeList');
        if (topList) {
            topList.innerHTML = '';
            (stats.top_werkzeuge || []).forEach((w, i) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${i + 1}. ${w.icon || '🔧'} ${w.name}</span> <span class="badge">${w.anzahl_ausleihen}x</span>`;
                topList.appendChild(li);
            });
        }
        
        // Daten laden
        loadAdminWerkzeuge();
        loadAusleihen();
        loadSchaeden();
    } catch (err) {
        console.error('Fehler beim Laden der Stats:', err);
    }
}

// ==================== Admin Werkzeuge ====================

async function loadAdminWerkzeuge() {
    try {
        const werkzeuge = await apiCall('/werkzeuge');
        
        const tbody = document.getElementById('adminWerkzeugeTable');
        tbody.innerHTML = '';
        
        werkzeuge.forEach(w => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${w.icon || '🔧'}</td>
                <td>${w.name}</td>
                <td>${w.inventarnummer}</td>
                <td>${w.kategorie || '-'}</td>
                <td>${w.lagerplatz || '-'}</td>
                <td>${getStatusBadge(w.status)}</td>
                <td>
                    <button class="btn-primary btn-small" onclick="showQRCode(${w.id}, '${w.name}', '${w.inventarnummer}')">QR</button>
                    <button class="btn-warning btn-small" onclick="editWerkzeug(${w.id})">✏️</button>
                    <button class="btn-danger btn-small" onclick="deleteWerkzeug(${w.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Fehler beim Laden:', err);
    }
}

function showAddWerkzeug() {
    document.getElementById('werkzeugForm').reset();
    document.getElementById('werkzeugId').value = '';
    document.getElementById('werkzeugFotoPreview').innerHTML = '';
    document.getElementById('werkzeugModalTitle').textContent = 'Neues Werkzeug hinzufügen';
    document.getElementById('werkzeugModal').classList.add('active');
}

async function editWerkzeug(id) {
    try {
        const werkzeug = await apiCall(`/werkzeuge/${id}`);
        
        document.getElementById('werkzeugId').value = werkzeug.id;
        document.getElementById('werkzeugName').value = werkzeug.name;
        document.getElementById('werkzeugIcon').value = werkzeug.icon || '';
        document.getElementById('werkzeugBeschreibung').value = werkzeug.beschreibung || '';
        document.getElementById('werkzeugInventarnummer').value = werkzeug.inventarnummer;
        document.getElementById('werkzeugStatus').value = werkzeug.status || 'verfuegbar';
        document.getElementById('werkzeugZustand').value = werkzeug.zustand || '';
        document.getElementById('werkzeugKategorie').value = werkzeug.kategorie || '';
        document.getElementById('werkzeugLagerplatz').value = werkzeug.lagerplatz || '';
        
        if (werkzeug.foto) {
            document.getElementById('werkzeugFotoPreview').innerHTML = 
                `<img src="${werkzeug.foto}" style="max-width:200px;margin-top:10px;">`;
        }
        
        document.getElementById('werkzeugModalTitle').textContent = 'Werkzeug bearbeiten';
        document.getElementById('werkzeugModal').classList.add('active');
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

function previewWerkzeugFoto(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('werkzeugFotoPreview').innerHTML = 
                `<img src="${e.target.result}" style="max-width:200px;margin-top:10px;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function saveWerkzeug(event) {
    event.preventDefault();
    
    const id = document.getElementById('werkzeugId').value;
    const data = {
        name: document.getElementById('werkzeugName').value,
        icon: document.getElementById('werkzeugIcon').value,
        beschreibung: document.getElementById('werkzeugBeschreibung').value,
        inventarnummer: document.getElementById('werkzeugInventarnummer').value,
        status: document.getElementById('werkzeugStatus').value,
        zustand: document.getElementById('werkzeugZustand').value,
        kategorie: document.getElementById('werkzeugKategorie').value,
        lagerplatz: document.getElementById('werkzeugLagerplatz').value
    };
    
    // Foto (falls neu hochgeladen)
    const fotoInput = document.getElementById('werkzeugFoto');
    if (fotoInput.files && fotoInput.files[0]) {
        data.foto = await fileToBase64(fotoInput.files[0]);
    }
    
    try {
        if (id) {
            // Bearbeiten
            await apiCall(`/werkzeuge/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('✓ Werkzeug aktualisiert!');
        } else {
            // Neu erstellen
            await apiCall('/werkzeuge', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('✓ Werkzeug hinzugefügt!');
        }
        
        closeModal('werkzeugModal');
        loadAdminWerkzeuge();
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteWerkzeug(id) {
    if (!confirm('Werkzeug wirklich löschen?')) return;
    
    try {
        await apiCall(`/werkzeuge/${id}`, {
            method: 'DELETE'
        });
        showToast('✓ Werkzeug gelöscht!');
        loadAdminWerkzeuge();
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== QR-Code ====================

function showQRCode(id, name, inventarnummer) {
    const url = `${window.location.origin}?tool=${id}`;
    
    document.getElementById('qrWerkzeugName').textContent = `${name} (${inventarnummer})`;
    
    const qrContainer = document.getElementById('qrCodeContainer');
    qrContainer.innerHTML = '';
    
    new QRCode(qrContainer, {
        text: url,
        width: 200,
        height: 200
    });
    
    document.getElementById('qrModal').classList.add('active');
}

// ==================== Ausleihen ====================

async function loadAusleihen() {
    try {
        const status = document.getElementById('ausleihenFilter')?.value || '';
        const endpoint = status ? `/ausleihen?status=${status}` : '/ausleihen';
        const ausleihen = await apiCall(endpoint);
        
        const tbody = document.getElementById('ausleihenTable');
        tbody.innerHTML = '';
        
        ausleihen.forEach(a => {
            const row = document.createElement('tr');
            
            const isUeberfaellig = a.status === 'ausgeliehen' && new Date(a.datum_bis) < new Date();
            const ueberfaelligBadge = isUeberfaellig ? '<span class="badge badge-danger pulse">⚠️ Überfällig</span>' : '';
            
            row.innerHTML = `
                <td>${a.werkzeug_name} (${a.inventarnummer})</td>
                <td>${a.mitarbeiter_name}</td>
                <td>${formatDate(a.datum_von)} - ${formatDate(a.datum_bis)}</td>
                <td>${getAusleiheStatusBadge(a.status)} ${ueberfaelligBadge}</td>
                <td>
                    ${a.status === 'reserviert' ? `<button class="btn-success btn-small" onclick="ausgebenAusleihe(${a.id})">✓ Ausgeben</button>` : ''}
                    ${a.status === 'ausgeliehen' ? `<button class="btn-warning btn-small" onclick="showRueckgabe(${a.id})">↩️ Rückgabe</button>` : ''}
                    <button class="btn-danger btn-small" onclick="deleteAusleihe(${a.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Fehler beim Laden:', err);
    }
}

function getAusleiheStatusBadge(status) {
    const badges = {
        'reserviert': '<span class="status-badge status-reserviert">🔖 Reserviert</span>',
        'ausgeliehen': '<span class="status-badge status-ausgeliehen">📤 Ausgeliehen</span>',
        'zurueckgegeben': '<span class="status-badge status-verfuegbar">↩️ Zurückgegeben</span>'
    };
    return badges[status] || status;
}

async function ausgebenAusleihe(id) {
    if (!confirm('Ausleihe ausgeben?')) return;
    
    try {
        await apiCall(`/ausleihen/${id}/ausgeben`, {
            method: 'PATCH'
        });
        showToast('✓ Ausleihe ausgegeben!');
        loadAusleihen();
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

function showRueckgabe(id) {
    document.getElementById('rueckgabeId').value = id;
    document.getElementById('rueckgabeForm').reset();
    document.getElementById('rueckgabeModal').classList.add('active');
}

async function submitRueckgabe(event) {
    event.preventDefault();
    
    const id = document.getElementById('rueckgabeId').value;
    const zustand = document.getElementById('rueckgabeZustand').value;
    const kommentar = document.getElementById('rueckgabeKommentar').value;
    
    try {
        await apiCall(`/ausleihen/${id}/rueckgabe`, {
            method: 'PATCH',
            body: JSON.stringify({
                rueckgabe_zustand: zustand,
                rueckgabe_kommentar: kommentar
            })
        });
        
        showToast('✓ Rückgabe dokumentiert!');
        closeModal('rueckgabeModal');
        loadAusleihen();
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteAusleihe(id) {
    if (!confirm('Ausleihe löschen?')) return;
    
    try {
        await apiCall(`/ausleihen/${id}`, {
            method: 'DELETE'
        });
        showToast('✓ Ausleihe gelöscht!');
        loadAusleihen();
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== Schäden (Admin) ====================

async function loadSchaeden() {
    try {
        const schaeden = await apiCall('/schaeden');
        
        const tbody = document.getElementById('schaedenTable');
        tbody.innerHTML = '';
        
        schaeden.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${s.werkzeug_name} (${s.inventarnummer})</td>
                <td>${s.mitarbeiter_name || '-'}</td>
                <td>${s.beschreibung}</td>
                <td>${formatDate(s.gemeldet_am)}</td>
                <td>${s.status === 'offen' ? '<span class="badge badge-danger">Offen</span>' : '<span class="badge badge-success">Behoben</span>'}</td>
                <td>
                    ${s.foto ? `<button class="btn-primary btn-small" onclick="showSchadenFoto('${s.foto}')">📷</button>` : ''}
                    ${s.status === 'offen' ? `<button class="btn-success btn-small" onclick="behebenSchaden(${s.id})">✓ Behoben</button>` : ''}
                    <button class="btn-danger btn-small" onclick="deleteSchaden(${s.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Fehler beim Laden:', err);
    }
}

function showSchadenFoto(foto) {
    const img = document.createElement('img');
    img.src = foto;
    img.style.maxWidth = '100%';
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `<div class="modal-content"><button onclick="this.parentElement.parentElement.remove()" class="btn-secondary">Schließen</button></div>`;
    modal.querySelector('.modal-content').prepend(img);
    
    document.body.appendChild(modal);
}

async function behebenSchaden(id) {
    if (!confirm('Schaden als behoben markieren?')) return;
    
    try {
        await apiCall(`/schaeden/${id}/beheben`, {
            method: 'PATCH'
        });
        showToast('✓ Schaden behoben!');
        loadSchaeden();
        loadDashboard();
        loadAdminWerkzeuge();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteSchaden(id) {
    if (!confirm('Schaden löschen?')) return;
    
    try {
        await apiCall(`/schaeden/${id}`, {
            method: 'DELETE'
        });
        showToast('✓ Schaden gelöscht!');
        loadSchaeden();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== CSV Import/Export ====================

async function exportCSV() {
    try {
        const response = await fetch(buildApiUrl('/export/werkzeuge'));
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'werkzeuge.csv';
        a.click();
        showToast('✓ Export erfolgreich!');
    } catch (err) {
        alert('Fehler beim Export: ' + err.message);
    }
}

function showImportCSV() {
    document.getElementById('importModal').classList.add('active');
}

async function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const text = await file.text();
    const lines = text.split('\n').slice(1); // Erste Zeile (Header) überspringen
    
    let imported = 0;
    let errors = 0;
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
        if (parts.length < 4) continue;
        
        const data = {
            name: parts[0],
            beschreibung: parts[1],
            zustand: parts[2],
            inventarnummer: parts[3],
            kategorie: parts[4] || '',
            lagerplatz: parts[5] || ''
        };
        
        try {
            await apiCall('/werkzeuge', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            imported++;
        } catch (err) {
            console.error('Fehler bei:', data.name, err);
            errors++;
        }
    }
    
    showToast(`✓ Import abgeschlossen: ${imported} erfolgreich, ${errors} Fehler`);
    closeModal('importModal');
    loadAdminWerkzeuge();
    loadDashboard();
}

// ==================== Helper Functions ====================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE');
}

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function filterWerkzeuge() {
    const kategorie = document.getElementById('kategorieFilter')?.value || '';
    const search = document.getElementById('searchInput')?.value || '';
    loadWerkzeuge({ kategorie, search });
}

function filterAusleihen() {
    loadAusleihen();
}

// ==================== Init ====================

document.addEventListener('DOMContentLoaded', () => {
    // Event Listener
    document.getElementById('schadenForm')?.addEventListener('submit', submitSchaden);
    document.getElementById('werkzeugForm')?.addEventListener('submit', saveWerkzeug);
    document.getElementById('rueckgabeForm')?.addEventListener('submit', submitRueckgabe);
    
    // Auto-Dates setzen
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('reservierungVon')?.setAttribute('min', today);
    document.getElementById('reservierungBis')?.setAttribute('min', today);
    
    // Initiales Laden
    initApp();

    const toolId = getInitialToolIdFromUrl();
    if (toolId) {
        showWerkzeugDetail(toolId);
    }
    console.log('ToolHub API-Version geladen');
    console.log('API URL:', window.API_URL);
});
