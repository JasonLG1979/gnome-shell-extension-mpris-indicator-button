/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/* jshint esnext: true */
/* jshint -W097 */
/* global imports: false */
/* global global: false */
/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/
"use strict";

const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

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
    stockMpris._shouldShow = function () {return false;};
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
        this._propsChangedId = null;
        this._cancellable = null;
        this.busName = busName;

        this.connect("activate", this._raise.bind(this));

        let vbox = new St.BoxLayout({ vertical: true });

        this.actor.add(vbox, { expand: true });

        let hbox = new St.BoxLayout({ style_class: "popup-menu-item" });

        vbox.add(hbox, { expand: true });

        this._coverIcon = new St.Icon({ style_class: "cover-icon" });

        hbox.add(this._coverIcon);

        let info = new St.BoxLayout({ vertical: true });

        this._trackArtist = new St.Label({ style_class: "track-artist" });

        this._trackTitle = new St.Label({ style_class: "track-title" });

        this._trackAlbum = new St.Label({ style_class: "track-album" });

        info.add(this._trackArtist, { expand: true,
                                      x_fill: false,
                                      x_align: St.Align.START });

        info.add(this._trackTitle, { expand: true,
                                     x_fill: false,
                                     x_align: St.Align.START });

        info.add(this._trackAlbum, { expand: true,
                                     x_fill: false,
                                     x_align: St.Align.START });

        hbox.add(info, { expand: true });

        let playerButtonBox = new St.BoxLayout();

        let icon;

        icon = new St.Icon({ icon_name: "media-skip-backward-symbolic",
                             icon_size: 16 });

        this._prevButton = new St.Button({ style_class: "message-media-control",
                                           child: icon });

        this._prevButton.connect("clicked", this._previous.bind(this));

        playerButtonBox.add(this._prevButton);

        icon = new St.Icon({ icon_name: "media-playback-pause-symbolic",
                             icon_size: 16 });

        this._playPauseButton = new St.Button({ style_class: "message-media-control",
                                                child: icon });

        this._playPauseButton.connect("clicked", this._playPause.bind(this));

        playerButtonBox.add(this._playPauseButton);

        icon = new St.Icon({ icon_name: "media-skip-forward-symbolic",
                             icon_size: 16 });

        this._nextButton = new St.Button({ style_class: "message-media-control",
                                           child: icon });

        this._nextButton.connect("clicked", this._next.bind(this));

        playerButtonBox.add(this._nextButton);

        vbox.add(playerButtonBox, { expand: true,
                                    x_fill: false,
                                    x_align: St.Align.MIDDLE });

        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName,
                                          "/org/mpris/MediaPlayer2");

        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName,
                                                 "/org/mpris/MediaPlayer2",
                                                 this._onPlayerProxyReady.bind(this));
    }

    destroy() {
        if (this._playerProxy && this._propsChangedId) {
            this._playerProxy.disconnect(this._propsChangedId);
        }

        if (this._cancellable && !this._cancellable.is_cancelled()) {
            this._cancellable.cancel();
        }

        this._cancellable = null;
        this._propsChangedId = null;
        this._playerProxy = null;
        this._mprisProxy = null;

        super.destroy();
    }

    _setCoverIcon(icon, coverUrl) {
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
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        icon.icon_name = "audio-x-generic-symbolic";
                    }
                }
                this._cancellable = null;
            });
        } else {
            icon.icon_name = "audio-x-generic-symbolic";
        }
    }

    _setText(actor, text) {
        text = text || "";

        if (actor.text != text) {
            actor.text = text;
        }
    }

    _previous() {
        try {
            this._playerProxy.PreviousRemote();
        } catch (err) {}
    }

    _playPause() {
        try {
            this._playerProxy.PlayPauseRemote();
        } catch (err) {}
    }

    _next() {
        try {
            this._playerProxy.NextRemote();
        } catch (err) {}
    }

    _update() {
        let metadata = this._playerProxy.Metadata;

        if (!metadata || Object.keys(metadata).length < 2) {
            metadata = {};
        }

        let artist, title, album, coverUrl;

        artist = metadata["xesam:artist"] ? metadata["xesam:artist"].deep_unpack().join(' / ') : "";
        artist = metadata["rhythmbox:streamTitle"] ? metadata["rhythmbox:streamTitle"].unpack() : artist;
        artist = artist || this._mprisProxy.Identity;

        this._setText(this._trackArtist, artist);

        title = metadata["xesam:title"] ? metadata["xesam:title"].unpack() : "";

        this._setText(this._trackTitle, title);

        album = metadata["xesam:album"] ? metadata["xesam:album"].unpack() : "";

        this._setText(this._trackAlbum, album);

        coverUrl = metadata["mpris:artUrl"] ? metadata["mpris:artUrl"].unpack() : "";

        this._setCoverIcon(this._coverIcon, coverUrl);

        let isPlaying = this._playerProxy.PlaybackStatus == "Playing";

        let iconName = isPlaying ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";

        this._playPauseButton.child.icon_name = iconName;

        this._prevButton.reactive = this._playerProxy.CanGoPrevious;

        this._playPauseButton.reactive = this._playerProxy.CanPlay || this._playerProxy.CanPause;

        this._nextButton.reactive = this._playerProxy.CanGoNext;
    }

    _raise() {
        try {
            let app = null;

            if (this._mprisProxy.DesktopEntry) {
                let desktopId = this._mprisProxy.DesktopEntry + ".desktop";
                app = Shell.AppSystem.get_default().lookup_app(desktopId);
            }

            if (app) {
                app.activate();
            } else if (this._mprisProxy.CanRaise) {
                this._mprisProxy.RaiseRemote();
            }
        } catch (err) {}
    }

    _onPlayerProxyReady() {
        this._propsChangedId = this._playerProxy.connect("g-properties-changed",
                                                         this._update.bind(this));
        this._update();
    }
};

