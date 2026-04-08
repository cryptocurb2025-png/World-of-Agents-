const el = {
  status: document.getElementById("status"),
  tick: document.getElementById("tick"),
  roundTitle: document.getElementById("round-title"),
  roundSubtitle: document.getElementById("round-subtitle"),
  roundMeta: document.getElementById("round-meta"),
  predictionStats: document.getElementById("prediction-stats"),
  predictAlliance: document.getElementById("predict-alliance"),
  predictHorde: document.getElementById("predict-horde"),
  cinematicToggle: document.getElementById("cinematic-toggle"),
  audioToggle: document.getElementById("audio-toggle"),

  baseAllianceHp: document.getElementById("base-alliance-hp"),
  baseHordeHp: document.getElementById("base-horde-hp"),
  baseAllianceBar: document.getElementById("base-alliance-bar"),
  baseHordeBar: document.getElementById("base-horde-bar"),

  towersSummary: document.getElementById("towers-summary"),
  heroesSummary: document.getElementById("heroes-summary"),

  rewardPoolAlliance: document.getElementById("reward-pool-alliance"),
  rewardPoolHorde: document.getElementById("reward-pool-horde"),
  rewardRounds: document.getElementById("reward-rounds"),

  myPending: document.getElementById("my-pending-woa"),
  claimBtn: document.getElementById("claim-btn"),
  claimStatus: document.getElementById("claim-status"),
  matchHistory: document.getElementById("match-history-body"),

  lanes: {
    mid: {
      frontline: document.getElementById("lane-mid-frontline"),
      heroAName: document.getElementById("lane-mid-hero-alliance-name"),
      heroAIcon: document.getElementById("lane-mid-hero-alliance-icon"),
      heroHName: document.getElementById("lane-mid-hero-horde-name"),
      heroHIcon: document.getElementById("lane-mid-hero-horde-icon"),
      pin: document.getElementById("lane-mid-pin"),
      root: document.getElementById("lane-mid"),
    },
  },

  heroCardsAlliance: document.getElementById("heroes-alliance"),
  heroCardsHorde: document.getElementById("heroes-horde"),
  events: document.getElementById("events"),
  canvas: document.getElementById("battlemap"),
};

// --- Session management ---
let sessionId = localStorage.getItem("woa-sessionId") || null;

function setSessionId(id) {
  sessionId = id;
  localStorage.setItem("woa-sessionId", id);
}

// --- Kill feed ---
const killFeed = []; // { text, color, time }

let ws = null;
let latestState = null;
let rafScheduled = false;
let lastPaint = 0;
const PAINT_MIN_MS = 80;

let lastRoundId = null;
let prevEventCount = 0;

const seenEventKeys = new Set();
const map = createMapRenderer(el.canvas);

// --- Death tracker for animations ---
const deathTimestamps = new Map(); // heroName -> timestamp

// --- Procedural Audio Engine ---
class AudioManager {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.volume = 0.3;
    this.muted = localStorage.getItem("woa-muted") === "1";
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.enabled = !this.muted;
    } catch (e) {
      console.warn("Audio init failed:", e);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    this.enabled = !this.muted;
    localStorage.setItem("woa-muted", this.muted ? "1" : "0");
    return this.muted;
  }

  _noise(duration, filterFreq) {
    if (!this.enabled || !this.ctx) return;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq || 2000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  _tone(freq, duration, type, vol) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type || "square";
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime((vol || this.volume) * 0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playAttack() { this._noise(0.05, 2000); }
  playAbility(type) {
    if (!this.enabled || !this.ctx) return;
    if (type === "heal") { this._tone(523, 0.15, "sine", this.volume * 0.6); this._tone(659, 0.15, "sine", this.volume * 0.4); }
    else if (type === "stun") { this._tone(220, 0.08, "sawtooth"); this._tone(440, 0.08, "sawtooth"); }
    else if (type === "slow" || type === "frost") { this._tone(300, 0.2, "triangle"); }
    else { this._tone(350, 0.12, "sawtooth"); this._tone(700, 0.08, "square"); }
  }
  playKill() {
    if (!this.enabled || !this.ctx) return;
    this._tone(80, 0.15, "sawtooth", this.volume);
    setTimeout(() => this._tone(1200, 0.1, "square", this.volume * 0.6), 50);
  }
  playRoundStart() {
    if (!this.enabled || !this.ctx) return;
    this._tone(440, 0.12, "square", this.volume * 0.5);
    setTimeout(() => this._tone(523, 0.12, "square", this.volume * 0.5), 120);
    setTimeout(() => this._tone(659, 0.18, "square", this.volume * 0.6), 240);
  }
  playTowerDestroy() { this._noise(0.2, 800); this._tone(100, 0.2, "sawtooth"); }

  emitRoundStart() { this.playRoundStart(); }
  emitAttack() { this.playAttack(); }
  emitDeath() { this.playKill(); }
}

const audio = new AudioManager();

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const sidParam = sessionId ? `?sessionId=${sessionId}` : "";
  const url = `${protocol}//${window.location.host}/ws${sidParam}`;

  setConnection("Connecting...", "connecting");
  ws = new WebSocket(url);

  ws.onopen = () => setConnection("Connected", "connected");
  ws.onclose = () => {
    setConnection("Disconnected - reconnecting...", "disconnected");
    setTimeout(connect, 1000);
  };
  ws.onerror = () => setConnection("Error", "error");
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== "state") return;
      // Capture session ID from server
      if (msg.data.sessionId && !sessionId) {
        setSessionId(msg.data.sessionId);
      }
      latestState = msg.data;
      schedulePaint();
    } catch {
      // Ignore malformed payloads.
    }
  };
}

