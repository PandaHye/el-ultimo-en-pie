const CONFIG_KEY = 'ultimo_en_pie_config_v14';
const STORAGE_KEY = 'ultimo_en_pie_slots_v14';
const MATCHES_KEY = 'ultimo_en_pie_matches_v14';
const PLAYOFFS_KEY = 'ultimo_en_pie_playoffs_v14';
const STAGE_PUBLIC_KEY = 'ultimo_en_pie_stage_public_v14';
const PLAYOFFS_PUBLIC_KEY = 'ultimo_en_pie_playoffs_public_v14';
const ADMIN_SESSION_KEY = 'ultimo_en_pie_is_admin';
const ADMIN_TOKEN_KEY = 'ultimo_en_pie_admin_token';

// CATÁLOGO DE CAMPAÑAS OFICIALES DE LEFT 4 DEAD 2
const L4D2_MAP_CATALOG = [
  { name: 'Dead Center', sub: 'Punto Muerto', icon: '🏙️' },
  { name: 'Dark Carnival', sub: 'Siniestra Feria', icon: '🎡' },
  { name: 'No Mercy', sub: 'Alta Médica', icon: '🏥' },
  { name: 'The Parish', sub: 'La Parroquia', icon: '🌉' },
  { name: 'Hard Rain', sub: 'El Diluvio', icon: '⛈️' },
  { name: 'Swamp Fever', sub: 'Pantanos', icon: '🐊' },
  { name: 'Dead Air', sub: 'Último Vuelo', icon: '✈️' },
  { name: 'The Passing', sub: 'El Paso', icon: '🎸' },
  { name: 'The Sacrifice', sub: 'El Sacrificio', icon: '🚢' },
  { name: 'Crash Course', sub: 'Terapia de Choque', icon: '🚛' },
  { name: 'Death Toll', sub: 'Toque de Difuntos', icon: '⛪' },
  { name: 'Blood Harvest', sub: 'Cosecha de Sangre', icon: '🌲' },
  { name: 'Cold Stream', sub: 'Aguas Turbulentas', icon: '🏞️' }
];

// REGLA DEL 50%: SIEMPRE CLASIFICA LA MITAD DE LOS CUPOS
function getPlayoffSpotsCount(maxPlayers) {
  const n = Number(maxPlayers) || 8;
  return Math.max(2, Math.floor(n / 2));
}

function getDefaultConfig() {
  const defaultMaps = {};
  for (let r = 1; r <= 31; r++) {
    defaultMaps[r] = L4D2_MAP_CATALOG[(r - 1) % L4D2_MAP_CATALOG.length];
  }
  return {
    maxPlayers: 8,
    pointsPerWin: 3,
    playoffSpots: 4,
    title: 'EL ÚLTIMO EN PIE',
    subtitle: 'L4D2 1V1 · ZONEMOD',
    heroTag: '● TORNEO POR PANDA ●',
    heroDesc: 'Versus 1 vs 1 en ZoneMod. Cada jornada se juega durante 1 semana en formato Todos contra Todos y clasifica exactamente la mitad de los jugadores a los Playoffs.',
    roundMaps: defaultMaps
  };
}

function getConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) {
    const def = getDefaultConfig();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(def));
    return def;
  }
  const parsed = JSON.parse(raw);
  const merged = { ...getDefaultConfig(), ...parsed };
  merged.playoffSpots = getPlayoffSpotsCount(merged.maxPlayers);
  return merged;
}

function saveConfig(cfg, skipCloud = false) {
  cfg.playoffSpots = getPlayoffSpotsCount(cfg.maxPlayers);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  if (!skipCloud) pushAdminStateToCloud();
}

function getTotalRounds(maxPlayers) {
  const n = Number(maxPlayers) || 8;
  return n % 2 === 0 ? n - 1 : n;
}

function getMapForRound(roundNumber) {
  const cfg = getConfig();
  return cfg.roundMaps?.[roundNumber] || L4D2_MAP_CATALOG[(roundNumber - 1) % L4D2_MAP_CATALOG.length];
}

let activeRound = 1;

// 1. SINCRONIZACIÓN CON LA BASE DE DATOS EN VERCEL / SUPABASE (/api/torneo)
async function syncFromCloudDatabase() {
  try {
    const res = await fetch('/api/torneo');
    if (!res.ok) {
      console.warn('[cloud] Sync returned', res.status, '— usando localStorage. Revisa env vars en Vercel.');
      return;
    }
    const cloud = await res.json();
    if (!cloud || typeof cloud !== 'object' || Object.keys(cloud).length === 0) {
      console.warn('[cloud] Estado vacío en Supabase. La tabla está inicializada pero sin datos.');
      return;
    }

    if (cloud.config) localStorage.setItem(CONFIG_KEY, JSON.stringify(cloud.config));
    if (Array.isArray(cloud.slots)) localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud.slots));
    if (Array.isArray(cloud.matches)) localStorage.setItem(MATCHES_KEY, JSON.stringify(cloud.matches));
    if (cloud.playoffs) localStorage.setItem(PLAYOFFS_KEY, JSON.stringify(cloud.playoffs));
    if (typeof cloud.stagePublic === 'boolean') {
      localStorage.setItem(STAGE_PUBLIC_KEY, cloud.stagePublic ? 'true' : 'false');
    }
    if (typeof cloud.playoffsPublic === 'boolean') {
      localStorage.setItem(PLAYOFFS_PUBLIC_KEY, cloud.playoffsPublic ? 'true' : 'false');
    }

    applyGlobalSiteConfig();
    renderSlots();
    applyAdminUI();
  } catch (e) {
    console.warn('[cloud] Sync failed:', e.message);
  } finally {
    // Quita el "velo" de carga SIEMPRE, con éxito o con error
    document.body.classList.add('data-ready');
  }
}

let lastPushErrorTime = 0;

async function pushAdminStateToCloud() {
  const pin = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!isAdmin() || !pin) return { ok: false, reason: 'not_admin' };

  const payload = {
    config: getConfig(),
    slots: getSlots(),
    matches: getMatches(),
    playoffs: getPlayoffWinnersMap(),
    stagePublic: isStagePublic(),
    playoffsPublic: isPlayoffsForcedByAdmin()
  };

  try {
    const res = await fetch('/api/torneo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'admin_save', pin, payload })
    });

    if (res.ok) {
      lastPushErrorTime = 0;
      return { ok: true };
    }

    if (res.status === 401) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      applyAdminUI();
      alert('⚠️ Tu sesión de admin expiró. Vuelve a iniciar sesión.');
      return { ok: false, reason: 'expired' };
    }

    console.warn('[cloud] Save failed:', res.status);
    if (Date.now() - lastPushErrorTime > 10000) {
      lastPushErrorTime = Date.now();
      alert('⚠️ Los cambios se guardaron SOLO en este navegador. La base de datos no respondió. Recarga e intenta de nuevo.');
    }
    return { ok: false, reason: 'server' };
  } catch (e) {
    console.warn('[cloud] Network error:', e.message);
    if (Date.now() - lastPushErrorTime > 10000) {
      lastPushErrorTime = Date.now();
      alert('⚠️ Sin conexión al servidor. Los cambios se guardaron SOLO en este navegador.');
    }
    return { ok: false, reason: 'offline' };
  }
}

async function registerSlotInCloud(slotNumber, playerObj) {
  try {
    const res = await fetch('/api/torneo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register_slot',
        payload: {
          slotNumber,
          maxPlayers: getConfig().maxPlayers,
          playerObj
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.state && Array.isArray(data.state.slots)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state.slots));
      }
      return { ok: true };
    }

    if (res.status === 409) {
      const errData = await res.json();
      return { ok: false, conflict: true, message: errData.error };
    }

    // El servidor respondió pero falló (500, 503...) → avisa y NO marques local
    console.warn('[cloud] register_slot failed:', res.status);
    return {
      ok: false,
      serverError: true,
      message: 'No se pudo guardar el cupo en el servidor. Intenta de nuevo en unos segundos.'
    };
  } catch (e) {
    // Error de red = probablemente estás probando en local sin Vercel.
    // Permite registrar localmente para poder testear la UI.
    console.warn('[cloud] Network error (modo local):', e.message);
    return { ok: true, offline: true };
  }
}

