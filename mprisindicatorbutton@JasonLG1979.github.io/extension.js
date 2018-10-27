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
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const Atk = imports.gi.Atk;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
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

// Things get a little weird when there are more
// than one instance of a player running at the same time.
// As far as ShellApp is concerned they are the same app.
// So we have to jump though a bunch of hoops to keep track
// of and differentiate the instance windows by pid or
// gtk_unique_bus_name/nameOwner.
var AppFocusWrapper = GObject.registerClass({
    GTypeName: "AppFocusWrapper",
    Properties: {
        "focused": GObject.ParamSpec.boolean(
            "focused",
            "focused-prop",
            "If the instance of the app is focused",
            GObject.ParamFlags.READABLE,
            false
        )
    }
}, class AppFocusWrapper extends GObject.Object {
    _init(shellApp, pid, nameOwner) {
        super._init();
        this._app = shellApp;
        this._pid = pid;
        this._nameOwner = nameOwner;
        this._focused = false;
        this._user_time = 0;
        this._window = null;
        this._appearsFocusedId = null;
        this._unmanagedId = null;
        this._windowsChangedId = this._app.connect(
            "windows-changed", 
            this._onWindowsChanged.bind(this)
        );
        this._onWindowsChanged(); 
    }

    get focused() {
        return this._focused;
    }

    get user_time() {
        return this._user_time;
    }

    getGicon() {
        // Much prefer a Gio.FileIcon or Gio.ThemedIcon to the St.Icon
        // you'd get from Shell.App.create_icon_texture().
        // This also doesn't fail silently and return the wrong icon...
        let app_info = this._app.get_app_info();
        if (app_info) {
            return app_info.get_icon() || null;
        }
        return null;
    }

    toggleWindow(minimize) {
        if (!this._focused) {
            if (this._window) {
                // Go ahead and skip the whole "Player is Ready"
                // dialog, after all the user wants the player focused,
                // that's why they clicked on it...  
                Main.activateWindow(this._window);
            } else {
                this._app.activate();
            }
            return true;
        } else if (minimize && this._window && this._window.can_minimize()) {
            this._window.minimize();
            return true;
        }
        return false;
    }

    destroy() {
        // Nothing to see here, move along...
        if (this._windowsChangedId) {
            this._app.disconnect(this._windowsChangedId);
        }
        this._onUnmanaged()
        this._windowsChangedId = null;
        this._app = null;
        this._pid = null;
        this._focused = null;
        this._user_time = null;
        super.run_dispose();
    }

    _getNormalAppWindows() {
        // We don't want dialogs or what not...
        return Array.from(this._app.get_windows()).filter(w =>
            !w.skip_taskbar && w.window_type === Meta.WindowType.NORMAL
        );
    }

    _getNewAppWindow() {
        // Try to get a hold of an actual window...
        let windows = this._getNormalAppWindows();
        if (windows.length) {
            // Check for multiple instances and flatpak'd apps. (may also work for snaps?)
            for (let w of windows) {
                if (w.get_pid() === this._pid || w.gtk_unique_bus_name === this._nameOwner) {
                    return w;
                }
            }
            // If all else fails
            // return the 1st window
            // for single instance
            // apps it will be the
            // apps main window.
            return windows[0];
        }
        return null;
    }

    _grabAppWindow(appWindow) {
        // Connect our window signals
        // and check the new window's focus.
        if (appWindow) {
            this._onUnmanaged();
            this._window = appWindow;
            this._appearsFocusedId = this._window.connect(
               "notify::appears-focused",
                this._onAppearsFocused.bind(this)
            );
            this._unmanagedId = this._window.connect(
                "unmanaged",
            this._onUnmanaged.bind(this)
            );
            this._onAppearsFocused();
        }
    }

    _onWindowsChanged() {
        // We get this signal when window show up
        // Really only useful when a player "unhides"
        // or at _init
        let appWindow = this._getNewAppWindow();
        if (this._window !== appWindow) {
            this._grabAppWindow(appWindow);
        }
    }

    _onAppearsFocused() {
        // Pretty self explanatory...
        let focused = this._window && this._window.has_focus();
        if (this._focused != focused) {
            this._user_time = this._window.user_time;
            this._focused = focused;
            this.notify("focused");
        }
    }

    _onUnmanaged() {
        // "unmanaged" windows are either hidden and/or
        // will soon be destroyed. Disconnect from them
        // and null the window.
        if (this._window) {
            if (this._appearsFocusedId) {
                this._window.disconnect(this._appearsFocusedId);
            }
            if (this._unmanagedId) {
                this._window.disconnect(this._unmanagedId);
            }
        }
        this._window = null;
        this._appearsFocusedId = null;
        this._unmanagedId = null;
    }
});

