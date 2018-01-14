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
 */

const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Panel = imports.ui.panel;

const DBusIface = '<node> \
<interface name="org.freedesktop.DBus"> \
  <method name="ListNames"> \
    <arg type="as" direction="out" name="names" /> \
  </method> \
  <signal name="NameOwnerChanged"> \
    <arg type="s" direction="out" name="name" /> \
    <arg type="s" direction="out" name="oldOwner" /> \
    <arg type="s" direction="out" name="newOwner" /> \
  </signal> \
</interface> \
</node>';
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

const MprisIface = '<node> \
<interface name="org.mpris.MediaPlayer2"> \
  <method name="Raise" /> \
  <property name="CanRaise" type="b" access="read" /> \
  <property name="Identity" type="s" access="read" />\
  <property name="DesktopEntry" type="s" access="read" /> \
</interface> \
</node>';
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);

const MprisPlayerIface = '<node> \
<interface name="org.mpris.MediaPlayer2.Player"> \
  <method name="PlayPause" /> \
  <method name="Next" /> \
  <method name="Previous" /> \
  <method name="Stop" /> \
  <method name="Play" /> \
  <property name="CanGoNext" type="b" access="read" /> \
  <property name="CanGoPrevious" type="b" access="read" /> \
  <property name="CanPlay" type="b" access="read" /> \
  <property name="CanPause" type="b" access="read" /> \
  <property name="Metadata" type="a{sv}" access="read" /> \
  <property name="PlaybackStatus" type="s" access="read" /> \
</interface> \
</node>';
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);

const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

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

class Player extends PopupMenu.PopupBaseMenuItem {
    constructor(busName) {
        super();
        this._cancellable = null;
        this._playerProxy = null;
        this._mprisProxy = null;
        this._fallbackIconName = null;
        this._themeContext = null;
        this._propsChangedId = 0;
        this._themeChangeId = 0;
        this.busName = busName;

        let vbox = new St.BoxLayout({
            vertical: true
        });

        this.actor.add(vbox, {
            expand: true
        });

        let hbox = new St.BoxLayout({
            style_class: "popup-menu-item no-padding"
        });

        vbox.add(hbox, {
            expand: true
        });

        this._coverIcon = new St.Icon({
            icon_size: 48
        });

        hbox.add(this._coverIcon);

        let info = new St.BoxLayout({
            vertical: true
        });

        this._trackArtist = new St.Label({
            style_class: "track-artist"
        });

        this._trackTitle = new St.Label({
            style_class: "track-title"
        });

        this._trackAlbum = new St.Label({
            style_class: "track-album"
        });

        info.add(this._trackArtist, {
            expand: true,
            x_align: St.Align.START
        });

        info.add(this._trackTitle, {
            expand: true,
            x_align: St.Align.START
        });

        info.add(this._trackAlbum, {
            expand: true,
            x_align: St.Align.START
        });

        hbox.add(info, {
            expand: true
        });

        let playerButtonBox = new St.BoxLayout();

        let icon;

        icon = new St.Icon({
            icon_name: "media-skip-backward-symbolic",
            icon_size: 16
        });

        this._prevButton = new St.Button({
            style_class: "message-media-control",
            child: icon
        });

        playerButtonBox.add(this._prevButton);

        icon = new St.Icon({
            icon_name: "media-playback-start-symbolic",
            icon_size: 16
        });

        this._playPauseButton = new St.Button({
            style_class: "message-media-control",
            child: icon
        });

        playerButtonBox.add(this._playPauseButton);

        icon = new St.Icon({
            icon_name: "media-playback-stop-symbolic",
            icon_size: 16
        });

        this._stopButton = new St.Button({
            style_class: "message-media-control",
            child: icon
        });

        this._stopButton.hide();

        playerButtonBox.add(this._stopButton);

        icon = new St.Icon({
            icon_name: "media-skip-forward-symbolic",
            icon_size: 16
        });

        this._nextButton = new St.Button({
            style_class: "message-media-control",
            child: icon
        });

        playerButtonBox.add(this._nextButton);

        vbox.add(playerButtonBox, {
            expand: true,
            x_fill: false,
            x_align: St.Align.MIDDLE
        });

        new MprisProxy(Gio.DBus.session, busName,
            "/org/mpris/MediaPlayer2",
            this._onMprisProxy.bind(this));
    }

