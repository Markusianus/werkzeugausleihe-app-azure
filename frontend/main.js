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
let selectedToolIdsForPdf = new Set();
let verfuegbarkeitsFilter = {
    von: '',
    bis: ''
};

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
            const contentType = response.headers.get('content-type') || '';
            const error = contentType.includes('application/json')
                ? await response.json()
                : { error: await response.text() };

            if (response.status === 401 && (error.code === 'TOOL_ADMIN_AUTH_REQUIRED' || /Tool-Admin-Anmeldung erforderlich/i.test(error.error || ''))) {
                isAdmin = false;
                localStorage.removeItem('adminToken');
                const detail = error.detail ? ` ${error.detail}` : '';
                throw new Error(`Tool-Admin-Anmeldung erforderlich.${detail}`.trim());
            }

            let errorMessage = [error.error, error.detail].filter(Boolean).join(' – ');
            if (response.status === 400 && Array.isArray(error.details) && error.details.length) {
                errorMessage = `${errorMessage || 'Validierung fehlgeschlagen'} – ${error.details.join('; ')}`;
            }
            throw new Error(errorMessage || `HTTP ${response.status}`);
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

async function showAdminLogin(options = {}) {
    const {
        stayInCurrentMode = false,
        reason = 'Für diesen Bereich ist eine Anmeldung als Tool-Admin erforderlich.'
    } = options;

    const password = prompt(`${reason}\n\nBitte Tool-Admin-Passwort eingeben:`);
    if (!password) {
        if (!stayInCurrentMode) {
            switchMode('mitarbeiter');
        }
        return false;
    }

    try {
        const response = await apiCall('/admin/auth', {
            method: 'POST',
            body: JSON.stringify({ password })
        });

        if (response.success) {
            isAdmin = true;
            localStorage.setItem('adminToken', response.token);
            if (!stayInCurrentMode) {
                switchMode('admin');
            }
            return true;
        }

        alert('Die Tool-Admin-Anmeldung ist fehlgeschlagen. Bitte Passwort prüfen und erneut versuchen.');
        if (!stayInCurrentMode) {
            switchMode('mitarbeiter');
        }
        return false;
    } catch (err) {
        alert('Tool-Admin-Anmeldung fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
        if (!stayInCurrentMode) {
            switchMode('mitarbeiter');
        }
        return false;
    }
}

async function ensureToolAdminAccess(options = {}) {
    const {
        interactive = true,
        reason = 'Für diese Aktion ist eine Anmeldung als Tool-Admin erforderlich.'
    } = options;

    const adminToken = localStorage.getItem('adminToken');
    if (adminToken) {
        try {
            const response = await apiCall('/admin/verify');
            if (response.valid) {
                isAdmin = true;
                return true;
            }
        } catch (err) {
            console.warn('Tool-Admin-Token konnte nicht verifiziert werden:', err);
        }
    }

    isAdmin = false;
    localStorage.removeItem('adminToken');

    if (!interactive) {
        return false;
    }

    return showAdminLogin({ stayInCurrentMode: true, reason });
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

function getInventorySummaryHtml(w, { compact = false } = {}) {
    const gesamt = Number(w.bestand_gesamt || 1);
    const verfuegbar = Number(w.verfuegbare_einheiten ?? (w.status === 'verfuegbar' ? 1 : 0));
    const reserviert = Number(w.aktiv_reserviert || 0);
    const ausgeliehen = Number(w.aktiv_ausgeliehen || 0);
    const defekt = Number(w.bestand_defekt || 0);
    const inWartung = Number(w.bestand_in_wartung || 0);

    if (!w.hat_mehrfachbestand && !defekt && !inWartung && !reserviert && !ausgeliehen) {
        return compact ? '<div style="font-size:0.85em;color:#6b7280;">1 Einheit im Bestand</div>' : '<div class="info" style="margin-bottom:16px;text-align:left;"><strong>Bestand:</strong> 1 Einheit im Bestand</div>';
    }

    const parts = [
        `${verfuegbar} verfügbar`,
        `${gesamt} gesamt`
    ];

    if (reserviert) parts.push(`${reserviert} reserviert`);
    if (ausgeliehen) parts.push(`${ausgeliehen} ausgeliehen`);
    if (defekt) parts.push(`${defekt} defekt`);
    if (inWartung) parts.push(`${inWartung} in Wartung`);

    return compact
        ? `<span>📦 ${escapeHtml(parts.join(' · '))}</span>`
        : `<div class="info" style="margin-bottom:16px;text-align:left;"><strong>Bestand:</strong> ${escapeHtml(parts.join(' · '))}</div>`;
}

function buildWerkzeugDetailHtml(w) {
    const isVerfuegbar = Number(w.verfuegbare_einheiten ?? 0) > 0;
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
        <div style="margin-bottom:12px;">${getStatusBadge(w.status_abgeleitet || w.status)}</div>
        <div style="margin-bottom:12px;">${getInventorySummaryHtml(w)}</div>
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
        const params = new URLSearchParams();
        if (filter.kategorie) params.set('kategorie', filter.kategorie);
        if (filter.search) params.set('search', filter.search);
        if (filter.von) params.set('verfuegbar_von', filter.von);
        if (filter.bis) params.set('verfuegbar_bis', filter.bis);

        const endpoint = `/werkzeuge?${params.toString()}`;
        const werkzeuge = await apiCall(endpoint);
        const container = document.getElementById('werkzeugeList');
        container.innerHTML = '';

        updateKategorieFilter(werkzeuge);
        updateVerfuegbarkeitsHinweis(filter, werkzeuge.length);

        if (werkzeuge.length === 0) {
            container.innerHTML = '<p style="text-align:center;padding:40px;">Keine Werkzeuge gefunden</p>';
            return;
        }

        werkzeuge.forEach(w => {
            const card = document.createElement('div');
            card.className = 'werkzeug-card';

            const isVerfuegbar = Number(w.verfuegbare_einheiten ?? 0) > 0;
            const statusBadge = getStatusBadge(w.status_abgeleitet || w.status);
            const maintenanceBadge = getWartungsStatusBadge(w);
            const isZeitraumGefiltert = Boolean(filter.von && filter.bis);
            const verfuegbarkeitsBadge = isZeitraumGefiltert
                ? '<span class="status-badge status-verfuegbar">🗓️ Zeitraum passt</span>'
                : '';
            const visual = w.foto
                ? `<div class="werkzeug-card-visual"><img src="${escapeHtml(w.foto)}" alt="${escapeHtml(w.name)}"></div>`
                : `<div class="werkzeug-card-visual">${escapeHtml(w.icon || '🔧')}</div>`;
            const metaLine = [
                w.inventarnummer ? `📦 ${escapeHtml(w.inventarnummer)}` : null,
                w.kategorie ? `🏷️ ${escapeHtml(w.kategorie)}` : null,
                w.lagerplatz ? `📍 ${escapeHtml(w.lagerplatz)}` : null
            ].filter(Boolean).join('<span>·</span>');

            card.innerHTML = `
                ${visual}
                <div class="werkzeug-card-main">
                    <div class="werkzeug-card-header">
                        <div class="werkzeug-card-title">
                            <h3>${escapeHtml(w.name)}</h3>
                            <div class="werkzeug-card-subline">${metaLine || '-'}</div>
                        </div>
                    </div>
                    ${w.beschreibung ? `<div class="werkzeug-card-description">${escapeHtml(w.beschreibung)}</div>` : ''}
                    <div class="werkzeug-inline-stock">${getInventorySummaryHtml(w, { compact: true })}</div>
                </div>
                <div class="werkzeug-card-side">
                    <div>${statusBadge}</div>
                    ${verfuegbarkeitsBadge ? `<div>${verfuegbarkeitsBadge}</div>` : ''}
                    <div class="werkzeug-inline-maintenance">${maintenanceBadge}</div>
                </div>
                <div class="werkzeug-card-actions">
                    <button class="btn-primary" onclick="addToWarenkorb(${w.id})" ${!isVerfuegbar ? 'disabled' : ''}>
                        ${isVerfuegbar ? '＋ Warenkorb' : 'Nicht verfügbar'}
                    </button>
                    <button class="btn-secondary btn-small" onclick="showWerkzeugDetail(${w.id})">Details</button>
                    <button class="btn-warning btn-small" onclick="showSchadenMelden(${w.id})">Schaden</button>
                </div>
            `;

            container.appendChild(card);
        });

        attachFotoZoomListeners(container);
    } catch (err) {
        const message = err?.message || 'Fehler beim Laden der Werkzeuge';
        updateVerfuegbarkeitsHinweis(filter, 0, message);
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

function updateVerfuegbarkeitsHinweis(filter = {}, count = 0, errorMessage = '') {
    const hint = document.getElementById('verfuegbarkeitsHinweis');
    if (!hint) return;

    if (errorMessage) {
        hint.textContent = `⚠️ ${errorMessage}`;
        hint.style.color = '#b91c1c';
        return;
    }

    if (filter.von && filter.bis) {
        hint.textContent = `${count} Werkzeug${count === 1 ? '' : 'e'} sind vom ${formatDate(filter.von)} bis ${formatDate(filter.bis)} vollständig verfügbar.`;
        hint.style.color = '#065f46';
        return;
    }

    hint.textContent = 'Optional Zeitraum wählen, um nur im gesamten Einsatzfenster verfügbare Werkzeuge zu sehen.';
    hint.style.color = '#6b7280';
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
            <div class="form-group">
                <label>E-Mail für Bestätigungen (optional)</label>
                <input type="email" id="reservierungEmail" placeholder="max.mustermann@firma.de">
            </div>
            <div class="form-group">
                <label>Projektnummer *</label>
                <input type="text" id="reservierungProjektnummer" placeholder="T-12345" pattern="T-[0-9]{5}" title="Format: T-12345">
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
    const email = document.getElementById('reservierungEmail').value;
    const projektnummerInput = document.getElementById('reservierungProjektnummer');
    const projektnummer = (projektnummerInput?.value || '').trim().toUpperCase();
    const von = document.getElementById('reservierungVon').value;
    const bis = document.getElementById('reservierungBis').value;

    if (!name || !projektnummer || !von || !bis) {
        alert('Bitte alle Pflichtfelder ausfüllen!');
        return;
    }

    if (!/^T-\d{5}$/.test(projektnummer)) {
        alert('Die Projektnummer muss dem Format T-12345 entsprechen!');
        projektnummerInput?.focus();
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
                mitarbeiter_email: email,
                projektnummer,
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
        if (currentMode === 'admin' && kalenderLoaded) {
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
            ? '<p style="margin-top:8px;font-size:0.9em;color:rgba(255,255,255,0.88);">Noch nicht ausgegeben</p>'
            : (isUeberfaellig
                ? '<p style="margin-top:8px;font-size:0.9em;color:#fee2e2;font-weight:600;">⚠️ Rückgabe überfällig</p>'
                : '<p style="margin-top:8px;font-size:0.9em;color:rgba(255,255,255,0.88);">Aktuell ausgeliehen</p>');

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                    <div style="font-size:1.6em; margin-bottom:8px;">${escapeHtml(a.icon || '🔧')}</div>
                    <h3 style="font-size:1.2em; margin-bottom:6px; color:#ffffff; line-height:1.3;">${escapeHtml(a.werkzeug_name)}</h3>
                    <p style="font-size:0.9em; color:rgba(255,255,255,0.78); margin:0;">${escapeHtml(a.inventarnummer || '-')}</p>
                </div>
                <div>${getAusleiheStatusBadge(a.status)}</div>
            </div>
            <div style="margin-top:14px; font-size:0.95em; line-height:1.5; color:#f3f4f6;">
                <div><strong style="color:#ffffff;">Zeitraum:</strong> ${escapeHtml(dateRange)}</div>
                ${a.reserviert_am ? `<div><strong style="color:#ffffff;">Reserviert am:</strong> ${escapeHtml(formatDate(a.reserviert_am))}</div>` : ''}
                ${a.ausgeliehen_am ? `<div><strong style="color:#ffffff;">Ausgegeben am:</strong> ${escapeHtml(formatDate(a.ausgeliehen_am))}</div>` : ''}
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
        // Kalender startet eingeklappt – wird erst bei Öffnen geladen (toggleKalender)
        loadWartungen(wartungen);
    } catch (err) {
        console.error('Fehler beim Laden der Stats:', err);
    }
}

// ==================== Admin Werkzeuge ====================

function updateToolSelectionSummary(totalTools = null) {
    const summary = document.getElementById('toolSelectionSummary');
    if (!summary) return;

    const selectedCount = selectedToolIdsForPdf.size;
    if (totalTools && selectedCount === totalTools) {
        summary.textContent = `${selectedCount} von ${totalTools} Werkzeugen für PDF-Etiketten ausgewählt`;
        return;
    }

    if (selectedCount === 0) {
        summary.textContent = '0 Werkzeuge für PDF-Etiketten ausgewählt';
        return;
    }

    summary.textContent = totalTools
        ? `${selectedCount} von ${totalTools} Werkzeugen für PDF-Etiketten ausgewählt`
        : `${selectedCount} Werkzeuge für PDF-Etiketten ausgewählt`;
}

function toggleToolSelectionForPdf(toolId, checked) {
    const normalizedId = Number(toolId);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) return;

    if (checked) {
        selectedToolIdsForPdf.add(normalizedId);
    } else {
        selectedToolIdsForPdf.delete(normalizedId);
    }

    const table = document.getElementById('adminWerkzeugeTable');
    const checkboxes = table ? Array.from(table.querySelectorAll('tbody input[data-tool-select="true"]')) : [];
    const allSelected = checkboxes.length > 0 && checkboxes.every(input => input.checked);
    const selectAll = document.getElementById('selectAllToolsCheckbox');
    if (selectAll) selectAll.checked = allSelected;

    updateToolSelectionSummary(checkboxes.length || null);
}

function toggleAllVisibleToolsSelection(checked) {
    const table = document.getElementById('adminWerkzeugeTable');
    if (!table) return;

    const checkboxes = Array.from(table.querySelectorAll('tbody input[data-tool-select="true"]'));
    checkboxes.forEach(input => {
        input.checked = checked;
        const toolId = Number(input.value);
        if (checked) {
            selectedToolIdsForPdf.add(toolId);
        } else {
            selectedToolIdsForPdf.delete(toolId);
        }
    });

    const selectAll = document.getElementById('selectAllToolsCheckbox');
    if (selectAll) selectAll.checked = checked && checkboxes.length > 0;
    updateToolSelectionSummary(checkboxes.length || null);
}

function selectAllToolsForPdf(checked) {
    toggleAllVisibleToolsSelection(checked);
}

async function exportSelectedToolLabelsPdf() {
    try {
        const ids = Array.from(selectedToolIdsForPdf);
        const query = ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
        const response = await fetch(buildApiUrl(`/export/werkzeuge/pdf-labels${query}`), {
            headers: {
                ...(localStorage.getItem('adminToken') ? { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } : {})
            }
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const error = await response.json();
                message = error.error || message;
            } catch (_) {
                // ignore json parse issues for binary responses
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ids.length ? `qr-etiketten-${ids.length}-werkzeuge.pdf` : 'qr-etiketten-alle-werkzeuge.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast(`✓ PDF-Etiketten exportiert${ids.length ? ` (${ids.length})` : ''}`);
    } catch (err) {
        alert('Fehler beim PDF-Export: ' + err.message);
    }
}

async function loadAdminWerkzeuge(werkzeugeOverride = null) {
    try {
        const werkzeuge = werkzeugeOverride || await apiCall('/werkzeuge');

        const table = document.getElementById('adminWerkzeugeTable');
        if (!table) return;

        const visibleIds = new Set((werkzeuge || []).map(w => Number(w.id)).filter(id => Number.isInteger(id) && id > 0));
        selectedToolIdsForPdf = new Set(Array.from(selectedToolIdsForPdf).filter(id => visibleIds.has(id)));

        table.innerHTML = `
            <thead>
                <tr>
                    <th class="checkbox-cell"><input type="checkbox" id="selectAllToolsCheckbox" onchange="toggleAllVisibleToolsSelection(this.checked)"></th>
                    <th>Bild</th>
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
            const checked = selectedToolIdsForPdf.has(Number(w.id)) ? 'checked' : '';
            row.innerHTML = `
                <td class="checkbox-cell"><input type="checkbox" data-tool-select="true" value="${Number(w.id)}" ${checked} onchange="toggleToolSelectionForPdf(${Number(w.id)}, this.checked)"></td>
                <td>${w.foto ? `<img src="${escapeHtml(w.foto)}" alt="${escapeHtml(w.name)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block;cursor:zoom-in;" onclick="showFotoZoom('${escapeForSingleQuotedJs(w.foto)}','${escapeForSingleQuotedJs(w.name)}')">` : escapeHtml(w.icon || '🔧')}</td>
                <td>${escapeHtml(w.name)}</td>
                <td>${escapeHtml(w.inventarnummer)}</td>
                <td>${escapeHtml(w.kategorie || '-')}</td>
                <td>${escapeHtml(w.lagerplatz || '-')}</td>
                <td>
                    ${getStatusBadge(w.status_abgeleitet || w.status)}
                    <div style="font-size:0.8em;margin-top:6px;color:#6b7280;">${escapeHtml(`${Number(w.verfuegbare_einheiten ?? 0)} von ${Number(w.bestand_gesamt || 1)} verfügbar`)}</div>
                    ${(Number(w.bestand_defekt || 0) || Number(w.bestand_in_wartung || 0)) ? `<div style="font-size:0.78em;margin-top:4px;color:#6b7280;">${escapeHtml(`${Number(w.bestand_defekt || 0)} defekt · ${Number(w.bestand_in_wartung || 0)} in Wartung`)}</div>` : ''}
                </td>
                <td>
                    ${getWartungsStatusBadge(w)}
                    ${w.wartungsintervall_tage ? `<div style="font-size:0.8em;margin-top:6px;color:#6b7280;">${escapeHtml(w.wartungsintervall_tage)} Tage · zuletzt ${escapeHtml(formatDate(w.letzte_wartung_am))}</div>` : ''}
                </td>
                <td>
                    <button class="btn-primary btn-small" onclick="showQRCode(${w.id}, '${escapeForSingleQuotedJs(w.name)}', '${escapeForSingleQuotedJs(w.inventarnummer)}')">QR</button>
                    <button class="btn-secondary btn-small" onclick="exportSingleToolLabelPdf(${w.id})">PDF</button>
                    <button class="btn-success btn-small" onclick="showWartungDurchfuehren(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">🛠️</button>
                    <button class="btn-secondary btn-small" onclick="showWartungsverlauf(${w.id}, '${escapeForSingleQuotedJs(w.name)}')">📜</button>
                    <button class="btn-warning btn-small" onclick="editWerkzeug(${w.id})">✏️</button>
                    <button class="btn-danger btn-small" onclick="deleteWerkzeug(${w.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        const selectAll = document.getElementById('selectAllToolsCheckbox');
        if (selectAll) {
            selectAll.checked = werkzeuge.length > 0 && werkzeuge.every(w => selectedToolIdsForPdf.has(Number(w.id)));
        }
        updateToolSelectionSummary(werkzeuge.length);
    } catch (err) {
        console.error('Fehler beim Laden:', err);
    }
}

function filterAdminWerkzeuge() {
    const query = (document.getElementById('adminWerkzeugSuche')?.value || '').toLowerCase().trim();
    const table = document.getElementById('adminWerkzeugeTable');
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = (!query || text.includes(query)) ? '' : 'none';
    });
}

function showAddWerkzeug() {
    document.getElementById('werkzeugForm').reset();
    document.getElementById('werkzeugId').value = '';
    document.getElementById('werkzeugFotoPreview').innerHTML = '';
    document.getElementById('werkzeugModalTitle').textContent = 'Neues Werkzeug hinzufügen';
    document.getElementById('werkzeugWartungsintervall').value = '';
    document.getElementById('werkzeugLetzteWartung').value = '';
    document.getElementById('werkzeugWartungNotiz').value = '';
    document.getElementById('werkzeugBestandGesamt').value = '1';
    document.getElementById('werkzeugBestandDefekt').value = '0';
    document.getElementById('werkzeugBestandInWartung').value = '0';
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
        document.getElementById('werkzeugBestandGesamt').value = werkzeug.bestand_gesamt || 1;
        document.getElementById('werkzeugBestandDefekt').value = werkzeug.bestand_defekt || 0;
        document.getElementById('werkzeugBestandInWartung').value = werkzeug.bestand_in_wartung || 0;

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
        wartung_notiz: document.getElementById('werkzeugWartungNotiz').value,
        bestand_gesamt: document.getElementById('werkzeugBestandGesamt').value,
        bestand_defekt: document.getElementById('werkzeugBestandDefekt').value,
        bestand_in_wartung: document.getElementById('werkzeugBestandInWartung').value
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

function exportSingleToolLabelPdf(toolId) {
    selectedToolIdsForPdf = new Set([Number(toolId)]);
    const table = document.getElementById('adminWerkzeugeTable');
    if (table) {
        table.querySelectorAll('tbody input[data-tool-select="true"]').forEach(input => {
            input.checked = Number(input.value) === Number(toolId);
        });
    }
    updateToolSelectionSummary(1);
    exportSelectedToolLabelsPdf();
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
                    <th>Projektnummer</th>
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
                <td>${escapeHtml(a.projektnummer || '-')}</td>
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

let kalenderLoaded = false;

function toggleSection(bodyId, iconId) {
    const body = document.getElementById(bodyId);
    const icon = document.getElementById(iconId);
    const header = body ? body.previousElementSibling : null;

    if (!body) return;

    const isCollapsed = body.classList.contains('section-collapsed');
    if (isCollapsed) {
        body.classList.remove('section-collapsed');
        if (icon) icon.classList.add('open');
        if (header) header.setAttribute('aria-expanded', 'true');
    } else {
        body.classList.add('section-collapsed');
        if (icon) icon.classList.remove('open');
        if (header) header.setAttribute('aria-expanded', 'false');
    }
}

function toggleKalender() {
    const body = document.getElementById('kalenderBody');
    const icon = document.getElementById('kalenderToggleIcon');
    const header = document.querySelector('.kalender-header-toggle');
    const summary = document.getElementById('kalenderSummary');

    if (!body) return;

    const isCollapsed = body.classList.contains('kalender-body-collapsed');

    if (isCollapsed) {
        body.classList.remove('kalender-body-collapsed');
        if (icon) icon.classList.add('open');
        if (header) header.setAttribute('aria-expanded', 'true');
        // Lazy-load on first open
        if (!kalenderLoaded) {
            kalenderLoaded = true;
            loadKalender();
        }
    } else {
        body.classList.add('kalender-body-collapsed');
        if (icon) icon.classList.remove('open');
        if (header) header.setAttribute('aria-expanded', 'false');
        if (summary) summary.textContent = 'Klicken zum Öffnen';
    }
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

// ==================== CSV / Excel Import/Export ====================

const IMPORT_HEADERS = [
    'Werkzeug',
    'Beschreibung',
    'Zustand',
    'Inventarnummer',
    'Kategorie',
    'Lagerplatz',
    'Status',
    'WartungsintervallTage',
    'LetzteWartung',
    'NaechsteWartung',
    'Wartungsnotiz'
];

const REQUIRED_IMPORT_HEADERS = [
    'Werkzeug',
    'Inventarnummer',
    'Lagerplatz'
];

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

async function showImportCSV() {
    clearImportFeedback();

    const hasAccess = await ensureToolAdminAccess({
        reason: 'Der Dateiimport ist nur im angemeldeten Tool-Admin-Bereich verfügbar.'
    });

    if (!hasAccess) {
        showImportFeedback({
            type: 'error',
            title: 'Tool-Admin-Anmeldung fehlt',
            summary: 'Der Importbereich wurde nicht geöffnet, weil keine gültige Tool-Admin-Anmeldung vorliegt.',
            details: 'Bitte zuerst als Tool-Admin anmelden und danach den Import erneut öffnen.'
        });
        document.getElementById('importModal').classList.add('active');
        return;
    }

    document.getElementById('importModal').classList.add('active');
}

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

function normalizeImportCell(value) {
    return String(value ?? '').trim();
}

function validateImportHeaders(headerRow) {
    const normalizedHeaders = IMPORT_HEADERS.map((_, index) => normalizeImportCell(headerRow[index]));
    const invalidHeaders = [];

    IMPORT_HEADERS.forEach((expectedHeader, index) => {
        if (normalizedHeaders[index] !== expectedHeader) {
            invalidHeaders.push(`Spalte ${index + 1}: erwartet „${expectedHeader}“, gefunden „${normalizedHeaders[index] || 'leer'}“`);
        }
    });

    return {
        valid: invalidHeaders.length === 0,
        errors: invalidHeaders
    };
}

const IMPORT_ALLOWED_STATUSES = ['verfuegbar', 'reserviert', 'ausgeliehen', 'defekt', 'reinigung', 'reparatur'];

function validateImportRow(data, rowNumber) {
    const errors = [];

    const addFieldError = (fieldLabel, value, problem, expected) => {
        const shownValue = String(value ?? '').trim() || 'leer';
        errors.push(`Zeile ${rowNumber} | ${fieldLabel}: gefunden „${shownValue}" → ${problem}. Erwartet: ${expected}`);
    };

    if (!data.name) addFieldError('Werkzeug', data.name, 'Pflichtfeld fehlt', 'einen Namen, z. B. „Akkuschrauber“');
    if (!data.inventarnummer) addFieldError('Inventarnummer', data.inventarnummer, 'Pflichtfeld fehlt', 'eine eindeutige Inventarnummer, z. B. „INV-1001“');

    if (data.status && !IMPORT_ALLOWED_STATUSES.includes(data.status.toLowerCase())) {
        addFieldError('Status', data.status, 'ungültiger Statuswert', `einen dieser Werte: ${IMPORT_ALLOWED_STATUSES.join(', ')}`);
    }

    if (data.wartungsintervall_tage && !/^\d+$/.test(data.wartungsintervall_tage)) {
        addFieldError('WartungsintervallTage', data.wartungsintervall_tage, 'keine ganze positive Zahl', 'eine ganze Zahl wie 30 oder 180');
    }

    for (const [label, value] of [['LetzteWartung', data.letzte_wartung_am]]) {
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            addFieldError(label, value, 'ungültiges Datumsformat', 'JJJJ-MM-TT, z. B. 2026-03-30');
        }
    }

    return {
        valid: errors.length === 0,
        data,
        errors
    };
}

async function readImportRows(file) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx')) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel-Import ist aktuell nicht geladen. Bitte Seite neu laden und erneut versuchen.');
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
        return {
            header: rows[0] || [],
            rows: rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
        };
    }

    if (!fileName.endsWith('.csv')) {
        throw new Error('Ungültiges Dateiformat. Bitte eine CSV- oder Excel-Datei (.xlsx) verwenden.');
    }

    const text = await file.text();
    const parsedLines = text
        .split(/\r?\n/)
        .filter(line => line.trim())
        .map(parseCsvLine);

    return {
        header: parsedLines[0] || [],
        rows: parsedLines.slice(1)
    };
}

function rowToWerkzeugPayload(parts, headerMap = null) {
    const getValue = (headerName, fallbackIndex) => {
        const index = headerMap?.[headerName];
        const resolvedIndex = Number.isInteger(index) ? index : fallbackIndex;
        return normalizeImportCell(parts[resolvedIndex]);
    };

    return {
        name: getValue('Werkzeug', 0),
        beschreibung: getValue('Beschreibung', 1),
        zustand: getValue('Zustand', 2),
        inventarnummer: getValue('Inventarnummer', 3),
        kategorie: getValue('Kategorie', 4),
        lagerplatz: getValue('Lagerplatz', 5),
        status: getValue('Status', 6),
        wartungsintervall_tage: getValue('WartungsintervallTage', 7),
        letzte_wartung_am: getValue('LetzteWartung', 8),
        wartung_notiz: getValue('Wartungsnotiz', 10)
    };
}

function showImportFeedback({ type = 'error', title, summary, details }) {
    const box = document.getElementById('importFeedback');
    const titleEl = document.getElementById('importFeedbackTitle');
    const summaryEl = document.getElementById('importFeedbackSummary');
    const detailsEl = document.getElementById('importFeedbackDetails');

    if (!box || !titleEl || !summaryEl || !detailsEl) return;

    box.classList.add('active');
    box.classList.remove('error', 'success');
    box.classList.add(type);
    titleEl.textContent = title || (type === 'success' ? 'Import erfolgreich' : 'Import fehlgeschlagen');
    summaryEl.textContent = summary || '';
    detailsEl.value = details || '';
}

function clearImportFeedback() {
    const box = document.getElementById('importFeedback');
    const titleEl = document.getElementById('importFeedbackTitle');
    const summaryEl = document.getElementById('importFeedbackSummary');
    const detailsEl = document.getElementById('importFeedbackDetails');

    if (!box || !titleEl || !summaryEl || !detailsEl) return;

    box.classList.remove('active', 'error', 'success');
    titleEl.textContent = 'Import-Hinweis';
    summaryEl.textContent = '';
    detailsEl.value = '';
}

function buildImportErrorMessage(fileErrorMessages, rowErrorMessages) {
    const combined = [...fileErrorMessages, ...rowErrorMessages];
    if (!combined.length) {
        return {
            title: 'Import fehlgeschlagen',
            summary: 'Der Import konnte nicht ausgeführt werden.',
            details: 'Es wurde kein konkreter Fehlertext geliefert.'
        };
    }

    const details = [
        'Bitte Dateiinhalt prüfen und danach erneut importieren.',
        '',
        ...combined.map(message => `- ${message}`)
    ].join('\n');

    return {
        title: 'Import fehlgeschlagen',
        summary: `${combined.length} Problem${combined.length === 1 ? '' : 'e'} gefunden. Die Details unten können direkt markiert und kopiert werden.`,
        details
    };
}

async function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    clearImportFeedback();

    let imported = 0;
    const fileErrors = [];
    const rowErrors = [];

    try {
        const hasAccess = await ensureToolAdminAccess({
            reason: 'Für den Import neuer Werkzeuge muss eine gültige Tool-Admin-Anmeldung vorliegen. Ihre vorherige Anmeldung ist möglicherweise abgelaufen.'
        });

        if (!hasAccess) {
            const feedback = buildImportErrorMessage([], [
                'Keine gültige Tool-Admin-Anmeldung vorhanden. Bitte erneut als Tool-Admin anmelden und den Import danach noch einmal starten.'
            ]);
            showImportFeedback({ type: 'error', ...feedback });
            event.target.value = '';
            return;
        }

        const { header, rows } = await readImportRows(file);

        if (!rows.length) {
            fileErrors.push('Die Datei enthält keine Datenzeilen. Erwartet werden eine Kopfzeile plus mindestens eine Werkzeug-Zeile.');
        }

        const lagerplatzHeaderIndex = IMPORT_HEADERS.indexOf('Lagerplatz');
        const hasAnyLagerplatzValue = rows.some(row => normalizeImportCell(row[lagerplatzHeaderIndex]));

        const headerValidation = validateImportHeaders(header);
        if (!headerValidation.valid) {
            fileErrors.push('Die Spaltenüberschriften passen nicht zur Mustervorlage. Bitte Reihenfolge und Schreibweise unverändert aus der Mustervorlage übernehmen.');
            fileErrors.push(...headerValidation.errors.map(error => `${error}. So muss es aussehen: ${IMPORT_HEADERS.join(', ')}`));
        }

        const unknownStatusRows = [];
        rows.forEach((row, index) => {
            const rawStatus = normalizeImportCell(row[IMPORT_HEADERS.indexOf('Status')]);
            if (rawStatus && !IMPORT_ALLOWED_STATUSES.includes(rawStatus.toLowerCase())) {
                unknownStatusRows.push(`Zeile ${index + 2} | Status: gefunden „${rawStatus}" → ungültiger Statuswert. Erwartet: ${IMPORT_ALLOWED_STATUSES.join(', ')}`);
            }
        });
        if (unknownStatusRows.length) {
            rowErrors.push(...unknownStatusRows);
        }

        const normalizedHeader = IMPORT_HEADERS.map((_, index) => normalizeImportCell(header[index]));
        const headerMap = Object.fromEntries(normalizedHeader.map((name, index) => [name, index]));

        const validRows = [];
        rows.forEach((row, index) => {
            const data = rowToWerkzeugPayload(row, headerMap);
            if (!hasAnyLagerplatzValue && !data.lagerplatz) {
                data.lagerplatz = 'Nicht angegeben';
            }
            // Strip empty-string values from optional fields to avoid
            // server-side validation errors (e.g. status: '' → "Ungültiger Status")
            const cleanData = Object.fromEntries(
                Object.entries(data).filter(([, v]) => v !== '')
            );
            const validation = validateImportRow(cleanData, index + 2);
            if (validation.valid) {
                validRows.push(validation.data);
            } else {
                rowErrors.push(...validation.errors);
            }
        });

        if (fileErrors.length || rowErrors.length) {
            const feedback = buildImportErrorMessage(fileErrors, rowErrors);
            showImportFeedback({ type: 'error', ...feedback });
            event.target.value = '';
            return;
        }

        const bulkResult = await apiCall('/werkzeuge/bulk', {
            method: 'POST',
            body: JSON.stringify(validRows)
        });

        imported = bulkResult.imported || 0;

        if (bulkResult.errors && bulkResult.errors.length) {
            bulkResult.errors.forEach(e => {
                rowErrors.push(`Zeile mit Inventarnummer „${e.inventarnummer || 'unbekannt'}": ${e.error}`);
            });
        }

        if (rowErrors.length) {
            const feedback = buildImportErrorMessage([], rowErrors);
            const hasPartialSuccess = imported > 0;
            showImportFeedback({
                type: hasPartialSuccess ? 'warning' : 'error',
                title: hasPartialSuccess ? `Import teilweise erfolgreich (${imported} von ${validRows.length})` : 'Import fehlgeschlagen',
                ...feedback
            });
            event.target.value = '';
            if (hasPartialSuccess) loadDashboard();
            return;
        }

        showImportFeedback({
            type: 'success',
            title: 'Import erfolgreich',
            summary: `${imported} Werkzeug${imported === 1 ? '' : 'e'} wurden erfolgreich importiert.`,
            details: `${file.name}\n\nErfolgreich importiert: ${imported}`
        });
        showToast(`✓ Import abgeschlossen: ${imported} erfolgreich`);
        event.target.value = '';
        loadDashboard();
    } catch (err) {
        event.target.value = '';
        showImportFeedback({
            type: 'error',
            title: 'Import fehlgeschlagen',
            summary: 'Der Import konnte nicht verarbeitet werden.',
            details: err.message || 'Fehler beim Import. Bitte Datei und Tool-Admin-Anmeldung prüfen.'
        });
    }
}

// ==================== Foto Zoom ====================

let fotoZoomTimer = null;

function setupFotoZoomOverlay() {
    if (document.getElementById('fotoZoomOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'fotoZoomOverlay';
    overlay.className = 'foto-zoom-overlay';
    overlay.innerHTML = '<img id="fotoZoomImg" src="" alt=""><div class="foto-zoom-hint">Klicken zum Schließen</div>';
    overlay.addEventListener('click', hideFotoZoom);
    document.body.appendChild(overlay);
}

function showFotoZoom(src, alt) {
    setupFotoZoomOverlay();
    const img = document.getElementById('fotoZoomImg');
    img.src = src;
    img.alt = alt || '';
    document.getElementById('fotoZoomOverlay').classList.add('active');
}

function hideFotoZoom() {
    const overlay = document.getElementById('fotoZoomOverlay');
    if (overlay) overlay.classList.remove('active');
}

function attachFotoZoomListeners(container) {
    container.querySelectorAll('.werkzeug-card-visual img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => {
            showFotoZoom(img.src, img.alt);
        });
    });
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
    const von = document.getElementById('verfuegbarVon')?.value || '';
    const bis = document.getElementById('verfuegbarBis')?.value || '';

    if ((von && !bis) || (!von && bis)) {
        updateVerfuegbarkeitsHinweis({}, 0, 'Bitte Start- und Enddatum gemeinsam setzen.');
        return;
    }

    if (von && bis && new Date(bis) < new Date(von)) {
        updateVerfuegbarkeitsHinweis({}, 0, 'Das Enddatum muss am oder nach dem Startdatum liegen.');
        return;
    }

    verfuegbarkeitsFilter = { von, bis };
    loadWerkzeuge({ kategorie, search, von, bis });
}

function resetVerfuegbarkeitsFilter() {
    const vonInput = document.getElementById('verfuegbarVon');
    const bisInput = document.getElementById('verfuegbarBis');
    if (vonInput) vonInput.value = '';
    if (bisInput) bisInput.value = '';
    verfuegbarkeitsFilter = { von: '', bis: '' };
    filterWerkzeuge();
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
    document.getElementById('verfuegbarVon')?.setAttribute('min', today);
    document.getElementById('verfuegbarBis')?.setAttribute('min', today);

    initApp();

    const toolId = getInitialToolIdFromUrl();
    if (toolId) {
        showWerkzeugDetail(toolId);
    }
    console.log('ToolHub API-Version geladen');
    console.log('API URL:', window.API_URL);
});
