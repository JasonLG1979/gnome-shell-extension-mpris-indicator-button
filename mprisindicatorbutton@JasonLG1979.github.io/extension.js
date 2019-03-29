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

const { Atk, Clutter, GLib, GObject, Gtk, St } = imports.gi;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const stockMpris = Main.panel.statusArea.dateMenu._messageList._mediaSection;
const shouldShow = stockMpris._shouldShow;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const DBus = Me.imports.dbus;
const Widgets = Me.imports.widgets;

const DEFAULT_SYNC_CREATE_PROP_FLAGS = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;
const BIDIRECTIONAL_SYNC_CREATE_PROP_FLAGS = GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE;

var indicator = null;

function enable() {
    stockMpris.actor.hide();
    stockMpris._shouldShow = () => false;
    if (!indicator) {
        indicator = Main.panel.addToStatusArea(
            "mprisindicatorbutton",
            new MprisIndicatorButton(),
            0,
            "right"
        );
    }
}

function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
    stockMpris._shouldShow = shouldShow;
    if (stockMpris._shouldShow()) {
        stockMpris.actor.show();
    }
}

class Player extends PopupMenu.PopupBaseMenuItem {
    constructor(mpris, updateIndicator) {
        super();
        this._mpris = null;

        let vbox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            vertical: true,
            x_expand: true
        });

        this.actor.add(vbox);

        let hbox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            x_expand: true
        });

        vbox.add(hbox);

        let coverIcon = new Widgets.CoverIcon("coverIcon");

        hbox.add(coverIcon);

        let info = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            vertical: true,
            x_expand: true
        });

        hbox.add(info);

        let trackArtist = new Widgets.TrackLabel(
            "trackArtist",
            204,
            255
        );

        info.add(trackArtist);

        let trackTitle = new Widgets.TrackLabel(
            "trackTitle",
            152,
            204
        );

        info.add(trackTitle);

        let playerButtonBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            x_expand: true
        });

        vbox.add(playerButtonBox);

        let prevButton = new Widgets.MediaControlButton(
            "prevButton",
            "media-skip-backward-symbolic"
        );

        playerButtonBox.add(prevButton);

        let playPauseButton = new Widgets.MediaControlButton(
            "playPauseButton",
            "media-playback-start-symbolic"
        );

        playerButtonBox.add(playPauseButton);

        let stopButton = new Widgets.MediaControlButton(
            "stopButton",
            "media-playback-stop-symbolic"
        );

        playerButtonBox.add(stopButton);

        let nextButton = new Widgets.MediaControlButton(
            "nextButton",
            "media-skip-forward-symbolic"
        );

        playerButtonBox.add(nextButton);

        let volumeSlider = new Widgets.VolumeSlider(
            "volumeSlider"
        );

        vbox.add(volumeSlider);

        this.actor.bind_property(
            "hover",
            coverIcon,
            "hover",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.actor.bind_property(
            "hover",
            trackArtist,
            "hover",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.actor.bind_property(
            "hover",
            trackTitle,
            "hover",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        let signals = [];

        let pushSignal = (obj, signalName, callback) => {
            let signalId = obj.connect(signalName, callback);
            signals.push({
                obj: obj,
                signalId: signalId
            });
        };

        pushSignal(this, "activate", () => {
            this.toggleWindow(false);
        });

        pushSignal(prevButton, "clicked", () => {
            if (this._mpris) {
                this._mpris.previous();
            }
        });

        pushSignal(playPauseButton, "clicked", () => {
            if (this._mpris) {
                this._mpris.playPause();
            }
        });

        pushSignal(stopButton, "clicked", () => {
            if (this._mpris) {
                this._mpris.stop();
            }
        });

        pushSignal(nextButton, "clicked", () => {
            if (this._mpris) {
                this._mpris.next();
            }
        });

        pushSignal(this.actor, "destroy", () => {
            signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            if (this._mpris) {
                this._mpris.destroy();
                this._mpris = null;
            }
        });

        this.setMpris(mpris, updateIndicator);
    }

    get playerName() {
        return this._mpris ? this._mpris.player_name : "";
    }

    get busName() {
        return this._mpris ? this._mpris.busName : "";
    }

    get gicon() {
        return this._mpris ? this._mpris.gicon : null;
    }

    get userTime() {
        return this._mpris ? this._mpris.user_time : 0;
    }

    get statusTime() {
        return this._mpris ? this._mpris.status_time : 0;
    }

    get playbackStatus() {
        return this._mpris ? this._mpris.playback_status : 0;
    }

    get focused() {
        return this._mpris ? this._mpris.focused : false;
    }

    volumeUp() {
        if (this._mpris) {
            this._mpris.volumeUp();
        }
    }

    volumeDown() {
        if (this._mpris) {
            this._mpris.volumeDown();
        }
    }

    playPauseStop() {
        return this._mpris ? this._mpris.playPauseStop() : false;
    }

    previous() {
        return this._mpris ? this._mpris.previous() : false;
    }

    next() {
        return this._mpris ? this._mpris.next() : false;
    }

    toggleWindow(minimize) {
        return this._mpris ? this._mpris.toggleWindow(minimize) : false;
    }

    toggleMute() {
        return;
    }

    refreshIcon() {
        if (this._mpris) {
            this._mpris.refreshIcon();
        }
    }

    setMpris(mpris, updateIndicator) {
        if (this._mpris) {
            this._mpris.destroy();
        }

        let getNamedActors = (actor) => {
            return actor.get_children().reduce((actors, actor) => {
                return actor.name
                ? actors.concat(actor).concat(getNamedActors(actor))
                : actors.concat(getNamedActors(actor));
            }, []);
        };

        let namedActors = getNamedActors(this.actor);

        let getActorByName = (name) => {
            return namedActors.find((actor) => actor.name === name);
        };

        let coverIcon = getActorByName("coverIcon");
        let prevButton = getActorByName("prevButton");
        let playPauseButton = getActorByName("playPauseButton");
        let stopButton = getActorByName("stopButton");
        let nextButton = getActorByName("nextButton");
        let trackArtist = getActorByName("trackArtist");
        let trackTitle = getActorByName("trackTitle");
        let volumeSlider = getActorByName("volumeSlider");

        this._mpris = mpris;

        this._mpris.updateId = this._mpris.connect("update-indicator", updateIndicator);

        this._mpris.bind_property(
            "accessible-name",
            this.actor,
            "accessible-name",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "cover-url",
            coverIcon,
            "cover-url",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "gicon",
            coverIcon,
            "fallback-gicon",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "show-stop",
            stopButton,
            "visible",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "prev-reactive",
            prevButton,
            "reactive",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "playpause-reactive",
            playPauseButton,
            "reactive",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "playpause-icon-name",
            playPauseButton.child,
            "icon-name",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "next-reactive",
            nextButton,
            "reactive",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "artist",
            trackArtist,
            "text",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            "title",
            trackTitle,
            "text",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );


        this._mpris.bind_property(
            "volume",
            volumeSlider,
            "value",
            BIDIRECTIONAL_SYNC_CREATE_PROP_FLAGS
        );

        volumeSlider.hide();
        this._mpris.testVolume();
        this.toggleMute = () => {
            volumeSlider.toggleMute();
        };
    }

    _onKeyPressEvent(actor, event) {
        let ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) != 0;
        if (ctrl) {
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
            } else if (symbol === Clutter.Up) {
                this.volumeUp();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Down) {
                this.volumeDown();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Return) {
                this.toggleMute();
                return Clutter.EVENT_STOP;
            }
        }
        super._onKeyPressEvent(actor, event);
    }
}

