require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { sendOrderEmails, sendContactEmail, sendNewsletterEmail } = require('./mailer');
const { supabase } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3001;

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.post('/api/process-payment', async (req, res) => {
  const { formData, buyer, address, addressComponents, notes, cartItems, addressType, piso, letra } = req.body;

  if (!formData || !buyer || !cartItems) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  try {
    const paymentClient = new Payment(client);

    const body = {
      transaction_amount: Number(formData.transaction_amount),
      description: `Compra Azter — ${cartItems.map(i => i.title).join(', ')}`,
      payment_method_id: formData.payment_method_id,
      payer: {
        email: buyer.email, // OBLIGATORIO
        first_name: buyer.nombre, // RECOMENDADO
        last_name: buyer.apellido, // RECOMENDADO
        phone: {
          area_code: buyer.telefono?.substring(0, 2) || '54',
          number: buyer.telefono?.replace(/\D/g, '').substring(2) || '0',
        }, // RECOMENDADO
        identification: {
          type: formData.payer?.identification?.type || 'DNI',
          number: String(formData.payer?.identification?.number || '12345678'),
        },
        address: {
          zip_code: addressComponents?.postcode || '',
          street_name: addressComponents?.road || address?.split(',')[0] || '',
          street_number: addressComponents?.house_number || '',
        },
      },
      // ✅ STATEMENT DESCRIPTOR (recomendado)
      statement_descriptor: 'AZTER ECOMMERCE',
      // ✅ EXTERNAL REFERENCE (obligatorio)
      external_reference: `ORDER_${Date.now()}_${buyer.email}`,
      // ✅ NOTIFICATION URL (obligatorio)
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook-mercadopago`,
    };

    if (formData.token) {
      body.token = formData.token;
      body.installments = Number(formData.installments) || 1;
    } 

    if (formData.issuer_id) {
      body.issuer_id = String(formData.issuer_id);
    }

    console.log('📤 Body enviado a MP:', JSON.stringify(body, null, 2));

    const result = await paymentClient.create({
      body,
      requestOptions: { idempotencyKey: `${buyer.email}-${Date.now()}` },
    });

    console.log(`✅ Pago ${result.id} — ${result.status} (${result.status_detail})`);

    const addr = {
      display:      address || '',
      calle:        addressComponents?.road ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}` : '',
      barrio:       addressComponents?.suburb || addressComponents?.neighbourhood || '',
      ciudad:       addressComponents?.city || '',
      codigoPostal: addressComponents?.postcode || '',
      notes:        notes || '',
      tipo:         addressType || '',
      piso:         piso || '',
      letra:        letra || '',
    };

    // Enviar email al dueño siempre — aprobado, pendiente o rechazado
    sendOrderEmails({
      buyer,
      addr,
      cartItems,
      total:        result.transaction_amount,
      orderId:      result.id,
      status:       result.status,
      statusDetail: result.status_detail,
    }).catch(err => console.error('Error enviando emails:', err.message));

    // Guardar en DB siempre
    const saveOrder = async () => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          mp_payment_id:    result.id,
          status:           result.status,
          status_detail:    result.status_detail,
          total:            Math.round(result.transaction_amount),
          buyer_name:       buyer.nombre,
          buyer_lastname:   buyer.apellido,
          buyer_email:      buyer.email,
          buyer_phone:      String(buyer.telefono),
          address_display:  address || '',
          address_street:   addr.calle,
          address_barrio:   addr.barrio,
          address_city:     addr.ciudad,
          address_postcode: addr.codigoPostal,
          address_notes:    notes || '',
          address_type:     addressType || null,
          address_piso:     piso || null,
          address_letra:    letra || null,
        })
        .select('id')
        .single();

      if (orderError) throw orderError;

      const items = cartItems.map(item => ({
        order_id:    order.id,
        product_id:  item.id,
        title:       item.title,
        subtitle:    item.subtitle || null,
        color_name:  item.color?.name || null,
        color_value: item.color?.value || null,
        size:        item.size || null,
        quantity:    item.quantity,
        unit_price:  item.price,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) throw itemsError;

      console.log(`💾 Orden #${order.id} guardada [${result.status}]`);
    };

    saveOrder().catch(err => console.error('Error guardando orden:', err.message));

    res.json({
      status: result.status,
      id:     result.id,
      detail: result.status_detail,
    });

  } catch (err) {
    console.error('❌ Error MP:', err?.cause ?? err.message);
    res.status(500).json({ error: true, message: 'Error al procesar el pago. Intentá de nuevo.' });
  }
});

app.post('/api/send-contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message)
    return res.status(400).json({ error: true, message: 'Datos incompletos' });

  try {
    await sendContactEmail({ name, email, subject, message });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando contacto:', err.message);
    res.status(500).json({ error: true, message: 'No se pudo enviar el mensaje.' });
  }
});

app.post('/api/subscribe-newsletter', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: true, message: 'Email requerido' });

  try {
    await sendNewsletterEmail({ email });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando newsletter:', err.message);
    res.status(500).json({ error: true, message: 'No se pudo completar la suscripción.' });
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// ✅ WEBHOOK DE MERCADO PAGO (OBLIGATORIO)
// Recibe notificaciones de cambios de estado en pagos
app.post('/api/webhook-mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;

    // MP envía notificaciones de tipo "payment" cuando hay cambios en un pago
    if (type === 'payment') {
      const paymentId = data?.id;
      if (!paymentId) {
        console.log('⚠️ Webhook sin payment ID, ignorando...');
        return res.json({ ok: true }); // Responder 200 a MP igual para que no reintente
      }

      console.log(`🔔 Webhook recibido: Payment ${paymentId}`);

      // Aquí puedes:
      // 1. Consultar el estado actual del pago en MP
      // 2. Actualizar el estado en tu base de datos
      // 3. Enviar emails al cliente
      // 4. Activar flujos automatizados

      // Ejemplo: actualizar orden en Supabase
      const { data: paymentData, error: fetchError } = await supabase
        .from('orders')
        .select('id')
        .eq('mp_payment_id', paymentId.toString())
        .single();

      if (fetchError) {
        console.log(`⚠️ Orden no encontrada para payment ${paymentId}`);
        return res.json({ ok: true });
      }

      console.log(`✅ Webhook procesado para orden #${paymentData.id}`);
    }

    // Responder 200 a MP para que no reintente
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error en webhook:', err.message);
    // Responder 200 igual para que MP no reintente infinitamente
    res.json({ ok: true });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor Azter escuchando en http://localhost:${PORT}`);
  console.log(`📍 Webhook disponible en: /api/webhook-mercadopago`);
});