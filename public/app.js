/**
 * World of Agents - Spectator Client (Bit 4B)
 * Connects to WebSocket and renders a lane board UI.
 */

const el = {
  status: document.getElementById("status"),
  tick: document.getElementById("tick"),

  baseAllianceHp: document.getElementById("base-alliance-hp"),
  baseHordeHp: document.getElementById("base-horde-hp"),
  baseAllianceBar: document.getElementById("base-alliance-bar"),
  baseHordeBar: document.getElementById("base-horde-bar"),

  towersSummary: document.getElementById("towers-summary"),
  heroesSummary: document.getElementById("heroes-summary"),

  lanes: {
    top: {
      frontline: document.getElementById("lane-top-frontline"),
      heroA: document.getElementById("lane-top-hero-alliance"),
      heroH: document.getElementById("lane-top-hero-horde"),
      bar: document.getElementById("lane-top-bar"),
      pin: document.getElementById("lane-top-pin"),
      root: document.getElementById("lane-top"),
    },
    mid: {
      frontline: document.getElementById("lane-mid-frontline"),
      heroA: document.getElementById("lane-mid-hero-alliance"),
      heroH: document.getElementById("lane-mid-hero-horde"),
      bar: document.getElementById("lane-mid-bar"),
      pin: document.getElementById("lane-mid-pin"),
      root: document.getElementById("lane-mid"),
    },
    bot: {
      frontline: document.getElementById("lane-bot-frontline"),
      heroA: document.getElementById("lane-bot-hero-alliance"),
      heroH: document.getElementById("lane-bot-hero-horde"),
      bar: document.getElementById("lane-bot-bar"),
      pin: document.getElementById("lane-bot-pin"),
      root: document.getElementById("lane-bot"),
    },
  },

  heroCardsAlliance: document.getElementById("heroes-alliance"),
  heroCardsHorde: document.getElementById("heroes-horde"),
  events: document.getElementById("events"),
  canvas: document.getElementById("battlemap"),
};

let ws = null;

let latestState = null;
let rafScheduled = false;
let lastPaint = 0;
const PAINT_MIN_MS = 200; // cap UI updates to 5Hz

const map = createMapRenderer(el.canvas);

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  el.status.textContent = "Connecting...";
  el.status.className = "connecting";

  ws = new WebSocket(url);

  ws.onopen = () => {
    el.status.textContent = "Connected";
    el.status.className = "connected";
  };

  ws.onclose = () => {
    el.status.textContent = "Disconnected - reconnecting...";
    el.status.className = "disconnected";
    setTimeout(connect, 1500);
  };

  ws.onerror = () => {
    el.status.textContent = "Error";
    el.status.className = "error";
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== "state") return;
      latestState = msg.data;
      schedulePaint();
    } catch (e) {
      // Ignore malformed payloads.
    }
  };
}

function schedulePaint() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const now = performance.now();
    if (now - lastPaint < PAINT_MIN_MS) {
      // Defer slightly to maintain the cap.
      setTimeout(schedulePaint, PAINT_MIN_MS);
      return;
    }
    lastPaint = now;
    if (latestState) render(latestState);
  });
}

