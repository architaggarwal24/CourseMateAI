# Pixel arena: sprites, stages and swapping in real art

The arena's fighters, creatures and stages are drawn by code (`frontend/src/lib/pixel`), so the game ships with no
image files. Real sprite sheets you buy or commission can replace any of them, one at a time, with no code changes.

## How the hand-coded art works

| File | What it does |
| --- | --- |
| `color.ts` | Hue-shifted 5-step ramps (outline, shadow, mid, light, highlight) from one base colour |
| `buffer.ts` | A tiny rasteriser: shaded capsules, ellipses and polygons, inner lines where parts overlap, silhouette outline |
| `rig.ts` | The humanoid skeleton (forward kinematics from joint angles) and its outfits, hair, heads and weapons |
| `heroes.ts` | The six champions and their animations (idle, attack, hit, guard, cast, ko, win, dash) |
| `bosses.ts` | The 13 creatures (ids match `backend/core_brains/bestiary.py`) and their animations (idle, attack, hit, cast, ko) |
| `stages.ts` | The 10 painted backdrops (480 x 270) and their ambient particles |
| `fight.ts` | The fight scene: dashes, sparks, slashes, shields, KO dissolve, banners, shake |
| `sprites.ts` | Rasterises each frame once and caches it |

Every frame is drawn facing **right**; the scene mirrors the boss. Previews: `npm run dev`, then open `/dev/pixel`.

## Replacing art with sprite sheets

1. Put the PNG in `frontend/public/sprites/`.
2. List it in `frontend/public/sprites/manifest.json`:

```json
{
  "heroes": {
    "kaien": {
      "src": "/sprites/kaien.png",
      "frameWidth": 96, "frameHeight": 112,
      "anchor": [48, 108],
      "anims": {
        "idle":   { "row": 0, "frames": 4, "fps": 6 },
        "attack": { "row": 1, "frames": 5, "fps": 14 },
        "hit":    { "row": 2, "frames": 2 },
        "guard":  { "row": 3, "frames": 2 },
        "cast":   { "row": 4, "frames": 3 },
        "ko":     { "row": 5, "frames": 4 },
        "win":    { "row": 6, "frames": 2 },
        "dash":   { "row": 7, "frames": 2 }
      }
    }
  },
  "bosses": {
    "hydra": { "src": "/sprites/hydra.png", "frameWidth": 256, "frameHeight": 240, "anchor": [140, 234],
               "anims": { "idle": { "row": 0, "frames": 4 }, "attack": { "row": 1, "frames": 5 },
                          "hit": { "row": 2, "frames": 2 }, "cast": { "row": 3, "frames": 3 }, "ko": { "row": 4, "frames": 4 } } }
  },
  "stages": { "swamp": { "src": "/sprites/stage-swamp.png" } }
}
```

- One row per animation, frames left to right, all frames the same size.
- `anchor` is the pixel under the figure's feet, the point that stands on the ground line.
- Sheets face **right**. Scale: a hero is about 90 px tall and a boss 150-200 px, on a 480 x 270 stage (the stage
  image is stretched to 480 x 270).
- An animation a sheet lacks falls back to its `idle` row. Anything not listed keeps its hand-coded art.
- Only use art you have the rights to.