class MprisIndicatorButton extends PanelMenu.Button {
    constructor() {
        super(0.0, "Mpris Indicator Button", false);

        this.menu.actor.add_style_class_name("aggregate-menu media-indicator");

        this._nameOwnerChangedId = null;

        this._indicator = new St.BoxLayout({ style_class: "panel-status-indicators-box" });

        this._indicator.hide();
        this._indicator.set_width(0);

        this.actor.add_child(this._indicator);

        this.actor.hide();
        this.actor.set_width(0);

        let icon = new St.Icon({ icon_name: "audio-x-generic-symbolic",
                                 style_class: "system-status-icon" });

        this._indicator.add_child(icon);

        this._proxy = new DBusProxy(Gio.DBus.session,
                                    "org.freedesktop.DBus",
                                    "/org/freedesktop/DBus",
                                    this._onProxyReady.bind(this));
    }

    destroy() {
        if (this._proxy && this._nameOwnerChangedId) {
            this._proxy.disconnect(this._nameOwnerChangedId);
        }

        this._proxy = null;
        this._nameOwnerChangedId = null;

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

    _onNameOwnerChanged(proxy, sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX)) {
            return;
        } else if (newOwner && !oldOwner) {
            this._addPlayer(name);
        } else if (oldOwner && !newOwner) {
            this._removePlayer(name);
        } else if (oldOwner && newOwner) {
            this._changePlayerOwner(name);
        }
    }

    _onProxyReady() {
        this._proxy.ListNamesRemote(([names]) => {
            names.forEach((name) => {
                if (!name.startsWith(MPRIS_PLAYER_PREFIX)) {
                    return;
                } else {
                    this._addPlayer(name);
                }
            });
        });

        this._nameOwnerChangedId = this._proxy.connectSignal("NameOwnerChanged",
                                                             this._onNameOwnerChanged.bind(this));
    }
};
