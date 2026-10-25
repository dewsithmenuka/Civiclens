import { lonLatToTile, roomForPoint, roomsForBBox, TILE_ZOOM } from './tiles';

describe('viewport tiles', () => {
  it('maps a known point to the expected z14 tile (NYC City Hall)', () => {
    expect(lonLatToTile(-74.006, 40.7128, 14)).toEqual({ x: 4823, y: 6160 });
  });
  it('a point is always inside the rooms of a bbox that contains it', () => {
    const rooms = roomsForBBox({ minLng: -74.02, minLat: 40.70, maxLng: -73.99, maxLat: 40.72 })!;
    expect(rooms).toContain(roomForPoint(-74.006, 40.7128));
  });
  it('rejects viewports that need too many tiles', () => {
    expect(roomsForBBox({ minLng: -75, minLat: 40, maxLng: -73, maxLat: 41 })).toBeNull();
  });
  it('uses the configured zoom in room names', () => {
    expect(roomForPoint(0, 0)).toMatch(new RegExp(`^tile:${TILE_ZOOM}:`));
  });
});
