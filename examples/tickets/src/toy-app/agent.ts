/**
 * Tiny deterministic classifier + drafter for the toy support flow.
 *
 * In a real port, the classifier would call an LLM gateway with prompt
 * caching + a real category catalog. Keep it heuristic for the example
 * so the saga fixtures are reproducible across runs without an LLM key.
 *
 * Categories: billing, technical, account, shipping, general.
 * Confidence is a function of keyword density. Drafted responses are
 * short templated replies; engineers can approve or escalate.
 */

import type { Ticket, TicketStore } from "./backend";

export interface Classification {
	category: "billing" | "technical" | "account" | "shipping" | "general";
	priority: "low" | "medium" | "high";
	confidence: number;
}

const KEYWORDS: Record<Classification["category"], string[]> = {
	billing: ["refund", "charge", "invoice", "payment", "bill", "subscription"],
	technical: ["error", "crash", "bug", "broken", "fail", "stuck"],
	account: ["login", "password", "access", "locked", "email"],
	shipping: ["delivery", "shipping", "track", "address", "package"],
	general: ["question", "how", "help", "thanks"],
};

const URGENT = ["urgent", "asap", "broken", "down", "lost"];

export function classify(ticket: Ticket): Classification {
	const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
	const scores: Record<string, number> = {};
	let total = 0;
	for (const [cat, words] of Object.entries(KEYWORDS)) {
		let n = 0;
		for (const w of words) {
			if (text.includes(w)) n++;
		}
		scores[cat] = n;
		total += n;
	}
	let best: Classification["category"] = "general";
	let bestScore = 0;
	for (const [cat, score] of Object.entries(scores)) {
		if (score > bestScore) {
			best = cat as Classification["category"];
			bestScore = score;
		}
	}
	const confidence = total === 0 ? 0.3 : Math.min(0.95, bestScore / total);
	const urgent = URGENT.some((w) => text.includes(w));
	const refundMatch = ticket.body.match(/\$([0-9]+)/);
	const refund = refundMatch ? Number.parseInt(refundMatch[1], 10) : 0;
	let priority: Classification["priority"] = "low";
	if (urgent || refund > 1000) priority = "high";
	else if (refund > 100 || best === "billing") priority = "medium";
	return { category: best, priority, confidence };
}

const TEMPLATES: Record<Classification["category"], string> = {
	billing:
		"Thanks for reaching out about your billing question. I've reviewed the charge and will follow up with the next steps. Is there a specific date range I should look at?",
	technical:
		"Sorry to hear you're seeing this error. To narrow it down, can you share the steps you took right before the failure, plus the version you're running?",
	account:
		"I can help with your account access issue. I've sent a password reset to the email on file. If that doesn't arrive within 10 minutes, let me know.",
	shipping:
		"Thanks for the shipping question. Your package is currently in transit, and I'll send you the tracking link separately so you can monitor it.",
	general:
		"Thanks for reaching out. I'd love to point you in the right direction. Could you share a bit more about what you're trying to do?",
};

export function draftResponse(
	ticket: Ticket,
	classification: Classification,
): string {
	return `${TEMPLATES[classification.category]} Reference: ${ticket.subject}.`;
}

/**
 * Run the agent's classify + draft pass on a ticket. Returns the updated
 * ticket. Pure dispatch over the store; the injectors emit the matching
 * saga effects.
 */
export function classifyAndDraft(
	store: TicketStore,
	ticket_id: string,
): { ticket: Ticket; classification: Classification } {
	const ticket = store.get(ticket_id);
	if (!ticket) throw new Error(`Ticket ${ticket_id} not found`);
	const classification = classify(ticket);
	const drafted = draftResponse(ticket, classification);
	const updated = store.update(ticket_id, {
		category: classification.category,
		priority: classification.priority,
		confidence: classification.confidence,
		drafted_response: drafted,
		status: "awaiting_approval",
	});
	return { ticket: updated, classification };
}
