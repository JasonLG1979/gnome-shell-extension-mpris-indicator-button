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
    
    // Create a preferences page and group
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    group.set_title('Player preferences');
    page.add(group);

    group.add(addToggle(settings,'Show album name','show-album'));
    group.add(addToggle(settings,'Show playlists','show-playlists'));
    group.add(addToggle(settings,'Show volume','show-volume'));
	    
    // Add our page to the window
    window.add(page);
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