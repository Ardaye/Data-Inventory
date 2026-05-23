import { NextResponse } from "next/server";
import { releaseExpiredReservations } from "@/lib/reservations";

export async function GET(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");

  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await releaseExpiredReservations();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to release expired reservations", error);

    return NextResponse.json(
      { error: "Unable to release expired reservations right now." },
      { status: 500 },
    );
  }
}
