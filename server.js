const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/process-payment', (req, res) => {
  console.log('Pago recibido:', req.body);

  // Simulación de pago OK
  res.json({
    success: true,
    message: 'Pago procesado correctamente'
  });
});

app.get('/', (req, res) => {
  res.send('Servidor funcionando 🚀');
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});