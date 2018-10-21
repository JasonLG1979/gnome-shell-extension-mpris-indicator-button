/*
 * Mpris Indicator Button extension for Gnome Shell 3.26+
 * Copyright 2018 Jason Gray (JasonLG1979)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep both pieces...
 */
"use strict";

const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();

// Basically a re-implementation of the widely used
// Gio.DBusProxy.makeProxyWrapper tailored 
// for our particular needs.
function _makeProxyWrapper(interfaceXml) {
    let nodeInfo = Gio.DBusNodeInfo.new_for_xml(interfaceXml);
    let info = nodeInfo.interfaces[0];
    let iname = info.name;
    return function(name, object, flags, asyncCallback) {
        let error = null;
        let proxy = null;
        let obj = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_interface_name: iname,
            g_interface_info: info,
            g_name: name,
            g_object_path: object,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START | flags
        });
        if (asyncCallback) {
            let cancellable = new Gio.Cancellable();
            obj.init_async(GLib.PRIORITY_DEFAULT, cancellable, function(initable, result) {
                try {
                    initable.init_finish(result);
                    proxy = initable;
                } catch(e) {
                    error = e;
                } finally {
                    if (proxy) {
                        if (proxy.get_name_owner()) {
                            asyncCallback(proxy, null);
                        } else {
                            error = Gio.DBusError.new_for_dbus_error(
                               " No Name Owner",
                                name + " has no owner."
                            );
                            asyncCallback(null, error);
                        }
                    } else {
                        if (!error) {
                            error = Gio.DBusError.new_for_dbus_error(
                                " Unknow Error",
                                name
                            );
                        }
                        asyncCallback(null, error);
                    }
                }
            });
            return cancellable;
        } else {
            try {
                obj.init(null);
                proxy = obj;
            } catch(e) {
                error = e;
            } finally {
                if (proxy) {
                    if (proxy.get_name_owner()) {
                        return proxy;
                    } else {
                        error = Gio.DBusError.new_for_dbus_error(
                           " No Name Owner",
                            name + " has no owner."
                        );
                        logDBusError(error);
                        return null;
                    }
                } else {
                    if (!error) {
                        error = Gio.DBusError.new_for_dbus_error(
                            " Unknow Error",
                            name
                        );
                    }
                    logDBusError(error);
                    return null;
                }
            }
        }
    };
}

function logDBusError(error) {
    // Cancelling counts as an error don't spam the logs.
    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        global.log("[" + Me.metadata.uuid + "]: " + error.message);
    }
}

const DBusProxy = _makeProxyWrapper(
`<node>
<interface name="org.freedesktop.DBus">
  <method name="GetConnectionUnixProcessID">
    <arg type="s" direction="in" name="busName"/>
    <arg type="u" direction="out" name="pid"/>
  </method>
  <method name="GetNameOwner">
    <arg type="s" direction="in" name="busName"/>
    <arg type="s" direction="out" name="nameOwner"/>
  </method>
  <method name="ListNames">
    <arg type="as" direction="out" name="names" />
  </method>
  <signal name="NameOwnerChanged">
    <arg type="s" direction="out" name="name" />
    <arg type="s" direction="out" name="oldOwner" />
    <arg type="s" direction="out" name="newOwner" />
  </signal>
</interface>
</node>`);

var MprisProxy = _makeProxyWrapper(
`<node>
<interface name="org.mpris.MediaPlayer2">
  <method name="Raise" />
  <property name="CanRaise" type="b" access="read" />
  <property name="Identity" type="s" access="read" />
  <property name="DesktopEntry" type="s" access="read" />
</interface>
</node>`);

var MprisPlayerProxy = _makeProxyWrapper(
`<node>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause" />
  <method name="Next" />
  <method name="Previous" />
  <method name="Stop" />
  <method name="Play" />
  <property name="CanGoNext" type="b" access="read" />
  <property name="CanGoPrevious" type="b" access="read" />
  <property name="CanPlay" type="b" access="read" />
  <property name="CanPause" type="b" access="read" />
  <property name="Metadata" type="a{sv}" access="read" />
  <property name="PlaybackStatus" type="s" access="read" />
</interface>
</node>`);

var DBusProxyHandler = GObject.registerClass({
    GTypeName: "DBusProxyHandler",
    Signals: {
        "add-player": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        },
        "remove-player": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        },
        "change-player-owner": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        }
    }
}, class DBusProxyHandler extends GObject.Object {
    _init() {
        super._init();
        this._proxy = null;
        this._cancellable = new DBusProxy(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
            this._onProxyReady.bind(this)
        );
    }

    _onProxyReady(proxy, error) {
        if (proxy) {
            this._proxy = proxy;
            this._proxy.ListNamesRemote(([busNames]) => {
                busNames.filter(n => n.startsWith("org.mpris.MediaPlayer2.")).sort().forEach(busName => {
                    this._proxy.GetConnectionUnixProcessIDRemote(busName, (pid) => {
                        this._proxy.GetNameOwnerRemote(busName, (nameOwner) => {
                            this.emit("add-player", [busName, nameOwner, pid].join(" "));
                        });
                    });
                });
            });

            this._proxy.connectSignal("NameOwnerChanged", (proxy, sender, [busName, oldOwner, newOwner]) => {
                if (busName.startsWith("org.mpris.MediaPlayer2.")) { 
                    if (newOwner && !oldOwner) {
                        this._proxy.GetConnectionUnixProcessIDRemote(busName, (pid) => {
                            this.emit("add-player", [busName, newOwner, pid].join(" "));
                        });
                    } else if (oldOwner && !newOwner) {
                        this.emit("remove-player", busName);
                    } else if (oldOwner && newOwner) {
                        this._proxy.GetConnectionUnixProcessIDRemote(busName, (pid) => {
                            this.emit("change-player-owner", [busName, newOwner, pid].join(" "));
                        });
                    }
                }
            });
        } else {
            logDBusError(error);
        }
    }

    destroy() {
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }
        if (this._proxy) {
            this._proxy.run_dispose();
        }
        this._proxy = null;
        this._cancellable = null;
        super.run_dispose();
    }
});
