import type { EpcisEvent } from "@ant/shared";
import { AppError } from "../../lib/errors";

function hasCbvFragment(uri: string, fragment: string): boolean {
  return uri.toLowerCase().includes(fragment.toLowerCase());
}

export function validateEpcisBusinessRules(event: EpcisEvent): void {
  if (!event.readPoint?.id || !event.bizLocation?.id) {
    throw new AppError("readPoint and bizLocation are required", 400);
  }

  if (hasCbvFragment(event.bizStep, "shipping") && event.action !== "OBSERVE") {
    throw new AppError("Shipping events should use action=OBSERVE", 400, {
      action: event.action,
      bizStep: event.bizStep,
    });
  }

  if (hasCbvFragment(event.bizStep, "receiving") && event.action !== "OBSERVE") {
    throw new AppError("Receiving events should use action=OBSERVE", 400, {
      action: event.action,
      bizStep: event.bizStep,
    });
  }

  if (hasCbvFragment(event.bizStep, "commissioning") && event.action !== "ADD") {
    throw new AppError("Commissioning events should use action=ADD", 400, {
      action: event.action,
      bizStep: event.bizStep,
    });
  }
}
