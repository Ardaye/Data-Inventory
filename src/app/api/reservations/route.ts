import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { runWithIdempotency, IdempotencyConflictError } from "@/lib/idempotency";
import { createReservation } from "@/lib/reservations";
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

    const idempotencyKey = request.headers.get("Idempotency-Key");
    const requestHash = createHash("sha256")
      .update(`reserve:${parsed.data.productId}:${parsed.data.warehouseId}:${parsed.data.quantity}`)
      .digest("hex");

    const result = await runWithIdempotency(
      "reserve",
      idempotencyKey,
      requestHash,
      async () => {
        const reservation = await createReservation(
          parsed.data.productId,
          parsed.data.warehouseId,
          parsed.data.quantity,
        );

        return {
          statusCode: 201,
          body: reservation,
        };
      },
      "Unable to create reservation right now.",
    );

    return NextResponse.json(result.body, { status: result.statusCode });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }

    console.error("Failed to create reservation", error);

    return NextResponse.json(
      { error: "Unable to create reservation right now." },
      { status: 500 },
    );
  }
}
