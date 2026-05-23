import { NextResponse } from "next/server";
import { createReservation, ReservationConflictError } from "@/lib/reservations";
import { reserveSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = reserveSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const reservation = await createReservation(
      parsed.data.productId,
      parsed.data.warehouseId,
      parsed.data.quantity,
    );

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    if (error instanceof ReservationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error("Failed to create reservation", error);

    return NextResponse.json(
      { error: "Unable to create reservation right now." },
      { status: 500 },
    );
  }
}
