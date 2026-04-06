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
  const { formData, buyer, address, addressComponents, notes, cartItems } = req.body;

  if (!formData || !buyer || !cartItems) {
    return res.status(400).json({ error: true, message: 'Datos incompletos' });
  }

  try {
    const paymentClient = new Payment(client);

    const body = {
        transaction_amount: Number(formData.transaction_amount),
        token: formData.token,
        description: 'Compra Azter',
        installments: Number(formData.installments) || 1,
        payment_method_id: formData.payment_method_id,
        payer: {
          email: formData.payer?.email || buyer.email,
          identification: {
            type: formData.payer?.identification?.type || 'DNI',
            number: formData.payer?.identification?.number || '12345678',
          },
        },
      };

    // Pagos con tarjeta requieren token e installments
    if (formData.issuer_id) {
        body.issuer_id = formData.issuer_id;
      }

    const result = await paymentClient.create({
      body,
      requestOptions: { idempotencyKey: `${buyer.email}-${Date.now()}` },
    });

    console.log(`Pago ${result.id} — ${result.status} (${result.status_detail})`);

    if (result.status === 'approved' || result.status === 'pending') {
      const addr = {
        display:      address || '',
        calle:        addressComponents?.road ? `${addressComponents.road}${addressComponents.house_number ? ' ' + addressComponents.house_number : ''}` : '',
        barrio:       addressComponents?.suburb || addressComponents?.neighbourhood || addressComponents?.city_district || '',
        ciudad:       addressComponents?.city || addressComponents?.town || addressComponents?.village || '',
        codigoPostal: addressComponents?.postcode || '',
        notes:        notes || '',
      };

      if (result.status === 'approved') {
        sendOrderEmails({ buyer, addr, cartItems, total: result.transaction_amount, orderId: result.id })
          .catch(err => console.error('Error enviando emails:', err.message));
      }

      const saveOrder = async () => {
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            mp_payment_id:   result.id,
            status:          result.status,
            status_detail:   result.status_detail,
            total:           Math.round(result.transaction_amount),
            buyer_name:      buyer.nombre,
            buyer_lastname:  buyer.apellido,
            buyer_email:     buyer.email,
            buyer_phone:     String(buyer.telefono),
            address_display: address || '',
            address_street:  addr.calle,
            address_barrio:  addr.barrio,
            address_city:    addr.ciudad,
            address_postcode:addr.codigoPostal,
            address_notes:   notes || '',
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

        console.log(`Orden #${order.id} guardada en DB (MP: ${result.id})`);
      };

      saveOrder().catch(err => console.error('Error guardando orden en DB:', err.message));
    }

    res.json({
      status: result.status,
      id: result.id,
      detail: result.status_detail,
    });
  } catch (err) {
    console.error('Error MP:', err?.cause ?? err.message);
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

app.listen(PORT, () => {
  console.log(`Servidor Azter escuchando en http://localhost:${PORT}`);
});
