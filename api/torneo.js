// Archivo: api/torneo.js
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SERVER_ADMIN_PIN = process.env.ADMIN_PASSWORD;

  // Si aún no has configurado Supabase en Vercel, avisa limpiamente
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({
      error: 'Base de datos no conectada aún en las Variables de Entorno de Vercel.'
    });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    // 1. LEER ESTADO DEL TORNEO (PÚBLICO PARA TODOS TUS AMIGOS)
    if (req.method === 'GET') {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/torneo_state?id=eq.1&select=data`, {
        method: 'GET',
        headers
      });
      const rows = await response.json();
      const currentData = rows && rows[0] ? rows[0].data : {};
      return res.status(200).json(currentData);
    }

    // 2. VERIFICAR CONTRASEÑA DE ADMIN O GUARDAR DATOS
    if (req.method === 'POST') {
      const { action, pin, payload } = req.body || {};

      // A) Solo verificar si el PIN ingresado es correcto
      if (action === 'verify_admin') {
        if (!SERVER_ADMIN_PIN) {
          return res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en Vercel' });
        }
        if (pin === SERVER_ADMIN_PIN) {
          return res.status(200).json({ ok: true });
        }
        return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
      }

      // Obtener estado actual de la base de datos
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/torneo_state?id=eq.1&select=data`, {
        method: 'GET',
        headers
      });
      const rows = await getRes.json();
      const currentData = (rows && rows[0] && rows[0].data) ? rows[0].data : {};

      // B) Inscripción pública de un jugador en un cupo libre (no requiere clave de Admin)
      if (action === 'register_slot') {
        const { slotNumber, playerObj, maxPlayers } = payload;
        let slots = Array.isArray(currentData.slots) ? currentData.slots : [];

        // Si la base de datos estaba vacía, inicializa los cupos
        if (slots.length === 0) {
          const total = Number(maxPlayers) || 8;
          slots = Array.from({ length: total }, (_, i) => ({
            slotNumber: i + 1,
            occupied: false,
            name: `Cupo #${String(i + 1).padStart(2, '0')}`,
            steamName: 'Sin vincular',
            avatarUrl: '',
            steamUrl: ''
          }));
        }

        const target = slots.find(s => s.slotNumber === slotNumber);
        if (!target || target.occupied) {
          return res.status(409).json({ error: 'Ese cupo ya fue ocupado por otra persona.' });
        }

        currentData.slots = slots.map(s =>
          s.slotNumber === slotNumber ? { ...s, ...playerObj, occupied: true } : s
        );

        await fetch(`${SUPABASE_URL}/rest/v1/torneo_state?id=eq.1`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ data: currentData })
        });

        return res.status(200).json({ ok: true, state: currentData });
      }

      // C) Guardar cambios de Administrador (EXIGE CONTRASEÑA REAL DEL SERVIDOR)
      if (action === 'admin_save') {
        if (!SERVER_ADMIN_PIN || pin !== SERVER_ADMIN_PIN) {
          return res.status(401).json({ error: 'No autorizado. Clave de Admin inválida.' });
        }

        const nextData = { ...currentData, ...payload };

        await fetch(`${SUPABASE_URL}/rest/v1/torneo_state?id=eq.1`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ data: nextData })
        });

        return res.status(200).json({ ok: true, state: nextData });
      }

      return res.status(400).json({ error: 'Acción no reconocida' });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}