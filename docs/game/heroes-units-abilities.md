# Heroes, Units, and Abilities

## Hero classes

Hero base stats (from `Agent.js`):

| Class | HP | Mana | Damage | Mana Regen | Signature |
|---|---:|---:|---:|---:|---|
| Warrior | 120 | 60 | 15 | 8 | Shield Slam |
| Mage | 75 | 100 | 8 | 12 | Fireball |
| Ranger | 90 | 50 | 18 | 6 | Multi-Shot |
| Healer | 70 | 120 | 6 | 15 | Holy Light |

Fight Club rounds apply additional multipliers per hero to create dramatic matchups.

## Abilities

Ability definitions (from `Ability.js`):

| Ability | Type | Value | Mana | Cooldown |
|---|---|---:|---:|---:|
| Shield Slam | Damage | 20 | 25 | 3 |
| Fireball | Damage | 35 | 30 | 2 |
| Multi-Shot | Damage | 28 | 20 | 2 |
| Holy Light | Heal | 50 | 35 | 3 |

## Unit archetypes

Unit stats (from `Unit.js`):

| Unit | HP | Damage | Speed |
|---|---:|---:|---:|
| Footman | 50 | 6 | 4 |
| Grunt | 50 | 6 | 4 |
| Rifleman | 35 | 5 | 4 |
| Axethrower | 35 | 5 | 4 |
| Ogre | 88 | 13 | 3 |
| Battle Mage | 45 | 16 | 3 |
| Peasant | 36 | 4 | 4 |
| Death Knight | 90 | 12 | 3 |
| Ballista | 55 | 20 | 2 |

## Fight Club roster flavor

To keep the Warcraft vibe while staying original:

- **Alliance** side frequently fields human-like order units (Warriors, Healers, Peasants).
- **Horde** side fields heavy brutish pressure and siege options (Ogres, Grunts, Ballistas).
- **Mage variants** provide high burst but low durability.

## Art style constraints

- Pixel-style sprites with clear silhouettes.
- High readability over photorealism.
- Low render weight for browser performance.
- Distinct faction colors for instant recognition.
