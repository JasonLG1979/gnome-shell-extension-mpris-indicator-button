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
const Atk = imports.gi.Atk;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Shell = imports.gi.Shell;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Panel = imports.ui.panel;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const DBus = Me.imports.dbus;
const Widgets = Me.imports.widgets;

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
    constructor(busName) {
        super();
        this._app = null;
        this._playerProxy = null;
        this._mprisProxy = null;
        this._status = null;
        this._signals = [];
        this._lastActiveTime = Date.now();
        this._desktopEntry = "";
        this._playerName = "";
        this._playerIconName = "audio-x-generic-symbolic";
        this._busName = busName;

        let vbox = new St.BoxLayout({
            accessible_role: Atk.Role.INTERNAL_FRAME,
            y_align: Clutter.ActorAlign.CENTER,
            vertical: true,
            x_expand: true
        });

        this.actor.add(vbox);

        let hbox = new St.BoxLayout({
            accessible_role: Atk.Role.INTERNAL_FRAME
        });

        vbox.add(hbox);

        this._coverIcon = new Widgets.CoverIcon();

        hbox.add(this._coverIcon);

        let info = new St.BoxLayout({
            style: "padding-left: 12px",
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            vertical: true
        });

        hbox.add(info);

        this._trackArtist = new Widgets.TrackLabel(204, 255);

        info.add(this._trackArtist);

        this._trackTitle = new Widgets.TrackLabel(152, 204);

        info.add(this._trackTitle);

        this._ratingsBox = new Widgets.RatingBox();

        info.add(this._ratingsBox);

        this._pushSignal(this.actor, "notify::hover", (actor) => {
            let hover = actor.hover;
            this._coverIcon.onParentHover(hover);
            this._trackArtist.onParentHover(hover);
            this._trackTitle.onParentHover(hover);
            this._ratingsBox.onParentHover(hover);
        });

        let playerButtonBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME
        });

        vbox.add(playerButtonBox);

        this._prevButton = new Widgets.MediaControlButton(
            "media-skip-backward-symbolic"
        );

        playerButtonBox.add(this._prevButton);

        this._playPauseButton = new Widgets.MediaControlButton(
            "media-playback-start-symbolic"
        );

        playerButtonBox.add(this._playPauseButton);

        this._stopButton = new Widgets.MediaControlButton(
            "media-playback-stop-symbolic"
        );

        this._stopButton.hide();

        playerButtonBox.add(this._stopButton);

        this._nextButton = new Widgets.MediaControlButton(
            "media-skip-forward-symbolic"
        );

        playerButtonBox.add(this._nextButton);

        new DBus.MprisProxy(Gio.DBus.session, busName,
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
                return true;
            } else if (this._playerProxy.CanPlay && !isPlaying) {
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

    raise() {
        if (this._playerProxy) {
            if (this._app) {
                this._app.activate();
                return true;
            } else if (this._mprisProxy.CanRaise) {
                this._mprisProxy.RaiseRemote();
                return true;
            }
        }
        return false;
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }

        if (this._mprisProxy) {
            this._mprisProxy.run_dispose();
        }

        if (this._playerProxy) {
            this._playerProxy.run_dispose();
        }

        this._app = null;
        this._playerProxy = null;
        this._mprisProxy = null;
        this._status = null;
        this._signals = null;
        this._lastActiveTime = null;
        this._desktopEntry = null;
        this._playerName = null;
        this._playerIconName = null;
        this._busName = null;

        super.destroy();
    }

    _pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    _updateMetadata(playerProxy) {
        let artist = "";
        let title = "";
        let coverUrl = "";
        let rating = null;
        let metadata = playerProxy.Metadata || {};
        let metadataKeys = Object.keys(metadata);
        let artistKeys = [
            "xesam:artist",
            "xesam:albumArtist",
            "xesam:composer",
            "xesam:lyricist"
        ];
        let ratingKeys = [
            "xesam:userRating",
            "xesam:autoRating"
        ];

        // Be rather exhaustive and liberal
        // as far as what constitutes an "artist".
        if (metadataKeys.includes("rhythmbox:streamTitle")) {
            artist = metadata["rhythmbox:streamTitle"].unpack();
        }
        if (!artist) {
            for (let i=0; i < 4; i++) {
                let artistKey = artistKeys[i];
                if (metadataKeys.includes(artistKey)) {
                    artist = metadata[artistKey].deep_unpack().join(", ");
                    if (artist) {
                        break;
                    }
                }
            }
        }

        // Prefer the track title, but in it's absence if the
        // track number and album title are available use them.
        // For Example, "5 - My favorite Album". 
        if (metadataKeys.includes("xesam:title")) {
            title = metadata["xesam:title"].unpack();
        }
        if (!title && metadataKeys.includes("xesam:trackNumber")
            && metadataKeys.includes("xesam:album")) {
            let trackNumber = metadata["xesam:trackNumber"].unpack();
            let album = metadata["xesam:album"].unpack();
            if (trackNumber && album) {
                title = trackNumber + " - " + album;
            }
        }

        if (metadataKeys.includes("mpris:artUrl")) {
            coverUrl = metadata["mpris:artUrl"].unpack();
        }

        // Prefer user ratings but fallback to auto ratings.
        // How a player determines auto ratings is up to the player.
        // If the player doesn't support ratings, hide them.
        if (ratingKeys.some(key => metadataKeys.indexOf(key) >= 0)) {
            for (let i=0; i < 2; i++) {
                let ratingKey = ratingKeys[i];
                if (metadataKeys.includes(ratingKey)) {
                    rating = Math.round(metadata[ratingKey].unpack() * 10);
                    if (rating) {
                        break;
                    }
                }
            }
        }

        this._coverIcon.setCover(coverUrl);
        this._trackArtist.set_text(artist || this._playerName);
        this._trackTitle.set_text(title);
        this._ratingsBox.setRating(rating);
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
        this.actor.accessible_name = this._playerName;
        this._desktopEntry = this._mprisProxy.DesktopEntry || "";
        let desktopId = this._desktopEntry + ".desktop";
        this._app = Shell.AppSystem.get_default().lookup_app(desktopId);

        if (this._app || this._mprisProxy.CanRaise) {
            this._pushSignal(this, "activate", () => {
                this.raise();
            });
        }

        new DBus.MprisPlayerProxy(Gio.DBus.session, this._busName,
            "/org/mpris/MediaPlayer2",
            this._onPlayerProxyReady.bind(this));
    }

    _onPlayerProxyReady(playerProxy) {
        this._playerProxy = playerProxy;

        this._pushSignal(this._prevButton, "clicked", () => {
            this._playerProxy.PreviousRemote();
        });

        this._pushSignal(this._playPauseButton, "clicked", () => {
            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay) {
                this._playerProxy.PlayRemote();
            }
        });

        this._pushSignal(this._stopButton, "clicked", () => {
            this._playerProxy.StopRemote();
        });

        this._pushSignal(this._nextButton, "clicked", () => {
            this._playerProxy.NextRemote();
        });

        let themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._pushSignal(themeContext, "changed", () => {
            this._playerIconName = getPlayerIconName(this._desktopEntry);
            this._coverIcon.setFallbackName(this._playerIconName);
            this._updateMetadata(this._playerProxy);
        });

        this._playerIconName = getPlayerIconName(this._desktopEntry);
        this._coverIcon.setFallbackName(this._playerIconName);
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

    _onKeyPressEvent(actor, event) {
        let state = event.get_state();

        if (state === Clutter.ModifierType.CONTROL_MASK) {
            let symbol = event.get_key_symbol();           
            if (symbol === Clutter.KEY_space) {
                this.playPauseStop();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Left) {
                this.previous();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Right) {
                this.next();
                return Clutter.EVENT_STOP;
            }
        }
        super._onKeyPressEvent(actor, event);
    }
}

