/*
 * Mpris Indicator Button extension for Gnome Shell 3.32+
 * Copyright 2019 Jason Gray (JasonLG1979)
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
 * If this extension breaks your desktop you get to keep all of the pieces...
 */
"use strict";

const { Gio, GLib, GObject, Gtk, Meta, Shell } = imports.gi;

const Main = imports.ui.main;

const UUID = imports.misc.extensionUtils.getCurrentExtension().metadata.uuid;
const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";
const METADATA_KEYS = [
    "xesam:artist",
    "xesam:albumArtist",
    "xesam:composer",
    "xesam:lyricist",
    "rhythmbox:streamTitle",
    "xesam:title",
    "xesam:trackNumber",
    "xesam:album",
    "xesam:discNumber",
    "mpris:artUrl",
    "xesam:url"
];

const DBusProxy = _makeProxyWrapper(
`<node>
<interface name="org.freedesktop.DBus">
  <method name="GetConnectionUnixProcessID">
    <arg type="s" direction="in" name="busName"/>
    <arg type="u" direction="out" name="pid"/>
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

const MprisProxies = _makeProxyWrapper(
`<node>
<interface name="org.mpris.MediaPlayer2">
  <method name="Raise" />
  <property name="CanRaise" type="b" access="read" />
  <property name="Identity" type="s" access="read" />
  <property name="DesktopEntry" type="s" access="read" />
</interface>
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
  <property name="Shuffle" type="b" access="readwrite" />
  <property name="LoopStatus" type="s" access="readwrite" />
  <property name="Volume" type="d" access="readwrite" />
</interface>
</node>`);

// Basically a re-implementation of the widely used
// Gio.DBusProxy.makeProxyWrapper tailored for our particular needs.
// Mainly it returns a Gio.Cancellable and allows for more then
// one interface per node.
function _makeProxyWrapper(interfaceXml) {
    let nodeInfo = Gio.DBusNodeInfo.new_for_xml(interfaceXml);
    return function(busName, objectPath, flags, asyncCallback) {
        flags = Gio.DBusProxyFlags.DO_NOT_AUTO_START | flags;
        let cancellable = new Gio.Cancellable();
        nodeInfo.interfaces.forEach(interfaceInfo => {
            let interfaceName = interfaceInfo.name;
            let error = null;
            let proxy = null;
            Gio.DBusProxy.new(
                Gio.DBus.session,
                flags,
                interfaceInfo,
                busName,
                objectPath,
                interfaceName,
                cancellable,
                (source, result) => {
                    try {
                        proxy = Gio.DBusProxy.new_finish(result);
                    } catch(e) {
                        proxy = null;
                        error = e;
                    } finally {
                        if (proxy) {
                            if (proxy.g_name_owner) {
                                asyncCallback(proxy, null);
                            } else {
                                error = Gio.DBusError.new_for_dbus_error(
                                    " No Name Owner",
                                    `${busName} has no owner.`
                                );
                                asyncCallback(null, error);
                            }
                        } else {
                            if (!error) {
                                // Should never really happen.
                                error = Gio.DBusError.new_for_dbus_error(
                                    " Unknow Error",
                                    busName
                                );
                            }
                            asyncCallback(null, error);
                        }
                    }
                }
            );
        });
        return cancellable;
    };
}

function logError(error) {
    // Cancelling counts as an error don't spam the logs.
    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        global.log(`[${UUID}]: ${error.message}`);
    }
}

var DBusProxyHandler = GObject.registerClass({
    GTypeName: "DBusProxyHandler",
    Signals: {
        "add-player": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING,
                GObject.TYPE_OBJECT
            ]
        },
        "remove-player": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING
            ]
        }
    }
}, class DBusProxyHandler extends GObject.Object {
    _init() {
        super._init();
        this._proxy = null;
        this._nameOwnerId = null;
        this._cancellable = new DBusProxy(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
            this._onProxyReady.bind(this)
        );
    }

    _onProxyReady(proxy, error) {
        this._cancellable.run_dispose();
        if (proxy) {
            this._proxy = proxy;

            let addPlayer = busName => {
                this._proxy.GetConnectionUnixProcessIDRemote(busName, ([pid]) => {
                    if (this._proxy) {
                        let readyId = new MprisProxyHandler(busName, pid).connect("ready", (mpris, ready) => {
                            mpris.disconnect(readyId);
                            if (this._proxy && ready) {
                                this.emit("add-player", busName, mpris);
                            } else {
                                mpris.destroy();
                                this.emit("remove-player", busName);
                            }
                        });
                    }
                });
            }

            this._proxy.ListNamesRemote(([n]) => n.filter(n => n.startsWith(MPRIS_PREFIX)).sort().forEach(n => addPlayer(n)));

            this._nameOwnerId = this._proxy.connectSignal("NameOwnerChanged", (proxy, sender, [busName, oldOwner, newOwner]) => {
                if (busName.startsWith(MPRIS_PREFIX)) {
                    if (newOwner) {
                        addPlayer(busName);
                    } else {
                        this.emit("remove-player", busName);
                    }
                }
            });
        } else {
            logError(error);
        }
        this._cancellable = null;
    }

    destroy() {
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }
        if (this._proxy) {
            if (this._nameOwnerId) {
                this._proxy.disconnectSignal(this._nameOwnerId);
            }
            this._proxy.run_dispose();
        }
        this._proxy = null;
        this._nameOwnerId = null
        this._cancellable = null;
        super.run_dispose();
    }
});

// Things get a little weird when there are more
// than one instance of a player running at the same time.
// As far as ShellApp is concerned they are the same app.
// So we have to jump though a bunch of hoops to keep track
// of and differentiate the instance metaWindows by pid or
// gtk_unique_bus_name/nameOwner.
const AppWrapper = GObject.registerClass({
    GTypeName: "AppWrapper",
    Properties: {
        "focused": GObject.ParamSpec.boolean(
            "focused",
            "focused-prop",
            "If the instance of the app is focused",
            GObject.ParamFlags.READABLE,
            false
        )
    }
}, class AppWrapper extends GObject.Object {
    _init(shellApp, busName, pid, nameOwner) {
        super._init();
        this._app = shellApp;
        this._pid = pid;
        this._instanceNum = this._getNumbersFromTheEndOf(busName);
        this._nameOwner = nameOwner;
        this._focused = false;
        this._user_time = 0;
        this._metaWindow = null;
        this._appearsFocusedId = null;
        this._unmanagedId = null;
        this._metaWindowsChangedId = this._app.connect(
            "windows-changed",
            this._onWindowsChanged.bind(this)
        );
        this._onWindowsChanged();
    }

    get focused() {
        return this._focused || false;
    }

    get user_time() {
        return this._user_time || 0;
    }

    get gicon() {
        // Much prefer a Gio.FileIcon or Gio.ThemedIcon to the St.Icon
        // you'd get from Shell.App.create_icon_texture().
        // This also doesn't fail silently and return the wrong icon...
        let app_info = this._app.get_app_info();
        let gicon = app_info ? app_info.get_icon() : null;
        if (gicon) {
            gicon.isSymbolic = false;
        }
        return gicon;
    }

    toggleWindow(minimize) {
        if (!this._focused) {
            if (this._metaWindow) {
                // Go ahead and skip the whole "Player is Ready"
                // dialog, after all the user wants the player focused,
                // that's why they clicked on it...
                Main.activateWindow(this._metaWindow);
            } else {
                this._app.activate();
            }
            return true;
        } else if (minimize && this._metaWindow && this._metaWindow.can_minimize()) {
            this._metaWindow.minimize();
            return true;
        }
        return false;
    }

    destroy() {
        // Nothing to see here, move along...
        if (this._metaWindowsChangedId) {
            this._app.disconnect(this._metaWindowsChangedId);
        }
        this._onUnmanaged();
        this._metaWindowsChangedId = null;
        this._app = null;
        this._pid = null;
        this._focused = null;
        this._user_time = null;
        super.run_dispose();
    }

    _getNumbersFromTheEndOf(someString) {
        let matches = someString.match(/[0-9]+$/);
        return matches ? parseInt(matches[0], 10) : null;
    }

    _getNormalAppMetaWindows() {
        // We don't want dialogs or what not...
        return Array.from(this._app.get_windows()).filter(w =>
            !w.skip_taskbar && w.window_type === Meta.WindowType.NORMAL
        );
    }

    _getNewAppMetaWindow() {
        // Try to get a hold of an actual metaWindow...
        let metaWindows = this._getNormalAppMetaWindows();
        let metaWindow = metaWindows.find(w => {
            // Check for multiple instances.
            if (this._instanceNum && w.gtk_window_object_path) {
                // Match multiple instance(multiple window really) GApplications to their windows.
                // Works rather well if a GApplication's MPRIS instance number matches
                // it's corresponding window object path like the latest git master of GNOME-MPV.
                // For example org.mpris.MediaPlayer2.GnomeMpv.instance-1 = /io/github/GnomeMpv/window/1.
                let windowNum = this._getNumbersFromTheEndOf(w.gtk_window_object_path);
                if (this._instanceNum === windowNum) {
                    return true;
                }
            } else if (w.gtk_unique_bus_name) {
                // This will match single instance GApplications to their window.
                // Generally the window and MPRIS interface will have the
                // same name owner.
                if (w.gtk_unique_bus_name === this._nameOwner) {
                    return true;
                }
            // Match true multiple instances players by their pids.
            // works rather well for apps like VLC for example.
            } else if (w.get_pid() === this._pid) {
                return true;
            }
            return false;
        });
        return metaWindow ? metaWindow : metaWindows.length ? metaWindows[0] : null;
    }

    _grabAppMetaWindow(appMetaWindow) {
        // Connect our metaWindow signals
        // and check the new window's focus.
        if (appMetaWindow) {
            this._onUnmanaged();
            this._metaWindow = appMetaWindow;
            this._appearsFocusedId = this._metaWindow.connect(
               "notify::appears-focused",
                this._onAppearsFocused.bind(this)
            );
            this._unmanagedId = this._metaWindow.connect(
                "unmanaged",
                this._onUnmanaged.bind(this)
            );
            this._onAppearsFocused();
        }
    }

    _onWindowsChanged() {
        // We get this signal when metaWindows show up
        // Really only useful when a player "unhides"
        // or at _init
        let appMetaWindow = this._getNewAppMetaWindow();
        if (appMetaWindow) {
            while (appMetaWindow.get_transient_for()) {
                appMetaWindow = appMetaWindow.get_transient_for();
            }
        }
        if (this._metaWindow !== appMetaWindow) {
            this._grabAppMetaWindow(appMetaWindow);
        }
    }

    _onAppearsFocused() {
        // Pretty self explanatory...
        let focused = this._metaWindow && this._metaWindow.has_focus();
        if (this._focused != focused) {
            this._user_time = GLib.get_monotonic_time();
            this._focused = focused;
            this.notify("focused");
        }
    }

    _onUnmanaged() {
        // "unmanaged" metaWindows are either hidden and/or
        // will soon be destroyed. Disconnect from them
        // and null the metaWindow.
        if (this._metaWindow) {
            if (this._appearsFocusedId) {
                this._metaWindow.disconnect(this._appearsFocusedId);
            }
            if (this._unmanagedId) {
                this._metaWindow.disconnect(this._unmanagedId);
            }
        }
        this._metaWindow = null;
        this._appearsFocusedId = null;
        this._unmanagedId = null;
    }
});

var MprisProxyHandler = GObject.registerClass({
    GTypeName: "MprisProxyHandler",
    Signals: {
        "ready": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_BOOLEAN]
        },
        "update-indicator": {
            flags: GObject.SignalFlags.RUN_FIRST
        }
    },
    Properties: {
        "show-stop": GObject.ParamSpec.boolean(
            "show-stop",
            "show-stop-prop",
            "If the stop button should be shown",
            GObject.ParamFlags.READABLE,
            false
        ),
        "prev-reactive": GObject.ParamSpec.boolean(
            "prev-reactive",
            "prev-reactive-prop",
            "If the prev button should be reactive",
            GObject.ParamFlags.READABLE,
            false
        ),
        "playpause-reactive": GObject.ParamSpec.boolean(
            "playpause-reactive",
            "playpause-reactive-prop",
            "If the playpause button should be reactive",
            GObject.ParamFlags.READABLE,
            false
        ),
        "playpause-icon-name": GObject.ParamSpec.string(
            "playpause-icon-name",
            "playpause-icon-name-prop",
            "The name of the icon in the playpause button",
            GObject.ParamFlags.READABLE,
            "media-playback-start-symbolic"
        ),
        "next-reactive": GObject.ParamSpec.boolean(
            "next-reactive",
            "next-reactive-prop",
            "If the next button should be reactive",
            GObject.ParamFlags.READABLE,
            false
        ),
        "show-shuffle-repeat": GObject.ParamSpec.boolean(
            "show-shuffle-repeat",
            "show-shuffle-repeat-prop",
            "If the shuffle and repeat buttons should be shown",
            GObject.ParamFlags.READABLE,
            false
        ),
        "shuffle-reactive": GObject.ParamSpec.boolean(
            "shuffle-reactive",
            "shuffle-reactive-prop",
            "If the shuffle button should be reactive",
            GObject.ParamFlags.READABLE,
            false
        ),
        "shuffle-active": GObject.ParamSpec.boolean(
            "shuffle-active",
            "shuffle-active-prop",
            "If the shuffle button should appear active",
            GObject.ParamFlags.READABLE,
            false
        ),
        "repeat-reactive": GObject.ParamSpec.boolean(
            "repeat-reactive",
            "repeat-reactive-prop",
            "If the repeat button should be reactive",
            GObject.ParamFlags.READABLE,
            false
        ),
        "repeat-active": GObject.ParamSpec.boolean(
            "repeat-active",
            "repeat-active-prop",
            "If the repeat button should appear active",
            GObject.ParamFlags.READABLE,
            false
        ),
        "repeat-icon-name": GObject.ParamSpec.string(
            "repeat-icon-name",
            "repeat-icon-name-prop",
            "The name of the icon in the repeat button",
            GObject.ParamFlags.READABLE,
            "media-playlist-repeat-symbolic"
        ),
        "cover-url": GObject.ParamSpec.string(
            "cover-url",
            "cover-url-prop",
            "the url of the current track's cover art",
            GObject.ParamFlags.READABLE,
            ""
        ),
        "accessible-name": GObject.ParamSpec.string(
            "accessible-name",
            "accessible-name-prop",
            "The accessible-name to be used by the player widget",
            GObject.ParamFlags.READABLE,
            ""
        ),
        "artist": GObject.ParamSpec.string(
            "artist",
            "artist-prop",
            "The current track's artist",
            GObject.ParamFlags.READABLE,
            ""
        ),
        "title": GObject.ParamSpec.string(
            "title",
            "title-prop",
            "The current track's title",
            GObject.ParamFlags.READABLE,
            ""
        ),
        "volume": GObject.ParamSpec.double(
            "volume",
            "volume-prop",
            "The current volume",
            GObject.ParamFlags.READWRITE,
            0.0,
            1.0,
            0.0
        ),
        "show-volume": GObject.ParamSpec.boolean(
            "show-volume",
            "show-volume-prop",
            "If the volume slider should be shown",
            GObject.ParamFlags.READABLE,
            false
        ),
        "gicon": GObject.ParamSpec.object(
            "gicon",
            "gicon-prop",
            "a gicon for the player",
            GObject.ParamFlags.READABLE,
            Gio.ThemedIcon.new("audio-x-generic-symbolic")
        )
    }
}, class MprisProxyHandler extends GObject.Object {
    _init(busName, pid) {
        super._init();
        this._busName = busName;
        this._pid = pid;
        this.updateId = null;
        this._mprisProxy = null;
        this._mprisPropChangeId = null;
        this._playerProxy = null;
        this._playerPropChangeId = null;
        this._appWrapper = null;
        this._focusedId = null;
        this._player_name = "";
        this._desktop_entry = "";
        this._show_stop = false;
        this._prev_reactive = false;
        this._playpause_reactive = false;
        this._playpause_icon_name = "media-playback-start-symbolic";
        this._next_reactive = false;
        this._show_shuffle_repeat = false;
        this._shuffle_reactive = false;
        this._shuffle_active = false;
        this._repeat_reactive = false;
        this._repeat_active = false;
        this._repeat_icon_name = "media-playlist-repeat-symbolic";
        this._cover_url = "";
        this._artist = "";
        this._title = "";
        this._accessible_name = "";
        this._playback_status = 0;
        this._status_time = 0;
        this._volume = 0.0;
        this._show_volume = false;
        this._mimetype_icon_name = "audio-x-generic-symbolic";
        this._gicon = Gio.ThemedIcon.new(this._mimetype_icon_name);
        this._gicon.isSymbolic = true;
        this._cancellable = new MprisProxies(
            busName,
            "/org/mpris/MediaPlayer2",
            Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            (proxy, error) => {
                if (proxy) {
                    if (proxy.g_interface_name === "org.mpris.MediaPlayer2") {
                        this._mprisProxy = proxy;
                    } else if (proxy.g_interface_name === "org.mpris.MediaPlayer2.Player") {
                        this._playerProxy = proxy;
                    }
                    if (this._mprisProxy && this._playerProxy) {
                        this.emit("ready", true);
                        this._onProxiesReady();
                    }
                } else {
                    logError(error);
                    this.emit("ready", false);
                }
            }
        );
    }

    get busName() {
        return this._busName || "";
    }

    get player_name() {
        return this._player_name || "";
    }

    get accessible_name() {
        return this._accessible_name || "";
    }

    get show_stop() {
        return this._show_stop || false;
    }

    get gicon() {
        return this._gicon || null;
    }

    get prev_reactive() {
        return this._prev_reactive || false;
    }

    get playpause_reactive() {
        return this._playpause_reactive || false;
    }

    get playpause_icon_name() {
        return this._playpause_icon_name || "media-playback-start-symbolic";
    }

    get show_shuffle_repeat() {
        return this._show_shuffle_repeat || false;
    }

    get next_reactive() {
        return this._next_reactive || false;
    }

    get shuffle_reactive() {
        return this._shuffle_reactive || false;
    }

    get shuffle_active() {
        return this._shuffle_active || false;
    }

    get repeat_reactive() {
        return this._repeat_reactive || false;
    }

    get repeat_active() {
        return this._repeat_active || false;
    }

    get repeat_icon_name() {
        return this._repeat_icon_name || "media-playlist-repeat-symbolic";
    }

    get cover_url() {
        return this._cover_url || "";
    }

    get artist() {
        return this._artist || "";
    }

    get title() {
        return this._title || "";
    }

    get playback_status() {
        return this._playback_status || 0;
    }

    get status_time() {
        return this._status_time || 0;
    }

    get focused() {
        return this._appWrapper ? this._appWrapper.focused : false;
    }

    get user_time() {
        return this._appWrapper ? this._appWrapper.user_time : 0;
    }

    get show_volume() {
        return this._show_volume || false;
    }

    get volume() {
        return this._volume || 0.0;
    }

    set volume(newVolume) {
        newVolume = newVolume ? Math.max(0.0, Math.min(newVolume, 1.0)) : 0.0;
        if (this._playerProxy && this._show_volume && this._volume !== newVolume) {
            this._playerProxy.Volume = newVolume;
        }
    }

    volumeUp() {
        this.volume = this._volume + 0.05;
    }

    volumeDown() {
        this.volume = this._volume - 0.05;
    }

    toggleWindow(minimize) {
        return this._appWrapper ? this._appWrapper.toggleWindow(minimize) : this._raise();
    }

    refreshIcon() {
        let gicon = this._getSymbolicIcon() || this._getFullColorIcon() || this._getMimeTypeIcon();
        if (!this._gicon.equal(gicon)) {
            this._gicon = gicon;
            this.notify("gicon");
            this.emit("update-indicator");
        }
    }

    playPause() {
        if (this._playerProxy) {
            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay) {
                this._playerProxy.PlayRemote();
            }
        }
    }

    stop() {
        if (this._playerProxy) {
            this._playerProxy.StopRemote();
        }
    }

    playPauseStop() {
        if (this._playerProxy) {
            let isPlaying = this._playback_status === 2;
            let canPlay = this._playerProxy.CanPlay;
            let canPause = this._playerProxy.CanPause;
            if (canPlay && canPause) {
                this._playerProxy.PlayPauseRemote();
                return true;
            } else if (canPlay && !isPlaying) {
                this._playerProxy.PlayRemote();
                return true;
            } else if (isPlaying) {
                this._playerProxy.StopRemote();
                return true;
            }
        }
        return false;
    }

    previous() {
        if (this._playerProxy && this._playerProxy.CanGoPrevious) {
            this._playerProxy.PreviousRemote();
            return true;
        }
        return false;
    }

    next() {
        if (this._playerProxy && this._playerProxy.CanGoNext) {
            this._playerProxy.NextRemote();
            return true;
        }
        return false;
    }

    toggleShuffle() {
        if (this._shuffle_reactive) {
            this._playerProxy.Shuffle = !this._shuffle_active;
        }
    }

    cycleRepeat() {
        if (this._repeat_reactive) {
            let loopStatus = this._playerProxy.LoopStatus || "None";
            this._playerProxy.LoopStatus = loopStatus === "None" ? "Playlist"
                : loopStatus === "Playlist" ? "Track"
                : "None";
        }
    }

    _raise() {
        if (this._mprisProxy && this._mprisProxy.CanRaise) {
            this._mprisProxy.RaiseRemote();
            return true;
        }
        return false;
    }

    _onProxiesReady() {
        this._cancellable.run_dispose();
        this._mprisPropChangeId = this._mprisProxy.connect("g-properties-changed", () => {
            this._updateMprisProps();
        });
        this._playerPropChangeId = this._playerProxy.connect("g-properties-changed", (proxy, props) => {
            props = Object.keys(props.deep_unpack());
            if (props.includes("PlaybackStatus") || props.some(prop => prop.startsWith("Can"))) {
                this._updatePlayerProps();
            }
            if (props.includes("Metadata")) {
                this._updateMetadata();
            }
            if (props.includes("Shuffle")) {
                this._updateShuffle();
            }
            if (props.includes("LoopStatus")) {
                this._updateLoopStatus();
            }
            if (props.includes("Volume")) {
                if (!this._show_volume) {
                    this._show_volume = true;
                    this.notify("show-volume");
                }
                this._updateVolume();
            }
        });
        this._updateMprisProps();
        this._updatePlayerProps();
        this._updateMetadata();
        this._testShuffleLoopStatus();
        this._testVolume();
        this._cancellable = null;
    }

    _updateMprisProps() {
        this._player_name = this._mprisProxy.Identity || "";
        this._desktop_entry = (this._mprisProxy.DesktopEntry || "").split("/").pop().replace(".desktop", "");
        if (this._player_name && this._desktop_entry && this._mprisPropChangeId) {
            this._mprisProxy.disconnect(this._mprisPropChangeId);
            this._mprisPropChangeId = null;
            let desktopId = this._desktop_entry + ".desktop";
            let identity = this._player_name;
            let lcIdentity = identity.toLowerCase();
            let appSystem = Shell.AppSystem.get_default();
            let shellApp = appSystem.lookup_app(desktopId) ||
                appSystem.lookup_startup_wmclass(identity) ||
                appSystem.get_running().find(app => app.get_name().toLowerCase() === lcIdentity);
            if (!shellApp) {
                for (let desktopId of Shell.AppSystem.search(this._desktop_entry)) {
                    let app = appSystem.lookup_app(desktopId[0]);
                    if (app && lcIdentity === app.get_name().toLowerCase()) {
                        shellApp = app;
                        break;
                    }
                }
            }
            if (shellApp) {
                this._appWrapper = new AppWrapper(
                    shellApp,
                    this._busName,
                    this._pid,
                    this._mprisProxy.g_name_owner
                );
                this._focusedId = this._appWrapper.connect("notify::focused", () => {
                    this.emit("update-indicator");
                });
            }
            this.refreshIcon();
        }
    }

    _updatePlayerProps() {
        let playPauseIconName = "media-playback-start-symbolic";
        let playPauseReactive = false;
        let showStop = false;
        let status = (this._playerProxy.PlaybackStatus ||  "").toLowerCase();
        status = (status === "playing") ? 2 : (status === "paused") ? 1 : 0;
        let isPlaying = status === 2;
        let canPlay = this._playerProxy.CanPlay || false;
        let canPause = this._playerProxy.CanPause || false;
        let canGoPrevious = this._playerProxy.CanGoPrevious || false;
        let canGoNext = this._playerProxy.CanGoNext || false;

        if (canPause && canPlay) {
            playPauseIconName = isPlaying ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";
            playPauseReactive = true;
        } else {
            if (canPlay) {
                showStop = true;
            }
            playPauseIconName = "media-playback-start-symbolic";
            playPauseReactive = canPlay;
        }

        if (this._show_stop !== showStop) {
            this._show_stop = showStop;
            this.notify("show-stop");
        }
        if (this._prev_reactive !== canGoPrevious) {
            this._prev_reactive = canGoPrevious;
            this.notify("prev-reactive");
        }
        if (this._playpause_icon_name !== playPauseIconName) {
            this._playpause_icon_name = playPauseIconName;
            this.notify("playpause-icon-name");
        }
        if (this._playpause_reactive !== playPauseReactive) {
            this._playpause_reactive = playPauseReactive;
            this.notify("playpause-reactive");
        }
        if (this._next_reactive !== canGoNext) {
            this._next_reactive = canGoNext;
            this.notify("next-reactive");
        }
        if (this._playback_status !== status) {
            this._playback_status = status;
            this._status_time = GLib.get_monotonic_time();
            this.emit("update-indicator");
        }
    }

    _updateMetadata() {
        let mimetypeIcon = "audio-x-generic-symbolic";
        let coverUrl = "";
        let artist = this._player_name;
        let title = "";
        let metadata = this._playerProxy.Metadata || {};

        if (Object.keys(metadata).length) {
            // Unpack all Metadata keys that we care about in place.
            // If the key doesn't exsist set it to an empty string and join all arrays.
            // Most of our "artist" keys are (or at least should be) arrays of strings.
            METADATA_KEYS.forEach(key => {
                let value = metadata[key] ? metadata[key].deep_unpack() : "";
                metadata[key] = Array.isArray(value) ? value.join(", ") : value;
            });

            coverUrl = metadata["mpris:artUrl"];

            let trackUrl = metadata["xesam:url"];

            // Spotify videos and ads don't follow MPRIS metadata spec.
            // This more or less matches what Spotify shows in it's UI.
            if (this._player_name === "Spotify" && !trackUrl.includes("/track/")) {
                mimetypeIcon = (!trackUrl || trackUrl.includes("/episode/")) ? "video-x-generic-symbolic" : "audio-x-generic-symbolic";
                if (!metadata["xesam:artist"]) {
                    let delimiter = metadata["xesam:title"].includes(" - ") ? " - " : ": ";
                    let artist_title = metadata["xesam:title"].split(delimiter);
                    if (artist_title.length > 1) {
                        artist = artist_title.shift().trim() || this._player_name;
                        title = artist_title.join(delimiter).trim();
                    } else {
                        delimiter = metadata["xesam:album"].includes(" - ") ? " - " : ": ";
                        artist = metadata["xesam:album"].split(delimiter)[0].trim() || this._player_name;
                        title = metadata["xesam:title"];
                    }
                } else {
                    artist = metadata["xesam:artist"];
                    title = metadata["xesam:title"];
                }
            } else {
                // There are better ways to sniff the mimetype of the track
                // but they involve doing I/O on the url which isn't worth it.
                // This is good enough and works just fine most of the time.
                // If all else fails fallback to "audio-x-generic-symbolic"
                if (trackUrl) {
                    let fileExt = `.${trackUrl.split(/\#|\?/)[0].split(".").pop().trim()}`;
                    let [mimetype, uncertain] = Gio.content_type_guess(fileExt, null);

                    mimetypeIcon = (!uncertain && Gio.content_type_is_a(mimetype, "video/*"))
                        ? "video-x-generic-symbolic"
                        : "audio-x-generic-symbolic";
                }

                // Be rather exhaustive and liberal as far as what constitutes an "artist".
                // If all else fails fallback to the Player's name.
                artist = metadata["xesam:artist"] ? metadata["xesam:artist"]
                    : metadata["xesam:albumArtist"] ? metadata["xesam:albumArtist"]
                    : metadata["xesam:composer"] ? metadata["xesam:composer"]
                    : metadata["xesam:lyricist"] ? metadata["xesam:lyricist"]
                    : metadata["rhythmbox:streamTitle"] ? metadata["rhythmbox:streamTitle"]
                    : this._player_name;

                // Prefer the track title, but in it's absence if the
                // track number and album title are available use them.
                // For example, "5 - My favorite Album".
                // If the disc number is more than 1 also add the disc number.
                // for example, "5 - My favorite Album (2)".
                // If all else fails fallback to an empty string.
                title = metadata["xesam:title"] ? metadata["xesam:title"]
                    : (Number.isInteger(metadata["xesam:trackNumber"])
                        && Number.isInteger(metadata["xesam:discNumber"])
                        && metadata["xesam:discNumber"] > 1
                        && metadata["xesam:album"])
                    ? `${metadata["xesam:trackNumber"]} - ${metadata["xesam:album"]} (${metadata["xesam:discNumber"]})`
                    : (Number.isInteger(metadata["xesam:trackNumber"])
                        && metadata["xesam:album"])
                    ? `${metadata["xesam:trackNumber"]} - ${metadata["xesam:album"]}`
                    : "";
            }
        }

        let accessible_name = (artist == this._player_name) ? "" : this._player_name;
        if (this._accessible_name !== accessible_name) {
            this._accessible_name = accessible_name;
            this.notify("accessible-name");
        }
        if (this._cover_url !== coverUrl) {
            this._cover_url = coverUrl;
            this.notify("cover-url");
        }
        if (this._artist !== artist) {
            this._artist = artist;
            this.notify("artist");
        }
        if (this._title !== title) {
            this._title = title;
            this.notify("title");
        }
        if (this._mimetype_icon_name !== mimetypeIcon) {
            this._mimetype_icon_name = mimetypeIcon;
            this.refreshIcon();
        }
    }

    _testShuffleLoopStatus() {
        // This should cause a Shuffle and LoopStatus prop change signals
        // if the player's Shuffle and LoopStatus props work correctly (and even exist, they are optional),
        // which in turn should cause the buttons to show themselves.
        // Otherwise they remain hidden since it's pointless to show widgets that don't do anything...
        // For the sake of UI symmetry if either Shuffle or Loopstatus works both buttons will be shown,
        // the button shown for whichever non-functional prop will just be non-reactive.
        if (this._playerProxy.Shuffle !== null) {
            let initialShuffle = this._playerProxy.Shuffle || false;
            this._playerProxy.Shuffle = !initialShuffle;
            this._playerProxy.Shuffle = initialShuffle;
        }
        if (this._playerProxy.LoopStatus !== null) {
            let initialLoopStatus = this._playerProxy.LoopStatus || "None";
            this._playerProxy.LoopStatus = initialLoopStatus === "None" ? "Playlist"
                : initialLoopStatus === "Playlist" ? "Track"
                : "None";
            this._playerProxy.LoopStatus = initialLoopStatus;
        }
    }

    _updateShuffle() {
        let shuffle_reactive = this._playerProxy.Shuffle !== null;
        let shuffle_active = this._playerProxy.Shuffle || false;
        let show_shuffle_repeat = shuffle_reactive || this._repeat_reactive;

        if (this._shuffle_reactive !== shuffle_reactive) {
            this._shuffle_reactive = shuffle_reactive;
            this.notify("shuffle-reactive");
        }
        if (this._shuffle_active !== shuffle_active) {
            this._shuffle_active = shuffle_active;
            this.notify("shuffle-active");
        }
        if (this._show_shuffle_repeat !== show_shuffle_repeat) {
            this._show_shuffle_repeat = show_shuffle_repeat;
            this.notify("show-shuffle-repeat");
        }
    }

    _updateLoopStatus() {
        let repeat_reactive = this._playerProxy.LoopStatus !== null;
        let show_shuffle_repeat = this._shuffle_reactive || repeat_reactive;
        let loopStatus = this._playerProxy.LoopStatus || "None";
        let repeat_active = loopStatus !== "None";
        let repeat_icon_name = loopStatus == "Track"
            ? "media-playlist-repeat-song-symbolic"
            : "media-playlist-repeat-symbolic";

        if (this._repeat_reactive !== repeat_reactive) {
            this._repeat_reactive = repeat_reactive;
            this.notify("repeat-reactive");
        }
        if (this._repeat_active !== repeat_active) {
            this._repeat_active = repeat_active;
            this.notify("repeat-active");
        }
        if (this._repeat_icon_name !== repeat_icon_name) {
            this._repeat_icon_name = repeat_icon_name;
            this.notify("repeat-icon-name");
        }
        if (this._show_shuffle_repeat !== show_shuffle_repeat) {
            this._show_shuffle_repeat = show_shuffle_repeat;
            this.notify("show-shuffle-repeat");
        }
    }

    _testVolume() {
        // This should cause a Volume props change signal
        // if the player's Volume prop works correctly,
        // which in turn should cause the volume slider to show itself.
        // Spotify's Volume prop is broken for example so the volume slider
        // remains hidden since it's pointless to show a widget that doesn't do anything...
        if (this._playerProxy.Volume !== null) {
            let initialVolume = this._playerProxy.Volume || 0.0;
            this._playerProxy.Volume = initialVolume <= 0.0
                ? 0.1
                : initialVolume >= 1.0
                ? 0.9
                : Math.min(initialVolume - 0.1, 0.0);
            this._playerProxy.Volume = initialVolume;
        }
    }

    _updateVolume() {
        let newVolume = this._playerProxy.Volume
            ? Math.max(0.0, Math.min(this._playerProxy.Volume, 1.0))
            : 0.0;
        if (this._volume !== newVolume) {
            this._volume = newVolume;
            this.notify("volume");
        }
    }

    _getSymbolicIcon() {
        return this._getIcon(true);
    }

    _getFullColorIcon() {
        return (this._appWrapper ? this._appWrapper.gicon : null)
        || this._getIcon(false);
    }

    _getIcon(symbolic) {
        // The default Spotify icon name is spotify-client,
        // but the desktop entry is spotify.
        // Icon names *should* match the desktop entry...
        // Who knows if a 3rd party icon theme wil use spotify
        // or spotify-client as their spotify icon's name and
        // what they'll name their Spotify symbolic icon if
        // they have one at all?
        if (this._desktop_entry) {
            let extra = symbolic ? "-symbolic" : "";
            let desktopEntry = this._desktop_entry;
            let iconNames = [];
            if (desktopEntry.toLowerCase().includes("spotify")) {
                iconNames = [
                    `${desktopEntry}${extra}`,
                    `${desktopEntry}-client${extra}`
                ];
            } else {
                iconNames = [
                    `${desktopEntry}${extra}`
                ];
            }
            let currentIconTheme = Gtk.IconTheme.get_default();
            let iconName = iconNames.find(name => currentIconTheme.has_icon(name));
            let gicon = iconName ? Gio.ThemedIcon.new(iconName) : null;
            if (gicon) {
                gicon.isSymbolic = symbolic;
            }
            return gicon;
        }
        return null;
    }

    _getMimeTypeIcon() {
        let gicon = Gio.ThemedIcon.new(this._mimetype_icon_name);
        gicon.isSymbolic = true;
        return gicon;
    }

    destroy() {
        if (this.updateId) {
            this.disconnect(this.updateId);
        }
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }
        if (this._appWrapper) {
            if (this._focusedId) {
                this._appWrapper.disconnect(this._focusedId);
            }
            this._appWrapper.destroy();
        }
        if (this._mprisProxy) {
            if (this._mprisPropChangeId) {
                this._mprisProxy.disconnect(this._mprisPropChangeId);
            }
            this._mprisProxy.run_dispose();
        }
        if (this._playerProxy) {
            if (this._playerPropChangeId) {
                this._playerProxy.disconnect(this._playerPropChangeId);
            }
            this._playerProxy.run_dispose();
        }
        this._busName = null;
        this._pid = null;
        this.updateId = null;
        this._mprisProxy = null;
        this._mprisPropChangeId = null;
        this._playerProxy = null;
        this._playerPropChangeId = null;
        this._appWrapper = null;
        this._focusedId = null;
        this._player_name = null;
        this._desktop_entry = null;
        this._show_stop = null;
        this._prev_reactive = null;
        this._playpause_reactive = null;
        this._playpause_icon_name = null;
        this._next_reactive = null;
        this._show_shuffle_repeat = null;
        this._shuffle_reactive = null;
        this._shuffle_active = null;
        this._repeat_reactive = null;
        this._repeat_active = null;
        this._repeat_icon_name = null;
        this._cover_url = null;
        this._artist = null;
        this._title = null;
        this._accessible_name = null;
        this._playback_status = null;
        this._status_time = null;
        this._volume = null;
        this._show_volume = null;
        this._gicon = null;
        this._mimetype_icon_name = null;
        this._cancellable = null;
        super.run_dispose();
    }
});