function setConnection(text, className) {
  el.status.textContent = text;
  el.status.className = className;
}

function schedulePaint() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const now = performance.now();
    if (now - lastPaint < PAINT_MIN_MS) {
      setTimeout(schedulePaint, PAINT_MIN_MS);
      return;
    }
    lastPaint = now;
    if (latestState) render(latestState);
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pctFromFrontline(frontline) {
  return clamp(((frontline + 100) / 200) * 100, 0, 100);
}

function setText(node, value) {
  const next = String(value);
  if (node.textContent !== next) node.textContent = next;
}

function setWidth(node, pct) {
  const next = `${pct.toFixed(1)}%`;
  if (node.style.width !== next) node.style.width = next;
}

function setLeft(node, pct) {
  const next = `${pct.toFixed(1)}%`;
  if (node.style.left !== next) node.style.left = next;
}

function classSpritePath(heroClass, faction) {
  const cls = String(heroClass || "").toUpperCase();
  if (cls === "MAGE") return "/assets/units/battle-mage-pixel.svg";
  if (cls === "RANGER") return "/assets/heroes/ranger-pixel.svg";
  if (cls === "HEALER") return "/assets/heroes/healer-pixel.svg";
  if (cls === "WARRIOR") return faction === "alliance" ? "/assets/heroes/warrior-pixel.svg" : "/assets/units/ogre-pixel.svg";
  return faction === "alliance" ? "/assets/heroes/warrior-pixel.svg" : "/assets/units/grunt-pixel.svg";
}

function unitSpritePath(type, faction) {
  const t = String(type || "").toUpperCase();
  if (t === "OGRE" || t === "OGRE_LORD") return "/assets/units/ogre-pixel.svg";
  if (t === "BATTLE_MAGE") return "/assets/units/battle-mage-pixel.svg";
  if (t === "PEASANT") return "/assets/units/peasant-pixel.svg";
  if (t === "GRUNT") return "/assets/units/grunt-pixel.svg";
  if (t === "DEATH_KNIGHT") return "/assets/units/death-knight-pixel.svg";
  if (t === "BALLISTA") return "/assets/units/ballista-pixel.svg";
  if (t === "FOOTMAN") return "/assets/units/footman-pixel.svg";
  if (t === "KNIGHT") return "/assets/units/knight-pixel.svg";
  if (t === "RIFLEMAN" || t === "ARCHER") return "/assets/heroes/ranger-pixel.svg";
  if (t === "TROLL" || t === "TROLL_AXER") return "/assets/units/troll-pixel.svg";
  if (t === "WOLF_RIDER") return "/assets/units/grunt-pixel.svg";
  if (t === "CATAPULT") return "/assets/units/ballista-pixel.svg";
  return faction === "alliance" ? "/assets/heroes/hero-placeholder.svg" : "/assets/units/grunt-pixel.svg";
}

const UNIT_MAX_HP_BY_TYPE = {
  FOOTMAN: 50,
  GRUNT: 50,
  RIFLEMAN: 35,
  AXETHROWER: 35,
  OGRE: 88,
  OGRE_LORD: 150,
  TROLL: 60,
  TROLL_AXER: 45,
  BATTLE_MAGE: 45,
  PEASANT: 36,
  DEATH_KNIGHT: 90,
  BALLISTA: 55,
  KNIGHT: 100,
  ARCHER: 40,
  WOLF_RIDER: 55,
  CATAPULT: 80,
};

function heroAccent(heroClass, faction) {
  const cls = String(heroClass || "").toUpperCase();
  if (cls === "MAGE") return "#b889ff";
  if (cls === "RANGER") return "#8fe28f";
  if (cls === "HEALER") return "#78e3ad";
  if (cls === "WARRIOR") return faction === "alliance" ? "#7bb0ff" : "#d38f6a";
  return faction === "alliance" ? "#57bdff" : "#ff5c7a";
}

