import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../config/logger';

export class RealtimeHub {
  private static instance: RealtimeHub;
  private io: Server | null = null;

  private constructor() {}

  public static getInstance(): RealtimeHub {
    if (!RealtimeHub.instance) {
      RealtimeHub.instance = new RealtimeHub();
    }
    return RealtimeHub.instance;
  }

  public initialize(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: env.CORS_ORIGIN === '*' ? false : env.CORS_ORIGIN.split(','),
        credentials: true,
      },
    });

    this.io.use((socket: Socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Authentication token required'));
      }
      try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
        (socket as any).user = decoded;
        next();
      } catch (err) {
        next(new Error('Invalid or expired socket credentials'));
      }
    });

    this.io.on('connection', (socket) => {
      const user = (socket as any).user;
      logger.info({ operation: 'SOCKET_CONNECTED', socketId: socket.id, userId: user?.sub });

      socket.on('subscribe:device', (deviceUid: string) => {
        socket.join(`device:${deviceUid}`);
      });

      socket.on('disconnect', () => {
        logger.info({ operation: 'SOCKET_DISCONNECTED', socketId: socket.id });
      });
    });
  }

  public emitToDevice(deviceUid: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(`device:${deviceUid}`).emit(event, payload);
    this.io.emit(`${event}:${deviceUid}`, payload);
  }

  public emitGlobal(event: string, payload: any) {
    if (!this.io) return;
    this.io.emit(event, payload);
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.io) return resolve();
      this.io.close(() => {
        logger.info('[Socket.IO] Cleanly closed all socket channels.');
        resolve();
      });
    });
  }
}