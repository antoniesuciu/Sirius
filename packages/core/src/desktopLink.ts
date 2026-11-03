/**
 * Ties a local core to the desktop app, so Sirius is all up or all down (ADR 0009). Watching the
 * event stream covers every way the app can end, including SIGKILL, with no signal handling.
 * Hiding to the tray keeps the stream open, so only a real quit counts.
 */

/** Long enough for a page reload or a quick reopen to reconnect first. */
const GRACE_MS = 10_000;

export class DesktopLink {
  private open = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onGone: () => void,
    private readonly graceMs = GRACE_MS,
    /** True while something else depends on the core, such as a paired phone (ADR 0009). */
    private readonly keepRunning: () => boolean = () => false,
  ) {}

  /** Call when the app connects. The returned function is for when it disconnects. */
  attach(): () => void {
    this.open++;
    clearTimeout(this.timer);
    return () => {
      this.open--;
      if (this.open > 0) return;
      this.timer = setTimeout(() => {
        if (!this.keepRunning()) this.onGone();
      }, this.graceMs);
    };
  }
}
