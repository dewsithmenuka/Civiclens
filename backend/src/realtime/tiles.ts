import { BBox } from '@civiclens/contracts';

export const TILE_ZOOM = 14; // ~2.4 km tiles at mid-latitudes
const MAX_TILES = 64;

export function lonLatToTile(lng: number, lat: number, z = TILE_ZOOM): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

export const tileRoom = (z: number, x: number, y: number) => `tile:${z}:${x}:${y}`;
export const roomForPoint = (lng: number, lat: number) => {
  const t = lonLatToTile(lng, lat);
  return tileRoom(TILE_ZOOM, t.x, t.y);
};

/** Rooms covering a viewport. Returns null if the viewport would need too many tiles (client should zoom in). */
export function roomsForBBox(b: BBox): string[] | null {
  const a = lonLatToTile(b.minLng, b.maxLat); // north-west
  const c = lonLatToTile(b.maxLng, b.minLat); // south-east
  if ((c.x - a.x + 1) * (c.y - a.y + 1) > MAX_TILES) return null;
  const rooms: string[] = [];
  for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) rooms.push(tileRoom(TILE_ZOOM, x, y));
  return rooms;
}
