/**
 * CombatEngine Module - World of Agents Phase 3
 * Handles lane-based combat with towers and strongholds
 */

import {
  isAlive,
  spendMana,
  regenMana,
  earnGold,
  takeDamage,
  healAgent,
  getStatus,
  respawnAgent,
  addKill,
  addDeath,
} from "./Agent.js";
import {
  isAbilityReady,
  canAffordAbility,
  triggerCooldown,
  reduceCooldown,
} from "./Ability.js";
import { updateFrontline, recomputeFrontlineFromUnits, getHeroInLane, LANE_NAMES } from "./Lane.js";
import { createUnit, isUnitAlive, stepUnitCooldown, dealDamageToUnit, clampLanePos } from "./Unit.js";
import {
  getActiveTower,
  damageTower,
  towerAttack,
  canTowerAttack,
  reduceTowerCooldown,
  isTowerAlive,
} from "./Tower.js";
import {
  damageStronghold,
  regenStronghold,
  canAttackStronghold,
  checkVictory,
} from "./Stronghold.js";
import { logEvent, advanceTick, setWinner } from "./GameState.js";

// Economy constants
const GOLD_PER_DAMAGE = 0.5;
const GOLD_ON_HERO_KILL = 50;
const GOLD_ON_TOWER_KILL = 100;
const GOLD_ON_VICTORY = 200;

// Respawn tracking
const RESPAWN_TIME = 5; // ticks
const deadHeroes = new Map(); // hero -> tick when they can respawn

// Minimal creep system
const CREEP_SPAWN_EVERY = 3; // ticks
const CREEP_MAX_PER_SIDE = 18; // per lane
const CREEP_ENGAGE_DIST = 6;
const CREEP_ATTACK_CD = 2;
const TOWER_POS = {
  alliance: { outer: -40, inner: -70 },
  horde: { outer: 40, inner: 70 },
};

function getLaneSpawnConfig(gameState, laneName) {
  const defaultConfig = {
    spawnEvery: CREEP_SPAWN_EVERY,
    maxPerSide: CREEP_MAX_PER_SIDE,
    allianceType: "FOOTMAN",
    hordeType: "GRUNT",
    burst: 1,
  };

  const cfg = gameState.spawnConfig?.[laneName];
  if (!cfg) return defaultConfig;

  return {
    spawnEvery: Number(cfg.spawnEvery || defaultConfig.spawnEvery),
    maxPerSide: Number(cfg.maxPerSide || defaultConfig.maxPerSide),
    allianceType: cfg.allianceType || defaultConfig.allianceType,
    hordeType: cfg.hordeType || defaultConfig.hordeType,
    burst: Number(cfg.burst || defaultConfig.burst),
  };
}

function awardGold(agent, damage, bonus = 0) {
  const damageGold = Math.floor(damage * GOLD_PER_DAMAGE);
  const total = damageGold + bonus;
  earnGold(agent, total);
  return total;
}

export function heroBasicAttack(attacker, defender, gameState) {
  const damage = takeDamage(defender, attacker.damage);
  const isKill = !isAlive(defender);
  const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);

  logEvent(gameState, "hero_attack", {
    attacker: attacker.name,
    defender: defender.name,
    damage,
    defenderHp: defender.hp,
    gold: goldEarned,
  });

  if (isKill) {
    addKill(attacker);
    addDeath(defender);
    deadHeroes.set(defender, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: attacker.name,
      victim: defender.name,
    });
  }

  return { damage, isKill, goldEarned };
}

