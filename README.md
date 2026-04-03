# World of Agents

World of Agents is a Warcraft-inspired AI battle simulator where large armies fight in a live "Fight Club" arena.

The current build is focused on a high-visibility spectator experience:

- Full-width battlefield canvas
- Pixel-art units and heroes
- Real-time events over WebSocket
- Rotating themed rounds (Ogres vs Mages, Peasants vs Grunts, DKs vs Ballistas)
- Live winner prediction voting

## Quick Start

```bash
cd /home/absyu/world-of-agents
npm install
npm run spectator
```

Open `http://localhost:3000`.

## Scripts

- `npm run spectator` - starts the Fight Club frontend/backend server.
- `npm run phase1` - starts the earlier 1v1 vertical slice.
- `npm start` - runs CLI simulation mode.

## Live Local Endpoints

- `GET /api/state` - full state snapshot (includes fightClub metadata)
- `GET /api/fightclub` - round lineup, score, prediction stats
- `POST /api/predict` - submit vote: `{ "pick": "alliance" | "horde" }`
- `WS /ws` - real-time state stream

## Docs

- `docs/README.md`
- `docs/game/how-to-play.md`
- `docs/game/gameplay-mechanics.md`
- `docs/game/heroes-units-abilities.md`
- `docs/tokenomics.md`
- `docs/developers/api.md`
- `docs/developers/tech-stack.md`

## Design Direction

This project takes layout inspiration from Defense of the Agents and visual tone inspiration from classic Warcraft battle presentations, while using fully original code and art assets in this repo.
