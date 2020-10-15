/*
 * Mpris Indicator Button extension for Gnome Shell 3.34+
 * Copyright 2020 Jason Gray (JasonLG1979)
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

// No translatable strings in this file.
const { Atk, Clutter, Gio, GObject, St } = imports.gi;

const { AggregateLayout } = imports.ui.panel;
const { Button } = imports.ui.panelMenu;
const { PopupBaseMenuItem, PopupSubMenuMenuItem, PopupMenuSection, PopupSeparatorMenuItem, Ornament} = imports.ui.popupMenu;
const { Slider } = imports.ui.slider;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const { DBusProxyHandler, logMyError } = imports.misc.extensionUtils.getCurrentExtension().imports.dbus;
const { ToolTipBase } = imports.misc.extensionUtils.getCurrentExtension().imports.indicatorToolTip;
const { TRANSLATED } = imports.misc.extensionUtils.getCurrentExtension().imports.translations;
const DEFAULT_SYNC_CREATE_PROP_FLAGS = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;
const MOUSE_BUTTON_BACK = 8;
const MOUSE_BUTTON_FORWARD = 9;

const VOULME_ICONS = [
    'audio-volume-muted-symbolic',
    'audio-volume-low-symbolic',
    'audio-volume-medium-symbolic',
    'audio-volume-high-symbolic'
];

class CoverArtIOHandler {
    // For it to work as intended there can only
    // be 1 instance of CoverArtIOHandler but it
    // also has to be destroyable.
    // That leaves us with 2 options:
    // Either create it once in MprisIndicatorButton
    // or Player and pass it around though a bunch of classes
    // eventually to every instance of CoverIcon,
    // or just make CoverArtIOHandler a singleton.
    static get singleton() {
        if (!this._singleton) {
            this._singleton = new this();
            this._singleton._cancellables = new Map();
            this._singleton._callbacks = new Map();
        }
        return this._singleton;
    }

    getCover(cover_url, callback) {
        if (this._shouldDoIO(callback, cover_url)) {
            let cancellable = new Gio.Cancellable();
            this._cancellables.set(cover_url, cancellable);
            Gio.File.new_for_uri(cover_url).load_bytes_async(
                cancellable,
                (file, result) => {
                    try {
                        let [bytes, etag] = file.load_bytes_finish(result);
                        let fingerPrint = cover_url + etag;
                        this._fireCallbacks(cover_url, bytes, fingerPrint);
                    } catch (error) {
                        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            this._fireCallbacks(cover_url, null, null);
                            logMyError(error);
                        }
                    }
                }
            );
        }
    }

    cancel(callback) {
        let cover_url = this._callbacks.get(callback);
        this._callbacks.delete(callback);
        if (cover_url && !Array.from(this._callbacks.values()).includes(cover_url)) {
            let cancellable = this._cancellables.get(cover_url);
            if (cancellable && !cancellable.is_cancelled()) {
                cancellable.cancel();
            }
            if (cancellable) {
                cancellable.run_dispose();
            }
            this._cancellables.delete(cover_url);
        }
    }

    _shouldDoIO(callback, cover_url) {
        let redundantCall = this._callbacks.get(callback) === cover_url;
        if (!redundantCall) {
            this.cancel(callback);
            this._callbacks.set(callback, cover_url);
        }
        let duplicateCallForCoverUrl = this._cancellables.has(cover_url);
        return !redundantCall && !duplicateCallForCoverUrl;
    }

    _fireCallbacks(cover_url, bytes, fingerPrint) {
        if (this._callbacks && this._cancellables) {
            let cancellable = this._cancellables.get(cover_url);
            if (cancellable) {
                cancellable.run_dispose();
                this._cancellables.delete(cover_url);
            }
            this._callbacks.forEach((value, callback, map) => {
                if (value === cover_url) {
                    callback(bytes, fingerPrint);
                    map.delete(callback);
                }
            });
        }
    }

    static destroy() {
        if (this._singleton) {
            this._singleton._callbacks.clear();
            this._singleton._callbacks = null;
            this._singleton._cancellables.forEach(cancellable => {
                if (!cancellable.is_cancelled()) {
                    cancellable.cancel();
                }
                cancellable.run_dispose();
            });
            this._singleton._cancellables.clear();
            this._singleton._cancellables = null;
            delete this._singleton;
        }
    }
}

const CoverIcon = GObject.registerClass({
    GTypeName: 'CoverIcon',
    Properties: {
        'cover-url': GObject.ParamSpec.string(
            'cover-url',
            'cover-url-prop',
            'the url of the current track\'s cover art',
            GObject.ParamFlags.WRITABLE,
            ''
        ),
        'fallback-gicon': GObject.ParamSpec.object(
            'fallback-gicon',
            'fallback-gicon-prop',
            'the gicon to use if there is no cover url',
            GObject.ParamFlags.WRITABLE,
            Gio.ThemedIcon.new('audio-x-generic-symbolic')
        )
    }
}, class CoverIcon extends St.Icon {
    _init() {
        super._init({
            style_class: 'popup-menu-icon',
            accessible_role: Atk.Role.ICON
        });
        this._useFallback = true;
        this._fingerPrint = '';
        this._coverArtIOHandler = CoverArtIOHandler.singleton;
        this._coverCallback = this._setCoverGicon.bind(this);
        this._fallback_gicon = Gio.ThemedIcon.new('audio-x-generic-symbolic');
        this.gicon = this._fallback_gicon;
        this._signals = [];
        this.pushSignal(this, 'destroy', this._onDestroy.bind(this));
    }

    pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }

    update(fallback_icon_name, cover_url) {
        if (this._fallback_gicon && !this._fallback_gicon.get_names().includes(fallback_icon_name)) {
            this.fallback_gicon = Gio.ThemedIcon.new(fallback_icon_name);
        }
        this.cover_url = cover_url;
    }

    set fallback_gicon(gicon) {
        if (this._fallback_gicon) {
            this._fallback_gicon = gicon;
            if (this._useFallback) {
                this._fallback();
            }
        }
    }

    set cover_url(cover_url) {
        if (this._coverArtIOHandler) {
            if (cover_url) {
                this._useFallback = false;
                this._coverArtIOHandler.getCover(cover_url, this._coverCallback);
            } else {
                this._fallback();
            }
        }
    }

    _setCoverGicon(bytes, fingerPrint) {
        if (this._coverArtIOHandler) {
            if (bytes && fingerPrint) {
                if (this._fingerPrint !== fingerPrint) {
                    this.gicon = Gio.BytesIcon.new(bytes);
                    this._fingerPrint = fingerPrint;
                    this.accessible_role = Atk.Role.IMAGE;
                }
            } else {
                this._fallback();
            }
        }
    }

    _fallback() {
        if (this._fallback_gicon) {
            this._useFallback = true;
            this._fingerPrint = '';
            this.gicon = this._fallback_gicon;
            this.accessible_role = Atk.Role.ICON;
        }
    }

    _onDestroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._signals = null;
            this._fallback_gicon = null;
            this._useFallback = null;
            this._fingerPrint = null;
            this._coverArtIOHandler.cancel(this._coverCallback);
            this._coverArtIOHandler = null;
            this._coverCallback = null;
        }
    }
});

const MediaButton = GObject.registerClass({
    GTypeName: 'MediaButton',
    Signals: {
        'clicked': {
            flags: GObject.SignalFlags.RUN_FIRST
        }
    },
    Properties: {
        'active': GObject.ParamSpec.boolean(
            'active',
            'active-prop',
            'If the button should appear active',
            GObject.ParamFlags.READWRITE,
            true
        )
    }
}, class MediaButton extends St.Icon {
    _init(icon_name, acc_name) {
        super._init({
            opacity: 204,
            track_hover: true,
            can_focus: true,
            reactive: true,
            accessible_role: Atk.Role.PUSH_BUTTON,
            accessible_name: acc_name,
            icon_name: icon_name,
            style_class: 'popup-menu-arrow media-controls-button',
        });

        this._active = true;

        let signalIds = [
            this.connect('notify::active', this._onHover.bind(this)),
            this.connect('notify::reactive', this._onHover.bind(this)),
            this.connect('notify::hover', this._onHover.bind(this)),
            this.connect('button-press-event', this._onButtonPressEvent.bind(this)),
            this.connect('button-release-event', this._onButtonReleaseEvent.bind(this)),
            this.connect('touch-event', this._onTouchEvent.bind(this)),
            this.connect('key-press-event', this._onKeyPressEvent.bind(this)),
            this.connect('destroy', () => {
                signalIds.forEach(signalId => this.disconnect(signalId));
                this._active = null;
            })
        ];
    }

    set active(active) {
        this._active = active;
        this.notify('active');
    }

    get active() {
        return this._active || true;
    }

    _onHover() {
        this.opacity = !this.reactive
            ? 102
            : this.hover
            ? 255
            : !this._active
            ? 102
            : 204;
    }

    _onButtonPressEvent(actor, event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY) {
            this.opacity = 102;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonReleaseEvent(actor, event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY) {
            this._onHover();
            this.emit('clicked');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onTouchEvent(actor, event) {
        event = event.type();
        if (event === Clutter.EventType.TOUCH_END) {
            this._onHover();
            this.emit('clicked');
            return Clutter.EVENT_STOP;
        } else if (event === Clutter.EventType.TOUCH_BEGIN) {
            this.opacity = 102;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onKeyPressEvent(actor, event) {
        let state = event.get_state();
        state &= ~Clutter.ModifierType.LOCK_MASK;
        state &= ~Clutter.ModifierType.MOD2_MASK;
        state &= Clutter.ModifierType.MODIFIER_MASK;
        if (state) {
            return Clutter.EVENT_PROPAGATE;
        }
        let symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_space || symbol === Clutter.KEY_Return) {
            this._onHover();
            this.emit('clicked');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

const TrackInfo = GObject.registerClass({
    GTypeName: 'TrackInfo'
}, class TrackInfo extends St.BoxLayout {
    _init() {
        super._init({
            x_expand: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME,
            vertical: true
        });

        this.artistLabel = new St.Label({
            x_expand: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.END,
            style_class: 'normal-label'
        });

        this.add_child(this.artistLabel);

        this.titleLabel = new St.Label({
            x_expand: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.START,
            style_class: 'lighter-label'
        });

        this.add_child(this.titleLabel);
    }

    update(artist, title) {
        if (this.artistLabel.text !== artist) {
            this.artistLabel.text = artist;
        }
        if (this.titleLabel.text !== title) {
            this.titleLabel.text = title;
        }
    }
});

const ToolTip = GObject.registerClass({
    GTypeName: 'ToolTip'
}, class ToolTip extends ToolTipBase {
    _init(indicator) {
        super._init(
            indicator,
            true,
            `Mpris ${TRANSLATED['Indicator Button']}`,
            'media-playback-stop-symbolic',
            'osd-window tool-tip',
            'tool-tip-icon'
        );

        this.focused = false;

        this.iconNames = [
            'media-playback-stop-symbolic',
            'media-playback-pause-symbolic',
            'media-playback-start-symbolic'
        ];

        this.pushSignal(this.indicator, 'update-tooltip', this.onUpdateToolTip.bind(this));
    }

    onUpdateToolTip(indicator, artist, title, focused, playbackStatus) {
        // Never show the tool tip if a player is focused. At that point it's
        // redundant information. Also hide the tool tip if a player becomes
        // focused while it is visible. (As in maybe the user secondary clicked the indicator)
        this.focused = focused;
        let iconName = this.iconNames[playbackStatus];
        let text = title ? artist + ' • ' + title : artist;
        this.animatedUpdate(text, iconName);
        if ((this.focused && this.visible) || !this.text) {
           this.updateAfterHide(text, iconName);
        }
    }

    onIndicatorHover(indicator, pspec) {
        if (this.indicator.hover && this.text && !this.indicatorMenuIsOpen && !this.focused && !this.visible) {
            this.animatedShow();
        } else {
            this.animatedHide();
        }
    }

    onIndicatorDestroy(indicator) {
        super.onIndicatorDestroy(indicator);
        this.focused = null;
        this.iconNames = null;
    }
});

const MainItem = GObject.registerClass({
    GTypeName: 'MainItem',
    GTypeFlags: GObject.TypeFlags.ABSTRACT
}, class MainItem extends PopupBaseMenuItem {
    _init() {
        super._init();
        this._ornamentLabel.y_align = Clutter.ActorAlign.CENTER;
        this._ornamentLabel.y_expand = true;
        this._signals = [];
        this.pushSignal(this, 'destroy', this._onDestroy.bind(this));
    }

    pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
        return signalId;
    }

    _onDestroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._signals = null;
        }
    }
});

const MediaControlsItem = GObject.registerClass({
    GTypeName: 'MediaControlsItem',
    Properties: {
        'player-name': GObject.ParamSpec.string(
            'player-name',
            'player-name-prop',
            'the player\'s name',
            GObject.ParamFlags.READWRITE,
            ''
        )
    }
}, class MediaControlsItem extends PopupBaseMenuItem {
    _init() {
        super._init();
        this._ornamentLabel.destroy();
        this.add_style_class_name('media-controls-item');
        this._signals = [];
        this.accessible_name = TRANSLATED['Media Controls'];
        this._player_name = '';
        this.pushSignal(this, 'destroy', this._onDestroy.bind(this));

        let box = new St.BoxLayout({
            y_expand: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.INTERNAL_FRAME
        });

        this.add_child(box);

        this.shuffleButton = new MediaButton(
            'media-playlist-shuffle-symbolic',
            TRANSLATED['Shuffle']
        );

        box.add_child(this.shuffleButton);

        this.prevButton = new MediaButton(
            'media-skip-backward-symbolic',
            TRANSLATED['Previous']
        );

        box.add_child(this.prevButton);

        this.playPauseButton = new MediaButton(
            'media-playback-start-symbolic',
            TRANSLATED['Play Pause']
        );

        box.add_child(this.playPauseButton);

        this.stopButton = new MediaButton(
            'media-playback-stop-symbolic',
            TRANSLATED['Stop']
        );

        box.add_child(this.stopButton);

        this.nextButton = new MediaButton(
            'media-skip-forward-symbolic',
            TRANSLATED['Next']
        );

        box.add_child(this.nextButton);

        this.repeatButton = new MediaButton(
            'media-playlist-repeat-symbolic',
            TRANSLATED['Repeat']
        );

        box.add_child(this.repeatButton);
    }

    setOrnament(ornament) {
    }

    get player_name() {
        return this._player_name;
    }

    set player_name(player_name) {
        if (this._player_name !== player_name) {
            this._player_name = player_name;
            this.accessible_name = `${player_name} ${TRANSLATED['Media Controls']}`;
            this.notify('player-name');
        }
    }

    pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
        return signalId;
    }

    _onDestroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._signals = null;
        }
    }

    _onButtonReleaseEvent(actor, event) {
        actor.remove_style_pseudo_class('active');
        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonPressEvent(actor, event) {
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            actor.add_style_pseudo_class('active');
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

const Volume = GObject.registerClass({
    GTypeName: 'Volume'
}, class Volume extends MainItem {
    _init() {
        super._init();
        this.hide();
        this._mpris = null;
        this._value = 0.0;
        this._preMuteValue = 0.0;
        this._preDragValue = 0.0;
        this._muted = false;
        this._icon = new St.Icon({
            icon_name: 'audio-volume-muted-symbolic',
            style_class: 'popup-menu-icon',
        });

        this.add_child(this._icon);

        this._slider = new Slider(0);
        this._slider.accessible_name = TRANSLATED['Volume'];
        this._slider.x_expand = true;

        this.add_child(this._slider);

        this.pushSignal(this, 'scroll-event', (actor, event) => {
            return this._slider._onScrollEvent(actor, event);
        });

        this.pushSignal(this, 'touch-event', (actor, event) => {
            return this._slider._touchDragging(actor, event);
        });

        this.pushSignal(this, 'button-press-event', (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this.toggleMute();
            }
            return this._slider.startDragging(event);
        });

        this.pushSignal(this, 'key-press-event', (actor, event) => {
            return this._slider.onKeyPressEvent(actor, event);
        });

        this._sliderChangedId = this.pushSignal(this._slider, 'notify::value', () => {
            this.value = this._sliderValue;
        });

        this.pushSignal(this._slider, 'drag-begin', () => {
            this._preDragValue = this.value;
        });

        this.pushSignal(this._slider, 'drag-end', () => {
            this.remove_style_pseudo_class('active');
            if (this._preDragValue && !this.value) {
                this._preMuteValue = this._preDragValue;
                this._muted = true;
            }
        });
    }

    setProxy(mpris) {
        this._mpris = mpris;
        this.value = this._mprisVolume;
        if (this._mpris.player_name) {
            this._slider.accessible_name = `${this._mpris.player_name} ${TRANSLATED['Volume']}`;
        }
        this._volumeChangedId = this._mpris.pushSignal(this._mpris, 'notify::volume', () => {
            this.value = this._mprisVolume;
        });
        this._mpris.pushSignal(this._mpris, 'notify::player-name', () => {
            this._slider.accessible_name = `${this._mpris.player_name} ${TRANSLATED['Volume']}`;
        });
        this._mpris.bind_property(
            'show-volume',
            this,
            'visible',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );
    }

    get value() {
        return this._value || 0.0;
    }

    set value(newValue) {
        if (this._value !== newValue) {
            this._value = newValue;
            if (this._value) {
                this._muted = false;
            }
            let iconIndex = !this._value
                ? 0
                : this._value == 1.0
                ? 3
                : this._value < 0.5
                ? 1
                : 2;
            let iconName = VOULME_ICONS[iconIndex];
            if (this._icon.icon_name !== iconName) {
                this._icon.icon_name = iconName;
            }
            if (this._sliderValue !== this._value) {
                this._sliderValue = this._value;
            }
            if (this._mprisVolume !== this._value) {
                this._mprisVolume = this._value;
            }
        }
    }

    get _sliderValue() {
        return this._slider.value ? Math.max(0.0, Math.min(Math.round(this._slider.value * 100) / 100, 1.0)) : 0.0;
    }

    set _sliderValue(value) {
        GObject.signal_handler_block(this._slider, this._sliderChangedId);
        this._slider.value = value;
        GObject.signal_handler_unblock(this._slider, this._sliderChangedId);
    }

    get _mprisVolume() {
        return this._mpris ? this._mpris.volume : 0.0;
    }

    set _mprisVolume(volume) {
        if (this._mpris) {
            GObject.signal_handler_block(this._mpris, this._volumeChangedId);
            this._mpris.volume = volume;
            GObject.signal_handler_unblock(this._mpris, this._volumeChangedId);
        }
    }

    toggleMute() {
        if (this.visible) {
            if (this._muted) {
                this.value = this._preMuteValue;
            } else {
                this._muted = true;
                this._preMuteValue = this.value;
                this.value = 0.0;
            }
            return true;
        }
        return false;
    }

    _onDestroy() {
        super._onDestroy();
        this._mpris = null;
        this._value = null;
        this._preMuteValue = null;
        this._preDragValue = null;
        this._muted = null;
    }
});

const SubMenuItem = GObject.registerClass({
    GTypeName: 'SubMenuItem',
    GTypeFlags: GObject.TypeFlags.ABSTRACT
}, class SubMenuItem extends MainItem {
    _init(proxy) {
        super._init();
        this._obj_id = null;
        if (proxy) {
            this.pushSignal(this, 'activate', () => {
                proxy.goTo(this.obj_id);
            });
        }
    }

    get obj_id() {
        return this._obj_id || '';
    }
});

const PlayListSubMenuItem = GObject.registerClass({
    GTypeName: 'PlayListSubMenuItem'
}, class PlayListSubMenuItem extends SubMenuItem {
    _init(proxy, metadata) {
        super._init(proxy);
        this.label = new St.Label({
            style_class: 'normal-label'
        });
        this.add_child(this.label);
        this.updatePlayerName(proxy.player_name);
        this.updateMetadata(metadata);
    }

    updatePlayerName(player_name) {
        this.accessible_name = `${player_name} ${TRANSLATED['PlayList Item']};`;
    }

    updateMetadata([obj_id, title]) {
        this._obj_id = obj_id;
        this.label.text = title;
    }
});

const TrackItem = GObject.registerClass({
    GTypeName: 'TrackItem',
    GTypeFlags: GObject.TypeFlags.ABSTRACT
}, class TrackItem extends SubMenuItem {
    _init(proxy) {
        super._init(proxy);
        this.coverIcon = new CoverIcon();
        this.add_child(this.coverIcon);
        this.info = new TrackInfo();
        this.add_child(this.info);
        this.pushSignal(this.info, 'notify::height', (info) => {
            let size = Math.ceil(info.height > 0 ? info.height : 32 / St.ThemeContext.get_for_stage(global.stage).scale_factor);
            this.coverIcon.icon_size = size;
            this.coverIcon.set_size(size, size);
        });
    }
});

const PlayerItem = GObject.registerClass({
    GTypeName: 'PlayerItem'
}, class PlayerItem extends TrackItem {
    _init() {
        super._init();
        this.closeButton = new St.Button({
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'player-quit-button',
            child: new St.Icon({
                style_class: 'popup-menu-arrow',
                icon_name: 'window-close-symbolic'
            })
        });
        this.closeButton.hide();
        this.add_child(this.closeButton);
        let iconEffect = new Clutter.DesaturateEffect();
        this.coverIcon.add_effect(iconEffect);
        this.coverIcon.pushSignal(this.coverIcon, 'notify::gicon', () => {
            iconEffect.enabled = this.coverIcon.gicon instanceof Gio.BytesIcon ? false : true;
        });
    }

    vfunc_event(event) {
        return Clutter.EVENT_PROPAGATE;
    }
});

const TrackListSubMenuItem = GObject.registerClass({
    GTypeName: 'TrackListSubMenuItem'
}, class TrackListSubMenuItem extends TrackItem {
    _init(proxy, metadata) {
        super._init(proxy);
        this.updatePlayerName(proxy.player_name);
        this.updateMetadata(metadata);
    }

    updatePlayerName(player_name) {
        this.accessible_name = `${player_name} ${TRANSLATED['TrackList Item']};`;
    }

    updateMetadata([obj_id, cover_url, artist, title, mimetype_icon]) {
        this._obj_id = obj_id;
        this.coverIcon.update(mimetype_icon, cover_url);
        this.info.update(artist, title);
    }
});

const SubMenu = GObject.registerClass({
    GTypeName: 'SubMenu'
}, class SubMenu extends PopupSubMenuMenuItem {
    _init(itemClass) {
        super._init('', true);
        this.label_actor = null;
        this.hide();
        this._proxy = null;
        this._itemClass = itemClass;
        this._current_obj_id = '';
        this._signals = [];
        this.icon.icon_name = 'view-list-bullet-symbolic';
    }

    get busName() {
        return this._proxy ? this._proxy.busName : '';
    }

    setProxy(proxy) {
        if (this._proxy) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._signals = [];
            this._proxy.destroy();
            this._current_obj_id = '';
            this.menu.removeAll();
        }
        this._proxy = proxy;

        let updatePlayerName = (proxy) => {
            let listTile = proxy.list_title == 'TrackList'
                ? TRANSLATED['TrackList']
                : proxy.list_title == 'PlayLists'
                ? TRANSLATED['PlayLists']
                : proxy.list_title;
            this.label.text = listTile;
            let ifaceName = proxy.ifaceName;
            let menuType = ifaceName == 'TrackList'
                ? TRANSLATED['TrackList']
                : TRANSLATED['PlayLists'];
            this.accessible_name = ifaceName !== proxy.list_title
                ? `${proxy.player_name} ${menuType};`
                : proxy.player_name;
            this.menu._getMenuItems().forEach(item => item.updatePlayerName(proxy.player_name));
        };

        updatePlayerName(proxy);

        this.pushSignal(this._proxy, 'notify::list-title', (proxy) => {
            updatePlayerName(proxy);
        });

        this.pushSignal(this._proxy, 'notify::show-list', (proxy) => {
            if (!proxy.show_list) {
                if (this.menu.isOpen) {
                    this.menu.toggle();
                }
                this._current_obj_id = '';
                this.menu.removeAll();
            }
            this.visible = proxy.show_list;
        });
        this.pushSignal(this._proxy, 'notify::current-obj-id', (proxy) => {
            let current_obj_id = proxy.current_obj_id;
            if (this._current_obj_id !== current_obj_id) {
                this._current_obj_id = current_obj_id;
                this.menu._getMenuItems().forEach(i => {
                    let ornament = current_obj_id === i.obj_id
                        ? Ornament.DOT
                        : Ornament.NONE;
                    i.setOrnament(ornament);
                });
            }
        });
        this.pushSignal(this._proxy, 'metadata-changed', (_, obj_id, ...metadata) => {
            let item = this.menu._getMenuItems().find(i => i.obj_id === obj_id);
            if (item) {
                this._current_obj_id = '';
                item.updateMetadata(metadata);
            }
        });
        this.pushSignal(this._proxy, 'new-metadata', (proxy) => {
            this._current_obj_id = '';
            let items = this.menu._getMenuItems();
            let metadata = proxy.metadata;
            metadata.forEach((m, i) => {
                // Reuse what submenu items we can.
                let item = items[i];
                if (item) {
                    item.updateMetadata(m);
                } else {
                    // Create any new submenu items as needed.
                    this.menu.addMenuItem(new this._itemClass(proxy, m));
                }
            });
            // Destroy any submenu items we don't need.
            items.slice(metadata.length).forEach(i => i.destroy());
        });
        this.pushSignal(this, 'destroy', () => {
            if (this._proxy) {
                this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
                this._proxy.destroy();
            }
            this._current_obj_id = null;
            this._signals = null;
            this._proxy = null;
            this._itemClass = null;
        });
        this._proxy.refresh();
    }

    pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
    }
});

class Player extends PopupMenuSection {
    constructor(mpris, trackList, playList, updateIndicator) {
        super();
        this.actor.visible = false;
        this._mpris = null;

        this._playerItem = new PlayerItem();
        this.addMenuItem(this._playerItem);

        this._controls = new MediaControlsItem();
        this.addMenuItem(this._controls);

        this._volume = new Volume();
        this.addMenuItem(this._volume);

        this._playListSubMenu = new SubMenu(PlayListSubMenuItem);
        this.addMenuItem(this._playListSubMenu);

        this._trackListSubMenu = new SubMenu(TrackListSubMenuItem);
        this.addMenuItem(this._trackListSubMenu);

        this._playerItem.pushSignal(this._playerItem, 'activate', () => {
            this.toggleWindow(false);
        });

        this._playerItem.pushSignal(this._playerItem, 'notify::hover', () => {
            this._playerItem.closeButton.visible = this._playerItem.hover && this._mpris && this._mpris.show_close;
        });

        this._playerItem.pushSignal(this._playerItem, 'key-press-event', this._onKeyPressEvent.bind(this));
        this._controls.pushSignal(this._controls, 'key-press-event', this._onKeyPressEvent.bind(this));

        this._playerItem.pushSignal(this._playerItem, 'scroll-event', this._onScrollEvent.bind(this));
        this._controls.pushSignal(this._controls, 'scroll-event', this._onScrollEvent.bind(this));

        this._playerItem.pushSignal(this._playerItem, 'button-release-event', (actor, event) => {
            actor.remove_style_pseudo_class('active');
            let button = event.get_button();
            if (button === Clutter.BUTTON_PRIMARY) {
                this._playerItem.activate(event);
                return Clutter.EVENT_STOP;
            } else if (button === Clutter.BUTTON_MIDDLE) {
                return player.playPauseStop();
            } else if (button === Clutter.BUTTON_SECONDARY) {
                return this.toggleWindow(true);
            } else if (button === MOUSE_BUTTON_FORWARD) {
                return this.volumeUp();
            } else if (button === MOUSE_BUTTON_BACK) {
                return this.volumeDown();
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._controls.pushSignal(this._controls, 'button-release-event', (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                return this.playPauseStop();
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._playerItem.pushSignal(this._playerItem.closeButton, 'clicked', () => {
            if (this._mpris) {
                this._mpris.quit();
            }
        });

        this._controls.pushSignal(this._controls.shuffleButton, 'clicked', () => {
            this.toggleShuffle();
        });

        this._controls.pushSignal(this._controls.prevButton, 'clicked', () => {
            this.previous();
        });

        this._controls.pushSignal(this._controls.playPauseButton, 'clicked', () => {
            if (this._mpris) {
                this._mpris.playPause();
            }
        });

        this._controls.pushSignal(this._controls.stopButton, 'clicked', () => {
            if (this._mpris) {
                this._mpris.stop();
            }
        });

        this._controls.pushSignal(this._controls.nextButton, 'clicked', () => {
             this.next();
        });

        this._controls.pushSignal(this._controls.repeatButton, 'clicked', () => {
            this.cycleRepeat();
        });

        let destroyId = this.connect('destroy', () => {
            this.disconnect(destroyId);
            if (this._mpris) {
                this._mpris.destroy();
                this._mpris = null;
            }
        });

        this.setProxies(mpris, trackList, playList, updateIndicator);
    }

    get playerName() {
        return this._mpris ? this._mpris.player_name : '';
    }

    get busName() {
        return this._mpris ? this._mpris.busName : '';
    }

    get artist() {
        return this._mpris ? this._mpris.artist : '';
    }

    get trackTitle() {
        return this._mpris ? this._mpris.title : '';
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

    setOrnament(ornament) {
        this._playerItem.setOrnament(ornament);
    }

    volumeUp() {
        if (this._mpris && this._mpris.volumeUp()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    volumeDown() {
        if (this._mpris && this._mpris.volumeDown()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    toggleShuffle() {
        if (this._mpris && this._mpris.toggleShuffle()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    cycleRepeat() {
        if (this._mpris && this._mpris.cycleRepeat()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    playPauseStop() {
        if (this._mpris && this._mpris.playPauseStop()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    previous() {
        if (this._mpris && this._mpris.previous()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    next() {
        if (this._mpris && this._mpris.next()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    toggleWindow(minimize) {
        if (this._mpris && this._mpris.toggleWindow(minimize)) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    toggleMute() {
        if (this._mpris && this._volume.toggleMute()) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    refreshIcon() {
        if (this._mpris) {
            this._mpris.refreshIcon();
        }
    }

    setProxies(mpris, trackList, playList, updateIndicator) {
        if (this._mpris) {
            this._mpris.destroy();
        }

        mpris.bind_property(
            'obj-id',
            trackList,
            'current-obj-id',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );
        mpris.bind_property(
            'player-name',
            trackList,
            'player-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );
        mpris.bind_property(
            'player-name',
            playList,
            'player-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris = mpris;

        this._mpris.pushSignal(this._mpris, 'update-indicator', updateIndicator);

        this._volume.setProxy(mpris);
        this._playListSubMenu.setProxy(playList);
        this._trackListSubMenu.setProxy(trackList);

        this._mpris.bind_property(
            'visible',
            this.actor,
            'visible',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'accessible-name',
            this._playerItem,
            'accessible-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'player-name',
            this._controls,
            'player-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'cover-url',
            this._playerItem.coverIcon,
            'cover-url',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'gicon',
            this._playerItem.coverIcon,
            'fallback-gicon',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'show-stop',
            this._controls.stopButton,
            'visible',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'prev-reactive',
            this._controls.prevButton,
            'reactive',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'playpause-reactive',
            this._controls.playPauseButton,
            'reactive',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'playpause-icon-name',
            this._controls.playPauseButton,
            'icon-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'next-reactive',
            this._controls.nextButton,
            'reactive',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'repeat-reactive',
            this._controls.repeatButton,
            'reactive',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'show-shuffle-repeat',
            this._controls.repeatButton,
            'visible',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'repeat-active',
            this._controls.repeatButton,
            'active',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'repeat-icon-name',
            this._controls.repeatButton,
            'icon-name',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'show-shuffle-repeat',
            this._controls.shuffleButton,
            'visible',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'shuffle-reactive',
            this._controls.shuffleButton,
            'reactive',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'shuffle-active',
            this._controls.shuffleButton,
            'active',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'artist',
            this._playerItem.info.artistLabel,
            'text',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this._mpris.bind_property(
            'title',
            this._playerItem.info.titleLabel,
            'text',
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );
    }

    _onKeyPressEvent(actor, event) {
        let symbol = event.get_key_symbol();
        let ctrl = event.has_control_modifier();
        let shift = event.has_shift_modifier();
        if (ctrl) {
            if (symbol === Clutter.KEY_space) {
                return this.playPauseStop();
            } else if (symbol === Clutter.Left) {
                return this.previous();
            } else if (symbol === Clutter.Right) {
                return this.next();
            } else if (symbol === Clutter.Up) {
                return this.volumeUp();
            } else if (symbol === Clutter.Down) {
                return this.volumeDown();
            } else if (symbol === Clutter.Return) {
                return this.toggleMute();
            }
        } else if (shift) {
            if (symbol === Clutter.Left) {
                return this.toggleShuffle();
            } else if (symbol === Clutter.Right) {
                return this.cycleRepeat();
            } else if (symbol === Clutter.Return) {
                return this.toggleWindow(true);
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onScrollEvent(actor, event) {
        let scrollDirection = event.get_scroll_direction();
        if (scrollDirection === Clutter.ScrollDirection.UP) {
            return this.previous();
        } else if (scrollDirection === Clutter.ScrollDirection.DOWN) {
            return this.next();
        } else if (scrollDirection === Clutter.ScrollDirection.LEFT) {
            return this.volumeDown();
        } else if (scrollDirection === Clutter.ScrollDirection.RIGHT) {
            return this.volumeUp();
        }
        return Clutter.EVENT_PROPAGATE;
    }
}

var MprisIndicatorButton = GObject.registerClass({
    GTypeName: 'MprisIndicatorButton',
    Signals: {
        'update-tooltip': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING,  // artist
                GObject.TYPE_STRING,  // title
                GObject.TYPE_BOOLEAN, // focused
                GObject.TYPE_INT      // playbackStatus
            ]
        }
    }
}, class MprisIndicatorButton extends Button {
    _init() {
        super._init(0.5, 'Mpris Indicator Button');
        this.accessible_name = 'Mpris';
        this.menu.actor.add_style_class_name('aggregate-menu');
        this.menu.box.set_layout_manager(new AggregateLayout());

        this.hide();

        let indicator = new St.Icon({
            style_class: 'system-status-icon'
        });

        indicator.add_effect(new Clutter.DesaturateEffect());

        this.add_child(indicator);

        let signals = [];

        let pushSignal = (obj, signalName, callback) => {
            let signalId = obj.connect(signalName, callback);
            signals.push({
                obj: obj,
                signalId: signalId
            });
        };

        let getPlayers = () => this.menu._getMenuItems().filter(i => i instanceof Player && i.actor.visible);

        let getLastActivePlayer = (players) => {
            players = players || getPlayers();
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
                        : players.indexOf(b) - players.indexOf(a);
                })[0]
                : null;
        };

        let updateIndicator = () => {
            let players = getPlayers();
            let numOfPlayers = players.length;
            let activePlayer = getLastActivePlayer(players);
            if (activePlayer) {
                this.emit(
                    'update-tooltip',
                    activePlayer.artist,
                    activePlayer.trackTitle,
                    activePlayer.focused,
                    activePlayer.playbackStatus
                );
            }
            players.forEach(player => {
                if (player === activePlayer && numOfPlayers > 1) {
                    player.setOrnament(Ornament.DOT);
                } else {
                    player.setOrnament(Ornament.NONE);
                }
            });
            indicator.gicon = activePlayer ? activePlayer.gicon : null;
            let visible = indicator.gicon ? true : false;
            if (this.menu.isOpen) {
                if (visible) {
                    this.menu._getMenuItems().filter(i => i instanceof PopupSeparatorMenuItem).forEach(sep => {
                        this.menu._updateSeparatorVisibility(sep);
                    });
                } else {
                    this.menu.toggle();
                }
            }
            this.visible = visible;
        };

        pushSignal(St.TextureCache.get_default(), 'icon-theme-changed', () => {
            this.menu._getMenuItems().filter(i => i instanceof Player).forEach(p => p.refreshIcon());
        });

        pushSignal(this, 'key-press-event', (actor, event) => {
            let ctrl = event.has_control_modifier();
            let shift = event.has_shift_modifier();
            let player = getLastActivePlayer();
            if ((ctrl || shift) && player) {
                let symbol = event.get_key_symbol();
                if (ctrl) {
                    if (symbol === Clutter.KEY_space) {
                        return player.playPauseStop();
                    } else if (symbol === Clutter.Left) {
                        return player.previous();
                    } else if (symbol === Clutter.Right) {
                        return player.next();
                    } else if (symbol === Clutter.Up) {
                        return player.volumeUp();
                    } else if (symbol === Clutter.Down) {
                        return player.volumeDown();
                    } else if (symbol === Clutter.Return) {
                        return player.toggleMute();
                    }
                } else if (shift) {
                     if (symbol === Clutter.Left) {
                        return player.toggleShuffle();
                    } else if (symbol === Clutter.Right) {
                        return player.cycleRepeat();
                    } else if (symbol === Clutter.Return) {
                        return player.toggleWindow(true);
                    }
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        pushSignal(this, 'button-press-event', (actor, event) => {
            let player = getLastActivePlayer();
            if (player) {
                let button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    this.menu.toggle();
                    return Clutter.EVENT_STOP;
                } else if (button === Clutter.BUTTON_MIDDLE) {
                    return player.playPauseStop();
                } else if (button === Clutter.BUTTON_SECONDARY) {
                    return player.toggleWindow(true);
                } else if (button === MOUSE_BUTTON_FORWARD) {
                    return player.volumeUp();
                } else if (button === MOUSE_BUTTON_BACK) {
                    return player.volumeDown();
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        pushSignal(this, 'touch-event', (actor, event) => {
            if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                this.menu.toggle();
            }
            return Clutter.EVENT_PROPAGATE;
        });

        pushSignal(this, 'scroll-event', (actor, event) => {
            let player = getLastActivePlayer();
            if (player) {
                let scrollDirection = event.get_scroll_direction();
                if (scrollDirection === Clutter.ScrollDirection.UP) {
                    return player.previous();
                } else if (scrollDirection === Clutter.ScrollDirection.DOWN) {
                    return player.next();
                } else if (scrollDirection === Clutter.ScrollDirection.LEFT) {
                    return player.volumeDown();
                } else if (scrollDirection === Clutter.ScrollDirection.RIGHT) {
                    return player.volumeUp();
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        let proxyHandler = new DBusProxyHandler();

        pushSignal(proxyHandler, 'add-player', (proxyHandler, busName, mpris, trackList, playList) => {
            let player = getPlayers().find(p => p.busName === busName);
            if (player) {
                player.setProxies(mpris, trackList, playList, updateIndicator);
            } else {
                if (!this.menu.isEmpty()) {
                    let sep = new PopupSeparatorMenuItem();
                    sep.busName = busName;
                    this.menu.addMenuItem(sep);
                }
                this.menu.addMenuItem(new Player(mpris, trackList, playList, updateIndicator));
            }
            updateIndicator();
        });

        pushSignal(proxyHandler, 'remove-player', (proxyHandler, busName) => {
            this.menu._getMenuItems().forEach(i => {
                if (i.busName === busName) {
                    i.destroy();
                } else if (this.menu.isOpen && i instanceof PopupSeparatorMenuItem) {
                    this.menu._updateSeparatorVisibility(i);
                }
            });
            updateIndicator();
        });

        let toolTip = new ToolTip(this);

        pushSignal(this, 'destroy', () => {
            signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            CoverArtIOHandler.destroy();
            proxyHandler.destroy();
        });
    }

    vfunc_event(event) {
        return Clutter.EVENT_PROPAGATE;
    }
});
