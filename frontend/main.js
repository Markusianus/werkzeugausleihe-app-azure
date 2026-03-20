// ToolHub - API Version
// Alle Datenbankoperationen über REST API

let currentMode = 'mitarbeiter';
let warenkorb = [];
let isAdmin = false;
let gespeicherterMitarbeiterName = localStorage.getItem('mitarbeiterName') || '';
let kalenderKategorien = [];
let kalenderState = {
    startDate: toIsoDate(new Date()),
    days: 28,
    kategorie: ''
};
let wartungsverlaufWerkzeugId = null;

// ==================== Initialization ====================

async function initApp() {
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
    const base = (window.API_URL && (window.API_URL + '').replace(/\/$/, '')) || window.location.origin;
    const rawBase = base.replace(/\/$/, '');

    if (endpoint.startsWith('/api')) return rawBase + endpoint;
    if (rawBase.endsWith('/api')) return rawBase + endpoint;
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
            body: JSON.stringify({ password })
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

function getWartungsStatusBadge(werkzeug) {
    const next = werkzeug?.naechste_wartung_am;
    const status = werkzeug?.wartungsstatus;

    if (!werkzeug?.wartungsintervall_tage) {
        return '<span class="status-badge maintenance-none">🛠️ Kein Intervall</span>';
    }

    if (status === 'ueberfaellig') {
        return `<span class="status-badge maintenance-overdue">🚨 Wartung überfällig${next ? ` seit ${escapeHtml(formatDate(next))}` : ''}</span>`;
    }

    if (status === 'faellig') {
        return '<span class="status-badge maintenance-due">⏰ Wartung heute fällig</span>';
    }

    return `<span class="status-badge maintenance-ok">🗓️ Nächste Wartung ${next ? escapeHtml(formatDate(next)) : 'offen'}</span>`;
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
        <div style="margin-bottom:12px;">${getStatusBadge(w.status)}</div>
        <div style="margin-bottom:16px;">${getWartungsStatusBadge(w)}</div>
        ${w.wartungsintervall_tage ? `
            <div class="info" style="margin-bottom:16px;text-align:left;">
                <strong>Wartung:</strong> alle ${escapeHtml(w.wartungsintervall_tage)} Tage<br>
                <strong>Letzte Wartung:</strong> ${escapeHtml(formatDate(w.letzte_wartung_am))}<br>
                <strong>Nächste Wartung:</strong> ${escapeHtml(formatDate(w.naechste_wartung_am))}
                ${w.wartung_notiz ? `<br><strong>Hinweis:</strong> ${escapeHtml(w.wartung_notiz)}` : ''}
            </div>
        ` : ''}
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
        if (filter.kategorie) endpoint += `kategorie=${encodeURIComponent(filter.kategorie)}&`;
        if (filter.search) endpoint += `search=${encodeURIComponent(filter.search)}&`;

        const werkzeuge = await apiCall(endpoint);
        const container = document.getElementById('werkzeugeList');
        container.innerHTML = '';

        updateKategorieFilter(werkzeuge);

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
                ${w.foto ? `<img src="${w.foto}" alt="${escapeHtml(w.name)}">` : ''}
                <div class="werkzeug-icon">${escapeHtml(w.icon || '🔧')}</div>
                <div class="werkzeug-info">
                    <h3>${escapeHtml(w.name)}</h3>
                    <p>${escapeHtml(w.beschreibung || '')}</p>
                    <div class="werkzeug-meta">
                        <span>📦 ${escapeHtml(w.inventarnummer)}</span>
                        ${w.kategorie ? `<span>🏷️ ${escapeHtml(w.kategorie)}</span>` : ''}
                        ${w.lagerplatz ? `<span>📍 ${escapeHtml(w.lagerplatz)}</span>` : ''}
                    </div>
                    ${statusBadge}
                    <div style="margin-top:8px;">${getWartungsStatusBadge(w)}</div>
                </div>
                <button class="btn-secondary" onclick="showWerkzeugDetail(${w.id})">ℹ️ Details</button>
                <button class="btn-primary" onclick="addToWarenkorb(${w.id})" ${!isVerfuegbar ? 'disabled' : ''}>
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

function updateKategorieFilter(werkzeuge) {
    const select = document.getElementById('kategorieFilter');
    if (!select) return;

    const aktuelleAuswahl = select.value;
    const kategorien = Array.from(new Set(
        (werkzeuge || []).map(w => (w.kategorie || '').trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'de'));

    select.innerHTML = '<option value="">Alle Kategorien</option>';
    kategorien.forEach(kategorie => {
        const option = document.createElement('option');
        option.value = kategorie;
        option.textContent = kategorie;
        if (kategorie === aktuelleAuswahl) option.selected = true;
        select.appendChild(option);
    });
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

    return badges[status] || escapeHtml(status);
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
            html += `<li>${escapeHtml(w.icon || '🔧')} ${escapeHtml(w.name)} (${escapeHtml(w.inventarnummer)})
                     <button class="btn-danger btn-small" onclick="removeFromWarenkorb(${w.id})">❌</button></li>`;
        });
        html += '</ul>';

        html += `
            <div class="info" style="text-align:left; margin-top:16px;">
                Reservierungen werden jetzt gegen bestehende Zeiträume geprüft. Nutze unten die Daten und prüfe bei Bedarf die Kalenderansicht im Admin-Bereich.
            </div>
            <div class="form-group">
                <label>Ihr Name *</label>
                <input type="text" id="reservierungName" placeholder="Max Mustermann" value="${escapeHtml(gespeicherterMitarbeiterName)}">
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

        const today = toIsoDate(new Date());
        const vonInput = document.getElementById('reservierungVon');
        const bisInput = document.getElementById('reservierungBis');
        if (vonInput) vonInput.min = today;
        if (bisInput) bisInput.min = today;
    } catch (err) {
        alert('Fehler beim Laden: ' + err.message);
    }
}

function removeFromWarenkorb(werkzeugId) {
    warenkorb = warenkorb.filter(id => id !== werkzeugId);
    updateWarenkorbBadge();
    showWarenkorb();
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
        if (currentMode === 'admin') {
            loadKalender();
        }
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
                beschreibung,
                foto
            })
        });

        showToast('✓ Schaden gemeldet!');
        closeModal('schadenModal');
        loadWerkzeuge();
        if (currentMode === 'admin') loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== Admin Dashboard ====================

function renderFaelligeWartungen(items) {
    const list = document.getElementById('faelligeWartungenList');
    if (!list) return;

    list.innerHTML = '';

    if (!items || !items.length) {
        list.innerHTML = '<li>Keine fälligen Wartungen in den nächsten 7 Tagen.</li>';
        return;
    }

    items.forEach(item => {
        const li = document.createElement('li');
        const statusText = item.wartungsstatus === 'ueberfaellig'
            ? 'überfällig'
            : item.wartungsstatus === 'faellig'
                ? 'heute fällig'
                : `fällig am ${formatDate(item.naechste_wartung_am)}`;

        li.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
                <div>
                    <strong>${escapeHtml(item.icon || '🔧')} ${escapeHtml(item.name)}</strong>
                    <div style="font-size:0.9em;color:#6b7280;">${escapeHtml(item.inventarnummer || '-')} · ${escapeHtml(statusText)}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-success btn-small" onclick="showWartungDurchfuehren(${item.id}, '${escapeForSingleQuotedJs(item.name)}')">✓ Wartung erledigt</button>
                    <button class="btn-secondary btn-small" onclick="showWartungsverlauf(${item.id}, '${escapeForSingleQuotedJs(item.name)}')">📜 Verlauf</button>
                </div>
            </div>
        `;
        list.appendChild(li);
    });
}

