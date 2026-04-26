const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const formatPrice = (n) =>
  Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });

// ── Helpers ───────────────────────────────────────────────────────────────────

function docTypeLabel(type) {
  const map = { '80': 'DNI', '86': 'LE', '87': 'LC', '89': 'CI', '96': 'Pasaporte' };
  return map[String(type)] || type || 'Documento';
}

function addressTypeLabel(tipo) {
  const map = { 'casa': 'Casa', 'departamento': 'Departamento', 'otro': 'Otro' };
  return map[String(tipo).toLowerCase()] || tipo;
}

function paymentMethodLabel(method) {
  const map = { 'tarjeta': 'Tarjeta de crédito/débito', 'transferencia': 'Transferencia bancaria' };
  return map[method] || method || '—';
}

function statusDetailLabel(detail) {
  const map = {
    cc_rejected_insufficient_amount:       'Fondos insuficientes',
    cc_rejected_bad_filled_security_code:  'Código de seguridad incorrecto',
    cc_rejected_bad_filled_date:           'Fecha de vencimiento incorrecta',
    cc_rejected_card_disabled:             'Tarjeta bloqueada',
    cc_rejected_call_for_authorize:        'Requiere autorización del banco',
    cc_rejected_high_risk:                 'Rechazada por riesgo',
    cc_rejected_blacklist:                 'Tarjeta no permitida',
    cc_rejected_other_reason:              'Error general de tarjeta',
    cc_rejected_bad_filled_other:          'Datos de tarjeta incorrectos',
    cc_rejected_max_attempts:             'Máximo de intentos alcanzado',
    cc_rejected_duplicated_payment:        'Pago duplicado',
    pending_waiting_payment:              'Esperando pago',
    pending_review_manual:                'En revisión manual',
    pending_contingency:                  'Pendiente por contingencia',
  };
  return map[detail] || detail || 'Sin detalle';
}

function statusBadgeOwner(status, statusDetail) {
  if (status === 'approved') {
    return `<span style="display:inline-block;background:#dcfce7;color:#16a34a;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">✓ &nbsp;Pago aprobado</span>`;
  }
  if (status === 'pending') {
    return `<span style="display:inline-block;background:#fef9c3;color:#92400e;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">⏳ &nbsp;Pago pendiente — ${statusDetailLabel(statusDetail)}</span>`;
  }
  return `<span style="display:inline-block;background:#fee2e2;color:#dc2626;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">✗ &nbsp;Pago rechazado — ${statusDetailLabel(statusDetail)}</span>`;
}