export function heroUseAbility(attacker, defender, gameState) {
  const ability = attacker.ability;
  spendMana(attacker, ability.manaCost);
  triggerCooldown(ability);

  // Healing ability — heals self (only 1 hero per faction per lane)
  if (ability.type === "heal") {
    const healed = healAgent(attacker, ability.damage);
    logEvent(gameState, "ability_used", {
      attacker: attacker.name,
      ability: ability.name,
      type: "heal",
      healed,
      hp: attacker.hp,
    });
    return { healed, isKill: false, goldEarned: 0, abilityName: ability.name };
  }

  // Damage ability
  const damage = takeDamage(defender, ability.damage);
  const isKill = !isAlive(defender);
  const goldEarned = awardGold(attacker, damage, isKill ? GOLD_ON_HERO_KILL : 0);

  logEvent(gameState, "ability_used", {
    attacker: attacker.name,
    defender: defender.name,
    ability: ability.name,
    type: "damage",
    damage,
    defenderHp: defender.hp,
    gold: goldEarned,
  });

  if (isKill) {
    addKill(attacker);
    addDeath(defender);
    deadHeroes.set(defender, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: attacker.name,
      victim: defender.name,
    });
  }

  return { damage, isKill, goldEarned, abilityName: ability.name };
}

export function canUseAbility(agent) {
  return isAbilityReady(agent.ability) && canAffordAbility(agent, agent.ability);
}

export function heroAttackTower(hero, tower, gameState) {
  const damage = damageTower(tower, hero.damage);
  const isDestroyed = !isTowerAlive(tower);
  const goldEarned = awardGold(hero, damage, isDestroyed ? GOLD_ON_TOWER_KILL : 0);

  logEvent(gameState, "tower_attacked", {
    attacker: hero.name,
    tower: tower.id,
    damage,
    towerHp: tower.hp,
    destroyed: isDestroyed,
    gold: goldEarned,
  });

  if (isDestroyed) {
    logEvent(gameState, "tower_destroyed", {
      tower: tower.id,
      faction: tower.faction,
      lane: tower.lane,
      destroyer: hero.name,
    });
  }

  return { damage, isDestroyed, goldEarned };
}

export function heroAttackStronghold(hero, stronghold, gameState) {
  const damage = damageStronghold(stronghold, hero.damage, gameState.tick);
  const goldEarned = awardGold(hero, damage, 0);

  logEvent(gameState, "stronghold_attacked", {
    attacker: hero.name,
    faction: stronghold.faction,
    damage,
    strongholdHp: stronghold.hp,
  });

  return { damage, goldEarned };
}

export function towerAttackHero(tower, hero, gameState) {
  if (!canTowerAttack(tower)) return null;

  const wasAlive = isAlive(hero);
  const result = towerAttack(tower, hero);
  const damage = takeDamage(hero, result.damage);

  logEvent(gameState, "tower_attack", {
    tower: tower.id,
    target: hero.name,
    damage,
    targetHp: hero.hp,
  });

  // Register kill if tower finished the hero off
  if (wasAlive && !isAlive(hero)) {
    addDeath(hero);
    deadHeroes.set(hero, gameState.tick + RESPAWN_TIME);
    logEvent(gameState, "hero_kill", {
      killer: tower.id,
      victim: hero.name,
    });
  }

  return { damage, targetHp: hero.hp };
}

function getEnemyFaction(faction) {
  return faction === "alliance" ? "horde" : "alliance";
}