class Player extends PopupMenu.PopupBaseMenuItem {
    constructor(busName, pid, nameOwner, statusCallback, destructCallback) {
        super();
        this._focusWrapper = null;
        this._signals = [];
        this._fallbackIconName = null;
        this._fallbackGicon = null;
        this._busName = busName;

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

        this._coverIcon = new Widgets.CoverIcon();

        hbox.add(this._coverIcon);

        let info = new St.BoxLayout({
            style: "padding-left: 12px",
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            vertical: true,
            x_expand: true
        });

        hbox.add(info);

        this._trackArtist = new Widgets.TrackLabel(204, 255);

        info.add(this._trackArtist);

        this._trackTitle = new Widgets.TrackLabel(152, 204);

        info.add(this._trackTitle);

        this._pushSignal(this.actor, "notify::hover", (actor) => {
            let hover = actor.hover;
            this._coverIcon.onParentHover(hover);
            this._trackArtist.onParentHover(hover);
            this._trackTitle.onParentHover(hover);
        });

        let playerButtonBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            x_expand: true
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

        playerButtonBox.add(this._stopButton);

        this._nextButton = new Widgets.MediaControlButton(
            "media-skip-forward-symbolic"
        );

        playerButtonBox.add(this._nextButton);

        this._pushSignal(this, "update-player-status", statusCallback);
        this._pushSignal(this, "self-destruct", destructCallback);

        this._mpris = new DBus.MprisProxyHandler(
            this._busName,
            (success) => {
                if (success) {
                    this.actor.accessible_name = this._mpris.player_name;
                    let desktopId = this._mpris.desktop_entry + ".desktop";
                    let identity = this._mpris.player_name;
                    let appSystem = Shell.AppSystem.get_default();
                    let shellApp = appSystem.lookup_app(desktopId) ||
                        appSystem.lookup_startup_wmclass(identity);
                    if (!shellApp) {
                        // Last resort... Needed for at least the Spotify snap.
                        let lcIdentity = identity.toLowerCase();
                        for (let app of appSystem.get_running()) {
                            if (lcIdentity === app.get_name().toLowerCase()) {
                                shellApp = app;
                                break;
                            }
                        }
                    }
                    if (shellApp) {
                        this._focusWrapper = new AppFocusWrapper(
                            shellApp,
                            parseInt(pid, 10),
                            nameOwner
                        );
                        this._fallbackGicon = this._focusWrapper.getGicon();
                        this._coverIcon.setFallbackGicon(this._fallbackGicon);
                        this._pushSignal(this._focusWrapper, "notify::focused", () => {
                            this.emit("update-player-status");
                        });               
                    }
                    this._fallbackIconName = this._getPlayerIconName();
                    this._coverIcon.setFallbackName(this._fallbackIconName);
                    this._coverIcon.setCover();
                } else {
                    this.emit("self-destruct");
                }
            }
        );

        let bindingFlags = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;

        this._mpris.bind_property(
            "show-stop",
            this._stopButton,
            "visible",
            bindingFlags 
        );

        this._mpris.bind_property(
            "prev-reactive",
            this._prevButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "playpause-reactive",
            this._playPauseButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "playpause-icon-name",
            this._playPauseButton.child,
            "icon-name",
            bindingFlags 
        );

        this._mpris.bind_property(
            "next-reactive",
            this._nextButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "artist",
            this._trackArtist,
            "text",
            bindingFlags 
        );

        this._mpris.bind_property(
            "title",
            this._trackTitle,
            "text",
            bindingFlags 
        );

        this._pushSignal(this._mpris, "notify::cover-url", () => {
            this._coverIcon.setCover(this._mpris.cover_url);
        });

        this._pushSignal(this._mpris, "notify::playback-status", () => {
            this.emit("update-player-status");
        });

        this._pushSignal(this, "activate", () => {
            this.toggleWindow();
        });

        this._pushSignal(this._prevButton, "clicked", () => {
            this._mpris.previous();
        });

        this._pushSignal(this._playPauseButton, "clicked", () => {
            this._mpris.playPause();
        });

        this._pushSignal(this._stopButton, "clicked", () => {
            this._mpris.stop();
        });

        this._pushSignal(this._nextButton, "clicked", () => {
            this._mpris.next();
        });
    }

