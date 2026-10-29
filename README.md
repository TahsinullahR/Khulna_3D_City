# Khulna City — Open World

A browser-based 3D game prototype inspired by Khulna, Bangladesh. Built with React, TypeScript, Three.js, and Vite.

## Current milestone

This repository contains the first playable vertical slice:
- Responsive website shell and embedded WebGL canvas.
- Third-person placeholder character with movement, sprint, jump, and follow camera.
- Keyboard/mouse controls and touch buttons for mobile browsers.
- A bounded OpenStreetMap request for road geometry and building footprints around central Khulna.
- A procedural fallback district if public map services are unavailable.
- Basic building collision and renderer cleanup.

**Important:** This is an early prototype, not a complete photorealistic reconstruction of Khulna. Building heights without source data are approximated, the character is a placeholder, and vehicles, missions, traffic, and NPC systems have not been implemented yet.

## Run locally

Requirements: Node.js 20 or newer recommended.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Production build:

```bash
npm run typecheck
npm run build
npm run preview
```

## Controls

- W / A / S / D or arrow keys: move.
- Shift: sprint.
- Space: jump.
- Mouse: rotate the camera. Click the canvas to enable pointer lock on desktop.
- Esc: pause.
- Mobile: use the on-screen direction and action buttons.

## Geographic data

The first district is requested from OpenStreetMap's Overpass API within a small bounding box around central Khulna. The game converts geographic coordinates to a local meter-based coordinate system and extrudes mapped building footprints. Available building heights are used when present; missing heights are approximated.

Public Overpass endpoints can be busy, rate-limited, unavailable, or blocked by a browser/network. The game therefore falls back to a local procedural prototype. For a stable public release, prepare and host a checked, appropriately licensed regional extract rather than relying on a live public Overpass query at every launch.

The initial center and bounding box are configuration values in `src/game/KhulnaGame.ts`. Validate the area against geographic references before expanding it.

## Data attribution and licensing

- OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL). Provide visible attribution such as “© OpenStreetMap contributors” when using OSM-derived map data and follow ODbL obligations for database use and distribution.
- OpenStreetMap data does not guarantee building heights, current conditions, detailed facades, or interiors.
- Do not use unlicensed satellite imagery, proprietary game assets, or scraped 3D models.
- Record the source and license of every third-party model, texture, font, and audio asset before including it in a release.

Useful references:
- https://www.openstreetmap.org/copyright
- https://www.openstreetmap.org/
- https://wiki.openstreetmap.org/wiki/Overpass_API
- https://threejs.org/docs/
- https://vite.dev/guide/

## Roadmap

1. Verify and cache a real central-Khulna geographic extract.
2. Improve road widths, sidewalks, intersections, terrain, and landmark labeling.
3. Add a proper rigged character and animation assets.
4. Add drivable vehicles and vehicle physics.
5. Add NPCs, traffic, missions, save/load, and game settings.
6. Test on desktop and physical Android devices, then optimize and deploy.

## Current limitations

- The player is a simple placeholder model.
- Road surfaces are simplified from road centerlines.
- Some buildings use estimated heights.
- No vehicle driving, combat, police, NPC navigation, missions, or cloud save yet.
- The mobile controls are basic buttons, not a full analog joystick.
- The geographic map is not a complete citywide dataset.
