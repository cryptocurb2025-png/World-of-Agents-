import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { createAgent } from "./Agent.js";
import { createGameState, addHeroToGame, getFullGameStatus } from "./GameState.js";
import { processTick } from "./CombatEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = Number(process.env.TICK_RATE || 10);
const BROADCAST_RATE = Number(process.env.BROADCAST_RATE || 10);

const DATA_DIR = path.join(__dirname, "data");
const REWARD_LEDGER_FILE = path.join(DATA_DIR, "reward-ledger.json");
const WOA_PER_GOLD = 1 / 20;
const WOA_PER_ROUND_CAP = 120;

const FIGHT_CLUB_ROUNDS = [
  {
    id: "ogres-vs-mages",
    title: "Round 1: Ogres vs Mages",
    subtitle: "Brutality vs Polymorph trickery",
    durationTicks: 520,
    spawnConfig: {
      top: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
      mid: { spawnEvery: 2, maxPerSide: 48, burst: 2, allianceType: "OGRE", hordeType: "BATTLE_MAGE" },
      bot: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
    },
    allianceHero: {
      name: "Drokhan Ogre Chief",
      classType: "WARRIOR",
      lane: "mid",
      hpScale: 1.45,
      damageScale: 1.35,
      manaScale: 0.8,
    },
    hordeHero: {
      name: "Archmage Selindra",
      classType: "MAGE",
      lane: "mid",
      hpScale: 1.0,
      damageScale: 1.5,
      manaScale: 1.3,
    },
  },
  {
    id: "peasants-vs-grunts",
    title: "Round 2: Peasants vs Grunts",
    subtitle: "Numbers and grit against raw Orc power",
    durationTicks: 520,
    spawnConfig: {
      top: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
      mid: { spawnEvery: 2, maxPerSide: 64, burst: 3, allianceType: "PEASANT", hordeType: "GRUNT" },
      bot: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
    },
    allianceHero: {
      name: "Foreman Brigg",
      classType: "HEALER",
      lane: "mid",
      hpScale: 1.1,
      damageScale: 1.0,
      manaScale: 1.25,
    },
    hordeHero: {
      name: "Gor'mak Warleader",
      classType: "RANGER",
      lane: "mid",
      hpScale: 1.35,
      damageScale: 1.35,
      manaScale: 0.9,
    },
  },
  {
    id: "dk-vs-ballistas",
    title: "Round 3: Death Knights vs Ballistas",
    subtitle: "Dark riders charging through siege volleys",
    durationTicks: 560,
    spawnConfig: {
      top: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
      mid: { spawnEvery: 1, maxPerSide: 72, burst: 4, allianceType: "DEATH_KNIGHT", hordeType: "BALLISTA" },
      bot: { spawnEvery: 99999, maxPerSide: 0, burst: 0, allianceType: "PEASANT", hordeType: "PEASANT" },
    },
    allianceHero: {
      name: "Morvane the Fallen",
      classType: "WARRIOR",
      lane: "mid",
      hpScale: 1.6,
      damageScale: 1.4,
      manaScale: 1.0,
    },
    hordeHero: {
      name: "Iron Siege Marshal",
      classType: "MAGE",
      lane: "mid",
      hpScale: 1.15,
      damageScale: 1.2,
      manaScale: 1.4,
    },
  },
];

const fightClub = {
  roundIndex: 0,
  wins: { alliance: 0, horde: 0 },
  history: [],
  predictions: Object.fromEntries(FIGHT_CLUB_ROUNDS.map((r) => [r.id, { alliance: 0, horde: 0 }])),
};

const rewardLedger = loadRewardLedger();

