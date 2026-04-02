/**
 * Unit Module - World of Agents
 * Minimal lane creeps with simple positions.
 *
 * Positions are in lane-space: -100 (Alliance stronghold) to +100 (Horde stronghold).
 */

let nextUnitId = 1;

export const UNIT_TYPES = {
  FOOTMAN: { name: "Footman", maxHp: 50, damage: 6, speed: 4 },
  GRUNT: { name: "Grunt", maxHp: 50, damage: 6, speed: 4 },
  RIFLEMAN: { name: "Rifleman", maxHp: 35, damage: 5, speed: 4 },
  AXETHROWER: { name: "Axethrower", maxHp: 35, damage: 5, speed: 4 },
};

export function createUnit(type, faction) {
  const def = UNIT_TYPES[type];
  if (!def) throw new Error(`Unknown unit type: ${type}`);

  const from = faction === "alliance" ? -95 : 95;
  return {
    id: `u_${nextUnitId++}`,
    type,
    name: def.name,
    faction,
    hp: def.maxHp,
    maxHp: def.maxHp,
    damage: def.damage,
    speed: def.speed,
    pos: from,
    attackCd: 0,
  };
}

export function isUnitAlive(u) {
  return u.hp > 0;
}

export function stepUnitCooldown(u) {
  if (u.attackCd > 0) u.attackCd--;
}

export function dealDamageToUnit(u, dmg) {
  const actual = Math.min(u.hp, dmg);
  u.hp = Math.max(0, u.hp - dmg);
  return actual;
}

export function clampLanePos(pos) {
  return Math.max(-100, Math.min(100, pos));
}
