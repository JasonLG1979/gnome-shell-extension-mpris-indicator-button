/*
 * Mpris Indicator Button extension for Gnome Shell 3.34+
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

// No translatable strings in this file.
const { Gio, GLib, GObject, Gtk, Meta, Shell } = imports.gi;

const { activateWindow } = imports.ui.main;

const UUID = imports.misc.extensionUtils.getCurrentExtension().metadata.uuid;
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
// See https://specifications.freedesktop.org/mpris-spec/latest/Player_Interface.html#Simple-Type:Track_Id
const NO_TRACK_PATH = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
const FORBIDDEN_OBJ_ID_PREFIX = '/org/mpris';
const METADATA_KEYS = [
    'xesam:artist',
    'xesam:albumArtist',
    'xesam:composer',
    'xesam:lyricist',
    'rhythmbox:streamTitle',
    'xesam:title',
    'xesam:trackNumber',
    'xesam:album',
    'xesam:discNumber',
    'mpris:artUrl',
    'mpris:trackid',
    'xesam:url'
];

const Node = Gio.DBusNodeInfo.new_for_xml(
`<node>
<interface name='org.freedesktop.DBus'>
  <method name='GetConnectionUnixProcessID'>
    <arg type='s' direction='in' />
    <arg type='u' direction='out' />
  </method>
  <method name='ListNames'>
    <arg type='as' direction='out' />
  </method>
  <signal name='NameOwnerChanged'>
    <arg type='s' direction='out' />
    <arg type='s' direction='out' />
    <arg type='s' direction='out' />
  </signal>
</interface>
<interface name='org.mpris.MediaPlayer2'>
  <method name='Raise' />
  <method name='Quit' />
  <property name='CanQuit' type='b' access='read' />
  <property name='CanRaise' type='b' access='read' />
  <property name='Identity' type='s' access='read' />
  <property name='DesktopEntry' type='s' access='read' />
</interface>
<interface name='org.mpris.MediaPlayer2.Player'>
  <method name='PlayPause' />
  <method name='Next' />
  <method name='Previous' />
  <method name='Stop' />
  <method name='Play' />
  <property name='CanControl' type='b' access='read' />
  <property name='CanGoNext' type='b' access='read' />
  <property name='CanGoPrevious' type='b' access='read' />
  <property name='CanPlay' type='b' access='read' />
  <property name='CanPause' type='b' access='read' />
  <property name='Metadata' type='a{sv}' access='read' />
  <property name='PlaybackStatus' type='s' access='read' />
  <property name='Shuffle' type='b' access='readwrite' />
  <property name='LoopStatus' type='s' access='readwrite' />
  <property name='Volume' type='d' access='readwrite' />
</interface>
<interface name='org.mpris.MediaPlayer2.TrackList'>
  <method name='GetTracksMetadata'>
    <arg type='ao' direction='in' />
    <arg type='aa{sv}' direction='out' />
  </method>
  <method name='GoTo'>
  <arg type='o' direction='in' />
  </method>
  <property name='Tracks' type='ao' access='read' />
  <signal name='TrackListReplaced'>
    <arg type='ao' direction='out' />
    <arg type='o' direction='out' />
  </signal>
  <signal name='TrackAdded'>
    <arg type='a{sv}' direction='out' />
    <arg type='o' direction='out' />
  </signal>
  <signal name='TrackRemoved'>
    <arg type='o' direction='out' />
  </signal>
  <signal name='TrackMetadataChanged'>
    <arg type='o' direction='out' />
    <arg type='a{sv}' direction='out' />
  </signal>
</interface>
<interface name='org.mpris.MediaPlayer2.Playlists'>
  <method name='ActivatePlaylist'>
    <arg type='o' direction='in' />
  </method>
  <method name='GetPlaylists'>
    <arg type='u' direction='in' />
    <arg type='u' direction='in' />
    <arg type='s' direction='in' />
    <arg type='b' direction='in' />
    <arg type='a(oss)' direction='out' />
  </method>
  <property name='PlaylistCount' type='u' access='read' />
  <property name='Orderings' type='as' access='read' />
  <property name='ActivePlaylist' type='(b(oss))' access='read' />
  <signal name='PlaylistChanged'>
    <arg type='(oss)' direction='out' />
  </signal>
</interface>
</node>`);

function makeProxy(ifaceName, busName, objectPath, flags, asyncCallback) {
    let cancellable = null;
    let error = null;
    let proxy = null;
    let iface = Node.interfaces.find(iface => iface.name === ifaceName);
    if (iface) {
        flags = flags !== null
            ? Gio.DBusProxyFlags.DO_NOT_AUTO_START | flags
            : Gio.DBusProxyFlags.DO_NOT_AUTO_START;
        cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new(
            Gio.DBus.session,
            flags,
            iface,
            busName,
            objectPath,
            ifaceName,
            cancellable,
            (source, result) => {
                try {
                    proxy = Gio.DBusProxy.new_finish(result);
                } catch(e) {
                    proxy = null;
                    error = e;
                } finally {
                    if (proxy) {
                        if (proxy.g_name_owner) {
                            asyncCallback(proxy, null);
                        } else {
                            error = Gio.DBusError.new_for_dbus_error(
                                ' No Name Owner',
                                `${busName} has no owner.`
                            );
                            asyncCallback(null, error);
                        }
                    } else {
                        if (!error) {
                            // Should never really happen.
                            error = Gio.DBusError.new_for_dbus_error(
                                ' Unknow Error',
                                busName
                            );
                        }
                        asyncCallback(null, error);
                    }
                }
            }
        );
    }
    return cancellable;
}

function makeDBusProxy(asyncCallback) {
    return makeProxy(
        'org.freedesktop.DBus',
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
        asyncCallback
    );
}

function makeMprisProxy(busName, asyncCallback) {
    return makeProxy(
        'org.mpris.MediaPlayer2',
        busName,
        '/org/mpris/MediaPlayer2',
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        asyncCallback
    );
}

function makePlayerProxy(busName, asyncCallback) {
    return makeProxy(
        'org.mpris.MediaPlayer2.Player',
        busName,
        '/org/mpris/MediaPlayer2',
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        asyncCallback
    );
}

function makeTrackListProxy(busName, asyncCallback) {
    return makeProxy(
        'org.mpris.MediaPlayer2.TrackList',
        busName,
        '/org/mpris/MediaPlayer2',
        null,
        asyncCallback
    );
}

function makePlayListProxy(busName, asyncCallback) {
    return makeProxy(
        'org.mpris.MediaPlayer2.Playlists',
        busName,
        '/org/mpris/MediaPlayer2',
        Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        asyncCallback
    );
}

function makeMprisPoxies(busName, asyncCallback) {
    let mpris, player, tracklist, playlist;
    let onProxyReady = (proxy, error) => {
        if (error && cancellables) {
            cancellables.forEach(cancellable => {
                if (!cancellable.is_cancelled()) {
                    cancellable.cancel();
                }
                cancellable.run_dispose();
            });
            cancellables = null;
            [mpris, player, tracklist, playlist].forEach(proxy => {
                if (proxy) {
                    proxy.run_dispose();
                }
            });
            mpris = player = tracklist = playlist = null;
            asyncCallback(error, mpris, player, tracklist, playlist);
        } else if (proxy) {
            if (proxy.g_interface_name === 'org.mpris.MediaPlayer2') {
                mpris = proxy;
            }
            if (proxy.g_interface_name === 'org.mpris.MediaPlayer2.Player') {
                player = proxy;
            }
            if (proxy.g_interface_name === 'org.mpris.MediaPlayer2.TrackList') {
                tracklist = proxy;
            }
            if (proxy.g_interface_name === 'org.mpris.MediaPlayer2.Playlists') {
                playlist = proxy;
            }
            if (mpris && player && tracklist && playlist) {
                cancellables.forEach(cancellable => {
                    cancellable.run_dispose();
                });
                cancellables = null;
                asyncCallback(null, mpris, player, tracklist, playlist);
            }
        }
    };
    let cancellables = [
        makeMprisProxy(busName, onProxyReady),
        makePlayerProxy(busName, onProxyReady),
        makeTrackListProxy(busName, onProxyReady),
        makePlayListProxy(busName, onProxyReady)
    ];
}

function parseMetadata(metadata, playerName) {
    metadata = metadata || {};
    playerName = playerName || '';
    let mimetype_icon = 'audio-x-generic-symbolic';
    let obj_id = NO_TRACK_PATH;
    let cover_url = '';
    let artist = playerName;
    let title = '';

    if (Object.keys(metadata).length) {
        // Unpack all Metadata keys that we care about in place.
        // If the key doesn't exsist set it to an empty string and join all arrays.
        // Most of our 'artist' keys are (or at least should be) arrays of strings.
        METADATA_KEYS.forEach(key => {
            let value = metadata[key] ? metadata[key].deep_unpack() : '';
            metadata[key] = Array.isArray(value) ? value.join(', ') : value;
        });

        cover_url = metadata['mpris:artUrl'];
        obj_id = metadata['mpris:trackid'] || NO_TRACK_PATH;

        let trackUrl = metadata['xesam:url'];

        // Spotify videos and ads don't follow MPRIS metadata spec.
        // This more or less matches what Spotify shows in it's UI.
        if (playerName === 'Spotify' && !trackUrl.includes('/track/')) {
            mimetype_icon = (!trackUrl || trackUrl.includes('/episode/')) ? 'video-x-generic-symbolic' : 'audio-x-generic-symbolic';
            if (!metadata['xesam:artist']) {
                let delimiter = metadata['xesam:title'].includes(' - ') ? ' - ' : ': ';
                let artist_title = metadata['xesam:title'].split(delimiter);
                if (artist_title.length > 1) {
                    artist = artist_title.shift().trim() || playerName;
                    title = artist_title.join(delimiter).trim();
                } else {
                    delimiter = metadata['xesam:album'].includes(' - ') ? ' - ' : ': ';
                    artist = metadata['xesam:album'].split(delimiter)[0].trim() || playerName;
                    title = metadata['xesam:title'];
                }
            } else {
                artist = metadata['xesam:artist'];
                title = metadata['xesam:title'];
            }
        } else {
            // There are better ways to sniff the mimetype of the track
            // but they involve doing I/O on the url which isn't worth it.
            // This is good enough and works just fine most of the time.
            // If all else fails fallback to 'audio-x-generic-symbolic'
            if (trackUrl) {
                let fileExt = `.${trackUrl.split(/\#|\?/)[0].split('.').pop().trim()}`;
                let [mimetype, uncertain] = Gio.content_type_guess(fileExt, null);

                mimetype_icon = (!uncertain && Gio.content_type_is_a(mimetype, 'video/*'))
                    ? 'video-x-generic-symbolic'
                    : 'audio-x-generic-symbolic';
            }

            // Be rather exhaustive and liberal as far as what constitutes an 'artist'.
            // If all else fails fallback to the Player's name.
            artist = metadata['xesam:artist'] ? metadata['xesam:artist']
                : metadata['xesam:albumArtist'] ? metadata['xesam:albumArtist']
                : metadata['xesam:composer'] ? metadata['xesam:composer']
                : metadata['xesam:lyricist'] ? metadata['xesam:lyricist']
                : metadata['rhythmbox:streamTitle'] ? metadata['rhythmbox:streamTitle']
                : playerName;

            // Prefer the track title, but in it's absence if the
            // track number and album title are available use them.
            // For example, '5 - My favorite Album'.
            // If the disc number is more than 1 also add the disc number.
            // for example, '5 - My favorite Album (2)'.
            // If all else fails fallback to an empty string.
            title = metadata['xesam:title'] ? metadata['xesam:title']
                : (Number.isInteger(metadata['xesam:trackNumber'])
                    && Number.isInteger(metadata['xesam:discNumber'])
                    && metadata['xesam:discNumber'] > 1
                    && metadata['xesam:album'])
                ? `${metadata['xesam:trackNumber']} - ${metadata['xesam:album']} (${metadata['xesam:discNumber']})`
                : (Number.isInteger(metadata['xesam:trackNumber'])
                    && metadata['xesam:album'])
                ? `${metadata['xesam:trackNumber']} - ${metadata['xesam:album']}`
                : '';
       }
    }

    return [obj_id, cover_url, artist, title, mimetype_icon];
}

function logMyError(error) {
    // Cancelling counts as an error don't spam the logs.
    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        logError(error, `Extension ${UUID}`);
    }
}

var DBusProxyHandler = GObject.registerClass({
    GTypeName: 'DBusProxyHandler',
    Signals: {
        'add-player': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING, // busName
                GObject.TYPE_OBJECT, // MprisProxyHandler
                GObject.TYPE_OBJECT, // TrackListProxyHandler
                GObject.TYPE_OBJECT  // PlayListProxyHandler
            ]
        },
        'remove-player': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING // busName
            ]
        }
    }
}, class DBusProxyHandler extends GObject.Object {
    _init() {
        super._init();
        this._proxy = null;
        this._nameOwnerId = null;
        this._cancellable = makeDBusProxy(this._onProxyReady.bind(this));
    }

    _onProxyReady(proxy, error) {
        this._cancellable.run_dispose();
        if (proxy) {
            this._proxy = proxy;

            this._proxy.ListNamesRemote(([n]) => {
                let players = n.filter(n => n.startsWith(MPRIS_PREFIX));
                players.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(p => this._addPlayer(p));
            });
            this._nameOwnerId = this._proxy.connectSignal('NameOwnerChanged', (...[,,[busName, oldOwner, newOwner]]) => {
                if (busName.startsWith(MPRIS_PREFIX)) {
                    if (newOwner) {
                        this._addPlayer(busName);
                    } else {
                        this.emit('remove-player', busName);
                    }
                }
            });
        } else {
            logMyError(error);
        }
        this._cancellable = null;
    }

    _addPlayer(busName) {
        this._proxy.GetConnectionUnixProcessIDRemote(busName, ([pid]) => {
            makeMprisPoxies(busName, (error, mpris, player, tracklist, playlist) => {
                if (error) {
                    logMyError(error);
                    if (this._proxy) {
                        this.emit('remove-player', busName);
                    }
                } else if (this._proxy) {
                    mpris = new MprisProxyHandler(pid, mpris, player);
                    tracklist = new TrackListProxyHandler(tracklist);
                    playlist = new PlayListProxyHandler(playlist);
                    this.emit('add-player', busName, mpris, tracklist, playlist);
                }
            });
        });
    }

    destroy() {
        if (this._cancellable) {
            if (!this._cancellable.is_cancelled()) {
                this._cancellable.cancel();
            }
            this._cancellable.run_dispose();
        }
        if (this._proxy) {
            if (this._nameOwnerId) {
                this._proxy.disconnectSignal(this._nameOwnerId);
            }
            this._proxy.run_dispose();
        }
        this._proxy = null;
        this._nameOwnerId = null
        this._cancellable = null;
        super.run_dispose();
    }
});

// Things get a little weird when there are more
// than one instance of a player running at the same time.
// As far as ShellApp is concerned they are the same app.
// So we have to jump though a bunch of hoops to keep track
// of and differentiate the instance metaWindows by pid or
// gtk_unique_bus_name/nameOwner.
const AppWrapper = GObject.registerClass({
    GTypeName: 'AppWrapper',
    Properties: {
        'focused': GObject.ParamSpec.boolean(
            'focused',
            'focused-prop',
            'If the instance of the app is focused',
            GObject.ParamFlags.READABLE,
            false
        )
    }
}, class AppWrapper extends GObject.Object {
    _init(shellApp, busName, pid, nameOwner) {
        super._init();
        this._app = shellApp;
        this._pid = pid;
        this._appName = this._app.get_name();
        this._appId = this._app.id.split('/').pop().replace('.desktop', '');
        this._instanceNum = this._getNumbersFromTheEndOf(busName);
        this._nameOwner = nameOwner;
        this._focused = false;
        this._user_time = 0;
        this._userActivated = false;
        this._metaWindow = null;
        this._appearsFocusedId = null;
        this._unmanagedId = null;
        this._metaWindowsChangedId = this._app.connect(
            'windows-changed',
            this._onWindowsChanged.bind(this)
        );
        this._onWindowsChanged();
    }

    get focused() {
        return this._focused || false;
    }

    get id() {
        return this._appId || '';
    }

    get name() {
        return this._appName || '';
    }

    get user_time() {
        return this._user_time || 0;
    }

    get can_quit() {
        return this._metaWindow ? true : false;
    }

    get gicon() {
        // Much prefer a Gio.FileIcon or Gio.ThemedIcon to the St.Icon
        // you'd get from Shell.App.create_icon_texture().
        // This also doesn't fail silently and return the wrong icon...
        let app_info = this._app.get_app_info();
        return app_info ? app_info.get_icon() : null;
    }

    request_quit() {
        this._app.request_quit();
    }

    toggleWindow(minimize) {
        if (!this._focused) {
            // Go ahead and skip the whole 'Player is Ready'
            // notification, after all the user wants the player focused,
            // that's why they clicked on it...
            if (this._metaWindow) {
                activateWindow(this._metaWindow);
                return true;
            } else {
                if (!this._app.is_window_backed() && !this._app.get_busy()) {
                    this._userActivated = true;
                    this._app.activate();
                    return true;
                } else {
                    return false;
                }
            }
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
        this._onUnmanaged();
        this._metaWindowsChangedId = null;
        this._app = null;
        this._pid = null;
        this._appId = null;
        this._appName = null;
        this._focused = null;
        this._user_time = null;
        this._userActivated = null;
        super.run_dispose();
    }

    _getNumbersFromTheEndOf(someString) {
        let matches = someString.match(/[0-9]+$/);
        return matches ? parseInt(matches[0], 10) : null;
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
        let metaWindow = metaWindows.find(w => {
            // Check for multiple instances.
            if (this._instanceNum && w.gtk_window_object_path) {
                // Match multiple instance(multiple window really) GApplications to their windows.
                // Works rather well if a GApplication's MPRIS instance number matches
                // it's corresponding window object path like the latest git master of GNOME-MPV.
                // For example org.mpris.MediaPlayer2.GnomeMpv.instance-1 = /io/github/GnomeMpv/window/1.
                let windowNum = this._getNumbersFromTheEndOf(w.gtk_window_object_path);
                if (this._instanceNum === windowNum) {
                    return true;
                }
            } else if (w.gtk_unique_bus_name) {
                // This will match single instance GApplications to their window.
                // Generally the window and MPRIS interface will have the
                // same name owner.
                if (w.gtk_unique_bus_name === this._nameOwner) {
                    return true;
                }
            // Match true multiple instances players by their pids.
            // works rather well for apps like VLC for example.
            } else if (w.get_pid() === this._pid) {
                return true;
            }
            return false;
        });
        return metaWindow ? metaWindow : metaWindows.length ? metaWindows[0] : null;
    }

    _grabAppMetaWindow(appMetaWindow) {
        // Connect our metaWindow signals
        // and check the new window's focus.
        if (appMetaWindow) {
            this._onUnmanaged();
            this._metaWindow = appMetaWindow;
            this._appearsFocusedId = this._metaWindow.connect(
               'notify::appears-focused',
                this._onAppearsFocused.bind(this)
            );
            this._unmanagedId = this._metaWindow.connect(
                'unmanaged',
                this._onUnmanaged.bind(this)
            );
            this._onAppearsFocused();

            if (!this._focused && this._userActivated) {
                activateWindow(this._metaWindow);
            }
        }
    }

    _onWindowsChanged() {
        // We get this signal when metaWindows show up
        // Really only useful when a player 'unhides'
        // or at _init
        let appMetaWindow = this._getNewAppMetaWindow();
        if (appMetaWindow) {
            while (appMetaWindow.get_transient_for()) {
                appMetaWindow = appMetaWindow.get_transient_for();
            }
        }
        if (this._metaWindow !== appMetaWindow) {
            this._grabAppMetaWindow(appMetaWindow);
        }
        this._userActivated = false;
    }

    _onAppearsFocused() {
        // Pretty self explanatory...
        let focused = this._metaWindow && this._metaWindow.has_focus();
        if (this._focused != focused) {
            this._user_time = GLib.get_monotonic_time();
            this._focused = focused;
            this.notify('focused');
        }
    }

    _onUnmanaged() {
        // 'unmanaged' metaWindows are either hidden and/or
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

const TrackListProxyHandler = GObject.registerClass({
    GTypeName: 'TrackListProxyHandler',
    Signals: {
        'new-metadata': {
            flags: GObject.SignalFlags.RUN_FIRST
        },
        'metadata-changed': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING, // old_obj_id
                GObject.TYPE_STRING, // obj_id
                GObject.TYPE_STRING, // cover_url
                GObject.TYPE_STRING, // artist
                GObject.TYPE_STRING, // title
                GObject.TYPE_STRING  // mimetype_icon
            ]
        }
    },
    Properties: {
        'player-name': GObject.ParamSpec.string(
            'player-name',
            'player-name-prop',
            'The player\'s name',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'current-obj-id': GObject.ParamSpec.string(
            'current-obj-id',
            'current-obj-id-prop',
            'The current track\'s trackId',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'list-title': GObject.ParamSpec.string(
            'list-title',
            'list-title-prop',
            'The title of the corresponding list',
            GObject.ParamFlags.READABLE,
            'TrackList'
        ),
        'show-list': GObject.ParamSpec.boolean(
            'show-list',
            'show-list-prop',
            'If the track list should be shown',
            GObject.ParamFlags.READABLE,
            false
        )
    }
}, class TrackListProxyHandler extends GObject.Object {
    _init(proxy) {
        super._init();
        this._proxy = proxy;
        this._signals = [];
        this._current_obj_id = '';
        this._show_list = false;
        this._list_title = 'TrackList';
        this._trackIds = [];
        this._metadata = [];
        this._player_name = '';
        this._finish_init();
    }

    get ifaceName() {
        return this._proxy ? this._proxy.g_interface_name : '';
    }

    get busName() {
        return this._proxy ? this._proxy.g_name : '';
    }

    get show_list() {
        return this._show_list || false;
    }

    get list_title() {
        return this._list_title || 'TrackList';
    }

    get player_name() {
        return this._player_name || '';
    }

    set player_name(player_name) {
        this._player_name = player_name;
        this.notify('player-name');
    }

    get current_obj_id() {
        return this._current_obj_id || '';
    }

    set current_obj_id(current_obj_id) {
        this._current_obj_id = current_obj_id;
        this.notify('current-obj-id');
    }

    get metadata() {
        return this._metadata ? this._metadata : [];
    }

    goTo(trackId) {
        if (this._proxy && this._trackListIncludes(trackId)) {
            this._proxy.GoToRemote(trackId);
        }
    }

    refresh() {
        if (this._proxy && Array.isArray(this._trackIds) && this._trackIds.length) {
            this._replaceTracklist(this._trackIds);
        }
    }

    _syncTrackListProps() {
        let show_list = Array.isArray(this._trackIds) && this._trackIds.length ? true : false;
        if (this._show_list !== show_list) {
            this._show_list = show_list;
            this.notify('show-list');
        }
        if (this._show_list) {
            this.notify('current-obj-id');
        }
    }

    _getTrackId(metadata) {
        metadata = metadata || {};
        return metadata['mpris:trackid'] ? (metadata['mpris:trackid'].deep_unpack() || NO_TRACK_PATH) : NO_TRACK_PATH;
    }

    _trackListIncludes(trackId) {
        return Array.isArray(this._trackIds) && this._goodTrackListId(trackId) && this._trackIds.includes(trackId);
    }

    _goodTrackListId(trackId) {
        return trackId && !trackId.startsWith(FORBIDDEN_OBJ_ID_PREFIX);
    }

    _cleanTrackIds(trackIds) {
        trackIds = trackIds && Array.isArray(trackIds) ? trackIds : [];
        return trackIds.filter((id, i, a) => this._goodTrackListId(id) && a.indexOf(id) === i);
    }

    _cleanMetadata(metadata) {
        metadata = metadata && Array.isArray(metadata) ? metadata : [];
        return metadata.map(m => parseMetadata(m, this._player_name)).filter((m, i, a) => {
            return this._goodTrackListId(m[0]) && a.findIndex(m2 => m2[0] === m[0]) === i;
        });
    }

    _arraysOfEqualLenght(...arrays) {
        return new Set(arrays.map(array => array.length)).size === 1;
    }

    _replaceTracklist(trackIds) {
        trackIds = this._cleanTrackIds(trackIds);
        this._trackIds = [];
        this._metadata = [];
        if (trackIds.length) {
            this._proxy.GetTracksMetadataRemote(trackIds, ([trackListMetaData]) => {
                let cleanMetadata = this._cleanMetadata(trackListMetaData);
                if (this._arraysOfEqualLenght(trackIds, trackListMetaData, cleanMetadata)) {
                    this._trackIds = cleanMetadata.map(m => m[0]);
                    this._metadata = cleanMetadata;
                    this.emit('new-metadata');
                }
                this._syncTrackListProps();
            });
        } else {
            this._syncTrackListProps();
        }
    }

    _finish_init() {
        this._trackIds = this._cleanTrackIds(this._proxy.Tracks);
        this.pushSignal('TrackListReplaced', (...[,,[trackIds]]) => {
            this._replaceTracklist(trackIds);
        });
        this.pushSignal('TrackAdded', (...[,,[metadata, afterTrackId]]) => {
            let newTrackId = this._getTrackId(metadata);
            if (this._goodTrackListId(newTrackId) && !this._trackListIncludes(newTrackId)) {
                if (afterTrackId) {
                    if (afterTrackId === NO_TRACK_PATH) {
                        this._trackIds.unshift(newTrackId);
                    } else if (this._trackListIncludes(afterTrackId)) {
                        this._trackIds.splice(this._trackIds.indexOf(afterTrackId) + 1, 0, newTrackId);
                    }
                    this._replaceTracklist(this._trackIds);
                }
            }
        });
        this.pushSignal('TrackRemoved', (...[,,[trackId]]) => {
            if (this._trackListIncludes(trackId)) {
                this._trackIds.splice(this._trackIds.indexOf(trackId), 1);
                this._replaceTracklist(this._trackIds);
            }
        });
        this.pushSignal('TrackMetadataChanged', (...[,,[oldtrackId, metadata]]) => {
            if (this._trackListIncludes(oldtrackId)) {
                let [newTrackId, cover_url, artist, title, mimetype_icon] = parseMetadata(metadata, this._player_name);
                if (this._goodTrackListId(newTrackId)) {
                    let index = this._trackIds.indexOf(oldtrackId);
                    this._metadata[index] = [newTrackId, cover_url, artist, title, mimetype_icon];
                    this._trackIds[index] = newTrackId;
                    this.emit(
                        'metadata-changed',
                        oldtrackId,
                        newTrackId,
                        cover_url,
                        artist,
                        title,
                        mimetype_icon
                    );
                    this._syncTrackListProps();
                }
            }
        });
    }

    pushSignal(signalName, callback) {
        this._signals.push(this._proxy.connectSignal(signalName, callback));
    }

    destroy() {
        if (this._proxy) {
            this._signals.forEach(id => this._proxy.disconnectSignal(id));
            this._proxy.run_dispose();
        }
        this._signals = null;
        this._proxy = null;
        this._current_obj_id = null;
        this._show_list = null;
        this._list_title = null;
        this._trackIds = null;
        this._metadata = null;
        this._player_name = null;
        super.run_dispose();
    }
});

const PlayListProxyHandler = GObject.registerClass({
    GTypeName: 'PlayListProxyHandler',
    Signals: {
        'new-metadata': {
            flags: GObject.SignalFlags.RUN_FIRST
        },
        'metadata-changed': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING, // obj_id
                GObject.TYPE_STRING, // obj_id
                GObject.TYPE_STRING  // title
            ]
        }
    },
    Properties: {
        'player-name': GObject.ParamSpec.string(
            'player-name',
            'player-name-prop',
            'The player\'s name',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'current-obj-id': GObject.ParamSpec.string(
            'current-obj-id',
            'current-obj-id-prop',
            'The current playlist\'s playlistId',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'list-title': GObject.ParamSpec.string(
            'list-title',
            'list-title-prop',
            'The title of the corresponding list',
            GObject.ParamFlags.READABLE,
            'PlayLists'
        ),
        'show-list': GObject.ParamSpec.boolean(
            'show-list',
            'show-list-prop',
            'If the PlayLists should be shown',
            GObject.ParamFlags.READABLE,
            false
        )
    }
}, class PlayListProxyHandler extends GObject.Object {
    _init(proxy) {
        super._init();
        this._proxy = proxy;
        this._playlists = [];
        this._player_name = '';
        this._current_obj_id = '';
        this._show_list = false;
        this._list_title = 'PlayLists';
        this._propChangeId = null;
        this._getPlayListsId = null;
        this._finish_init();
    }

    get ifaceName() {
        return this._proxy ? this._proxy.g_interface_name : '';
    }

    get busName() {
        return this._proxy ? this._proxy.g_name : '';
    }

    get show_list() {
        return this._show_list || false;
    }

    get list_title() {
        return this._list_title || 'PlayLists';
    }

    get current_obj_id() {
        return this._current_obj_id || '';
    }

    get player_name() {
        return this._player_name || '';
    }

    set player_name(player_name) {
        this._player_name = player_name;
        this.notify('player-name');
    }

    get metadata() {
        return this._playlists ? this._playlists : [];
    }

    goTo(playlistId) {
        if (this._proxy && this._playListsIncludes(playlistId)) {
            this._proxy.ActivatePlaylistRemote(playlistId);
        }
    }

    refresh() {
        this._getPlayLists();
    }

    _getActivePlaylistId() {
        if (this._proxy) {
            let activePlaylist = this._proxy.ActivePlaylist;
            if (Array.isArray(activePlaylist) && activePlaylist.length === 2
                && this._goodPlayList(activePlaylist[1])) {
                let [valid, [id]] = activePlaylist;
                if (valid && this._playListsIncludes(id)) {
                    return id;
                }
            }
        }
        return '';
    }

    _getCount() {
        if (this._proxy) {
            let count = this._proxy.PlaylistCount;
            if (Number.isInteger(count) && count >= 0) {
                return count;
            }
        }
        return 0;
    }

    _getOrdering() {
        if (this._proxy) {
            let orderings = this._proxy.Orderings;
            if (Array.isArray(orderings)) {
                return orderings.includes('Alphabetical') ? 'Alphabetical' : orderings[0];
            }
        }
        return '';
    }

    _playListsIncludes(playlistId) {
        return this._goodPlayListId(playlistId) && Array.isArray(this._playlists)
            && this._playlists.some(i => i[0] === playlistId);
    }

    _goodPlayListId(playlistId) {
        return playlistId && playlistId !== '/' && !playlistId.startsWith(FORBIDDEN_OBJ_ID_PREFIX);
    }

    _goodPlayList(playlist) {
        return Array.isArray(playlist) && playlist.length >= 2 && this._goodPlayListId(playlist[0]);
    }

    _cleanPlayLists(playLists) {
        playLists = playLists && Array.isArray(playLists) ? playLists : [];
        let cleanPlayLists = playLists.filter((p, i, a) => this._goodPlayList(p) && a.findIndex(p2 => p2[0] === p[0]) === i);
        return cleanPlayLists.length === playLists.length ? cleanPlayLists : [];
    }

    _getShowList() {
        return Array.isArray(this._playlists) && this._playlists.length ? true : false;
    }

    _getListTitle(activeId) {
        if (activeId && Array.isArray(this._playlists)) {
            return this._playlists.find(i => i[0] === activeId)[1] || 'PlayLists';
        }
        return 'PlayLists';
    }

    _syncPlayListProps() {
        let show_list = this._getShowList();
        this._current_obj_id = this._getActivePlaylistId();
        let list_title = this._getListTitle(this._current_obj_id);

        if (this._show_list !== show_list) {
            this._show_list = show_list;
            this.notify('show-list');
        }
        if (this._show_list) {
            this.notify('current-obj-id');
        }
        if (this._list_title !== list_title) {
            this._list_title = list_title;
            if (this._show_list) {
                this.notify('list-title');
            }
        }
    }

    _getPlayLists() {
        this._playlists = [];
        let count = this._getCount();
        let ordering = this._getOrdering();
        if (count && ordering) {
            this._proxy.GetPlaylistsRemote(0, count, ordering, false, ([playLists]) => {
                this._playlists = this._cleanPlayLists(playLists);
                this.emit('new-metadata');
                this._syncPlayListProps();
            });
        } else {
            this._syncPlayListProps();
        }
    }

    _finish_init() {
        this._propChangeId = this._proxy.connect('g-properties-changed', (_, props) => {
            props = Object.keys(props.deep_unpack());
            if (props.includes('PlaylistCount') || props.includes('Orderings')) {
                this._getPlayLists();
            }
            if (props.includes('ActivePlaylist')) {
                this._syncPlayListProps();
            }
        });
        this._playlistChangedId = this._proxy.connectSignal('PlaylistChanged', (...[,,[playlist]]) => {
            if (this._goodPlayList(playlist) && this._playListsIncludes(playlist[0])) {
                let playlistId = playlist[0];
                let playlistTitle = playlist[1];
                this._playlists.forEach(p => {
                    if (p[0] === playlistId) {
                        p[1] = playlistTitle;
                    }
                });
                this.emit('metadata-changed', playlistId, playlistId, playlistTitle);
                this._syncPlayListProps();
            }
        });
    }

    destroy() {
        if (this._proxy) {
            this._proxy.disconnectSignal(this._playlistChangedId);
            this._proxy.disconnect(this._propChangeId);
            this._proxy.run_dispose();
        }
        this._proxy = null;
        this._playlists = null;
        this._player_name = null;
        this._list_title = null;
        this._show_list = false;
        this._propChangeId = null;
        super.run_dispose();
    }
});

const MprisProxyHandler = GObject.registerClass({
    GTypeName: 'MprisProxyHandler',
    Signals: {
        'update-indicator': {
            flags: GObject.SignalFlags.RUN_FIRST
        }
    },
    Properties: {
        'show-stop': GObject.ParamSpec.boolean(
            'show-stop',
            'show-stop-prop',
            'If the stop button should be shown',
            GObject.ParamFlags.READABLE,
            false
        ),
        'show-close': GObject.ParamSpec.boolean(
            'show-close',
            'show-close-prop',
            'If the close button should be shown',
            GObject.ParamFlags.READABLE,
            false
        ),
        'prev-reactive': GObject.ParamSpec.boolean(
            'prev-reactive',
            'prev-reactive-prop',
            'If the prev button should be reactive',
            GObject.ParamFlags.READABLE,
            false
        ),
        'playpause-reactive': GObject.ParamSpec.boolean(
            'playpause-reactive',
            'playpause-reactive-prop',
            'If the playpause button should be reactive',
            GObject.ParamFlags.READABLE,
            false
        ),
        'playpause-icon-name': GObject.ParamSpec.string(
            'playpause-icon-name',
            'playpause-icon-name-prop',
            'The name of the icon in the playpause button',
            GObject.ParamFlags.READABLE,
            'media-playback-start-symbolic'
        ),
        'next-reactive': GObject.ParamSpec.boolean(
            'next-reactive',
            'next-reactive-prop',
            'If the next button should be reactive',
            GObject.ParamFlags.READABLE,
            false
        ),
        'show-shuffle-repeat': GObject.ParamSpec.boolean(
            'show-shuffle-repeat',
            'show-shuffle-repeat-prop',
            'If the shuffle and repeat buttons should be shown',
            GObject.ParamFlags.READABLE,
            false
        ),
        'shuffle-reactive': GObject.ParamSpec.boolean(
            'shuffle-reactive',
            'shuffle-reactive-prop',
            'If the shuffle button should be reactive',
            GObject.ParamFlags.READABLE,
            false
        ),
        'shuffle-active': GObject.ParamSpec.boolean(
            'shuffle-active',
            'shuffle-active-prop',
            'If the shuffle button should appear active',
            GObject.ParamFlags.READABLE,
            false
        ),
        'repeat-reactive': GObject.ParamSpec.boolean(
            'repeat-reactive',
            'repeat-reactive-prop',
            'If the repeat button should be reactive',
            GObject.ParamFlags.READABLE,
            false
        ),
        'repeat-active': GObject.ParamSpec.boolean(
            'repeat-active',
            'repeat-active-prop',
            'If the repeat button should appear active',
            GObject.ParamFlags.READABLE,
            false
        ),
        'repeat-icon-name': GObject.ParamSpec.string(
            'repeat-icon-name',
            'repeat-icon-name-prop',
            'The name of the icon in the repeat button',
            GObject.ParamFlags.READABLE,
            'media-playlist-repeat-symbolic'
        ),
        'player-state': GObject.ParamSpec.string(
            'player-state',
            'player-state-prop',
            'A string representing the current player state',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'cover-url': GObject.ParamSpec.string(
            'cover-url',
            'cover-url-prop',
            'The url of the current track\'s cover art',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'accessible-name': GObject.ParamSpec.string(
            'accessible-name',
            'accessible-name-prop',
            'The accessible-name to be used by the player widget',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'obj-id': GObject.ParamSpec.string(
            'obj-id',
            'obj-id-prop',
            'The current track\'s trackId',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'player-name': GObject.ParamSpec.string(
            'player-name',
            'player-name-prop',
            'The player\'s name',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'artist': GObject.ParamSpec.string(
            'artist',
            'artist-prop',
            'The current track\'s artist',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'title': GObject.ParamSpec.string(
            'title',
            'title-prop',
            'The current track\'s title',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'volume': GObject.ParamSpec.double(
            'volume',
            'volume-prop',
            'The current volume',
            GObject.ParamFlags.READWRITE,
            0.0,
            1.0,
            0.0
        ),
        'show-volume': GObject.ParamSpec.boolean(
            'show-volume',
            'show-volume-prop',
            'If the volume slider should be shown',
            GObject.ParamFlags.READABLE,
            false
        ),
        'show-controls': GObject.ParamSpec.boolean(
            'show-controls',
            'show-controls-prop',
            'If the media controls should be shown',
            GObject.ParamFlags.READABLE,
            false
        ),
        'gicon': GObject.ParamSpec.object(
            'gicon',
            'gicon-prop',
            'a gicon for the player',
            GObject.ParamFlags.READABLE,
            Gio.ThemedIcon.new('audio-x-generic-symbolic')
        )
    }
}, class MprisProxyHandler extends GObject.Object {
    _init(pid, mpris, player) {
        super._init();
        this._pid = pid;
        this._mprisProxy = mpris;
        this._playerProxy = player;
        this._signals = [];
        this._appWrapper = null;
        this._player_name = '';
        this._desktop_entry = '';
        this._show_controls = false;
        this._show_stop = false;
        this._prev_reactive = false;
        this._playpause_reactive = false;
        this._playpause_icon_name = 'media-playback-start-symbolic';
        this._next_reactive = false;
        this._show_shuffle_repeat = false;
        this._shuffle_reactive = false;
        this._shuffle_active = false;
        this._repeat_reactive = false;
        this._repeat_active = false;
        this._repeat_icon_name = 'media-playlist-repeat-symbolic';
        this._obj_id = '';
        this._cover_url = '';
        this._artist = '';
        this._title = '';
        this._accessible_name = '';
        this._playback_status = 0;
        this._status_time = 0;
        this._volume = 0.0;
        this._show_volume = false;
        this._mimetype_icon_name = 'audio-x-generic-symbolic';
        this._gicon = Gio.ThemedIcon.new(this._mimetype_icon_name);
        this._finish_init();
    }

    get busName() {
        return this._mprisProxy && this._playerProxy ? this._mprisProxy.g_name || this._playerProxy.g_name : '';
    }

    get player_name() {
        return this._appWrapper && this._appWrapper.name ? this._appWrapper.name : this._player_name || '';
    }

    get accessible_name() {
        return this._accessible_name || '';
    }

    get show_stop() {
        return this._show_stop || false;
    }

    get gicon() {
        return this._gicon || null;
    }

    get prev_reactive() {
        return this._prev_reactive || false;
    }

    get playpause_reactive() {
        return this._playpause_reactive || false;
    }

    get playpause_icon_name() {
        return this._playpause_icon_name || 'media-playback-start-symbolic';
    }

    get show_shuffle_repeat() {
        return this._show_shuffle_repeat || false;
    }

    get next_reactive() {
        return this._next_reactive || false;
    }

    get shuffle_reactive() {
        return this._shuffle_reactive || false;
    }

    get shuffle_active() {
        return this._shuffle_active || false;
    }

    get repeat_reactive() {
        return this._repeat_reactive || false;
    }

    get repeat_active() {
        return this._repeat_active || false;
    }

    get repeat_icon_name() {
        return this._repeat_icon_name || 'media-playlist-repeat-symbolic';
    }

    get obj_id() {
        return this._obj_id || '';
    }

    get cover_url() {
        return this._cover_url || '';
    }

    get artist() {
        return this._artist || '';
    }

    get title() {
        return this._title || '';
    }

    get playback_status() {
        return this._playback_status || 0;
    }

    get status_time() {
        return this._status_time || 0;
    }

    get focused() {
        return this._appWrapper ? this._appWrapper.focused : false;
    }

    get user_time() {
        return this._appWrapper ? this._appWrapper.user_time : 0;
    }

    get show_volume() {
        return this._show_volume || false;
    }

    get show_controls() {
        return this._show_controls || false;
    }

    get show_close() {
        return (this._appWrapper && this._appWrapper.can_quit) || (this._mprisProxy && this._mprisProxy.CanQuit);
    }

    get app_id() {
        return this._appWrapper ? this._appWrapper.id : this._desktop_entry;
    }

    get volume() {
        return this._volume || 0.0;
    }

    set volume(newVolume) {
        if (this._playerProxy.CanControl) {
            if (this._playerProxy && this._show_volume && this._volume !== newVolume) {
                this._playerProxy.Volume = newVolume;
            }
        }
    }

    volumeUp() {
        if (this._show_volume) {
            this.volume = this._volume + 0.02;
            return true;
        }
        return false;
    }

    volumeDown() {
        if (this._show_volume) {
            this.volume = this._volume - 0.02;
            return true;
        }
        return false;
    }

    toggleWindow(minimize) {
        return this._appWrapper ? this._appWrapper.toggleWindow(minimize) : this._raise();
    }

    quit() {
        if (this._appWrapper && this._appWrapper.can_quit) {
            this._appWrapper.request_quit();
        } else if (this._mprisProxy && this._mprisProxy.CanQuit) {
            // The async QuitRemote helper method throws this error with some players:
            //
            // 'Object Gio.DBusProxy, has been already deallocated — impossible to access it.
            // This might be caused by the object having been destroyed from C code
            // using something such as destroy(), dispose(), or remove() vfuncs.'
            //
            // If I had to guess it's because Quit causes the proxy to be destroyed here
            // before asyncCallback in _proxyInvoker in the Gio overrides is called.
            // So for now we'll just do it the old fashioned way and skip the helper.
            this._mprisProxy.call_with_unix_fd_list('Quit', null, 0, -1, null, null, null);
        }
    }

    refreshIcon() {
        let gicon = this._getSymbolicIcon() || this._getFullColorIcon() || this._getMimeTypeIcon();
        if (!this._gicon.equal(gicon)) {
            this._gicon = gicon;
            this.notify('gicon');
            this.emit('update-indicator');
        }
    }

    playPause() {
        if (this._playerProxy && this._playerProxy.CanControl) {
            if (this._playerProxy.CanPause && this._playerProxy.CanPlay) {
                this._playerProxy.PlayPauseRemote();
            } else if (this._playerProxy.CanPlay) {
                this._playerProxy.PlayRemote();
            }
            return true;
        }
        return false;
    }

    stop() {
        if (this._playerProxy && this._playerProxy.CanControl) {
            this._playerProxy.StopRemote();
            return true;
        }
        return false;
    }

    playPauseStop() {
        if (this._playerProxy && this._playerProxy.CanControl) {
            let isPlaying = this._playback_status === 2;
            let canPlay = this._playerProxy.CanPlay;
            let canPause = this._playerProxy.CanPause;
            if (canPlay && canPause) {
                this._playerProxy.PlayPauseRemote();
                return true;
            } else if (canPlay && !isPlaying) {
                this._playerProxy.PlayRemote();
                return true;
            } else if (isPlaying) {
                this._playerProxy.StopRemote();
                return true;
            }
        }
        return false;
    }

    previous() {
        if (this._playerProxy && this._playerProxy.CanGoPrevious && this._playerProxy.CanControl) {
            this._playerProxy.PreviousRemote();
            return true;
        }
        return false;
    }

    next() {
        if (this._playerProxy && this._playerProxy.CanGoNext && this._playerProxy.CanControl) {
            this._playerProxy.NextRemote();
            return true;
        }
        return false;
    }

    toggleShuffle() {
        if (this._shuffle_reactive && this._playerProxy.CanControl) {
            this._playerProxy.Shuffle = !this._shuffle_active;
            return true;
        }
        return false;
    }

    cycleRepeat() {
        if (this._repeat_reactive && this._playerProxy.CanControl) {
            let loopStatus = this._playerProxy.LoopStatus || 'None';
            this._playerProxy.LoopStatus = loopStatus === 'None' ? 'Playlist'
                : loopStatus === 'Playlist' ? 'Track'
                : 'None';
            return true;
        }
        return false;
    }

    _raise() {
        if (this._mprisProxy && this._mprisProxy.CanRaise) {
            this._mprisProxy.RaiseRemote();
            return true;
        }
        return false;
    }

    _finish_init() {
        this.pushSignal(this._mprisProxy, 'g-properties-changed', () => {
            this._updateMprisProps();
        });
        this.pushSignal(this._playerProxy, 'g-properties-changed', (_, props) => {
            props = Object.keys(props.deep_unpack());
            if (props.includes('CanControl')) {
                let show_controls = this._playerProxy.CanControl;
                if (this._show_controls !== show_controls) {
                    if (show_controls) {
                        this._testShuffleLoopStatus();
                        this._testVolume();
                    }
                    this._show_controls = show_controls;
                    this.notify('show-controls');
                }
            }
            if (props.includes('PlaybackStatus') || props.some(prop => prop.startsWith('Can'))) {
                this._updatePlayerProps();
            }
            if (props.includes('Metadata')) {
                this._updateMetadata();
            }
            if (props.includes('Shuffle')) {
                this._updateShuffle();
            }
            if (props.includes('LoopStatus')) {
                this._updateLoopStatus();
            }
            if (props.includes('Volume')) {
                if (!this._show_volume && this._show_controls) {
                    this._show_volume = true;
                    this.notify('show-volume');
                }
                this._updateVolume();
            }
        });
        this._updateMprisProps();
        this._updatePlayerProps();
        this._updateMetadata();
        if (this._playerProxy.CanControl) {
            this._testShuffleLoopStatus();
            this._show_controls = true;
            this.notify('show-controls');
            this._testVolume();
        }
    }

    _updateMprisProps() {
        let playerName = this._mprisProxy.Identity || '';
        if (this._player_name !== playerName) {
            this._player_name = playerName;
            this.notify('player-name');
        }
        let desktop_entry = (this._mprisProxy.DesktopEntry || '').split('/').pop().replace('.desktop', '');
        if (this._desktop_entry !== desktop_entry) {
            this._desktop_entry = desktop_entry;
            if (!this._appWrapper && this._desktop_entry) {
                let desktopId = this._desktop_entry + '.desktop';
                let identity = this.player_name;
                let lcIdentity = identity.toLowerCase();
                let appSystem = Shell.AppSystem.get_default();
                let shellApp = appSystem.lookup_app(desktopId) ||
                    appSystem.lookup_startup_wmclass(identity) ||
                    appSystem.get_running().find(app => app.get_name().toLowerCase() === lcIdentity);
                if (!shellApp) {
                    for (let desktopId of Shell.AppSystem.search(this._desktop_entry)) {
                        let app = appSystem.lookup_app(desktopId[0]);
                        if (app && lcIdentity === app.get_name().toLowerCase()) {
                            shellApp = app;
                            break;
                        }
                    }
                }
                if (shellApp) {
                    this._appWrapper = new AppWrapper(
                        shellApp,
                        this._mprisProxy.g_name,
                        this._pid,
                        this._mprisProxy.g_name_owner
                    );
                    this.pushSignal(this._appWrapper, 'notify::focused', () => {
                        this.emit('update-indicator');
                    });
                    if (this._appWrapper.name) {
                        this.notify('player-name');
                    }
                }
            }
            this.refreshIcon();
        }
    }

    _updatePlayerProps() {
        let playPauseIconName = 'media-playback-start-symbolic';
        let playPauseReactive = false;
        let showStop = false;
        let status = (this._playerProxy.PlaybackStatus ||  '').toLowerCase();
        status = (status === 'playing') ? 2 : (status === 'paused') ? 1 : 0;
        let isPlaying = status === 2;
        let canPlay = this._playerProxy.CanPlay || false;
        let canPause = this._playerProxy.CanPause || false;
        let canGoPrevious = this._playerProxy.CanGoPrevious || false;
        let canGoNext = this._playerProxy.CanGoNext || false;

        if (canPause && canPlay) {
            playPauseIconName = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            playPauseReactive = true;
        } else {
            if (canPlay) {
                showStop = true;
            }
            playPauseIconName = 'media-playback-start-symbolic';
            playPauseReactive = canPlay;
        }

        if (this._show_stop !== showStop) {
            this._show_stop = showStop;
            this.notify('show-stop');
        }
        if (this._prev_reactive !== canGoPrevious) {
            this._prev_reactive = canGoPrevious;
            this.notify('prev-reactive');
        }
        if (this._playpause_icon_name !== playPauseIconName) {
            this._playpause_icon_name = playPauseIconName;
            this.notify('playpause-icon-name');
        }
        if (this._playpause_reactive !== playPauseReactive) {
            this._playpause_reactive = playPauseReactive;
            this.notify('playpause-reactive');
        }
        if (this._next_reactive !== canGoNext) {
            this._next_reactive = canGoNext;
            this.notify('next-reactive');
        }
        if (this._playback_status !== status) {
            this._playback_status = status;
            this._status_time = GLib.get_monotonic_time();
            this.emit('update-indicator');
        }
    }

    _updateMetadata() {
        let [obj_id, cover_url, artist, title, mimetype_icon] = parseMetadata(this._playerProxy.Metadata, this.player_name);
        this._cover_url = cover_url;
        this.notify('cover-url');
        let accessible_name = (artist == this.player_name) ? '' : this.player_name;
        if (this._accessible_name !== accessible_name) {
            this._accessible_name = accessible_name;
            this.notify('accessible-name');
        }
        // For the tooltip
        let emitUpdateIndicator = this._artist !== artist || this._title !== title;

        if (this._artist !== artist) {
            this._artist = artist;
            this.notify('artist');
        }
        if (this._title !== title) {
            this._title = title;
            this.notify('title');
        }
        if (this._obj_id !== obj_id) {
            this._obj_id = obj_id;
            this.notify('obj-id');
        }
        if (this._mimetype_icon_name !== mimetype_icon) {
            this._mimetype_icon_name = mimetype_icon;
            this.refreshIcon();
        }
        if (emitUpdateIndicator) {
            this.emit('update-indicator');
        }
    }

    _testShuffleLoopStatus() {
        // This should cause a Shuffle and LoopStatus prop change signals
        // if the player's Shuffle and LoopStatus props work correctly (and even exist, they are optional),
        // which in turn should cause the buttons to show themselves.
        // Otherwise they remain hidden since it's pointless to show widgets that don't do anything...
        // For the sake of UI symmetry if either Shuffle or Loopstatus works both buttons will be shown,
        // the button shown for whichever non-functional prop will just be non-reactive.
        if (this._playerProxy.Shuffle !== null) {
            let initialShuffle = this._playerProxy.Shuffle || false;
            this._playerProxy.Shuffle = !initialShuffle;
            this._playerProxy.Shuffle = initialShuffle;
        }
        if (this._playerProxy.LoopStatus !== null) {
            let initialLoopStatus = this._playerProxy.LoopStatus || 'None';
            this._playerProxy.LoopStatus = initialLoopStatus === 'None' ? 'Playlist'
                : initialLoopStatus === 'Playlist' ? 'Track'
                : 'None';
            this._playerProxy.LoopStatus = initialLoopStatus;
        }
    }

    _updateShuffle() {
        let shuffle_reactive = this._playerProxy.Shuffle !== null;
        let shuffle_active = this._playerProxy.Shuffle || false;
        let show_shuffle_repeat = shuffle_reactive || this._repeat_reactive;

        if (this._shuffle_reactive !== shuffle_reactive) {
            this._shuffle_reactive = shuffle_reactive;
            this.notify('shuffle-reactive');
        }
        if (this._shuffle_active !== shuffle_active) {
            this._shuffle_active = shuffle_active;
            this.notify('shuffle-active');
        }
        if (this._show_shuffle_repeat !== show_shuffle_repeat) {
            this._show_shuffle_repeat = show_shuffle_repeat;
            this.notify('show-shuffle-repeat');
        }
    }

    _updateLoopStatus() {
        let repeat_reactive = this._playerProxy.LoopStatus !== null;
        let show_shuffle_repeat = this._shuffle_reactive || repeat_reactive;
        let loopStatus = this._playerProxy.LoopStatus || 'None';
        let repeat_active = loopStatus !== 'None';
        let repeat_icon_name = loopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic'
            : 'media-playlist-repeat-symbolic';

        if (this._repeat_reactive !== repeat_reactive) {
            this._repeat_reactive = repeat_reactive;
            this.notify('repeat-reactive');
        }
        if (this._repeat_active !== repeat_active) {
            this._repeat_active = repeat_active;
            this.notify('repeat-active');
        }
        if (this._repeat_icon_name !== repeat_icon_name) {
            this._repeat_icon_name = repeat_icon_name;
            this.notify('repeat-icon-name');
        }
        if (this._show_shuffle_repeat !== show_shuffle_repeat) {
            this._show_shuffle_repeat = show_shuffle_repeat;
            this.notify('show-shuffle-repeat');
        }
    }

    _testVolume() {
        // This should cause a Volume props change signal
        // if the player's Volume prop works correctly,
        // which in turn should cause the volume slider to show itself.
        // Spotify's Volume prop is broken for example so the volume slider
        // remains hidden since it's pointless to show a widget that doesn't do anything...
        if (this._playerProxy.Volume) {
            let initialVolume = this._playerProxy.Volume || 0.0;
            this._playerProxy.Volume = initialVolume <= 0.0
                ? 0.1
                : initialVolume >= 1.0
                ? 0.9
                : Math.min(initialVolume - 0.1, 0.0);
            this._playerProxy.Volume = initialVolume;
        }
    }

    _updateVolume() {
        let newVolume = this._playerProxy.Volume ? Math.max(0.0, Math.min(Math.round(this._playerProxy.Volume * 100) / 100, 1.0)) : 0.0;
        if (this._volume !== newVolume) {
            this._volume = newVolume;
            this.notify('volume');
        }
    }

    _getSymbolicIcon() {
        return this._getIcon(true);
    }

    _getFullColorIcon() {
        return (this._appWrapper ? this._appWrapper.gicon : null)
        || this._getIcon(false);
    }

    _getIcon(symbolic) {
        let iconName = symbolic ? `${this.app_id}-symbolic` : this.app_id;
        return this.app_id && Gtk.IconTheme.get_default().has_icon(iconName) ? Gio.ThemedIcon.new(iconName) : null;
    }

    _getMimeTypeIcon() {
        return Gio.ThemedIcon.new(this._mimetype_icon_name);
    }

    pushSignal(obj, signalName, callback) {
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
        return signalId;
    }

    destroy() {
        if (this._signals) {
            this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
            this._mprisProxy.run_dispose();
            this._playerProxy.run_dispose();
        }
        if (this._appWrapper) {
            this._appWrapper.destroy();
        }
        this._pid = null;
        this._mprisProxy = null;
        this._playerProxy = null;
        this._signals = null;
        this._appWrapper = null;
        this._player_name = null;
        this._desktop_entry = null;
        this._show_controls = null;
        this._show_stop = null;
        this._prev_reactive = null;
        this._playpause_reactive = null;
        this._playpause_icon_name = null;
        this._next_reactive = null;
        this._show_shuffle_repeat = null;
        this._shuffle_reactive = null;
        this._shuffle_active = null;
        this._repeat_reactive = null;
        this._repeat_active = null;
        this._repeat_icon_name = null;
        this._obj_id = null;
        this._cover_url = null;
        this._artist = null;
        this._title = null;
        this._accessible_name = null;
        this._playback_status = null;
        this._status_time = null;
        this._volume = null;
        this._show_volume = null;
        this._mimetype_icon_name = null;
        this._gicon = null;
        super.run_dispose();
    }
});
