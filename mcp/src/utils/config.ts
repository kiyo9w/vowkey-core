/**
 * Configuration and constants for the Vowkey MCP Server
 */

// API Configuration
export const API_BASE_URL =
  process.env['VOWKEY_API_BASE_URL'] || 'https://api.vowkey.com';
export const IDENTITY_URL =
  process.env['VOWKEY_IDENTITY_URL'] || 'https://identity.vowkey.com';
export const CLIENT_ID = process.env['VOWKEY_CLIENT_ID'];
export const CLIENT_SECRET = process.env['VOWKEY_CLIENT_SECRET'];
