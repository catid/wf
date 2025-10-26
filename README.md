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

## Cloudflare Pages

The repo now ships with a `wrangler.toml` and npm scripts so you can deploy entirely through the Cloudflare CLI (`npx wrangler`). Pages serves the pre-rendered static bundle that lives in `dist/`.

1. Install the Python bits (`uv pip install -r requirements.txt` or `pip install -r requirements.txt`).
2. Install the CLI tooling once: `npm install` (this pulls in Wrangler as a devDependency).
3. Build the static bundle with `npm run build` (runs `python3 export_static.py` under the hood).
4. Deploy with `npx wrangler pages deploy dist` (or `npm run deploy`). Wrangler will read `wrangler.toml`, upload `dist/`, and create/update the Cloudflare Pages project whose name matches the `name` field.

To preview the static output locally with Cloudflare’s emulator, run `npm run preview`, which rebuilds `dist/` and launches `npx wrangler pages dev dist --local`.

If you need to authenticate, run `npx wrangler login` once or set the `CLOUDFLARE_ACCOUNT_ID` and an API token that has Pages write access. After that, `npx wrangler pages deploy` will use the cached credentials.
