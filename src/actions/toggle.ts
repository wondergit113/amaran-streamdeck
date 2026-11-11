import streamdeck, {
  action,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { getLight, powerOff, powerOn, ConnectionSettings } from "../client";

type ToggleMode = "toggle" | "on" | "off";

interface ToggleSettings extends ConnectionSettings {
  lightId?: string;
  mode?: ToggleMode;
  /** Last reported on/off state, retained for display while offline. */
  isOn?: boolean;
}

// A rounded-rectangle light-panel shape: path 1 = frame, path 2 = inner "fill".
const FRAME =
  "M94.9707 577.637L669.189 577.637C732.422 577.637 764.404 545.654 764.404 483.398L764.404 93.9941C764.404 31.7383 732.422 0 669.189 0L94.9707 0C31.9824 0 0 31.4941 0 93.9941L0 483.398C0 545.898 31.9824 577.637 94.9707 577.637ZM95.9473 534.18C61.7676 534.18 43.2129 516.113 43.2129 481.201L43.2129 96.1914C43.2129 61.2793 61.7676 43.2129 95.9473 43.2129L668.457 43.2129C701.904 43.2129 721.191 61.2793 721.191 96.1914L721.191 481.201C721.191 516.113 701.904 534.18 668.457 534.18Z";
const FILL =
  "M112.793 495.361L651.367 495.361C671.143 495.361 682.129 484.131 682.129 464.111L682.129 113.281C682.129 93.5059 671.143 82.0312 651.367 82.0312L112.793 82.0312C93.2617 82.0312 82.2754 93.5059 82.2754 113.281L82.2754 464.111C82.2754 484.131 93.2617 495.361 112.793 495.361Z";

function panelSvg(fillColor: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">` +
    `<g transform="translate(7,14) scale(0.0759)">` +
    `<path fill="#ffffff" d="${FRAME}"/>` +
    `<path fill="${fillColor}" d="${FILL}"/>` +
    `</g></svg>`
  );
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const OFF_SVG = svgDataUri(panelSvg("#ffffff"));
const ON_SVG = svgDataUri(panelSvg("#ffd60a"));

@action({ UUID: "com.coachjamesgunaca.amaran-openapi.toggle" })
export class ToggleLight extends SingletonAction<ToggleSettings> {
  override async onWillAppear(ev: WillAppearEvent<ToggleSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const settings = ev.payload.settings;
    try {
      settings.isOn = (await getLight(settings, settings.lightId ?? "")).on;
      await ev.action.setSettings(settings);
    } catch {
      // Keep the last display while offline; toggles still require a fresh read.
    }
    await this.paint(ev.action, settings.isOn ?? false);
  }

  override async onKeyDown(ev: KeyDownEvent<ToggleSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const mode: ToggleMode = settings.mode ?? "toggle";
    try {
      const turnOn = mode === "on" ? true : mode === "off" ? false
        : !(await getLight(settings, settings.lightId ?? "")).on;
      if (turnOn) {
        await powerOn(settings, settings.lightId ?? "");
      } else {
        await powerOff(settings, settings.lightId ?? "");
      }
      settings.isOn = turnOn;
      await ev.action.setSettings(settings);
      if (ev.action.isKey()) {
        await this.paint(ev.action, turnOn);
      }
    } catch (err) {
      streamdeck.logger.warn(`toggle failed: ${err instanceof Error ? err.message : err}`);
      await ev.action.showAlert();
    }
  }

  private async paint(keyAction: KeyAction<ToggleSettings>, on: boolean): Promise<void> {
    await keyAction.setImage(on ? ON_SVG : OFF_SVG);
  }
}
