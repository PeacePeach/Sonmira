# Icons

Every icon in Sonmira comes from one registry, `src/app/ui/icons.js`, drawn from [Lucide](https://lucide.dev) (ISC License). The path data is vendored there because the app has no build step. Don't put SVG markup for icons anywhere else.

```js
import { icon } from '../ui/icons.js';

icon('share')                                  // 20 px, ink
icon('plus', { size: 'lg', tone: 'inverse' })  // the + on the ink button
icon('privacy', { tone: 'muted' })             // leading icon in a Settings row
```

## Sizes and stroke

| Size | px | Used for |
| --- | --- | --- |
| `sm` | 16 | trailing chevrons in rows |
| `md` | 20 | default: top-bar actions, row icons, calendar arrows, play/pause |
| `lg` | 24 | the screen's primary action (the +, the microphone) and the back chevron |

The line is 1.5 px on screen at every size: `icon()` scales the stroke against Lucide's 24 grid. The back chevron uses `lg` for an optical reason. Lucide's chevron is a small glyph, and at 20 px it reads lighter than the close and share icons on the same bar.

## Tones

| Tone | Token | Used for |
| --- | --- | --- |
| (none) | `--icon` (ink) | navigation and actions |
| `muted` | `--icon-muted` | leading icons in Settings rows |
| `subtle` | `--icon-subtle` | trailing chevrons |
| `disabled` | `--icon-disabled` | rows that say Coming soon |
| `inverse` | `--icon-inverse` (white) | icons on an ink button |

Icons are outline only. No filled glyphs, no accent colors, and no motion of their own.

## Names

| Name | Lucide | Where |
| --- | --- | --- |
| `back`, `forward` | chevron-left, chevron-right | back, month arrows, row chevrons |
| `close` | x | Recording, Share sheet, Paywall and other sheets |
| `share` | share | Painting, painting result |
| `calendar`, `diary` | calendar, gallery-vertical-end | Diary view toggle |
| `more` | ellipsis | opens Settings from the Diary |
| `plus` | plus | new entry |
| `mic` | mic | start recording |
| `play`, `pause` | play, pause | player |
| `recordingLength` | timer | Settings |
| `weekStart` | calendar-days | Settings |
| `reminder` | bell | Settings (Coming soon) |
| `lock` | lock | Settings (Coming soon) |
| `backup` | archive-restore | Settings (Coming soon) |
| `paintings` | palette | Settings → Available |
| `dailyRitual` | sunrise | Settings → Daily Ritual |
| `morePaintings` | circle-plus | Settings → More paintings |
| `restore` | rotate-ccw | Settings → Restore purchases |
| `rate` | star | Settings (Coming soon) |
| `privacy` | shield | Settings → Privacy policy |
| `terms` | file-text | Settings → Terms |
| `rename` | pencil | Painting title (tap to rename) |
| `account` | user-round | reserved for the Account row |

To add one, copy the inner markup of the Lucide SVG (from `lucide-static`, same version) into `GLYPHS` under a name that says what it means in Sonmira, not what it looks like.

## Where icons go

- **Do** use them on icon-only buttons, on leading icons in Settings rows (every row of a group, so the labels line up), and on trailing chevrons for rows that open something.
- **Don't** put them in pills and text buttons (Create painting, Keep it, Share image…), on Delete (its two-tap confirm needs words), in paywall plans and footer links, in section headers, or beside informational text.
- Development-only rows get no icons, so they keep looking like a tool.

## Accessibility and states

- An icon is `aria-hidden` and the button around it carries the `aria-label`. Pass `label` only for an icon that stands alone with meaning.
- Icon buttons keep a 44 px hit target (`.icon-btn`).
- Hover and press use the existing `--hover` tint. Keyboard focus shows a quiet `:focus-visible` ring. A disabled control uses the `disabled` tone.
