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
const Lang = imports.lang;
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
    indicator = new MprisIndicatorButton();
    Main.panel.addToStatusArea("mprisindicatorbutton", indicator);
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

var Player = new Lang.Class({
    Name: "Player",
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (busName) {
        this.parent();
        this._destroyed = false;
        this._propsChangedId = null;
        this.busName = busName;

        this.connect("destroy", Lang.bind(this, this._teardown));
        this.connect("activate", Lang.bind(this, this._raise));

        let vbox = new St.BoxLayout({ vertical: true });

        this.actor.add(vbox, { expand: true });

        let hbox = new St.BoxLayout({ style_class: "hbox" });

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

        this._prevButton.connect("clicked", Lang.bind(this, this._previous));

        playerButtonBox.add(this._prevButton);

        icon = new St.Icon({ icon_name: "media-playback-pause-symbolic",
                             icon_size: 16 });

        this._playPauseButton = new St.Button({ style_class: "message-media-control",
                                                child: icon });

        this._playPauseButton.connect("clicked", Lang.bind(this, this._playPause));

        playerButtonBox.add(this._playPauseButton);

        icon = new St.Icon({ icon_name: "media-skip-forward-symbolic",
                             icon_size: 16 });

        this._nextButton = new St.Button({ style_class: "message-media-control",
                                           child: icon });

        this._nextButton.connect("clicked", Lang.bind(this, this._next));

        playerButtonBox.add(this._nextButton);

        vbox.add(playerButtonBox, { expand: true,
                                    x_fill: false,
                                    x_align: St.Align.MIDDLE });

        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName,
                                          "/org/mpris/MediaPlayer2");

        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName,
                                                 "/org/mpris/MediaPlayer2",
                                                 Lang.bind(this, this._onPlayerProxyReady));

    },

    _teardown: function () {
        this._destroyed = true;

        if (this._playerProxy && this._propsChangedId) {
            this._playerProxy.disconnect(this._propsChangedId);
        }

        this._propsChangedId = null;
        this._playerProxy = null;
        this._mprisProxy = null;
    },

    _setCoverIcon: function (icon, coverUrl) {
        if (this._destroyed) {
            return;
        } else {
            if (coverUrl) {
                let file = Gio.File.new_for_uri(coverUrl);
                file.load_contents_async(null, Lang.bind(this, function (source, result) {
                    if (this._destroyed) {
                        return;
                    } else {
                        try {
                            let bytes = source.load_contents_finish(result)[1];
                            let newIcon = Gio.BytesIcon.new(bytes);
                            if (!newIcon.equal(icon.gicon)) {
                                icon.gicon = newIcon;
                            }
                        } catch (err) {
                            icon.icon_name = "audio-x-generic-symbolic";
                        }
                    }
                }));
            } else {
                icon.icon_name = "audio-x-generic-symbolic";
                icon.add_style_class_name("fallback");
            }
        }
    },

    _setText: function (actor, text) {
        text = text || "";

        if (actor.text != text) {
            actor.text = text;
        }
    },

    _previous: function () {
        try {
            this._playerProxy.PreviousRemote();
        } catch (err) {}
    },

    _playPause: function () {
        try {
            this._playerProxy.PlayPauseRemote();
        } catch (err) {}
    },

    _next: function () {
        try {
            this._playerProxy.NextRemote();
        } catch (err) {}
    },

    _update: function () {
        if (this._destroyed) {
            return;
        } else {
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
    },

    _raise: function () {
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
    },

    _onPlayerProxyReady: function () {
        if (this._destroyed) {
            return;
        } else {
            this._propsChangedId = this._playerProxy.connect("g-properties-changed",
                                                             Lang.bind(this, this._update));
            this._update();
        }
    }
});

var MprisIndicatorButton = new Lang.Class({
    Name: "MprisIndicatorButton",
    Extends: PanelMenu.Button,

    _init: function () {
        this.parent(0.0, "Mpris Indicator Button", false);

        this.menu.actor.add_style_class_name("aggregate-menu media-indicator");

        this._nameOwnerChangedId = null;
        this._destroyed = false;

        this.connect("destroy", Lang.bind(this, this._teardown));

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
                                    Lang.bind(this, this._onProxyReady));
    },

    _teardown: function () {
        this._destroyed = true;

        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            player.destroy();
        }

        this.menu.removeAll();

        if (this._proxy && this._nameOwnerChangedId) {
            this._proxy.disconnect(this._nameOwnerChangedId);
        }

        this._proxy = null;
        this._nameOwnerChangedId = null;
    },


    _addPlayer: function (busName) {
        this.menu.addMenuItem(new Player(busName));
        this._indicator.show();
        this.actor.show();
        this._indicator.set_width(-1);
        this.actor.set_width(-1);
    },

    _removePlayer: function (busName) {
        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            if (busName == player.busName) {
                player.destroy();
                break;
            }
        }

        if (this.menu._getMenuItems() < 1) {
            this._indicator.hide();
            this._indicator.set_width(0);
            this.actor.hide();
            this.actor.set_width(0);
        }
    },

    _changePlayerOwner: function (busName) {
        let children = this.menu._getMenuItems();

        for (let i = 0; i < children.length; i++) {
            let player = children[i];
            if (busName == player.busName) {
                player.destroy();
                break;
            }
        }

        this._addPlayer(busName);
    },

    _onNameOwnerChanged: function (proxy, sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX || this._destroyed)) {
            return;
        } else if (newOwner && !oldOwner) {
            this._addPlayer(name);
        } else if (oldOwner && !newOwner) {
            this._removePlayer(name);
        } else {
            this._changePlayerOwner(name);
        }
    },

    _onProxyReady: function () {
        if (this._destroyed) {
            return;
        } else {
            this._proxy.ListNamesRemote(Lang.bind(this, function ([names]) {
                names.forEach(Lang.bind(this, function (name) {
                    if (!name.startsWith(MPRIS_PLAYER_PREFIX)) {
                        return;
                    } else {
                        this._addPlayer(name);
                    }
                }));
            }));

            this._nameOwnerChangedId = this._proxy.connectSignal("NameOwnerChanged",
                                                                 Lang.bind(this, this._onNameOwnerChanged));
        }
    }
});
