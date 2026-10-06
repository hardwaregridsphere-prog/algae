import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import jwt from 'jsonwebtoken';

export class SocketService {
  private static io: Server;

  static init(server: HttpServer) {
    this.io = new Server(server, {
      cors: { origin: env.CORS_ORIGIN }
    });

    // JWT Authentication for WebSockets
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: Token missing'));
      try {
        jwt.verify(token, env.JWT_ACCESS_SECRET);
        next();
      } catch (err) {
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`Admin client connected to WebSocket: ${socket.id}`);
      
      socket.on('disconnect', () => {
        logger.info(`Admin client disconnected: ${socket.id}`);
      });
    });
  }

  // Used by MQTT Handlers to broadcast data to the frontend
  static emitToAdmin(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}