function eventVisualStyle(event) {
  const ability = String(event.ability || "").toLowerCase();
  const atype = String(event.type || "").toLowerCase();
  // Ability-specific VFX
  if (ability.includes("fireball")) return { color: "#ffb35c", glow: "rgba(255,140,60,0.45)", radius: 4.2, arc: -10 };
  if (ability.includes("blizzard")) return { color: "#7ac5ff", glow: "rgba(122,197,255,0.50)", radius: 5.5, arc: -2 };
  if (ability.includes("frost")) return { color: "#a0e8ff", glow: "rgba(160,232,255,0.48)", radius: 3.8, arc: -6 };
  if (ability.includes("thunder")) return { color: "#ffe066", glow: "rgba(255,224,102,0.50)", radius: 5.0, arc: 0 };
  if (ability.includes("holy") || ability.includes("chain heal")) return { color: "#87efb8", glow: "rgba(135,239,184,0.42)", radius: 3.8, arc: -6 };
  if (ability.includes("shield") || ability.includes("battle shout")) return { color: "#f0c96a", glow: "rgba(240,201,106,0.40)", radius: 3.4, arc: 1 };
  if (ability.includes("multi")) return { color: "#b9ecff", glow: "rgba(120,200,255,0.40)", radius: 2.8, arc: 5 };
  if (ability.includes("poison")) return { color: "#8fff8f", glow: "rgba(80,255,80,0.40)", radius: 3.2, arc: -4 };
  if (ability.includes("stomp") || ability.includes("war")) return { color: "#ffdd44", glow: "rgba(255,221,68,0.50)", radius: 4.8, arc: 0 };
  // Type-based fallbacks
  if (atype === "stun") return { color: "#ffdd44", glow: "rgba(255,221,68,0.50)", radius: 4.0, arc: 0 };
  if (atype === "slow") return { color: "#a0e8ff", glow: "rgba(160,232,255,0.45)", radius: 3.5, arc: -3 };
  if (atype === "dot") return { color: "#8fff8f", glow: "rgba(80,255,80,0.40)", radius: 3.0, arc: -2 };
  if (event.type === "hero_kill") return { color: "#ff5c7a", glow: "rgba(255,92,122,0.50)", radius: 5.2, arc: 0 };
  if (event.type === "tower_attack") return { color: "#ffd68e", glow: "rgba(255,214,142,0.38)", radius: 3.2, arc: 2 };
  return { color: "#9ad7ff", glow: "rgba(154,215,255,0.36)", radius: 2.8, arc: 3 };
}

function setHeroSlot(nameEl, iconEl, name, heroClass, faction) {
  const hasName = Boolean(name);
  setText(nameEl, hasName ? name : "-");
  if (!iconEl) return;
  const src = classSpritePath(heroClass, faction);
  if (iconEl.getAttribute("src") !== src) iconEl.setAttribute("src", src);
  iconEl.style.opacity = hasName ? "1" : "0.25";
  iconEl.style.filter = hasName ? "none" : "grayscale(1)";
}

