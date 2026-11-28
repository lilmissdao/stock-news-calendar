import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * AI coach for the Direction quiz. Two jobs:
 * - "calls": for the calls just revealed, explain why each was wrong (or right), using only what was on the chart at the
 *   time and the player's own reason; says plainly when the move wasn't predictable from the chart.
 * - "report": a short take on each weak spot from the report card, based on the player's misses there.
 * Needs ANTHROPIC_API_KEY in the deployment's environment; answers 503 { error: "not_configured" } without it.
 */

const MODEL = "claude-opus-5-5";

const CallInput = z.object({
  horizon: z.number().int().min(1).max(60),
  call: z.enum(["Higher", "Flat", "Lower"]),
  actual: z.enum(["Higher", "Flat", "Lower"]),
  right: z.boolean(),
  reason: z.string().max(600).optional(),
  whatHappened: z.string().max(800),
});

const CallsRequest = z.object({
  mode: z.literal("calls"),
  symbol: z.string().max(10),
  time: z.string().max(10),
  setup: z.string().max(1200),
  levels: z.string().max(800),
  recentBars: z.string().max(6000),
  dayType: z.string().max(100),
  calls: z.array(CallInput).min(1).max(3),
});

const ReportRequest = z.object({
  mode: z.literal("report"),
  overall: z.string().max(200),
  spots: z
    .array(z.object({ name: z.string().max(120), accuracy: z.string().max(20), calls: z.number().int(), commonMiss: z.string().max(200) }))
    .min(1)
    .max(5),
  misses: z
    .array(
      z.object({
        spot: z.string().max(300),
        said: z.string().max(10),
        was: z.string().max(10),
        reason: z.string().max(600).optional(),
        whatHappened: z.string().max(800),
      }),
    )
    .max(20),
});

const Body = z.discriminatedUnion("mode", [CallsRequest, ReportRequest]);

const CallsAnswer = z.object({
  items: z.array(
    z.object({
      horizon: z.number(),
      verdict: z.enum(["misread", "unpredictable", "right"]),
      why: z.string(),
      lesson: z.string(),
    }),
  ),
});

const ReportAnswer = z.object({
  spots: z.array(z.object({ name: z.string(), insight: z.string() })),
});

const COACH = `You are a concise day-trading coach. A student practices calling where TQQQ (a 3x leveraged Nasdaq-100 ETF) will be a few minutes ahead on replayed 1-minute data, without seeing what comes next.
Higher or Lower means it moved more than 0.15% from the price at the call; Flat means it stayed within 0.15%.
Judge only from what was on the chart at the moment of the call: the candles so far, VWAP and its bands, the prior day's close/high/low, the pre-market high/low and the 9:30-9:35 opening range.
Write in plain English for someone learning, with specific prices and levels. No hedging and no disclaimers about trading risk.`;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    if (body.mode === "calls") {
      const callsText = body.calls
        .map(
          (call) =>
            `- ${call.horizon} min ahead: student said ${call.call}${call.reason ? ` because "${call.reason}"` : " (no reason given)"}. ` +
            `It was ${call.actual} (${call.right ? "right" : "wrong"}). What happened after: ${call.whatHappened}`,
        )
        .join("\n");
      const message = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: COACH,
        output_config: { effort: "low", format: betaZodOutputFormat(CallsAnswer) },
        messages: [
          {
            role: "user",
            content:
              `${body.symbol} at ${body.time} ET on a day that later turned out to be a "${body.dayType}" on the daily chart (the student didn't know that).\n` +
              `Setup at the call: ${body.setup}\n` +
              `Levels: ${body.levels}\n` +
              `1-minute bars up to the call (time open high low close):\n${body.recentBars}\n\n` +
              `The student's calls:\n${callsText}\n\n` +
              `For each call, return one item with its horizon:\n` +
              `- verdict "right" if the call was right, "misread" if the chart at the time pointed the other way and the student missed or misread it, ` +
              `"unpredictable" if nothing visible at the time pointed to what happened (noise or a sudden news-like move). Don't invent a reason for an unpredictable move.\n` +
              `- why: 1-2 sentences. For a wrong call, say what the student got wrong, referring to their reason when they gave one. For a right call, say what made it right.\n` +
              `- lesson: one short sentence to remember next time.`,
          },
        ],
      });
      if (message.stop_reason === "refusal" || !message.parsed_output) {
        return Response.json({ error: "no_answer" }, { status: 502 });
      }
      return Response.json(message.parsed_output);
    }

    const spotsText = body.spots
      .map((spot) => `- ${spot.name}: ${spot.accuracy} right over ${spot.calls} calls. Most common miss: ${spot.commonMiss}`)
      .join("\n");
    const missesText = body.misses
      .map(
        (miss) =>
          `- [${miss.spot}] said ${miss.said}, was ${miss.was}.${miss.reason ? ` Reason given: "${miss.reason}".` : " No reason given."} What happened: ${miss.whatHappened}`,
      )
      .join("\n");
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: COACH,
      output_config: { effort: "low", format: betaZodOutputFormat(ReportAnswer) },
      messages: [
        {
          role: "user",
          content:
            `Overall: ${body.overall}\nThe student's weakest setups:\n${spotsText}\n\nRecent misses in those setups:\n${missesText}\n\n` +
            `For each weak setup, return one item with its exact name and an insight: 1-2 sentences on the pattern behind the misses ` +
            `(what they keep expecting vs what tends to happen there, citing their reasons when they show a habit), then what to do differently. ` +
            `If the misses there look like noise rather than a habit, say so.`,
        },
      ],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) {
      return Response.json({ error: "no_answer" }, { status: 502 });
    }
    return Response.json(message.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "busy" }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: "not_configured" }, { status: 503 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: "upstream", status: error.status }, { status: 502 });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
