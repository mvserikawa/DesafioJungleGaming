import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { appLogger } from '../../observability/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  public intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const correlationId =
      req.headers['x-correlation-id'] ||
      req.headers['idempotency-key'] ||
      `req-${Date.now()}`;

    const startTime = performance.now();

    return next.handle().pipe(
      tap(() => {
        const durationMs = Math.round(performance.now() - startTime);
        const res = context.switchToHttp().getResponse();

        appLogger.info('HTTP request processed', {
          correlationId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
        });
      }),
    );
  }
}
