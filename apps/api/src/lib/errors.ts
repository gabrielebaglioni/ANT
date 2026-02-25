import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function toHttpError(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        details: error.details ?? null,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: "Validation failed",
        details: error.flatten(),
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "Internal server error",
    },
  };
}
