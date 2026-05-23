import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { runWithIdempotency, IdempotencyConflictError } from "@/lib/idempotency";
import { confirmReservation } from "@/lib/reservations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const requestHash = createHash("sha256").update(`confirm:${id}`).digest("hex");

    const result = await runWithIdempotency(
      "confirm",
      idempotencyKey,
      requestHash,
      async () => {
        const reservation = await confirmReservation(id);

        return {
          statusCode: 200,
          body: reservation,
        };
      },
      "Unable to confirm reservation right now.",
    );

    return NextResponse.json(result.body, { status: result.statusCode });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }

    console.error("Failed to confirm reservation", error);

    return NextResponse.json(
      { error: "Unable to confirm reservation right now." },
      { status: 500 },
    );
  }
}
