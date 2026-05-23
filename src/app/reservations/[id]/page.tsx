import { ReservationCheckout } from "@/components/reservation-checkout";

export default async function ReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <ReservationCheckout reservationId={id} />
    </main>
  );
}
