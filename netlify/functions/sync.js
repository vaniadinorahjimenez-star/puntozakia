/**
 * Netlify Function alias: sync.js
 * Redirige y comparte la lógica con sync-data.js para garantizar que cualquier llamada a /api/sync
 * o /.netlify/functions/sync funcione sin fallos.
 */
const syncData = require('./sync-data.js');

exports.handler = async (event, context) => {
  return syncData.handler(event, context);
};
