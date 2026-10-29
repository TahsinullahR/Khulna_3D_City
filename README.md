# Khulna City — Open World

A browser-based 3D game prototype inspired by Khulna, Bangladesh. Built with React, TypeScript, Three.js, and Vite.

## Current milestone — Phase 6

The playable prototype is now centered near 22.812758, 89.540243, matching the coordinate visible in the supplied Khulna map reference. It requests a district-scale area around the Sonadanga / Khulna City Medical College / Banorgati side of central Khulna, adds available named landmark labels, and caches map data in browser local storage for up to 24 hours when storage is available. The app remains an early prototype, not a full city reconstruction. The arcade car now uses oriented corner/side collision samples, animated rolling wheels, visible front-wheel steering, smoother obstacle deceleration, and a speed-responsive follow camera. This remains simplified movement, not realistic vehicle physics or traffic simulation.

Current features:
- Responsive website shell and embedded WebGL canvas.
- Third-person placeholder character with movement, sprint, jump, and follow camera.
- A simple arcade car prototype with enter/exit interaction, forward/reverse throttle, steering, speed HUD feedback, footprint collision samples, braking, wheel spin, front wheel steering pivots, and adaptive chase camera.
- Keyboard/mouse controls and touch buttons for mobile browsers, including a DRIVE button.
- A bounded OpenStreetMap request for road geometry, building footprints, mapped waterways, and tagged green areas around central Khulna.
- Improved mapped road hierarchy, shoulder/edge treatment, and restrained center markings on wider roads.
- Simple polygon surfaces for mapped parks/green areas and water bodies where OSM geometry exists.
- A procedural fallback district if public map services are unavailable.
- Best-effort 24-hour browser cache for validated OpenStreetMap response data.
- Labels for named mapped landmarks when the OSM way has a name and a recognized place/amenity tag.
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
- Mouse: rotate the camera. Click the canvas to enable pointer lock on desktop; drag to look if pointer lock is unavailable.
- Esc: pause.
- Mobile: hold the on-screen direction/action buttons; drag across the game view to rotate the camera.

## Geographic data

The first district is requested from OpenStreetMap's Overpass API within a small bounding box around central Khulna. The game converts geographic coordinates to a local meter-based coordinate system and extrudes mapped building footprints. Available building heights are used when present; missing heights are approximated.

Public Overpass endpoints can be busy, rate-limited, unavailable, or blocked by a browser/network. The game therefore falls back to a local procedural prototype. For a stable public release, prepare and host a checked, appropriately licensed regional extract rather than relying on a live public Overpass query at every launch.

The center and bounding box are configuration values in `src/game/KhulnaGame.ts`. The current bounding box is still a limited district-scale slice and should be validated against geographic references before expanding it. Landmark labels depend on the names and tags actually present in OpenStreetMap; they are not guaranteed to include every place visible in Google Maps. Public Overpass services may time out or return large responses; local cache is best-effort and can be cleared by the browser.

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
2. Validate road widths and intersections against local references; add sidewalks and named landmark labels.
3. Add a proper rigged character and animation assets.
4. Add drivable vehicles and vehicle physics.
5. Replace approximate footprint samples with robust collision geometry and vehicle physics, then add traffic/NPCs, missions, save/load, and game settings.
6. Test on desktop and physical Android devices, then optimize and deploy.

## Current limitations

- The player is a simple placeholder model.
- Road surfaces are simplified from road centerlines.
- Some buildings use estimated heights.
- No vehicle driving, combat, police, NPC navigation, missions, or cloud save yet.
- The mobile controls are basic buttons, not a full analog joystick.
- The geographic map is not a complete citywide dataset.


## Phase 4 driving controls

- Walk close to the green prototype car near the starting point.
- Press `V` on desktop or tap `DRIVE` on mobile to enter or exit.
- In driving mode, `W` / `S` accelerate and reverse; `A` / `D` steer; hold `Space` to brake.
- The current vehicle is a low-poly placeholder using simplified arcade motion. It does not yet model traffic rules, suspension, damage, or full vehicle dynamics.


## Phase 6 vehicle feedback

- Wheels visibly rotate based on vehicle movement and wheel radius.
- Front wheel assemblies turn with steering input.
- Chase camera distance and height increase modestly with speed.
- Obstacle contact uses a damped slowdown response. These improvements are visual/game-feel approximations, not simulation-grade vehicle dynamics.
