// Images from interioreditors.co.in (renders and logos), served from /public/assets.
const A = `${import.meta.env.BASE_URL}assets/`;

export const brandAssets = {
  welcomePortrait: `${A}welcome-portrait.jpg`,
  welcomeLandscape: `${A}welcome-landscape.jpg`,
  cover: `${A}cover.jpg`,
  overview: `${A}overview.jpg`,
  logoDark: `${A}logo-teak.png`,
  logoLight: `${A}logo-plaster.png`,
  logoGold: `${A}logo-gold.png`,
  /** Thumbnail per scope category on the PDF, keyed by category name. */
  scope: {
    "Living Room": `${A}scope-living.jpg`,
    Dining: `${A}scope-dining.jpg`,
    Kitchen: `${A}scope-kitchen.jpg`,
    "Master Bedroom": `${A}scope-master.jpg`,
    "Bedroom 2": `${A}scope-bedroom.jpg`,
    "Bedroom 3": `${A}scope-bedroom.jpg`,
    "Bedroom 4": `${A}scope-bedroom.jpg`,
    Bathrooms: `${A}scope-bath.jpg`,
    "False Ceiling & Lighting": `${A}scope-ceiling.jpg`,
    "Painting & Finishes": `${A}scope-painting.jpg`,
    "Design & Services": `${A}scope-sketch.jpg`,
  } as Record<string, string>,
  /** Used for categories added later in the rate book. */
  scopeFallback: `${A}scope-sketch.jpg`,
  contact: {
    phone: "+91 7003 995 315",
    email: "hello@interioreditors.co.in",
    city: "Kolkata",
    website: "www.interioreditors.co.in",
  },
};
