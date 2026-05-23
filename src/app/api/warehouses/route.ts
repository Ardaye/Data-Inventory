import { NextResponse } from "next/server";
import { listWarehouses } from "@/lib/reservations";

export async function GET() {
  try {
    const warehouses = await listWarehouses();

    return NextResponse.json(warehouses);
  } catch (error) {
    console.error("Failed to load warehouses", error);

    return NextResponse.json(
      { error: "Unable to load warehouses right now." },
      { status: 500 },
    );
  }
}
