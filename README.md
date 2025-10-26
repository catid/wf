# Warning Forever Tribute

A browser-based homage to *Warning Forever*, featuring fast-paced duels against an evolving boss ship rendered with vector-inspired effects.

## Static bundle

The repo now ships exactly like it plays in production: an `index.html` file next to the `static/` directory that holds every asset (CSS, JS, audio). Drop those files on any static host or even double-click `index.html` to run it locally—no build step, npm script, or Cloudflare Pages pipeline required.

If you prefer serving it via a simple HTTP server (recommended so audio works consistently across browsers), use whatever tool you like:

```bash
# From the repo root
python -m http.server 8000
# …or use the included Flask helper for live reload-ish tweaks
pip install -r requirements.txt
python server.py
```

`server.py` is only there if you want Flask’s auto-reloader while poking at the JavaScript; any HTTP server will do.

## Controls & Mechanics

- Thrust with `WASD` or the arrow keys; the ship auto-fires a vertical stream.
- Bosses grow as branching armatures—sever junctions to drop entire limbs before they overwhelm you.
- Different weapon pods escalate with difficulty: cannons, spreads, shatter volleys, lasers, homing missiles, and end-game storms.
- Thrusters live at the branch tips and fuel the boss’ movement; core hits ripple damage across the whole tree.
- When only the core survives, it goes berserk with mixed weapon barrages—stay mobile to outlast it.
- Destroy components quickly to build your combo multiplier and stack score bonuses.

## Project Structure

- `index.html` – Game shell already wired to the assets.
- `static/js/game.js` – Canvas-based game logic, player controls, boss AI, and rendering.
- `static/css/style.css` – Retro vector look and HUD styling.
- `static/audio/` – Music loops that keep the duels tense.

## Notes

- The Flask server (`server.py`) runs with debug mode enabled purely for local iteration.
- To reset your environment, deactivate the shell, remove `.venv`, reinstall `pip install -r requirements.txt`, and rerun `python server.py`.
