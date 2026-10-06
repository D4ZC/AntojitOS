import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module.js";
import { OutboxService } from "./outbox.service.js";
import { OutboxWorker } from "./outbox.worker.js";

@Module({
  imports: [EventsModule],
  providers: [OutboxService, OutboxWorker],
  exports: [OutboxService],
})
export class OutboxModule {}
