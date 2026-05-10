import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const headerId = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(headerId) ? headerId[0] : headerId)?.toString().trim() ||
      randomUUID();

    res.setHeader('x-request-id', requestId);
    this.requestContext.run(requestId, next);
  }
}
