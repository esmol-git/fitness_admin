import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

type RequestContextState = {
  requestId: string;
};

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run(requestId: string, callback: () => void) {
    this.storage.run({ requestId }, callback);
  }

  getRequestId() {
    return this.storage.getStore()?.requestId ?? 'n/a';
  }
}