    destroy() {
        if (this._propsChangedId) {
            this._playerProxy.disconnect(this._propsChangedId);
            this._propsChangedId = 0;
        }

        if (this._themeChangeId) {
            this._themeContext.disconnect(this._themeChangeId);
            this._themeChangeId = 0;
        }

        if (this._cancellable && !this._cancellable.is_cancelled()) {
            this._cancellable.cancel();
        }

        super.destroy();
    }

    _setCoverIcon(icon, coverUrl) {
        // Asynchronously set the cover icon.
        // Much more fault tolerant than:
        //
        // let file = Gio.File.new_for_uri(coverUrl);
        // icon.gicon = new Gio.FileIcon({ file: file });
        //
        // Which silently fails on error and can lead to the wrong cover being shown.
        // On error this will fallback gracefully to this._fallbackIconName. 
        if (this._cancellable && !this._cancellable.is_cancelled()) {
            this._cancellable.cancel();
        }

        this._cancellable = new Gio.Cancellable();

        if (coverUrl) {
            let file = Gio.File.new_for_uri(coverUrl);
            file.load_contents_async(this._cancellable, (source, result) => {
                try {
                    let bytes = source.load_contents_finish(result)[1];
                    let newIcon = Gio.BytesIcon.new(bytes);
                    if (!newIcon.equal(icon.gicon)) {
                        icon.gicon = newIcon;
                    }
                }
                catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        icon.icon_name = this._fallbackIconName;
                    }
                }
                this._cancellable = null;
            });
        }
        else {
            icon.icon_name = this._fallbackIconName;
        }
    }

    _getFallbackIconName(desktopEntry) {
        // The Player's symbolic Icon name *should* be it's
        // Desktop Entry + '-symbolic'.
        // For example, Pithos:
        // Desktop Entry - 'io.github.Pithos'
        // Symbolic Icon Name - 'io.github.Pithos-symbolic'
        if (desktopEntry) {
            let possibleIconName = desktopEntry + '-symbolic';
            let currentIconTheme = Gtk.IconTheme.get_default();
            let IconExists = currentIconTheme.has_icon(possibleIconName);
            if (IconExists) {
                return possibleIconName;
            }
        }
        return "audio-x-generic-symbolic";
    }

    _update() {
        let artist, playPauseIconName, playPauseReactive;
        let metadata = this._playerProxy.Metadata;
        let isStopped = this._playerProxy.PlaybackStatus == "Stopped";

        if (!metadata || isStopped || Object.keys(metadata).length < 2) {
            metadata = {};
        }

        artist = metadata["xesam:artist"] ? metadata["xesam:artist"].deep_unpack().join(' / ') : "";
        artist = metadata["rhythmbox:streamTitle"] ? metadata["rhythmbox:streamTitle"].unpack() : artist;
        artist = artist || this._mprisProxy.Identity;

        this._trackArtist.text = artist;

        this._trackTitle.text = metadata["xesam:title"] ? metadata["xesam:title"].unpack() : "";

        this._trackAlbum.text = metadata["xesam:album"] ? metadata["xesam:album"].unpack() : "";

        this._setCoverIcon(this._coverIcon, metadata["mpris:artUrl"] ? metadata["mpris:artUrl"].unpack() : "");

        if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
            this._stopButton.hide();
            let isPlaying = this._playerProxy.PlaybackStatus == "Playing";
            playPauseIconName = isPlaying ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";
            playPauseReactive = true;
        } else {
            if (this._playerProxy.CanPlay) {
                this._stopButton.show();
            }
            playPauseIconName = "media-playback-start-symbolic";
            playPauseReactive = this._playerProxy.CanPlay;
        }

        this._prevButton.reactive = this._playerProxy.CanGoPrevious;

        this._playPauseButton.child.icon_name = playPauseIconName;

        this._playPauseButton.reactive = playPauseReactive;

        this._nextButton.reactive = this._playerProxy.CanGoNext;
    }

    _onMprisProxy(mprisProxy) {
        this._mprisProxy = mprisProxy;

        let app = null;

        if (this._mprisProxy.DesktopEntry) {
            let desktopId = this._mprisProxy.DesktopEntry + ".desktop";
            app = Shell.AppSystem.get_default().lookup_app(desktopId);
        }

        if (app) {
            this.connect("activate", () => {
                app.activate();
            });
        }
        else if (this._mprisProxy.CanRaise) {
            this.connect("activate", () => {
                this._mprisProxy.RaiseRemote();
            });
        }

        new MprisPlayerProxy(Gio.DBus.session, this.busName,
            "/org/mpris/MediaPlayer2",
            this._onPlayerProxyReady.bind(this));
    }

    _onPlayerProxyReady(playerProxy) {
        this._playerProxy = playerProxy;

        this._prevButton.connect("clicked", () => {
            this._playerProxy.PreviousRemote();
        });

        this._playPauseButton.connect("clicked", () => {
            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay) {
                this._playerProxy.PlayRemote();
            }
        });

        this._stopButton.connect("clicked", () => {
            this._playerProxy.StopRemote();
        });

        this._nextButton.connect("clicked", () => {
            this._playerProxy.NextRemote();
        });

        this._propsChangedId = this._playerProxy.connect("g-properties-changed",
            this._update.bind(this));

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._themeChangeId = this._themeContext.connect("changed", () => {
            this._fallbackIconName = this._getFallbackIconName(this._mprisProxy.DesktopEntry);
            this._update();
        });

        this._fallbackIconName = this._getFallbackIconName(this._mprisProxy.DesktopEntry);

        this._update();
    }
}