// 2. ACTUALIZAR TEXTOS DINÁMICOS EN TODAS LAS PÁGINAS
function applyGlobalSiteConfig() {
  const cfg = getConfig();
  const totalRounds = getTotalRounds(cfg.maxPlayers);
  const halfSpots = getPlayoffSpotsCount(cfg.maxPlayers);
  const duelsPerRound = Math.floor(cfg.maxPlayers / 2);
  const totalMatches = (cfg.maxPlayers * (cfg.maxPlayers - 1)) / 2;

  document.querySelectorAll('.dyn-title, .brand-info strong').forEach(el => {
    el.textContent = cfg.title;
  });
  document.querySelectorAll('.dyn-subtitle, .brand-info span').forEach(el => {
    el.textContent = cfg.subtitle;
  });
  document.querySelectorAll('.dyn-nav-slots').forEach(el => {
    el.textContent = `Cupos (${cfg.maxPlayers})`;
  });

  // Inicio (index.html)
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroDesc = document.getElementById('heroDesc');
  const statMaxPlayers = document.getElementById('statMaxPlayers');
  const statTotalRounds = document.getElementById('statTotalRounds');
  const statPlayoffSpots = document.getElementById('statPlayoffSpots');

  if (heroEyebrow) heroEyebrow.textContent = `${cfg.heroTag} · ${cfg.maxPlayers} CUPOS`;
  if (heroDesc) heroDesc.textContent = cfg.heroDesc;
  if (statMaxPlayers) statMaxPlayers.textContent = `${cfg.maxPlayers} CUPOS`;
  if (statTotalRounds) statTotalRounds.textContent = `${totalRounds} SEMANAS`;
  if (statPlayoffSpots) statPlayoffSpots.textContent = `PASAN ${halfSpots} (50%)`;

  // Reglamento Oficial (informacion.html)
  const metaScheduleText = document.getElementById('metaScheduleText');
  const metaPlayersAndCut = document.getElementById('metaPlayersAndCut');
  const infoStep1Desc = document.getElementById('infoStep1Desc');
  const infoStep2Desc = document.getElementById('infoStep2Desc');
  const infoWeeklyRuleText = document.getElementById('infoWeeklyRuleText');
  const infoPointsRuleText = document.getElementById('infoPointsRuleText');

  if (metaScheduleText) {
    metaScheduleText.textContent = `${totalRounds} Jornadas (1 por Semana)`;
  }
  if (metaPlayersAndCut) {
    metaPlayersAndCut.textContent = `${cfg.maxPlayers} Jugadores → Pasan ${halfSpots}`;
  }
  if (infoStep1Desc) {
    infoStep1Desc.innerHTML = `Los <strong>${cfg.maxPlayers} participantes</strong> competirán individualmente (1 vs 1) todos contra todos a lo largo de <strong>${totalRounds} jornadas (${totalRounds} semanas)</strong>, jugando ${duelsPerRound} duelos por semana.`;
  }
  if (infoStep2Desc) {
    infoStep2Desc.innerHTML = `<strong>Clasificación de la Mitad (50%):</strong> Al concluir las ${totalRounds} semanas, clasifican los <strong>${halfSpots} mejores jugadores</strong> (de ${cfg.maxPlayers} cupos) a los Playoffs. Del puesto #${halfSpots + 1} al #${cfg.maxPlayers} quedan eliminados.`;
  }
  if (infoWeeklyRuleText) {
    infoWeeklyRuleText.innerHTML = `<strong>Ritmo Semanal (1 Jornada = 1 Semana):</strong> La Jornada 1 se juega durante la Semana 1, la Jornada 2 en la Semana 2 y así sucesivamente hasta completar las ${totalRounds} semanas.`;
  }
  if (infoPointsRuleText) {
    infoPointsRuleText.innerHTML = `<strong>Sistema de Puntos:</strong> Cada victoria suma <strong>+${cfg.pointsPerWin} puntos</strong> en la tabla general y se registra el marcador exacto de cada duelo para desempatar por Diferencia de Puntos (DIF).`;
  }

  // Participantes (participantes.html)
  const participantsPageTitle = document.getElementById('participantsPageTitle');
  if (participantsPageTitle) {
    participantsPageTitle.textContent = `Estado de los ${cfg.maxPlayers} Cupos`;
  }

  // Liga & Playoffs (bracket.html)
  const scheduleTotalDuelsTag = document.getElementById('scheduleTotalDuelsTag');
  const scheduleMainTitle = document.getElementById('scheduleMainTitle');
  const standingsMainTitle = document.getElementById('standingsMainTitle');
  const lockedPlayoffsTitle = document.getElementById('lockedPlayoffsTitle');
  const lockedViewSlotsBtn = document.getElementById('lockedViewSlotsBtn');

  if (scheduleTotalDuelsTag) {
    scheduleTotalDuelsTag.textContent = `ROL DE JUEGOS · 1 JORNADA POR SEMANA (${totalMatches} DUELOS EN TOTAL)`;
  }
  if (scheduleMainTitle) {
    scheduleMainTitle.textContent = `Calendario Todos contra Todos (${totalRounds} Semanas)`;
  }
  if (standingsMainTitle) {
    standingsMainTitle.textContent = `Tabla General (Pasan ${halfSpots} de ${cfg.maxPlayers} a Playoffs)`;
  }
  if (lockedPlayoffsTitle) {
    lockedPlayoffsTitle.textContent = `Playoffs Bloqueados hasta finalizar las ${totalRounds} Semanas`;
  }
  if (lockedViewSlotsBtn) {
    lockedViewSlotsBtn.textContent = `Ver los ${cfg.maxPlayers} Cupos`;
  }
}

// 3. CONTROL DE ROL DE ADMINISTRADOR (VALIDADO EN EL SERVIDOR DE VERCEL)
function isAdmin() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

function applyAdminUI() {
  const active = isAdmin();
  document.body.classList.toggle('is-admin', active);
  const btn = document.getElementById('adminToggleBtn');
  if (btn) {
    btn.textContent = active ? '🔓 Admin Activo (Salir)' : '🔒 Admin';
  }
  if (typeof checkBracketLockState === 'function') {
    checkBracketLockState();
  }
  if (typeof renderAdminPanel === 'function') {
    renderAdminPanel();
  }
}

const adminBtn = document.getElementById('adminToggleBtn');
if (adminBtn) {
  adminBtn.addEventListener('click', async () => {
    if (isAdmin()) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      applyAdminUI();
      return;
    }

    const inputPin = prompt('Ingresa la clave de Administrador:');
    if (inputPin === null || !inputPin.trim()) return;
    const cleanPin = inputPin.trim();

    try {
      const res = await fetch('/api/torneo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_admin', pin: cleanPin })
      });

      if (res.ok) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
        sessionStorage.setItem(ADMIN_TOKEN_KEY, cleanPin);
        applyAdminUI();
        return;
      }

      if (res.status === 401) {
        alert('❌ Clave incorrecta. Acceso denegado.');
        return;
      }

      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Falta configurar ADMIN_PASSWORD y SUPABASE en Vercel.');
    } catch (e) {
      alert('Para iniciar sesión como Admin de forma segura, despliega la web en Vercel y configura ADMIN_PASSWORD en Environment Variables.');
    }
  });
}