function processLaneCombat(gameState, laneName) {
  const lane = gameState.lanes[laneName];
  const towers = gameState.towers[laneName];
  const spawnCfg = getLaneSpawnConfig(gameState, laneName);

  // 1) Spawn creeps
  if (gameState.tick % spawnCfg.spawnEvery === 0) {
    for (let n = 0; n < spawnCfg.burst; n++) {
      if (lane.units.alliance.length < spawnCfg.maxPerSide) {
        lane.units.alliance.push(createUnit(spawnCfg.allianceType, "alliance"));
      }
      if (lane.units.horde.length < spawnCfg.maxPerSide) {
        lane.units.horde.push(createUnit(spawnCfg.hordeType, "horde"));
      }
    }
  }

  // 2) Step creep combat + movement
  stepCreeps(lane);

  // 3) Creeps damage towers if they reach them
  creepsAttackTowers(gameState, lane, towers);

  for (const faction of ["alliance", "horde"]) {
    const hero = getHeroInLane(lane, faction);
    if (!hero || !isAlive(hero)) continue;

    const enemyFaction = getEnemyFaction(faction);
    const enemyHero = getHeroInLane(lane, enemyFaction);

    // Mana regen
    regenMana(hero);

    // Determine target priority:
    // 1. Enemy hero in same lane (if alive)
    // 2. Enemy tower (if frontline is pushed enough)
    // 3. Enemy stronghold (if all towers destroyed)

    if (enemyHero && isAlive(enemyHero)) {
      // Fight enemy hero — but healers prefer to heal themselves if damaged
      if (canUseAbility(hero) && (hero.ability.type === "heal" ? hero.hp < hero.maxHp : true)) {
        heroUseAbility(hero, enemyHero, gameState);
      } else if (hero.ability.type !== "heal") {
        heroBasicAttack(hero, enemyHero, gameState);
      } else {
        // Healer with no ability ready — basic attacks
        heroBasicAttack(hero, enemyHero, gameState);
      }
    } else {
      // No enemy hero, attack structures
      const enemyTower = getActiveTower(towers, enemyFaction, lane.frontline);

      if (enemyTower && isTowerAlive(enemyTower)) {
        heroAttackTower(hero, enemyTower, gameState);
      } else if (canAttackStronghold(gameState.towers, faction, laneName)) {
        // All towers destroyed, attack stronghold
        heroAttackStronghold(hero, gameState.strongholds[enemyFaction], gameState);
      }
    }

    // Reduce ability cooldowns
    reduceCooldown(hero.ability);
  }

  // Towers attack enemy heroes (only if enemy is pushing into tower range)
  for (const faction of ["alliance", "horde"]) {
    const enemyFaction = getEnemyFaction(faction);
    const enemyHero = getHeroInLane(lane, enemyFaction);

    if (!enemyHero || !isAlive(enemyHero)) continue;

    // Only attack if enemy has pushed toward this faction's base
    const towerCanAttack = (faction === "alliance" && lane.frontline < -50) ||
                           (faction === "horde" && lane.frontline > 50);
    
    if (!towerCanAttack) continue;

    for (const tower of towers[faction]) {
      if (isTowerAlive(tower)) {
        towerAttackHero(tower, enemyHero, gameState);
        reduceTowerCooldown(tower);
      }
    }
  }

  // Update frontline based on power
  recomputeFrontlineFromUnits(lane);
  updateFrontline(lane);
}

function stepCreeps(lane) {
  const a = lane.units.alliance;
  const h = lane.units.horde;

  // Cooldowns
  for (const u of a) stepUnitCooldown(u);
  for (const u of h) stepUnitCooldown(u);

  // Movement + combat: pair closest opposing units near the frontline.
  // We keep it O(n)ish by sorting by position occasionally.
  a.sort((x, y) => x.pos - y.pos);
  h.sort((x, y) => x.pos - y.pos);

  // Move units toward enemy
  for (const u of a) {
    if (!isUnitAlive(u)) continue;
    u.pos = clampLanePos(u.pos + u.speed);
  }
  for (const u of h) {
    if (!isUnitAlive(u)) continue;
    u.pos = clampLanePos(u.pos - u.speed);
  }

  // Resolve engagements where units overlap
  // Use two pointers to find close encounters.
  let i = 0;
  let j = 0;
  while (i < a.length && j < h.length) {
    const ua = a[i];
    const uh = h[j];
    if (!isUnitAlive(ua)) {
      i++;
      continue;
    }
    if (!isUnitAlive(uh)) {
      j++;
      continue;
    }

    const dist = Math.abs(ua.pos - uh.pos);
    if (dist <= CREEP_ENGAGE_DIST) {
      // Trade hits if CDs ready
      if (ua.attackCd === 0) {
        dealDamageToUnit(uh, ua.damage);
        ua.attackCd = CREEP_ATTACK_CD;
      }
      if (uh.attackCd === 0) {
        dealDamageToUnit(ua, uh.damage);
        uh.attackCd = CREEP_ATTACK_CD;
      }
      // Advance pointers to progress through the pack
      if (!isUnitAlive(ua)) i++;
      if (!isUnitAlive(uh)) j++;
      if (isUnitAlive(ua) && isUnitAlive(uh)) {
        // Slight nudge to avoid permanent overlap
        ua.pos = clampLanePos(ua.pos - 1);
        uh.pos = clampLanePos(uh.pos + 1);
        i++;
        j++;
      }
    } else {
      // If alliance unit is behind horde unit (shouldn't happen often), advance the lagging side.
      if (ua.pos < uh.pos) i++;
      else j++;
    }
  }

  // Cleanup dead units
  lane.units.alliance = a.filter(isUnitAlive);
  lane.units.horde = h.filter(isUnitAlive);
}

