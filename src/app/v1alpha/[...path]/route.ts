import { handleJulesApi } from "../../../../server/jules-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  return handleJulesRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleJulesRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleJulesRequest(request, context);
}

export async function OPTIONS(request: Request, context: RouteContext) {
  return handleJulesRequest(request, context);
}

async function handleJulesRequest(request: Request, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  return handleJulesApi(request, path);
}
