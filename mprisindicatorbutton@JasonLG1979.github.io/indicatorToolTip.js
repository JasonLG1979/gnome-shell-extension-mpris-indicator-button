/*
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
 */

const { Atk, Clutter, GObject, St } = imports.gi;

const { layoutManager } = imports.ui.main;
const { DASH_ITEM_LABEL_SHOW_TIME } = imports.ui.dash;

const DEFAULT_SYNC_CREATE_PROP_FLAGS = GObject.BindingFlags.DEFAULT | GObject.BindingFlags.SYNC_CREATE;

// The point of this Constraint is to try to keep
// the tooltip in the proper place in relation to the
// indicator no matter what side of the monitor it's on.
const ToolTipConstraint = GObject.registerClass({
    GTypeName: "ToolTipConstraint"
}, class ToolTipConstraint extends Clutter.Constraint {
    _init() {
        super._init();
    }

    _getIndicatorPosition(indicator) {
        // Try to detect what side of the monitor the panel is on
        // by checking the indicator's panel box to see if it's
        // vertical or horizontal and then comparing it's x or y
        // to the monitor's x or y. This has been tested to work
        // with horizontal and vertical panels both the default panel
        // and the dash to panel extension. (on a single monitor setup)
        let vertical = false;
        let side = St.Side.TOP;
        let box = indicator;
        // Walk the ancestors of the indicator
        // until we find a BoxLayout so we can tell
        // if the panel is horizontal or vertical.
        while (box) {
            box = box.get_parent();
            if (box instanceof St.BoxLayout) {
                vertical = box.get_vertical();
                break;
            }
        }
        // Get the monitor the the indicator is on and try to tell
        // which side it's on.
        let monitor = layoutManager.findMonitorForActor(indicator);
        let [x, y] = indicator.get_transformed_position();
        if (vertical) {
            side = Math.floor(x) == monitor.x ? St.Side.LEFT : St.Side.RIGHT;
        } else {
            side = Math.floor(y) == monitor.y ? St.Side.TOP : St.Side.BOTTOM;
        }
        return [monitor, side, x, y];
    }

    vfunc_update_allocation(actor, box) {
        if (!actor.hasOwnProperty("indicator") || !actor.indicator) {
            return;
        }
        let thisWidth = box.x2 - box.x1;
        let thisHeight = box.y2 - box.y1;
        let indAllocation = actor.indicator.get_allocation_box();
        let indWidth = indAllocation.x2 - indAllocation.x1;
        let indHeight = indAllocation.y2 - indAllocation.y1;
        let [monitor, side, x, y] = this._getIndicatorPosition(actor.indicator);
        let tooltipTop = monitor.y;
        let tooltipLeft = monitor.x;
        switch (side) {
            // Positioning logic inspired by the Cinnamon Desktop's PanelItemTooltip.
            // Try to center the tooltip with the indicator but never go off screen
            // or cover the indicator or panel. And set the animation pivot point
            // so that the animation appears to come from/go to the indicator.
            case St.Side.BOTTOM:
                tooltipTop =  monitor.y + monitor.height - thisHeight - indHeight;
                tooltipLeft = x - ((thisWidth - indWidth) / 2);
                tooltipLeft = Math.max(tooltipLeft, monitor.x);
                tooltipLeft = Math.min(tooltipLeft, monitor.x + monitor.width - thisWidth);
                break;
            case St.Side.TOP:
                tooltipTop =  monitor.y + indHeight;
                tooltipLeft = x - ((thisWidth - indWidth) / 2);
                tooltipLeft = Math.max(tooltipLeft, monitor.x);
                tooltipLeft = Math.min(tooltipLeft, monitor.x + monitor.width - thisWidth);
                break;
            case St.Side.LEFT:
                tooltipTop =  y - ((thisHeight - indHeight) / 2);
                tooltipTop =  Math.max(tooltipTop, monitor.y);
                tooltipTop =  Math.min(tooltipTop, monitor.y + monitor.height - thisHeight);
                tooltipLeft = monitor.x + indWidth;
                break;
            case St.Side.RIGHT:
                tooltipTop =  y - ((thisHeight - indHeight) / 2);
                tooltipTop =  Math.max(tooltipTop, monitor.y);
                tooltipTop =  Math.min(tooltipTop, monitor.y + monitor.height - thisHeight);
                tooltipLeft = monitor.x + monitor.width - thisWidth - indWidth;
                break;
            default:
                break;
        }

        tooltipTop = Math.round(tooltipTop);
        tooltipLeft = Math.round(tooltipLeft);

        let pivot_y = Math.max(0.0, Math.min(((y + (indHeight / 2)) - tooltipTop) / thisHeight, 1.0));
        let pivot_x = Math.max(0.0, Math.min(((x + (indWidth / 2)) - tooltipLeft) / thisWidth, 1.0));

        actor.set_pivot_point(pivot_x, pivot_y);
        box.set_origin(tooltipLeft, tooltipTop);
        super.vfunc_update_allocation(actor, box);
    }
});