function creepsAttackTowers(gameState, lane, towers) {
  // Horde towers are at +40/+70, alliance at -40/-70.
  // If creeps cross into tower position, they chip it.
  const aFront = lane.units.alliance.length ? Math.max(...lane.units.alliance.map((u) => u.pos)) : -100;
  const hFront = lane.units.horde.length ? Math.min(...lane.units.horde.map((u) => u.pos)) : 100;

  // Alliance creeps attack Horde towers
  const hOuter = towers.horde[0];
  const hInner = towers.horde[1];
  if (hOuter.alive && aFront >= TOWER_POS.horde.outer) {
    const dmg = Math.max(1, Math.floor(lane.units.alliance.length * 2));
    const dealt = damageTower(hOuter, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: hOuter.id, target: hOuter.id, damage: dealt, targetHp: hOuter.hp });
      if (!hOuter.alive) logEvent(gameState, "tower_destroyed", { tower: hOuter.id, faction: hOuter.faction, lane: hOuter.lane, destroyer: "creeps" });
    }
  } else if (!hOuter.alive && hInner.alive && aFront >= TOWER_POS.horde.inner) {
    const dmg = Math.max(1, Math.floor(lane.units.alliance.length * 2));
    const dealt = damageTower(hInner, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: hInner.id, target: hInner.id, damage: dealt, targetHp: hInner.hp });
      if (!hInner.alive) logEvent(gameState, "tower_destroyed", { tower: hInner.id, faction: hInner.faction, lane: hInner.lane, destroyer: "creeps" });
    }
  }

  // Horde creeps attack Alliance towers
  const aOuter = towers.alliance[0];
  const aInner = towers.alliance[1];
  if (aOuter.alive && hFront <= TOWER_POS.alliance.outer) {
    const dmg = Math.max(1, Math.floor(lane.units.horde.length * 2));
    const dealt = damageTower(aOuter, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: aOuter.id, target: aOuter.id, damage: dealt, targetHp: aOuter.hp });
      if (!aOuter.alive) logEvent(gameState, "tower_destroyed", { tower: aOuter.id, faction: aOuter.faction, lane: aOuter.lane, destroyer: "creeps" });
    }
  } else if (!aOuter.alive && aInner.alive && hFront <= TOWER_POS.alliance.inner) {
    const dmg = Math.max(1, Math.floor(lane.units.horde.length * 2));
    const dealt = damageTower(aInner, dmg);
    if (dealt > 0) {
      logEvent(gameState, "tower_attack", { tower: aInner.id, target: aInner.id, damage: dealt, targetHp: aInner.hp });
      if (!aInner.alive) logEvent(gameState, "tower_destroyed", { tower: aInner.id, faction: aInner.faction, lane: aInner.lane, destroyer: "creeps" });
    }
  }
}