function render(state) {
  const fightClub = state.fightClub || null;
  setText(el.tick, `Tick ${state.tick} | ${state.phase.toUpperCase()}`);

  if (fightClub) {
    setText(el.roundTitle, fightClub.round.title);
    setText(el.roundSubtitle, fightClub.round.subtitle);
    setText(el.roundMeta, `Round Tick ${fightClub.roundTick}/${fightClub.round.durationTicks} | Score Alliance ${fightClub.wins.alliance} - Horde ${fightClub.wins.horde}`);
    const p = fightClub.prediction;
    setText(el.predictionStats, `Votes ${p.total} | Alliance ${p.alliancePct}% (${p.alliance}) | Horde ${p.hordePct}% (${p.horde})`);
    
    if (fightClub.rewards) {
      setText(el.rewardPoolAlliance, `${fightClub.rewards.totalAlliance} $WOA`);
      setText(el.rewardPoolHorde, `${fightClub.rewards.totalHorde} $WOA`);
      setText(el.rewardRounds, fightClub.rewards.roundsTracked);
    }
  }

  renderStronghold(state.strongholds.alliance, el.baseAllianceHp, el.baseAllianceBar);
  renderStronghold(state.strongholds.horde, el.baseHordeHp, el.baseHordeBar);

  const aliveTowers = state.towers.filter((t) => t.alive).length;
  const aTowers = state.towers.filter((t) => t.alive && t.faction === "alliance").length;
  const hTowers = state.towers.filter((t) => t.alive && t.faction === "horde").length;
  setText(el.towersSummary, `Towers: Alliance ${aTowers}/6 | Horde ${hTowers}/6 | Alive ${aliveTowers}`);

  const aHeroes = state.heroes.alliance;
  const hHeroes = state.heroes.horde;
  const heroByName = new Map();
  for (const h of aHeroes) heroByName.set(h.name, h);
  for (const h of hHeroes) heroByName.set(h.name, h);

  renderLane("mid", state.lanes.mid, heroByName);

  setText(el.heroesSummary, `${aHeroes.length + hHeroes.length} heroes`);
  renderHeroCards(el.heroCardsAlliance, aHeroes, "alliance");
  renderHeroCards(el.heroCardsHorde, hHeroes, "horde");
  renderEvents(state.recentEvents || []);

  // Match history
  if (fightClub && fightClub.history && el.matchHistory) {
    el.matchHistory.innerHTML = fightClub.history.slice(-6).reverse().map((h) => {
      const wColor = h.winner === "alliance" ? "var(--alliance)" : h.winner === "horde" ? "var(--horde)" : "var(--muted)";
      return `<tr><td>${escapeHtml(h.title)}</td><td style="color:${wColor}">${h.winner}</td><td>${h.rewards?.allianceWoa || 0}</td><td>${h.rewards?.hordeWoa || 0}</td></tr>`;
    }).join("");
  }

  if (fightClub && fightClub.round && fightClub.round.id !== lastRoundId) {
    lastRoundId = fightClub.round.id;
    audio.emitRoundStart();
  }

  const events = state.recentEvents || [];
  if (events.length > prevEventCount) {
    const newEvents = events.slice(prevEventCount);
    for (const e of newEvents) {
      if (e.type === "hero_kill") {
        audio.emitDeath();
        killFeed.push({
          text: `${e.killer} killed ${e.victim}`,
          color: "#ff5c7a",
          time: performance.now(),
        });
        deathTimestamps.set(e.victim, performance.now());
        if (killFeed.length > 5) killFeed.shift();
      } else if (e.type === "hero_attack" || e.type === "attack") {
        audio.emitAttack();
      } else if (e.type === "ability_used") {
        audio.playAbility(e.type === "ability_used" ? (e.ability || "").toLowerCase() : "damage");
      } else if (e.type === "tower_destroyed") {
        audio.playTowerDestroy();
        killFeed.push({
          text: `${e.destroyer} destroyed ${e.tower}`,
          color: "#ffd68e",
          time: performance.now(),
        });
        if (killFeed.length > 5) killFeed.shift();
      }
    }
  }
  prevEventCount = events.length;

  map.pushEvents(state);
  map.render(state);
}

function renderStronghold(s, hpEl, barEl) {
  setText(hpEl, `${s.hp}/${s.maxHp} (${s.condition})`);
  const pct = s.maxHp > 0 ? (s.hp / s.maxHp) * 100 : 0;
  setWidth(barEl, clamp(pct, 0, 100));
}

function renderLane(key, lane, heroByName) {
  const laneEl = el.lanes[key];
  const pct = pctFromFrontline(lane.frontline);

  setLeft(laneEl.pin, pct);
  setText(laneEl.frontline, `Frontline: ${lane.frontline} | ${lane.status}`);

  const allianceHero = lane.alliance.hero ? heroByName.get(lane.alliance.hero) : null;
  const hordeHero = lane.horde.hero ? heroByName.get(lane.horde.hero) : null;
  setHeroSlot(laneEl.heroAName, laneEl.heroAIcon, lane.alliance.hero, allianceHero?.class, "alliance");
  setHeroSlot(laneEl.heroHName, laneEl.heroHIcon, lane.horde.hero, hordeHero?.class, "horde");

  laneEl.root.classList.toggle("lane--alliance", lane.frontline < -10);
  laneEl.root.classList.toggle("lane--horde", lane.frontline > 10);
  laneEl.root.classList.toggle("lane--even", lane.frontline >= -10 && lane.frontline <= 10);
}

function renderHeroCards(container, heroes, faction) {
  container.innerHTML = heroes.map((h) => heroCardHtml(h, faction)).join("");
}

function heroCardHtml(h, faction) {
  const hpPct = h.maxHp > 0 ? clamp((h.hp / h.maxHp) * 100, 0, 100) : 0;
  const manaPct = h.maxMana > 0 ? clamp((h.mana / h.maxMana) * 100, 0, 100) : 0;
  const dead = h.alive ? "" : " hero--dead";
  const portrait = classSpritePath(h.class, faction);

  return `
    <div class="hero hero--${faction}${dead}">
      <div class="hero__top">
        <img class="hero__portrait" src="${escapeHtml(portrait)}" alt="" width="28" height="28" />
        <div>
          <div class="hero__name">${escapeHtml(h.name)}</div>
          <div class="hero__tag">${escapeHtml(h.class)} · ${escapeHtml(h.lane)}</div>
        </div>
      </div>
      <div class="hero__bars">
        <div class="hbar hbar--hp"><div class="hbar__fill" style="width:${hpPct.toFixed(1)}%"></div></div>
        <div class="hbar hbar--mana"><div class="hbar__fill" style="width:${manaPct.toFixed(1)}%"></div></div>
      </div>
      <div class="hero__meta">
        <div>HP ${h.hp}/${h.maxHp}</div>
        <div>Mana ${h.mana}/${h.maxMana}</div>
        <div>Gold ${h.gold}</div>
      </div>
    </div>
  `;
}