function itemsRows(cartItems, siteUrl) {
  return cartItems.map(item => {
    const imgSrc = siteUrl ? `${siteUrl}${item.image}` : '';
    const subtotal = formatPrice(item.price * item.quantity);
    return `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #f0f0f0;">
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              ${imgSrc ? `
              <td width="72" style="padding-right:16px;vertical-align:top;">
                <img src="${imgSrc}" width="72" height="72"
                  style="border-radius:6px;object-fit:cover;display:block;background:#f5f5f5;" />
              </td>` : ''}
              <td style="vertical-align:top;">
                <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#111;letter-spacing:0.05em;">${item.title}</p>
                <p style="margin:0 0 6px;font-size:12px;color:#888;">${item.subtitle || ''}</p>
                <p style="margin:0;font-size:12px;color:#555;">
                  Color: <strong>${item.color?.name || '—'}</strong> &nbsp;·&nbsp;
                  Talle: <strong>${item.size || '—'}</strong> &nbsp;·&nbsp;
                  Cantidad: <strong>${item.quantity}</strong>
                </p>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap;">
                <p style="margin:0;font-size:13px;font-weight:700;color:#111;">${subtotal}</p>
                ${item.quantity > 1 ? `<p style="margin:4px 0 0;font-size:11px;color:#aaa;">${formatPrice(item.price)} c/u</p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');
}

function addressBlock(addr) {
  const rows = [
    ['Tipo',              addr.tipo  ? addressTypeLabel(addr.tipo)  : null],
    ['Dirección completa', addr.display],
    ['Calle',             addr.calle],
    ['Barrio',            addr.barrio],
    ['Ciudad',            addr.ciudad],
    ['Código postal',     addr.codigoPostal],
    ['Piso',              addr.piso],
    ['Depto / Letra',     addr.letra],
    ['Notas',             addr.notes],
  ].filter(([, v]) => v);

  return rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#888;width:130px;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${value}</td>
    </tr>`).join('');
}

// ── Email dueño — universal (todos los estados) ───────────────────────────────

function ownerEmailHTML({ buyer, addr, cartItems, total, orderId, status, statusDetail, paymentMethod, paymentId, siteUrl }) {
  const isApproved = status === 'approved';
  const subjectLabel = isApproved ? 'Nueva venta recibida' : status === 'pending' ? 'Pago pendiente' : 'Intento de compra — pago rechazado';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:#111;padding:36px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#fff;letter-spacing:6px;">AZTER</p>
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:3px;text-transform:uppercase;">${subjectLabel}</p>
        </td>
      </tr>

      <!-- Badge de estado -->
      <tr>
        <td style="padding:28px 40px 0;text-align:center;">
          ${statusBadgeOwner(status, statusDetail)}
          ${orderId ? `<p style="margin:10px 0 0;font-size:12px;color:#aaa;letter-spacing:0.1em;">Orden #${orderId}</p>` : ''}
        </td>
      </tr>

      <!-- Método de pago -->
      <tr>
        <td style="padding:20px 40px 0;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Pago</p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;width:130px;">Método</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${paymentMethodLabel(paymentMethod)}</td>
            </tr>
            ${paymentId ? `
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">ID transacción</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;font-family:monospace;">${paymentId}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">Estado</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${status}${statusDetail ? ` — ${statusDetailLabel(statusDetail)}` : ''}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Productos -->
      <tr>
        <td style="padding:28px 40px 0;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Artículos</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsRows(cartItems, siteUrl)}
          </table>
        </td>
      </tr>

      <!-- Total -->
      <tr>
        <td style="padding:16px 40px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px 0;border-top:2px solid #111;font-size:15px;font-weight:700;color:#111;">Total</td>
              <td style="padding:14px 0;border-top:2px solid #111;font-size:18px;font-weight:900;color:#111;text-align:right;">${formatPrice(total)}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Divisor -->
      <tr><td style="height:1px;background:#f0f0f0;"></td></tr>

      <!-- Comprador -->
      <tr>
        <td style="padding:28px 40px 0;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Datos del comprador</p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;width:130px;">Nombre</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${buyer.nombre} ${buyer.apellido}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">Email</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">
                <a href="mailto:${buyer.email}" style="color:#111;">${buyer.email}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">Teléfono</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">
                <a href="tel:${buyer.telefono}" style="color:#111;">${buyer.telefono}</a>
              </td>
            </tr>
            ${buyer.docNumber ? `
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">${docTypeLabel(buyer.docType)}</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${buyer.docNumber}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>

      <!-- Envío -->
      <tr>
        <td style="padding:24px 40px 36px;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Dirección de envío</p>
          <table cellpadding="0" cellspacing="0">
            ${addressBlock(addr)}
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#bbb;letter-spacing:0.05em;">AZTER — Panel de ventas &nbsp;·&nbsp; ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Email comprador — aprobado (para uso futuro) ──────────────────────────────

function buyerApprovedEmailHTML({ buyer, addr, cartItems, total, orderId, siteUrl }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <tr>
        <td style="background:#111;padding:40px;text-align:center;">
          <p style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;letter-spacing:6px;">AZTER</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">¡Gracias por tu compra!</p>
        </td>
      </tr>

      <tr>
        <td style="padding:36px 40px 0;text-align:center;">
          <p style="margin:0 0 8px;font-size:15px;color:#333;line-height:1.6;">
            Hola <strong>${buyer.nombre}</strong>, tu pedido fue confirmado con éxito.<br>
            Pronto nos pondremos en contacto para coordinar el envío.
          </p>
          <p style="margin:16px 0 0;display:inline-block;background:#111;color:#fff;padding:10px 24px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:0.15em;">
            ORDEN #${orderId}
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:32px 40px 0;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Tu pedido</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsRows(cartItems, siteUrl)}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 40px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 0;border-top:2px solid #111;font-size:15px;font-weight:700;color:#111;">Total</td>
              <td style="padding:12px 0;border-top:2px solid #111;font-size:18px;font-weight:900;color:#111;text-align:right;">${formatPrice(total)}</td>
            </tr>
          </table>
        </td>
      </tr>

      <tr><td style="height:1px;background:#f0f0f0;margin-top:28px;"></td></tr>

      <tr>
        <td style="padding:28px 40px;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Dirección de envío</p>
          <table cellpadding="0" cellspacing="0">
            ${addressBlock(addr)}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:0 40px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:8px;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#111;">¿Qué sigue?</p>
                <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">📦 &nbsp;Vamos a preparar tu pedido y coordinar la entrega.</p>
                <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">📱 &nbsp;Te contactaremos al <strong>${buyer.telefono}</strong> o a <strong>${buyer.email}</strong>.</p>
                <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">❓ &nbsp;¿Tenés alguna duda? Respondé este email y te ayudamos.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="background:#111;padding:24px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#fff;letter-spacing:4px;">AZTER</p>
          <p style="margin:0;font-size:11px;color:#666;">© ${new Date().getFullYear()} Azter. Todos los derechos reservados.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Emails de contacto y newsletter ──────────────────────────────────────────

function contactEmailHTML({ name, email, subject, message }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:#111;padding:36px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#fff;letter-spacing:6px;">AZTER</p>
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:3px;text-transform:uppercase;">Nuevo mensaje de contacto</p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;">
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:8px 0;font-size:12px;color:#888;width:100px;">Nombre</td>
              <td style="padding:8px 0;font-size:13px;color:#111;font-weight:500;">${name}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:12px;color:#888;">Email</td>
              <td style="padding:8px 0;font-size:13px;color:#111;font-weight:500;">${email}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:12px;color:#888;">Asunto</td>
              <td style="padding:8px 0;font-size:13px;color:#111;font-weight:500;">${subject}</td>
            </tr>
          </table>
          <div style="margin-top:24px;padding:20px;background:#f9f9f9;border-radius:8px;border-left:3px solid #111;">
            <p style="margin:0;font-size:13px;color:#333;line-height:1.7;white-space:pre-wrap;">${message}</p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#f9f9f9;padding:16px 40px;text-align:center;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#bbb;">AZTER — Formulario de contacto</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function newsletterEmailHTML({ email }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:#111;padding:36px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:28px;font-weight:900;color:#fff;letter-spacing:6px;">AZTER</p>
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:3px;text-transform:uppercase;">Nueva suscripción al newsletter</p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:14px;color:#555;">Se suscribió el siguiente email:</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#111;">${email}</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f9f9f9;padding:16px 40px;text-align:center;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#bbb;">AZTER — Newsletter</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Envío de emails de contacto y newsletter ──────────────────────────────────

async function sendContactEmail({ name, email, subject, message }) {
  await transporter.sendMail({
    from: `"Azter Contacto" <${process.env.EMAIL_USER}>`,
    to: process.env.STORE_EMAIL,
    replyTo: email,
    subject: `📩 Contacto: ${subject}`,
    html: contactEmailHTML({ name, email, subject, message }),
  });
}

async function sendNewsletterEmail({ email }) {
  await transporter.sendMail({
    from: `"Azter Newsletter" <${process.env.EMAIL_USER}>`,
    to: process.env.STORE_EMAIL,
    subject: `📬 Nueva suscripción: ${email}`,
    html: newsletterEmailHTML({ email }),
  });
}

// ── Función principal — envía siempre, para todos los estados ─────────────────

async function sendOrderEmails({ buyer, addr, cartItems, total, orderId, status, statusDetail, paymentMethod, paymentId }) {
  const siteUrl = process.env.SITE_URL || '';

  const subjectEmojis = { approved: '🛍️', pending: '⏳', rejected: '⚠️' };
  const emoji = subjectEmojis[status] || '📋';

  // Email al dueño — siempre, con todos los datos recolectados
  const ownerMail = {
    from: `"Azter Ventas" <${process.env.EMAIL_USER}>`,
    to: process.env.STORE_EMAIL,
    subject: `${emoji} ${status === 'approved' ? 'Nueva venta' : status === 'pending' ? 'Pago pendiente' : 'Intento de compra'} — ${buyer.nombre} ${buyer.apellido} — ${formatPrice(total)}`,
    html: ownerEmailHTML({ buyer, addr, cartItems, total, orderId, status, statusDetail, paymentMethod, paymentId, siteUrl }),
  };

  await transporter.sendMail(ownerMail);
  console.log(`📧 Email al dueño enviado [${status}] — ${buyer.email}`);
}

module.exports = { sendOrderEmails, sendContactEmail, sendNewsletterEmail };
