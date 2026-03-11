// Frontend runtime config.
// In production this file can be generated during deploy to inject the
// Azure App Setting value for API_URL, e.g. in CI or ZIP deploy:
//   echo "window.API_URL = 'https://.../api';" > frontend/config.js
// For local development keep the localhost fallback below.

// If Azure generated runtime config exists it will override this value.
// This fallback is helpful for local development.
window.API_URL = window.API_URL || (typeof process !== 'undefined' && process.env && process.env.API_URL) || 'http://localhost:3000/api';

// Expose a small helper for debugging in browser
if (typeof window !== 'undefined') console.log('frontend config loaded. API_URL=', window.API_URL);
