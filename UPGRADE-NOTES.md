# GBU CampusGuide – navigation upgrade

This update modifies the existing React + Vite frontend and FastAPI backend.

## Added
- `GET /api/landmarks` returns landmark records joined to the existing campus location coordinates.
- Live browser GPS tracking while GPS-based navigation is active.
- Live user-position marker on the Leaflet map.
- Approximate route progress based on the nearest point in the returned route geometry.
- Nearby landmark voice announcements in Hindi/English.
- Automatic route refresh after repeated GPS readings more than 65 m from the current route.

## Important limitations
- The campus inventory in the supplied data still contains only five locations.
- Landmark side labels such as left/right are not treated as verified. Announcements therefore say a place is nearby, not that it is on a particular side.
- Route progress and off-route detection are GPS/map-geometry estimates. GPS drift can cause false reroutes.
- The route provider may return a straight-line fallback if its walking service is unavailable. Read the route warning before relying on it.
- Full-campus coverage requires verified building entrances, paths, gates, and waypoint coordinates. No unknown coordinates were fabricated.

## Run locally
1. Copy `frontend/.env.example` to `frontend/.env.local` and add your own MapTiler browser key.
2. Backend: `cd backend`, create/activate a virtual environment, run `pip install -r requirements.txt`, then `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.
3. Frontend: `cd frontend`, run `npm ci`, then `npm run dev`.

Do not commit `.env.local` or expose API keys in a public repository.
