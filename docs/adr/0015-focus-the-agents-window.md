# ADR 0015: a click on an agent alert raises that agent's window

Status: accepted, 2026-11-06.

Context: an alert carries its terminal's app id (`desktop-entry`), so a click activates the
*app*, and GNOME raises that app's most recent window. With two VS Code windows, a Codex alert
for `ros2_ws` raised whichever window was used last. GNOME keys notifications by app, every
GNOME Terminal window shares one process, and on Wayland no program outside the shell may raise
a window.

Decision:

- **A GNOME Shell extension** (`apps/gnome-extension/sirius-focus@sirius`) does the raising,
  since only code inside gnome-shell can. It is not a Claude Code plugin: a plugin runs in
  Claude Code and cannot raise windows, and the hooks it could carry are already installed for
  Claude and Codex alike by `sirius setup-hooks`.
- **One D-Bus method, which only focuses**: `org.sirius.Focus.Activate(app, folder) -> found`
  on gnome-shell's bus name, at `/org/sirius/Focus`. Any process in the session can call it, so
  it reads nothing out and does nothing else.
- **Windows are matched by app and title.** It raises the most recently used window of `app`
  whose title holds `folder` as a whole name and the last part of a path, so `Documents` does
  not match a terminal at `~/Documents/sirius` (`names.js`, tested). VS Code titles name the folder
  (`file - ros2_ws [Container …] - profile - Visual Studio Code`), and oh-my-zsh sets GNOME
  Terminal's to `user@host:~/path`; both checked on this laptop on 2026-11-06.
- **The folder is the event's `project`**, the basename of the agent's cwd, which is what
  titles show; no contract change.
- **The core adds a click action only when the extension answers.** With a default action GNOME
  hands the click to the sender instead of activating the app, so without the extension alerts
  stay exactly as before. A click with no matching window raises the app's latest window, the
  old behaviour.

Consequences: installing (`scripts/install.sh --with-focus`) or changing the extension needs
one logout, because GNOME on Wayland loads extensions only at login; `sirius doctor` reports
whether it is loaded. It declares GNOME Shell 46 and needs a bump after a GNOME upgrade. A
window shows only its active tab's title, so an agent in a background tab or Zellij pane raises
its window but not the tab; a renamed window title falls back to the app's latest window.
