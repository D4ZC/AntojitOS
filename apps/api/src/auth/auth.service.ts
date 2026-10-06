import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { AppConfigService } from "../config/app-config.service.js";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
} from "../database/database.port.js";
import type { AuthContext } from "../security/auth-context.js";
import {
  createOpaqueToken,
  hashDeviceToken,
  hashSessionToken,
  safeTokenMatches,
} from "../security/token.js";
import type { LoginDto } from "./dto/login.dto.js";

interface LoginRow extends DatabaseRow {
  user_id: string;
  site_id: string;
  display_name: string;
  pin_hash: string;
  locked_until: Date | string | null;
  device_token_hash: string;
}

interface SessionRow extends DatabaseRow {
  session_id: string;
  site_id: string;
  user_id: string;
  terminal_id: string;
  display_name: string;
  permissions: string[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async login(input: LoginDto): Promise<{
    accessToken: string;
    expiresAt: string;
    user: { id: string; displayName: string; permissions: string[] };
  }> {
    const result = await this.database.query<LoginRow>(
      `SELECT
         users.id AS user_id,
         users.site_id,
         users.display_name,
         credentials.pin_hash,
         credentials.locked_until,
         terminals.device_token_hash
       FROM app_users users
       JOIN user_pin_credentials credentials ON credentials.user_id = users.id
       JOIN terminals ON terminals.id = $1 AND terminals.site_id = users.site_id
       WHERE users.employee_code = $2
         AND users.status = 'active'
         AND terminals.status = 'active'`,
      [input.terminalId, input.employeeCode.toUpperCase()],
    );
    const record = result.rows[0];

    if (!record) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    if (
      !safeTokenMatches(
        hashDeviceToken(input.deviceToken),
        record.device_token_hash,
      )
    ) {
      throw new UnauthorizedException("Terminal no autorizada");
    }

    if (record.locked_until && new Date(record.locked_until).getTime() > Date.now()) {
      throw new HttpException(
        "Usuario temporalmente bloqueado",
        HttpStatus.LOCKED,
      );
    }

    if (!(await verify(record.pin_hash, input.pin))) {
      await this.database.query(
        `UPDATE user_pin_credentials
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                  WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
                  ELSE NULL
                END,
                updated_at = now()
          WHERE user_id = $1`,
        [record.user_id],
      );
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const accessToken = createOpaqueToken();
    const tokenHash = hashSessionToken(accessToken, this.config.sessionPepper);
    const expiresAt = new Date(
      Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000,
    );

    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE user_pin_credentials
            SET failed_attempts = 0, locked_until = NULL, updated_at = now()
          WHERE user_id = $1`,
        [record.user_id],
      );
      await transaction.query(
        `INSERT INTO user_sessions (
          id, site_id, user_id, terminal_id, token_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          record.site_id,
          record.user_id,
          input.terminalId,
          tokenHash,
          expiresAt,
        ],
      );
    });

    const auth = await this.resolveToken(accessToken);
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: auth.userId,
        displayName: auth.displayName,
        permissions: auth.permissions,
      },
    };
  }

  async resolveToken(accessToken: string): Promise<AuthContext> {
    const tokenHash = hashSessionToken(accessToken, this.config.sessionPepper);
    const result = await this.database.query<SessionRow>(
      `SELECT
         sessions.id AS session_id,
         sessions.site_id,
         sessions.user_id,
         sessions.terminal_id,
         users.display_name,
         COALESCE(
           array_agg(DISTINCT role_permissions.permission_code)
             FILTER (WHERE role_permissions.permission_code IS NOT NULL),
           ARRAY[]::text[]
         ) AS permissions
       FROM user_sessions sessions
       JOIN app_users users ON users.id = sessions.user_id
       JOIN terminals ON terminals.id = sessions.terminal_id
       LEFT JOIN user_roles ON user_roles.user_id = users.id
       LEFT JOIN role_permissions ON role_permissions.role_id = user_roles.role_id
       WHERE sessions.token_hash = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now()
         AND users.status = 'active'
         AND terminals.status = 'active'
       GROUP BY sessions.id, users.id`,
      [tokenHash],
    );
    const record = result.rows[0];

    if (!record) {
      throw new UnauthorizedException("Sesión inválida o expirada");
    }

    return {
      sessionId: record.session_id,
      siteId: record.site_id,
      userId: record.user_id,
      terminalId: record.terminal_id,
      displayName: record.display_name,
      permissions: record.permissions,
    };
  }
}
