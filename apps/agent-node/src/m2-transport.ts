import { WebSocket } from 'ws';
import type { Logger } from '../../../packages/runtime/src/log.ts';
import type { Transport } from './ports.ts';

export type ControlFrame = { kind: string; [key: string]: unknown };
export type ControlHandler = (frame: ControlFrame) => void;

// Connects to the hub over wss, validating its certificate against the supplied development CA. Verification
// is never disabled. Authentication travels in connection headers, so the bootstrap secret stays out of the URL.
export class M2Transport implements Transport {
  private readonly socket: WebSocket;
  private readonly log: Logger;

  constructor(url: URL, agentId: string, secret: string, ca: Buffer, log: Logger) {
    this.socket = new WebSocket(url, {
      ca, maxPayload: 64 * 1024,
      headers: { 'x-meetmesh-agent': agentId, 'x-meetmesh-secret': secret },
    });
    this.log = log;
  }

  async connect(onDomain: (raw: string) => void, onControl: ControlHandler, disconnected: () => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { reject(new Error('Hub handshake timed out')); this.socket.terminate(); }, 5000);
      this.socket.on('message', data => {
        const raw = data.toString();
        let frame: ControlFrame | undefined;
        try { const parsed = JSON.parse(raw) as unknown; if (parsed && typeof parsed === 'object' && 'kind' in parsed) frame = parsed as ControlFrame; }
        catch { onDomain(raw); return; }
        if (!frame) { onDomain(raw); return; }
        if (frame.kind === 'ready') { ready = true; clearTimeout(timeout); resolve(); return; }
        if (frame.kind === 'error') this.log('hub.error', { direction: 'inbound', outcome: String(frame.code) });
        onControl(frame);
      });
      this.socket.on('error', error => { this.log('transport.error', { outcome: error.message }); if (!ready) { clearTimeout(timeout); reject(error); } });
      this.socket.on('close', () => { clearTimeout(timeout); if (!ready) reject(new Error('Hub closed the connection before it was ready')); else disconnected(); });
    });
  }

  send(frame: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Hub connection is not open');
    this.socket.send(frame);
  }

  sendControl(frame: ControlFrame): void { this.send(JSON.stringify(frame)); }

  close(): void { this.socket.terminate(); }
}
