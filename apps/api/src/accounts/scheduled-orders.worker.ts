import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DATABASE, type DatabasePort } from "../database/database.port.js";
import { AccountsService } from "./accounts.service.js";

@Injectable()
export class ScheduledOrdersWorker {
  private readonly logger = new Logger(ScheduledOrdersWorker.name);
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  @Interval(5_000)
  async dispatchDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.database.query<{ id: string }>(
        `SELECT accounts.id FROM service_accounts accounts
          WHERE accounts.status = 'open' AND accounts.scheduled_for <= now()
            AND accounts.schedule_dispatched_at IS NULL
            AND (accounts.schedule_retry_after IS NULL OR accounts.schedule_retry_after <= now())
            AND EXISTS (
              SELECT 1 FROM order_items items WHERE items.account_id = accounts.id
                AND items.preparation_state = 'pending'
            )
          ORDER BY accounts.scheduled_for, accounts.id LIMIT 25`,
      );
      for (const account of due.rows) {
        try {
          await this.accounts.dispatchScheduledAccount(account.id);
        } catch (error) {
          // The entire dispatch rolls back. Keeping the due date retries after
          // transient failures and process restarts without losing the order.
          const message = error instanceof Error ? error.message : "Error desconocido";
          this.logger.error(`No se envió el pedido programado ${account.id}: ${message}`);
          await this.database.query(
            `UPDATE service_accounts SET schedule_retry_after = now() + interval '30 seconds',
                schedule_last_error = $2
              WHERE id = $1 AND status = 'open' AND schedule_dispatched_at IS NULL
                AND scheduled_for <= now()`,
            [account.id, message.slice(0, 500)],
          );
        }
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : "Error al buscar pedidos programados");
    } finally {
      this.running = false;
    }
  }
}
