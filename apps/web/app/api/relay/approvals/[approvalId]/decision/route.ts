import { NextResponse } from "next/server";
import { getRelayApprovalDecision, RelayApprovalApiError } from "../../relay-approval-service";

type RouteContext = {
  params: Promise<{ approvalId: string }> | { approvalId: string };
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const canonicalPath = `/api/relay/approvals/${params.approvalId}/decision`;
    const result = await getRelayApprovalDecision({
      approvalRequestId: params.approvalId,
      headers: request.headers,
      method: request.method,
      path: canonicalPath,
      rawBody: ""
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof RelayApprovalApiError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    throw error;
  }
}