function getFallbackAvatar(seedName) {
  const encoded = encodeURIComponent(seedName || 'L4D2');
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encoded}&backgroundColor=1e1b2e,ff1e56`;
}

// 4. GESTIÓN DINÁMICA DE CUPOS
function createEmptySlots(count) {
  const total = count || getConfig().maxPlayers;
  return Array.from({ length: total }, (_, i) => ({
    slotNumber: i + 1,
    occupied: false,
    name: `Cupo #${String(i + 1).padStart(2, '0')}`,
    steamName: 'Sin vincular',
    avatarUrl: '',
    steamUrl: ''
  }));
}

function getSlots() {
  const cfg = getConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  let list = raw ? JSON.parse(raw) : createEmptySlots(cfg.maxPlayers);

  if (list.length !== cfg.maxPlayers) {
    const resized = [];
    for (let i = 1; i <= cfg.maxPlayers; i++) {
      const existing = list.find(s => s.slotNumber === i);
      if (existing) {
        resized.push(existing);
      } else {
        resized.push({
          slotNumber: i,
          occupied: false,
          name: `Cupo #${String(i).padStart(2, '0')}`,
          steamName: 'Sin vincular',
          avatarUrl: '',
          steamUrl: ''
        });
      }
    }
    list = resized;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  return list;
}

function saveSlots(slots, skipCloud = false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  if (!skipCloud) pushAdminStateToCloud();
}

function normalizeSteamProfileUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const cleanPath = u.pathname.replace(/\/+$/, '');
    return `https://steamcommunity.com${cleanPath}`;
  } catch (e) {
    return rawUrl.trim().replace(/\/+$/, '');
  }
}

// 5. EXTRACCIÓN DE FOTO Y NOMBRE PÚBLICO DE STEAM (/api/steam + Respaldo PlayerDB)
async function fetchSteamProfileData(steamUrl, fallbackNickname) {
  const cleanUrl = normalizeSteamProfileUrl(steamUrl);

  try {
    const res = await fetch(`/api/steam?url=${encodeURIComponent(cleanUrl)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.steamName || data.avatarUrl) {
        return {
          steamName: data.steamName || fallbackNickname || 'Jugador Steam',
          avatarUrl: data.avatarUrl || getFallbackAvatar(data.steamName || fallbackNickname)
        };
      }
    }
  } catch (e) {}

  try {
    const parts = cleanUrl.split('/');
    const steamIdentifier = decodeURIComponent(parts[parts.length - 1] || '');
    if (steamIdentifier) {
      const pdbRes = await fetch(`https://playerdb.co/api/player/steam/${encodeURIComponent(steamIdentifier)}`);
      if (pdbRes.ok) {
        const pdbJson = await pdbRes.json();
        const player = pdbJson?.data?.player;
        if (player && (player.username || player.avatar)) {
          return {
            steamName: player.username || fallbackNickname || 'Jugador Steam',
            avatarUrl: player.avatar || getFallbackAvatar(player.username || fallbackNickname)
          };
        }
      }
    }
  } catch (e) {}

  const finalName = fallbackNickname || 'Jugador Steam';
  return {
    steamName: finalName,
    avatarUrl: getFallbackAvatar(finalName)
  };
}

function renderPlayerIdentityHTML(slot, seedPrefix = '') {
  if (!slot) return `<span style="color:var(--text-muted); font-size:14px;">${seedPrefix ? `<b class="slot-seed">${seedPrefix}</b>` : ''}Esperando ganador...</span>`;
  const avatar = slot.avatarUrl || getFallbackAvatar(slot.name);
  const fallbackImg = getFallbackAvatar(slot.name);
  const subSteam = slot.occupied ? `${slot.steamName}` : 'Cupo disponible';

  return `
    <div class="mini-identity">
      <img class="mini-avatar" src="${avatar}" alt="${slot.name}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallbackImg}';">
      <div class="identity-text">
        <span class="identity-nick">${seedPrefix ? `<b class="slot-seed">${seedPrefix}</b>` : ''}${slot.name}</span>
        <span class="identity-steam">${subSteam}</span>
      </div>
    </div>
  `;
}

// 6. ALGORITMO DINÁMICO DE BERGER PARA N JUGADORES (1 JORNADA = 1 SEMANA)
function generateRoundRobinSchedule(customCount) {
  const cfg = getConfig();
  const numPlayers = Number(customCount || cfg.maxPlayers) || 8;

  const teams = [];
  for (let i = 1; i <= numPlayers; i++) teams.push(i);
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const totalRounds = teams.length - 1;
  const half = teams.length / 2;
  const matches = [];
  let matchId = 1;

  for (let round = 1; round <= totalRounds; round++) {
    const mapInfo = getMapForRound(round);
    let duelNum = 1;

    for (let i = 0; i < half; i++) {
      const t1 = teams[i];
      const t2 = teams[teams.length - 1 - i];

      if (t1 !== null && t2 !== null) {
        const slotA = round % 2 === 1 ? t1 : t2;
        const slotB = round % 2 === 1 ? t2 : t1;
        matches.push({
          id: matchId++,
          round,
          mapName: mapInfo.name,
          duelNumber: duelNum++,
          slotA,
          slotB,
          scoreA: null,
          scoreB: null,
          time: `Semana ${round} · Hora por definir`,
          winnerSlot: null
        });
      }
    }
    teams.splice(1, 0, teams.pop());
  }

  return matches;
}

function getMatches() {
  const cfg = getConfig();
  const expectedTotalMatches = (cfg.maxPlayers * (cfg.maxPlayers - 1)) / 2;
  const raw = localStorage.getItem(MATCHES_KEY);

  if (!raw) {
    const initial = generateRoundRobinSchedule(cfg.maxPlayers);
    localStorage.setItem(MATCHES_KEY, JSON.stringify(initial));
    return initial;
  }

  const parsed = JSON.parse(raw);
  if (parsed.length !== expectedTotalMatches) {
    const regenerated = generateRoundRobinSchedule(cfg.maxPlayers);
    localStorage.setItem(MATCHES_KEY, JSON.stringify(regenerated));
    return regenerated;
  }

  return parsed;
}

function saveMatches(matches, skipCloud = false) {
  localStorage.setItem(MATCHES_KEY, JSON.stringify(matches));
  if (!skipCloud) pushAdminStateToCloud();
}

function getCalculatedStandings() {
  const cfg = getConfig();
  const slots = getSlots();
  const matches = getMatches();

  const statsMap = {};
  slots.forEach(s => {
    statsMap[s.slotNumber] = {
      ...s,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0
    };
  });

  matches.forEach(m => {
    if (!statsMap[m.slotA] || !statsMap[m.slotB]) return;
    const sA = Number(m.scoreA) || 0;
    const sB = Number(m.scoreB) || 0;

    if (m.winnerSlot === m.slotA) {
      statsMap[m.slotA].wins += 1;
      statsMap[m.slotB].losses += 1;
      statsMap[m.slotA].pointsFor += sA;
      statsMap[m.slotA].pointsAgainst += sB;
      statsMap[m.slotB].pointsFor += sB;
      statsMap[m.slotB].pointsAgainst += sA;
    } else if (m.winnerSlot === m.slotB) {
      statsMap[m.slotB].wins += 1;
      statsMap[m.slotA].losses += 1;
      statsMap[m.slotB].pointsFor += sB;
      statsMap[m.slotB].pointsAgainst += sA;
      statsMap[m.slotA].pointsFor += sA;
      statsMap[m.slotA].pointsAgainst += sB;
    }
  });

  return Object.values(statsMap).sort((a, b) => {
    const ptsA = a.wins * cfg.pointsPerWin;
    const ptsB = b.wins * cfg.pointsPerWin;
    if (ptsB !== ptsA) return ptsB - ptsA;
    const scoreDiffA = a.pointsFor - a.pointsAgainst;
    const scoreDiffB = b.pointsFor - b.pointsAgainst;
    if (scoreDiffB !== scoreDiffA) return scoreDiffB - scoreDiffA;
    return a.slotNumber - b.slotNumber;
  });
}

