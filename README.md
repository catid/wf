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
4. Deploy with `npm run deploy`. By default this command just checks that `dist/` exists and exits, which satisfies Cloudflare Pages’ “Deploy command required” constraint while leaving the actual upload to Pages. If you want to run Wrangler yourself (for a manual deploy or another CI pipeline), set `WF_USE_WRANGLER=1` and re-run the command; it will rebuild `dist/` (unless `WF_SKIP_DEPLOY_BUILD=1`) and call `wrangler pages deploy dist --project-name warning-forever`.

To preview the static output locally with Cloudflare’s emulator, run `npm run preview`, which rebuilds `dist/` and launches `npx wrangler pages dev dist --local`.

If you need to authenticate outside of Cloudflare Pages, run `npx wrangler login` once or set both `CLOUDFLARE_ACCOUNT_ID` and an API token (`CLOUDFLARE_API_TOKEN`) that has Pages write access. After that, run `WF_USE_WRANGLER=1 npm run deploy` (or call `npx wrangler pages deploy dist` directly) to push the static output.
