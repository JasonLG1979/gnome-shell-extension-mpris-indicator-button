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

const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Shell = imports.gi.Shell;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Panel = imports.ui.panel;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(
`<node>
<interface name="org.freedesktop.DBus">
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

const MprisProxy = Gio.DBusProxy.makeProxyWrapper(
`<node>
<interface name="org.mpris.MediaPlayer2">
  <method name="Raise" />
  <property name="CanRaise" type="b" access="read" />
  <property name="Identity" type="s" access="read" />
  <property name="DesktopEntry" type="s" access="read" />
</interface>
</node>`);

const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(
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

const MPRIS_PLAYER_PREFIX = "org.mpris.MediaPlayer2.";

let indicator = null;
let stockMpris = null;
let stockMprisOldShouldShow = null;

function getPlayerIconName(desktopEntry) {
    // Prefer symbolic icons.
    // The default Spotify icon name is spotify-client,
    // but the desktop entry is spotify.
    // Icon names *should* match the desktop entry...
    // Who knows if a 3rd party icon theme wil use spotify
    // or spotify-client as their spotify icon's name and
    // what they'll name their Spotify symbolic icon if
    // they have one at all?
    let iconName = "audio-x-generic-symbolic";

    if (desktopEntry) {
        let possibleIconNames = [];

        if (desktopEntry.toLowerCase() === "spotify") {
            possibleIconNames = [desktopEntry + "-symbolic",
                desktopEntry + "-client-symbolic",
                desktopEntry,
                desktopEntry + "-client"
            ];
        } else {
            possibleIconNames = [desktopEntry + "-symbolic",
                desktopEntry
            ];
        }

        let currentIconTheme = Gtk.IconTheme.get_default();

        for (let i = 0; i < possibleIconNames.length; i++) {
            if (currentIconTheme.has_icon(possibleIconNames[i])) {
                iconName = possibleIconNames[i];
                break;
            }
        }
    }
    return iconName;
}

function enable() {
    stockMpris = Main.panel.statusArea.dateMenu._messageList._mediaSection;
    stockMprisOldShouldShow = stockMpris._shouldShow;
    stockMpris.actor.hide();
    stockMpris._shouldShow = function () {
        return false;
    };
    indicator = Main.panel.addToStatusArea("mprisindicatorbutton",
        new MprisIndicatorButton(), 0, "right");
}

function disable() {
    if (indicator) {
        indicator.destroy();
    }

    if (stockMpris && stockMprisOldShouldShow) {
        stockMpris._shouldShow = stockMprisOldShouldShow;
        if (stockMpris._shouldShow()) {
            stockMpris.actor.show();
        }
    }

    indicator = null;
    stockMpris = null;
    stockMprisOldShouldShow = null;
}

class Player extends PopupMenu.PopupBaseMenuItem {
    constructor(busName, updateCallback) {
        super();
        this._app = null;
        this._cancellable = null;
        this._playerProxy = null;
        this._mprisProxy = null;
        this._status = null;
        this._themeContext = null;
        this._signals = [];
        this._lastActiveTime = Date.now();
        this._desktopEntry = "";
        this._playerName = "";
        this._playerIconName = "audio-x-generic-symbolic";
        this._busName = busName;

        this._pushSignal(
            this,
            this.connect("update-player-status", updateCallback)
        );

        let vbox = new St.BoxLayout({
            vertical: true,
            x_expand: true
        });

        this.actor.add(vbox);

        let hbox = new St.BoxLayout();

        vbox.add(hbox);

        this._coverIcon = new St.Icon({
            style_class: "media-message-cover-icon"
        });

        hbox.add(this._coverIcon);

        let info = new St.BoxLayout({
            style_class: "message-content",
            vertical: true
        });

        hbox.add(info);

        this._trackArtist = new St.Label({
            style_class: "message-title"
        });

        info.add(this._trackArtist);

        this._trackTitle = new St.Label({
            style_class: "message-body"
        });

        info.add(this._trackTitle);

        let playerButtonBox = new St.BoxLayout();

        vbox.add(playerButtonBox, {
            x_fill: false
        });

        this._prevButton = new St.Button({
            style_class: "message-media-control",
            child: new St.Icon({
                icon_name: "media-skip-backward-symbolic",
                icon_size: 16
            })
        });

        playerButtonBox.add(this._prevButton);

        this._playPauseButton = new St.Button({
            style_class: "message-media-control",
            child: new St.Icon({
                icon_name: "media-playback-start-symbolic",
                icon_size: 16
            })
        });

        playerButtonBox.add(this._playPauseButton);

        this._stopButton = new St.Button({
            style_class: "message-media-control",
            child: new St.Icon({
                icon_name: "media-playback-stop-symbolic",
                icon_size: 16
            })
        });

        this._stopButton.hide();

        playerButtonBox.add(this._stopButton);

        this._nextButton = new St.Button({
            style_class: "message-media-control",
            child: new St.Icon({
                icon_name: "media-skip-forward-symbolic",
                icon_size: 16
            })
        });

        playerButtonBox.add(this._nextButton);

        new MprisProxy(Gio.DBus.session, busName,
            "/org/mpris/MediaPlayer2",
            this._onMprisProxy.bind(this));
    }

    get lastActiveTime() {
        return this._lastActiveTime;
    }

    get statusValue() {
        if (this._status === "playing") {
            return 0;
        } else if (this._status === "paused") {
            return 1;
        } else {
            return 2;
        }
    }

    get desktopEntry() {
        return this._desktopEntry;
    }

    get busName() {
        return this._busName;
    }

    playPauseStop() {
        if (this._playerProxy) {
            let status = this._playerProxy.PlaybackStatus.toLowerCase();
            let isPlaying = status === "playing";

            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay && !isPlaying) {
                this._playerProxy.PlayRemote();
            } else if (isPlaying) {
                this._playerProxy.StopRemote();
            }
        }
    }

    previous() {
        if (this._playerProxy && this._playerProxy.CanGoPrevious) {
            this._playerProxy.PreviousRemote();
        }
    }

    next() {
        if (this._playerProxy && this._playerProxy.CanGoNext) {
            this._playerProxy.NextRemote();
        }
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }

        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }

        if (this._mprisProxy) {
            this._mprisProxy.run_dispose();
        }

        if (this._playerProxy) {
            this._playerProxy.run_dispose();
        }

        this._app = null;
        this._cancellable = null;
        this._playerProxy = null;
        this._mprisProxy = null;
        this._status = null;
        this._themeContext = null;
        this._signals = null;
        this._lastActiveTime = null;
        this._desktopEntry = null;
        this._playerName = null;
        this._playerIconName = null;
        this._busName = null;

        super.destroy();
    }

    _pushSignal(obj, signalId) {
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    _setCoverIcon(coverUrl) {
        // Asynchronously set the cover icon.
        // Much more fault tolerant than:
        //
        // let file = Gio.File.new_for_uri(coverUrl);
        // icon.gicon = new Gio.FileIcon({ file: file });
        //
        // Which silently fails on error and can lead to the wrong cover being shown.
        // On error this will fallback gracefully to this._playerIconName.
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
            this._cancellable = null;
        }

        if (coverUrl) {
            let file = Gio.File.new_for_uri(coverUrl);
            this._cancellable = new Gio.Cancellable();
            file.load_contents_async(this._cancellable, (source, result) => {
                try {
                    let bytes = source.load_contents_finish(result)[1];
                    let newIcon = Gio.BytesIcon.new(bytes);
                    if (!newIcon.equal(this._coverIcon.gicon)) {
                        this._coverIcon.gicon = newIcon;
                    }
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        this._coverIcon.icon_name = this._playerIconName;
                    }
                }
            });
        } else {
            this._coverIcon.icon_name = this._playerIconName;
        }
    }

    _updateMetadata(playerProxy) {
        let artist = "";
        let title = "";
        let coverUrl = "";
        let metadata = playerProxy.Metadata || {};
        let metadataKeys = Object.keys(metadata);

        if (this.statusValue < 2) {
            if (metadataKeys.includes("rhythmbox:streamTitle")) {
                artist = metadata["rhythmbox:streamTitle"].unpack();
            } else if (metadataKeys.includes("xesam:artist")) {
                artist = metadata["xesam:artist"].deep_unpack().join(", ");
            }

            if (metadataKeys.includes("xesam:title")) {
                title = metadata["xesam:title"].unpack();
            }

            if (metadataKeys.includes("mpris:artUrl")) {
                coverUrl = metadata["mpris:artUrl"].unpack();
            }
        }

        this._setCoverIcon(coverUrl);
        this._trackArtist.text = artist || this._playerName;
        this._trackTitle.text = title;
    }

    _updateProps(playerProxy) {
        let playPauseIconName, playPauseReactive;
        let status = playerProxy.PlaybackStatus.toLowerCase();
        let isPlaying = status === "playing";

        if (playerProxy.CanPause && playerProxy.CanPlay) {
            this._stopButton.hide();
            playPauseIconName = isPlaying ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";
            playPauseReactive = true;
        } else {
            if (playerProxy.CanPlay) {
                this._stopButton.show();
            }
            playPauseIconName = "media-playback-start-symbolic";
            playPauseReactive = playerProxy.CanPlay;
        }

        this._prevButton.reactive = playerProxy.CanGoPrevious;

        this._playPauseButton.child.icon_name = playPauseIconName;

        this._playPauseButton.reactive = playPauseReactive;

        this._nextButton.reactive = playerProxy.CanGoNext;

        if (this._status !== status) {
            this._status = status;
            this._lastActiveTime = Date.now();
            this.emit("update-player-status");
        }
    }

    _onMprisProxy(mprisProxy) {
        this._mprisProxy = mprisProxy;
        this._playerName = this._mprisProxy.Identity || "";
        this._desktopEntry = this._mprisProxy.DesktopEntry || "";
        let desktopId = this._desktopEntry + ".desktop";
        this._app = Shell.AppSystem.get_default().lookup_app(desktopId);

        if (this._app || this._mprisProxy.CanRaise) {
            this._pushSignal(this, this.connect("activate", () => {
                if (this._app) {
                    this._app.activate();
                } else if (this._mprisProxy.CanRaise) {
                    this._mprisProxy.RaiseRemote();
                }
            }));
        }

        new MprisPlayerProxy(Gio.DBus.session, this._busName,
            "/org/mpris/MediaPlayer2",
            this._onPlayerProxyReady.bind(this));
    }

    _onPlayerProxyReady(playerProxy) {
        this._playerProxy = playerProxy;

        this._pushSignal(this._prevButton, this._prevButton.connect("clicked", () => {
            this._playerProxy.PreviousRemote();
        }));

        this._pushSignal(this._playPauseButton, this._playPauseButton.connect("clicked", () => {
            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay) {
                this._playerProxy.PlayRemote();
            }
        }));

        this._pushSignal(this._stopButton, this._stopButton.connect("clicked", () => {
            this._playerProxy.StopRemote();
        }));

        this._pushSignal(this._nextButton, this._nextButton.connect("clicked", () => {
            this._playerProxy.NextRemote();
        }));

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._pushSignal(this._themeContext, this._themeContext.connect("changed", () => {
            this._playerIconName = getPlayerIconName(this._desktopEntry);
            this._updateMetadata(this._playerProxy);
        }));

        this._playerIconName = getPlayerIconName(this._desktopEntry);
        this._updateProps(this._playerProxy);
        this._updateMetadata(this._playerProxy);

        this._playerProxy.connect("g-properties-changed", (proxy, props, invalidated_props) => {
            props = Object.keys(props.deep_unpack()).concat(invalidated_props);
            if (props.includes("PlaybackStatus") || props.some(prop => prop.startsWith("Can"))) {
                this._updateProps(proxy);
            }

            if (props.includes("Metadata")) {
                this._updateMetadata(proxy);
            }
        });
    }
}

class MprisIndicatorButton extends PanelMenu.Button {
    constructor() {
        super(0.0, "Mpris Indicator Button", false);
        this._proxy = null;
        this._themeContext = null;
        this._signals = [];
        this._checkForPreExistingPlayers = false;

        this.actor.hide();

        this.menu.actor.add_style_class_name("aggregate-menu");

        // AggregateLayout keeps the Indicator the same size as the
        // system menu (aggregate menu) and makes sure our text
        // ellipses correctly.

        this.menu.box.set_layout_manager(new Panel.AggregateLayout());

        this._indicator_icon = new St.Icon({
            style_class: "system-status-icon"
        });

        this.actor.add_child(this._indicator_icon);

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._pushSignal(this._themeContext, this._themeContext.connect("changed", () => {
            this._indicator_icon.icon_name = this._getLastActivePlayerIcon();
        }));

        new DBusProxy(Gio.DBus.session,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            this._onProxyReady.bind(this));
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }

        if (this._proxy) {
            this._proxy.run_dispose();
        }

        this._proxy = null;
        this._themeContext = null;
        this._signals = null;
        this._checkForPreExistingPlayers = null;

        super.destroy();
    }

    _pushSignal(obj, signalId) {
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    _addPlayer(busName) {
        this.menu.addMenuItem(
            new Player(
                busName,
                () => {
                    this._indicator_icon.icon_name = this._getLastActivePlayerIcon();
                    this.actor.show();
                }
            )
        );
    }

    _removePlayer(busName) {
        this._destroyPlayer(busName);

        if (this.menu.isEmpty()) {
            this.actor.hide();
            this._indicator_icon.icon_name = null;
        } else {
            this._indicator_icon.icon_name = this._getLastActivePlayerIcon();
        }
    }

    _changePlayerOwner(busName) {
        this._destroyPlayer(busName);
        this._addPlayer(busName);
    }

    _destroyPlayer(busName) {
        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            if (busName === player.busName) {
                player.destroy();
                break;
            }
        }
    }

    _byStatusAndTime(a, b) {
        if (a.statusValue < b.statusValue) {
            return -1;
        } else if (a.statusValue > b.statusValue) {
            return 1;
        } else {
            if (a.lastActiveTime > b.lastActiveTime) {
                return -1;
            } else if (a.lastActiveTime < b.lastActiveTime) {
                return 1;
            } else {
                return 0;
            }
        }
    }

    _averageLastActiveTimeDelta(players) {
        let values = players.map(player => player.lastActiveTime);
        let len = values.length;
        let avg = values.reduce((sum, value) => sum + value) / len;
        let deltas = values.map(value => Math.abs(value - avg));
        let avgDelta = deltas.reduce((sum, value) => sum + value) / len;
        return avgDelta;
    }

    _getLastActivePlayer() {
        let player = null;
        if (!this.menu.isEmpty()) {
            let players = this.menu._getMenuItems();
            if (players.length === 1) {
                player = players[0];
            } else if (this._checkForPreExistingPlayers) {
                if (this._averageLastActiveTimeDelta(players) < 250) {
                    let playing = players.filter(player => player.statusValue === 0);
                    if (playing.length === 1) {
                        player = playing[0];
                    } else if (playing.length === 0) {
                        let paused = players.filter(player => player.statusValue === 1);
                        if (paused.length === 1) {
                            player = paused[0];
                        }
                    }
                } else {
                    this._checkForPreExistingPlayers = false;
                    players.sort(this._byStatusAndTime);
                    player = players[0];
                }
            } else {
                players.sort(this._byStatusAndTime);
                player = players[0];
            }
        }
        return player;
    }

    _getLastActivePlayerIcon() {
        let player = this._getLastActivePlayer();
        let iconName = player ? getPlayerIconName(player.desktopEntry) : "audio-x-generic-symbolic";
        return iconName;
    }

    _onEvent(actor, event) {
        let eventType = event.type();
        if (eventType === Clutter.EventType.BUTTON_PRESS) {
            if (event.get_button() === 2) {
                let player = this._getLastActivePlayer();
                if (player) {
                    player.playPauseStop();
                    return Clutter.EVENT_STOP;
                }
            }
        } else if (eventType === Clutter.EventType.SCROLL) {
            let player = this._getLastActivePlayer();
            if (player) {
                let scrollDirection = event.get_scroll_direction();
                if (scrollDirection === Clutter.ScrollDirection.UP) {
                    player.previous();
                    return Clutter.EVENT_STOP;
                } else if (scrollDirection === Clutter.ScrollDirection.DOWN) {
                    player.next();
                    return Clutter.EVENT_STOP;
                }
            }
        }
        super._onEvent(actor, event);
    }

    _onProxyReady(proxy) {
        this._proxy = proxy;
        this._proxy.ListNamesRemote(([busNames]) => {
            busNames = busNames.filter(name => name.startsWith(MPRIS_PLAYER_PREFIX));
            if (busNames.length > 0) {
                busNames.sort();
                this._checkForPreExistingPlayers = true;
                busNames.forEach(busName => this._addPlayer(busName));
            }
        });

        this._proxy.connectSignal("NameOwnerChanged", (proxy, sender, [busName, oldOwner, newOwner]) => {
            if (busName.startsWith(MPRIS_PLAYER_PREFIX)) {
                if (newOwner && !oldOwner) {
                    this._addPlayer(busName);
                } else if (oldOwner && !newOwner) {
                    this._removePlayer(busName);
                } else if (oldOwner && newOwner) {
                    this._changePlayerOwner(busName);
                }
            }
        });
    }
}
