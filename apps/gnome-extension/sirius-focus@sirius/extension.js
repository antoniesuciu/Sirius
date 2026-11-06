// Lets Sirius raise the window an agent alert is about (ADR 0015). On Wayland only the shell
// may raise a window, so this is the one piece that has to live inside gnome-shell.
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { names } from './names.js';

// One method that only focuses: any process on the session bus may call it, so it must never
// read out windows or do anything else (ADR 0015).
const IFACE = `<node>
  <interface name="org.sirius.Focus">
    <method name="Activate">
      <arg type="s" direction="in" name="app"/>
      <arg type="s" direction="in" name="folder"/>
      <arg type="b" direction="out" name="found"/>
    </method>
  </interface>
</node>`;

const appOf = (w) => Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '';

// Most recently used first, across workspaces.
const windows = () => global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);

class Focus {
  /** Raise `app`'s most recent window naming `folder` (any of its windows when folder is ''). */
  Activate(app, folder) {
    if (!/^[\w.-]{1,100}$/.test(app) || folder.length > 200) return false;
    const id = `${app}.desktop`;
    const match = windows().find(
      (w) => appOf(w) === id && (!folder || names(w.get_title() ?? '', folder)),
    );
    if (!match) return false;
    Main.activateWindow(match, global.get_current_time());
    return true;
  }
}

export default class SiriusFocus extends Extension {
  enable() {
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, new Focus());
    this._dbus.export(Gio.DBus.session, '/org/sirius/Focus');
  }

  disable() {
    this._dbus?.unexport();
    this._dbus = null;
  }
}
