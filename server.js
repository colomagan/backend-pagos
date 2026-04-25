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

app.post('/api/payway-payment', async (req, res) => {
  const { token, bin, paymentMethodId, amount, buyer, address, addressComponents, notes, cartItems, addressType, piso, letra, deviceUniqueId } = req.body;

  console.log('BACK deviceUniqueId (recibido):', deviceUniqueId);

  if (!token || !amount || !buyer?.email || !Array.isArray(cartItems)) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  if (!deviceUniqueId) {
    console.error('BACK ERROR: deviceUniqueId ausente — no se puede procesar sin fingerprint');
    return res.status(400).json({ error: true, message: 'Falta device fingerprint ID' });
  }

  const parsedAmount = Math.round(Number(amount));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: true, message: 'Monto inválido' });
  }

  const isProduction = process.env.PAYWAY_ENV === 'production';
  const baseUrl = isProduction
    ? 'https://live.decidir.com/api/v2'
    : 'https://developers.decidir.com/api/v2';

  const siteTransactionId = `AZTER-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  /** CyberSource / Decidir: sin ^ ni :; máx ~255 */
  const csText = (v, fallback = 'Producto') => {
    const s = v != null && String(v).trim() ? String(v).trim() : fallback;
    return s.replace(/[\^:]/g, ' ').slice(0, 255);
  };

  const retailItems = (Array.isArray(cartItems) && cartItems.length > 0
    ? cartItems
    : [{ id: 0, title: 'Compra', subtitle: '', price: parsedAmount, quantity: 1, cartId: siteTransactionId }]
  ).map((item, idx) => {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const unitPesos = Math.round(Number(item.price) || 0);
    const unitCents = unitPesos * 100;
    const desc = csText([item.title, item.subtitle].filter(Boolean).join(' — '));
    return {
      code: 'Apparel',
      description: desc,
      name: csText(item.title),
      sku: csText(
        item.cartId != null && String(item.cartId)
          ? String(item.cartId)
          : (item.id != null ? `${item.id}-${idx}` : `item-${idx}`),
        'SKU',
      ),
      quantity: qty,
      unit_price: unitCents,
      total_amount: unitCents * qty,
    };
  });

  try {
    const decidirBody = {
      site_transaction_id: siteTransactionId,
      token,
      payment_method_id: paymentMethodId || 1,
      bin: bin || '',
      amount: parsedAmount * 100,
      currency: 'ARS',
      installments: 1,
      payment_type: 'single',
      email: buyer.email,
  
      sub_payments: [],
  
      fraud_detection: {
        send_to_cs: true,
        channel: 'Web',

        device_fingerprint_id: deviceUniqueId,
        
        customer_in_site: {
          days_in_site: 0,
          is_guest: true,
          password: '',
          num_of_transactions: 1,
          cellphone_number: buyer.telefono
            ? String(buyer.telefono).replace(/\D/g, '')
            : '5491100000001',
          email: buyer.email,
        },
  
        bill_to: {
          city:
            addressComponents?.city ||
            addressComponents?.town ||
            addressComponents?.municipality ||
            'Buenos Aires',
  
          country: 'AR',
          customer_id: buyer.email,
          email: buyer.email,
          first_name: buyer.nombre || 'Sin',
          last_name: buyer.apellido || 'Nombre',
  
          phone_number: buyer.telefono
            ? String(buyer.telefono).replace(/\D/g, '')
            : '5491100000001',
  
          postal_code: addressComponents?.postcode || '1000',
          state: 'B',
  
          street1: addressComponents?.road
            ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}`
            : address || 'Sin direccion',
        },
  
        purchase_totals: {
          currency: 'ARS',
          amount: parsedAmount * 100,
        },
  
        retail_transaction_data: {
          ship_to: {
            city:
              addressComponents?.city ||
              addressComponents?.town ||
              addressComponents?.municipality ||
              'Buenos Aires',
  
            country: 'AR',
            customer_id: buyer.email,
            email: buyer.email,
            first_name: buyer.nombre || 'Sin',
            last_name: buyer.apellido || 'Nombre',
  
            phone_number: buyer.telefono
              ? String(buyer.telefono).replace(/\D/g, '')
              : '5491100000001',
  
            postal_code: addressComponents?.postcode || '1000',
            state: 'B',
  
            street1: addressComponents?.road
              ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}`
              : address || 'Sin direccion',
          },
  
          days_to_delivery: '3',
          dispatch_method: 'homedelivery',
          tax_voucher_required: false,
          customer_loyalty_number: '',
          coupon_code: '',
          items: retailItems,
        },
      },
    };
  
    console.log('📤 Decidir request:', JSON.stringify(decidirBody, null, 2));
  
    const decidirRes = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.PAYWAY_PRIVATE_KEY,
      },
      body: JSON.stringify(decidirBody),
    });
  
    const rawText = await decidirRes.text();
    console.log(`📥 Decidir HTTP ${decidirRes.status}:`, rawText);
  
    let decidirData = {};
    try {
      decidirData = JSON.parse(rawText);
    } catch (e) {
      console.error('❌ JSON inválido de Decidir:', rawText);
    }
  
    const status = decidirData.status || 'rejected';
    const statusDetail = decidirData.status_detail || '';
    const decidirPaymentId =
      typeof decidirData.id === 'number' ? decidirData.id : null;
  
    console.log(`💳 Decidir ${decidirPaymentId} → ${status} (${statusDetail})`);
  
    // ─────────────────────────────────────────────
    // ADDRESS NORMALIZADO
    // ─────────────────────────────────────────────
  
    const addr = {
      display: address || '',
      calle: addressComponents?.road
        ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}`
        : '',
      barrio:
        addressComponents?.suburb ||
        addressComponents?.neighbourhood ||
        '',
      ciudad: addressComponents?.city || '',
      codigoPostal: addressComponents?.postcode || '',
    };
  
    let internalOrderId = null;
  
    // ─────────────────────────────────────────────
    // GUARDAR SOLO SI NO ES RECHAZADO
    // ─────────────────────────────────────────────
  
    if (status !== 'rejected') {
      try {
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            ...(decidirPaymentId
              ? { mp_payment_id: decidirPaymentId }
              : {}),
  
            payment_method: 'tarjeta',
            status,
            status_detail: statusDetail,
            total: parsedAmount,
  
            buyer_name: buyer.nombre,
            buyer_lastname: buyer.apellido,
            buyer_email: buyer.email,
            buyer_phone: buyer.telefono
              ? String(buyer.telefono)
              : null,
  
            address_display: address || '',
            address_street: addr.calle,
            address_barrio: addr.barrio,
            address_city: addr.ciudad,
            address_postcode: addr.codigoPostal,
  
            address_notes: notes || '',
            address_type: addressType || null,
            address_piso: piso || null,
            address_letra: letra || null,
          })
          .select('id')
          .single();
  
        if (orderError) throw orderError;
  
        const items = cartItems.map((item) => ({
          order_id: order.id,
          product_id: item.id,
          title: item.title,
          subtitle: item.subtitle || null,
          color_name: item.color?.name || null,
          color_value: item.color?.value || null,
          size: item.size || null,
          quantity: item.quantity,
          unit_price: item.price,
        }));
  
        const { error: itemsError } = await supabase
          .from('order_items')
          .insert(items);
  
        if (itemsError) throw itemsError;
  
        internalOrderId = order.id;
  
        console.log(`💾 Orden #${internalOrderId} guardada [${status}]`);
      } catch (err) {
        console.error('❌ Error guardando orden:', err.message);
      }
    }
  
    // ─────────────────────────────────────────────
    // EMAILS
    // ─────────────────────────────────────────────
  
    if (
      status === 'approved' ||
      status === 'pending' ||
      status === 'in_process'
    ) {
      sendOrderEmails({
        buyer,
        addr: {
          ...addr,
          notes: notes || '',
          tipo: addressType || '',
          piso: piso || '',
          letra: letra || '',
        },
        cartItems,
        total: parsedAmount,
        orderId: internalOrderId || siteTransactionId,
        status,
        statusDetail,
      }).catch((err) =>
        console.error('❌ Error enviando emails:', err.message)
      );
    }
  
    // ─────────────────────────────────────────────
    // RESPONSE FINAL
    // ─────────────────────────────────────────────
  
    res.json({
      status,
      id: internalOrderId || decidirPaymentId,
      detail: statusDetail,
    });
  
  } catch (err) {
    console.error('❌ Error payway-payment:', err.message);
    res.status(500).json({
      error: true,
      message: 'Error al procesar el pago.',
    });
  }
});

app.post('/api/webhook-payway', async (req, res) => {
  // Validate webhook secret if configured
  const webhookSecret = process.env.PAYWAY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedSecret = req.headers['x-payway-secret'] || req.headers['x-webhook-secret'];
    if (receivedSecret !== webhookSecret) {
      console.warn('⚠️ Webhook PayWay: secret inválido');
      return res.status(401).json({ ok: false });
    }
  }

  try {
    const { payment_id, status } = req.body;

    if (payment_id && status) {
      console.log(`🔔 Webhook PayWay: Payment ${payment_id} → ${status}`);
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status })
        .eq('mp_payment_id', payment_id.toString());
      if (updateError) console.error('❌ Error actualizando orden en webhook:', updateError.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error webhook PayWay:', err.message);
    res.json({ ok: true }); // Always 200 so PayWay doesn't retry
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor Azter escuchando en http://localhost:${PORT}`);
  if (!process.env.PAYWAY_WEBHOOK_SECRET) {
    console.warn('⚠️  PAYWAY_WEBHOOK_SECRET no configurado — el webhook de PayWay no está autenticado');
  }
});