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
const Panel = imports.ui.main.panel;

const stockMpris = Panel.statusArea.dateMenu._messageList._mediaSection;
const shouldShow = stockMpris._shouldShow;

const { MprisIndicatorButton } = imports.misc.extensionUtils.getCurrentExtension().imports.widgets;

const ROLE = 'mprisindicatorbutton';

function init(extensionMeta) {
    imports.gi.Gtk.IconTheme.get_default().append_search_path(extensionMeta.path + '/icons');
    let localeDir = extensionMeta.dir.get_child('locale');
    let localePath = localeDir.query_exists(null) ? localeDir.get_path() : imports.misc.config.LOCALEDIR;
    imports.gettext.bindtextdomain(ROLE, localePath);
}

function enable() {
    if (!Panel.statusArea[ROLE]) {
        stockMpris.actor.visible = false;
        stockMpris._shouldShow = () => false;
        Panel.addToStatusArea(ROLE, new MprisIndicatorButton());
    }
}

function disable() {
    let indicator = Panel.statusArea[ROLE];
    if (indicator) {
        stockMpris._shouldShow = shouldShow;
        stockMpris.actor.visible = stockMpris._shouldShow();
        // Avoid - 'JS ERROR: Exception in callback for signal:
        // open-state-changed: Error: Argument 'descendant' (type interface) may not be null
        // _onMenuSet/indicator.menu._openChangedId'
        // When the Shell disables extensions on screen lock/blank and the menu happens to be open.
        // If you connect a signal you should disconnect it... GNOME devs...
        indicator.menu.disconnect(indicator.menu._openChangedId);
        indicator.destroy();
    }
}
