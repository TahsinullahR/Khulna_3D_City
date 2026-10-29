# Khulna City — Open World

A browser-based 3D game prototype inspired by Khulna, Bangladesh. Built with React, TypeScript, Three.js, and Vite.

## Current milestone — Phase 15

The playable prototype is now centered near 22.812758, 89.540243, matching the coordinate visible in the supplied Khulna map reference. It requests a district-scale area around the Sonadanga / Khulna City Medical College / Banorgati side of central Khulna, adds available named landmark labels, and caches map data in browser local storage for up to 24 hours when storage is available. The app remains an early prototype, not a full city reconstruction. The prototype includes lightweight ambient traffic using selected OSM street geometries or fallback avenues. Phase 9 joins nearby road-way fragments whose endpoints are within a small threshold into longer continuous routes, reversing fragments when needed and snapping joined endpoints to remove tiny gaps. Traffic still stops at the end of each assembled open route; this is not a complete road graph or lane-aware traffic simulation.

Current features:
- Responsive website shell and embedded WebGL canvas.
- Third-person placeholder character with movement, sprint, jump, and follow camera.
- A simple arcade car prototype with enter/exit interaction, forward/reverse throttle, steering, speed HUD feedback, footprint collision samples, braking, wheel spin, front wheel steering pivots, and adaptive chase camera.
- Limited low-poly ambient traffic, capped at 10 agents for a lightweight prototype, following available long road geometries.
- Phase 10 added smooth proximity braking. Phase 11 adds cautious speed reduction before sharp bends in each traffic agent's current route. Phase 12 makes traffic-to-traffic following direction-aware. Phase 13 adds endpoint-based route continuation: when a vehicle reaches the end of its current route, it looks for another nearby route endpoint and prefers the option whose heading best continues the current direction. This is still a prototype heuristic, not a full road graph or turn-legal navigation system.
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
5. Improve traffic path continuity and collision behavior, then add NPCs, missions, save/load, and game settings.
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


## Phase 7 ambient traffic

- A capped group of low-poly vehicles advances along chained road geometries available in loaded map data.
- If the map falls back to generated streets, traffic uses simple avenue routes. Vehicles stop at open route ends rather than teleporting to route start.
- Ambient vehicles use simplified fixed speeds. They do not yet perform route planning, lane changing, traffic-signal behavior, realistic avoidance, or robust vehicle-to-vehicle collisions.
- Nearby ambient vehicles are temporarily hidden around the player's immediate space as a basic overlap guard. Simple proximity slowdown helps reduce close following, but does not detect lane, direction, or right-of-way.


## Phase 8 traffic continuity

- Ambient cars no longer wrap instantly from an open route's last segment to its first; they stop at the endpoint.
- Simple nearby-agent distance checks reduce speed in close proximity, with gradual recovery toward each agent's cruising speed.
- This approximation does not yet guarantee lane-correct following, prevent every overlap, or support intersections and signals.


## Phase 9 road route chaining

- The traffic setup attempts to stitch OSM road fragments when their endpoints are within 12 world units.
- It can reverse a fragment to connect matching endpoints and snaps the joining point for smooth interpolation.
- It does not yet model intersection topology, one-way restrictions, lane directions, turn rules, or guaranteed route continuity across a whole city. Traffic may still stop at open chain ends.


## Phase 10 traffic proximity braking

- Ambient cars use smooth speed changes to slow down near the player on foot or in the drivable car, and near other ambient traffic.
- Nearby traffic remains visible instead of disappearing around the player, making the response easier to observe.
- This is a lightweight distance-based behavior, not physical collision response, lane-aware following, intersection negotiation, or a stuck-vehicle recovery system. Vehicles can still overlap or stop at route ends.


## Phase 11 cautious cornering

- Traffic agents inspect the next route segment and reduce speed before sharp bends when the bend is close.
- Braking response is stronger than acceleration recovery, so cars slow more decisively when a nearby hazard or corner is detected.
- This is a local route-geometry heuristic. It does not identify real road junctions, select legal turns, understand one-way streets or right-of-way, or provide physical collision resolution. Route chains may still connect the wrong road fragments and cars can overlap.


## Phase 12 direction-aware traffic following

- Traffic checks the direction of its current route segment and estimates whether another car is ahead or behind.
- Cars reduce speed for a vehicle ahead within 8.5 world units when the lateral separation is within the configured corridor; stopped cars also count as obstacles.
- Cars beside or behind an agent no longer trigger the same following-distance brake merely because they are close in Euclidean distance.
- This is a local approximation. It does not model multiple lanes, vehicle dimensions, junction priorities, lane changes, or rigid-body collisions; unusual road chains can still cause poor behavior.


## Phase 13 endpoint-based route continuation

- When a traffic agent reaches the end of its current route, it searches other assembled route chains for an endpoint within 12 world units.
- It evaluates candidate direction alignment and prefers a route that continues the current heading with less abrupt turning; if no nearby candidate exists, the car stops instead of teleporting to a distant road.
- The selected route endpoint is snapped to the current endpoint to bridge small map-data gaps. The vehicle then continues along that route.
- Limitations: this is endpoint matching, not a full intersection graph. Roads crossing in the middle of an OSM way are not split into junction nodes; one-way rules, legal turn restrictions, lane selection, and collision physics are not modeled. The route heuristic can still choose a wrong connection.


## Phase 14 route backtracking reduction

- Traffic agents remember the route chain they arrived from.
- At a route endpoint, route scoring adds a penalty to immediately returning to the previous chain, encouraging a different nearby continuation when one is available.
- This penalty is a preference rather than a hard restriction, so a reverse connection can still be chosen if it is the best available option.
- The behavior remains endpoint-based. It does not establish legal junction turns, split road crossings into nodes, or guarantee that the selected connection is a real drivable road.


## Phase 15 — Bangladesh traffic vehicle variety

Ambient traffic now cycles through six low-poly vehicle types: auto-rickshaw, CNG auto-rickshaw, easybike, motorcycle, bus, and truck. Each type has a different silhouette, color, wheel layout, and approximate cruising speed. The existing traffic cap remains at 10 agents to keep the prototype lightweight. The models are procedural placeholders, not photorealistic assets; traffic variety depends on having enough usable road routes, and vehicles still share the same basic route-following heuristic.
