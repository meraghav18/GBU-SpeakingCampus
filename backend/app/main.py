import os
import csv
import json
import httpx
import math

from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


# --------------------------------
# Paths and Configuration
# --------------------------------

BASE = Path(__file__).resolve().parents[1]

LOCATIONS_JSON_FILE = BASE / "data" / "campus_locations.json"
LOCATIONS_CSV_FILE = BASE / "data" / "campus_locations.csv"
WAYPOINTS_FILE = BASE / "data" / "route_waypoints.csv"
LANDMARKS_FILE = BASE / "data" / "route_landmarks.csv"

VALHALLA_URL = os.getenv("VALHALLA_URL", "https://valhalla1.openstreetmap.de/route").strip()
OSRM_FOOT_URL = os.getenv(
    "OSRM_FOOT_URL",
    "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
).strip()

app = FastAPI(
    title="GBU CampusGuide API",
    version="2.0.0",
)


# --------------------------------
# CORS Configuration
# --------------------------------

FRONTEND_ORIGIN = os.getenv(
    "FRONTEND_ORIGIN",
    "https://gbu-campusguide.vercel.app"
).strip().rstrip("/")

ALLOWED_ORIGINS = [
    "https://gbu-campusguide.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if FRONTEND_ORIGIN and FRONTEND_ORIGIN not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------
# Load Campus Locations (Central JSON + CSV fallback)
# --------------------------------

def load_locations():
    if LOCATIONS_JSON_FILE.exists():
        data = json.loads(LOCATIONS_JSON_FILE.read_text(encoding="utf-8"))
        rows = []
        for item in data:
            status = item.get("status", "Verified")
            # Enforce exact verified coordinates for Gate No. 1
            if item.get("id") == "B001":
                item["latitude"] = 28.416559
                item["longitude"] = 77.517199
            item["latitude"] = float(item["latitude"])
            item["longitude"] = float(item["longitude"])
            item["status"] = status
            rows.append(item)
        return rows

    with LOCATIONS_CSV_FILE.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    for row in rows:
        if row.get("id") == "B001":
            row["latitude"] = 28.416559
            row["longitude"] = 77.517199
        else:
            row["latitude"] = float(row["latitude"])
            row["longitude"] = float(row["longitude"])
        row.setdefault("status", "Verified")

    return rows


ALL_LOCATIONS = load_locations()
VERIFIED_LOCATIONS = [
    loc for loc in ALL_LOCATIONS if loc.get("status", "Verified") == "Verified"
]


# --------------------------------
# Load Route Waypoints
# --------------------------------

def load_waypoints():
    if not WAYPOINTS_FILE.exists():
        return []
    with WAYPOINTS_FILE.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    waypoints = []
    for row in rows:
        lat = row.get("latitude", "").strip()
        lon = row.get("longitude", "").strip()
        if not lat or not lon:
            continue
        try:
            row["latitude"] = float(lat)
            row["longitude"] = float(lon)
            row["sequence"] = int(row["sequence"])
            waypoints.append(row)
        except (ValueError, TypeError):
            continue

    return sorted(waypoints, key=lambda item: item["sequence"])


WAYPOINTS = load_waypoints()


def load_landmarks():
    if not LANDMARKS_FILE.exists():
        return []
    with LANDMARKS_FILE.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    by_id = {place["id"]: place for place in VERIFIED_LOCATIONS}
    result = []
    for row in rows:
        place = by_id.get(row.get("building_id", ""))
        if not place:
            continue
        result.append({
            **row,
            "name": place["name"],
            "name_hi": row.get("name_hi") or place.get("name_hi", place["name"]),
            "announcement_hi": row.get("announcement_hi") or place.get("description_hi", ""),
            "description": place.get("description", ""),
            "description_hi": place.get("description_hi", ""),
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "status": place.get("status", "Verified"),
        })
    return result


LANDMARKS = load_landmarks()


# --------------------------------
# Route Request Model & Validation
# --------------------------------

class RouteRequest(BaseModel):
    start_lat: float = Field(..., ge=-90.0, le=90.0)
    start_lon: float = Field(..., ge=-180.0, le=180.0)
    end_lat: float = Field(..., ge=-90.0, le=90.0)
    end_lon: float = Field(..., ge=-180.0, le=180.0)

    @field_validator("start_lat", "start_lon", "end_lat", "end_lon")
    @classmethod
    def check_finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Coordinate must be a finite number")
        return v


# --------------------------------
# Distance & Polyline Decoding Helpers
# --------------------------------

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    x = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius * math.asin(math.sqrt(x))


def decode_polyline6(encoded: str) -> list[list[float]]:
    """Decode Valhalla precision-6 encoded polyline into [lon, lat] GeoJSON coordinates."""
    coords: list[list[float]] = []
    index = 0
    lat = 0
    lon = 0
    length = len(encoded)

    while index < length:
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlon = ~(result >> 1) if (result & 1) else (result >> 1)
        lon += dlon

        coords.append([round(lon / 1e6, 6), round(lat / 1e6, 6)])

    return coords


def build_google_maps_url(start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> str:
    return (
        f"https://www.google.com/maps/dir/?api=1"
        f"&origin={start_lat},{start_lon}"
        f"&destination={end_lat},{end_lon}"
        f"&travelmode=walking"
    )


# --------------------------------
# Health Check API
# --------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "project": "GBU CampusGuide",
        "version": "2.0.0",
        "verified_locations_count": len(VERIFIED_LOCATIONS),
    }


# --------------------------------
# Campus Locations API
# --------------------------------

@app.get("/api/locations")
def locations(include_pending: bool = False):
    if include_pending:
        return ALL_LOCATIONS
    return VERIFIED_LOCATIONS


@app.get("/api/locations/{location_id}")
def get_location_by_id(location_id: str):
    target = location_id.strip().upper()
    for loc in VERIFIED_LOCATIONS:
        if loc["id"].upper() == target:
            return loc
    raise HTTPException(
        status_code=404,
        detail=f"Verified campus location '{location_id}' not found.",
    )


@app.get("/api/search")
def search_locations(q: str = Query("", min_length=0, max_length=100)):
    term = q.strip().lower()
    if not term:
        return VERIFIED_LOCATIONS

    matches = []
    for loc in VERIFIED_LOCATIONS:
        haystack = " ".join([
            loc.get("id", ""),
            loc.get("name", ""),
            loc.get("name_hi", ""),
            loc.get("category", ""),
            loc.get("category_hi", ""),
            loc.get("description", ""),
            loc.get("description_hi", ""),
        ]).lower()
        if term in haystack:
            matches.append(loc)
    return matches


@app.get("/api/nearby")
def nearby_locations(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    radius_m: float = Query(1500.0, gt=0.0, le=10000.0),
):
    if not (math.isfinite(lat) and math.isfinite(lon) and math.isfinite(radius_m)):
        raise HTTPException(status_code=422, detail="Invalid coordinates or radius.")

    nearby = []
    for loc in VERIFIED_LOCATIONS:
        dist = haversine(lat, lon, loc["latitude"], loc["longitude"])
        if dist <= radius_m:
            nearby.append({
                **loc,
                "distance_m": round(dist, 1),
            })

    nearby.sort(key=lambda item: item["distance_m"])
    return nearby


# --------------------------------
# Campus Waypoints & Landmarks APIs
# --------------------------------

@app.get("/api/waypoints")
def get_waypoints():
    return WAYPOINTS


@app.get("/api/landmarks")
def get_landmarks():
    return LANDMARKS


# --------------------------------
# Pedestrian Routing Providers
# --------------------------------

async def fetch_valhalla_pedestrian_route(
    client: httpx.AsyncClient, req: RouteRequest
) -> Optional[dict]:
    payload = {
        "locations": [
            {"lat": req.start_lat, "lon": req.start_lon},
            {"lat": req.end_lat, "lon": req.end_lon},
        ],
        "costing": "pedestrian",
        "directions_options": {"units": "kilometers", "language": "en-US"},
    }
    response = await client.post(VALHALLA_URL, json=payload)
    response.raise_for_status()
    data = response.json()

    trip = data.get("trip")
    if not trip or not trip.get("legs"):
        return None

    all_coords: list[list[float]] = []
    steps: list[dict] = []
    total_distance_km = 0.0
    total_duration_s = 0.0

    for leg in trip["legs"]:
        summary = leg.get("summary", {})
        total_distance_km += float(summary.get("length", 0.0))
        total_duration_s += float(summary.get("time", 0.0))

        leg_coords = decode_polyline6(leg.get("shape", ""))
        if all_coords and leg_coords and all_coords[-1] == leg_coords[0]:
            all_coords.extend(leg_coords[1:])
        else:
            all_coords.extend(leg_coords)

        for maneuver in leg.get("maneuvers", []):
            instruction = (maneuver.get("instruction") or "Continue walking").strip()
            dist_m = round(float(maneuver.get("length", 0.0)) * 1000.0)
            dur_s = round(float(maneuver.get("time", 0.0)))
            begin_idx = maneuver.get("begin_shape_index")
            coord = (
                all_coords[begin_idx]
                if isinstance(begin_idx, int) and 0 <= begin_idx < len(all_coords)
                else None
            )
            steps.append({
                "instruction": instruction,
                "distance_m": dist_m,
                "duration_s": dur_s,
                "coordinate": coord,
            })

    if len(all_coords) < 2:
        return None

    return {
        "source": "Valhalla pedestrian routing",
        "profile": "pedestrian",
        "estimated": False,
        "distance_m": round(total_distance_km * 1000.0),
        "duration_s": round(total_duration_s),
        "coordinates": all_coords,
        "steps": steps,
        "landmarks": [],
    }


async def fetch_osrm_foot_route(
    client: httpx.AsyncClient, req: RouteRequest
) -> Optional[dict]:
    # Uses proper /foot/ profile instead of /driving/
    url = (
        f"{OSRM_FOOT_URL}/"
        f"{req.start_lon},{req.start_lat};"
        f"{req.end_lon},{req.end_lat}"
    )
    response = await client.get(
        url,
        params={
            "overview": "full",
            "geometries": "geojson",
            "steps": "true",
        },
    )
    response.raise_for_status()
    data = response.json()

    if not data.get("routes"):
        return None

    route_data = data["routes"][0]
    coords = route_data.get("geometry", {}).get("coordinates", [])
    if len(coords) < 2:
        return None

    steps = []
    for leg in route_data.get("legs", []):
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver", {})
            maneuver_type = maneuver.get("type", "")
            modifier = maneuver.get("modifier", "")

            if maneuver_type == "depart":
                instruction = "Start walking"
            elif maneuver_type == "arrive":
                instruction = "You have reached your destination"
            elif maneuver_type:
                instruction = f"{maneuver_type.replace('-', ' ').title()} {modifier}".strip()
            else:
                instruction = step.get("name") or step.get("ref") or "Continue"

            if step.get("name") and maneuver_type not in ("depart", "arrive"):
                instruction += f" onto {step['name']}"

            steps.append({
                "instruction": instruction,
                "distance_m": round(float(step.get("distance", 0))),
                "duration_s": round(float(step.get("duration", 0))),
                "coordinate": maneuver.get("location"),
            })

    return {
        "source": "OpenStreetMap foot routing",
        "profile": "foot",
        "estimated": False,
        "distance_m": round(float(route_data.get("distance", 0))),
        "duration_s": round(float(route_data.get("duration", 0))),
        "coordinates": coords,
        "steps": steps,
        "landmarks": [],
    }


# --------------------------------
# Direct Walking Route API
# --------------------------------

@app.post("/api/route")
async def route(req: RouteRequest):
    # Reject identical start and end points
    direct_dist_m = haversine(req.start_lat, req.start_lon, req.end_lat, req.end_lon)
    if direct_dist_m < 3.0:
        return {
            "source": "On-site arrival",
            "profile": "pedestrian",
            "estimated": False,
            "distance_m": 0,
            "duration_s": 0,
            "coordinates": [[req.start_lon, req.start_lat], [req.end_lon, req.end_lat]],
            "steps": [
                {
                    "instruction": "You are already at your destination",
                    "distance_m": 0,
                    "duration_s": 0,
                    "coordinate": [req.end_lon, req.end_lat],
                }
            ],
            "landmarks": [],
        }

    # Guard against unrealistic cross-country coordinates for campus routing
    if direct_dist_m > 25000.0:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Start point is too far from campus for pedestrian campus routing.",
                "distance_m": round(direct_dist_m),
                "google_maps_fallback": build_google_maps_url(
                    req.start_lat, req.start_lon, req.end_lat, req.end_lon
                ),
            },
        )

    provider_errors = []

    async with httpx.AsyncClient(
        timeout=20.0,
        headers={"User-Agent": "GBU-CampusGuide/2.0"},
    ) as client:
        # Primary: Valhalla Pedestrian Routing
        try:
            valhalla_result = await fetch_valhalla_pedestrian_route(client, req)
            if valhalla_result:
                return valhalla_result
            provider_errors.append("Valhalla returned no pedestrian route.")
        except Exception as exc:
            provider_errors.append(f"Valhalla error: {type(exc).__name__}: {exc}")

        # Secondary: OSRM Foot Routing (with /foot/ profile, never /driving/)
        try:
            osrm_result = await fetch_osrm_foot_route(client, req)
            if osrm_result:
                return osrm_result
            provider_errors.append("OSRM foot routing returned no route.")
        except Exception as exc:
            provider_errors.append(f"OSRM error: {type(exc).__name__}: {exc}")

    # NEVER fabricate a straight-line route as a walking route!
    raise HTTPException(
        status_code=502,
        detail={
            "error": "Pedestrian routing providers are currently unavailable or destination is unreachable on mapped footpaths.",
            "reasons": provider_errors,
            "google_maps_fallback": build_google_maps_url(
                req.start_lat, req.start_lon, req.end_lat, req.end_lon
            ),
        },
    )