var MprisIndicatorButton = GObject.registerClass({
    GTypeName: "MprisIndicatorButton"
}, class MprisIndicatorButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, "Mpris Indicator Button", false);
        this.accessible_name = "Mpris";
        this.menu.actor.add_style_class_name("aggregate-menu");
        this.menu.box.set_layout_manager(new Panel.AggregateLayout());

        this.hide();

        let indicator = new St.Icon({
            accessible_role: Atk.Role.ICON,
            style_class: "system-status-icon"
        })

        this.add_child(indicator);

        let signals = [];

        let pushSignal = (obj, signalName, callback) => {
            let signalId = obj.connect(signalName, callback);
            signals.push({
                obj: obj,
                signalId: signalId
            });
        };

        pushSignal(St.ThemeContext.get_for_stage(global.stage), "changed", () => {
            this.menu._getMenuItems().forEach(player => player.refreshIcon());
        });

        pushSignal(this, "key-press-event", (actor, event) => {
            let ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) != 0;
            if (ctrl) {
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
                    } else if (symbol === Clutter.Up) {
                        player.volumeUp();
                        return Clutter.EVENT_STOP;
                    } else if (symbol === Clutter.Down) {
                        player.volumeDown();
                        return Clutter.EVENT_STOP;
                    } else if (symbol === Clutter.Return) {
                        player.toggleMute();
                        return Clutter.EVENT_STOP;
                    }
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        let getPlayer = (busName) => this.menu._getMenuItems().find(p => p.busName === busName);

        let updateIndicator = () => {
            let player = this._getLastActivePlayer();
            indicator.gicon = player ? player.gicon : null;
            this.visible = indicator.gicon ? true : false;
        };

        let proxyHandler = new DBus.DBusProxyHandler();

        pushSignal(proxyHandler, "add-player", (proxyHandler, mpris) => {
            this.menu.addMenuItem(new Player(mpris, updateIndicator));
        });

        pushSignal(proxyHandler, "remove-player", (proxyHandler, busName) => {
            let player = getPlayer(busName);
            if (player) {
                player.destroy();
                updateIndicator();
            }
        });

        pushSignal(proxyHandler, "change-player-owner", (proxyHandler, busName, mpris) => {
            let player = getPlayer(busName);
            if (player) {
                player.setMpris(mpris, updateIndicator);
            }
        });

        pushSignal(this, "destroy", () => {
            signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            proxyHandler.destroy();
        });
    }

    _getLastActivePlayer() {
        let players = this.menu._getMenuItems();
        return players.length == 1
            ? players[0]
            : players.length > 1
            ? players.sort((a, b) => {
                return a.focused
                    ? -1
                    : b.focused
                    ? 1
                    : a.playbackStatus > b.playbackStatus
                    ? -1
                    : a.playbackStatus < b.playbackStatus
                    ? 1
                    : a.userTime > b.userTime
                    ? -1
                    : a.userTime < b.userTime
                    ? 1
                    : a.statusTime > b.statusTime
                    ? -1
                    : a.statusTime < b.statusTime
                    ? 1
                    : a.playerName.toLowerCase().localeCompare(b.playerName.toLowerCase());
            })[0]
            : null;
    }

    _onEvent(actor, event) {
        let eventType = event.type();
        if (eventType === Clutter.EventType.BUTTON_PRESS) {
            let button = event.get_button();
            if (button === 2 || button === 3) {
                let player = this._getLastActivePlayer();
                if (player) {
                    if (button === 2 && player.playPauseStop()) {
                        return Clutter.EVENT_STOP;
                    }
                    else if (button === 3) {
                        let playerWasFocused = player.focused;
                        if (player.toggleWindow(true)) {
                            if (!playerWasFocused) {
                                this.menu.close(true);
                            }
                            return Clutter.EVENT_STOP;
                        }
                    }
                }
            }
        } else if (eventType === Clutter.EventType.SCROLL) {
            let scrollDirection = event.get_scroll_direction();
            if (scrollDirection === Clutter.ScrollDirection.UP ||
                scrollDirection === Clutter.ScrollDirection.DOWN) {
                let player = this._getLastActivePlayer();
                if (player) {
                    if (scrollDirection === Clutter.ScrollDirection.UP && player.previous()) {
                        return Clutter.EVENT_STOP;
                    } else if (scrollDirection === Clutter.ScrollDirection.DOWN && player.next()) {
                        return Clutter.EVENT_STOP;
                    }
                }
            }
        }
        super._onEvent(actor, event);
    }
});
