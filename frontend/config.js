// ToolHub API Configuration - Runtime Environment Variables
// Diese werden über Azure App Settings gesetzt

// API URL aus Environment Variable oder Fallback
window.API_URL = window.API_URL || 'http://localhost:3000/api';

// Admin Password aus Environment Variable oder Fallback
window.ADMIN_PASSWORD = window.ADMIN_PASSWORD || 'admin123';

// Debug Info
console.log('ToolHub Config:', {
  API_URL: window.API_URL,
  hasAdminPassword: !!window.ADMIN_PASSWORD
});
