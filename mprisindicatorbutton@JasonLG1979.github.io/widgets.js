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

const { Atk, Clutter, Gio, GObject, Gtk, St } = imports.gi;

const Slider = imports.ui.slider;

const VOULME_ICONS = [
    "audio-volume-muted-symbolic",
    "audio-volume-low-symbolic",
    "audio-volume-medium-symbolic",
    "audio-volume-high-symbolic"
];

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
            style: "padding-right: 10px;",
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

        let signalIds = [
            this.connect("notify::hover", () => {
                this.opacity = this.hover ? hoverOpacity : baseOpacity;
            }),
            this.connect("destroy", () => {
                signalIds.forEach(signalId => this.disconnect(signalId));
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
            style: "padding: 10px, 10px, 10px, 10px;",
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

var VolumeSlider = GObject.registerClass({
    GTypeName: "VolumeSlider",
    Properties: {
        "value": GObject.ParamSpec.double(
            "value",
            "value-prop",
            "The current slider value",
            GObject.ParamFlags.READWRITE,
            0.0,
            1.0,
            0.0
        )
    }
}, class VolumeSlider extends St.BoxLayout {
    _init(name) {
        super._init({
            name: name,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            x_expand: true
        });

        this._value = 0.0;
        this._preMuteValue = 0.0;
        this._muted = false;

        this._button = new St.Button({
            style: "padding-right: 10px;",
            opacity: 204,
            accessible_role: Atk.Role.PUSH_BUTTON,
            child: new St.Icon({
                accessible_role: Atk.Role.ICON,
                icon_size: 16
            })
        });

        this.add(this._button);

        this._slider = new Slider.Slider(0);

        this.add(this._slider.actor, {expand: true});

        let signals = [];

        let pushSignal = (obj, signalName, callback) => {
            let signalId = obj.connect(signalName, callback);
            signals.push({
                obj: obj,
                signalId: signalId
            });
        };

        pushSignal(this._button, "notify::hover", () => {
            this._button.opacity = this._button.hover ? 255 : 204;
        });

        pushSignal(this._button, "clicked", () => {
            if (this._muted) {
                this.value = this._preMuteValue;
            } else {
                this._muted = true;
                this._preMuteValue = this._value;
                this.value = 0.0;
            }
        });

        pushSignal(this._slider, "value-changed", () => {
            this.value = this._slider._value;
        });

        pushSignal(this, "destroy", () => {
            signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._value = null;
            this._preMuteValue = null;
            this._muted = null;
        });
    }

    get value() {
        return this._value || 0.0;
    }

    set value(newValue) {
        newValue = newValue
        ? Math.max(0.0, Math.min(newValue, 1.0))
        : 0.0;
        if (this._value !== newValue) {
            if (newValue) {
                this._muted = false;
            }
            let iconIndex = !newValue
                ? 0
                : newValue == 1.0
                ? 3
                : newValue < 0.5
                ? 1
                : 2;
            this._button.child.icon_name = VOULME_ICONS[iconIndex];
            this._slider.setValue(newValue);
            this._value = newValue;
            this.notify("value");
            this.show();
        }
    }
});