// This is an abstract base class to create Indicator tooltips.
// It is meant to make it easy for others to extend and use along
// with ToolTipConstraint (which should really never need to be touched)
// to add tooltips to their Indicators if they like.
var ToolTipBase = GObject.registerClass({
    GTypeName: "ToolTipBase",
    GTypeFlags: GObject.TypeFlags.ABSTRACT,
    Properties: {
        "text": GObject.ParamSpec.string(
            "text",
            "text-prop",
            "the tooltip's text",
            GObject.ParamFlags.READWRITE,
            ""
        ),
        "icon-name": GObject.ParamSpec.string(
            "icon-name",
            "icon-name-prop",
            "the tooltip's icon-name",
            GObject.ParamFlags.READWRITE,
            ""
        ),
        "label-style-class": GObject.ParamSpec.string(
            "label-style-class",
            "label-style-class-prop",
            "the style class of the tooltip's label",
            GObject.ParamFlags.READWRITE,
            ""
        ),
        "icon-style-class": GObject.ParamSpec.string(
            "icon-style-class",
            "text-style-class-prop",
            "the style class of the tooltip's icon",
            GObject.ParamFlags.READWRITE,
            ""
        ),
        "show-icon": GObject.ParamSpec.boolean(
            "show-icon",
            "show-icon-prop",
            "if the tooltip's icon should be shown",
            GObject.ParamFlags.READWRITE,
            false
        )
    }
}, class ToolTipBase extends St.Widget {
    _init(indicator, wantsIcon=false, text="", iconName="",
        toolTipStyleClass="", iconStyleClass="", labelStyleClass="") {

        super._init({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.TOOL_TIP,
            constraints: new ToolTipConstraint(),
            layout_manager: new Clutter.BoxLayout(),
            style_class: toolTipStyleClass,
            visible: false
        });

        this._text = text;
        this._icon_name = iconName;
        this._label_style_class = labelStyleClass;
        this._icon_style_class = iconStyleClass;
        this._show_icon = wantsIcon;

        this.indicator = indicator;

        this._signals = [];

        this._icon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START
        });

        this.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START
        });

        this.add_child(this._label);

        this.label_actor = this._label;

        this.bind_property(
            "text",
            this._label,
            "text",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.bind_property(
            "icon-name",
            this._icon,
            "icon-name",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.bind_property(
            "label-style-class",
            this._label,
            "style-class",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.bind_property(
            "icon-style-class",
            this._icon,
            "style-class",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.bind_property(
            "show-icon",
            this._icon,
            "visible",
            DEFAULT_SYNC_CREATE_PROP_FLAGS
        );

        this.pushSignal(this, "notify::allocation", () => {
            this._label.clutter_text.queue_relayout();
        });

        // All handler functions can be overridden, just remember to chain up if you want
        // to maintain default behaviour.
        this.pushSignal(this.indicator,"notify::visible", this.onIndicatorVisibleChanged.bind(this));

        this.pushSignal(this.indicator,"notify::hover", this.onIndicatorHover.bind(this));

        this.pushSignal(this.indicator.menu, "open-state-changed", this.onIndicatorMenuOpenStateChanged.bind(this));

        this.pushSignal(this.indicator, "destroy", this.onIndicatorDestroy.bind(this));

        layoutManager.addTopChrome(this, {affectsInputRegion: false});
    }

    get text() {
        return this._text || "";
    }

    set text(text="") {
        if (this._text !== text) {
            this._text = text;
            this.notify("text");
        }
    }

    get icon_name() {
        return this._icon_name || "";
    }

    set icon_name(icon_name="") {
        if (this._icon_name !== icon_name) {
            this._icon_name = icon_name;
            this.notify("icon-name");
        }
    }

    get label_style_class() {
        return this._label_style_class || "";
    }

    set label_style_class(label_style_class="") {
        if (this._label_style_class !== label_style_class) {
            this._label_style_class = label_style_class;
            this.notify("label-style-class");
        }
    }

    get icon_style_class() {
        return this._icon_style_class || "";
    }

    set icon_style_class(icon_style_class="") {
        if (this._icon_style_class !== icon_style_class) {
            this._icon_style_class = icon_style_class;
            this.notify("icon-style-class");
        }
    }

    get show_icon() {
        return this._show_icon || false;
    }

    set show_icon(show_icon=false) {
        if (this._show_icon !== show_icon) {
            this._show_icon = show_icon;
            this.notify("show-icon");
        }
    }

    get indicatorMenuIsOpen() {
        // Not all indicators have real menus. Indicators without menus still have
        // dummy menus though that lack isOpen.
        return this.indicator.menu.hasOwnProperty("isOpen") && this.indicator.menu.isOpen;
    }

    pushSignal(obj, signalName, callback) {
        // This is a convenience function for connecting signals.
        // Use this to make sure all signal are disconnected
        // when the indicator is destroyed.
        // In theory Objects should not emit signals
        // after destruction, but that assumption is often
        // times false with St widgets and Clutter.  
        let signalId = obj.connect(signalName, callback);
        this._signals.push({
            obj: obj,
            signalId: signalId
        });
        return signalId;
    }

    onIndicatorVisibleChanged(indicator, pspec) {
        if (!this.indicator.visible) {
            this.animatedHide(true);
        }
    }

    onIndicatorHover(indicator, pspec) {
        if (this.indicator.hover && this.text && !this.indicatorMenuIsOpen && !this.visible) {
            this.animatedShow();
        } else {
            this.animatedHide(true);
        }
    }

    onIndicatorMenuOpenStateChanged(indicatorMenu, open) {
        this.animatedHide(true);
    }

    onIndicatorDestroy(indicator) {
        // All cleanup happens here.
        // The tooltip is destroyed with the indicator.
        // If you override this function you MUST chain up otherwise
        // clean up will not happen. 
        this.remove_all_transitions();
        this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        this.indicator = null;
        this._signals = null;
        this._text = null;
        this._icon_name = null;
        this._label_style_class = null;
        this._icon_style_class = null;
        this._show_icon = null;
        this.destroy();
    }

    update(text="", iconName="") {
        this.text = text;
        this.icon_name = iconName;
    }

    updateText(text="") {
        this.text = text;
    }

    updateIconName(iconName="") {
        this.icon_name = iconName;
    }

    animatedUpdate(text="", iconName="", noDelay=false) {
        if (this.visible && (this.text !== text || this.icon_name !== iconName)) {
            this.animatedHide(noDelay, () => {
                this.icon_name = iconName;
                this.text = text;
                this.animatedShow(noDelay);
            });
        } else {
            this.icon_name = iconName;
            this.text = text;
        }
    }

    animatedUpdateText(text="", noDelay=false) {
        if (this.visible && this.text !== text) {
            this.animatedHide(noDelay, () => {
                this.text = text;
                this.animatedShow(noDelay);
            });
        } else {
            this.text = text;
        }
    }

    animatedUpdateIconName(iconName="", noDelay=false) {
        if (this.visible && this.icon_name !== iconName) {
            this.animatedHide(noDelay, () => {
                this.icon_name = iconName;
                this.animatedShow(noDelay);
            });
        } else {
            this.icon_name = iconName;
        }
    }

    updateAfterHide(text="", iconName="", noDelay=false) {
        this.animatedHide(noDelay, () => {
            this.icon_name = iconName;
            this.text = text;
        });
    }

    updateThenShow(text="", iconName="", noDelay=false) {
        this.icon_name = iconName;
        this.text = text;
        this.animateShow(noDelay);
    }

    // Below are variants of show and hide.
    // It is not advisable to call the default
    // show and hide functions if you ever
    // plan on animating anything.
    // Doing so can leave the tooltip
    // in an undefined state of scale
    // and/or opacity.  
    animatedShow(noDelay=false) {
        this.remove_all_transitions();
        this.opacity = 0;
        this.scale_x = 0.0;
        this.scale_y = 0.0;
        this.show();
        this.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: DASH_ITEM_LABEL_SHOW_TIME,
            delay: noDelay ? 0 : DASH_ITEM_LABEL_SHOW_TIME * 2,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    animatedHide(noDelay=false, onComplete=null) {
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            scale_x: 0.0,
            scale_y: 0.0,
            duration: DASH_ITEM_LABEL_SHOW_TIME,
            delay: noDelay ? 0 : DASH_ITEM_LABEL_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.hide();
                this.scale_x = 1.0;
                this.scale_y = 1.0;
                if (onComplete) {
                   onComplete(); 
                }
            }
        });
    }

    unAnimatedShow() {
        this.remove_all_transitions();
        this.scale_x = 1.0;
        this.scale_y = 1.0;
        this.opacity = 255;
        this.show();
    }

    unAnimatedHide() {
        this.remove_all_transitions();
        this.hide();
        this.scale_x = 1.0;
        this.scale_y = 1.0;
        this.opacity = 255;
    }
});
