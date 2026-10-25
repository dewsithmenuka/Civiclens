import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';

/** Adds a correlation id (x-request-id) and emits one structured JSON log line per request. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', requestId);
    const started = Date.now();
    const log = (status: number) => {
      if (process.env.NODE_ENV === 'test') return;
      console.log(JSON.stringify({
        level: status >= 500 ? 'error' : 'info', msg: 'http_request', requestId,
        method: req.method, path: req.originalUrl?.split('?')[0], status,
        durationMs: Date.now() - started, userId: req.user?.sub,
      }));
    };
    return next.handle().pipe(tap({ next: () => log(res.statusCode), error: (e) => log(e?.status ?? 500) }));
  }
}