// 7. PÁGINA DE PARTICIPANTES (participantes.html)
const playersListEl = document.getElementById('playersList');
const clearSlotsBtn = document.getElementById('clearSlotsBtn');

function renderSlots() {
  if (!playersListEl) return;
  const cfg = getConfig();
  const slots = getSlots();
  const occupiedCount = slots.filter(s => s.occupied).length;

  const counterEl = document.getElementById('slotCounter');
  if (counterEl) counterEl.textContent = `${occupiedCount} / ${cfg.maxPlayers} Cupos Ocupados`;

  playersListEl.innerHTML = '';

  slots.forEach(slot => {
    const padNum = String(slot.slotNumber).padStart(2, '0');
    const card = document.createElement('article');
    card.className = `esports-card player-card ${slot.occupied ? '' : 'empty-slot'}`;

    if (slot.occupied) {
      const avatar = slot.avatarUrl || getFallbackAvatar(slot.name);
      const fallbackImg = getFallbackAvatar(slot.name);
      card.innerHTML = `
        <span class="seed-badge">CUPO #${padNum}</span>
        <img class="avatar-img" src="${avatar}" alt="${slot.name}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallbackImg}';">
        <div class="player-meta">
          <h4>${slot.name}</h4>
          <span style="color:var(--steam-blue); font-weight:600;">${slot.steamName}</span>
          <div class="card-actions">
            <a class="steam-pill" href="${slot.steamUrl}" target="_blank" rel="noreferrer">
              🎮 Steam ↗
            </a>
            <button class="admin-mini-btn admin-only" onclick="editPlayerSlot(${slot.slotNumber})">✎ Editar</button>
            <button class="admin-mini-btn admin-only" onclick="freeSingleSlot(${slot.slotNumber})">✕</button>
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <span class="seed-badge">LIBRE</span>
        <div class="avatar-box" style="opacity:0.45;">${padNum}</div>
        <div class="player-meta">
          <h4>Cupo #${padNum} Disponible</h4>
          <span>Sin vincular</span>
          <div class="card-actions">
            <button type="button" class="steam-pill" id="quickBtn-${slot.slotNumber}" onclick="quickOccupySlot(${slot.slotNumber})">
              + Ocupar
            </button>
          </div>
        </div>
      `;
    }
    playersListEl.appendChild(card);
  });
}

window.quickOccupySlot = async function(slotNumber) {
  const padNum = String(slotNumber).padStart(2, '0');
  const steamUrlInput = prompt(`Pega el link de tu perfil de Steam para ocupar el Cupo #${padNum}:`);
  if (!steamUrlInput) return;

  if (!steamUrlInput.includes('steamcommunity.com/')) {
    alert('Por favor pega un link válido de Steam.');
    return;
  }

  const nickInput = prompt('Escribe tu Nickname para el torneo (o déjalo vacío para usar tu nombre de Steam):') || '';
  const btn = document.getElementById(`quickBtn-${slotNumber}`);
  if (btn) {
    btn.textContent = 'Sincronizando...';
    btn.disabled = true;
  }

  const cleanUrl = normalizeSteamProfileUrl(steamUrlInput);
  const steamData = await fetchSteamProfileData(cleanUrl, nickInput.trim());
  const finalNick = nickInput.trim() || steamData.steamName;

  const playerObj = {
    name: finalNick,
    steamName: steamData.steamName,
    avatarUrl: steamData.avatarUrl,
    steamUrl: cleanUrl
  };

  const cloudResult = await registerSlotInCloud(slotNumber, playerObj);
  if (cloudResult.conflict) {
    alert(cloudResult.message);
    await syncFromCloudDatabase();
    return;
  }
  if (cloudResult.serverError) {
    alert(cloudResult.message);
    const btn = document.getElementById(`quickBtn-${slotNumber}`);
    if (btn) { btn.textContent = '+ Ocupar'; btn.disabled = false; }
    return;
  }

  const updated = getSlots().map(s =>
    s.slotNumber === slotNumber ? { ...s, occupied: true, ...playerObj } : s
  );

  saveSlots(updated, true);
  renderSlots();
};

window.editPlayerSlot = function(slotNumber) {
  if (!isAdmin()) return;
  const slots = getSlots();
  const target = slots.find(s => s.slotNumber === slotNumber);
  if (!target) return;

  const newNick = prompt('Nickname principal del jugador:', target.name);
  if (newNick !== null && newNick.trim()) target.name = newNick.trim();

  const newSteamName = prompt('Nombre público en Steam:', target.steamName);
  if (newSteamName !== null && newSteamName.trim()) target.steamName = newSteamName.trim();

  const newAvatar = prompt('URL de la foto de perfil:', target.avatarUrl);
  if (newAvatar !== null && newAvatar.trim()) target.avatarUrl = newAvatar.trim();

  saveSlots(slots);
  renderSlots();
};

window.freeSingleSlot = function(slotNumber) {
  if (!isAdmin()) return;
  const padNum = String(slotNumber).padStart(2, '0');
  if (!confirm(`¿Liberar el Cupo #${padNum}?`)) return;
  const updated = getSlots().map(s =>
    s.slotNumber === slotNumber
      ? { slotNumber, occupied: false, name: `Cupo #${padNum}`, steamName: 'Sin vincular', avatarUrl: '', steamUrl: '' }
      : s
  );
  saveSlots(updated);
  renderSlots();
};

if (clearSlotsBtn) {
  clearSlotsBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    const cfg = getConfig();
    if (!confirm(`¿Vaciar los ${cfg.maxPlayers} cupos?`)) return;
    saveSlots(createEmptySlots(cfg.maxPlayers));
    renderSlots();
  });
}

// 8. MOTOR DE PLAYOFFS DINÁMICO QUE SE ADAPTA A CUALQUIER MITAD DE CUPOS
const lockedViewEl = document.getElementById('lockedBracketView');
const unlockedContentEl = document.getElementById('unlockedBracketContent');
const toggleStageVisibilityBtn = document.getElementById('toggleStageVisibilityBtn');
const togglePlayoffsVisibilityBtn = document.getElementById('togglePlayoffsVisibilityBtn');
const adminVisibilityStatus = document.getElementById('adminVisibilityStatus');
const roundTabsEl = document.getElementById('roundTabs');
const matchesContainerEl = document.getElementById('matchesContainer');
const playerFilterEl = document.getElementById('playerScheduleFilter');
const standingsBody = document.getElementById('standingsBody');
const lockedPlayoffsView = document.getElementById('lockedPlayoffsView');
const unlockedPlayoffsBox = document.getElementById('unlockedPlayoffsBox');

function getPlayoffWinnersMap() {
  return JSON.parse(localStorage.getItem(PLAYOFFS_KEY) || '{}');
}

function savePlayoffWinnersMap(mapObj, skipCloud = false) {
  localStorage.setItem(PLAYOFFS_KEY, JSON.stringify(mapObj));
  if (!skipCloud) pushAdminStateToCloud();
}

function generateStandardBracketSeedOrder(bracketSize) {
  let seeds = [1, 2];
  while (seeds.length < bracketSize) {
    const nextSize = seeds.length * 2 + 1;
    const expanded = [];
    for (const s of seeds) {
      expanded.push(s);
      expanded.push(nextSize - s);
    }
    seeds = expanded;
  }
  return seeds;
}

function getRoundStageTitle(matchesInRound) {
  if (matchesInRound === 1) return '🏆 GRAN FINAL';
  if (matchesInRound === 2) return '⚔️ SEMIFINALES';
  if (matchesInRound === 4) return '🔥 CUARTOS DE FINAL / PRELIMINAR';
  if (matchesInRound === 8) return '⚡ OCTAVOS DE FINAL';
  return `RONDA DE ${matchesInRound * 2}`;
}

