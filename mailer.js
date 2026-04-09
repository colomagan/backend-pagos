const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const formatPrice = (n) =>
  Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });

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
    ['Dirección completa', addr.display],
    ['Calle',             addr.calle],
    ['Barrio',            addr.barrio],
    ['Ciudad',            addr.ciudad],
    ['Código postal',     addr.codigoPostal],
    ['Notas',             addr.notes],
  ].filter(([, v]) => v);

  return rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#888;width:130px;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${value}</td>
    </tr>`).join('');
}

function ownerEmailHTML({ buyer, addr, cartItems, total, orderId, siteUrl }) {
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
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:3px;text-transform:uppercase;">Nueva venta recibida</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 0;text-align:center;">
          <span style="display:inline-block;background:#dcfce7;color:#16a34a;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">
            ✓ &nbsp;Pago aprobado — Orden #${orderId}
          </span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 0;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Artículos vendidos</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsRows(cartItems, siteUrl)}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 40px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px 0;border-top:2px solid #111;font-size:15px;font-weight:700;color:#111;">Total cobrado</td>
              <td style="padding:14px 0;border-top:2px solid #111;font-size:18px;font-weight:900;color:#111;text-align:right;">${formatPrice(total)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="height:1px;background:#f0f0f0;"></td></tr>
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
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${buyer.email}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:12px;color:#888;">Teléfono</td>
              <td style="padding:6px 0;font-size:13px;color:#111;font-weight:500;">${buyer.telefono}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 36px;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;">Dirección de envío</p>
          <table cellpadding="0" cellspacing="0">
            ${addressBlock(addr)}
          </table>
        </td>
      </tr>
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

function buyerEmailHTML({ buyer, addr, cartItems, total, orderId, siteUrl }) {
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
            Pronto nos pondremos en contacto con vos para coordinar el envío.
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
              <td style="padding:8px 0;font-size:13px;color:#555;">Subtotal</td>
              <td style="padding:8px 0;font-size:13px;color:#555;text-align:right;">${formatPrice(total)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:13px;color:#16a34a;font-weight:600;">Envío</td>
              <td style="padding:8px 0;font-size:13px;color:#16a34a;font-weight:600;text-align:right;">Gratis</td>
            </tr>
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
                <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">
                  📦 &nbsp;Vamos a preparar tu pedido y coordinar la entrega.
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">
                  📱 &nbsp;Te contactaremos al <strong>${buyer.telefono}</strong> o a <strong>${buyer.email}</strong> para darte los detalles del envío.
                </p>
                <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
                  ❓ &nbsp;¿Tenés alguna duda? Respondé este email y te ayudamos.
                </p>
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

function contactConfirmationEmailHTML({ name, subject }) {
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
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Recibimos tu mensaje</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px;text-align:center;">
          <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.7;">
            Hola <strong>${name}</strong>, recibimos tu consulta sobre <strong>${subject}</strong>.<br>
            Te respondemos a la brevedad.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:8px;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">
                  📬 &nbsp;Tu mensaje fue recibido correctamente.
                </p>
                <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
                  ❓ &nbsp;Si tenés alguna urgencia, respondé este email y te ayudamos.
                </p>
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

async function sendContactEmail({ name, email, subject, message }) {
  await Promise.all([
    transporter.sendMail({
      from: `"Azter Contacto" <${process.env.EMAIL_USER}>`,
      to: process.env.STORE_EMAIL,
      replyTo: email,
      subject: `📩 Contacto: ${subject}`,
      html: contactEmailHTML({ name, email, subject, message }),
    }),
    transporter.sendMail({
      from: `"Azter" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Recibimos tu mensaje — Azter`,
      html: contactConfirmationEmailHTML({ name, subject }),
    }),
  ]);
}

async function sendNewsletterEmail({ email }) {
  await transporter.sendMail({
    from: `"Azter Newsletter" <${process.env.EMAIL_USER}>`,
    to: process.env.STORE_EMAIL,
    subject: `📬 Nueva suscripción: ${email}`,
    html: newsletterEmailHTML({ email }),
  });
}

async function sendOrderEmails({ buyer, addr, cartItems, total, orderId }) {
  const siteUrl = process.env.SITE_URL || '';

  const ownerMail = {
    from: `"Azter Ventas" <${process.env.EMAIL_USER}>`,
    to: process.env.STORE_EMAIL,
    subject: `🛍️ Nueva venta — Orden #${orderId} — ${formatPrice(total)}`,
    html: ownerEmailHTML({ buyer, addr, cartItems, total, orderId, siteUrl }),
  };

  const buyerMail = {
    from: `"Azter" <${process.env.EMAIL_USER}>`,
    to: buyer.email,
    subject: `¡Tu pedido está confirmado! — Azter`,
    html: buyerEmailHTML({ buyer, addr, cartItems, total, orderId, siteUrl }),
  };

  await Promise.all([
    transporter.sendMail(ownerMail),
    transporter.sendMail(buyerMail),
  ]);

  console.log(`Emails enviados — Orden #${orderId}`);
}

module.exports = { sendOrderEmails, sendContactEmail, sendNewsletterEmail };
