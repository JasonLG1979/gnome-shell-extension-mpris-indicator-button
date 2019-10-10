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

const Main = imports.ui.main;

const stockMpris = Main.panel.statusArea.dateMenu._messageList._mediaSection;
const shouldShow = stockMpris._shouldShow;

const { MprisIndicatorButton } = imports.misc.extensionUtils.getCurrentExtension().imports.widgets;

var indicator = null;

function enable() {
    stockMpris.actor.hide();
    stockMpris._shouldShow = () => false;
    if (!indicator) {
        indicator = Main.panel.addToStatusArea(
            "mprisindicatorbutton",
            new MprisIndicatorButton()
        );
    }
}

function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
    stockMpris._shouldShow = shouldShow;
    if (stockMpris._shouldShow()) {
        stockMpris.actor.show();
    }
}
