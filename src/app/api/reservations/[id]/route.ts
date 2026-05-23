import { NextResponse } from "next/server";
import { getReservationById } from "@/lib/reservations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const reservation = await getReservationById(id);

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json(reservation);
  } catch (error) {
    console.error("Failed to fetch reservation", error);

    return NextResponse.json(
      { error: "Unable to load reservation right now." },
      { status: 500 },
    );
  }
}
