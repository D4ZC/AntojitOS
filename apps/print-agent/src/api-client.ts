import type { AgentCredentials, PrintJob } from "./types.js";

const messageFrom = (body: unknown): string => {
  if (body && typeof body === "object" && "message" in body) {
    return String((body as { message: unknown }).message);
  }
  return "El servidor local rechazó la solicitud";
};

export class ProductionAgentApi {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: AgentCredentials,
  ) {}

  static async register(
    baseUrl: string,
    bootstrapToken: string,
    input: {
      siteCode: string;
      code: string;
      displayName: string;
      centerCodes: string[];
      registerCodes: string[];
    },
  ): Promise<AgentCredentials> {
    const response = await fetch(`${baseUrl}/v1/production-agents/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bootstrap-token": bootstrapToken,
      },
      body: JSON.stringify(input),
    });
    const body = await response.json() as { id?: string; token?: string; message?: unknown };
    if (!response.ok || !body.id || !body.token) throw new Error(messageFrom(body));
    return { id: body.id, token: body.token };
  }

  claim(): Promise<{ job: PrintJob | null }> {
    return this.request("/v1/production-agent/jobs/claim", { method: "POST" });
  }

  complete(job: PrintJob): Promise<{ status: string }> {
    return this.request(`/v1/production-agent/jobs/${job.id}/complete`, {
      method: "POST",
      body: { claimToken: job.claimToken },
    });
  }

  fail(job: PrintJob, error: string): Promise<{ status: string; willRetry: boolean }> {
    return this.request(`/v1/production-agent/jobs/${job.id}/fail`, {
      method: "POST",
      body: { claimToken: job.claimToken, error: error.slice(0, 500) },
    });
  }

  private async request<Response>(
    path: string,
    options: { method: string; body?: unknown },
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        "x-agent-id": this.credentials.id,
        "x-agent-token": this.credentials.token,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => null) as Response;
    if (!response.ok) throw new Error(messageFrom(body));
    return body;
  }
}
