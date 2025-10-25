# Warning Forever Tribute

A browser-based homage to *Warning Forever*, featuring fast-paced duels against an evolving boss ship rendered with vector-inspired effects. The project ships with a lightweight Python web server for easy local playtesting.

## Requirements

- [uv](https://docs.astral.sh/uv/) 0.4 or newer
- Python 3.10+ (uv will download a compatible interpreter if one is not available)

## Quickstart

```bash
# Create (or reuse) the local virtual environment
uv venv

# Activate it for the current shell session
source .venv/bin/activate

# Install server dependencies into the uv-managed venv
uv pip install -r requirements.txt

# Launch the development server
uv run python server.py
```

Once the server starts, open http://127.0.0.1:8000 to play. The game updates automatically when you change the JavaScript or CSS—just refresh the browser.

### Makefile shortcut

If you prefer, the included Makefile mirrors the commands above:

```bash
make run
```

The `run` target ensures the virtual environment exists, installs dependencies with `uv pip`, and then executes the server via `uv run`.

## Controls & Mechanics

- Thrust with `WASD` or the arrow keys; the ship auto-fires a vertical stream.
- Bosses grow as branching armatures—sever junctions to drop entire limbs before they overwhelm you.
- Different weapon pods escalate with difficulty: cannons, spreads, shatter volleys, lasers, homing missiles, and end-game storms.
- Thrusters live at the branch tips and fuel the boss’ movement; core hits ripple damage across the whole tree.
- When only the core survives, it goes berserk with mixed weapon barrages—stay mobile to outlast it.
- Destroy components quickly to build your combo multiplier and stack score bonuses.

## Project Structure

- `server.py` – Flask app that serves the static assets.
- `static/js/game.js` – Canvas-based game logic, player controls, boss AI, and rendering.
- `static/css/style.css` – Retro vector look and HUD styling.
- `templates/index.html` – Game shell and HUD layout.

## Notes

- The Flask server runs with debug mode enabled for rapid iteration; avoid deploying it without adjustments.
- To reset your environment, deactivate the shell, remove `.venv`, and re-run the setup commands (or `make clean && make run`).
