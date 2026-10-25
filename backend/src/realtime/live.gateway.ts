import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { IssueView, RealtimeEvent, VIEWPORT_SUBSCRIBE } from '@civiclens/contracts';
import { getConfig } from '../config';
import { roomForPoint, roomsForBBox } from './tiles';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Viewport-scoped realtime: clients join only the map tiles they can see, so a pothole
 * in one city never wakes a phone in another. PostgreSQL stays the source of truth;
 * this is purely a delivery mechanism (see ADR-003). Events carry the *public* (approximate) view.
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: getConfig().corsOrigins.length ? getConfig().corsOrigins : true } })
export class LiveGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage(VIEWPORT_SUBSCRIBE)
  async onSubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: any) {
    const b = body?.bbox ?? body;
    if (![b?.minLng, b?.minLat, b?.maxLng, b?.maxLat].every(isNum)) return { ok: false, error: 'invalid_bbox' };
    const rooms = roomsForBBox(b);
    if (!rooms) return { ok: false, error: 'viewport_too_large' };
    for (const r of socket.rooms) if (r.startsWith('tile:')) await socket.leave(r);
    await socket.join(rooms);
    return { ok: true, tiles: rooms.length };
  }

  publish(event: RealtimeEvent, issue: IssueView) {
    // In multi-instance deployments swap in the Redis adapter (v0.3) — the call site doesn't change.
    this.server?.to(roomForPoint(issue.location.lng, issue.location.lat)).emit(event, issue);
  }
}
