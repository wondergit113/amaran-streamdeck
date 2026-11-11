# streamdeck-amaran-lights

A Stream Deck plugin to control amaran lights — **without the amaran Desktop app running** — by talking to your local **amaran BLE daemon** (the same npm package that [`homebridge-amaran-lights`](https://github.com/coachjamesgunaca/homebridge-amaran-lights) drives through its `http` transport).

This is the successor to the original OpenAPI build. Instead of speaking the amaran Desktop OpenAPI (AES-token WebSocket) directly, the plugin now sends simple HTTP commands.

By default it points at the **homebridge-amaran-lights HTTP control server** (port `2709`), which forwards to the daemon *and* keeps HomeKit in sync — the way the Neewer setup behaves:

```
Stream Deck ──HTTP──► homebridge-amaran-lights (:2709) ──► amaran daemon (:2708) ──► light
                              └── updates HomeKit
```

You can instead point the **Server** field straight at the daemon (`http://127.0.0.1:2708`) for direct control, but then changes won't show in HomeKit. The control server is part of homebridge-amaran-lights (enable `http` in its config).

## How amaran control differs from the Neewer plugin

The Neewer daemon takes a single `POST /lights/:id` with relative fields
(`toggle`, `brightnessDelta`, …) and reports state back. The amaran daemon is
**stateless, absolute, and action-pathed** — there is no toggle endpoint, no
deltas, and no state read-back:

| Method | Path | Body |
| --- | --- | --- |
| POST | `/lights/:id/on` | — |
| POST | `/lights/:id/off` | — |
| POST | `/lights/:id/brightness` | `{ "value": 0-100 }` |
| POST | `/lights/:id/cct` | `{ "brightness": 0-100, "kelvin": <K>, "gm": 0 }` |
| POST | `/lights/:id/hsi` | `{ "brightness": 0-100, "hue": 0-360, "saturation": 0-100 }` |

The plugin remembers on/brightness/kelvin in its settings. Toggle keys read
Homebridge state before deciding which power command to send; brightness dials
reconcile command responses only while they still match the latest target.
See State-aware controls below for endpoint requirements and limitations.

## Prerequisites

1. Your amaran BLE daemon running locally and reachable over HTTP (default
   `http://127.0.0.1:2708`). This is the same service `homebridge-amaran-lights`
   points its `http` transport at:

   ```json
   {
     "platform": "AmaranLightsPlatform",
     "transport": {
       "type": "http",
       "baseUrl": "http://127.0.0.1:2708/"
     },
     "lights": [
       { "id": "05010-ccdde1", "name": "Ray 120c", "model": "ray-120c" }
     ]
   }
   ```

2. [Node.js 20+](https://nodejs.org) and the [Stream Deck app](https://www.elgato.com/downloads) 6.5+.
3. A Stream Deck + if you want the dial actions (keys work on any model).

## Actions

| Action | Controller | Behavior |
| --- | --- | --- |
| **Toggle / On / Off** | Key | Toggles a light, or forces on/off (configurable). |
| **Brightness Step** | Key | Adjusts brightness by a fixed step per press (negative = down). |
| **Color** | Key | Sets a colour (hue/saturation) on colour-capable lights (e.g. Ray 120c). |
| **Brightness Dial** | Dial | Rotate to change brightness; press to toggle. Touch strip shows level. |
| **Color Temp Dial** | Dial | Rotate to change color temperature; press to toggle. |

Each action's Property Inspector takes the target **Light ID** (the `id` from
your Homebridge/daemon config), the step/per-tick amount, and the server
URL/token.

## Build & install

The plugin ships with [`bin/plugin.js`](bin/plugin.js) already built, so it runs
as-is. To rebuild after changing the TypeScript source:

```bash
npm install
npm run build
```

Then link it into Stream Deck using the [Elgato CLI](https://docs.elgato.com/streamdeck/cli/intro):

```bash
npm install -g @elgato/cli
streamdeck link com.coachjamesgunaca.amaran-openapi.sdPlugin
streamdeck restart com.coachjamesgunaca.amaran-openapi
```

For a manual/local install, copy the `com.coachjamesgunaca.amaran-openapi.sdPlugin`
folder into `~/Library/Application Support/com.elgato.StreamDeck/Plugins/` and
relaunch Stream Deck. During development, `npm run watch` rebuilds on change.

The actions appear under the **Amaran Lights** category.

## Configuration

- **Light ID** — the `id` of the light in your Homebridge/daemon config (e.g. `05010-ccdde1`).
- **Server** — Homebridge control server base URL (default `http://127.0.0.1:2709`).
- **Token** — only if your daemon requires a bearer token.
- **Mode / Color / Brightness / Step / Per tick** — action-specific behaviour.

## Notes

- Dial starting values still use the plugin's saved settings. Toggle keys read
  Homebridge state before switching power, but do not poll in the background.
- The daemon contract has no "all lights" or device-list endpoint, so the Light
  ID is entered manually per action.
- Icons are simple SVGs in `imgs/`; replace with your own art before publishing.
- The plugin UUID stays `com.coachjamesgunaca.amaran-openapi` to match the
  existing `.sdPlugin` folder name. Rename both together for a tidier id.

## License

MIT

## State-aware controls and regression checks

Toggle keys read Homebridge's current cached state before switching power. If
the state endpoint is unavailable, they show an alert rather than guessing.
Explicit On and Off modes remain usable without state read-back. The icon
refreshes from Homebridge when the key appears, with saved state as an offline
display fallback. This requires Homebridge's `GET /lights/:id` endpoint; the
direct daemon may not provide it. Homebridge's cached state is not a fresh BLE
read and may not reflect changes made outside Homebridge.

Brightness dial requests retain the newest target during rapid turns. Only a
response matching the latest target updates the optimistic display. HTTP reads
and writes time out after seven seconds so a stalled request cannot block the
next queued dial target forever.

Run `npm test`, `npm run typecheck`, and `npm run build` after installing the
development dependencies. Tests use mocks and do not contact lights or services.
