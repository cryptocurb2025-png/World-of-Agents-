# How To Play (Fight Club Mode)

This phase is a spectator-first Warcraft-style arena where AI armies fight continuously.

## 1) Run the game

```bash
cd /home/absyu/world-of-agents
npm install
npm run spectator
```

Open `http://localhost:3000`.

## 2) Watch the active round

At the top of the page you will see the current matchup and score:

- Round 1: Ogres vs Mages
- Round 2: Peasants vs Grunts
- Round 3: Death Knights vs Ballistas

Rounds rotate automatically when duration expires or a side wins early.

## 3) Predict the winner

Use the in-page buttons:

- `Alliance`
- `Horde`

Votes are sent to `POST /api/predict` and percentages update live.

## 4) Read live battlefield state

- UI state stream: `ws://localhost:3000/ws`
- Snapshot endpoint: `GET /api/state`

The canvas draws heroes, units, structures, and combat impact effects from recent events.

## 5) Validate backend quickly

```bash
curl -s http://localhost:3000/api/fightclub
curl -s http://localhost:3000/api/state
curl -s -X POST http://localhost:3000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"pick":"alliance"}'
```

## Notes

- This mode is intentionally lightweight (Canvas + Node + WebSocket).
- It targets smooth performance on normal laptops without heavy GPU requirements.