function loadRewardLedger() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(REWARD_LEDGER_FILE)) {
    const initial = {
      factions: { alliance: 0, horde: 0 },
      rounds: [],
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(REWARD_LEDGER_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }

  try {
    const raw = fs.readFileSync(REWARD_LEDGER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      factions: parsed.factions || { alliance: 0, horde: 0 },
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return {
      factions: { alliance: 0, horde: 0 },
      rounds: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

function persistRewardLedger() {
  rewardLedger.updatedAt = new Date().toISOString();
  fs.writeFileSync(REWARD_LEDGER_FILE, JSON.stringify(rewardLedger, null, 2), "utf8");
}

function estimateRoundWoa(state, winner) {
  const allianceGold = state.heroes.alliance.reduce((acc, h) => acc + h.gold, 0);
  const hordeGold = state.heroes.horde.reduce((acc, h) => acc + h.gold, 0);

  const aw = winner === "alliance" ? 1.1 : winner === "draw" ? 1.0 : 0.9;
  const hw = winner === "horde" ? 1.1 : winner === "draw" ? 1.0 : 0.9;

  const allianceWoa = Math.min(WOA_PER_ROUND_CAP, Math.floor(allianceGold * aw * WOA_PER_GOLD));
  const hordeWoa = Math.min(WOA_PER_ROUND_CAP, Math.floor(hordeGold * hw * WOA_PER_GOLD));

  return {
    allianceGold,
    hordeGold,
    allianceWoa,
    hordeWoa,
  };
}

let gameState = initRoundState(fightClub.roundIndex);

function initRoundState(index) {
  const round = FIGHT_CLUB_ROUNDS[index];
  const state = createGameState(`fightclub_${round.id}_${Date.now()}`);
  state.spawnConfig = round.spawnConfig;

  const allianceHero = createScaledHero(round.allianceHero);
  const hordeHero = createScaledHero(round.hordeHero);

  addHeroToGame(state, allianceHero, "alliance", round.allianceHero.lane || "mid");
  addHeroToGame(state, hordeHero, "horde", round.hordeHero.lane || "mid");

  return state;
}

function createScaledHero(def) {
  const hero = createAgent(def.name, def.classType);
  hero.maxHp = Math.floor(hero.maxHp * (def.hpScale || 1));
  hero.hp = hero.maxHp;
  hero.damage = Math.max(1, Math.floor(hero.damage * (def.damageScale || 1)));
  hero.maxMana = Math.floor(hero.maxMana * (def.manaScale || 1));
  hero.mana = hero.maxMana;
  return hero;
}

function finalizeRoundAndAdvance() {
  const round = FIGHT_CLUB_ROUNDS[fightClub.roundIndex];
  const winner = resolveRoundWinner(gameState);
  const rewards = estimateRoundWoa(gameState, winner);

  if (winner === "alliance" || winner === "horde") {
    fightClub.wins[winner]++;
  }

  fightClub.history.push({
    roundId: round.id,
    title: round.title,
    winner,
    tick: gameState.tick,
    endedAt: new Date().toISOString(),
    rewards,
  });

  if (fightClub.history.length > 12) {
    fightClub.history = fightClub.history.slice(-12);
  }

  rewardLedger.factions.alliance += rewards.allianceWoa;
  rewardLedger.factions.horde += rewards.hordeWoa;
  rewardLedger.rounds.push({
    roundId: round.id,
    winner,
    tick: gameState.tick,
    rewards,
    endedAt: new Date().toISOString(),
  });
  if (rewardLedger.rounds.length > 400) {
    rewardLedger.rounds = rewardLedger.rounds.slice(-400);
  }
  persistRewardLedger();

  fightClub.roundIndex = (fightClub.roundIndex + 1) % FIGHT_CLUB_ROUNDS.length;
  gameState = initRoundState(fightClub.roundIndex);
}

function resolveRoundWinner(state) {
  if (state.winner) return state.winner;

  const aBase = state.strongholds.alliance.hp;
  const hBase = state.strongholds.horde.hp;
  if (aBase > hBase) return "alliance";
  if (hBase > aBase) return "horde";

  const aTower = aliveTowers(state, "alliance");
  const hTower = aliveTowers(state, "horde");
  if (aTower > hTower) return "alliance";
  if (hTower > aTower) return "horde";

  const aArmy = totalArmyPower(state, "alliance");
  const hArmy = totalArmyPower(state, "horde");
  if (aArmy > hArmy) return "alliance";
  if (hArmy > aArmy) return "horde";

  return "draw";
}

function aliveTowers(state, faction) {
  let count = 0;
  for (const laneName of ["top", "mid", "bot"]) {
    for (const tower of state.towers[laneName][faction]) {
      if (tower.alive) count++;
    }
  }
  return count;
}

function totalArmyPower(state, faction) {
  let unitCount = 0;
  for (const laneName of ["top", "mid", "bot"]) {
    unitCount += state.lanes[laneName].units[faction].length;
  }
  let heroHp = 0;
  for (const hero of state.heroes[faction]) {
    heroHp += hero.hp;
  }
  return unitCount * 10 + heroHp;
}

function getFightClubSummary() {
  const round = FIGHT_CLUB_ROUNDS[fightClub.roundIndex];
  const prediction = fightClub.predictions[round.id] || { alliance: 0, horde: 0 };
  const totalPredictions = prediction.alliance + prediction.horde;
  return {
    round,
    roundTick: gameState.tick,
    rounds: FIGHT_CLUB_ROUNDS,
    wins: fightClub.wins,
    history: fightClub.history,
    prediction: {
      ...prediction,
      total: totalPredictions,
      alliancePct: totalPredictions ? Math.round((prediction.alliance / totalPredictions) * 100) : 50,
      hordePct: totalPredictions ? Math.round((prediction.horde / totalPredictions) * 100) : 50,
    },
    rewards: {
      totalAlliance: rewardLedger.factions.alliance,
      totalHorde: rewardLedger.factions.horde,
      roundsTracked: rewardLedger.rounds.length,
      woaPerGold: WOA_PER_GOLD,
      perRoundCap: WOA_PER_ROUND_CAP,
    },
  };
}

function getSpectatorState() {
  return {
    ...getFullGameStatus(gameState),
    fightClub: getFightClubSummary(),
  };
}

setInterval(() => {
  processTick(gameState);
  const round = FIGHT_CLUB_ROUNDS[fightClub.roundIndex];

  if (gameState.winner || gameState.tick >= round.durationTicks) {
    finalizeRoundAndAdvance();
  }
}, Math.floor(1000 / TICK_RATE));

const publicDir = path.join(__dirname, "public");

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function safeResolvePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const cleaned = decoded.replace(/\0/g, "");
  const joined = path.join(publicDir, cleaned);
  if (!joined.startsWith(publicDir)) return null;
  return joined;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return sendText(res, 400, "Bad Request");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, getSpectatorState());
  }

  if (req.method === "GET" && pathname === "/api/fightclub") {
    return sendJson(res, 200, getFightClubSummary());
  }

  if (req.method === "GET" && pathname === "/api/rewards") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
    return sendJson(res, 200, {
      totals: rewardLedger.factions,
      woaPerGold: WOA_PER_GOLD,
      perRoundCap: WOA_PER_ROUND_CAP,
      recentRounds: rewardLedger.rounds.slice(-limit).reverse(),
      updatedAt: rewardLedger.updatedAt,
    });
  }

  if (req.method === "POST" && pathname === "/api/predict") {
    try {
      const body = await readJsonBody(req);
      const pick = String(body.pick || "").toLowerCase();
      if (pick !== "alliance" && pick !== "horde") {
        return sendJson(res, 400, { error: "pick must be 'alliance' or 'horde'" });
      }
      const round = FIGHT_CLUB_ROUNDS[fightClub.roundIndex];
      fightClub.predictions[round.id][pick]++;
      return sendJson(res, 200, { ok: true, fightClub: getFightClubSummary() });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method !== "GET") {
    return sendText(res, 405, "Method Not Allowed");
  }

  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = safeResolvePublicPath(targetPath);
  if (!resolved) return sendText(res, 403, "Forbidden");

  fs.readFile(resolved, (err, data) => {
    if (err) return sendText(res, 404, "Not Found");

    const ext = path.extname(resolved).toLowerCase();
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", data: getSpectatorState() }));
});

setInterval(() => {
  const payload = JSON.stringify({ type: "state", data: getSpectatorState() });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}, Math.floor(1000 / BROADCAST_RATE));

server.listen(PORT, () => {
  console.log("World of Agents Fight Club server running:");
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/api/state`);
  console.log(`  http://localhost:${PORT}/api/fightclub`);
  console.log(`  http://localhost:${PORT}/api/rewards`);
  console.log(`  ws://localhost:${PORT}/ws`);
});
