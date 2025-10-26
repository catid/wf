# Warning Forever Tribute

A browser-based homage to *Warning Forever*, featuring fast-paced duels against an evolving boss ship rendered with vector-inspired effects.

## Static bundle

Everything now lives exactly where the CDN expects it: the checked-in `dist/` directory already contains `index.html` plus every asset under `dist/static/`. There is no export step, npm script, or bundler—what you see in git is what gets deployed.

To poke at the game locally:

```bash
# Serve straight from dist/ (recommended so audio works)
python -m http.server --directory dist 8000

# …or use the included Flask helper for a tiny dev server
pip install -r requirements.txt
python server.py
```

`server.py` simply serves `dist/index.html` with Flask’s auto-reloader; any HTTP server pointed at `dist/` works.

## Cloudflare deployment

Cloudflare’s CI runner now just needs to push the ready-made bundle. The repository includes a minimal Worker (`worker.js`) plus `wrangler.toml`, so the Pages job can run:

```bash
npx wrangler deploy
```

Wrangler uploads the `dist/` assets (declared in `wrangler.toml`) and binds them to the Worker, which in turn serves the static files and falls back to `index.html` for navigation routes. If you run this command outside Cloudflare’s build environment, make sure the usual credentials are present (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` or `wrangler login`).

## Controls & Mechanics

- Thrust with `WASD` or the arrow keys; the ship auto-fires a vertical stream.
- Bosses grow as branching armatures—sever junctions to drop entire limbs before they overwhelm you.
- Different weapon pods escalate with difficulty: cannons, spreads, shatter volleys, lasers, homing missiles, and end-game storms.
- Thrusters live at the branch tips and fuel the boss’ movement; core hits ripple damage across the whole tree.
- When only the core survives, it goes berserk with mixed weapon barrages—stay mobile to outlast it.
- Destroy components quickly to build your combo multiplier and stack score bonuses.

## Project Structure

- `dist/index.html` – Game shell already wired to the assets.
- `dist/static/js/game.js` – Canvas-based game logic, player controls, boss AI, and rendering.
- `dist/static/css/style.css` – Retro vector look and HUD styling.
- `dist/static/audio/` – Music loops that keep the duels tense.
- `worker.js` – Minimal Worker that proxies requests to the bundled assets.
- `wrangler.toml` – Config binding `dist/` to Wrangler’s asset uploader so `npx wrangler deploy` “just works”.

## Notes

- The Flask server (`server.py`) runs with debug mode enabled purely for local iteration.
- To reset your environment, deactivate the shell, remove `.venv`, reinstall `pip install -r requirements.txt`, and rerun `python server.py`.
