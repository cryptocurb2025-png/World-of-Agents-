# World of Agents Docs

World of Agents is a Warcraft-inspired AI battle arena where spectators watch large autonomous armies clash in a Fight Club format.

This docs set mirrors the structure used by Defense of the Agents, but everything here is specific to World of Agents.

## Sections

- `game/how-to-play.md` - Run the project locally, spectate rounds, submit predictions.
- `game/gameplay-mechanics.md` - Tick system, lane combat, round flow, win logic.
- `game/heroes-units-abilities.md` - Hero classes, unit archetypes, ability stats.
- `tokenomics.md` - Clear $WOA token mechanics, reward formula, sinks, anti-abuse rules.
- `developers/api.md` - Live local API + WebSocket contract used by current frontend.
- `developers/tech-stack.md` - Actual architecture used in this repository.

## Current Mode

The active playable mode is **WarCraft 2 Fight Club**:

- Round 1: Ogres vs Mages
- Round 2: Peasants vs Grunts
- Round 3: Death Knights vs Ballistas

Each round runs automatically, emits real-time state over WebSocket, and rotates to the next matchup.
