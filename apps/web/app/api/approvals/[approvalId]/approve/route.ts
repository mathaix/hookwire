import { handleDecisionRequest } from "../../decision-route";

type RouteContext = {
  params: Promise<{ approvalId: string }> | { approvalId: string };
};

export async function POST(request: Request, context: RouteContext) {
  return handleDecisionRequest(request, context, "approved");
}