    get userTime() {
        if (this._focusWrapper) {
            return this._focusWrapper.user_time;
        } else {
            return 0;
        }
    }

    get statusTime() {
        if (this._mpris) {
            return this._mpris.status_time;
        }
        return 0;
    }

    get statusValue() {
        if (this._mpris) {
            return this._mpris.playback_status;
        }
        return 0;
    }

    get fallbackIconName() {
        return this._fallbackIconName;
    }

    get fallbackGicon() {
        return this._fallbackGicon;
    }

    get focused() {
        if (this._focusWrapper) {
            return this._focusWrapper.focused;
        }
        return false;
    }

    get busName() {
        return this._busName;
    }

    playPauseStop() {
        return this._mpris.playPauseStop();        
    }

    previous() {
        return this._mpris.previous();
    }

    next() {
        return this._mpris.next();
    }

    toggleWindow(minimize) {
        if (this._focusWrapper) {
            return this._focusWrapper.toggleWindow(minimize);
        } else {
            return this._mpris.raise();
        }
    }

    onThemeChanged() {
        if (this._focusWrapper) {
            this._fallbackGicon = this._focusWrapper.getGicon();
            this._coverIcon.setFallbackGicon(this._fallbackGicon);
        }
        this._fallbackIconName = this._getPlayerIconName();
        this._coverIcon.setFallbackName(this._fallbackIconName);
        if (!this._mpris.cover_url) {
            this._coverIcon.setCover();
        }
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }
        if (this._focusWrapper) {
            this._focusWrapper.destroy();
        }
        if (this._mpris) {
            this._mpris.destroy();
        }
        this._focusWrapper = null;
        this._signals = null;
        this._fallbackIconName = null;
        this._fallbackGicon = null;
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

    _getPlayerIconName() {
        // Prefer symbolic icons.
        // The default Spotify icon name is spotify-client,
        // but the desktop entry is spotify.
        // Icon names *should* match the desktop entry...
        // Who knows if a 3rd party icon theme wil use spotify
        // or spotify-client as their spotify icon's name and
        // what they'll name their Spotify symbolic icon if
        // they have one at all?
        let desktopEntry = this._mpris.desktop_entry;
        if (desktopEntry) {
            let iconNames = [];
            if (desktopEntry.toLowerCase() === "spotify") {
                iconNames = [
                    desktopEntry + "-symbolic",
                    desktopEntry + "-client-symbolic",
                    desktopEntry,
                    desktopEntry + "-client"
                ];
            } else {
                iconNames = [
                    desktopEntry + "-symbolic",
                    desktopEntry
                ];
            }
            let currentIconTheme = Gtk.IconTheme.get_default();
            for (let iconName of iconNames) {
                if (currentIconTheme.has_icon(iconName)) {
                    return iconName;
                }
            }
        }
        return null;
    }

