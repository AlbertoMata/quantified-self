# Alternative GMK 9009 Palette for Web Development

## Expanded Palette Table

| Base Color | Base Hex | Light Version (Web UI/BG) | Usage Suggestion |
| :--- | :--- | :--- | :--- |
| **L9 Light Beige** | `#d8d2c3` | `#e7e4db` | App background / Card background |
| **U9 Dark Beige** | `#aca693` | `#cdc9be` | Borders / Subtle dividers |
| **CR Charcoal Black** | `#171718` | `#737374` | Secondary text / Muted captions |
| **Alternative Green** | `#83a885` | `#b5ccb6` | Success states / Muted badges |
| **Alternative Pink** | `#f1b5b5` | `#f7d5d5` | Warning states / Secondary buttons |
| **Alternative Blue** | `#a2bdce` | `#c9dae4` | Primary links / Information alerts |
| **Complementary Dark Pink**| `#df8181` | `#eba9a9` | Call-to-actions / High-light accents |

## CSS Custom Properties (Variables)

```css
:root {
  /* Core Base Colors */
  --gmk-l9: #d8d2c3;
  --gmk-u9: #aca693;
  --gmk-cr: #171718;

  /* Your Custom Alternative Accents */
  --gmk-alt-green: #83a885;
  --gmk-alt-pink: #f1b5b5;
  --gmk-alt-blue: #a2bdce;

  /* Lighter Variants for Web Components */
  --gmk-l9-light: #e7e4db;
  --gmk-u9-light: #cdc9be;
  --gmk-cr-light: #737374;
  --gmk-alt-green-light: #b5ccb6;
  --gmk-alt-pink-light: #f7d5d5;
  --gmk-alt-blue-light: #c9dae4;

  /* Complementary Accent (Deep Pink contrast) */
  --gmk-comp-dark-pink: #df8181;
  --gmk-comp-dark-pink-light: #eba9a9;
}
```
