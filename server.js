require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { sendOrderEmails, sendContactEmail, sendNewsletterEmail } = require('./mailer');
const { supabase } = require('./supabase');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.post('/api/process-transfer', upload.single('voucher'), async (req, res) => {
  const { buyer, address, addressComponents, notes, cartItems, addressType, piso, letra, total } = req.body;

  if (!req.file || !buyer || !cartItems) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  try {
    const buyerObj       = JSON.parse(buyer);
    const addrCompsObj   = JSON.parse(addressComponents || '{}');
    const cartItemsArr   = JSON.parse(cartItems);
    const totalNum       = Number(total);

    // 1. Subir comprobante a Supabase Storage
    const ext      = req.file.originalname.split('.').pop() || 'jpg';
    const fileName = `voucher_${Date.now()}_${buyerObj.email.replace(/[^a-z0-9]/gi, '_')}.${ext}`;

    const { error: storageErr } = await supabase.storage
      .from('vouchers')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (storageErr) throw storageErr;

    const { data: urlData } = supabase.storage.from('vouchers').getPublicUrl(fileName);
    const voucherUrl = urlData?.publicUrl || null;

    // 2. Guardar orden en DB
    const addr = {
      display:      address || '',
      calle:        addrCompsObj?.road ? `${addrCompsObj.road}${addrCompsObj.house_number ? ' ' + addrCompsObj.house_number : ''}` : '',
      barrio:       addrCompsObj?.suburb || addrCompsObj?.neighbourhood || '',
      ciudad:       addrCompsObj?.city || '',
      codigoPostal: addrCompsObj?.postcode || '',
    };

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        status:           'pending_transfer',
        payment_method:   'transferencia',
        voucher_url:      voucherUrl,
        total:            Math.round(totalNum),
        buyer_name:       buyerObj.nombre,
        buyer_lastname:   buyerObj.apellido,
        buyer_email:      buyerObj.email,
        buyer_phone:      String(buyerObj.telefono),
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

    const items = cartItemsArr.map(item => ({
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

    console.log(`💸 Transferencia orden #${order.id} — comprobante subido`);

    res.json({ ok: true, orderId: order.id });

  } catch (err) {
    console.error('❌ Error process-transfer:', err.message);
    res.status(500).json({ error: true, message: 'Error al procesar la transferencia.' });
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

app.post('/api/payway-session', async (req, res) => {
  const { amount, buyer } = req.body;
  const parsedAmount = Number(amount);

  if (!parsedAmount || parsedAmount <= 0 || !Number.isFinite(parsedAmount)) {
    return res.status(400).json({ error: true, message: 'Monto inválido' });
  }
  if (!buyer?.email) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const baseUrl = isProd
    ? 'https://payway.com.ar'
    : 'https://developers.payway.com.ar';

  try {
    const response = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PAYWAY_PRIVATE_KEY}`,
      },
      body: JSON.stringify({
        site_id: process.env.PAYWAY_SITE_ID,
        amount: parsedAmount,
        currency: 'ARS',
        email: buyer.email,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ PayWay session error:', errText);
      return res.status(502).json({ error: true, message: 'Error al crear sesión de pago.' });
    }

    const data = await response.json();
    console.log('🔑 PayWay session creada OK');

    res.json({ sessionToken: data.session_token || data.token });
  } catch (err) {
    console.error('❌ Error payway-session:', err.message);
    res.status(500).json({ error: true, message: 'Error de conexión con PayWay.' });
  }
});

app.post('/api/payway-verify', async (req, res) => {
  const { paymentId, buyer, address, addressComponents, notes, cartItems, addressType, piso, letra, amount } = req.body;

  if (!paymentId || !buyer || !cartItems) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const baseUrl = isProd
    ? 'https://payway.com.ar'
    : 'https://developers.payway.com.ar';

  try {
    let status = 'unknown';
    let statusDetail = '';

    const response = await fetch(`${baseUrl}/api/payment/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${process.env.PAYWAY_PRIVATE_KEY}` },
    });

    if (response.ok) {
      const data = await response.json();
      status = data.status || 'unknown';
      statusDetail = data.status_detail || data.reason || '';
      console.log(`✅ PayWay pago ${paymentId} — ${status}`);
    } else {
      console.error(`⚠️ PayWay verify no-ok (${response.status}), usando status del callback`);
      status = req.body.status || 'unknown';
    }

    const addr = {
      display:      address || '',
      calle:        addressComponents?.road
                      ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}`
                      : '',
      barrio:       addressComponents?.suburb || addressComponents?.neighbourhood || '',
      ciudad:       addressComponents?.city || '',
      codigoPostal: addressComponents?.postcode || '',
      notes:        notes || '',
      tipo:         addressType || '',
      piso:         piso || '',
      letra:        letra || '',
    };

    const parsedAmount = Math.round(Number(amount));

    // Save order in Supabase (fire and forget)
    const saveOrder = async () => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          mp_payment_id:    paymentId.toString(),
          status,
          status_detail:    statusDetail,
          total:            parsedAmount,
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

      console.log(`💾 Orden PayWay guardada [${status}]`);
    };

    saveOrder().catch(err => console.error('Error guardando orden:', err.message));

    sendOrderEmails({
      buyer,
      addr,
      cartItems,
      total:        parsedAmount,
      orderId:      paymentId,
      status,
      statusDetail,
    }).catch(err => console.error('Error enviando emails:', err.message));

    res.json({ status, id: paymentId, detail: statusDetail });

  } catch (err) {
    console.error('❌ Error payway-verify:', err.message);
    res.status(500).json({ error: true, message: 'Error al verificar el pago.' });
  }
});

app.post('/api/webhook-payway', async (req, res) => {
  try {
    const { payment_id, status } = req.body;

    if (payment_id && status) {
      console.log(`🔔 Webhook PayWay: Payment ${payment_id} → ${status}`);
      await supabase
        .from('orders')
        .update({ status })
        .eq('mp_payment_id', payment_id.toString());
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error webhook PayWay:', err.message);
    res.json({ ok: true }); // Always 200 so PayWay doesn't retry
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor Azter escuchando en http://localhost:${PORT}`);
});