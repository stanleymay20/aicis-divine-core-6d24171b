export async function requireCronSecret(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");

  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "");

  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized cron request" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

export function userIsAdmin(user: any): boolean {
  return (
    user?.app_metadata?.role === "admin" ||
    user?.user_metadata?.role === "admin" ||
    user?.app_metadata?.roles?.includes?.("admin")
  );
}
