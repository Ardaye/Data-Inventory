import { z } from "zod";

export const reserveSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  warehouseId: z.string().min(1, "warehouseId is required"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

export const reservationIdSchema = z.string().min(1, "reservation id is required");
