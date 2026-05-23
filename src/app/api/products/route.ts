import { NextResponse } from "next/server";
import { listProductsWithAvailability } from "@/lib/reservations";

export async function GET() {
  try {
    const products = await listProductsWithAvailability();

    return NextResponse.json(products);
  } catch (error) {
    console.error("Failed to load products", error);

    return NextResponse.json(
      { error: "Unable to load products right now." },
      { status: 500 },
    );
  }
}
