export interface SessionRequest {
  readonly id: number;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
}

/** A result may update the session only while its exact request still owns it. */
export class SessionGuard {
  private sequence = 0;
  private active: SessionRequest | null = null;

  get busy(): boolean { return this.active !== null; }

  start(): SessionRequest | null {
    if (this.active) return null;
    const controller = new AbortController();
    const request = { id: ++this.sequence, controller, signal: controller.signal };
    this.active = request;
    return request;
  }

  owns(request: SessionRequest): boolean {
    return this.active === request && request.id === this.sequence;
  }

  valid(request: SessionRequest): boolean {
    return this.owns(request) && !request.signal.aborted;
  }

  finish(request: SessionRequest): boolean {
    if (!this.owns(request)) return false;
    this.active = null;
    return true;
  }

  cancel(): void {
    const previous = this.active;
    this.active = null;
    this.sequence++;
    previous?.controller.abort();
  }
}
