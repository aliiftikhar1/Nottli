# Developer cat — raster frames (optional)

Nottli draws the developer cat as built-in SVG. Raster frames placed here
override individual states once they are registered in
`src/pet/developerCatAssets.ts`.

## Frames

| Frame          | When it shows                                   |
| -------------- | ----------------------------------------------- |
| `idle`         | Default                                         |
| `blink`        | ~150 ms every few seconds while eyes are open    |
| `coding`       | While a note is being typed                     |
| `thinking`     | Notes panel open, not typing                    |
| `happy`        | After a save, or when the pet is clicked        |
| `sleeping`     | After the PC has been idle (default 5 minutes)  |
| `notification` | Brief attention reaction                        |

## Spec

- Transparent **WebP or PNG**, square, **256 × 256** (covers up to 275% display scaling at 92 CSS px).
- Character only — no laptop, desk, books, or background.
- Keep the character inside the central ~84% (≈ 20 px clear margin) so the CSS
  float/bounce animations never clip ears or tail.
- Feet resting on the same baseline in every frame (≈ 92% down), centred horizontally,
  so switching frames does not make the cat jump.
- Motion (float, breathing, bounce, tilt) is applied by CSS; frames should be static poses.

## Registering

```ts
// src/pet/developerCatAssets.ts
const AVAILABLE = { idle: 'idle.webp', blink: 'blink.webp' };
```
