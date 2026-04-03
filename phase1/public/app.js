const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

const warrior = {
  hpFill: document.getElementById("warrior-hp"),
  manaFill: document.getElementById("warrior-mana"),
  vitals: document.getElementById("warrior-vitals"),
  castBtn: document.getElementById("warrior-cast"),
  hint: document.getElementById("warrior-hint"),
};

const mage = {
  hpFill: document.getElementById("mage-hp"),
  manaFill: document.getElementById("mage-mana"),
  vitals: document.getElementById("mage-vitals"),
  castBtn: document.getElementById("mage-cast"),
  hint: document.getElementById("mage-hint"),
};

const logEl = document.getElementById("log");

let ws;
let lastLogKey = null;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function connect() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${window.location.host}/ws`);

  statusEl.textContent = "connecting";
  statusEl.className = "pill pill--warn";

  ws.onopen = () => {
    statusEl.textContent = "connected";
    statusEl.className = "pill pill--ok";
  };

  ws.onclose = () => {
    statusEl.textContent = "disconnected";
    statusEl.className = "pill pill--bad";
    setTimeout(connect, 800);
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "state") render(msg.data);
  };
}

function sendCast(heroId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "cast", heroId }));
}

warrior.castBtn.addEventListener("click", () => sendCast("warrior"));
mage.castBtn.addEventListener("click", () => sendCast("mage"));

function renderHero(ui, h, accent) {
  const hpPct = h.maxHp ? (h.hp / h.maxHp) * 100 : 0;
  const manaPct = h.maxMana ? (h.mana / h.maxMana) * 100 : 0;

  ui.hpFill.style.width = `${clamp(hpPct, 0, 100).toFixed(1)}%`;
  ui.manaFill.style.width = `${clamp(manaPct, 0, 100).toFixed(1)}%`;
  ui.vitals.textContent = `HP ${h.hp}/${h.maxHp}  Mana ${h.mana}/${h.maxMana}`;

  // Button state
  const canCast = h.alive && h.ability.cdRemaining === 0 && h.mana >= h.ability.manaCost;
  ui.castBtn.disabled = !canCast;
  ui.castBtn.textContent = `${h.ability.name} (${h.ability.manaCost})`;
  ui.hint.textContent = h.alive
    ? (h.ability.cdRemaining > 0
        ? `Cooldown: ${h.ability.cdRemaining}`
        : (h.mana < h.ability.manaCost ? `Need mana: ${h.ability.manaCost - h.mana}` : "Ready"))
    : "Down";

  // Slight color hint
  ui.manaFill.parentElement.style.borderColor = accent;
}

function renderLog(entries) {
  // Keep it simple: re-render (small list capped server-side).
  // Use last entry key to avoid pointless work.
  const last = entries[entries.length - 1];
  const key = last ? `${last.t}:${last.type}:${last.msg || last.ability || last.amount || ""}` : "empty";
  if (key === lastLogKey) return;
  lastLogKey = key;

  logEl.innerHTML = entries
    .slice(-60)
    .map((e) => formatLine(e))
    .join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function formatLine(e) {
  if (e.type === "system") {
    return `<div class="line"><span class="tag">[${e.t}]</span> ${escapeHtml(e.msg || "")}</div>`;
  }
  if (e.type === "cast") {
    return `<div class="line"><span class="tag">[${e.t}]</span> ${escapeHtml(e.caster)} casts <b>${escapeHtml(e.ability)}</b> (-${e.manaCost} mana)</div>`;
  }
  if (e.type === "damage") {
    const src = e.source === "ability" ? "spell" : "hit";
    return `<div class="line"><span class="tag">[${e.t}]</span> ${escapeHtml(e.attacker)} ${src} ${escapeHtml(e.defender)} for <b>${e.amount}</b> (HP ${e.defenderHp})</div>`;
  }
  return `<div class="line"><span class="tag">[${e.t}]</span> ${escapeHtml(JSON.stringify(e))}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(state) {
  metaEl.textContent = `Match ${state.matchId} · tick ${state.tick} · ${state.phase}`;
  renderHero(warrior, state.heroes.warrior, "rgba(240,201,106,0.45)");
  renderHero(mage, state.heroes.mage, "rgba(240,201,106,0.45)");
  renderLog(state.log || []);
}

connect();
