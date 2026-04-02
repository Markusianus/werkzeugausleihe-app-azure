const http = require('http');
const { URL } = require('url');

function normalizeIsoDate(dateInput) {
  if (!dateInput) return null;
  const value = String(dateInput).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeDateInput(dateInput) {
  return normalizeIsoDate(dateInput);
}

const port = Number(process.env.MOCK_PORT || 3100);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname === '/api/werkzeuge') {
    const verfuegbarVon = normalizeDateInput(url.searchParams.get('verfuegbar_von'));
    const verfuegbarBis = normalizeDateInput(url.searchParams.get('verfuegbar_bis'));

    if ((verfuegbarVon && !verfuegbarBis) || (!verfuegbarVon && verfuegbarBis)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bitte Start- und Enddatum gemeinsam setzen' }));
      return;
    }

    if (verfuegbarVon && verfuegbarBis && verfuegbarBis < verfuegbarVon) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Das Enddatum muss am oder nach dem Startdatum liegen' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, name: 'Mock Werkzeug', verfuegbar_von: verfuegbarVon, verfuegbar_bis: verfuegbarBis }]));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`mock availability filter server listening on ${port}`);
});
