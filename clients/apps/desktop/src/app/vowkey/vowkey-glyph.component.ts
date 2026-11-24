import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

export type GlyphName =
  | "grid"
  | "bookmark"
  | "person"
  | "document"
  | "form"
  | "globe"
  | "card"
  | "key"
  | "layers"
  | "clock"
  | "bot"
  | "trash"
  | "gear"
  | "search"
  | "plus"
  | "back"
  | "forward"
  | "chevrons"
  | "chevron-down"
  | "more"
  | "pencil"
  | "copy"
  | "lock"
  | "calendar"
  | "flag"
  | "phone"
  | "mail"
  | "pin"
  | "id"
  | "sort"
  | "hand"
  | "access"
  | "eye"
  | "spark"
  | "send"
  | "import"
  | "export"
  | "note"
  | "text-size"
  | "scan"
  | "check"
  | "alert"
  | "close"
  | "download";

/** Body shape drawn with a 13% fill, then its detail strokes, all in the current ink. */
const GLYPHS: Record<GlyphName, { body?: string; strokes: string }> = {
  grid: {
    body: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
    strokes: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  },
  bookmark: { body: "M7 4h10v16l-5-3.6L7 20z", strokes: "M7 4h10v16l-5-3.6L7 20z" },
  person: {
    body: "M12 4.6a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
    strokes:
      "M12 4.6a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5.2 19.6c.5-3.4 3.2-5.4 6.8-5.4s6.3 2 6.8 5.4",
  },
  document: {
    body: "M7 3.5h6.6L18 7.9V20.5H7z",
    strokes: "M7 3.5h6.6L18 7.9V20.5H7zM13.4 3.7v4.4H18M9.6 12.4h5.8M9.6 15.4h5.8",
  },
  form: {
    body: "M5.8 8.2h6.6a5 5 0 0 0 5 5h2.2v3.2a2.6 2.6 0 0 1-2.6 2.6H5.8a2.6 2.6 0 0 1-2.6-2.6v-5.6a2.6 2.6 0 0 1 2.6-2.6zM17.6 3c.34 2.1 1.7 3.46 3.8 3.8-2.1.34-3.46 1.7-3.8 3.8-.34-2.1-1.7-3.46-3.8-3.8 2.1-.34 3.46-1.7 3.8-3.8z",
    strokes:
      "M12 8.2H5.8a2.6 2.6 0 0 0-2.6 2.6v5.6A2.6 2.6 0 0 0 5.8 19H17a2.6 2.6 0 0 0 2.6-2.6v-2.8M7 13.6h4.6M14.4 11.6v4M17.6 3c.34 2.1 1.7 3.46 3.8 3.8-2.1.34-3.46 1.7-3.8 3.8-.34-2.1-1.7-3.46-3.8-3.8 2.1-.34 3.46-1.7 3.8-3.8z",
  },
  globe: {
    body: "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z",
    strokes:
      "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8zM3.8 12h16.4M12 3.6c2.4 2.3 3.4 5.1 3.4 8.4s-1 6.1-3.4 8.4c-2.4-2.3-3.4-5.1-3.4-8.4s1-6.1 3.4-8.4z",
  },
  card: {
    body: "M3.8 6.2h16.4a1 1 0 0 1 1 1v9.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V7.2a1 1 0 0 1 1-1z",
    strokes:
      "M3.8 6.2h16.4a1 1 0 0 1 1 1v9.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V7.2a1 1 0 0 1 1-1zM2.8 10.2h18.4M6.4 14.6h3",
  },
  key: {
    body: "M8 9.4a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z",
    strokes:
      "M8 9.4a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zM10.8 14.4 19.6 5.6M16.4 8.8l2.2 2.2M14.2 11l1.8 1.8",
  },
  layers: {
    body: "M12 4 20.4 8.6 12 13.2 3.6 8.6z",
    strokes: "M12 4 20.4 8.6 12 13.2 3.6 8.6zM3.6 12.4 12 17l8.4-4.6M3.6 16 12 20.6 20.4 16",
  },
  clock: {
    body: "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z",
    strokes: "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8zM12 7.8V12l3 1.9",
  },
  bot: {
    body: "M6 8.4h12a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 17v-7A1.6 1.6 0 0 1 6 8.4z",
    strokes:
      "M6 8.4h12a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 17v-7A1.6 1.6 0 0 1 6 8.4zM12 8.4V5.2M9.2 12.6v1.4M14.8 12.6v1.4",
  },
  trash: {
    body: "M6.6 7.6h10.8l-.8 12H7.4z",
    strokes: "M4.8 7.6h14.4M9.4 7.6V5h5.2v2.6M6.6 7.6l.8 12h9.2l.8-12M10.2 11v5.4M13.8 11v5.4",
  },
  gear: {
    body: "M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z",
    strokes:
      "M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8zM12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6",
  },
  search: { strokes: "M10.6 4.6a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l4.6 4.6" },
  plus: { strokes: "M12 5v14M5 12h14" },
  back: { strokes: "M14.6 5.6 8.2 12l6.4 6.4" },
  forward: { strokes: "M9.4 5.6 15.8 12l-6.4 6.4" },
  chevrons: { strokes: "M8.6 9.6 12 6.2l3.4 3.4M8.6 14.4 12 17.8l3.4-3.4" },
  "chevron-down": { strokes: "M6.4 9.6 12 15.2l5.6-5.6" },
  more: {
    body: "M6 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm6 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm6 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    strokes:
      "M6 11.3a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm6 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm6 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z",
  },
  pencil: {
    strokes:
      "M5 19l.9-3.6L16.6 4.7a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L8.6 18.1z M14.8 6.5l2.7 2.7",
  },
  copy: {
    body: "M8.4 8.4h9.8v11.2H8.4z",
    strokes: "M8.4 8.4h9.8v11.2H8.4zM5.8 15.6V4.4h9.4",
  },
  lock: {
    body: "M5.8 10.6h12.4v9H5.8z",
    strokes: "M5.8 10.6h12.4v9H5.8zM8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6",
  },
  calendar: {
    body: "M4.6 6.4h14.8v13.2H4.6z",
    strokes: "M4.6 6.4h14.8v13.2H4.6zM4.6 10.4h14.8M8.4 4.2v3.6M15.6 4.2v3.6",
  },
  flag: { body: "M6 4.4h11l-2 4.2 2 4.2H6z", strokes: "M6 20.4V4.4h11l-2 4.2 2 4.2H6" },
  phone: {
    body: "M8 3.6h8a1 1 0 0 1 1 1v14.8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1z",
    strokes:
      "M8 3.6h8a1 1 0 0 1 1 1v14.8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1zM10.6 17.6h2.8",
  },
  mail: {
    body: "M4 6.4h16v11.2H4z",
    strokes: "M4 6.4h16v11.2H4zM4.4 7 12 13l7.6-6",
  },
  pin: {
    body: "M12 3.8a5.2 5.2 0 0 1 5.2 5.2c0 3.6-5.2 11.2-5.2 11.2S6.8 12.6 6.8 9A5.2 5.2 0 0 1 12 3.8z",
    strokes:
      "M12 3.8a5.2 5.2 0 0 1 5.2 5.2c0 3.6-5.2 11.2-5.2 11.2S6.8 12.6 6.8 9A5.2 5.2 0 0 1 12 3.8zM12 7.6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  },
  id: {
    body: "M3.8 5.8h16.4a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V6.8a1 1 0 0 1 1-1z",
    strokes:
      "M3.8 5.8h16.4a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V6.8a1 1 0 0 1 1-1zM7.2 14.4a2.2 2.2 0 1 1 4.4 0M9.4 9.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM13.6 10h4M13.6 13.2h4",
  },
  sort: { strokes: "M5 7h14M7.6 12h8.8M10.2 17h3.6" },
  hand: {
    body: "M8 12V6.2a1.2 1.2 0 0 1 2.4 0V11h.4V5a1.2 1.2 0 0 1 2.4 0v6h.4V6a1.2 1.2 0 0 1 2.4 0v7l1.2-1.6a1.3 1.3 0 0 1 2 1.6L17 17.6c-.8 1.4-2 2.4-4 2.4-2.8 0-5-2.2-5-5z",
    strokes:
      "M8 12V6.2a1.2 1.2 0 0 1 2.4 0V11M10.8 11V5a1.2 1.2 0 0 1 2.4 0v6M13.6 11V6a1.2 1.2 0 0 1 2.4 0v7l1.2-1.6a1.3 1.3 0 0 1 2 1.6L17 17.6c-.8 1.4-2 2.4-4 2.4-2.8 0-5-2.2-5-5",
  },
  access: {
    body: "M8 12V6.2a1.2 1.2 0 0 1 2.4 0V11h.4V5a1.2 1.2 0 0 1 2.4 0v6h.4V6a1.2 1.2 0 0 1 2.4 0v7l1.2-1.6a1.3 1.3 0 0 1 2 1.6L17 17.6c-.8 1.4-2 2.4-4 2.4-2.8 0-5-2.2-5-5z",
    strokes:
      "M8 12V6.2a1.2 1.2 0 0 1 2.4 0V11M10.8 11V5a1.2 1.2 0 0 1 2.4 0v6M13.6 11V6a1.2 1.2 0 0 1 2.4 0v7l1.2-1.6a1.3 1.3 0 0 1 2 1.6L17 17.6c-.8 1.4-2 2.4-4 2.4-2.8 0-5-2.2-5-5",
  },
  eye: {
    body: "M2.8 12S6 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12z",
    strokes:
      "M2.8 12S6 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12zM12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z",
  },
  send: {
    body: "M20 4.5 4 11.4l6.4 2.4L12.8 20z",
    strokes: "M20 4.5 4 11.4l6.4 2.4L12.8 20zM10.4 13.8 20 4.5",
  },
  import: { strokes: "M12 4v10M8 10.5l4 4 4-4M5 15.5v3h14v-3" },
  export: { strokes: "M12 14V4M8 7.5l4-4 4 4M5 15.5v3h14v-3" },
  spark: {
    strokes:
      "M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2.2 2.2M14.8 14.8 17 17M17 7l-2.2 2.2M9.2 14.8 7 17",
  },
  note: {
    body: "M5.5 4h13a1 1 0 0 1 1 1v10.2L15.2 19.5H5.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    strokes:
      "M5.5 4h13a1 1 0 0 1 1 1v10.2L15.2 19.5H5.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14.8 19.5v-4.2h4.7M8.2 9h7.6M8.2 12.4h5.4",
  },
  "text-size": {
    strokes: "M4 6.5h11M9.5 6.5v11.5M14.5 11.5h5.5M17.25 11.5v6.5",
  },
  scan: {
    body: "M6.8 6.4h10.4a1.4 1.4 0 0 1 1.4 1.4v8.4a1.4 1.4 0 0 1-1.4 1.4H6.8a1.4 1.4 0 0 1-1.4-1.4V7.8a1.4 1.4 0 0 1 1.4-1.4z",
    strokes:
      "M3.6 8V6a2.4 2.4 0 0 1 2.4-2.4h2M16 3.6h2A2.4 2.4 0 0 1 20.4 6v2M20.4 16v2a2.4 2.4 0 0 1-2.4 2.4h-2M8 20.4H6A2.4 2.4 0 0 1 3.6 18v-2M5.6 12h12.8M8.8 9.1h4.6M8.8 14.9h6.4",
  },
  check: {
    strokes: "M5.4 12.6 9.8 17l8.8-9.6",
  },
  alert: {
    body: "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z",
    strokes: "M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8zM12 8v4.6M12 15.8h.01",
  },
  close: {
    strokes: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  },
  download: {
    strokes: "M12 4v11.5M7.6 11.2 12 15.6l4.4-4.4M5 19.4h14",
  },
};

interface Picto {
  /** The filled shape, drawn in the kind's colour (white inside a coloured tile). */
  body: string;
  /** Soft strokes in the body's colour that add depth without more fill. */
  soft?: string;
  /** Details cut out of the body, drawn in the tile colour (white on a bare icon). */
  detail?: string;
}

/**
 * Solid pictograms for the things Vowkey holds. They are filled, not outlined: a coloured tile with
 * a white pictogram reads at a glance, where a thin outline in a grey box reads as a placeholder.
 */
const PICTOS: Partial<Record<GlyphName, Picto>> = {
  document: {
    body: "M7 3h6.6L19 8.4V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    detail: "M13.4 3.4V8h5.2M8.5 12.2h7M8.5 15.2h7M8.5 18h4",
  },
  person: {
    body: "M12 3.5a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zM4.5 20.2c.5-3.7 3.5-6 7.5-6s7 2.3 7.5 6a1 1 0 0 1-1 1.1H5.5a1 1 0 0 1-1-1.1z",
  },
  form: {
    body: "M5.8 7.6h7.2a4.8 4.8 0 0 0 4.8 4.8h1.8v4.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 16.6v-6.2a2.8 2.8 0 0 1 2.8-2.8zM17.8 2.4c.38 2.3 1.9 3.82 4.2 4.2-2.3.38-3.82 1.9-4.2 4.2-.38-2.3-1.9-3.82-4.2-4.2 2.3-.38 3.82-1.9 4.2-4.2z",
    detail: "M6.6 13.6h4.2M13 11.8v3.6",
  },
  scan: {
    body: "M6.8 6h10.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6.8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    soft: "M3.4 7.8V5.8a2.4 2.4 0 0 1 2.4-2.4h2M16.2 3.4h2a2.4 2.4 0 0 1 2.4 2.4v2M20.6 16.2v2a2.4 2.4 0 0 1-2.4 2.4h-2M7.8 20.6h-2a2.4 2.4 0 0 1-2.4-2.4v-2",
    detail: "M5.2 12h13.6M8.6 9.2h4.6M8.6 14.8h6.4",
  },
  globe: {
    body: "M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4z",
    detail:
      "M3.2 12h17.6M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  },
  card: {
    body: "M5 5h14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 5z",
    detail: "M2.8 9.6h18.4M6.5 15h3.5",
  },
  note: {
    body: "M6.5 3.5h11a2 2 0 0 1 2 2v9.5l-5 5.5h-8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z",
    detail: "M8.2 8.5h7.6M8.2 12h5M14.5 20v-4a1 1 0 0 1 1-1h4",
  },
  key: {
    body: "M15.2 3.2a5.8 5.8 0 0 0-5.5 7.7L3.2 17.4V21h3.6v-2.2h2.2v-2.2h2l1.4-1.4a5.8 5.8 0 1 0 2.8-10z",
    detail: "M16.7 7.7h.1",
  },
  layers: {
    body: "M12 2.8l9 4.6-9 4.6-9-4.6z",
    soft: "M3.6 11.8l8.4 4.3 8.4-4.3M3.6 16.2l8.4 4.3 8.4-4.3",
  },
  bot: {
    body: "M6.5 7.5h11a3 3 0 0 1 3 3V17a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3z",
    soft: "M12 7.5V4.2M2.2 12.5V15M21.8 12.5V15",
    detail: "M8.7 12.2h.01M15.3 12.2h.01M9.3 16h5.4",
  },
  access: {
    body: "M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4z",
    detail: "M7.2 9.4l4.8 1.2 4.8-1.2M12 10.6v3.6M9.7 18.2l2.3-4 2.3 4",
  },
  grid: { body: "M4 4h6.4v6.4H4zM13.6 4H20v6.4h-6.4zM4 13.6h6.4V20H4zM13.6 13.6H20V20h-6.4z" },
  bookmark: {
    body: "M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.5L12 16.5 5.5 20.5V5A1.5 1.5 0 0 1 7 3.5z",
  },
};

/** A glyph is one ink: strokes in the current color over a 13% body fill, readable without color. */
@Component({
  selector: "vk-glyph",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @if (picto(); as p) {
        <path
          [attr.d]="p.body"
          style="fill: var(--picto-body, var(--k-tile, var(--k, currentColor))); stroke: var(--picto-body, var(--k-tile, var(--k, currentColor)))"
          stroke-width="1.2"
        />
        @if (p.soft) {
          <path
            [attr.d]="p.soft"
            style="stroke: var(--picto-body, var(--k-tile, var(--k, currentColor)))"
            stroke-width="1.8"
          />
        }
        @if (p.detail) {
          <path [attr.d]="p.detail" style="stroke: var(--picto-detail, #fff)" stroke-width="1.6" />
        }
      } @else {
        @if (shape().body; as body) {
          <path [attr.d]="body" fill="currentColor" fill-opacity="0.13" stroke="none" />
        }
        <path [attr.d]="shape().strokes" />
      }
    </svg>
  `,
  styles: [":host{display:inline-flex;flex:none;line-height:0}"],
})
export class VowkeyGlyphComponent {
  readonly name = input.required<GlyphName>();
  readonly size = input(18);
  /** Draws the solid pictogram when there is one, for the things Vowkey holds. */
  readonly solid = input(false);
  protected readonly shape = computed(() => GLYPHS[this.name()]);
  protected readonly picto = computed(() => (this.solid() ? (PICTOS[this.name()] ?? null) : null));
}