function renderDynamicPlayoffsBracket(qualifiedList) {
  const container = document.getElementById('dynamicPlayoffsContainer');
  if (!container) return;

  const numQualified = qualifiedList.length;
  const winnersMap = getPlayoffWinnersMap();

  const headingEl = document.getElementById('playoffsMainHeading');
  const subEl = document.getElementById('playoffsStageSub');
  const cfg = getConfig();
  if (subEl) {
    subEl.textContent = `FASE 2 · ELIMINACIÓN DIRECTA (CLASIFICAN ${numQualified} DE ${cfg.maxPlayers} CUPOS)`;
  }
  if (headingEl) {
    headingEl.textContent = `Playoffs — Top ${numQualified} Clasificados`;
  }

  let bracketSize = 2;
  while (bracketSize < numQualified) bracketSize *= 2;
  const totalPlayoffRounds = Math.log2(bracketSize);

  const seedOrder = generateStandardBracketSeedOrder(bracketSize);

  const roundsData = [];
  let currentRoundSlots = [];

  for (let i = 0; i < bracketSize; i += 2) {
    const seedA = seedOrder[i];
    const seedB = seedOrder[i + 1];
    const playerA = seedA <= numQualified ? { ...qualifiedList[seedA - 1], seedRank: seedA } : null;
    const playerB = seedB <= numQualified ? { ...qualifiedList[seedB - 1], seedRank: seedB } : null;

    const matchKey = `R1_M${i / 2 + 1}`;
    let winnerObj = null;
    let isBye = false;

    if (playerA && !playerB) {
      winnerObj = playerA;
      isBye = true;
    } else if (!playerA && playerB) {
      winnerObj = playerB;
      isBye = true;
    } else if (playerA && playerB) {
      const savedWinnerSlot = winnersMap[matchKey];
      if (savedWinnerSlot === playerA.slotNumber) winnerObj = playerA;
      if (savedWinnerSlot === playerB.slotNumber) winnerObj = playerB;
    }

    currentRoundSlots.push({
      matchKey,
      roundIndex: 1,
      matchIndex: i / 2 + 1,
      playerA,
      playerB,
      winnerObj,
      isBye
    });
  }
  roundsData.push(currentRoundSlots);

  for (let r = 2; r <= totalPlayoffRounds; r++) {
    const prevRound = roundsData[r - 2];
    const nextRound = [];

    for (let i = 0; i < prevRound.length; i += 2) {
      const playerA = prevRound[i].winnerObj;
      const playerB = prevRound[i + 1].winnerObj;
      const matchKey = `R${r}_M${i / 2 + 1}`;

      let winnerObj = null;
      const savedWinnerSlot = winnersMap[matchKey];
      if (playerA && savedWinnerSlot === playerA.slotNumber) winnerObj = playerA;
      if (playerB && savedWinnerSlot === playerB.slotNumber) winnerObj = playerB;

      nextRound.push({
        matchKey,
        roundIndex: r,
        matchIndex: i / 2 + 1,
        playerA,
        playerB,
        winnerObj,
        isBye: false
      });
    }
    roundsData.push(nextRound);
  }

  container.innerHTML = '';

  roundsData.forEach(roundMatches => {
    const col = document.createElement('div');
    col.className = 'playoff-round-col';

    const title = getRoundStageTitle(roundMatches.length);
    col.innerHTML = `<div class="playoff-round-header">${title}</div>`;

    roundMatches.forEach(m => {
      const box = document.createElement('div');
      box.className = 'matchup-box';
      if (roundMatches.length === 1) {
        box.style.borderColor = 'var(--border-neon)';
        box.style.boxShadow = '0 0 25px rgba(255,30,86,0.14)';
      }

      if (m.isBye && m.winnerObj) {
        box.innerHTML = `
          <div class="matchup-label" style="display:flex; justify-content:space-between; align-items:center;">
            <span>PASE DIRECTO POR TABLA</span>
            <span class="bye-tag">AVANZA AUTOMÁTICO</span>
          </div>
          <div class="slot-row winner" style="cursor:default;">
            ${renderPlayerIdentityHTML(m.winnerObj, `#${m.winnerObj.seedRank}`)}
            <span style="font-size:12px; color:#6ee7b7; font-weight:700;">BYE →</span>
          </div>
        `;
      } else {
        const aWon = m.winnerObj && m.playerA && m.winnerObj.slotNumber === m.playerA.slotNumber;
        const bWon = m.winnerObj && m.playerB && m.winnerObj.slotNumber === m.playerB.slotNumber;
        const seedALabel = m.playerA ? `#${m.playerA.seedRank}` : '';
        const seedBLabel = m.playerB ? `#${m.playerB.seedRank}` : '';

        box.innerHTML = `
          <div class="matchup-label">${title} · LLAVE ${m.matchIndex}</div>
          <div class="slot-row ${aWon ? 'winner' : ''}" onclick="choosePlayoffMatchWinner('${m.matchKey}', ${m.playerA ? m.playerA.slotNumber : 'null'})">
            ${renderPlayerIdentityHTML(m.playerA, seedALabel)}
            <span class="admin-only" style="font-size:11.5px; color:var(--text-muted);">${aWon ? '✔' : 'Avanzar →'}</span>
          </div>
          <div class="slot-row ${bWon ? 'winner' : ''}" onclick="choosePlayoffMatchWinner('${m.matchKey}', ${m.playerB ? m.playerB.slotNumber : 'null'})">
            ${renderPlayerIdentityHTML(m.playerB, seedBLabel)}
            <span class="admin-only" style="font-size:11.5px; color:var(--text-muted);">${bWon ? '✔' : 'Avanzar →'}</span>
          </div>
        `;
      }

      col.appendChild(box);
    });

    container.appendChild(col);
  });

  const finalRound = roundsData[roundsData.length - 1];
  const finalMatch = finalRound ? finalRound[0] : null;
  const banner = document.getElementById('championBanner');

  if (banner) {
    if (finalMatch && finalMatch.winnerObj) {
      document.getElementById('championIdentity').innerHTML = renderPlayerIdentityHTML(finalMatch.winnerObj, '👑');
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }
}

window.choosePlayoffMatchWinner = function(matchKey, winnerSlotNumber) {
  if (!isAdmin() || !winnerSlotNumber) return;
  const mapObj = getPlayoffWinnersMap();
  mapObj[matchKey] = mapObj[matchKey] === winnerSlotNumber ? null : winnerSlotNumber;
  savePlayoffWinnersMap(mapObj);
  renderStandingsAndPlayoffs();
};

function isStagePublic() {
  return localStorage.getItem(STAGE_PUBLIC_KEY) === 'true';
}

function setStagePublic(val, skipCloud = false) {
  localStorage.setItem(STAGE_PUBLIC_KEY, val ? 'true' : 'false');
  if (!skipCloud) pushAdminStateToCloud();
}

function isPlayoffsForcedByAdmin() {
  return localStorage.getItem(PLAYOFFS_PUBLIC_KEY) === 'true';
}

function setPlayoffsForcedByAdmin(val, skipCloud = false) {
  localStorage.setItem(PLAYOFFS_PUBLIC_KEY, val ? 'true' : 'false');
  if (!skipCloud) pushAdminStateToCloud();
}

function checkBracketLockState() {
  if (!lockedViewEl || !unlockedContentEl) return;

  const cfg = getConfig();
  const slots = getSlots();
  const matches = getMatches();
  const totalMatches = matches.length;
  const occupiedCount = slots.filter(s => s.occupied).length;
  const completedMatchesCount = matches.filter(m => m.winnerSlot !== null).length;

  const publicNow = isStagePublic();
  const playoffsForced = isPlayoffsForcedByAdmin();
  const allMatchesFinished = totalMatches > 0 && completedMatchesCount === totalMatches;
  const adminNow = isAdmin();

  const pct = Math.round((occupiedCount / cfg.maxPlayers) * 100);
  const fillEl = document.getElementById('lockedProgressFill');
  const countEl = document.getElementById('lockedCountText');
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (countEl) countEl.textContent = `${occupiedCount} / ${cfg.maxPlayers} Cupos Ocupados`;

  if (adminVisibilityStatus && toggleStageVisibilityBtn) {
    adminVisibilityStatus.innerHTML = `
      Jornadas Semanales: <span style="color:${publicNow ? '#10b981' : '#f59e0b'};">${publicNow ? '✅ VISIBLES' : '🔒 OCULTAS'}</span>
      &nbsp;|&nbsp;
      Playoffs (Top ${cfg.playoffSpots}): <span style="color:${(allMatchesFinished || playoffsForced) ? '#10b981' : '#f59e0b'};">${(allMatchesFinished || playoffsForced) ? '✅ DESBLOQUEADOS' : `🔒 OCULTOS (${completedMatchesCount}/${totalMatches})`}</span>
    `;
    toggleStageVisibilityBtn.textContent = publicNow ? '🙈 Ocultar Jornadas' : '👁️ Mostrar Jornadas';
    if (togglePlayoffsVisibilityBtn) {
      togglePlayoffsVisibilityBtn.textContent = playoffsForced ? '🙈 Ocultar Playoffs' : '🏆 Mostrar Playoffs Ahora';
    }
  }

  if (publicNow || adminNow) {
    lockedViewEl.style.display = 'none';
    unlockedContentEl.style.display = 'block';
    populatePlayerFilter();
    renderSchedule();
    renderStandingsAndPlayoffs();

    if (lockedPlayoffsView && unlockedPlayoffsBox) {
      const playoffsPct = totalMatches > 0 ? Math.round((completedMatchesCount / totalMatches) * 100) : 0;
      const pFill = document.getElementById('playoffsProgressFill');
      const pText = document.getElementById('playoffsProgressText');
      if (pFill) pFill.style.width = `${playoffsPct}%`;
      if (pText) pText.textContent = `${completedMatchesCount} / ${totalMatches} Partidas Semanales Completadas`;

      if (allMatchesFinished || playoffsForced) {
        lockedPlayoffsView.style.display = 'none';
        unlockedPlayoffsBox.style.display = 'block';
      } else {
        lockedPlayoffsView.style.display = 'block';
        unlockedPlayoffsBox.style.display = 'none';
      }
    }
  } else {
    lockedViewEl.style.display = 'block';
    unlockedContentEl.style.display = 'none';
  }
}

if (toggleStageVisibilityBtn) {
  toggleStageVisibilityBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    setStagePublic(!isStagePublic());
    checkBracketLockState();
  });
}

