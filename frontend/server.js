// Minimal static server for Azure App Service
// Serves static frontend and generates a runtime `config.js` from environment
// variables so the app can be configured via Azure App Settings.

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 8080;

// Serve runtime config at /config.js
app.get('/config.js', (req, res) => {
  const apiUrl = process.env.API_URL || '/api';
  const content = `window.API_URL = ${JSON.stringify(apiUrl)};\nconsole.log('frontend config loaded. API_URL=', window.API_URL);`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(content);
});

// Serve static files
const staticDir = path.join(__dirname);
app.use(express.static(staticDir, { index: false }));

// SPA fallback to index.html
app.get('*', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(port, () => {
  console.log(`Frontend server listening on port ${port}`);
});
