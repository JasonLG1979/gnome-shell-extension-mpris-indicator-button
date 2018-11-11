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

const Me = imports.misc.extensionUtils.getCurrentExtension();

// Basically a re-implementation of the widely used
// Gio.DBusProxy.makeProxyWrapper tailored 
// for our particular needs.
function _makeProxyWrapper(interfaceXml) {
    let nodeInfo = Gio.DBusNodeInfo.new_for_xml(interfaceXml);
    let interfaceInfo = nodeInfo.interfaces[0];
    let interfaceName = interfaceInfo.name;
    return function(busName, objectPath, flags, asyncCallback) {
        let cancellable = new Gio.Cancellable();
        let error = null;
        let proxy = null;
        Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START | flags,
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
        return cancellable;
    };
}

function logError(error) {
    // Cancelling counts as an error don't spam the logs.
    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        global.log(`[${Me.metadata.uuid}]: ${error.message}`);
    }
}

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

const MprisProxy = _makeProxyWrapper(
`<node>
<interface name="org.mpris.MediaPlayer2">
  <method name="Raise" />
  <property name="CanRaise" type="b" access="read" />
  <property name="Identity" type="s" access="read" />
  <property name="DesktopEntry" type="s" access="read" />
</interface>
</node>`);

const MprisPlayerProxy = _makeProxyWrapper(
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
            param_types: [
                GObject.TYPE_STRING,
                GObject.TYPE_UINT
            ]
        },
        "remove-player": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        },
        "change-player-owner": {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING,
                GObject.TYPE_UINT
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
            this._proxy.ListNamesRemote(([busNames]) => {
                busNames.filter(n => n.startsWith("org.mpris.MediaPlayer2.")).sort().forEach(busName => {
                    this._proxy.GetConnectionUnixProcessIDRemote(busName, ([pid]) => {
                        this.emit("add-player", busName, pid);
                    });
                });
            });

            this._nameOwnerId = this._proxy.connectSignal("NameOwnerChanged", (proxy, sender, [busName, oldOwner, newOwner]) => {
                if (busName.startsWith("org.mpris.MediaPlayer2.")) {
                    if (newOwner && !oldOwner) {
                        this._proxy.GetConnectionUnixProcessIDRemote(busName, ([pid]) => {
                            this.emit("add-player", busName, pid);
                        });
                    } else if (oldOwner && !newOwner) {
                        this.emit("remove-player", busName);
                    } else if (oldOwner && newOwner) {
                        this._proxy.GetConnectionUnixProcessIDRemote(busName, ([pid]) => {
                            this.emit("change-player-owner", busName, pid);
                        });
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
        if (this._proxy && this._nameOwnerId) {
            this._proxy.disconnectSignal(this._nameOwnerId);
            this._proxy.run_dispose();
        }
        this._proxy = null;
        this._nameOwnerId = null
        this._cancellable = null;
        super.run_dispose();
    }
});

var MprisProxyHandler = GObject.registerClass({
    GTypeName: "MprisProxyHandler",
    Signals: {
        "self-destruct": {
            flags: GObject.SignalFlags.RUN_FIRST,
            // Would rather use GObject.TYPE_NONE
            // But that fails?
            param_types: [GObject.TYPE_BOOLEAN]
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
            "playpause-icon-name",
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
        "cover-url": GObject.ParamSpec.string(
            "cover-url",
            "cover-url-prop",
            "the url of the current track's cover art",
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
        "desktop-entry": GObject.ParamSpec.string(
            "desktop-entry",
            "desktop-entry-prop",
            "The desktop entry of the player",
            GObject.ParamFlags.READABLE,
            ""
        ),
        "mimetype-icon-name": GObject.ParamSpec.string(
            "mimetype-icon-name",
            "mimetype-icon-name-prop",
            "The mimetype icon name for the current track",
            GObject.ParamFlags.READABLE,
            "audio-x-generic-symbolic"
        ),
        "playback-status": GObject.ParamSpec.int(
            "playback-status",
            "playback-status-prop",
            "The current playback-status. Playing = 2, Paused = 1, Stopped = 0",
            GObject.ParamFlags.READABLE,
            0
        )
    }
}, class MprisProxyHandler extends GObject.Object {
    _init(busName) {
        super._init();
        this._mprisProxy = null;
        this._mprisPropChangeId = null;
        this._playerProxy = null;
        this._playerPropChangeId = null;
        this._player_name = "";
        this._desktop_entry = "";
        this._name_owner = "";
        this._show_stop = false;
        this._prev_reactive = false;
        this._playpause_reactive = false;
        this._playpause_icon_name = "media-playback-start-symbolic";
        this._next_reactive = false;
        this._cover_url = "";
        this._artist = "";
        this._title = "";
        this._playback_status = 0;
        this._status_time = 0;
        this._track_url = "";
        this._mimetype_icon_name = "audio-x-generic-symbolic";
        this._proxyCancellables = [
            new MprisProxy(
                busName,
                "/org/mpris/MediaPlayer2",
                Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
                (mprisProxy, error) => {
                    if (mprisProxy) {
                        this._mprisProxy = mprisProxy;
                        this._onProxiesReady();
                    } else {
                        logError(error);
                        this.emit("self-destruct", true);
                    }
                }
            ),
            new MprisPlayerProxy(
                busName,
                "/org/mpris/MediaPlayer2",
                Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
                (playerProxy, error) => {
                    if (playerProxy) {
                        this._playerProxy = playerProxy;
                        this._onProxiesReady();
                    } else {
                        logError(error);
                        this.emit("self-destruct", true);
                    }
                }
            )
        ];
    }

    get player_name() {
        return this._player_name || "";
    }

    get desktop_entry() {
        return this._desktop_entry || "";
    }

    get name_owner() {
        return this._name_owner || "";
    }

    get show_stop() {
        return this._show_stop || false;
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

    get mimetype_icon_name() {
        return this._mimetype_icon_name || "audio-x-generic-symbolic";
    }

    get next_reactive() {
        return this._next_reactive || false;
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

    raise() {
        if (this._mprisProxy && this._mprisProxy.CanRaise) {
            this._mprisProxy.RaiseRemote();
            return true;
        }
        return false;
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

    _onProxiesReady() {
        if (this._mprisProxy && this._playerProxy) {
            this._proxyCancellables.forEach(cancellable => cancellable.run_dispose());
            this._name_owner = this._mprisProxy.g_name_owner;
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
            });
            this._updateMprisProps();
            this._updatePlayerProps();
            this._updateMetadata();
            this._proxyCancellables = null;
        }
    }

    _primitiveTypeCheck(variable, primitiveDefault) {
        // MPRIS implementations can be, and more often then not are broken
        // in mind numbingly stupid ways. The number of players that get it 100%
        // right can be counted on 1 hand. This is unfortunately necessary to make
        // our code more robust and error resistant/tolerant. 
        // 
        // *ONLY WORKS WITH PRIMITIVES*
        // undefined, boolean, string and number.
        // everything else will be a typeof object.
        //
        // Cached props can return null if the player does not implement the prop.
        // Player can also send the wrong types in the metadata.
        // That's OK if we're just trying to find the truthiness of a prop
        // that is suppose to be a bool but not so good when we expect a certain type.
        // This checks the variable type against the primitive default type.
        // If they are the same type it returns the variable, otherwise the primitive default.
        return (variable !== null && typeof variable == typeof primitiveDefault) ? variable : primitiveDefault;
    }

    _updateMprisProps() {
        this._player_name = this._primitiveTypeCheck(this._mprisProxy.Identity, "");
        this._desktop_entry = this._primitiveTypeCheck(this._mprisProxy.DesktopEntry, "").split("/").pop().replace(".desktop", "");
        if (this._player_name && this._desktop_entry && this._mprisPropChangeId) {
            // Once we have our player name and desktop entry we don't need to be connected
            // to the mpris proxy prop changed signal anymore.
            this._mprisProxy.disconnect(this._mprisPropChangeId);
            this._mprisPropChangeId = null;
            this.notify("desktop-entry");
        }
    }

    _updatePlayerProps() {
        let playPauseIconName = "media-playback-start-symbolic";
        let playPauseReactive = false;
        let showStop = false;
        let status = this._get_playback_status();
        let isPlaying = status === 2;
        let canPlay = this._primitiveTypeCheck(this._playerProxy.CanPlay, false);
        let canPause = this._primitiveTypeCheck(this._playerProxy.CanPause, false);
        let canGoPrevious = this._primitiveTypeCheck(this._playerProxy.CanGoPrevious, false);
        let canGoNext = this._primitiveTypeCheck(this._playerProxy.CanGoNext, false); 

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
            this._status_time = global.get_current_time();
            this.notify("playback_status");
        }
    }

    _get_playback_status() {
        if (this._playerProxy) {
            let status = this._primitiveTypeCheck(this._playerProxy.PlaybackStatus, "").toLowerCase();
            if (status === "playing") {
                return 2;
            } else if (status === "paused") {
                return 1;
            }
        }
        return 0;
    }

    _updateMetadata() {
        let artist = "";
        let title = "";
        let coverUrl = "";
        let mimetypeIconName = "audio-x-generic-symbolic";
        let metadata = this._playerProxy.Metadata || {};
        let metadataKeys = Object.keys(metadata);
        let artistKeys = [
            "xesam:artist",
            "xesam:albumArtist",
            "xesam:composer",
            "xesam:lyricist"
        ];

        if (metadataKeys.length) {
            // Be rather exhaustive and liberal
            // as far as what constitutes an "artist".
            if (metadataKeys.includes("rhythmbox:streamTitle")) {
                artist = this._primitiveTypeCheck(metadata["rhythmbox:streamTitle"].unpack(), "");
            }
            if (!artist) {
                for (let key of artistKeys) {
                    if (metadataKeys.includes(key)) {
                        let artists = [];
                        try {
                            artists = metadata[key].deep_unpack();
                            artist = (Array.isArray(artists) && artists.length) ? artists.join(", ") : "";
                        } catch {
                            artist = "";
                        } finally {
                            if (artist) {
                                break;
                            }
                        }
                    }
                }
            }

            // Prefer the track title, but in it's absence if the
            // track number and album title are available use them.
            // For Example, "5 - My favorite Album". 
            if (metadataKeys.includes("xesam:title")) {
                title = this._primitiveTypeCheck(metadata["xesam:title"].unpack(), "");
            }
            if (!title && metadataKeys.includes("xesam:trackNumber")
                && metadataKeys.includes("xesam:album")) {
                let trackNumber = this._primitiveTypeCheck(metadata["xesam:trackNumber"].unpack(), 0);
                let album = this._primitiveTypeCheck(metadata["xesam:album"].unpack(), "");
                title = (trackNumber && album) ? `${trackNumber} - ${album}` : "";
            }

            if (metadataKeys.includes("mpris:artUrl")) {
                coverUrl = this._primitiveTypeCheck(metadata["mpris:artUrl"].unpack(), "");
            }

            if (metadataKeys.includes("xesam:url")) {
                let url = this._primitiveTypeCheck(metadata["xesam:url"].unpack(), "");
                if (this._track_url !== url) {
                    this._track_url = url;
                    for (let line of url.split("/")) {
                        if (line.includes(".")) {
                            let matches = line.match(/([.\w]+)([.][\w]+)([?][w.=]+)?/);
                            if (matches) {
                                let [type, uncertain] = Gio.content_type_guess(matches[0], null);
                                if (!uncertain) {
                                    if (type.includes("audio")) {
                                        break;
                                    } else if (type.includes("video")) {
                                        mimetypeIconName = "video-x-generic-symbolic";
                                        break;
                                    }
                                }
                            } 
                        }
                    }
                }
            }
        }

        artist = artist || this._player_name;

        if (this._mimetype_icon_name !== mimetypeIconName) {
            this._mimetype_icon_name = mimetypeIconName;
            this.notify("mimetype-icon-name");
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
    }

    destroy() {
        if (this._proxyCancellables) {
            this._proxyCancellables.forEach(cancellable => {
                if (!cancellable.is_cancelled()) {
                    cancellable.cancel();
                }
                cancellable.run_dispose();
            });
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
        this._mprisProxy = null;
        this._mprisPropChangeId = null;
        this._playerProxy = null;
        this._playerPropChangeId = null;
        this._player_name = null;
        this._desktop_entry = null;
        this._name_owner = null;
        this._show_stop = null;
        this._prev_reactive = null;
        this._playpause_reactive = null;
        this._playpause_icon_name = null;
        this._next_reactive = null;
        this._cover_url = null;
        this._artist = null;
        this._title = null;
        this._playback_status = null;
        this._status_time = null;
        this._track_url = null;
        this._mimetype_icon_name = null;
        this._proxyCancellables = null;
        super.run_dispose();
    }
});
