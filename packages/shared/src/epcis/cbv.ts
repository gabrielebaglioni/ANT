export const CBV_BIZSTEP = {
  COMMISSIONING: "urn:epcglobal:cbv:bizstep:commissioning",
  PACKING: "urn:epcglobal:cbv:bizstep:packing",
  SHIPPING: "urn:epcglobal:cbv:bizstep:shipping",
  RECEIVING: "urn:epcglobal:cbv:bizstep:receiving",
  UNPACKING: "urn:epcglobal:cbv:bizstep:unpacking",
} as const;

export const CBV_DISPOSITION = {
  ACTIVE: "urn:epcglobal:cbv:disp:active",
  IN_TRANSIT: "urn:epcglobal:cbv:disp:in_transit",
  IN_PROGRESS: "urn:epcglobal:cbv:disp:in_progress",
} as const;
