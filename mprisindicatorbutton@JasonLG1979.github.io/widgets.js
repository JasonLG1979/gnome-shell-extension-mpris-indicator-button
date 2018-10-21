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

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Atk = imports.gi.Atk;
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

const PopupMenu = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const Panel = imports.ui.panel;
const Slider = imports.ui.slider;

var CoverIcon = GObject.registerClass({
    GTypeName: "CoverIcon"
}, class CoverIcon extends St.Icon {
    _init() {
        super._init({
            icon_name: "audio-x-generic-symbolic",
            icon_size: 32,
            opacity: 153,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.ICON
        });

        this._parentHoverState = false;
        this._cancellable = null;
        this._fallbackName = "audio-x-generic-symbolic";
    }

    onParentHover(hover) {
        this._parentHoverState = hover;
        let symbolicCover = this.icon_name && this.icon_name.endsWith("-symbolic");
        this.opacity = !symbolicCover ? 255 : hover ? 204 : 153;
    }

    setFallbackName(iconName) {
        this._fallbackName = iconName || "audio-x-generic-symbolic";
    }

    setCover(coverUrl) {
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

        if (coverUrl) {
            let file = Gio.File.new_for_uri(coverUrl);
            this._cancellable = new Gio.Cancellable();
            file.load_contents_async(this._cancellable, (source, result) => {
                try {
                    let bytes = source.load_contents_finish(result)[1];
                    let newIcon = Gio.BytesIcon.new(bytes);
                    if (!newIcon.equal(this.gicon)) {
                        this.gicon = newIcon;
                        this.opacity = 255;
                        this.accessible_role = Atk.Role.IMAGE;
                    }
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        this._fallback();
                    }
                }
            });
        } else {
            this._fallback();
        }
    }

    vfunc_destroy() {
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }
        this._parentHoverState = null;
        this._cancellable = null;
        this._fallbackName = null;
        super.destroy();
    }

    _fallback() {
        this.icon_name = this._fallbackName;
        let symbolicCover = this._fallbackName.endsWith("-symbolic");
        this.opacity = !symbolicCover ? 255 : this._parentHoverState ? 204 : 153;
        this.accessible_role = Atk.Role.ICON;
    }
});

var TrackLabel = GObject.registerClass({
    GTypeName: "TrackLabel"
}, class TrackLabel extends St.Label {
    _init(baseOpacity, hoverOpacity) {
        super._init({
            accessible_role: Atk.Role.LABEL,
            opacity: baseOpacity
        });

        this._baseOpacity = baseOpacity;
        this._hoverOpacity = hoverOpacity;
    }

    onParentHover(hover) {
        this.opacity = hover ? this._hoverOpacity : this._baseOpacity;
    }

    vfunc_destroy() {
        this._baseOpacity = null;
        this._hoverOpacity = null;
        super.destroy();
    }
});

var MediaControlButton = GObject.registerClass({
    GTypeName: "MediaControlButton"
}, class MediaControlButton extends St.Button {
    _init(iconName) {
        super._init({
            style: "padding: 12px",
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

        this._signalIds = [
            this.connect("notify::hover", callback),
            this.connect("notify::reactive", callback)
        ];
    }

    vfunc_destroy() {
        if (this._signalIds) {
            this._signalIds.forEach(signalId => this.disconnect(signalId));
        }
        this._buttonSignals = null;
        super.destroy();
    }
});

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