class MprisIndicatorButton extends PanelMenu.Button {
    constructor() {
        super(0.0, "Mpris Indicator Button", false);
        this.actor.accessible_name = "Mpris";
        this._proxy = null;
        this._signals = [];
        this._checkForPreExistingPlayers = false;

        this.actor.hide();

        this.setMenu(new Widgets.ScrollablePopupMenu(this.actor));

        this._indicatorIcon = new St.Icon({
            accessible_role: Atk.Role.ICON,
            style_class: "system-status-icon"
        });

        this.actor.add_child(this._indicatorIcon);

        let themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._pushSignal(themeContext, "changed", () => {
            this._indicatorIcon.icon_name = this._getLastActivePlayerIcon();
        });

        this._pushSignal(this.actor, "key-press-event", this._onKeyPressEvent.bind(this));

        new DBus.DBusProxy(Gio.DBus.session,
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
        this._signals = null;
        this._checkForPreExistingPlayers = null;

        super.destroy();
    }

    _pushSignal(obj, signalName, func) {
        let signalId = obj.connect(signalName, func);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    _addPlayer(busName) {
        let player = new Player(busName);
        this.menu.addMenuItem(player);
        player._pushSignal(player, "update-player-status", () => {
            this._indicatorIcon.icon_name = this._getLastActivePlayerIcon();
            this.actor.show();            
        });
    }

    _removePlayer(busName) {
        this._destroyPlayer(busName);

        if (this.menu.isEmpty()) {
            this.actor.hide();
            this._indicatorIcon.icon_name = null;
        } else {
            this._indicatorIcon.icon_name = this._getLastActivePlayerIcon();
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
            let button = event.get_button();
            if (button === 2 || button === 3) {
                let player = this._getLastActivePlayer();
                // the expectation is that if a player can't be
                // raised or can't play/pause/stop
                // then button press events will be passed
                // and the button will behave like the rest of
                // GNOME Shell. i.e. clicking any button will
                // open the menu.
                if (player &&
                    (button === 2 && player.playPauseStop()) ||
                    (button === 3 && player.raise())) {
                    return Clutter.EVENT_STOP;
                }
            }
        } else if (eventType === Clutter.EventType.SCROLL) {
            // Scroll events don't currently have a *default* GNOME Shell action
            // like button press events, but we may as well not override scroll events
            // if they aren't going to do anything for us.
            let scrollDirection = event.get_scroll_direction();
            if (scrollDirection === Clutter.ScrollDirection.UP ||
                scrollDirection === Clutter.ScrollDirection.DOWN) {
                let player = this._getLastActivePlayer();
                if (player &&
                    (scrollDirection === Clutter.ScrollDirection.UP && player.previous()) ||
                    (scrollDirection === Clutter.ScrollDirection.DOWN && player.next())) {
                    return Clutter.EVENT_STOP;
                }
            }
        }
        super._onEvent(actor, event);
    }

    _onKeyPressEvent(actor, event) {
        let state = event.get_state();

        if (state === Clutter.ModifierType.CONTROL_MASK) {
            let player = this._getLastActivePlayer();
            if (player) {
                let symbol = event.get_key_symbol();           
                if (symbol === Clutter.KEY_space) {
                    player.playPauseStop();
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.Left) {
                    player.previous();
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.Right) {
                    player.next();
                    return Clutter.EVENT_STOP;
                }
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onProxyReady(proxy) {
        this._proxy = proxy;
        this._proxy.ListNamesRemote(([busNames]) => {
            busNames = busNames.filter(name => name.startsWith("org.mpris.MediaPlayer2."));
            if (busNames.length > 0) {
                busNames.sort();
                this._checkForPreExistingPlayers = true;
                busNames.forEach(busName => this._addPlayer(busName));
            }
        });

        this._proxy.connectSignal("NameOwnerChanged", (proxy, sender, [busName, oldOwner, newOwner]) => {
            if (busName.startsWith("org.mpris.MediaPlayer2.")) {
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
