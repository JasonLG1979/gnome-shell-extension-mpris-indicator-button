'use strict';

const { Adw, Gio, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


function init() {
}

function fillPreferencesWindow(window) {
    // Use the same GSettings schema as in `extension.js`
    const settings = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.mprisindicatorbutton');
    
    // Create a preferences page
    const page = new Adw.PreferencesPage();

    // Player group
    const playerGroup = new Adw.PreferencesGroup();
    playerGroup.set_title('Player preferences');
    page.add(playerGroup);

    playerGroup.add(addToggle(settings,'Show album name','show-album'));
    playerGroup.add(addToggle(settings,'Show playlists','show-playlists'));
    playerGroup.add(addToggle(settings,'Show volume','show-volume'));
	    
    // tooltip group
    const tooltipGroup = new Adw.PreferencesGroup();
    tooltipGroup.set_title('Tooltip preferences');
    page.add(tooltipGroup);

    tooltipGroup.add(addToggle(settings,'Enable tooltip','tooltip-enable'));
    tooltipGroup.add(addToggle(settings,'Show playback status','tooltip-show-status'));
    tooltipGroup.add(addText(settings,'Tooltip pattern','tooltip-pattern'));

    // Create a group for playback indicator preferences
    const pbIndicatorGroup = new Adw.PreferencesGroup();
    pbIndicatorGroup.set_title('Playback indicator preferences');
    page.add(pbIndicatorGroup);

    pbIndicatorGroup.add(addToggle(settings,'Show playback indicator','show-playbackstatus'));
    pbIndicatorGroup.add(addToggle(settings,'Show track title','show-playback-tracktitle'));

    // Add our page to the window
    window.add(page);
}

function addText(settings, title, property) {
	// Create a new preferences row
    const row = new Adw.ActionRow({ title: title });

    // Create the switch and bind its value to the `show-indicator` key
    const text = new Gtk.Text({
        text: settings.get_string (property),
        valign: Gtk.Align.CENTER,
    });
    settings.bind(
        property,
        text,
        'text',
        Gio.SettingsBindFlags.DEFAULT
    );

    text.set_alignment(1.0, 0.0);

    // Add the switch to the row
    row.add_suffix(text);
    row.activatable_widget = text;

    return row;
}


function addToggle(settings, title, property) {
    // Create a new preferences row
    const row = new Adw.ActionRow({ title: title });

    // Create the switch and bind its value to the `show-indicator` key
    const toggle = new Gtk.Switch({
        active: settings.get_boolean (property),
        valign: Gtk.Align.CENTER,
    });
    settings.bind(
        property,
        toggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Add the switch to the row
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    
    return row;
}