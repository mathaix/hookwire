import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ApprovalDecisionError,
  recordApprovalDecision,
  type ApprovalDecision
} from "./decision-service";

type DecisionRouteContext = {
  params: Promise<{ approvalId: string }> | { approvalId: string };
};

export async function handleDecisionRequest(
  request: Request,
  context: DecisionRouteContext,
  decision: ApprovalDecision
) {
  try {
    const params = await context.params;
    const organizationId = request.headers.get("x-hookwire-organization-id");
    const userId = request.headers.get("x-hookwire-user-id");

    if (!organizationId || !userId) {
      return NextResponse.json(
        { code: "missing_identity", message: "Organization and user headers are required." },
        { status: 400 }
      );
    }

    const identityError = verifyIdentitySignature(request, organizationId, userId);
    if (identityError) {
      return NextResponse.json({ code: identityError.code, message: identityError.message }, { status: identityError.status });
    }

    const body = await parseJsonBody(request);
    const result = await recordApprovalDecision({
      approvalRequestId: params.approvalId,
      decision,
      organizationId,
      reason: typeof body.reason === "string" ? body.reason : null,
      scope: typeof body.scope === "string" ? body.scope : null,
      userId
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    throw error;
  }
}

function verifyIdentitySignature(request: Request, organizationId: string, userId: string) {
  const secret = process.env.HOOKWIRE_INTERNAL_API_SECRET;
  if (!secret) {
    return {
      code: "identity_secret_not_configured",
      message: "Internal API identity signature secret is required.",
      status: 500
    };
  }

  const signature = request.headers.get("x-hookwire-identity-signature");
  if (!signature) {
    return {
      code: "missing_identity_signature",
      message: "Internal API identity signature is required.",
      status: 401
    };
  }

  const expected = createHmac("sha256", secret).update(`${organizationId}:${userId}`).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return {
      code: "invalid_identity_signature",
      message: "Internal API identity signature is invalid.",
      status: 401
    };
  }

  return null;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
