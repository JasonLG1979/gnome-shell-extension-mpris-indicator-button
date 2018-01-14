# gnome-shell-extensions-mpris-indicator-button
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

 A simple MPRIS indicator button extension for GNOME Shell 3.26+ for those that dislike the media controls being in the notification area but don't care for all the bells and whistles of [gnome-shell-extensions-mediaplayer](https://github.com/JasonLG1979/gnome-shell-extensions-mediaplayer).

![Screenshot](https://github.com/JasonLG1979/gnome-shell-extensions-mpris-indicator-button/blob/master/data/Screenshot.png)

## Why GNOME Shell 3.26+?
This extension uses native JavaScript(ES6) Classes and therefore is incompatible with GNOME Shell < 3.26.

## How is this different than the default media controls in GNOME Shell?
Of course the most obvious difference is that the controls aren't in the notification area. Aside from that there are a few other noticeable differences.

- <b>Smarter player controls:</b> Most modern players don't really have a concept of Stop with the exception of players that play continuous streams that can't be paused (like internet radio). So for the most part a Stop Button is not needed, but when it is, not having one can really suck. This extension has a "smart" Stop Button. It's shown when it's needed and hidden when it's not.

- <b>Better default State:</b> No more disappearing players when you hit the end of a playlist or controls that tell you absolutely nothing (a generic audio icon with "Unknown artist" and "Unknown title"). Provided the Player has a symbolic icon and provides it's name you'll get at least that and provided the player has a GUI you should be able to raise it no matter what State the player is in.

- <b>This extension shows the Album Title:</b> Provided of course the player provides that information.

- <b>Much better Track Cover handling:</b> The default controls use a method of changing the Track Cover icon that can fail silently, if for example a player would to provide an invalid cover uri. This leads to the cover not changing in the case of an error and the current Track incorrectly having the cover of the previous Track. This extension uses a slightly more complex but much more fault tolerant method. We catch errors and fallback gracefully. You either get the correct cover or a fallback icon, which is either the player's symbolic icon or a generic audio icon. (In the future I may try to push this upstream to the default controls if they are interested?)

## Why does my favorite player not work as expected?
This extension is a pretty by the book and very basic MPRIS implementation. Most players should just work. If something doesn't work as expected with your favorite player, I'm sorry, but to put it bluntly, your favorite player is broken. You should file a bug against your favorite player. Player bugs will not be worked around in this extension. They must be fixed upstream.

## Can you/I add this new feature or functionality?
No. This extension is purposely very simple. There are no plans to add any additional features or functionality. If you want features see [gnome-shell-extensions-mediaplayer](https://github.com/JasonLG1979/gnome-shell-extensions-mediaplayer).

That is not to say that I am not interested in improving/fixing the existing code. I am always interested in improving code correctness, clearity and efficiency (in that order), and fixing bugs.
 
## Authors
  * JasonLG1979 (Jason Gray)

## Based on the work of
* horazont (Jonas Wielicki)
* eonpatapon (Jean-Philippe Braun)
* grawity (Mantas Mikulėnas)
* The authors of the GNOME Shell MPRIS controls.

## Like this Extension?

Then maybe consider donating to help continue it's development, otherwise known as buying me a RedBull.

You don't have to, but it would be cool if you did.

[![Flattr this git repo](https://api.flattr.com/button/flattr-badge-large.png)](https://flattr.com/submit/auto?user_id=JasonLG1979&url=https://github.com/JasonLG1979/gnome-shell-extensions-mpris-indicator-button)

And/or consider donating to one of these other projects I believe in.

[GNOME](https://www.gnome.org/support-gnome/donate/)

[The Free Software Foundation](https://www.fsf.org/about/ways-to-donate/)

[The Electronic Frontier Foundation](https://supporters.eff.org/donate/)
