import { WebSocket } from 'ws';
import type { Logger } from '../../../packages/runtime/src/log.ts';
import type { Transport } from './ports.ts';

export class WebSocketTransport implements Transport {
  private readonly socket: WebSocket;
  private readonly log: Logger;

  constructor(url: URL, log: Logger) {
    this.socket = new WebSocket(url, { maxPayload: 64 * 1024 });
    this.log = log;
  }

  async connect(receive: (raw: string) => void, disconnected: () => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { reject(new Error('Hub handshake timed out')); this.socket.terminate(); }, 5000);
      this.socket.on('message', data => {
        const raw = data.toString();
        let control: { kind?: string; code?: string };
        try { control = JSON.parse(raw) as typeof control; }
        catch { receive(raw); return; }
        if (control?.kind === 'ready') {
          ready = true;
          clearTimeout(timeout);
          resolve();
        } else if (control?.kind === 'error') {
          this.log('relay.error', { direction: 'inbound', outcome: control.code });
        } else receive(raw);
      });
      this.socket.on('error', error => {
        this.log('transport.error', { outcome: error.message });
        if (!ready) { clearTimeout(timeout); reject(error); }
      });
      this.socket.on('close', () => {
        clearTimeout(timeout);
        if (!ready) reject(new Error('Hub closed the connection before registration'));
        else disconnected();
      });
    });
  }

  send(frame: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Hub connection is not open');
    this.socket.send(frame);
  }

  close(): void { this.socket.terminate(); }
}
