/**
 * SETUP WEBHOOK - Ejecuta este script UNA SOLA VEZ para registrar el webhook en MP
 * 
 * Uso:
 * node setup-webhook.js
 * 
 * Esto registrará tu endpoint en Mercado Pago
 */

require('dotenv').config();
const https = require('https');

const WEBHOOK_URL = process.env.BACKEND_URL 
  ? `${process.env.BACKEND_URL}/api/webhook-mercadopago`
  : 'http://localhost:3001/api/webhook-mercadopago';

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  console.error('❌ Error: MP_ACCESS_TOKEN no configurado en .env');
  process.exit(1);
}

console.log('📍 Registrando webhook en Mercado Pago...');
console.log(`🔗 URL del webhook: ${WEBHOOK_URL}`);

const options = {
  hostname: 'api.mercadopago.com',
  port: 443,
  path: '/v1/notifications/webhooks',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => { data += chunk; });

  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      const webhook = JSON.parse(data);
      console.log('✅ Webhook registrado exitosamente!');
      console.log(`   ID: ${webhook.id}`);
      console.log(`   URL: ${webhook.url}`);
      console.log(`   Estado: ${webhook.status}`);
    } else {
      console.error(`❌ Error (${res.statusCode}):`, data);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Error de conexión:', err.message);
});

const payload = JSON.stringify({
  url: WEBHOOK_URL,
  events: ['payment.created', 'payment.updated'],
});

req.write(payload);
req.end();