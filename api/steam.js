export default async function handler(req, res) {
  const { url } = req.query;
  if (!url || !url.includes('steamcommunity.com/')) {
    return res.status(400).json({ error: 'URL de Steam inválida' });
  }

  try {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    const xmlUrl = `${cleanUrl}/?xml=1`;

    const response = await fetch(xmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const xml = await response.text();

    const nameMatch =
      xml.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/i) ||
      xml.match(/<steamID>([\s\S]*?)<\/steamID>/i);

    const avatarMatch =
      xml.match(/<avatarFull><!\[CDATA\[([\s\S]*?)\]\]><\/avatarFull>/i) ||
      xml.match(/<avatarFull>([\s\S]*?)<\/avatarFull>/i);

    const steamName = nameMatch ? nameMatch[1].trim() : null;
    const avatarUrl = avatarMatch ? avatarMatch[1].trim() : null;

    if (steamName || avatarUrl) {
      return res.status(200).json({ steamName, avatarUrl });
    }

    return res.status(404).json({ error: 'No se pudo leer el perfil' });
  } catch (error) {
    return res.status(500).json({ error: 'Error conectando con Steam' });
  }
}