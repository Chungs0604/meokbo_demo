import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';

/**
 * Claude Code 훅(native/macos/hook-client.swift)이 보내는 이벤트를 받는 유닉스 소켓 서버.
 *
 * 훅은 한 줄 쓰고 바로 끊는다. 응답을 주지 않는다 —
 * 훅이 우리 응답을 기다리면 Claude Code 가 그만큼 느려지기 때문이다.
 *
 * events
 *  - `hook`  : { event, payload }
 *  - `error` : Error
 */
export class IpcServer extends EventEmitter {
  #server = null;
  #socketPath;

  constructor(socketPath = null) {
    super();
    this.#socketPath = socketPath ?? path.join(app.getPath('userData'), 'ipc.sock');
  }

  get socketPath() {
    return this.#socketPath;
  }

  async start() {
    fs.mkdirSync(path.dirname(this.#socketPath), { recursive: true });

    // 비정상 종료로 남은 소켓 파일이 있으면 listen 이 EADDRINUSE 로 실패한다.
    // 실제로 살아 있는 서버인지 먼저 확인하고, 죽은 것이면 치운다.
    if (fs.existsSync(this.#socketPath)) {
      if (await this.#isAlive()) {
        throw new Error(`다른 claude-cs 인스턴스가 ${this.#socketPath} 를 쓰고 있다.`);
      }
      fs.unlinkSync(this.#socketPath);
    }

    this.#server = net.createServer((socket) => {
      const lines = readline.createInterface({ input: socket });
      lines.on('line', (line) => this.#handleLine(line));
      socket.on('error', () => {});   // 훅이 쓰자마자 끊는 건 정상이다
    });

    this.#server.on('error', (error) => this.emit('error', error));

    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#socketPath, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  /** 소켓 파일이 살아 있는 서버의 것인지 확인한다. */
  #isAlive() {
    return new Promise((resolve) => {
      const probe = net.connect(this.#socketPath);
      const done = (alive) => {
        probe.destroy();
        resolve(alive);
      };
      probe.once('connect', () => done(true));
      probe.once('error', () => done(false));
      setTimeout(() => done(false), 300);
    });
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const message = JSON.parse(trimmed);
      this.emit('hook', { event: message.event ?? 'unknown', payload: message.payload ?? {} });
    } catch (error) {
      this.emit('error', new Error(`훅 메시지를 파싱하지 못했다: ${error.message}`));
    }
  }

  stop() {
    this.#server?.close();
    this.#server = null;
    try {
      if (fs.existsSync(this.#socketPath)) fs.unlinkSync(this.#socketPath);
    } catch {
      // 종료 경로다. 소켓 파일을 못 지워도 다음 실행이 알아서 정리한다.
    }
  }
}