    _onKeyPressEvent(actor, event) {
        let state = event.get_state();

        if (state === Clutter.ModifierType.CONTROL_MASK) {
            let symbol = event.get_key_symbol();           
            if (symbol === Clutter.KEY_space && this.playPauseStop()) {
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Left && this.previous()) {
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.Right && this.next()) {
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
        this._signals = [];

        this.actor.hide();

        this.setMenu(new Widgets.ScrollablePopupMenu(this.actor));

        this._indicatorIcon = new St.Icon({
            accessible_role: Atk.Role.ICON,
            style_class: "system-status-icon"
        });

        this.actor.add_child(this._indicatorIcon);

        let themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._pushSignal(themeContext, "changed", () => {
            if (!this.menu.isEmpty()) {
                this.menu._getMenuItems().forEach(player => player.onThemeChanged());
                this._setIndicatorIcon();
            }
        });

        this._pushSignal(this.actor, "key-press-event", this._onKeyPressEvent.bind(this));

        this._proxyHandler = new DBus.DBusProxyHandler();
        this._pushSignal(this._proxyHandler, "add-player", this._addPlayer.bind(this));
        this._pushSignal(this._proxyHandler, "remove-player", this._removePlayer.bind(this));
        this._pushSignal(this._proxyHandler, "change-player-owner", this._changePlayerOwner.bind(this));
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }

        this._proxyHandler.destroy();
        this._proxyHandler = null;
        this._signals = null;

        super.destroy();
    }

    _pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    _onUpdatePlayerStatus() {
        this._setIndicatorIcon();
        this.actor.show();
    }

    _onPlayerSelfDestruct(player) {
        this._removePlayer(this._proxyHandler, player.busName);
    }

    _addPlayer(proxyHandler, busNamePid) {
        let [busName, nameOwner, pid] = busNamePid.split(" ");
        this.menu.addMenuItem(
            new Player(
                busName,
                pid,
                nameOwner,
                this._onUpdatePlayerStatus.bind(this),
                this._onPlayerSelfDestruct.bind(this)
            )
        );
    }

    _removePlayer(proxyHandler, busName) {
        this._destroyPlayer(busName);

        if (this.menu.isEmpty()) {
            this.actor.hide();
            this._indicatorIcon.icon_name = null;
            this._indicatorIcon.gicon = null;
        } else {
            this._setIndicatorIcon();
        }
    }

    _changePlayerOwner(proxyHandler, busNamePid) {
        let [busName, nameOwner, pid] = busNamePid.split(" ");
        this._destroyPlayer(busName);
        this._addPlayer(proxyHandler, busNamePid);
    }

    _destroyPlayer(busName) {
        for (let player of this.menu._getMenuItems()) {
            if (player.busName === busName) {
                player.destroy();
                break;
            }
        }
    }

    _getLastActivePlayer() {
        if (!this.menu.isEmpty()) {
            return this.menu._getMenuItems().sort((a, b) => {
                if (a.focused) {
                    return -1;
                } else if (b.focused) {
                    return 1;
                } else if (a.statusValue > b.statusValue) {
                    return -1;
                } else if (a.statusValue < b.statusValue) {
                    return 1;
                } else if (a.userTime > b.userTime) {
                    return -1;
                } else if (a.userTime < b.userTime) {
                    return 1;
                } else if (a.statusTime > b.statusTime) {
                    return -1;
                } else if (a.statusTime < b.statusTime) {
                    return 1;
                } else {
                    return 0;
                }
            })[0];
        }
        return null;
    }

    _setIndicatorIcon() {
        let player = this._getLastActivePlayer();
        if (player) {
            let playerIconName = player.fallbackIconName;
            if (playerIconName) {
                this._indicatorIcon.icon_name = playerIconName;
            } else {
                let gicon = player.fallbackGicon;
                if (gicon) {
                    this._indicatorIcon.gicon = gicon;
                } else {
                    this._indicatorIcon.icon_name = "audio-x-generic-symbolic";
                }
            }
        }
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
            // Scroll events don't currently have a *default* GNOME Shell action
            // like button press events, but we may as well not override scroll events
            // if they aren't going to do anything for us.
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

    _onKeyPressEvent(actor, event) {
        let state = event.get_state();

        if (state === Clutter.ModifierType.CONTROL_MASK) {
            let player = this._getLastActivePlayer();
            if (player) {
                let symbol = event.get_key_symbol();           
                if (symbol === Clutter.KEY_space && player.playPauseStop()) {
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.Left && player.previous()) {
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.Right && player.next()) {
                    return Clutter.EVENT_STOP;
                }
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }
}
