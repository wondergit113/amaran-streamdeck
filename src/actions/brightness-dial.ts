import streamdeck, {
  action,
  DialAction,
  DialDownEvent,
  DialRotateEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { powerOff, powerOn, setBrightness, clamp, ConnectionSettings } from "../client";
import { coalescerFor, getLevelSync, hydrateLevels, setLevelSync } from "../state";

interface BrightnessDialSettings extends ConnectionSettings {
  lightId?: string;
  /** Percentage points per dial tick. */
  perTick?: number;
  level?: number;
  isOn?: boolean;
}

@action({ UUID: "com.coachjamesgunaca.amaran-openapi.brightness-dial" })
export class BrightnessDial extends SingletonAction<BrightnessDialSettings> {
  override async onWillAppear(ev: WillAppearEvent<BrightnessDialSettings>): Promise<void> {
    if (!ev.action.isDial()) {
      return;
    }
    await hydrateLevels();
    await ev.action.setFeedbackLayout("$B1");
    await this.render(ev.action, ev.payload.settings);
  }

  override async onDialRotate(ev: DialRotateEvent<BrightnessDialSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const id = settings.lightId ?? "";
    const perTick = settings.perTick && settings.perTick > 0 ? settings.perTick : 4;
    const current = getLevelSync(id) ?? settings.level ?? 50;
    const level = clamp(current + ev.payload.ticks * perTick, 0, 100);

    // Update local state + the dial display immediately (no awaiting HTTP).
    setLevelSync(id, level);
    settings.level = level;
    settings.isOn = level > 0;
    await this.render(ev.action, settings);
    void ev.action.setSettings(settings);

    // Coalesce the actual command: only the latest value is sent.
    coalescerFor(ev.action.id).run(async () => {
      try {
        // Capture this task's target instead of re-reading a mutable cache.
        const sent = level;
        const status = await setBrightness(settings, id, sent);
        if (status && getLevelSync(id) === sent) {
          // An older response must not overwrite a newer optimistic target.
          setLevelSync(id, status.brightness);
          settings.level = status.brightness;
          settings.isOn = status.on;
          await ev.action.setSettings(settings);
          await this.render(ev.action, settings);
        }
      } catch (err) {
        streamdeck.logger.warn(`brightness-dial send failed: ${err instanceof Error ? err.message : err}`);
        await ev.action.showAlert();
      }
    });
  }

  override async onDialDown(ev: DialDownEvent<BrightnessDialSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const turnOn = !(settings.isOn ?? false);

    try {
      if (turnOn) {
        await powerOn(settings, settings.lightId ?? "");
      } else {
        await powerOff(settings, settings.lightId ?? "");
      }
      settings.isOn = turnOn;
      await ev.action.setSettings(settings);
      await this.render(ev.action, settings);
    } catch (err) {
      streamdeck.logger.warn(`brightness-dial press failed: ${err instanceof Error ? err.message : err}`);
      await ev.action.showAlert();
    }
  }

  private async render(
    actionInstance: DialAction<BrightnessDialSettings>,
    settings: BrightnessDialSettings,
  ): Promise<void> {
    const level = settings.level ?? 50;
    const on = settings.isOn ?? false;
    await actionInstance.setFeedback({
      title: "Brightness",
      value: on ? `${level}%` : "Off",
      indicator: { value: on ? level : 0 },
    });
  }
}
