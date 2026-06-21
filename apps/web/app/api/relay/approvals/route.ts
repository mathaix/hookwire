import { NextResponse } from "next/server";
import { createRelayApprovalRequest, RelayApprovalApiError } from "./relay-approval-service";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const result = await createRelayApprovalRequest({
      headers: request.headers,
      method: request.method,
      path: new URL(request.url).pathname,
      rawBody
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RelayApprovalApiError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    throw error;
  }
}
