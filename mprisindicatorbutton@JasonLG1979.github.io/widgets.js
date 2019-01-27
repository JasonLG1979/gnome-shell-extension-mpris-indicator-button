/*
 * Mpris Indicator Button extension for Gnome Shell 3.28+
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
 * If this extension breaks your desktop you get to keep all of the pieces...
 */
"use strict";

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Atk = imports.gi.Atk;
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;


// The Cover Icon has crazy fallback redundancy.
// The order is as follows:
// 1. The actual cover art
// 2. The player's symbolic icon
// 3. The player's full color icon
// 4. A symbolic icon loosely representing
//    the current track's media type. (audio or video)
// 5. If all else fails the audio mimetype symbolic icon.
var CoverIcon = GObject.registerClass({
    GTypeName: "CoverIcon",
    Properties: {
        "cover-url": GObject.ParamSpec.string(
            "cover-url",
            "cover-url-prop",
            "the url of the current track's cover art",
            GObject.ParamFlags.WRITABLE,
            ""
        ),
        "fallback-gicon": GObject.ParamSpec.object(
            "fallback-gicon",
            "fallback-gicon-prop",
            "the gicon to use if there is no cover url",
            GObject.ParamFlags.WRITABLE,
            Gio.ThemedIcon.new("audio-x-generic-symbolic")
        )
    }
}, class CoverIcon extends St.Icon {
    _init(name) {
        super._init({
            name: name,
            icon_size: 32,
            opacity: 153,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.ICON
        });

        this._cancellable = null;
        this._useFallback = true;
        this._fallback_gicon = Gio.ThemedIcon.new("audio-x-generic-symbolic");
        this._fallback_gicon.isSymbolic = true;
        this.gicon = this._fallback_gicon;

        let signalIds = [
            this.connect("notify::hover", () => {
                this.opacity = !this.gicon.isSymbolic ? 255 : this.hover ? 204 : 153;
            }),
            this.connect("destroy", () => {
                if (this._cancellable) {
                    if (!this._cancellable.is_cancelled()) {
                        this._cancellable.cancel();
                    }
                    this._cancellable.run_dispose();
                }
                signalIds.forEach(signalId => this.disconnect(signalId));
                this._cancellable = null;
                this._useFallback = null;
                this._fallback_gicon = null;
            })
        ];
    }

    set fallback_gicon(gicon) {
        this._fallback_gicon = gicon;
        if (this._useFallback) {
            this._fallback();
        }
    }

    set cover_url(cover_url) {
        // Asynchronously set the cover icon.
        // Much more fault tolerant than:
        //
        // let file = Gio.File.new_for_uri(coverUrl);
        // icon.gicon = new Gio.FileIcon({ file: file });
        //
        // Which silently fails on error and can lead to the wrong cover being shown.
        // On error this will fallback gracefully.
        //
        // The Gio.Cancellable and corresponding catch logic protects against machine gun updates.
        // It serves to insure we only have one async operation happening at a time,
        // the most recent.
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
            this._cancellable = null;
        }

        if (cover_url) {
            this._useFallback = false;
            let file = Gio.File.new_for_uri(cover_url);
            this._cancellable = new Gio.Cancellable();
            file.load_contents_async(this._cancellable, (source, result) => {
                try {
                    let bytes = source.load_contents_finish(result)[1];
                    this.gicon = Gio.BytesIcon.new(bytes);
                    this.gicon.isSymbolic = false;
                    this.opacity = 255;
                    this.accessible_role = Atk.Role.IMAGE;
                } catch (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        this._fallback();
                    }
                }
            });
        } else {
            this._fallback();
        }
    }

    _fallback() {
        this._useFallback = true;
        this.gicon = this._fallback_gicon;
        this.accessible_role = Atk.Role.ICON;
        this.opacity = !this.gicon.isSymbolic ? 255 : this.hover ? 204 : 153;
    }
});

var TrackLabel = GObject.registerClass({
    GTypeName: "TrackLabel"
}, class TrackLabel extends St.Label {
    _init(name, baseOpacity, hoverOpacity) {
        super._init({
            name: name,
            accessible_role: Atk.Role.LABEL,
            opacity: baseOpacity
        });

        this._baseOpacity = baseOpacity;
        this._hoverOpacity = hoverOpacity;

        let signalIds = [
            this.connect("notify::hover", () => {
                this.opacity = this.hover ? this._hoverOpacity : this._baseOpacity;
            }),
            this.connect("destroy", () => {
                signalIds.forEach(signalId => this.disconnect(signalId));
                this._hoverOpacity = null;
                this._baseOpacity = null;
            })
        ];
    }
});

var MediaControlButton = GObject.registerClass({
    GTypeName: "MediaControlButton"
}, class MediaControlButton extends St.Button {
    _init(name, iconName) {
        super._init({
            name: name,
            style: "padding: 8px, 12px, 8px, 12px;",
            opacity: 204,
            accessible_role: Atk.Role.PUSH_BUTTON,
            child: new St.Icon({
                icon_name: iconName,
                accessible_role: Atk.Role.ICON,
                icon_size: 16
            })
        });

        let callback = () => {
            this.opacity = !this.reactive ? 102 : this.hover ? 255 : 204;
        };

        let signalIds = [
            this.connect("notify::hover", callback),
            this.connect("notify::reactive", callback),
            this.connect("destroy", () => {
                signalIds.forEach(signalId => this.disconnect(signalId));
            })
        ];
    }
});
