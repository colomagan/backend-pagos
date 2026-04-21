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

app.listen(PORT, () => {
  console.log(`✅ Servidor Azter escuchando en http://localhost:${PORT}`);
});