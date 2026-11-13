type StaffUser = {
  id?: string;
  email?: string;
  login?: string;
  displayName?: string;
  role?: string;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function requirePackageAdmin(request: Request): Promise<{ ok: true; user: StaffUser } | { ok: false; response: Response }> {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie) return { ok: false, response: json({ ok: false, error: "UNAUTHORIZED" }, 401) };

  let response: Response;
  try {
    response = await fetch("https://iumrah.app/api/auth/staff/session", {
      method: "GET",
      headers: {
        cookie,
        accept: "application/json",
        "user-agent": request.headers.get("user-agent") ?? "iumrah-business",
      },
      redirect: "manual",
    });
  } catch {
    return { ok: false, response: json({ ok: false, error: "AUTH_SERVICE_UNAVAILABLE" }, 503) };
  }

  if (!response.ok) return { ok: false, response: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
  const payload = await response.json().catch(() => null) as { user?: StaffUser } | null;
  const user = payload?.user;
  const role = String(user?.role ?? "").toLowerCase();
  if (!user || !["superadmin", "admin"].includes(role)) {
    return { ok: false, response: json({ ok: false, error: "FORBIDDEN" }, 403) };
  }
  return { ok: true, user };
}