function pctFromFrontline(frontline) {
  // -100..+100 => 0..100
  return clamp(((frontline + 100) / 200) * 100, 0, 100);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function render(state) {
  // Top HUD
  setText(
    el.tick,
    `Tick: ${state.tick} | Phase: ${state.phase}${state.winner ? ` | Winner: ${state.winner.toUpperCase()}` : ""}`
  );

  // Strongholds
  renderStronghold(state.strongholds.alliance, el.baseAllianceHp, el.baseAllianceBar);
  renderStronghold(state.strongholds.horde, el.baseHordeHp, el.baseHordeBar);

  // Towers summary
  const aliveTowers = state.towers.filter((t) => t.alive).length;
  const aTowers = state.towers.filter((t) => t.alive && t.faction === "alliance").length;
  const hTowers = state.towers.filter((t) => t.alive && t.faction === "horde").length;
  setText(el.towersSummary, `Towers: Alliance ${aTowers}/6 | Horde ${hTowers}/6 (Alive ${aliveTowers}/12)`);

  // Lanes
  renderLane("top", state.lanes.top);
  renderLane("mid", state.lanes.mid);
  renderLane("bot", state.lanes.bot);

  // Hero roster
  const aHeroes = state.heroes.alliance;
  const hHeroes = state.heroes.horde;
  setText(el.heroesSummary, `${aHeroes.length + hHeroes.length} total`);
  renderHeroCards(el.heroCardsAlliance, aHeroes, "alliance");
  renderHeroCards(el.heroCardsHorde, hHeroes, "horde");

  // Events
  renderEvents(state.recentEvents || []);

  // Canvas map
  map.render(state);
}

function renderStronghold(s, hpEl, barEl) {
  setText(hpEl, `${s.hp}/${s.maxHp} (${s.condition})`);
  const pct = s.maxHp > 0 ? (s.hp / s.maxHp) * 100 : 0;
  setWidth(barEl, clamp(pct, 0, 100));
}

function renderLane(key, lane) {
  const laneEl = el.lanes[key];
  const pct = pctFromFrontline(lane.frontline);

  setLeft(laneEl.pin, pct);
  setWidth(laneEl.bar, 100);

  setText(laneEl.frontline, `Frontline: ${lane.frontline} | ${lane.status}`);
  setText(laneEl.heroA, lane.alliance.hero || "-");
  setText(laneEl.heroH, lane.horde.hero || "-");

  // Add a class based on advantage for subtle styling.
  laneEl.root.classList.toggle("lane--alliance", lane.frontline < -10);
  laneEl.root.classList.toggle("lane--horde", lane.frontline > 10);
  laneEl.root.classList.toggle("lane--even", lane.frontline >= -10 && lane.frontline <= 10);
}

function renderHeroCards(container, heroes, faction) {
  // Small roster sizes: simplest is to re-render the column.
  container.innerHTML = heroes
    .map((h) => heroCardHtml(h, faction))
    .join("");
}

function heroCardHtml(h, faction) {
  const hpPct = h.maxHp > 0 ? clamp((h.hp / h.maxHp) * 100, 0, 100) : 0;
  const manaPct = h.maxMana > 0 ? clamp((h.mana / h.maxMana) * 100, 0, 100) : 0;
  const dead = h.alive ? "" : " hero--dead";

  return `
    <div class="hero hero--${faction}${dead}">
      <div class="hero__top">
        <div class="hero__name">${escapeHtml(h.name)}</div>
        <div class="hero__tag">${escapeHtml(h.class)} · ${escapeHtml(h.lane)}</div>
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
  if (e.type === "hero_moved") return `${e.hero}: ${e.from} -> ${e.to}`;
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

connect();

function createMapRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let cssW = 0;
  let cssH = 0;

  function resizeToCss() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = Math.max(320, Math.floor(parent.clientWidth));
    const h = Math.max(220, Math.floor(Math.min(460, parent.clientWidth * 0.42)));
    if (w === cssW && h === cssH) return;
    cssW = w;
    cssH = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", () => {
    resizeToCss();
  });

  function xFromPos(pos) {
    const pad = 36;
    const t = (pos + 100) / 200;
    return pad + t * (cssW - pad * 2);
  }

  function yFromLane(lane) {
    if (lane === "top") return Math.round(cssH * 0.22);
    if (lane === "mid") return Math.round(cssH * 0.50);
    return Math.round(cssH * 0.78);
  }

  function draw(state) {
    resizeToCss();

    // Background
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, cssW, cssH);

    // Subtle vignette
    const g = ctx.createRadialGradient(cssW * 0.5, cssH * 0.35, 40, cssW * 0.5, cssH * 0.35, cssW);
    g.addColorStop(0, "rgba(240,201,106,0.10)");
    g.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);

    // Lanes
    for (const lane of ["top", "mid", "bot"]) {
      const y = yFromLane(lane);
      ctx.strokeStyle = "rgba(242,237,226,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xFromPos(-100), y);
      ctx.lineTo(xFromPos(100), y);
      ctx.stroke();

      // Lane name
      ctx.fillStyle = "rgba(242,237,226,0.55)";
      ctx.font = "12px Palatino Linotype, Georgia, serif";
      ctx.fillText(lane.toUpperCase(), 10, y + 4);

      // Frontline pin
      const fx = xFromPos(state.lanes[lane].frontline);
      ctx.strokeStyle = "rgba(240,201,106,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx, y - 16);
      ctx.lineTo(fx, y + 16);
      ctx.stroke();
    }

    // Towers
    for (const t of state.towers) {
      if (!t.alive) continue;
      const y = yFromLane(t.lane);
      const pos = towerPos(t.faction, t.position);
      const x = xFromPos(pos);
      ctx.fillStyle = t.faction === "alliance" ? "rgba(87,189,255,0.85)" : "rgba(255,92,122,0.85)";
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      roundRect(ctx, x - 8, y - 8, 16, 16, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Creeps
    for (const lane of ["top", "mid", "bot"]) {
      const y = yFromLane(lane);
      const units = state.lanes[lane].units;

      drawUnits(units.alliance, y, "rgba(87,189,255,0.65)");
      drawUnits(units.horde, y, "rgba(255,92,122,0.65)");
    }

    // Heroes
    for (const h of state.heroes.alliance) drawHero(h, "alliance");
    for (const h of state.heroes.horde) drawHero(h, "horde");

    // Bases
    drawBase("alliance");
    drawBase("horde");
  }

  function drawUnits(list, y, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const x = xFromPos(u.pos);
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHero(h, faction) {
    const y = yFromLane(h.lane);
    const x = xFromPos(approxHeroPos(faction, h.lane));
    const alive = h.alive;

    ctx.save();
    ctx.globalAlpha = alive ? 1 : 0.45;
    ctx.fillStyle = faction === "alliance" ? "rgba(87,189,255,0.95)" : "rgba(255,92,122,0.95)";
    ctx.strokeStyle = "rgba(0,0,0,0.70)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Initial letter
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.font = "bold 10px Palatino Linotype, Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(h.class.slice(0, 1).toUpperCase(), x, y + 0.5);
    ctx.restore();
  }

  function drawBase(faction) {
    const x = xFromPos(faction === "alliance" ? -100 : 100);
    const y = Math.round(cssH * 0.50);
    ctx.fillStyle = faction === "alliance" ? "rgba(87,189,255,0.25)" : "rgba(255,92,122,0.25)";
    ctx.strokeStyle = "rgba(240,201,106,0.35)";
    ctx.lineWidth = 2;
    roundRect(ctx, x - 16, y - 16, 32, 32, 6);
    ctx.fill();
    ctx.stroke();
  }

  function towerPos(faction, positionText) {
    // positionText is "Outer"/"Inner" from status
    const isOuter = positionText === "Outer";
    if (faction === "alliance") return isOuter ? -40 : -70;
    return isOuter ? 40 : 70;
  }

  function approxHeroPos(faction, lane) {
    // We don't have per-hero positions yet. Approximate by anchoring
    // to the lane frontline and nudging toward their side.
    const frontline = latestState?.lanes?.[lane]?.frontline ?? 0;
    const bias = faction === "alliance" ? -10 : 10;
    return clamp(frontline + bias, -95, 95);
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

  return {
    render: draw,
  };
}
