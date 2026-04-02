/**
 * Ability Module - World of Agents Phase 2
 * Handles ability definitions with mana costs and cooldowns
 */

export function createAbility(name, damage, manaCost, cooldown, type = "damage") {
  return {
    name,
    damage,
    manaCost,
    cooldown,
    currentCooldown: 0,
    type, // "damage" or "heal"
  };
}

export function isAbilityReady(ability) {
  return ability.currentCooldown === 0;
}

export function canAffordAbility(agent, ability) {
  return agent.mana >= ability.manaCost;
}

export function triggerCooldown(ability) {
  ability.currentCooldown = ability.cooldown;
}

export function reduceCooldown(ability) {
  if (ability.currentCooldown > 0) {
    ability.currentCooldown--;
  }
}

// Preset abilities for classes
export const ABILITIES = {
  // Warrior abilities
  SHIELD_SLAM: () => createAbility("Shield Slam", 20, 25, 3),
  
  // Mage abilities
  FIREBALL: () => createAbility("Fireball", 35, 30, 2),
  BLIZZARD: () => createAbility("Blizzard", 40, 40, 4),
  
  // Ranger abilities
  MULTI_SHOT: () => createAbility("Multi-Shot", 28, 20, 2),
  
  // Healer abilities — "damage" field is the heal amount, type = "heal"
  HOLY_LIGHT: () => createAbility("Holy Light", 50, 35, 3, "heal"),
};