function processRespawns(gameState) {
  for (const [hero, respawnTick] of deadHeroes.entries()) {
    if (gameState.tick >= respawnTick) {
      respawnAgent(hero);
      deadHeroes.delete(hero);
      logEvent(gameState, "hero_respawn", {
        hero: hero.name,
        lane: hero.lane,
      });
    }
  }
}

export function processTick(gameState) {
  advanceTick(gameState);

  // Process respawns first
  processRespawns(gameState);

  // Process combat in each lane
  for (const laneName of LANE_NAMES) {
    processLaneCombat(gameState, laneName);
  }

  // Stronghold regeneration
  regenStronghold(gameState.strongholds.alliance, gameState.tick);
  regenStronghold(gameState.strongholds.horde, gameState.tick);

  // Check victory condition
  const victory = checkVictory(gameState.strongholds);
  if (victory) {
    setWinner(gameState, victory.winner);

    // Award victory gold
    for (const hero of gameState.heroes[victory.winner]) {
      earnGold(hero, GOLD_ON_VICTORY);
    }
  }

  return gameState;
}

// Legacy function for backward compatibility (1v1 simulation)
export function runMatch(agent1, agent2) {
  console.log("\n=== WORLD OF AGENTS - COMBAT SIMULATION ===\n");
  console.log("Combatants:");
  console.log(`  ${getStatus(agent1)}`);
  console.log(`  ${getStatus(agent2)}`);
  console.log("\n--- BATTLE BEGIN ---\n");

  let round = 1;

  while (isAlive(agent1) && isAlive(agent2)) {
    console.log(`Round ${round}:`);

    // Mana regen
    regenMana(agent1);
    regenMana(agent2);

    // Agent 1 turn
    if (canUseAbility(agent1)) {
      const ability = agent1.ability;
      spendMana(agent1, ability.manaCost);
      triggerCooldown(ability);
      const damage = takeDamage(agent2, ability.damage);
      const gold = awardGold(agent1, damage, !isAlive(agent2) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent1.name} casts "${ability.name}" for ${damage} damage! ${agent2.name} HP: ${agent2.hp} (+${gold}g)`);
    } else {
      const damage = takeDamage(agent2, agent1.damage);
      const gold = awardGold(agent1, damage, !isAlive(agent2) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent1.name} attacks for ${damage} damage. ${agent2.name} HP: ${agent2.hp} (+${gold}g)`);
    }
    reduceCooldown(agent1.ability);

    if (!isAlive(agent2)) break;

    // Agent 2 turn
    if (canUseAbility(agent2)) {
      const ability = agent2.ability;
      spendMana(agent2, ability.manaCost);
      triggerCooldown(ability);
      const damage = takeDamage(agent1, ability.damage);
      const gold = awardGold(agent2, damage, !isAlive(agent1) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent2.name} casts "${ability.name}" for ${damage} damage! ${agent1.name} HP: ${agent1.hp} (+${gold}g)`);
    } else {
      const damage = takeDamage(agent1, agent2.damage);
      const gold = awardGold(agent2, damage, !isAlive(agent1) ? GOLD_ON_HERO_KILL : 0);
      console.log(`  ${agent2.name} attacks for ${damage} damage. ${agent1.name} HP: ${agent1.hp} (+${gold}g)`);
    }
    reduceCooldown(agent2.ability);

    console.log("");
    round++;

    if (round > 50) {
      console.log("Battle exceeded 50 rounds - ending in draw.");
      break;
    }
  }

  console.log("--- BATTLE END ---\n");

  let winner = null;
  if (!isAlive(agent2)) winner = agent1;
  else if (!isAlive(agent1)) winner = agent2;

  if (winner) {
    console.log(`Winner: ${winner.name} with ${winner.hp} HP remaining!`);
  } else {
    console.log("Result: Draw");
  }

  console.log("\n--- FINAL STATS ---");
  console.log(`  ${getStatus(agent1)}`);
  console.log(`  ${getStatus(agent2)}`);

  return { winner, rounds: round };
}