async function loadDashboard() {
    try {
        const [stats, werkzeuge, wartungen] = await Promise.all([
            apiCall('/stats'),
            apiCall('/werkzeuge'),
            apiCall('/wartungen')
        ]);

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
        setStat('statWartungIntervall', stats.wartungen?.mit_intervall);
        setStat('statWartungFaellig', stats.wartungen?.ueberfaellig);
        setStat('statWartungHeute', stats.wartungen?.heute);
        setStat('statWartung7Tage', stats.wartungen?.naechste_7_tage);

        const topList = document.getElementById('topWerkzeugeList');
        if (topList) {
            topList.innerHTML = '';
            (stats.top_werkzeuge || []).forEach((w, i) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${i + 1}. ${escapeHtml(w.icon || '🔧')} ${escapeHtml(w.name)}</span> <span class="badge">${escapeHtml(w.anzahl_ausleihen)}x</span>`;
                topList.appendChild(li);
            });
        }

        renderFaelligeWartungen(stats.faellige_wartungen || []);

        kalenderKategorien = Array.from(new Set(
            (werkzeuge || []).map(w => (w.kategorie || '').trim()).filter(Boolean)
        )).sort((a, b) => a.localeCompare(b, 'de'));
        renderKalenderKategorieFilter();

        loadAdminWerkzeuge(werkzeuge);
        loadAusleihen();
        loadSchaeden();
        loadKalender();
        loadWartungen(wartungen);
    } catch (err) {
        console.error('Fehler beim Laden der Stats:', err);
    }
}

// ==================== Admin Werkzeuge ====================

async function loadAdminWerkzeuge(werkzeugeOverride = null) {
    try {
        const werkzeuge = werkzeugeOverride || await apiCall('/werkzeuge');

        const table = document.getElementById('adminWerkzeugeTable');
        if (!table) return;

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Icon</th>
                    <th>Name</th>
                    <th>Inventarnummer</th>
                    <th>Kategorie</th>
                    <th>Lagerplatz</th>
                    <th>Status</th>
                    <th>Wartung</th>
                    <th>Aktionen</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        werkzeuge.forEach(w => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(w.icon || '🔧')}</td>
                <td>${escapeHtml(w.name)}</td>
                <td>${escapeHtml(w.inventarnummer)}</td>
                <td>${escapeHtml(w.kategorie || '-')}</td>
                <td>${escapeHtml(w.lagerplatz || '-')}</td>
                <td>${getStatusBadge(w.status)}</td>
                <td>
                    ${getWartungsStatusBadge(w)}
                    ${w.wartungsintervall_tage ? `<div style="font-size:0.8em;margin-top:6px;color:#6b7280;">${escapeHtml(w.wartungsintervall_tage)} Tage · zuletzt ${escapeHtml(formatDate(w.letzte_wartung_am))}</div>` : ''}
                </td>
                <td>
                    <button class="btn-primary btn-small" onclick="showQRCode(${w.id}, '${escapeForSingleQuotedJs(w.name)}', '${escapeForSingleQuotedJs(w.inventarnummer)}')">QR</button>
                    <button class="btn-success btn-small" onclick="showWartungDurchfuehren(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">🛠️</button>
                    <button class="btn-secondary btn-small" onclick="showWartungsverlauf(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">📜</button>
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
    document.getElementById('werkzeugWartungsintervall').value = '';
    document.getElementById('werkzeugLetzteWartung').value = '';
    document.getElementById('werkzeugWartungNotiz').value = '';
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
        document.getElementById('werkzeugWartungsintervall').value = werkzeug.wartungsintervall_tage || '';
        document.getElementById('werkzeugLetzteWartung').value = werkzeug.letzte_wartung_am || '';
        document.getElementById('werkzeugWartungNotiz').value = werkzeug.wartung_notiz || '';

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
        lagerplatz: document.getElementById('werkzeugLagerplatz').value,
        wartungsintervall_tage: document.getElementById('werkzeugWartungsintervall').value,
        letzte_wartung_am: document.getElementById('werkzeugLetzteWartung').value,
        wartung_notiz: document.getElementById('werkzeugWartungNotiz').value
    };

    const fotoInput = document.getElementById('werkzeugFoto');
    if (fotoInput.files && fotoInput.files[0]) {
        data.foto = await fileToBase64(fotoInput.files[0]);
    }

    try {
        if (id) {
            await apiCall(`/werkzeuge/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('✓ Werkzeug aktualisiert!');
        } else {
            await apiCall('/werkzeuge', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('✓ Werkzeug hinzugefügt!');
        }

        closeModal('werkzeugModal');
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
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== Wartungen ====================

function loadWartungen(wartungen) {
    const table = document.getElementById('wartungenTable');
    if (!table) return;

    table.innerHTML = `
        <thead>
            <tr>
                <th>Werkzeug</th>
                <th>Intervall</th>
                <th>Letzte Wartung</th>
                <th>Nächste Wartung</th>
                <th>Status</th>
                <th>Aktionen</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    (wartungen || []).forEach(w => {
        const row = document.createElement('tr');
        if (w.wartungsstatus === 'ueberfaellig') row.classList.add('overdue');
        row.innerHTML = `
            <td>
                <strong>${escapeHtml(w.icon || '🔧')} ${escapeHtml(w.name)}</strong>
                <div style="font-size:0.85em;color:#6b7280;">${escapeHtml(w.inventarnummer || '-')}</div>
            </td>
            <td>${w.wartungsintervall_tage ? `${escapeHtml(w.wartungsintervall_tage)} Tage` : '-'}</td>
            <td>${escapeHtml(formatDate(w.letzte_wartung_am))}</td>
            <td>${escapeHtml(formatDate(w.naechste_wartung_am))}</td>
            <td>
                ${getWartungsStatusBadge(w)}
                ${w.wartung_notiz ? `<div style="font-size:0.8em;margin-top:6px;color:#6b7280;">${escapeHtml(w.wartung_notiz)}</div>` : ''}
            </td>
            <td>
                <button class="btn-success btn-small" onclick="showWartungDurchfuehren(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">✓ Erledigt</button>
                <button class="btn-secondary btn-small" onclick="showWartungsverlauf(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">📜 Verlauf</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (!(wartungen || []).length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7280;">Noch keine Werkzeuge mit Wartungsintervall vorhanden.</td></tr>';
    }
}

function showWartungDurchfuehren(id, name) {
    document.getElementById('wartungWerkzeugId').value = id;
    document.getElementById('wartungWerkzeugName').textContent = name;
    document.getElementById('wartungDurchgefuehrtAm').value = toIsoDate(new Date());
    document.getElementById('wartungNotiz').value = '';
    document.getElementById('wartungModal').classList.add('active');
}

async function submitWartung(event) {
    event.preventDefault();

    const werkzeugId = document.getElementById('wartungWerkzeugId').value;
    const durchgefuehrtAm = document.getElementById('wartungDurchgefuehrtAm').value;
    const notiz = document.getElementById('wartungNotiz').value;

    try {
        await apiCall(`/werkzeuge/${werkzeugId}/wartungen`, {
            method: 'POST',
            body: JSON.stringify({
                durchgefuehrt_am: durchgefuehrtAm,
                notiz
            })
        });

        showToast('✓ Wartung dokumentiert!');
        closeModal('wartungModal');
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function showWartungsverlauf(id, name) {
    wartungsverlaufWerkzeugId = id;
    document.getElementById('wartungHistoryTitle').textContent = `Wartungsverlauf – ${name}`;
    const list = document.getElementById('wartungHistoryList');
    list.innerHTML = '<li>Lade…</li>';
    document.getElementById('wartungHistoryModal').classList.add('active');

    try {
        const items = await apiCall(`/werkzeuge/${id}/wartungen`);
        if (!items.length) {
            list.innerHTML = '<li>Noch keine dokumentierten Wartungen.</li>';
            return;
        }

        list.innerHTML = items.map(item => `
            <li>
                <strong>${escapeHtml(formatDate(item.durchgefuehrt_am))}</strong>
                <div style="font-size:0.9em;color:#6b7280;">Erfasst: ${escapeHtml(formatDate(item.erstellt_am))}</div>
                <div>${escapeHtml(item.notiz || 'Keine Notiz')}</div>
            </li>
        `).join('');
    } catch (err) {
        list.innerHTML = `<li>Fehler beim Laden: ${escapeHtml(err.message)}</li>`;
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
        const endpoint = status ? `/ausleihen?status=${encodeURIComponent(status)}` : '/ausleihen';
        const ausleihen = await apiCall(endpoint);

        const table = document.getElementById('ausleihenTable');
        if (!table) return;

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Werkzeug</th>
                    <th>Mitarbeiter</th>
                    <th>Zeitraum</th>
                    <th>Status</th>
                    <th>Aktionen</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        ausleihen.forEach(a => {
            const row = document.createElement('tr');

            const isUeberfaellig = a.status === 'ausgeliehen' && a.datum_bis && new Date(a.datum_bis) < new Date();
            const ueberfaelligBadge = isUeberfaellig ? '<span class="badge badge-overdue">⚠️ Überfällig</span>' : '';
            if (isUeberfaellig) row.classList.add('overdue');

            row.innerHTML = `
                <td>${escapeHtml(a.werkzeug_name)} (${escapeHtml(a.inventarnummer)})</td>
                <td>${escapeHtml(a.mitarbeiter_name || '-')}</td>
                <td>${escapeHtml(formatDate(a.datum_von))} - ${escapeHtml(formatDate(a.datum_bis))}</td>
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
    return badges[status] || escapeHtml(status);
}

async function ausgebenAusleihe(id) {
    if (!confirm('Ausleihe ausgeben?')) return;

    try {
        await apiCall(`/ausleihen/${id}/ausgeben`, {
            method: 'PATCH'
        });
        showToast('✓ Ausleihe ausgegeben!');
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
        loadDashboard();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// ==================== Buchungskalender ====================

function renderKalenderKategorieFilter() {
    const select = document.getElementById('kalenderKategorieFilter');
    if (!select) return;

    select.innerHTML = '<option value="">Alle Kategorien</option>';
    kalenderKategorien.forEach(kategorie => {
        const option = document.createElement('option');
        option.value = kategorie;
        option.textContent = kategorie;
        if (kategorie === kalenderState.kategorie) option.selected = true;
        select.appendChild(option);
    });
}

function shiftKalender(days) {
    kalenderState.startDate = addDaysToIso(kalenderState.startDate, days);
    const input = document.getElementById('kalenderStart');
    if (input) input.value = kalenderState.startDate;
    loadKalender();
}

function resetKalenderHeute() {
    kalenderState.startDate = toIsoDate(new Date());
    const input = document.getElementById('kalenderStart');
    if (input) input.value = kalenderState.startDate;
    loadKalender();
}

async function loadKalender() {
    const startInput = document.getElementById('kalenderStart');
    const categoryInput = document.getElementById('kalenderKategorieFilter');
    const container = document.getElementById('kalenderContainer');
    const summary = document.getElementById('kalenderSummary');

    if (!container || !summary) return;

    kalenderState.startDate = startInput?.value || kalenderState.startDate || toIsoDate(new Date());
    kalenderState.kategorie = categoryInput?.value || '';

    container.innerHTML = '<div class="loading">Kalender wird geladen…</div>';
    summary.textContent = 'Lade 4-Wochen-Ansicht…';

    try {
        const params = new URLSearchParams({
            from: kalenderState.startDate,
            days: String(kalenderState.days)
        });

        if (kalenderState.kategorie) {
            params.set('kategorie', kalenderState.kategorie);
        }

        const data = await apiCall(`/ausleihen/kalender?${params.toString()}`);
        renderKalender(data);
    } catch (err) {
        container.innerHTML = `<div class="error">Kalender konnte nicht geladen werden: ${escapeHtml(err.message)}</div>`;
        summary.textContent = 'Kalender nicht verfügbar';
    }
}

function renderKalender(data) {
    const container = document.getElementById('kalenderContainer');
    const summary = document.getElementById('kalenderSummary');
    if (!container || !summary) return;

    const tools = data.tools || [];
    const headers = data.date_headers || [];
    const totalBookings = tools.reduce((sum, tool) => sum + (tool.bookings?.length || 0), 0);

    summary.textContent = `${tools.length} Werkzeuge · ${headers.length} Tage · ${totalBookings} aktive Buchung${totalBookings === 1 ? '' : 'en'}`;

    if (!tools.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p>Keine Werkzeuge für den gewählten Filter gefunden.</p></div>';
        return;
    }

    const headerCells = headers.map(dateStr => {
        const date = new Date(`${dateStr}T00:00:00`);
        const weekday = date.toLocaleDateString('de-DE', { weekday: 'short' });
        const day = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        const weekendClass = [0, 6].includes(date.getDay()) ? ' weekend' : '';
        return `<th class="kalender-date${weekendClass}"><span>${escapeHtml(weekday)}</span><small>${escapeHtml(day)}</small></th>`;
    }).join('');

    const rows = tools.map(tool => {
        const cells = headers.map(dateStr => buildCalendarCell(tool, dateStr)).join('');
        const bookingInfo = tool.bookings?.length
            ? `<div class="kalender-tool-subline">${tool.bookings.length} aktive Buchung${tool.bookings.length === 1 ? '' : 'en'}</div>`
            : '<div class="kalender-tool-subline">Keine Buchung im Zeitraum</div>';

        return `
            <tr>
                <td class="kalender-tool-cell">
                    <div class="kalender-tool-name">${escapeHtml(tool.icon || '🔧')} ${escapeHtml(tool.name)}</div>
                    <div class="kalender-tool-meta">${escapeHtml(tool.inventarnummer || '-')} ${tool.kategorie ? `· ${escapeHtml(tool.kategorie)}` : ''}</div>
                    ${bookingInfo}
                </td>
                ${cells}
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="kalender-legend">
            <span class="legend-item"><span class="legend-color frei"></span> Frei</span>
            <span class="legend-item"><span class="legend-color reserviert"></span> Reserviert</span>
            <span class="legend-item"><span class="legend-color ausgeliehen"></span> Ausgeliehen</span>
            <span class="legend-item"><span class="legend-color heute"></span> Heute</span>
        </div>
        <div class="kalender-wrapper">
            <table class="kalender-table">
                <thead>
                    <tr>
                        <th>Werkzeug / Zeitraum</th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function buildCalendarCell(tool, dateStr) {
    const todayIso = toIsoDate(new Date());
    const match = (tool.bookings || []).find(booking => booking.datum_von <= dateStr && booking.datum_bis >= dateStr);

    const classes = ['kalender-cell'];
    const tooltipParts = [`${tool.name} · ${formatDate(dateStr)}`];

    if (dateStr === todayIso) classes.push('is-today');

    if (match) {
        classes.push(match.status === 'ausgeliehen' ? 'is-ausgeliehen' : 'is-reserviert');
        const startMarker = match.datum_von === dateStr ? ' booking-start' : '';
        const endMarker = match.datum_bis === dateStr ? ' booking-end' : '';
        if (startMarker.trim()) classes.push(startMarker.trim());
        if (endMarker.trim()) classes.push(endMarker.trim());
        tooltipParts.push(`${match.status === 'ausgeliehen' ? 'Ausgeliehen' : 'Reserviert'}: ${match.mitarbeiter_name || '-'}`);
        tooltipParts.push(`${formatDate(match.datum_von)} – ${formatDate(match.datum_bis)}`);
        return `<td class="${classes.join(' ')}" title="${escapeHtml(tooltipParts.join(' | '))}"><span>${match.status === 'ausgeliehen' ? '●' : '◼'}</span></td>`;
    }

    tooltipParts.push('Frei');
    return `<td class="${classes.join(' ')} is-free" title="${escapeHtml(tooltipParts.join(' | '))}"></td>`;
}

// ==================== Schäden (Admin) ====================

async function loadSchaeden() {
    try {
        const schaeden = await apiCall('/schaeden');

        const table = document.getElementById('schaedenTable');
        if (!table) return;

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Werkzeug</th>
                    <th>Mitarbeiter</th>
                    <th>Beschreibung</th>
                    <th>Gemeldet</th>
                    <th>Status</th>
                    <th>Aktionen</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        schaeden.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(s.werkzeug_name)} (${escapeHtml(s.inventarnummer)})</td>
                <td>${escapeHtml(s.mitarbeiter_name || '-')}</td>
                <td>${escapeHtml(s.beschreibung)}</td>
                <td>${escapeHtml(formatDate(s.gemeldet_am))}</td>
                <td>${s.status === 'offen' ? '<span class="badge badge-defekt">Offen</span>' : '<span class="badge badge-available">Behoben</span>'}</td>
                <td>
                    ${s.foto ? `<button class="btn-primary btn-small" onclick="showSchadenFoto('${escapeForSingleQuotedJs(s.foto)}')">📷</button>` : ''}
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
        loadDashboard();
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
    const lines = text.split('\n').slice(1);

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
            lagerplatz: parts[5] || '',
            wartungsintervall_tage: parts[7] || '',
            letzte_wartung_am: parts[8] || '',
            wartung_notiz: parts[10] || ''
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
    loadDashboard();
}

// ==================== Helper Functions ====================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE');
}

function toIsoDate(date) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
}

function addDaysToIso(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
}

function escapeForSingleQuotedJs(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
    document.getElementById('schadenForm')?.addEventListener('submit', submitSchaden);
    document.getElementById('werkzeugForm')?.addEventListener('submit', saveWerkzeug);
    document.getElementById('rueckgabeForm')?.addEventListener('submit', submitRueckgabe);
    document.getElementById('wartungForm')?.addEventListener('submit', submitWartung);
    document.getElementById('kalenderStart')?.addEventListener('change', loadKalender);
    document.getElementById('kalenderKategorieFilter')?.addEventListener('change', loadKalender);

    const today = toIsoDate(new Date());
    document.getElementById('kalenderStart')?.setAttribute('value', kalenderState.startDate);
    document.getElementById('reservierungVon')?.setAttribute('min', today);
    document.getElementById('reservierungBis')?.setAttribute('min', today);

    initApp();

    const toolId = getInitialToolIdFromUrl();
    if (toolId) {
        showWerkzeugDetail(toolId);
    }
    console.log('ToolHub API-Version geladen');
    console.log('API URL:', window.API_URL);
});
