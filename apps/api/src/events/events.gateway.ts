import { Inject, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service.js";

@WebSocketGateway({
  namespace: "/events",
  transports: ["websocket"],
  cors: false,
})
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const token = client.handshake.auth.token;

    if (typeof token !== "string") {
      client.disconnect(true);
      return;
    }

    try {
      const auth = await this.authService.resolveToken(token);
      client.data.auth = auth;
      await client.join(`site:${auth.siteId}`);
    } catch {
      this.logger.warn(`Conexión de eventos rechazada: ${client.id}`);
      client.disconnect(true);
    }
  }

  publish(siteId: string, eventType: string, payload: Record<string, unknown>) {
    this.server.to(`site:${siteId}`).emit(eventType, payload);
  }
}
