import { prisma } from "./prisma";
import { ReservationConflictError, ReservationGoneError } from "./reservations";

export class IdempotencyConflictError extends Error {}

export type IdempotentResponse = {
  statusCode: number;
  body: unknown;
};

type IdempotentStatus = "in_progress" | "completed" | "failed";

type MemoryIdempotencyRecord = {
  operation: string;
  requestHash: string;
  status: IdempotentStatus;
  response?: IdempotentResponse;
  deferred?: {
    promise: Promise<IdempotentResponse>;
    resolve: (value: IdempotentResponse) => void;
  };
};

const MEMORY_MODE = !process.env.DATABASE_URL;
const memoryIdempotencyStore = new Map<string, MemoryIdempotencyRecord>();

function createDeferred() {
  let resolve!: (value: IdempotentResponse) => void;
  const promise = new Promise<IdempotentResponse>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function mapErrorToResponse(error: unknown, fallbackMessage: string): IdempotentResponse {
  if (error instanceof ReservationConflictError) {
    return {
      statusCode: 409,
      body: { error: error.message },
    };
  }

  if (error instanceof ReservationGoneError) {
    return {
      statusCode: 410,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: fallbackMessage },
  };
}

async function waitForDbRecord(key: string): Promise<IdempotentResponse> {
  const startedAt = Date.now();
  const timeoutMs = 5000;

  while (Date.now() - startedAt < timeoutMs) {
    const current = await prisma?.idempotencyKey.findUnique({
      where: { key },
    });

    if (!current) {
      throw new Error("Idempotency record not found");
    }

    if (current.status === "completed" || current.status === "failed") {
      return {
        statusCode: current.responseStatus,
        body: current.responseBody,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Idempotency request is still processing");
}

async function runMemoryIdempotency(
  key: string,
  operation: string,
  requestHash: string,
  execute: () => Promise<IdempotentResponse>,
  fallbackMessage: string,
): Promise<IdempotentResponse> {
  const existing = memoryIdempotencyStore.get(key);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(
        "Idempotency-Key was already used with a different payload.",
      );
    }

    if (existing.status === "completed" || existing.status === "failed") {
      return existing.response ?? { statusCode: 500, body: { error: fallbackMessage } };
    }

    return existing.deferred?.promise ?? { statusCode: 500, body: { error: fallbackMessage } };
  }

  const deferred = createDeferred();
  memoryIdempotencyStore.set(key, {
    operation,
    requestHash,
    status: "in_progress",
    deferred,
  });

  try {
    const result = await execute();
    memoryIdempotencyStore.set(key, {
      operation,
      requestHash,
      status: "completed",
      response: result,
    });
    deferred.resolve(result);
    return result;
  } catch (error) {
    const result = mapErrorToResponse(error, fallbackMessage);
    memoryIdempotencyStore.set(key, {
      operation,
      requestHash,
      status: "failed",
      response: result,
    });
    deferred.resolve(result);
    return result;
  }
}

async function runDatabaseIdempotency(
  key: string,
  operation: string,
  requestHash: string,
  execute: () => Promise<IdempotentResponse>,
  fallbackMessage: string,
): Promise<IdempotentResponse> {
  if (!prisma) {
    throw new Error("Database is not configured");
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: { key },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(
        "Idempotency-Key was already used with a different payload.",
      );
    }

    if (existing.status === "completed" || existing.status === "failed") {
      return {
        statusCode: existing.responseStatus,
        body: existing.responseBody,
      };
    }

    return waitForDbRecord(key);
  }

  await prisma.idempotencyKey.create({
    data: {
      key,
      operation,
      requestHash,
      status: "in_progress",
      responseStatus: 0,
      responseBody: null,
    },
  });

  try {
    const result = await execute();

    await prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: "completed",
        responseStatus: result.statusCode,
        responseBody: JSON.parse(JSON.stringify(result.body)),
      },
    });

    return result;
  } catch (error) {
    const result = mapErrorToResponse(error, fallbackMessage);

    await prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: "failed",
        responseStatus: result.statusCode,
        responseBody: JSON.parse(JSON.stringify(result.body)),
      },
    });

    return result;
  }
}

export async function runWithIdempotency(
  operation: "reserve" | "confirm",
  key: string | null,
  requestHash: string,
  execute: () => Promise<IdempotentResponse>,
  fallbackMessage: string,
): Promise<IdempotentResponse> {
  if (!key) {
    return execute();
  }

  if (MEMORY_MODE) {
    return runMemoryIdempotency(key, operation, requestHash, execute, fallbackMessage);
  }

  return runDatabaseIdempotency(key, operation, requestHash, execute, fallbackMessage);
}
