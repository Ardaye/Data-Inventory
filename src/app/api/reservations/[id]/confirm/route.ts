import { NextResponse } from "next/server";
import { confirmReservation, ReservationGoneError } from "@/lib/reservations";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const reservation = await confirmReservation(id);

    return NextResponse.json(reservation);
  } catch (error) {
    if (error instanceof ReservationGoneError) {
      return NextResponse.json({ error: error.message }, { status: 410 });
    }

    console.error("Failed to confirm reservation", error);

    return NextResponse.json(
      { error: "Unable to confirm reservation right now." },
      { status: 500 },
    );
  }
}
