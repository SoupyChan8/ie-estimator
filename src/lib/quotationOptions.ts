export type PaymentStage = { pct: number; title: string; sub: string };
export type TimelinePhase = { title: string; sub: string };

export type QuotationOptions = {
  included: string[];
  notIncluded: string[];
  payments: PaymentStage[];
  timeline: TimelinePhase[];
};

/** Defaults taken from the Interior Editors quotation PDF. */
export const DEFAULT_OPTIONS: QuotationOptions = {
  included: [
    "BWP, Anti Termite Ply, Outer & Inner Sunmica Finish",
    "Design consultation & space planning",
    "3D visualisation and drawings",
    "Carpentry and modular furniture",
    "Electrical work and lighting for furnitures",
    "Installation and final finishing",
    "Cleaning the rubbish materials and placing the sacs outside",
  ],
  notIncluded: [
    "Appliances (AC, fridge, chimney, geyser, etc.)",
    "Loose furniture (sofa, dining table, chairs, etc.), except mentioned in the scope above",
    "Curtains, mattress, blinds and rugs",
    "Decorative accessories, wall paint, lights and artefacts",
    "Government / building charges",
    "Items not mentioned in the scope above",
  ],
  payments: [
    { pct: 10, title: "Booking / Confirmation", sub: "On agreement signing" },
    { pct: 20, title: "Design Approval", sub: "After final 3D design & material selection" },
    { pct: 30, title: "Material Procurement", sub: "On start of production / procurement" },
    { pct: 30, title: "Installation", sub: "On-site execution and installation" },
    { pct: 10, title: "Handover", sub: "After final completion and handover" },
  ],
  timeline: [
    { title: "Design", sub: "2–3 weeks" },
    { title: "Material Finalisation", sub: "1–2 weeks" },
    { title: "Production", sub: "3–4 weeks" },
    { title: "Installation", sub: "3–4 weeks" },
    { title: "Handover", sub: "" },
  ],
};

export function withDefaults(o: Partial<QuotationOptions> | null | undefined): QuotationOptions {
  return {
    included: o?.included ?? DEFAULT_OPTIONS.included,
    notIncluded: o?.notIncluded ?? DEFAULT_OPTIONS.notIncluded,
    payments: o?.payments ?? DEFAULT_OPTIONS.payments,
    timeline: o?.timeline ?? DEFAULT_OPTIONS.timeline,
  };
}
