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
const Config = imports.misc.config;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Panel = imports.ui.panel;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const DBus = Me.imports.dbus;
const Widgets = Me.imports.widgets;

const MINOR_VERSION = parseInt(Config.PACKAGE_VERSION.split(".")[1]);

var indicator = null;
var stockMpris = null;
var shouldShow = null;

function enable() {
    stockMpris = Main.panel.statusArea.dateMenu._messageList._mediaSection;
    shouldShow = stockMpris._shouldShow;
    if (stockMpris && shouldShow) {
        stockMpris.actor.hide();
        stockMpris._shouldShow = () => false;
    }
    indicator = Main.panel.addToStatusArea("mprisindicatorbutton",
        new MprisIndicatorButton(), 0, "right");
}

function disable() {
    if (indicator) {
        indicator.destroy();
    }

    if (stockMpris && shouldShow) {
        stockMpris._shouldShow = shouldShow;
        if (stockMpris._shouldShow()) {
            stockMpris.actor.show();
        }
    }

    indicator = null;
    stockMpris = null;
    shouldShow = null;
}

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
        this._onUnmanaged()
        this._metaWindowsChangedId = null;
        this._app = null;
        this._pid = null;
        this._focused = null;
        this._user_time = null;
        super.run_dispose();
    }

    _getNumbersFromTheEndOf(someString) {
        let matches = someString.match(/[0-9]+$/);
        if (matches) {
            return parseInt(matches[0], 10);
        }
        return null;
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
        if (metaWindows.length) {
            // Check for multiple instances.
            for (let w of metaWindows) {
                if (this._instanceNum && w.gtk_window_object_path) {
                    // Match multiple instance(multiple window really) GApplications to their windows.
                    // Works rather well if a GApplication's MPRIS instance number matches
                    // it's corresponding window object path like the latest git master of GNOME-MPV.
                    // For example org.mpris.MediaPlayer2.GnomeMpv.instance-1 = /io/github/GnomeMpv/window/1. 
                    let windowNum = this._getNumbersFromTheEndOf(w.gtk_window_object_path);
                    if (this._instanceNum === windowNum) {
                        return w;
                    }
                } else if (w.gtk_unique_bus_name) {
                    // This will match single instance GApplications to their window.
                    // Generally the window and MPRIS interface will have the
                    // same name owner.
                    if (w.gtk_unique_bus_name === this._nameOwner) {
                        return w;
                    }
                // Match true multiple instances players by their pids.
                // works rather well for apps like VLC for example.
                } else if (w.get_pid() === this._pid) {
                    return w;
                }
            }
            // If all else fails
            // return the 1st window
            // for single instance
            // apps it will be the
            // app's main window.
            return metaWindows[0];
        }
        return null;
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
        if (this._metaWindow !== appMetaWindow) {
            this._grabAppMetaWindow(appMetaWindow);
        }
    }

    _onAppearsFocused() {
        // Pretty self explanatory...
        let focused = this._metaWindow && this._metaWindow.has_focus();
        if (this._focused != focused) {
            this._user_time = this._metaWindow.user_time;
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

class Player extends PopupMenu.PopupBaseMenuItem {
    constructor(busName, pid, statusCallback, destructCallback) {
        super();
        this._appWrapper = null;
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

        let trackArtist = new Widgets.TrackLabel(204, 255);

        info.add(trackArtist);

        let trackTitle = new Widgets.TrackLabel(152, 204);

        info.add(trackTitle);

        this._pushSignal(this.actor, "notify::hover", (actor) => {
            let hover = actor.hover;
            this._coverIcon.onParentHover(hover);
            trackArtist.onParentHover(hover);
            trackTitle.onParentHover(hover);
        });

        let playerButtonBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            x_expand: true
        });

        vbox.add(playerButtonBox);

        let prevButton = new Widgets.MediaControlButton(
            "media-skip-backward-symbolic"
        );

        playerButtonBox.add(prevButton);

        let playPauseButton = new Widgets.MediaControlButton(
            "media-playback-start-symbolic"
        );

        playerButtonBox.add(playPauseButton);

        let stopButton = new Widgets.MediaControlButton(
            "media-playback-stop-symbolic"
        );

        playerButtonBox.add(stopButton);

        let nextButton = new Widgets.MediaControlButton(
            "media-skip-forward-symbolic"
        );

        playerButtonBox.add(nextButton);

        this._mpris = new DBus.MprisProxyHandler(this._busName);

        this._pushSignal(this._mpris, "self-destruct", () => {
            destructCallback(this);
        });

        let bindingFlags = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;

        this._mpris.bind_property(
            "show-stop",
            stopButton,
            "visible",
            bindingFlags 
        );

        this._mpris.bind_property(
            "prev-reactive",
            prevButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "playpause-reactive",
            playPauseButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "playpause-icon-name",
            playPauseButton.child,
            "icon-name",
            bindingFlags 
        );

        this._mpris.bind_property(
            "next-reactive",
            nextButton,
            "reactive",
            bindingFlags 
        );

        this._mpris.bind_property(
            "artist",
            trackArtist,
            "text",
            bindingFlags 
        );

        this._mpris.bind_property(
            "title",
            trackTitle,
            "text",
            bindingFlags 
        );

        this._pushSignal(this._mpris, "notify::desktop-entry", () => {
            if (this._mpris.player_name && this._mpris.desktop_entry) {
                // Go to absurd lengths to try to find the shellApp.
                // For normal apps appSystem.lookup_app(desktopId)
                // should work just fine, but for flatpaks or snaps
                // it may very well not be enough, especially if the
                // DesktopEntry MPRIS prop doesn't match the actual
                // .desktop file *AS IT SHOULD*.
                this.actor.accessible_name = this._mpris.player_name;
                let desktopId = this._mpris.desktop_entry + ".desktop";
                let identity = this._mpris.player_name;
                let appSystem = Shell.AppSystem.get_default();
                let shellApp = appSystem.lookup_app(desktopId) ||
                    appSystem.lookup_startup_wmclass(identity);
                if (!shellApp) {
                    let lcIdentity = identity.toLowerCase();
                    for (let app of appSystem.get_running()) {
                        if (lcIdentity === app.get_name().toLowerCase()) {
                            shellApp = app;
                            break;
                        }
                    }
                    if (!shellApp) {
                        for (let desktopId of Shell.AppSystem.search(this._mpris.desktop_entry)) {
                            let app = appSystem.lookup_app(desktopId[0]);
                            if (app && lcIdentity === app.get_name().toLowerCase()) {
                                shellApp = app;
                                break;
                            }
                        }
                    }
                }
                if (shellApp) {
                    this._appWrapper = new AppWrapper(
                        shellApp,
                        busName,
                        pid,
                        this._mpris.name_owner
                    );
                    this._fallbackGicon = this._appWrapper.getGicon();
                    this._coverIcon.setFallbackGicon(this._fallbackGicon);
                    this._pushSignal(this._appWrapper, "notify::focused", statusCallback);               
                }
                this._mimetypeIconName = this._mpris.mimetype_icon_name;
                this._coverIcon.setMimetypeIconName(this._mimetypeIconName);
                this._fallbackIconName = this._getPlayerIconName(this._mpris.desktop_entry);
                this._coverIcon.setFallbackName(this._fallbackIconName);
                this._coverIcon.setCover();
            } 
        });

        this._pushSignal(this._mpris, "notify::cover-url", () => {
            this._coverIcon.setCover(this._mpris.cover_url);
        });

        this._pushSignal(this._mpris, "notify::mimetype-icon-name", () => {
            this._mimetypeIconName = this._mpris.mimetype_icon_name;
            this._coverIcon.setMimetypeIconName(this._mimetypeIconName);
            if (!this._mpris.cover_url) {
                this._coverIcon.setCover();
            }
            statusCallback();
        });

        this._pushSignal(this._mpris, "notify::playback-status", statusCallback);

        let accessible_nameCallback;

        if (MINOR_VERSION >= 30) {
            // The screen reader in GNOME Shell 3.28 reads this.actor.accessible_name, trackArtist
            // and trackTitle aloud. 3.30 only reads this.actor.accessible_name. Not sure which is
            // the intended behaviour but hopefully this will make things consistent between the 2? 
            accessible_nameCallback = () => {
                // The ";" is to try to make the screen reader read the info a little more naturally.
                // Otherwise they run into eachother.
                let acc = "";
                // artist could very well have fallen back to the player name, if so don't
                // have the screen reader repeat itself.
                if (this._mpris.artist === this._mpris.player_name) {
                    acc = [this._mpris.player_name, this._mpris.title].join("; ");
                } else {
                    acc = this._mpris.player_name + "; " + [this._mpris.artist, this._mpris.title].join(" ");
                }
                this.actor.accessible_name = acc;
            }
        } else {
            accessible_nameCallback = () => {
                // artist could very well have fallen back to the player name, if so don't
                // have the screen reader repeat itself.
                if (this._mpris.artist === this._mpris.player_name) {
                    this.actor.accessible_name = "";
                } else if (this.actor.accessible_name !== this._mpris.player_name) {
                    this.actor.accessible_name = this._mpris.player_name;
                }
            }
        }

        if (MINOR_VERSION >= 30) {
            this._pushSignal(this._mpris, "notify::title", accessible_nameCallback);
        }
        this._pushSignal(this._mpris, "notify::artist", accessible_nameCallback);

        this._pushSignal(this, "activate", () => {
            this.toggleWindow();
        });

        this._pushSignal(prevButton, "clicked", this._mpris.previous.bind(this._mpris));

        this._pushSignal(playPauseButton, "clicked", this._mpris.playPause.bind(this._mpris));

        this._pushSignal(stopButton, "clicked", this._mpris.stop.bind(this._mpris));

        this._pushSignal(nextButton, "clicked", this._mpris.next.bind(this._mpris));
    }

    get userTime() {
        if (this._appWrapper) {
            return this._appWrapper.user_time;
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

    get mimetypeIconName() {
        return this._mimetypeIconName;
    }

    get fallbackGicon() {
        return this._fallbackGicon;
    }

    get focused() {
        if (this._appWrapper) {
            return this._appWrapper.focused;
        }
        return false;
    }

    get busName() {
        return this._busName || "";
    }

    playPauseStop() {
        if (this._mpris) {
            return this._mpris.playPauseStop();
        }
        return false;        
    }

    previous() {
        if (this._mpris) {
            return this._mpris.previous();
        }
        return false;
    }

    next() {
        if (this._mpris) {
            return this._mpris.next();
        }
        return false;
    }

    toggleWindow(minimize) {
        if (this._appWrapper) {
            return this._appWrapper.toggleWindow(minimize);
        } else if (this._mpris) {
            return this._mpris.raise();
        }
        return false;
    }

    onThemeChanged() {
        if (this._appWrapper && this._coverIcon) {
            this._fallbackGicon = this._appWrapper.getGicon();
            this._coverIcon.setFallbackGicon(this._fallbackGicon);
        }
        if (this._mpris && this._coverIcon) {
            this._fallbackIconName = this._getPlayerIconName(this._mpris.desktop_entry);
            this._coverIcon.setFallbackName(this._fallbackIconName);
            if (!this._mpris.cover_url) {
                this._coverIcon.setCover();
            }
        }
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        }
        if (this._appWrapper) {
            this._appWrapper.destroy();
        }
        this._mpris.destroy();
        this._coverIcon.destroy();
        this._signals = null;
        this._appWrapper = null;
        this._coverIcon = null;
        this._mpris = null;
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

    _getPlayerIconName(desktopEntry) {
        // Prefer symbolic icons.
        // The default Spotify icon name is spotify-client,
        // but the desktop entry is spotify.
        // Icon names *should* match the desktop entry...
        // Who knows if a 3rd party icon theme wil use spotify
        // or spotify-client as their spotify icon's name and
        // what they'll name their Spotify symbolic icon if
        // they have one at all?
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

// A slight modified version of ScrollablePopupMenu from:
// https://github.com/petres/gnome-shell-extension-extensions
// Used in case of the unlikely event that a user would have so many
// players open at once that the menu would overflow the screen. 
class ScrollablePopupMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor) {
        super(sourceActor, St.Align.START, St.Side.TOP);
        PopupMenu.PopupMenuBase.prototype._init.call(this, sourceActor, "popup-menu-content");

        this.actor.add_style_class_name("aggregate-menu");
        this.box.set_layout_manager(new Panel.AggregateLayout());

        let scrollView = new St.ScrollView({
            overlay_scrollbars: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
        });

        scrollView.add_actor(this.box);

        this._boxPointer.bin.set_child(scrollView);
    }
}

class MprisIndicatorButton extends PanelMenu.Button {
    constructor() {
        super(0.0, "Mpris Indicator Button", false);
        this.actor.accessible_name = "Mpris";
        this._signals = [];

        this.actor.hide();

        this.setMenu(new ScrollablePopupMenu(this.actor));

        this._indicatorIcon = new St.Icon({
            accessible_role: Atk.Role.ICON,
            style_class: "system-status-icon"
        });

        this.actor.add_child(this._indicatorIcon);

        this._pushSignal(St.ThemeContext.get_for_stage(global.stage), "changed", () => {
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
        this._indicatorIcon.icon_name = null;
        this._indicatorIcon.gicon = null;
        this._indicatorIcon.destroy();
        this._indicatorIcon = null;        
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

    _addPlayer(proxyHandler, busName, pid) {
        this.menu.addMenuItem(
            new Player(
                busName,
                pid,
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

    _changePlayerOwner(proxyHandler, busName, pid) {
        this._destroyPlayer(busName);
        this._addPlayer(proxyHandler, busName, pid);
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
    // The Indicator Icon has crazy fallback redundancy.
    // The order is as follows:
    // 1. The current player's symbolic icon
    // 2. The current player's full color icon
    // 3. A symbolic icon loosely representing
    //    the current player's current track's media type.
    //    (audio, video or stream)
    // 4. If all else fails the audio mimetype symbolic icon.
        let player = this._getLastActivePlayer();
        if (player) {
            if (player.fallbackIconName) {
                this._indicatorIcon.icon_name = player.fallbackIconName;
            } else if (player.fallbackGicon) {
                this._indicatorIcon.gicon = player.fallbackGicon;
            } else if (player.mimetypeIconName) {
                this._indicatorIcon.icon_name = player.mimetypeIconName;
            } else {
                this._indicatorIcon.icon_name = "audio-x-generic-symbolic";
            }
        } else {
            this._indicatorIcon.icon_name = null;
            this._indicatorIcon.gicon = null;
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