function renderEvents(events) {
  if (!events.length) {
    el.events.innerHTML = `<div class="events__empty">Waiting for events...</div>`;
    return;
  }

  el.events.innerHTML = events
    .slice(-10)
    .reverse()
    .map((e) => {
      const title = `[${e.tick}] ${e.type}`;
      const detail = summarizeEvent(e);
      return `
        <div class="event">
          <div class="event__title">${escapeHtml(title)}</div>
          <div class="event__detail">${escapeHtml(detail)}</div>
        </div>
      `;
    })
    .join("");
}

function summarizeEvent(e) {
  if (e.type === "hero_kill") return `${e.killer} -> ${e.victim}`;
  if (e.type === "hero_respawn") return `${e.hero} @ ${e.lane}`;
  if (e.type === "tower_destroyed") return `${e.destroyer} destroyed ${e.tower}`;
  if (e.type === "hero_joined") return `${e.hero} (${e.class}) @ ${e.lane}`;
  if (e.type === "game_over") return `Winner: ${e.winner}`;
  return Object.keys(e)
    .filter((k) => k !== "tick" && k !== "type")
    .slice(0, 4)
    .map((k) => `${k}=${e[k]}`)
    .join(" ");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attachPredictionHandlers() {
  el.predictAlliance?.addEventListener("click", () => submitPrediction("alliance"));
  el.predictHorde?.addEventListener("click", () => submitPrediction("horde"));
}

async function submitPrediction(pick) {
  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick }),
    });
    if (!res.ok) return;
    const payload = await res.json();
    if (payload?.fightClub?.prediction) {
      const p = payload.fightClub.prediction;
      setText(el.predictionStats, `Votes ${p.total} | Alliance ${p.alliancePct}% (${p.alliance}) | Horde ${p.hordePct}% (${p.horde})`);
    }
  } catch {
    // Ignore network failures.
  }
}

function setCinematicMode(enabled) {
  document.body.classList.toggle("cinematic-mode", enabled);
  if (el.cinematicToggle) {
    el.cinematicToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    el.cinematicToggle.textContent = enabled ? "Exit Cinematic" : "Cinematic View";
  }
  localStorage.setItem("woa-cinematic-mode", enabled ? "1" : "0");
}

function attachCinematicHandler() {
  const saved = localStorage.getItem("woa-cinematic-mode") === "1";
  setCinematicMode(saved);
  el.cinematicToggle?.addEventListener("click", () => {
    const next = !document.body.classList.contains("cinematic-mode");
    setCinematicMode(next);
    map.refreshLayout();
  });
}

function createMapRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let cssW = 0;
  let cssH = 0;
  const sprites = new Map();
  const effects = [];
  const projectiles = [];
  const hitFlashes = new Map();
  const groundRings = [];
  const arena = loadSprite("/assets/terrain/fightclub-arena.svg");
  const structureSprites = {
    allianceTower: loadSprite("/assets/structures/alliance-tower.svg"),
    hordeTower: loadSprite("/assets/structures/horde-tower.svg"),
    allianceKeep: loadSprite("/assets/structures/alliance-keep.svg"),
    hordeKeep: loadSprite("/assets/structures/horde-keep.svg"),
    banner: loadSprite("/assets/structures/center-banner.svg"),
  };

  function resizeToCss() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = Math.max(320, Math.floor(parent.clientWidth));
    const cinematic = document.body.classList.contains("cinematic-mode");
    const viewTarget = Math.floor(window.innerHeight * (cinematic ? 0.84 : 0.68));
    const h = Math.max(260, Math.min(820, viewTarget));
    if (w === cssW && h === cssH) return;
    cssW = w;
    cssH = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function xFromPos(pos) {
    const pad = 32;
    return pad + ((pos + 100) / 200) * (cssW - pad * 2);
  }

  function yFromLane(lane) {
    if (lane === "top") return Math.round(cssH * 0.22);
    if (lane === "mid") return Math.round(cssH * 0.50);
    return Math.round(cssH * 0.78);
  }

  function draw(state) {
    resizeToCss();
    const now = performance.now();

    ctx.fillStyle = "#0a0c12";
    ctx.fillRect(0, 0, cssW, cssH);
    if (arena.complete) {
      ctx.globalAlpha = 0.72;
      ctx.drawImage(arena, 0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
    }

    drawMapFrame();

    for (const lane of ["top", "mid", "bot"]) {
      const y = yFromLane(lane);
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(xFromPos(-100), y);
      ctx.lineTo(xFromPos(100), y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(242,237,226,0.18)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(xFromPos(-100), y);
      ctx.lineTo(xFromPos(100), y);
      ctx.stroke();

      const fx = xFromPos(state.lanes[lane].frontline);
      ctx.strokeStyle = "rgba(240,201,106,0.85)";
      ctx.beginPath();
      ctx.moveTo(fx, y - 16);
      ctx.lineTo(fx, y + 16);
      ctx.stroke();

      ctx.fillStyle = "rgba(242,237,226,0.52)";
      ctx.font = "11px Georgia, serif";
      ctx.fillText(lane.toUpperCase(), 10, y - 8);
    }

    drawCenterBanner();
    drawStructures(state);

    for (const lane of ["top", "mid", "bot"]) {
      const y = yFromLane(lane);
      const units = state.lanes[lane].units;
      drawUnits(units.alliance, y, "alliance", now);
      drawUnits(units.horde, y, "horde", now);
    }

    for (const h of state.heroes.alliance) drawHero(h, "alliance", state, now);
    for (const h of state.heroes.horde) drawHero(h, "horde", state, now);

    drawProjectiles(now);
    drawEffects();
    drawHitFlashes(now, state);
    drawGroundRings(now);
    drawKillFeed(now);
  }

  function drawMapFrame() {
    ctx.strokeStyle = "rgba(240,201,106,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, cssW - 8, cssH - 8, 8);
    ctx.stroke();
  }

  function drawCenterBanner() {
    if (!structureSprites.banner.complete) return;
    const w = 96;
    const h = 36;
    ctx.globalAlpha = 0.88;
    ctx.drawImage(structureSprites.banner, cssW / 2 - w / 2, 12, w, h);
    ctx.globalAlpha = 1;
  }

  function drawUnits(units, y, faction, now) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const x = xFromPos(u.pos);
      const wobble = Math.sin(now / 120 + i * 0.7) * 1.5;
      const yOffset = ((i % 5) - 2) * 4 + wobble;
      const sprite = loadSprite(unitSpritePath(u.type, faction));
      const size = u.type === "BALLISTA" ? 24 : 18;
      const drawY = y + yOffset;
      const maxHp = UNIT_MAX_HP_BY_TYPE[String(u.type || "").toUpperCase()] || u.hp;

      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(x, drawY + size * 0.38, size * 0.33, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();

      if (sprite.complete) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = faction === "alliance" ? "rgba(87,189,255,0.45)" : "rgba(255,92,122,0.45)";
        ctx.drawImage(sprite, x - size / 2, drawY - size / 2, size, size);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = faction === "alliance" ? "#57bdff" : "#ff5c7a";
        ctx.fillRect(x - 2, drawY - 2, 4, 4);
      }

      if ((u.type === "BALLISTA" || u.type === "OGRE" || u.type === "DEATH_KNIGHT") && u.hp < maxHp) {
        drawBar(x - 8, drawY - size / 2 - 6, 16, 3, u.hp / maxHp, faction === "alliance" ? "#7bb0ff" : "#ff7c95");
      }
    }
  }

  function drawStructures(state) {
    for (const t of state.towers) {
      if (!t.alive) continue;
      const y = yFromLane(t.lane);
      const x = xFromPos(towerPos(t.faction, t.position));
      const sprite = t.faction === "alliance" ? structureSprites.allianceTower : structureSprites.hordeTower;
      const size = 30;

      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (sprite.complete) {
        ctx.drawImage(sprite, x - size / 2, y - size / 2 - 4, size, size);
      }

      drawBar(x - 12, y - 21, 24, 3, t.hp / t.maxHp, t.faction === "alliance" ? "#7bb0ff" : "#ff7c95");
    }

    drawBaseStructure("alliance", state.strongholds.alliance);
    drawBaseStructure("horde", state.strongholds.horde);
  }

  function drawBaseStructure(faction, base) {
    const x = xFromPos(faction === "alliance" ? -100 : 100);
    const y = Math.round(cssH * 0.5);
    const sprite = faction === "alliance" ? structureSprites.allianceKeep : structureSprites.hordeKeep;
    const size = 52;

    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(x, y + 22, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (sprite.complete) {
      ctx.drawImage(sprite, x - size / 2, y - size / 2 + 4, size, size);
    }

    drawBar(x - 18, y - 26, 36, 4, base.hp / base.maxHp, faction === "alliance" ? "#7bb0ff" : "#ff7c95");
  }

  function drawHero(hero, faction, state, now) {
    const p = heroWorldPosition(hero, faction, state);
    const x = xFromPos(p.pos);
    const y = yFromLane(hero.lane) + Math.sin(now / 200 + x * 0.02) * 1.8;
    const sprite = loadSprite(classSpritePath(hero.class, faction));
    const accent = heroAccent(hero.class, faction);

    // Death animation: fade out over 500ms then show skull
    if (!hero.alive) {
      const deathTime = deathTimestamps.get(hero.name);
      if (deathTime) {
        const age = now - deathTime;
        if (age < 500) {
          ctx.globalAlpha = Math.max(0.1, 1 - age / 500);
        } else {
          // Draw skull marker
          ctx.globalAlpha = 0.6;
          ctx.font = "18px serif";
          ctx.fillStyle = "#ff5c7a";
          ctx.fillText("\u2620", x - 8, y + 6);
          ctx.globalAlpha = 1;
          return;
        }
      } else {
        ctx.globalAlpha = 0.3;
      }
    } else {
      ctx.globalAlpha = 1;
    }

    const size = 42;
    if (sprite.complete) {
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.beginPath();
      ctx.ellipse(x, y + 15, 15, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = hero.alive ? 0.35 : 0.18;
      ctx.beginPath();
      ctx.arc(x, y + 4, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = hero.alive ? 1 : 0.4;

      ctx.shadowBlur = 14;
      ctx.shadowColor = accent;
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      ctx.shadowBlur = 0;
    }
    drawBar(x - 16, y - 25, 32, 4, hero.hp / hero.maxHp, "#67dd8f");
    drawBar(x - 16, y - 19, 32, 3, hero.mana / hero.maxMana, accent);
    ctx.globalAlpha = 1;
  }

  function heroWorldPosition(hero, faction, state) {
    const laneFrontline = state.lanes[hero.lane]?.frontline ?? 0;
    const bias = faction === "alliance" ? -10 : 10;
    return { lane: hero.lane, pos: clamp(laneFrontline + bias, -95, 95) };
  }

  function drawProjectiles(now) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const age = now - p.created;
      if (age >= p.ttl) {
        projectiles.splice(i, 1);
        continue;
      }

      const t = age / p.ttl;
      const x1 = xFromPos(p.fromPos);
      const y1 = yFromLane(p.lane);
      const x2 = xFromPos(p.toPos);
      const y2 = yFromLane(p.lane);
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * p.arc;

      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 14;
      ctx.shadowColor = p.glow || p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function drawBar(x, y, w, h, pct, color) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(pct, 0, 1)), Math.max(0, h - 2));
  }

  function drawEffects() {
    const now = performance.now();
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      const age = now - fx.created;
      if (age >= fx.ttl) {
        effects.splice(i, 1);
        continue;
      }

      const p = 1 - age / fx.ttl;
      const x = xFromPos(fx.pos);
      const y = yFromLane(fx.lane);
      ctx.globalAlpha = p * 0.22;
      ctx.fillStyle = fx.glow || fx.color;
      ctx.beginPath();
      ctx.arc(x, y, fx.size * (1.35 + (1 - p)), 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = p;
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, fx.size * (1 + (1 - p) * 0.8), 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 1.5;
      for (let spoke = 0; spoke < 4; spoke++) {
        const a = (Math.PI / 2) * spoke + age / 160;
        const inner = fx.size * 0.4;
        const outer = fx.size * (1.1 + (1 - p) * 0.7);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
        ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHitFlashes(now, state) {
    for (const [targetId, flash] of hitFlashes) {
      const age = now - flash.created;
      if (age >= flash.ttl) {
        hitFlashes.delete(targetId);
        continue;
      }
      const p = 1 - age / flash.ttl;
      ctx.globalAlpha = p * 0.7;
      ctx.fillStyle = "#ffffff";
      for (const h of [...state.heroes.alliance, ...state.heroes.horde]) {
        if (h.id === targetId || h.name === targetId) {
          const hp = heroWorldPosition(h, h.faction, state);
          const x = xFromPos(hp.pos);
          const y = yFromLane(h.lane);
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawGroundRings(now) {
    for (let i = groundRings.length - 1; i >= 0; i--) {
      const ring = groundRings[i];
      const age = now - ring.created;
      if (age >= ring.ttl) {
        groundRings.splice(i, 1);
        continue;
      }
      const p = 1 - age / ring.ttl;
      const x = xFromPos(ring.pos);
      const y = yFromLane(ring.lane);
      ctx.globalAlpha = p * 0.35;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y + 8, ring.size * (1 + p * 1.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function loadSprite(src) {
    if (sprites.has(src)) return sprites.get(src);
    const img = new Image();
    img.src = src;
    sprites.set(src, img);
    return img;
  }

  function towerPos(faction, positionText) {
    const isOuter = positionText === "Outer";
    if (faction === "alliance") return isOuter ? -40 : -70;
    return isOuter ? 40 : 70;
  }

  function eventKey(e) {
    return `${e.tick}:${e.type}:${e.killer || ""}:${e.victim || ""}:${e.attacker || ""}:${e.target || ""}`;
  }

  function pushEvents(state) {
    const events = state.recentEvents || [];
    const heroMap = new Map();
    for (const h of state.heroes.alliance) heroMap.set(h.name, { ...h, faction: "alliance" });
    for (const h of state.heroes.horde) heroMap.set(h.name, { ...h, faction: "horde" });

    for (const e of events) {
      const key = eventKey(e);
      if (seenEventKeys.has(key)) continue;
      seenEventKeys.add(key);
      if (seenEventKeys.size > 200) {
        const first = seenEventKeys.values().next().value;
        seenEventKeys.delete(first);
      }

      if (!["hero_attack", "ability_used", "damage", "hero_kill", "tower_attack"].includes(e.type)) continue;

      const actor = heroMap.get(e.attacker) || heroMap.get(e.hero) || heroMap.get(e.killer) || heroMap.get(e.victim);
      const defender = heroMap.get(e.defender) || heroMap.get(e.target) || heroMap.get(e.victim);
      const lane = actor?.lane || defender?.lane || "mid";
      const laneFrontline = state.lanes[lane]?.frontline ?? 0;
      const actorPos = actor ? heroWorldPosition(actor, actor.faction, state).pos : clamp(laneFrontline - 22, -95, 95);
      const defenderPos = defender ? heroWorldPosition(defender, defender.faction, state).pos : clamp(laneFrontline + 22, -95, 95);
      const impactPos = clamp((actorPos + defenderPos) / 2 + Math.random() * 8 - 4, -95, 95);
      const style = eventVisualStyle(e);

      if (["hero_attack", "damage", "tower_attack"].includes(e.type)) {
        projectiles.push({
          created: performance.now(),
          ttl: e.type === "damage" ? 460 : 320,
          lane,
          fromPos: actorPos,
          toPos: defenderPos,
          color: style.color,
          glow: style.glow,
          radius: style.radius,
          arc: style.arc,
        });
      }

      effects.push({
        created: performance.now(),
        ttl: e.type === "hero_kill" ? 900 : 420,
        lane,
        pos: impactPos,
        color: style.color,
        glow: style.glow,
        size: e.type === "hero_kill" ? 14 : 8,
      });

      if (["damage", "hero_attack", "attack"].includes(e.type)) {
        const targetId = e.targetId || e.target || e.defender;
        if (targetId) {
          hitFlashes.set(targetId, { created: performance.now(), ttl: 140 });
        }
        groundRings.push({
          created: performance.now(),
          ttl: 320,
          lane,
          pos: impactPos,
          color: style.color,
          size: 6,
        });
      }
    }
  }

  function drawKillFeed(now) {
    const feedX = cssW - 12;
    let feedY = 28;
    ctx.textAlign = "right";
    ctx.font = "bold 11px Manrope, sans-serif";
    for (let i = killFeed.length - 1; i >= 0; i--) {
      const entry = killFeed[i];
      const age = now - entry.time;
      if (age > 5000) { killFeed.splice(i, 1); continue; }
      const alpha = age > 4000 ? (5000 - age) / 1000 : 1;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const tw = ctx.measureText(entry.text).width;
      ctx.fillRect(feedX - tw - 8, feedY - 10, tw + 16, 16);
      ctx.fillStyle = entry.color;
      ctx.fillText(entry.text, feedX, feedY);
      feedY += 20;
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  window.addEventListener("resize", resizeToCss);

  return {
    render: draw,
    pushEvents,
    refreshLayout: () => {
      cssW = 0;
      cssH = 0;
      resizeToCss();
    },
  };
}

function attachAudioHandler() {
  const saved = localStorage.getItem("woa-muted") === "1";
  if (el.audioToggle) {
    el.audioToggle.textContent = saved ? "Unmute" : "Mute";
    el.audioToggle.addEventListener("click", () => {
      audio.init(); // First click creates AudioContext (browser policy)
      const muted = audio.toggleMute();
      el.audioToggle.textContent = muted ? "Unmute" : "Mute";
    });
  }
  // Init audio on first interaction
  document.addEventListener("click", () => audio.init(), { once: true });
}

function attachClaimHandler() {
  if (!el.claimBtn) return;
  el.claimBtn.addEventListener("click", async () => {
    if (!sessionId) return;
    el.claimBtn.disabled = true;
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.ok) {
        if (el.claimStatus) setText(el.claimStatus, `Claimed ${data.claimed} $WOA!`);
        if (el.myPending) setText(el.myPending, "0 $WOA");
      } else {
        if (el.claimStatus) setText(el.claimStatus, data.error || "Claim failed");
      }
    } catch {
      if (el.claimStatus) setText(el.claimStatus, "Network error");
    }
    setTimeout(() => { el.claimBtn.disabled = false; }, 2000);
  });
}

// Periodically fetch player balance
setInterval(async () => {
  if (!sessionId) return;
  try {
    const res = await fetch(`/api/balance?sessionId=${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (el.myPending) setText(el.myPending, `${data.pending} $WOA`);
    if (el.claimBtn) el.claimBtn.disabled = data.pending < 100;
    if (el.claimStatus && data.pending < 100) setText(el.claimStatus, `Need ${100 - data.pending} more to claim`);
  } catch { /* ignore */ }
}, 15000);

attachPredictionHandlers();
attachCinematicHandler();
attachAudioHandler();
attachClaimHandler();
connect();
