# GMK 9009 dashboard palette

The palette the Looker Studio **Performance** page is built from. It keeps the
keycap colours essentially as they are and buys chart legibility from
**lightness**, not saturation.

| Keycap colour | Becomes | Moved |
| --- | --- | --- |
| Parchment yellow `#ddba83` | `#d7b98b` | ΔE 1.4 |
| Slate blue `#8296a6` | `#7896af` | ΔE 1.8 |
| 3A green `#7fa580` | `#7f9b80` | ΔE 2.9 |
| 3C pink `#c87e74` | `#87615b` | **ΔE 14.5** |

Three of the four are the same colour to the eye. **One move does all the work:**
the pink deepens into a dusty rose, which is what separates it from the green.
Everything else in this document follows from that.

Chroma stays at keycap level — 0.03 to 0.07 in OKLCH, *below* the original 3A
green's 0.068 in places. This palette is less saturated than the keycaps, not
more.

The keycap-accurate references stay in
[`9009-color-palette.md`](9009-color-palette.md) and
[`9009-pastel-color-palette.md`](9009-pastel-color-palette.md).

Every value was produced by search — hue held, lightness and chroma varied — and
scored with the data-viz validator. See [Validation](#validation). Don't
hand-edit a hex without re-running it.

## Surfaces and ink

| Token | Hex | Role | Contrast |
| --- | --- | --- | --- |
| `--qs-page` | `#eae6dc` | Page background (9009 L9, lightened) | — |
| `--qs-card` | `#f4f1ea` | Card / chart surface | 1.10:1 on page |
| `--qs-border` | `#cdc9be` | Card borders, dividers (U9 light) | 1.47:1 |
| `--qs-grid` | `#ddd8cc` | Gridlines — must stay recessive | 1.26:1 |
| `--qs-axis` | `#b8b2a2` | Axis lines, ticks | 1.88:1 |
| `--qs-ink` | `#1c1b19` | Primary text (9009 charcoal, warmed) | **15.26:1** |
| `--qs-ink-2` | `#57534a` | Secondary text, axis labels | **6.79:1** |
| `--qs-ink-3` | `#7d7869` | Muted captions | 3.91:1 — large text only |

The card sits only 1.10:1 above the page. That is deliberate — separation is
carried by the `--qs-border` stroke, not a brightness step, which is what keeps
the page calm. If you drop card borders, raise the card to `#f8f6f1`.

## The three-step ladder

Each hue exists at three lightnesses, and **which step you use is decided by the
role, not by taste**:

| Step | Used for | Rule |
| --- | --- | --- |
| **Fill** | Table row backgrounds, heatmap cells | Very light; `--qs-ink` on top clears 12:1 |
| **Mid** | Status dots, series marks, the diverging ramp | The keycap colour itself |
| **Deep** | A mark that must stand alone on the card | Only where nothing else separates it |

| Hue | Fill | Mid | Deep |
| --- | --- | --- | --- |
| Green | `#dceedc` | `#7f9b80` | `#4c6d4e` |
| Rose | `#f5d6d1` | `#87615b` | `#704640` |
| Parchment | `#f9e9cf` | `#d7b98b` | `#917549` |
| Slate | `#d5e7f6` | `#7896af` | `#426884` |

**Do not build a set out of the deep row.** Deep green against deep parchment
measures ΔE 5.5, and 10.8 under normal vision — they converge as they darken.
Deep is for a *single* mark with nothing to be confused against, which in
practice means the gauge fill and nothing else.

## Status

Fills for table rows, mids for the dot beside the label:

| Status | Fill | Ink on fill | Mid (dot) |
| --- | --- | --- | --- |
| `done` | `#dceedc` | 14.18:1 | `#7f9b80` |
| `missed` | `#f5d6d1` | 12.64:1 | `#87615b` |
| `pending` | `#f9e9cf` | 14.41:1 | `#d7b98b` |
| `not_due` | `#e4e0d6` | 13.06:1 | `#aca693` |

Gauge fill, the one place a deep step is right: `#4c6d4e` (5.16:1).

The mids are **deliberately low-contrast against the card** — 1.66:1 for
pending, 2.70:1 for done. That is the muted look, and it is legal only because
every one of them appears beside its own label: the `status` column in the Today
table, the legend on a chart. A mid used as a bare unlabelled mark is wrong.

## Sequential — the `rate` heatmap

```text
#deedde  →  #c0d4c0  →  #9fb9a0  →  #809f81  →  #5e8260
  0–20%       20–40%      40–60%      60–80%      80–100%
```

Monotone lightness, ΔL ≈ 0.09 per step, comfortably above the 0.06 floor.

The lightest step is 1.08:1 against the card, so a 0% cell and an empty cell look
alike. Fix it in the chart, not the ramp: give cells a 2px gap so each reads as a
cell, and leave no-data cells at `--qs-page`. Darkening the light end until it
cleared 2:1 would make 0% render as a solid green, which reads as a *good* day —
worse than the problem.

## Diverging — `status_score` on the week grid

```text
#89605a  →  #ba9d98  →  #d8d2c3  →  #b1c4b2  →  #7f9b80
  −1                       0                      +1
 missed                 not due                  done
```

The midpoint is the real 9009 L9 beige, untouched. The arms are **deliberately
asymmetric in lightness** (rose L 0.53, green L 0.66): a symmetric red–green pair
measures ΔE 0.9 under deuteranopia — literally one colour. The asymmetry lifts
these poles to **12.7**.

## Categorical — `section_name`

Assign in this order and never cycle it:

| Slot | Section | Hex |
| --- | --- | --- |
| 1 | Morning Routine | `#7f9b80` |
| 2 | Evening Routine | `#87615b` |
| 3 | Work Day | `#7896af` |
| 4 | Daily Reminders | `#d7b98b` |

Worst adjacent pair ΔE **12.7** CVD / 15.6 normal. Parchment must stay at the far
end — it is the lightest step and collapses against green if they touch.

## Validation

```sh
node scripts/validate_palette.js "#7f9b80,#87615b,#7896af,#d7b98b" \
  --mode light --surface "#f4f1ea"
```

| Set | Pairs | CVD ΔE | Normal ΔE | Verdict |
| --- | --- | --- | --- | --- |
| Status mid (3) | all | **11.8** | 15.6 | Clears the ΔE 8 target |
| Categorical mid (4) | adjacent | **12.7** | 15.6 | Clears it |
| Diverging poles | all | **12.7** | 15.8 | Clears it |
| `done` vs `missed` | all | **12.7** | 15.6 | Clears it |
| Deep row as a set | all | 5.5 | 10.8 | **Fails — don't** |

**Two checks fail by design, and both are the muted look:**

- **Chroma floor.** Every mid sits at C 0.03–0.07 against the validator's 0.10
  floor, so by that measure they "read as gray". True, and intended — it is the
  same objection you could make to the keycaps. What makes them still work is
  that lightness carries the identity instead of chroma, which is why the CVD
  numbers are *higher* than a saturated version of the same palette scored.
- **Contrast vs surface.** Mid green and mid parchment fall under 3:1. Legal only
  with the labels described above.

The trade is recorded here so it is a decision, not an oversight. The earlier
saturated build of this palette scored ΔE 6.5 on the same status triad; this
muted one scores 11.8. Lightness separation is simply a better buy than chroma.

## CSS

```css
:root {
	/* surfaces + ink */
	--qs-page: #eae6dc;
	--qs-card: #f4f1ea;
	--qs-border: #cdc9be;
	--qs-grid: #ddd8cc;
	--qs-axis: #b8b2a2;
	--qs-ink: #1c1b19;
	--qs-ink-2: #57534a;
	--qs-ink-3: #7d7869;

	/* status — fills (ink on top) */
	--qs-done-fill: #dceedc;
	--qs-missed-fill: #f5d6d1;
	--qs-pending-fill: #f9e9cf;
	--qs-not-due-fill: #e4e0d6;

	/* status — mids (dots, marks beside a label) */
	--qs-done: #7f9b80;
	--qs-missed: #87615b;
	--qs-pending: #d7b98b;
	--qs-not-due: #aca693;

	/* deep — single marks only, never as a set */
	--qs-gauge: #4c6d4e;

	/* categorical — fixed order, never cycled */
	--qs-cat-1: #7f9b80;
	--qs-cat-2: #87615b;
	--qs-cat-3: #7896af;
	--qs-cat-4: #d7b98b;

	/* sequential — rate */
	--qs-seq-1: #deedde;
	--qs-seq-2: #c0d4c0;
	--qs-seq-3: #9fb9a0;
	--qs-seq-4: #809f81;
	--qs-seq-5: #5e8260;

	/* diverging — status_score */
	--qs-div-neg: #89605a;
	--qs-div-neg-2: #ba9d98;
	--qs-div-mid: #d8d2c3;
	--qs-div-pos-2: #b1c4b2;
	--qs-div-pos: #7f9b80;
}
```

## Applying it in Looker Studio

1. **Theme first.** Report background `#eae6dc`, chart background `#f4f1ea`,
   border `#cdc9be`, font `#1c1b19`. Theme changes overwrite per-chart styling,
   so anything set before this is lost.
2. **Text.** Titles and labels `#1c1b19`, axis labels `#57534a`. Nothing on the
   page wears a series colour as text.
3. **Today table.** One conditional-formatting rule per status colouring the
   **background** with the four fills — replacing the amber highlight that
   currently fires on every row.
4. **Gauge.** Range `#4c6d4e`, target tick `#57534a`, axis max 19, target 16.
5. **Calendar heatmap.** The five sequential steps, no-data cells left at
   `#eae6dc`, 2px cell gap.
6. **Week grid.** The diverging ramp with the midpoint pinned to `#d8d2c3` —
   Looker defaults it to the data median, which drifts off zero.
7. **Bars and lines.** `#7f9b80` for a single series; slots 2–4 in order only
   when there really are several.
