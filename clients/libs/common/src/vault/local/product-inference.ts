import { AgentTarget, FormAsksV1, validateFormAsks } from "../agent/targets";

export interface ProductInferenceSession {
  installationId: string;
  identityUrl: string;
  accountToken: string | null;
}
export interface DecisionRequest {
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
  model?: string;
}
export class ReadingServiceUnavailableError extends Error {
  constructor(readonly status: number) {
    super("The reading service is unavailable. Try again when connected.");
  }
}

/** App-owned service authorization is separate from vault keys and agent credentials. */
export class ProductInference {
  private guest: { installationId: string; identityUrl: string; token: string; expiresAt: number } | null = null;

  constructor(
    private readonly session: () => Promise<ProductInferenceSession>,
    private readonly relayUrl = "https://decision.vowkey.com",
    private readonly request: typeof fetch = fetch,
  ) {}

  async decide(input: DecisionRequest): Promise<unknown> {
    return this.send("/v1/systemone", {
      state: input.state, questions: input.questions, ...(input.model == null ? {} : { model: input.model }),
    });
  }

  async describe(target: AgentTarget): Promise<FormAsksV1> {
    const result = await this.send("/v1/forms/describe", {
      v: 1, targetId: target.targetId, formSignature: target.formSignature,
      sections: target.sections.map(({ id, label }) => ({ id, label })),
      fields: target.fields.map(({ id, sectionId, label, type, options, format }) => ({
        id, sectionId, label, type, options, ...(format == null ? {} : { format }),
      })),
    });
    if (!validateFormAsks(result, target)) {
      throw new ReadingServiceUnavailableError(502);
    }
    return result;
  }

  private async authorization(session: ProductInferenceSession): Promise<string> {
    if (session.accountToken != null) {
      return session.accountToken;
    }
    if (this.guest == null || this.guest.installationId !== session.installationId ||
      this.guest.identityUrl !== session.identityUrl || this.guest.expiresAt <= Date.now() + 30_000) {
      const response = await this.request(`${session.identityUrl.replace(/\/$/, "")}/guest-decision/grant`, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: session.installationId }),
      });
      if (!response.ok) {
        throw new ReadingServiceUnavailableError(response.status);
      }
      const grant: unknown = await response.json();
      if (grant == null || typeof grant !== "object" || !("token" in grant) || typeof grant.token !== "string" ||
        !("expiresIn" in grant) || typeof grant.expiresIn !== "number" || grant.expiresIn <= 0) {
        throw new ReadingServiceUnavailableError(502);
      }
      this.guest = {
        installationId: session.installationId, identityUrl: session.identityUrl,
        token: grant.token, expiresAt: Date.now() + grant.expiresIn * 1000,
      };
    }
    return this.guest.token;
  }

  private async send(path: string, body: unknown): Promise<unknown> {
    try {
      const session = await this.session();
      const token = await this.authorization(session);
      const response = await this.request(`${this.relayUrl.replace(/\/$/, "")}${path}`, {
        method: "POST", credentials: "omit", headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        }, body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 401 && session.accountToken == null) {
          this.guest = null;
        }
        throw new ReadingServiceUnavailableError(response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ReadingServiceUnavailableError) {
        throw error;
      }
      throw new ReadingServiceUnavailableError(0);
    }
  }
}