if (togglePlayoffsVisibilityBtn) {
  togglePlayoffsVisibilityBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    setPlayoffsForcedByAdmin(!isPlayoffsForcedByAdmin());
    checkBracketLockState();
  });
}

function populatePlayerFilter() {
  if (!playerFilterEl) return;
  const currentVal = playerFilterEl.value || 'all';
  const slots = getSlots();

  playerFilterEl.innerHTML = `<option value="all">Ver por Semana / Jornada (Todos)</option>`;
  slots.forEach(s => {
    const opt = document.createElement('option');
    opt.value = String(s.slotNumber);
    opt.textContent = `Duelos de: ${s.name} (${s.steamName})`;
    playerFilterEl.appendChild(opt);
  });
  playerFilterEl.value = currentVal;
}

function renderSchedule() {
  if (!matchesContainerEl || !roundTabsEl) return;
  const cfg = getConfig();
  const totalRounds = getTotalRounds(cfg.maxPlayers);
  if (activeRound > totalRounds) activeRound = 1;

  const slots = getSlots();
  const slotByNum = {};
  slots.forEach(s => { slotByNum[s.slotNumber] = s; });

  const matches = getMatches();
  const selectedPlayerSlot = playerFilterEl ? playerFilterEl.value : 'all';

  roundTabsEl.innerHTML = '';
  for (let r = 1; r <= totalRounds; r++) {
    const mapData = getMapForRound(r);
    const btn = document.createElement('button');
    btn.className = `round-tab ${selectedPlayerSlot === 'all' && activeRound === r ? 'active' : ''}`;
    btn.innerHTML = `
      <strong>Jornada ${r} · Semana ${r}</strong>
      <small>${mapData.icon} ${mapData.name}</small>
    `;
    btn.onclick = () => {
      activeRound = r;
      if (playerFilterEl) playerFilterEl.value = 'all';
      renderSchedule();
    };
    roundTabsEl.appendChild(btn);
  }

  const activeMap = getMapForRound(activeRound);
  const roundMatches = matches.filter(m => m.round === activeRound);
  const completedInRound = roundMatches.filter(m => m.winnerSlot !== null).length;

  const bannerRoundLabel = document.getElementById('bannerRoundLabel');
  const bannerMapTitle = document.getElementById('bannerMapTitle');
  const bannerCompletedCounter = document.getElementById('bannerCompletedCounter');

  if (bannerRoundLabel && bannerMapTitle && bannerCompletedCounter) {
    if (selectedPlayerSlot === 'all') {
      bannerRoundLabel.textContent = `JORNADA ${activeRound} (SEMANA ${activeRound} DE ${totalRounds}) · ZONEMOD 1V1`;
      bannerMapTitle.textContent = `${activeMap.icon} ${activeMap.name.toUpperCase()} (${activeMap.sub})`;
      bannerCompletedCounter.textContent = `${completedInRound} / ${roundMatches.length} Duelos Jugados`;
    } else {
      const pObj = slotByNum[Number(selectedPlayerSlot)];
      bannerRoundLabel.textContent = `CALENDARIO SEMANAL PERSONAL`;
      bannerMapTitle.textContent = `🎯 DUELOS DE ${pObj ? pObj.name.toUpperCase() : ''}`;
      bannerCompletedCounter.textContent = `1 Duelo por Semana`;
    }
  }

  const visibleMatches = selectedPlayerSlot === 'all'
    ? roundMatches
    : matches.filter(m => m.slotA === Number(selectedPlayerSlot) || m.slotB === Number(selectedPlayerSlot));

  matchesContainerEl.innerHTML = '';

  visibleMatches.forEach(m => {
    const playerA = slotByNum[m.slotA];
    const playerB = slotByNum[m.slotB];
    const mapData = getMapForRound(m.round);
    const isCompleted = m.winnerSlot !== null;

    const aWon = m.winnerSlot === m.slotA;
    const bWon = m.winnerSlot === m.slotB;

    const scoreAText = m.scoreA !== null && m.scoreA !== undefined ? `${m.scoreA} pts` : '—';
    const scoreBText = m.scoreB !== null && m.scoreB !== undefined ? `${m.scoreB} pts` : '—';

    const padA = String(m.slotA).padStart(2, '0');
    const padB = String(m.slotB).padStart(2, '0');

    const card = document.createElement('div');
    card.className = `duel-card ${isCompleted ? 'completed' : ''}`;

    card.innerHTML = `
      <div class="duel-header">
        <span class="duel-map-tag">${mapData.icon} Sem ${m.round}: ${mapData.name}</span>
        <span class="duel-time">🕒 ${m.time}</span>
      </div>

      <div class="fighter-row ${aWon ? 'is-winner' : bWon ? 'is-loser' : ''}" onclick="recordDuelResult(${m.id}, ${m.slotA})">
        ${renderPlayerIdentityHTML(playerA, `#${padA}`)}
        <span class="duel-score-pill">${scoreAText} ${aWon ? '✔' : ''}</span>
      </div>

      <div class="vs-divider">VS</div>

      <div class="fighter-row ${bWon ? 'is-winner' : aWon ? 'is-loser' : ''}" onclick="recordDuelResult(${m.id}, ${m.slotB})">
        ${renderPlayerIdentityHTML(playerB, `#${padB}`)}
        <span class="duel-score-pill">${scoreBText} ${bWon ? '✔' : ''}</span>
      </div>

      <div class="admin-only" style="justify-content:space-between; margin-top:4px; gap:6px;">
        <button class="admin-mini-btn" onclick="recordDuelResult(${m.id}, ${m.slotA})">⚔ Marcador</button>
        <button class="admin-mini-btn" onclick="editMatchTime(${m.id})">🕒 Día/Hora</button>
        <button class="admin-mini-btn" onclick="clearMatchResult(${m.id})">↺ Limpiar</button>
      </div>
    `;
    matchesContainerEl.appendChild(card);
  });
}

window.recordDuelResult = function(matchId, clickedSlot) {
  if (!isAdmin()) return;
  const slots = getSlots();
  const slotByNum = {};
  slots.forEach(s => { slotByNum[s.slotNumber] = s; });

  const matches = getMatches();
  const target = matches.find(m => m.id === matchId);
  if (!target) return;

  const playerA = slotByNum[target.slotA];
  const playerB = slotByNum[target.slotB];
  const mapData = getMapForRound(target.round);

  const defaultScoreA = target.scoreA !== null ? target.scoreA : (clickedSlot === target.slotA ? 1500 : 1200);
  const defaultScoreB = target.scoreB !== null ? target.scoreB : (clickedSlot === target.slotB ? 1500 : 1200);

  const inputA = prompt(`[Semana ${target.round} - ${mapData.name}] Puntos de ${playerA.name}:`, defaultScoreA);
  if (inputA === null) return;
  const inputB = prompt(`[Semana ${target.round} - ${mapData.name}] Puntos de ${playerB.name}:`, defaultScoreB);
  if (inputB === null) return;

  const numA = Number(inputA);
  const numB = Number(inputB);

  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    alert('Ingresa números válidos.');
    return;
  }

  target.scoreA = numA;
  target.scoreB = numB;
  target.winnerSlot = numA > numB ? target.slotA : (numB > numA ? target.slotB : (clickedSlot || target.slotA));

  saveMatches(matches);
  checkBracketLockState();
};

window.clearMatchResult = function(matchId) {
  if (!isAdmin()) return;
  const matches = getMatches().map(m =>
    m.id === matchId ? { ...m, winnerSlot: null, scoreA: null, scoreB: null } : m
  );
  saveMatches(matches);
  checkBracketLockState();
};

window.editMatchTime = function(matchId) {
  if (!isAdmin()) return;
  const matches = getMatches();
  const target = matches.find(m => m.id === matchId);
  if (!target) return;

  const newTime = prompt(`Horario en la Semana ${target.round} (ej: Sábado 20:00 PM):`, target.time);
  if (newTime && newTime.trim()) {
    target.time = newTime.trim();
    saveMatches(matches);
    renderSchedule();
  }
};

if (playerFilterEl) {
  playerFilterEl.addEventListener('change', renderSchedule);
}

function renderStandingsAndPlayoffs() {
  if (!standingsBody) return;
  const cfg = getConfig();
  const halfSpots = getPlayoffSpotsCount(cfg.maxPlayers);
  const sorted = getCalculatedStandings();
  const qualifiedPlayers = sorted.slice(0, halfSpots);

  standingsBody.innerHTML = '';
  const totalGamesPerPlayer = cfg.maxPlayers - 1;

  sorted.forEach((slot, index) => {
    const isQualified = index < halfSpots;
    const played = slot.wins + slot.losses;
    const pts = slot.wins * cfg.pointsPerWin;
    const diff = slot.pointsFor - slot.pointsAgainst;
    const diffFormatted = diff > 0 ? `+${diff}` : `${diff}`;

    const tr = document.createElement('tr');
    if (isQualified) tr.className = 'qualified';

    tr.innerHTML = `
      <td class="rank-num">#${index + 1}</td>
      <td>
        <a href="${slot.steamUrl || '#'}" target="_blank" rel="noreferrer">
          ${renderPlayerIdentityHTML(slot)}
        </a>
      </td>
      <td>${played} / ${totalGamesPerPlayer}</td>
      <td style="color:#10b981;">${slot.wins}</td>
      <td style="color:#f43f5e;">${slot.losses}</td>
      <td style="font-family:var(--font-mono); font-size:13px;">${slot.pointsFor}</td>
      <td style="font-family:var(--font-mono); font-size:13px; color:var(--text-muted);">${slot.pointsAgainst}</td>
      <td style="font-family:var(--font-mono); font-size:13px; color:${diff >= 0 ? '#6ee7b7' : '#fda4af'};">${diffFormatted}</td>
      <td><span class="pts-badge">${pts} PTS</span></td>
      <td>
        <span style="font-size:12px; color:${isQualified ? '#10b981' : '#94a3b8'};">
          ${isQualified ? `● Clasifica (Top ${halfSpots})` : '○ Eliminado'}
        </span>
      </td>
    `;
    standingsBody.appendChild(tr);
  });

  renderDynamicPlayoffsBracket(qualifiedPlayers);
}

const resetBtn = document.getElementById('resetScoresBtn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    if (!confirm('¿Reiniciar todos los marcadores y horarios de las semanas?')) return;
    saveMatches(generateRoundRobinSchedule(getConfig().maxPlayers), true);
    savePlayoffWinnersMap({}, true);
    setPlayoffsForcedByAdmin(false, true);
    pushAdminStateToCloud();
    checkBracketLockState();
  });
}

// 9. PANEL ADMIN (admin.html)
function renderAdminPanel() {
  const lockedScreen = document.getElementById('adminLockedScreen');
  const dashboard = document.getElementById('adminDashboardContent');
  if (!lockedScreen || !dashboard) return;

  if (!isAdmin()) {
    lockedScreen.style.display = 'block';
    dashboard.style.display = 'none';
    return;
  }

  lockedScreen.style.display = 'none';
  dashboard.style.display = 'block';

  const cfg = getConfig();
  const totalRounds = getTotalRounds(cfg.maxPlayers);
  const halfSpots = getPlayoffSpotsCount(cfg.maxPlayers);

  const maxPlayersInput = document.getElementById('cfgMaxPlayers');
  const previewHalfEl = document.getElementById('cfgPlayoffSpotsPreview');
  const legacySelectEl = document.getElementById('cfgPlayoffSpots');

  // Si en admin.html aún estaba el <select id="cfgPlayoffSpots">, lo actualiza automáticamente con el 50%
  if (legacySelectEl) {
    legacySelectEl.innerHTML = `<option value="${halfSpots}">Automático (50%): Pasan los ${halfSpots} mejores (de ${cfg.maxPlayers} cupos)</option>`;
    legacySelectEl.disabled = true;
  }

  if (maxPlayersInput) {
    maxPlayersInput.value = cfg.maxPlayers;
    maxPlayersInput.oninput = () => {
      const val = Math.max(4, Number(maxPlayersInput.value) || 8);
      const half = getPlayoffSpotsCount(val);
      if (previewHalfEl) {
        previewHalfEl.textContent = `Pasan los ${half} mejores (el 50% de ${val} cupos)`;
      }
      if (legacySelectEl) {
        legacySelectEl.innerHTML = `<option value="${half}">Automático (50%): Pasan los ${half} mejores (de ${val} cupos)</option>`;
      }
    };
  }

  if (previewHalfEl) {
    previewHalfEl.textContent = `Pasan los ${halfSpots} mejores (el 50% de ${cfg.maxPlayers} cupos)`;
  }

  document.getElementById('cfgPointsPerWin').value = cfg.pointsPerWin;
  document.getElementById('cfgTitle').value = cfg.title;
  document.getElementById('cfgSubtitle').value = cfg.subtitle;
  document.getElementById('cfgHeroTag').value = cfg.heroTag;
  document.getElementById('cfgHeroDesc').value = cfg.heroDesc;

  const mapsGrid = document.getElementById('adminMapsGrid');
  if (mapsGrid) {
    mapsGrid.innerHTML = '';
    for (let r = 1; r <= totalRounds; r++) {
      const currentMap = getMapForRound(r);
      const card = document.createElement('div');
      card.className = 'esports-card';

      const optionsHTML = L4D2_MAP_CATALOG.map(m => {
        const selected = m.name === currentMap.name ? 'selected' : '';
        return `<option value="${m.name}" ${selected}>${m.icon} ${m.name} (${m.sub})</option>`;
      }).join('');

      card.innerHTML = `
        <span class="card-number">JORNADA ${r} · SEMANA ${r}</span>
        <h3 style="font-size:22px; margin:6px 0 12px;">${currentMap.icon} ${currentMap.name}</h3>
        <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Campaña ZoneMod 1v1:</label>
        <select class="input-esports admin-map-select" data-round="${r}" style="padding:10px 12px; font-size:14px;">
          ${optionsHTML}
        </select>
      `;
      mapsGrid.appendChild(card);
    }
  }
}

const saveCapacityBtn = document.getElementById('saveCapacityBtn');
if (saveCapacityBtn) {
  saveCapacityBtn.addEventListener('click', async () => {
    if (!isAdmin()) return;
    const cfg = getConfig();
    const newMax = Math.max(4, Math.min(32, Number(document.getElementById('cfgMaxPlayers').value) || 8));
    const newPts = Math.max(1, Number(document.getElementById('cfgPointsPerWin').value) || 3);
    const newHalf = getPlayoffSpotsCount(newMax);

    const changedCount = newMax !== cfg.maxPlayers;
    cfg.maxPlayers = newMax;
    cfg.pointsPerWin = newPts;
    cfg.playoffSpots = newHalf;
    saveConfig(cfg, true);

    getSlots();
    if (changedCount) {
      saveMatches(generateRoundRobinSchedule(newMax), true);
      savePlayoffWinnersMap({}, true);
    }

    await pushAdminStateToCloud();
    applyGlobalSiteConfig();
    renderAdminPanel();
    alert(`¡Torneo adaptado a ${newMax} jugadores (${getTotalRounds(newMax)} semanas)! Clasifican automáticamente los ${newHalf} mejores a Playoffs.`);
  });
}

const saveTextsBtn = document.getElementById('saveTextsBtn');
if (saveTextsBtn) {
  saveTextsBtn.addEventListener('click', async () => {
    if (!isAdmin()) return;
    const cfg = getConfig();
    cfg.title = document.getElementById('cfgTitle').value.trim() || 'EL ÚLTIMO EN PIE';
    cfg.subtitle = document.getElementById('cfgSubtitle').value.trim() || 'L4D2 1V1 · ZONEMOD';
    cfg.heroTag = document.getElementById('cfgHeroTag').value.trim() || '● TORNEO POR PANDA ●';
    cfg.heroDesc = document.getElementById('cfgHeroDesc').value.trim() || cfg.heroDesc;
    saveConfig(cfg);
    applyGlobalSiteConfig();
    alert('¡Textos actualizados en toda la web!');
  });
}

const saveMapsBtn = document.getElementById('saveMapsBtn');
if (saveMapsBtn) {
  saveMapsBtn.addEventListener('click', async () => {
    if (!isAdmin()) return;
    const cfg = getConfig();
    document.querySelectorAll('.admin-map-select').forEach(selectEl => {
      const roundNum = Number(selectEl.dataset.round);
      const chosenName = selectEl.value;
      const found = L4D2_MAP_CATALOG.find(m => m.name === chosenName);
      if (found) {
        cfg.roundMaps[roundNum] = found;
      }
    });
    saveConfig(cfg, true);

    const updatedMatches = getMatches().map(m => ({
      ...m,
      mapName: getMapForRound(m.round).name
    }));
    saveMatches(updatedMatches, true);

    await pushAdminStateToCloud();
    renderAdminPanel();
    alert('¡Mapas semanales actualizados!');
  });
}

const adminQuickToggleStage = document.getElementById('adminQuickToggleStage');
if (adminQuickToggleStage) {
  adminQuickToggleStage.addEventListener('click', () => {
    setStagePublic(!isStagePublic());
    alert(`Jornadas Semanales ahora están: ${isStagePublic() ? 'VISIBLES' : 'OCULTAS'}`);
  });
}

const adminQuickTogglePlayoffs = document.getElementById('adminQuickTogglePlayoffs');
if (adminQuickTogglePlayoffs) {
  adminQuickTogglePlayoffs.addEventListener('click', () => {
    setPlayoffsForcedByAdmin(!isPlayoffsForcedByAdmin());
    alert(`Playoffs ahora están: ${isPlayoffsForcedByAdmin() ? 'DESBLOQUEADOS' : 'AUTOMÁTICOS'}`);
  });
}

const adminResetMatchesOnly = document.getElementById('adminResetMatchesOnly');
if (adminResetMatchesOnly) {
  adminResetMatchesOnly.addEventListener('click', async () => {
    if (!confirm('¿Reiniciar marcadores semanales?')) return;
    saveMatches(generateRoundRobinSchedule(getConfig().maxPlayers), true);
    savePlayoffWinnersMap({}, true);
    await pushAdminStateToCloud();
    alert('Marcadores reiniciados.');
  });
}

const adminResetAllSlots = document.getElementById('adminResetAllSlots');
if (adminResetAllSlots) {
  adminResetAllSlots.addEventListener('click', async () => {
    const cfg = getConfig();
    if (!confirm(`¿Vaciar los ${cfg.maxPlayers} cupos?`)) return;
    saveSlots(createEmptySlots(cfg.maxPlayers), true);
    await pushAdminStateToCloud();
    alert('Cupos liberados.');
  });
}

// 10. REGISTRO EN 1 CLIC (registro.html)
const registerForm = document.getElementById('registerForm');

if (registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nickInput = document.getElementById('nickname');
    const steamInput = document.getElementById('steamUrl');
    const submitBtn = document.getElementById('submitBtn');

    const rawNick = nickInput ? nickInput.value.trim() : '';
    const steamUrl = normalizeSteamProfileUrl(steamInput.value);

    if (!steamUrl.includes('steamcommunity.com/')) {
      alert('Por favor ingresa un link válido de Steam.');
      return;
    }

    const cfg = getConfig();
    const slots = getSlots();
    const params = new URLSearchParams(window.location.search);
    const requestedSlot = Number(params.get('slot'));

    let targetSlot = slots.find(s => s.slotNumber === requestedSlot && !s.occupied);
    if (!targetSlot) targetSlot = slots.find(s => !s.occupied);

    if (!targetSlot) {
      alert(`¡Los ${cfg.maxPlayers} cupos están llenos!`);
      window.location.href = 'participantes.html';
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Obteniendo Foto y Nombre de Steam...';
    }

    const steamData = await fetchSteamProfileData(steamUrl, rawNick);
    const finalNickname = rawNick || steamData.steamName;

    const playerObj = {
      name: finalNickname,
      steamName: steamData.steamName,
      avatarUrl: steamData.avatarUrl,
      steamUrl
    };

      const cloudResult = await registerSlotInCloud(targetSlot.slotNumber, playerObj);
    if (cloudResult.conflict) {
      alert(cloudResult.message);
      await syncFromCloudDatabase();
      window.location.href = 'participantes.html';
      return;
    }
    if (cloudResult.serverError) {
      alert(cloudResult.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Vincular con Steam en 1 Clic ↗';
      }
      return;
    }
    
    const updated = slots.map(s =>
      s.slotNumber === targetSlot.slotNumber
        ? { ...s, occupied: true, ...playerObj }
        : s
    );

    saveSlots(updated, true);
    window.location.href = 'participantes.html';
  });
}

// INICIALIZACIÓN
applyGlobalSiteConfig();
renderSlots();
applyAdminUI();
syncFromCloudDatabase();