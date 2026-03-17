import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class SalesLoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('SalesAPI');

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const { method, url } = request;

        return next.handle().pipe(
            tap((data) => {
                this.logger.log(`[${method}] ${url} - Response: ${JSON.stringify(data, null, 2)}`);
            }),
        );
    }
}
