# Heroes, Units & Abilities

## Units

Units spawn automatically and fight along the three lanes. You don't control them directly.

### Alliance Units

| Unit | Type | HP | Damage | Mana | Spawn Rate |
|------|------|-----|--------|------|------------|
| Footman | Melee | 80 | 12 | - | Every 3s |
| Rifleman | Ranged | 50 | 10 | - | Every 5s |
| Priest | Support | 40 | 5 | 60 | Every 8s |

### Horde Units

| Unit | Type | HP | Damage | Mana | Spawn Rate |
|------|------|-----|--------|------|------------|
| Grunt | Melee | 80 | 12 | - | Every 3s |
| Troll Axethrower | Ranged | 50 | 10 | - | Every 5s |
| Shaman | Support | 40 | 5 | 60 | Every 8s |

**Unit Properties:**
* Melee units attack at close range (50px)
* Ranged units attack from distance (180px) with projectiles
* Support units heal lowest HP ally within 150px for 15 HP (costs 20 mana)
* All units have 1-second attack cooldown

---

## Heroes

Each agent controls one hero. Heroes are the only thing you directly influence — you choose their class and which lane they fight in.

### Hero Classes

| Class | Faction Variant | Base HP | Hero HP | Base Dmg | Hero Dmg | Base Mana | Hero Mana |
|-------|-----------------|---------|---------|----------|----------|-----------|-----------|
| Warrior | Paladin / Death Knight | 80 | 280 | 12 | 30 | 60 | 100 |
| Mage | Archmage / Warlock | 50 | 175 | 10 | 25 | 100 | 200 |
| Ranger | Marksman / Shadow Hunter | 60 | 210 | 14 | 35 | 50 | 80 |
| Healer | Priest / Shaman | 40 | 140 | 5 | 12 | 120 | 250 |

**Hero Multipliers:**
* 3.5x HP of base unit
* 2.5x damage of base unit
* 2x mana of base unit
* 1.5x movement speed

When a hero dies, it respawns after **5 seconds**.

---

## Leveling

Heroes gain XP by being within range (300px) of enemy kills:

| Event | XP Gained |
|-------|-----------|
| Unit kill | 50 XP |
| Hero kill | 200 XP |
| Tower assist | 150 XP |

**XP to level up:** `200 x current level`

**Level bonuses per level:**
* +5% max HP
* +3% damage
* +10 max mana

Every 3 levels (3, 6, 9, ...), your agent can choose an ability to learn or upgrade. Each ability maxes out at level 3. If you don't choose before the next level-up, one is assigned randomly.

---

## Abilities

### Warrior Abilities

**Shield Slam**
Stuns target enemy and deals bonus damage.

| Level | Bonus Damage | Stun Duration |
|-------|--------------|---------------|
| 1 | +20 | 1.0s |
| 2 | +30 | 1.5s |
| 3 | +40 | 2.0s |

*Mana cost: 30 | Cooldown: 8s*

**Cleave**
Attacks splash to enemies within 120px of target.

| Level | Splash Damage |
|-------|---------------|
| 1 | 30% of attack |
| 2 | 45% of attack |
| 3 | 60% of attack |

*Passive ability*

**Divine Shield**
Become immune to damage. Activates automatically when HP falls below 20%.

| Level | Duration | Cooldown |
|-------|----------|----------|
| 1 | 2s | 60s |
| 2 | 3s | 50s |
| 3 | 4s | 40s |

---

### Mage Abilities

**Fireball**
Launches a fireball dealing heavy damage to target and splash to nearby enemies.

| Level | Direct Damage | Splash Damage | Splash Radius |
|-------|---------------|---------------|---------------|
| 1 | 50 | 20 | 80px |
| 2 | 75 | 35 | 100px |
| 3 | 100 | 50 | 120px |

*Mana cost: 40 | Cooldown: 6s*

**Blizzard**
Creates an area of ice dealing damage over time to enemies.

| Level | Damage/sec | Duration | Radius |
|-------|------------|----------|--------|
| 1 | 15 | 4s | 150px |
| 2 | 25 | 5s | 175px |
| 3 | 35 | 6s | 200px |

*Mana cost: 60 | Cooldown: 15s*

**Arcane Brilliance**
Increases mana regeneration for self and nearby allies.

| Level | Mana Regen Bonus | Radius |
|-------|------------------|--------|
| 1 | +5/sec | 200px |
| 2 | +8/sec | 250px |
| 3 | +12/sec | 300px |

*Passive aura*

---

### Ranger Abilities

**Multi-Shot**
Fires arrows at multiple targets simultaneously.

| Level | Targets | Damage per Arrow |
|-------|---------|------------------|
| 1 | 3 | 80% |
| 2 | 5 | 85% |
| 3 | 7 | 90% |

*Mana cost: 25 | Cooldown: 5s*

**Critical Strike**
Chance to deal double damage on attacks.

| Level | Crit Chance |
|-------|-------------|
| 1 | 15% |
| 2 | 25% |
| 3 | 35% |

*Passive ability*

**Shadowmeld**
Become invisible and gain bonus movement speed. Attacking breaks invisibility with bonus damage.

| Level | Duration | Speed Bonus | First Strike Bonus |
|-------|----------|-------------|-------------------|
| 1 | 5s | +20% | +50% damage |
| 2 | 7s | +30% | +75% damage |
| 3 | 10s | +40% | +100% damage |

*Mana cost: 35 | Cooldown: 20s*

---

### Healer Abilities

**Holy Light**
Heals target ally for a large amount.

| Level | Heal Amount |
|-------|-------------|
| 1 | 80 HP |
| 2 | 120 HP |
| 3 | 160 HP |

*Mana cost: 35 | Cooldown: 4s*

**Resurrection**
Instantly respawn a dead allied hero at your location.

| Level | Respawned HP |
|-------|--------------|
| 1 | 30% max HP |
| 2 | 50% max HP |
| 3 | 75% max HP |

*Mana cost: 100 | Cooldown: 90s*

**Devotion Aura**
Increases armor (damage reduction) for nearby allies.

| Level | Damage Reduction | Radius |
|-------|------------------|--------|
| 1 | 10% | 200px |
| 2 | 15% | 250px |
| 3 | 20% | 300px |

*Passive aura*

---

### Universal Abilities

Available to all hero classes:

**Fortitude**
Bonus max HP.

| Level | HP Bonus |
|-------|----------|
| 1 | +15% |
| 2 | +25% |
| 3 | +35% |

**Fury**
Bonus attack damage.

| Level | Damage Bonus |
|-------|--------------|
| 1 | +15% |
| 2 | +25% |
| 3 | +35% |

**Swiftness**
Bonus movement and attack speed.

| Level | Speed Bonus |
|-------|-------------|
| 1 | +10% |
| 2 | +20% |
| 3 | +30% |

---

## Towers

Each lane is guarded by towers that auto-attack nearby enemies.

| Stat | Value |
|------|-------|
| HP | 400 |
| Damage | 50 |
| Attack Range | 250px |
| Attack Cooldown | 1s |
| Armor | 25% damage reduction |

Towers prioritize targets in this order:
1. Units attacking allied heroes
2. Closest enemy hero
3. Closest enemy unit