class MprisIndicatorButton extends PanelMenu.Button {
    constructor() {
        super(0.0, "Mpris Indicator Button", false);

        this._proxy = null;
        this._nameOwnerChangedId = 0;

        this.menu.actor.add_style_class_name("aggregate-menu");

        // menuLayout keeps the Indicator the same size as the
        // system menu (aggregate menu) and makes sure our text
        // ellipses correctly.
        let menuLayout = new Panel.AggregateLayout();

        this.menu.box.set_layout_manager(menuLayout);

        // It doesn't matter what this widget is.
        let dummySizeWidget = new St.BoxLayout();

        menuLayout.addSizeChild(dummySizeWidget);

        this._indicator = new St.BoxLayout();

        // Manually setting the width of the indicator
        // on hide and show should not be necessary.
        // But for some reason it is, otherwise a hidden
        // indicator still takes up space in the panel. 
        this._indicator.hide();
        this._indicator.set_width(0);

        this.actor.add_child(this._indicator);

        this.actor.hide();
        this.actor.set_width(0);

        let icon = new St.Icon({
            icon_name: "audio-x-generic-symbolic",
            style_class: "system-status-icon"
        });

        this._indicator.add_child(icon);

        new DBusProxy(Gio.DBus.session,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            this._onProxyReady.bind(this));
    }

    destroy() {
        if (this._nameOwnerChangedId) {
            this._proxy.disconnect(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;
        }

        super.destroy();
    }


    _addPlayer(busName) {
        this.menu.addMenuItem(new Player(busName));
        this._indicator.show();
        this.actor.show();
        this._indicator.set_width(-1);
        this.actor.set_width(-1);
    }

    _removePlayer(busName) {
        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            if (busName == player.busName) {
                player.destroy();
                break;
            }
        }

        children = this.menu._getMenuItems();

        if (children.length < 1) {
            this._indicator.hide();
            this._indicator.set_width(0);
            this.actor.hide();
            this.actor.set_width(0);
        }
    }

    _changePlayerOwner(busName) {
        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            if (busName == player.busName) {
                player.destroy();
                break;
            }
        }

        this._addPlayer(busName);
    }

    _onNameOwnerChanged(proxy, sender, [busName, oldOwner, newOwner]) {
        if (!busName.startsWith(MPRIS_PLAYER_PREFIX)) {
            return;
        }
        else if (newOwner && !oldOwner) {
            this._addPlayer(busName);
        }
        else if (oldOwner && !newOwner) {
            this._removePlayer(busName);
        }
        else if (oldOwner && newOwner) {
            this._changePlayerOwner(busName);
        }
    }

    _onProxyReady(proxy) {
        this._proxy = proxy;
        this._proxy.ListNamesRemote(([busNames]) => {
            busNames.forEach((busName) => {
                if (!busName.startsWith(MPRIS_PLAYER_PREFIX)) {
                    return;
                }
                else {
                    this._addPlayer(busName);
                }
            });
        });

        this._nameOwnerChangedId = this._proxy.connectSignal("NameOwnerChanged",
            this._onNameOwnerChanged.bind(this));
    }
}
