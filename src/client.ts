/**
 * Thin client for the local amaran BLE daemon (a "locally running npm package")
 * — the same HTTP surface that homebridge-amaran-lights' `http` transport
 * drives. See homebridge-amaran-lights/src/transports/httpTransport.ts.
 *
 * Unlike the Neewer plugin, amaran control is **stateless, absolute, and
 * action-pathed**:
 *
 *   POST /lights/:id/on
 *   POST /lights/:id/off
 *   POST /lights/:id/brightness   { value: 0-100 }
 *   POST /lights/:id/cct          { brightness: 0-100, kelvin, gm: 0 }
 *   POST /lights/:id/hsi          { brightness: 0-100, hue: 0-360, saturation: 0-100 }
 *
 * Homebridge exposes GET /lights/:id with its cached state. Toggle actions
 * read it before deciding what to send, rather than trusting saved settings.
 * Direct-daemon users without state read-back can still use explicit On/Off.
 */

/** Connection settings shared by every action (stored per-action). */
export interface ConnectionSettings {
  baseUrl?: string;
  token?: string;
}

/**
 * Default base URL. Points at the homebridge-amaran-lights HTTP control server
 * (port 2709), NOT the amaran daemon (2708): going through Homebridge keeps
 * HomeKit in sync. Set Server to the daemon (2708) only if you don't want sync.
 */
export const DEFAULT_BASE_URL = "http://127.0.0.1:2709";
// Longer than Homebridge's downstream timeout, but never leave a dial stuck.
const REQUEST_TIMEOUT_MS = 7000;

export interface LightStatus {
  on: boolean;
  brightness: number;
}

function readStatus(data: unknown): LightStatus | undefined {
  const state = (data as { state?: Partial<LightStatus> } | null)?.state;
  if (!state || typeof state.on !== "boolean" ||
      typeof state.brightness !== "number" || !Number.isFinite(state.brightness)) {
    return undefined;
  }
  return { on: state.on, brightness: state.brightness };
}

/** Read Homebridge's cached state; never invent an off state on failure. */
export async function getLight(settings: ConnectionSettings, id: string): Promise<LightStatus> {
  const lightId = (id ?? "").trim();
  if (!lightId) throw new Error("No Light ID set — enter the id from your Homebridge config.");
  const res = await fetch(`${baseUrlOf(settings)}/lights/${encodeURIComponent(lightId)}`, {
    headers: headers(settings, false),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /lights/${lightId} -> HTTP ${res.status}`);
  const status = readStatus(await res.json());
  if (!status) throw new Error(`GET /lights/${lightId} did not report a valid state`);
  return status;
}

export function baseUrlOf(settings: ConnectionSettings): string {
  const url = (settings.baseUrl ?? "").trim();
  return (url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function headers(settings: ConnectionSettings, hasBody: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (hasBody) {
    h["Content-Type"] = "application/json";
  }
  if (settings.token) {
    h["Authorization"] = `Bearer ${settings.token}`;
  }
  return h;
}

/** POST to /lights/:id/:action with an optional JSON body. */
async function post(
  settings: ConnectionSettings,
  id: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<LightStatus | undefined> {
  const lightId = (id ?? "").trim();
  if (!lightId) {
    throw new Error("No Light ID set — enter the id from your Homebridge config.");
  }
  const url = `${baseUrlOf(settings)}/lights/${encodeURIComponent(lightId)}/${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(settings, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`POST /lights/${lightId}/${action} -> HTTP ${res.status}`);
  }
  return readStatus(await res.json().catch(() => undefined));
}

export function powerOn(settings: ConnectionSettings, id: string): Promise<LightStatus | undefined> {
  return post(settings, id, "on");
}

export function powerOff(settings: ConnectionSettings, id: string): Promise<LightStatus | undefined> {
  return post(settings, id, "off");
}

export function setBrightness(
  settings: ConnectionSettings,
  id: string,
  value: number,
): Promise<LightStatus | undefined> {
  return post(settings, id, "brightness", { value: clamp(value, 0, 100) });
}

export function setCct(
  settings: ConnectionSettings,
  id: string,
  brightness: number,
  kelvin: number,
): Promise<LightStatus | undefined> {
  return post(settings, id, "cct", {
    brightness: clamp(brightness, 0, 100),
    kelvin: Math.round(kelvin),
    gm: 0,
  });
}

export function setHsi(
  settings: ConnectionSettings,
  id: string,
  brightness: number,
  hue: number,
  saturation: number,
): Promise<LightStatus | undefined> {
  return post(settings, id, "hsi", {
    brightness: clamp(brightness, 0, 100),
    hue: clamp(hue, 0, 360),
    saturation: clamp(saturation, 0, 100),
  });
}
