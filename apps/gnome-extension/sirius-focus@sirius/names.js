// Whether a window title names an agent's folder: as a whole name and the last part of a path,
// so "ws" does not match "ros2_ws", and "Documents" does not match a terminal at
// "~/Documents/sirius". Kept apart from extension.js so it can be tested outside gnome-shell.
export function names(title, folder) {
  const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}($|[^\\w./-])`).test(title);
}
