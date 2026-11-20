import { z } from "zod";

/**
 * What the AI must return for each email (guaranteed-valid JSON via
 * structured outputs). Times are local wall-clock values exactly as written
 * (plus their time zone when not Eastern); the code, not the AI, turns them
 * into exact instants.
 */
export const ExtractedEvent = z.object({
  action: z.enum(["create", "update", "cancel"]),
  title: z.string().describe("Short calendar title, e.g. 'Dentist appointment' or 'Chem lab report due'"),
  date: z.string().describe("YYYY-MM-DD (local date of the start)"),
  start_time: z.string().nullable().describe("HH:MM 24-hour, exactly as written (local time; see timezone), or null if no time is given"),
  end_time: z.string().nullable().describe("HH:MM 24-hour, or null"),
  end_date: z.string().nullable().describe("YYYY-MM-DD for multi-day events, else null"),
  timezone: z
    .string()
    .nullable()
    .describe("IANA zone of start_time if it is local time somewhere other than US Eastern (e.g. a flight departing Chicago → 'America/Chicago'); null if Eastern"),
  end_timezone: z
    .string()
    .nullable()
    .describe("IANA zone of end_time if it is local time somewhere other than US Eastern (e.g. a flight landing in Denver → 'America/Denver'; a 7–9 PM concert in Chicago → 'America/Chicago' for both); null if Eastern"),
  is_deadline: z.boolean().describe("true for due dates / deadlines (something must be done BY then)"),
  location: z.string().nullable(),
  details: z.string().nullable().describe("One short sentence of useful context, or null"),
  confidence: z.number().describe("0 to 1: how sure you are this is a real event for the reader with the right date/time"),
  quote: z.string().describe("The exact short phrase from the email that states the event (max ~25 words)"),
  refers_to: z
    .string()
    .nullable()
    .describe("For update/cancel: the title of the earlier event this changes, else null"),
});

export const Extraction = z.object({
  kind: z
    .enum(["none", "clear", "possible"])
    .describe("none = no event; clear = definite event(s); possible = maybe an event, ambiguous"),
  events: z.array(ExtractedEvent),
});

export type ExtractedEvent = z.infer<typeof ExtractedEvent>;
export type Extraction = z.infer<typeof Extraction>;
